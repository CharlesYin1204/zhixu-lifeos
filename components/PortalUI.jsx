'use client';
import { useEffect } from 'react';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Bell,
  BookMarked, BookOpen, Bot, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, Circle, Clock3, Compass, CreditCard, Crown, Download,
  ExternalLink, FileText, Flame, FolderOpen, GraduationCap, Heart, HelpCircle,
  Home, LayoutDashboard, Leaf, ListChecks, Loader2, LogOut, Menu, MessageCircle,
  MoreHorizontal, Plus, Puzzle, Search, Send, Settings, ShieldCheck, Smartphone,
  Sparkles, Sprout, Target, Trash2, TrendingUp, User, Users, Wallet, Wand2,
  Workflow, X, Zap, Pencil, KeyRound, LockKeyhole, AlertCircle, Rocket, Play,
  RefreshCw, Server, Receipt, Terminal, SlidersHorizontal, Save, Mail, Eye, EyeOff, Pause, Timer, Languages, Briefcase, Utensils, Coffee, ScanLine, Mic, Camera, AudioLines
} from 'lucide-react';
export const ICONS = { book: BookOpen, brain: Sparkles, sparkles: Sparkles, heart: Heart, leaf: Leaf, wallet: Wallet, code: Terminal, target: Target, graduation: GraduationCap, calendar: CalendarDays, bot: Bot, search: Search, fitness: Activity, finance: Wallet, writing: Pencil, health: Heart, learning: BookOpen, life: Leaf, knowledge: BookMarked, planner: CalendarDays, research: Search, coach: Target, tutor: GraduationCap, nutrition: Heart, study: BookOpen, bookopen: BookOpen, bookmarked: BookMarked, calendardays: CalendarDays, graduationcap: GraduationCap, sprout: Sprout, timer: Timer, languages: Languages, briefcase: Briefcase, utensils: Utensils, chartnoaxescombined: BarChart3, heartpulse: Heart, listchecks: ListChecks, workflow: Workflow, lightbulb: Sparkles, activity: Activity, braincircuit: Bot, compass: Compass, coffee: Coffee, scanline: ScanLine };
export const KINDS = { task: ['学习任务', ListChecks], goal: ['学习目标', Target], course: ['课程管理', GraduationCap], focus: ['专注记录', Clock3], review: ['复习笔记', RefreshCw], habit: ['习惯打卡', Flame], expense: ['收支账本', Wallet], health: ['健康记录', Activity], event: ['日程安排', CalendarDays], note: ['知识笔记', FileText] };
export const currency = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const fmtDate = (d, time = false) => d ? new Date(d).toLocaleString('zh-CN', time ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
export const statusName = s => ({ pending: '待处理', queued: '排队中', partial: '部分完成', not_built: '尚未构建', success: '已完成', paid: '已支付', completed: '已完成', running: '进行中', failed: '失败', cancelled: '已取消', done: '已完成', active: '进行中', waiting: '等待中', building: '构建中', ready: '已就绪' }[s] || s || '待开始');
export const fileSize = n => Number(n) >= 1048576 ? `${(Number(n)/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(Number(n||0)/1024))} KB`;
export const cx = (...a) => a.filter(Boolean).join(' ');
export const resolveIcon = name => ICONS[String(name || '').toLowerCase()] || Sparkles;
export function Button({ children, className = '', variant = 'primary', loading, icon: Icon, ...props }) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...props} disabled={props.disabled || loading}>{loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}{children}</button>;
}
export function IconButton({ icon: Icon, label, ...props }) { return <button className="icon-button" aria-label={label} title={label} {...props}><Icon size={18} /></button>; }
export function Avatar({ icon, color, size = '', children }) { const Icon = resolveIcon(icon); const custom=/^#[0-9a-f]{6}$/i.test(color||''); return <span className={cx('avatar', custom ? '' : color || 'green', size)} style={custom?{color,backgroundColor:`${color}18`}:undefined}>{children || <Icon size={size === 'large' ? 25 : 20} />}</span>; }
export function Badge({ children, color = 'green' }) { return <span className={cx('badge', color)}>{children}</span>; }
export function Empty({ icon: Icon = FolderOpen, title, text, action, actionLabel = '立即添加' }) { return <div className="empty-state"><div className="empty-icon"><Icon size={27} strokeWidth={1.6} /></div><h3>{title}</h3>{text && <p>{text}</p>}{action && <Button variant="secondary" icon={Plus} onClick={action}>{actionLabel}</Button>}</div>; }
export function Field({ label, hint, children }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function TextContent({ children }) { return <div className="text-content">{String(children || '').split('\n').map((line, i) => line.startsWith('### ') ? <h4 key={i}>{line.slice(4)}</h4> : line.startsWith('## ') ? <h3 key={i}>{line.slice(3)}</h3> : line.startsWith('# ') ? <h3 key={i}>{line.slice(2)}</h3> : <p key={i}>{line.replace(/\*\*(.*?)\*\*/g, '$1') || '\u00a0'}</p>)}</div>; }
export function SourceList({ sources, onOpen }) {
  const items = Array.isArray(sources) ? sources.filter((source, index, all) => source && typeof source.id === 'string' && typeof source.title === 'string' && all.findIndex(item => item?.id === source.id) === index) : [];
  if (!items.length) return null;
  return <details className="ai-sources"><summary><BookMarked size={14}/><span>本次参考资料</span><small>{items.length} 条</small><ChevronDown size={14}/></summary><p>提供给 AI 的个人资料，回答仍需核对。</p><ul>{items.map(source => {
    const deleted = source.deleted === true || source.availability === 'deleted';
    const label = deleted ? '附件已删除' : KINDS[source.kind]?.[0] || source.label || '个人记录';
    return <li key={source.id}>{onOpen && !deleted ? <button type="button" onClick={()=>onOpen(source)}><FileText size={14}/><span>{source.title}</span><small>{label}</small><ArrowUpRight size={13}/></button> : <span className="source-readonly"><FileText size={14}/><span>{source.title}</span><small>{label}</small></span>}</li>;
  })}</ul></details>;
}
export function Modal({ title, subtitle, children, onClose, wide }) {
  useEffect(() => { const handler = e => e.key === 'Escape' && onClose(); document.addEventListener('keydown', handler); const original = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = original; }; }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className={cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭" onClick={onClose} /></header>{children}</section></div>;
}
export function SectionHeader({ title, description, action, onAction, children }) { return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children || (action && <button className="text-link" onClick={onAction}>{action}<ChevronRight size={15} /></button>)}</div>; }
