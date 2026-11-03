'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronRight, ExternalLink, Eye, EyeOff, LayoutGrid, Loader2, LockKeyhole, LogOut, Save, ShieldCheck, Sprout, UserRound, X } from 'lucide-react';
import AdminSections, { ADMIN_TABS } from './AdminSections';
import { Button, Field, cx } from './PortalUI';

const SECTIONS = [...ADMIN_TABS, ['account', '后台账户', UserRound]];
const GROUPS = [
  ['平台运营', ['overview', 'users']],
  ['AI 能力', ['models', 'media', 'agents', 'runs', 'usage']],
  ['商品与支付', ['plugins', 'plans', 'orders', 'payment']],
  ['站点与发布', ['apk', 'settings', 'audit']],
];
const DESCRIPTIONS = {
  overview: '了解平台运行情况，处理经营与服务配置。', users: '管理平台用户、权限与账户状态。',
  models: '配置模型服务，检查连接与真实响应。', media: '管理语音、图片和录音服务的模型与开关。',
  agents: '维护专业角色，让每一位 AI 助手各司其职。', runs: '查看协作进度、执行成果与失败原因。',
  usage: '查看真实调用的用量、耗时与结果。', plugins: '维护插件目录、销售价格与使用权限。',
  plans: '配置会员价格、有效期限与权益。', orders: '核对订单、支付状态与权益发放。',
  payment: '设置在线收款渠道与线下付款说明。', apk: '配置、构建与发布安卓客户端。',
  settings: '维护站点名称、公告与支持信息。', audit: '追溯账户、支付与配置的操作记录。',
  account: '管理当前后台账户的名称和登录密码。',
};
const sectionHref = section => section === 'overview' ? '/admin' : `/admin?section=${encodeURIComponent(section)}`;
const validSection = value => SECTIONS.some(([id]) => id === value) ? value : 'overview';
export function safeAdminNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/admin') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/admin';
  try {
    const url = new URL(value, 'https://portal.invalid');
    if (url.origin !== 'https://portal.invalid' || !['/admin', '/admin/'].includes(url.pathname)) return '/admin';
    return sectionHref(validSection(url.searchParams.get('section')));
  } catch { return '/admin'; }
}
async function adminAPI(payload, resource, signal) {
  const response = await fetch(resource ? `/api/admin?${new URLSearchParams(resource)}` : '/api/admin', payload
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload), signal }
    : { cache: 'no-store', credentials: 'same-origin', signal });
  let result;
  try { result = await response.json(); } catch { throw new Error('管理服务暂时无法连接，请稍后重试。'); }
  if (!response.ok || result.error) { const error = new Error(result.error || '请求未成功，请重试。'); error.status = response.status; throw error; }
  return result;
}

export default function AdminPortal({ loginPage = false }) {
  const [user, setUser] = useState(null), [settings, setSettings] = useState({});
  const [section, setSection] = useState('overview'), [drawer, setDrawer] = useState(false);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0);
  const [toast, setToast] = useState(null), [logoutBusy, setLogoutBusy] = useState(false);
  const toastTimer = useRef(null);
  const notify = useCallback((message, type = 'success') => { setToast({ message, type }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 5000); }, []);
  const endSession = useCallback(() => {
    setUser(null); setDrawer(false); setToast(null);
    const next = safeAdminNext(`${window.location.pathname}${window.location.search}`);
    window.location.replace(`/admin/login?next=${encodeURIComponent(next)}&reason=expired`);
  }, []);
  const request = useCallback(async (payload, resource) => {
    try { return await adminAPI(payload, resource); }
    catch (error) { if ([401, 403].includes(error.status)) endSession(); throw error; }
  }, [endSession]);
  const perform = useCallback(async (payload, message) => {
    try { const result = await request(payload); if (message) notify(message); return result; }
    catch (error) { if (![401, 403].includes(error.status)) notify(error.message, 'error'); throw error; }
  }, [request, notify]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    adminAPI(null, { resource: 'bootstrap' }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setSettings(result.settings || {});
      if (result.user?.role === 'admin') {
        if (loginPage) {
          const next = safeAdminNext(new URLSearchParams(window.location.search).get('next'));
          window.location.replace(next); return;
        }
        setUser(result.user);
      } else if (!loginPage) { endSession(); return; }
      setLoading(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if ([401, 403].includes(error.status)) { if (!loginPage) { endSession(); return; } setUser(null); }
      else setLoadError(error.message);
      setLoading(false);
    });
    return () => controller.abort();
  }, [loginPage, retry, endSession]);
  useEffect(() => {
    if (loginPage || !user) return;
    let pending = false, stopped = false;
    const verify = async () => {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const result = await request(null, { resource: 'bootstrap' });
        if (stopped) return;
        if (result.user?.role !== 'admin') { endSession(); return; }
        setUser(result.user); setSettings(result.settings || {});
      } catch { /* Auth failures redirect in request; a network interruption keeps a retryable screen. */ }
      finally { pending = false; }
    };
    window.addEventListener('focus', verify); document.addEventListener('visibilitychange', verify);
    return () => { stopped = true; window.removeEventListener('focus', verify); document.removeEventListener('visibilitychange', verify); };
  }, [loginPage, user?.id, request, endSession]);
  useEffect(() => {
    const sync = () => { setSection(validSection(new URLSearchParams(window.location.search).get('section'))); setDrawer(false); };
    sync(); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('popstate', sync); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = event => { if (event.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = original; window.removeEventListener('keydown', onKey); };
  }, [drawer]);
  const navigate = useCallback(next => {
    const value = validSection(next); setSection(value); setDrawer(false);
    window.history.pushState({}, '', sectionHref(value)); window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  async function logout() {
    setLogoutBusy(true);
    try { await request({ action: 'auth.logout' }); setUser(null); window.location.replace('/admin/login'); }
    catch (error) { if (![401, 403].includes(error.status)) notify(error.message, 'error'); }
    finally { setLogoutBusy(false); }
  }
  const siteName = settings.siteName || '知序 LifeOS';
  const active = SECTIONS.find(([id]) => id === section);
  const navigation = (mobile = false) => <>
    {GROUPS.map(([title, ids]) => <div className="admin-navigation-group" key={title}><p>{title}</p>{ids.map(id => {
      const [, label, Icon] = SECTIONS.find(([value]) => id === value);
      return <a key={id} href={sectionHref(id)} data-section={id} aria-current={section === id ? 'page' : undefined} className={cx('admin-nav-link', section === id && 'active')} onClick={event => { event.preventDefault(); navigate(id); }}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{section === id && <ChevronRight size={14} />}</a>;
    })}</div>)}
    <a className={cx('admin-nav-link admin-account-link', section === 'account' && 'active')} href="/admin?section=account" data-section="account" aria-current={section === 'account' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('account'); }}><UserRound size={18} /><span>后台账户</span></a>
    {mobile && <button className="admin-nav-link admin-drawer-logout" onClick={logout} disabled={logoutBusy}><LogOut size={18} /><span>退出后台</span></button>}
  </>;
  if (loading) return <div className="admin-shell admin-gate"><div className="admin-gate-card"><ShieldCheck size={28} /><Loader2 className="spin" size={22} /><p>正在确认后台登录状态…</p></div></div>;
  if (loadError) return <div className="admin-shell admin-gate"><div className="admin-gate-card"><ShieldCheck size={30} /><h1>暂时无法打开管理后台</h1><p role="alert">{loadError}</p><Button onClick={() => setRetry(value => value + 1)}>重新连接</Button></div></div>;
  if (loginPage) return <AdminLogin siteName={siteName} supportContact={settings.supportContact} />;
  if (!user) return <div className="admin-shell admin-gate"><p>正在前往后台登录…</p></div>;
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/admin" onClick={event => { event.preventDefault(); navigate('overview'); }}><span><Sprout size={25} /></span><strong>{siteName}<small>管理后台</small></strong></a>
      <nav aria-label="后台导航">{navigation()}</nav>
      <a className="admin-public-link" href="/" target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />访问前台<ArrowUpRight size={14} /></a>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div className="admin-topbar-title"><ShieldCheck size={19} /><span>管理后台</span><ChevronRight size={14} /><strong>{active[1]}</strong></div><div className="admin-topbar-actions"><button className="admin-topbar-account" onClick={() => navigate('account')} aria-label="打开后台账户"><span>{user.name?.slice(0, 1) || '管'}</span><strong>{user.name}</strong></button><button className="admin-logout" onClick={logout} disabled={logoutBusy}>{logoutBusy ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />}<span>退出后台</span></button></div></header>
      <main className="admin-content" id="admin-content"><div className="admin-page-heading"><h1>{active[1] === '概览' ? '平台概览' : active[1]}</h1><p>{DESCRIPTIONS[section]}</p></div>{section === 'account'
        ? <AdminAccount key={user.id} user={user} perform={perform} onUpdate={setUser} />
        : <AdminSections key={user.id} tab={section} setTab={navigate} perform={perform} request={request} notify={notify} />}</main>
      <footer className="admin-footer"><ShieldCheck size={14} /><span>{siteName} 管理后台</span><span>仅限授权管理员访问</span></footer>
    </div>
    <nav className="admin-mobile-nav" aria-label="后台移动导航">{['overview', 'users', 'models', 'orders'].map(id => {
      const [, label, Icon] = SECTIONS.find(([value]) => value === id);
      return <a key={id} href={sectionHref(id)} data-section={id} aria-current={section === id ? 'page' : undefined} className={section === id ? 'active' : ''} onClick={event => { event.preventDefault(); navigate(id); }}><Icon size={21} /><span>{{ overview: '概览', users: '用户', models: '模型', orders: '订单' }[id] || label}</span></a>;
    })}<button className={!['overview', 'users', 'models', 'orders'].includes(section) || drawer ? 'active' : ''} aria-label="打开全部后台功能" aria-expanded={drawer} onClick={() => setDrawer(true)}><LayoutGrid size={21} /><span>更多</span></button></nav>
    {drawer && <div className="admin-drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && setDrawer(false)}><section className="admin-mobile-drawer" role="dialog" aria-modal="true" aria-label="全部后台功能"><header><div><ShieldCheck size={20} /><h2>全部后台功能</h2></div><button aria-label="关闭后台菜单" onClick={() => setDrawer(false)} autoFocus><X size={22} /></button></header><nav aria-label="后台全部导航">{navigation(true)}</nav></section></div>}
    {toast && <div className={cx('admin-toast', toast.type === 'error' && 'error')} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type !== 'error' && <CheckCircle2 size={17} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button></div>}
  </div>;
}

function AdminLogin({ siteName, supportContact }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [showPassword, setShowPassword] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => { setExpired(new URLSearchParams(window.location.search).get('reason') === 'expired'); }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await adminAPI({ action: 'auth.login', ...values }); window.location.replace(safeAdminNext(new URLSearchParams(window.location.search).get('next'))); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <div className="admin-shell admin-login-page"><div className="admin-login-layout">
    <aside className="admin-login-intro"><a className="admin-brand" href="/" target="_blank" rel="noopener noreferrer"><span><Sprout size={27} /></span><strong>{siteName}<small>管理后台</small></strong></a><div className="admin-login-statement"><ShieldCheck size={40} strokeWidth={1.25} /><h1>让每一项服务<br />有序运行。</h1><p>用户与经营、AI 能力与应用发布，<br />在专属管理空间集中处理。</p></div><div className="admin-login-caption"><span>平台管理</span><span>知序 LifeOS</span></div></aside>
    <main className="admin-login-form-panel"><div className="admin-login-mark"><ShieldCheck size={25} /></div><h2>登录管理后台</h2><p className="admin-login-description">使用管理员账户继续</p>{expired && <p className="admin-login-notice">请登录管理员账户后继续。</p>}<form onSubmit={submit}><Field label="管理员邮箱"><input name="email" type="email" autoComplete="username" placeholder="输入管理员邮箱" required autoFocus /></Field><Field label="登录密码"><div className="admin-password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="输入登录密码" required /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></Field>{error && <div className="form-error" role="alert">{error}</div>}<Button type="submit" className="admin-login-submit" loading={busy} icon={LockKeyhole}>登录管理后台</Button></form><details className="admin-login-help"><summary>无法登录？</summary><p>此入口仅向管理员开放。忘记密码或权限异常时，请联系平台负责人协助处理。</p>{supportContact && <p>{supportContact}</p>}</details><a className="admin-login-public" href="/" target="_blank" rel="noopener noreferrer">访问前台<ExternalLink size={14} /></a><p className="admin-login-footnote">独立后台登录 · 仅限授权人员</p></main>
  </div></div>;
}

function AdminAccount({ user, perform, onUpdate }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (values.password && !values.currentPassword) { setError('修改密码需要填写当前密码。'); setBusy(false); return; }
    try { const result = await perform({ action: 'profile.update', ...values }, values.password ? '后台账户已更新，密码已修改' : '后台账户已更新'); onUpdate(result.user || { ...user, name: values.name }); form.elements.currentPassword.value = ''; form.elements.password.value = ''; }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="panel admin-account-panel"><div className="admin-account-identity"><span><ShieldCheck size={27} /></span><div><h2>{user.name}</h2><p>{user.email}</p><small>管理员</small></div></div><form onSubmit={submit}><Field label="管理员名称"><input name="name" required minLength={2} maxLength={80} defaultValue={user.name} /></Field><Field label="登录邮箱"><input disabled value={user.email || ''} /></Field><div className="admin-account-password-heading"><h3>修改登录密码</h3><p>留空保留当前密码。修改后，其他已登录设备需要重新登录。</p></div><Field label="当前密码"><input name="currentPassword" type="password" autoComplete="current-password" placeholder="输入当前密码" /></Field><Field label="新密码"><input name="password" type="password" minLength={8} autoComplete="new-password" placeholder="至少 8 位" /></Field>{error && <div className="form-error" role="alert">{error}</div>}<Button type="submit" loading={busy} icon={Save}>保存后台账户</Button></form></section>;
}
