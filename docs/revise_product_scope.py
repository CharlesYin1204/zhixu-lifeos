from pathlib import Path
import json,ast,xml.etree.ElementTree as ET
B=Path(__file__).parent
p=B/'build_product_docs.py';source=p.read_text();old_xml=(B/'draft_81969f84_folder/draft.xml').read_text();old_features=json.loads((B/'功能表数据.json').read_text())
replacements={
'学习计划：':'学习计划：一期使用目标（goal）与学习任务（task）共同承载，不建立独立 plan 实体。目标记录学习周期、每天可投入分钟数、进度及截止日期；任务通过 goalId 关联目标，可独立创建、完成、编辑和删除。用户能将长期目标拆成每天可执行的行动，已完成任务不重复计入待办。功能验收以真实字段和操作为准，不将“计划页面”误称为独立数据实体。',
'知识库：':'知识库：用户创建文本笔记、标题与分类/标签，查看、编辑、删除和搜索本人条目。一期 AI 参考上下文由本人近期记录、关键词相关性排序及长度裁剪构成，不使用向量数据库，也不声称完整向量 RAG。输入资料与系统指令隔离；回答应以用户有权访问的记录为依据，缺乏依据时明确说明。',
'模型配置包括':'模型配置包括名称、供应商 API Base URL、模型 ID、API Key、启用状态和默认模型。Agent 可显式绑定指定模型，也可选择跟随默认模型；修改默认值只影响未绑定模型的 Agent。温度和输出上限在一期由服务端固定控制，后台可调参数作为后续扩展。密钥仅由管理员输入，保存后只返回脱敏状态；普通前端包和接口响应不得出现密钥。URL 校验协议与公网目标，避免测试入口变成内网请求代理。',
'模型测试从后台':'模型测试从后台真实发送最小请求，回显成功/失败、响应片段和耗时；修改 Agent 绑定或默认模型后按其绑定规则作用于下一次调用。服务端设置超时、输入长度、并发上限和用户余额，避免无限重试。使用量若供应商未返回 token 统计，展示未知或明确估算，不能将缺失值伪装为已核算消耗。',
'用户可浏览、分类筛选':'用户可浏览、分类筛选、搜索并查看插件价格；免费插件安装后建立本人安装关系并进入已安装列表，重复安装幂等。卸载只移除使用入口和安装关系，个人业务记录保留。免费安装后管理员将插件改为收费时，既有安装继续可用；用户卸载后若没有有效购买记录，再次安装按当前价格购买。有已支付购买记录的用户可直接重装，不重复收款。',
'付费插件必须':'付费插件在新安装时由服务端验证已支付购买记录；一期会员与付费插件单独销售，会员不自动包含收费插件。运行时校验有效安装及插件/Agent启用状态，并遵守免费转收费保留既有安装的约定。展示和创建订单价格均取自服务器；管理员改价只影响新订单，历史订单快照不变。下架阻止新购买/安装，已有订单保留；安全原因停用会暂停运行并给出明确提示。',
'管理员可创建/编辑插件资料':'管理员可创建/编辑插件资料、价格与免费/付费类型，并控制上下架。授权分为安装关系与购买记录：免费安装可获使用权，已购用户可恢复安装，既有免费安装按价格变更规则继续可用。用户任意修改客户端状态不能生成服务端安装关系或购买记录。',
'会员套餐包含':'会员套餐包含名称、价格、有效天数、一次购买增加的 AI 额度、展示权益和启用状态。价格从后台配置读取；会员有效期由服务端计算，续费在未过期的有效期末延长，过期从当前时间起算。一期不自动续费、不定期自动扣款，也不按月自动重置 AI 余额。',
'订单包含不可预测':'订单包含不可预测的订单号、用户、产品类型和 ID、商品名称及权益快照、人民币金额（整数分）、状态、支付方式、创建/支付时间和交易号。已实现状态为 pending/paid/cancelled；仅可信回调或有日志的管理员线下收款确认发放权益。会员每次成功购买增加一次 AI 余额；会员身份到期恢复免费身份，但已购剩余额度不随身份到期失效，历史数据也保留。',
'一期 Android 形态':'一期 Android 形态为联网 WebView 容器，最低支持 Android 6.0（API 23），加载与网页相同的站点并使用同一登录权限体系。下载页展示应用名称、版本、文件信息与联网要求。不是离线原生客户端；正式域名或站点地址变更后需重新生成安装包。',
'用户与会话：':'用户与会话：users 保存账号、password_hash、role、status、plan_id、plan_expires、credits 和创建时间；sessions 保存 token_hash、user_id 与 expires_at。所有私有记录有 user_id。会员身份有效期和 AI 余额分别管理，不以会员过期清空余额。实体配置采用 entities(type,id,data)，普通业务采用 records(kind,meta)；输入按类型校验。',
'学习生活实体：':'学习生活记录：records.kind 支持 task、goal、course、note、habit、event、focus、expense、health、review。goal.meta 保存周期与每天minutes；task.meta.goalId关联学习目标；course.meta 保存资源链接及progress；habit.meta保存打卡日期；event.meta保存开始结束；focus.meta保存minutes；expense.meta保存收支方向与安全金额；health.meta保存指标值和单位；review正文保存复盘。不存在独立学习 plan 表；会员套餐的 plan 配置与学习计划不是同一概念。',
'AI 实体：':'AI 数据：entities 的 model 配置保存模型名称、baseUrl、model标识、加密apiKey、enabled/isDefault；agent配置保存职责提示词、可选modelId；conversations 保存本人会话消息；runs 保存目标、状态、steps与结果；usage_logs 保存模型、耗时、状态及可得用量。密钥字段不进入普通接口或后台配置读取响应。',
'商业实体：':'商业数据：entities 中的 plugin 保存价格/启用状态/agentId，plan 保存会员价格/天数/增加额度；installs 为 user_id+plugin_id 唯一关系；users 保存会员身份和到期；orders 保存整数分金额、商品权益快照、状态、payment_method和provider_ref；settings保存支付及APK配置。APK产物元数据存 build.json。发放权益在数据库事务中锁定订单，重复通知不重复授予。',
'时间在数据库统一存':'时间约定：一期数据库连接及业务时间按北京时间（Asia/Shanghai，UTC+08:00）处理，日打卡使用此时区日期键；前端展示与输入需遵守相同约定，避免将无时区 SQL 字符串默认为其他时区。订单金额以整数分保存，前端显示人民币元；生活记账采用经校验的安全金额口径。后续迁移 UTC 时需一并迁移数据和接口，不混用无标记时间。',
'身份接口：':'接口形态：一期采用统一 RPC。GET /api/app?resource=bootstrap 返回公开配置及当前用户数据；resource=health 检查服务和数据库；resource=run&id=...、conversation&id=...、export、admin 分别提供本人运行、会话、导出与管理员数据。POST /api/app 的 JSON 包含 action，由服务端分发动作；浏览器通过 HttpOnly Cookie 认证。不存在本文旧示例中的 /api/auth/* 或 /api/admin/* 独立 REST 路由。',
'用户业务：':'身份与记录动作：POST /api/app action=auth.register、auth.login、auth.logout、profile.update；record.save 使用 kind、id（更新时）、title、content、status、meta，record.delete 使用 id。所有集合和单条操作均由当前会话限定本人；客户端不能自设角色、owner或支付状态。',
'AI：POST':'AI 动作：POST /api/app action=ai.chat（message、agentId、可选conversationId）发起助手；ai.run（goal、agentIds）创建后台协作任务并返回runId；run.save（id）将完成结果保存为知识笔记。GET resource=run&id=...轮询queued/running/completed/partial/failed及阶段；GET resource=conversation&id=...恢复本人会话。',
'商业：GET':'商业动作：POST /api/app action=plugin.install、plugin.uninstall、plugin.run；order.create 携带 type=membership/plugin、productId、paymentMethod=manual/epay/stripe，金额由服务端取价；order.cancel 取消本人待支付订单。插件、套餐、订单和安装关系通过bootstrap读取。GET/POST /api/payments/notify?provider=epay 或 POST provider=stripe 接收对应支付回调。',
'后台：/api':'后台动作：GET /api/app?resource=admin 获取管理数据；POST /api/app action=admin.save（entity=model/agent/plugin/plan/settings/user，data为配置）、admin.model.test（id）、admin.order.approve（id，仅线下收款订单）、admin.apk.build（config）。APK下载使用GET /api/download?file=合法文件名，所有后台动作校验管理员角色。',
'错误约定：':'错误约定：400 输入无效，401 未登录，402 余额或购买权益不足，403 无权限/来源不允许，404 资源不存在，429 频率限制，502/503 上游失败或未配置。模型超时返回明确错误；客户端展示失败并允许重试。支付订单权益发放需幂等；客户端防重复点击之外，服务端仍独立保证事务安全。',
'后续优先级按真实反馈排序：':'后续优先级按真实反馈排序：附件与向量知识检索、可执行AI工具、通知与日历同步、协作共享、插件开发者SDK、退款对账、离线原生移动体验、后台温度/输出上限参数、自动续费。功能清单中P2项不计入一期已完成率。'
}
lines=source.splitlines();changes=[]
for i,line in enumerate(lines):
 for prefix,replacement in replacements.items():
  if line.startswith("'"+prefix):
   old=ast.literal_eval(line.rstrip(',)')) if line.endswith(',') else ast.literal_eval(line[:-1])
   # preserve the sec(...) final closing parenthesis
   ending=',' if line.endswith(',') else ')'
   lines[i]=repr(replacement)+ending
   changes.append({'old':old,'new':replacement});break
assert len(changes)==len(replacements),(len(changes),len(replacements))
source='\n'.join(lines)+'\n'
# Specific feature descriptions keep IDs/count/status columns unchanged.
feature_changes={
"('学习计划','创建计划','记录目标周期与投入时间','持久化并在列表可见')":"('学习计划','创建目标式计划','以goal记录学习周期和每天分钟数','目标周期与时间预算持久化')",
"('学习计划','更新进度','记录计划完成进度','范围限制 0–100')":"('学习计划','目标进度与关联任务','更新goal进度并通过task.goalId关联任务','进度0–100且任务属于本人目标')",
"('学习计划','编辑删除','维护本人的学习计划','其他用户不可操作')":"('学习计划','编辑删除目标式计划','维护goal与本人关联task记录','不冒充独立plan实体且不能越权')",
"('会员','会员状态','展示套餐到期与权益','以服务端有效期计算')":"('会员','会员状态与AI余额','分别展示身份有效期与剩余额度','身份到期降为免费，已购额度保留')",
"('会员','订购套餐','创建套餐订单','金额从服务端取价')":"('会员','订购套餐','按次购买增加额度并延长身份有效期','服务端取价且不自动续费或重置余额')",
"('会员','权益到期','过期恢复普通权益','历史业务数据仍可访问')":"('会员','身份到期','会员到期恢复免费身份','历史数据及已购AI余额不因到期删除')",
"('插件','付费安装校验','凭有效权益安装付费插件','改客户端状态不能绕过')":"('插件','付费安装校验','新安装收费插件校验已支付购买记录','改客户端状态不能绕过；既有免费安装保留')",
"('插件','卸载插件','删除安装关系','他人安装不受影响')":"('插件','卸载与重装','卸载移除安装关系但保留业务记录','有购买记录可重装；无购买记录按现价')",
"('插件管理','插件定价','设置免费或付费金额','负价拒绝且历史订单不变')":"('插件管理','插件定价','设置免费或付费金额','旧订单不变；免费转付费保留既有安装')",
"('模型管理','默认模型','设置 AI 使用的默认模型','下一次调用使用该配置')":"('模型管理','默认模型','设置未显式绑定模型的Agent所用默认值','跟随默认的Agent下次调用使用新配置')",
"('安卓下载','移动说明','说明 WebView 与联网要求','不冒充离线原生 App')":"('安卓下载','移动说明','说明WebView联网形态及Android6+要求','下载页不冒充离线原生App')",
}
for old,new in feature_changes.items():
 assert old in source,old
 source=source.replace(old,new,1)
p.write_text(source)
(B/'范围修订段落.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2))
(B/'功能表修订前本地.json').write_text(json.dumps(old_features,ensure_ascii=False))
print('paragraph_changes',len(changes),'feature_changes',len(feature_changes))
