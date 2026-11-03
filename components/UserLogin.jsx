'use client';

import { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, Eye, EyeOff, Heart, HelpCircle, LockKeyhole, Mail, ShieldCheck, Sparkles, Sprout } from 'lucide-react';
import { Button, Field, Modal, TextContent } from './PortalUI';
import '../app/auth.css';

export default function UserLogin({ siteName = '知序 LifeOS', supportContact = '', initialRegister = false }) {
  const [register, setRegister] = useState(initialRegister);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [show, setShow] = useState(false), [help, setHelp] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: register ? 'auth.register' : 'auth.login', ...fields }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '登录未成功，请重试。');
      window.location.assign('/user');
    } catch (failure) { setError(failure instanceof SyntaxError ? '服务暂时无法连接，请稍后重试。' : failure.message); setBusy(false); }
  }
  function switchMode(next) {
    setRegister(next); setError('');
    window.history.replaceState({}, '', next ? '/login?mode=register' : '/login');
  }
  return <div className="public-login">
    <header className="public-auth-header"><a className="public-auth-brand" href="/"><Sprout size={25} /><strong>{siteName}</strong></a><a href="/"><ArrowLeft size={15} />返回首页</a></header>
    <main className="public-auth-main"><div className="auth-layout">
      <aside className="auth-intro"><div className="auth-intro-brand"><Sprout size={25} /><span>给成长，一个自己的空间</span></div><h1>一处安放计划，<br />一同照顾成长。</h1><p>从今天的小目标开始，<br />让你的 AI 团队陪你走得更远。</p><div className="public-auth-journey">
        <div><BookOpen size={23} /><span><strong>学会想学的</strong><small>计划、课程、笔记与复习，慢慢积累。</small></span></div>
        <div><Heart size={23} /><span><strong>照顾日常生活</strong><small>习惯、日程与健康，把日子安排好。</small></span></div>
        <div><Sparkles size={23} /><span><strong>随时向 AI 请教</strong><small>语音练习、拍照学习，多位助手协作。</small></span></div>
      </div><div className="auth-benefits"><span><CheckCircle2 size={16} />从免费账户开始</span><span><CheckCircle2 size={16} />记录只属于你的进步</span></div></aside>
      <section className="auth-form-wrap"><div className="auth-form-heading"><span className="auth-welcome"><Sprout size={22} /></span><h2>{register ? '开启你的成长旅程' : '欢迎回来'}</h2><p>{register ? '创建账户，开启你的个人学习与生活空间。' : '登录后，进入你的个人用户中心。'}</p></div>
        <div className="auth-tabs" aria-label="登录方式"><button type="button" className={!register ? 'active' : ''} onClick={() => switchMode(false)}>登录</button><button type="button" className={register ? 'active' : ''} onClick={() => switchMode(true)}>注册账户</button></div>
        <form onSubmit={submit}>{register && <Field label="你的称呼"><input name="name" autoComplete="name" required minLength={2} maxLength={30} placeholder="希望我们怎么称呼你" /></Field>}
          <Field label="邮箱地址"><div className="input-with-icon"><Mail size={17} /><input name="email" type="email" autoComplete="username" required placeholder="you@example.com" /></div></Field>
          <Field label="密码" hint={register ? '至少 8 位，建议包含字母与数字。' : undefined}><div className="input-with-icon"><LockKeyhole size={17} /><input name="password" type={show ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} placeholder={register ? '设置一个安全的密码' : '输入你的密码'} /><button type="button" onClick={() => setShow(value => !value)} aria-label={show ? '隐藏密码' : '显示密码'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>
          {error && <div className="form-error" role="alert"><AlertCircle size={15} />{error}</div>}
          <Button className="full-width auth-submit" loading={busy} type="submit">{register ? '创建我的账户' : '登录用户中心'}<ArrowRight size={16} /></Button>
        </form>
        {!register && <details className="auth-help"><summary>忘记密码？</summary><p>暂未开通邮件自助找回，请联系平台管理员协助处理。</p><button type="button" className="text-link" onClick={() => setHelp(true)}>查看联系帮助<ArrowUpRight size={14} /></button></details>}
        <p className="auth-note"><ShieldCheck size={14} />个人记录保存在你的专属账户中</p>
        <a className="auth-admin-link" href="/admin/login"><ShieldCheck size={14} />管理员登录</a>
      </section>
    </div></main>
    <footer className="public-auth-footer">{siteName}，让学习与生活有序生长。</footer>
    {help && <Modal title="联系平台支持" onClose={() => setHelp(false)}><div className="support-content"><HelpCircle size={25} /><TextContent>{supportContact || '管理员尚未配置联系方式。请通过您获取本站地址时的联系渠道，向平台管理员说明注册邮箱及账户问题；请勿发送密码。'}</TextContent></div></Modal>}
  </div>;
}
