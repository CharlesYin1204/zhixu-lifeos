import crypto from 'node:crypto';
import {pool,id,parse,cleanOrder} from './db.mjs';
import {assert,decrypt,encrypt,safeURL} from './security.mjs';
export function epaySign(params,key){return crypto.createHash('md5').update(Object.keys(params).filter(k=>!['sign','sign_type'].includes(k)&&params[k]!==''&&params[k]!=null).sort().map(k=>`${k}=${params[k]}`).join('&')+key).digest('hex');}
export async function fulfill(orderId,providerRef,adminId=null) {
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [rows]=await conn.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);
  const order=rows[0];
  assert(order,'订单不存在',404);
  if(order.status==='paid'){await conn.commit();return;}
  // Verified provider notifications may arrive after a local cancellation.
  // Manual approvals still require a pending order.
  const verifiedOnline=adminId===null&&['stripe','epay'].includes(order.payment_method);
  assert(order.status==='pending'||(order.status==='cancelled'&&verifiedOnline),'订单状态不可支付');
  assert(typeof providerRef==='string'&&providerRef.length>0&&providerRef.length<=255,'支付流水号无效');
  const product=parse(order.snapshot);
  await conn.execute("UPDATE orders SET status='paid',paid_at=NOW(),provider_ref=? WHERE id=?",[providerRef,orderId]);
  if(order.product_type==='plugin') {
   await conn.execute('INSERT IGNORE INTO installs (user_id,plugin_id) VALUES (?,?)',[order.user_id,order.product_id]);
  } else {
   await conn.execute('UPDATE users SET plan_id=?,plan_expires=DATE_ADD(IF(plan_expires>NOW(),plan_expires,NOW()),INTERVAL ? DAY),credits=credits+? WHERE id=?',[order.product_id,Number(product.days),Number(product.credits),order.user_id]);
  }
  await conn.execute('INSERT INTO audit (id,user_id,action,detail) VALUES (?,?,?,?)',[id(),adminId,'order.paid',JSON.stringify({orderId,providerRef})]);
  await conn.commit();
 } catch(error) {
  await conn.rollback();
  throw error;
 } finally {
  conn.release();
 }
}
function checkoutRequest(b) {
 assert(['membership','plugin'].includes(b.type),'订单类型无效');
 assert(typeof b.productId==='string'&&b.productId.length>0&&b.productId.length<=64,'商品编号无效');
 const method=b.paymentMethod||'manual';
 assert(['manual','stripe','epay'].includes(method),'支付方式无效');
 const channel=method==='epay'?(b.channel||'wxpay'):null;
 assert(channel===null||['alipay','wxpay'].includes(channel),'支付渠道无效');
 const requestKey=b.requestId===undefined?crypto.randomUUID():b.requestId;
 assert(typeof requestKey==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(requestKey),'订单请求编号须为 8–128 位字母、数字或 . _ : -');
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([b.type,b.productId,method,channel])).digest('hex');
 return {requestKey,fingerprint,method,channel};
}

async function connectionEntity(conn,type,key) {
 const [rows]=await conn.execute('SELECT data FROM entities WHERE type=? AND id=?',[type,key]);
 return rows[0]?{...parse(rows[0].data),id:key}:null;
}

// Only this server-side table contains payment configuration. Order DTOs never include it.
function protectedSecret(value) { return value.startsWith('enc:')?value:encrypt(value); }

async function reserveOrder(user,b,request) {
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  // The primary key serializes equal requests across processes, including first-time races.
  await conn.execute('INSERT INTO order_requests (user_id,request_key,fingerprint) VALUES (?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key',[user.id,request.requestKey,request.fingerprint]);
  const [[existing]]=await conn.execute('SELECT * FROM order_requests WHERE user_id=? AND request_key=? FOR UPDATE',[user.id,request.requestKey]);
  assert(existing.fingerprint===request.fingerprint,'订单请求编号已用于其他商品或支付渠道，请重新发起购买',409);
  if(!existing.order_id) {
   const product=await connectionEntity(conn,b.type==='membership'?'plan':'plugin',b.productId);
   assert(product&&product.enabled!==false&&product.listed!==false,'商品不存在或已下架',404);
   if(b.type==='plugin') {
    const agent=await connectionEntity(conn,'agent',product.agentId);
    assert(agent&&agent.enabled!==false,'此插件关联的助手不可用，请稍后购买',503);
   }
   const amount=Math.round(Number(product.price)*100);
   assert(Number.isSafeInteger(amount)&&amount>0&&amount<=2147483647,'商品价格无效或为免费项目');
   const [[row]]=await conn.execute('SELECT data FROM settings WHERE id=1');
   const payment=parse(row?.data).payment||{};
   assert(payment[`${request.method}Enabled`],'此支付渠道尚未启用');
   const checkout={method:request.method,channel:request.channel,appUrl:process.env.APP_URL};
   if(request.method==='manual')checkout.instructions=payment.manualInstructions||'';
   if(request.method==='stripe') {
    assert(payment.stripeSecret&&payment.stripeWebhookSecret,'请先配置 Stripe 密钥与 Webhook');
    checkout.secret=protectedSecret(payment.stripeSecret);
   }
   if(request.method==='epay') {
    assert(payment.epayKey&&payment.epayPid&&payment.epayUrl,'请先配置易支付商户资料');
    checkout.secret=protectedSecret(payment.epayKey);
    checkout.pid=payment.epayPid;
    checkout.url=payment.epayUrl;
   }
   const orderId='ZX'+Date.now()+crypto.randomBytes(5).toString('hex');
   await conn.execute('INSERT INTO orders (id,user_id,product_type,product_id,title,amount,payment_method,snapshot) VALUES (?,?,?,?,?,?,?,?)',[orderId,user.id,b.type,product.id,product.name,amount,request.method,JSON.stringify(product)]);
   await conn.execute('UPDATE order_requests SET order_id=?,checkout=? WHERE user_id=? AND request_key=?',[orderId,JSON.stringify(checkout),user.id,request.requestKey]);
  }
  await conn.commit();
 } catch(error) {
  await conn.rollback();
  throw error;
 } finally {
  conn.release();
 }
}

export async function createOrder(user,b) {
 const request=checkoutRequest(b);
 // Commit the order before contacting a provider. A timeout can then be retried using
 // the same order, amount snapshot and provider idempotency key, never a second charge.
 await reserveOrder(user,b,request);
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [[entry]]=await conn.execute('SELECT * FROM order_requests WHERE user_id=? AND request_key=? FOR UPDATE',[user.id,request.requestKey]);
  const [[order]]=await conn.execute('SELECT * FROM orders WHERE id=? AND user_id=? FOR UPDATE',[entry.order_id,user.id]);
  assert(order,'订单不存在',404);
  let paymentUrl=entry.payment_url,instructions=entry.instructions;
  if(order.status!=='pending') {
   await conn.commit();
   return {order:cleanOrder(order),paymentUrl:null};
  }
  if(!entry.ready) {
   const checkout=parse(entry.checkout);
   if(checkout.method==='manual')instructions=checkout.instructions;
   if(checkout.method==='epay') {
    const url=await safeURL(checkout.url);
    const params={pid:checkout.pid,type:checkout.channel,out_trade_no:order.id,notify_url:`${checkout.appUrl}/api/payments/notify?provider=epay`,return_url:`${checkout.appUrl}/?view=user`,name:order.title,money:(order.amount/100).toFixed(2)};
    params.sign=epaySign(params,decrypt(checkout.secret));params.sign_type='MD5';
    paymentUrl=`${url.replace(/\/submit.php$/,'')}/submit.php?${new URLSearchParams(params)}`;
   }
   if(checkout.method==='stripe') {
    const form=new URLSearchParams({mode:'payment',success_url:`${checkout.appUrl}/?view=user&payment=success`,cancel_url:`${checkout.appUrl}/?view=membership&payment=cancelled`,client_reference_id:order.id,'metadata[orderId]':order.id,'line_items[0][price_data][currency]':'cny','line_items[0][price_data][unit_amount]':String(order.amount),'line_items[0][price_data][product_data][name]':order.title,'line_items[0][quantity]':'1'});
    const res=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${decrypt(checkout.secret)}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':order.id},body:form,signal:AbortSignal.timeout(20000)});
    const data=await res.json();
    assert(res.ok&&typeof data.url==='string'&&typeof data.id==='string','Stripe 创建支付失败，请检查商户配置',502);
    paymentUrl=data.url;
    order.provider_ref=data.id;
    await conn.execute('UPDATE orders SET provider_ref=? WHERE id=?',[data.id,order.id]);
   }
   await conn.execute('UPDATE order_requests SET ready=1,payment_url=?,instructions=? WHERE user_id=? AND request_key=?',[paymentUrl,instructions,user.id,request.requestKey]);
  }
  await conn.commit();
  return {order:cleanOrder(order),paymentUrl,instructions:order.payment_method==='manual'?instructions:undefined};
 } catch(error) {
  await conn.rollback();
  throw error;
 } finally {
  conn.release();
 }
}
