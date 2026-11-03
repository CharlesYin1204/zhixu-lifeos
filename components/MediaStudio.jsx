'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MediaAnswer from './MediaAnswer';
import {
  ArrowUpRight, AudioLines, BookOpen, Camera, Check, CheckCircle2, ChevronDown,
  Clock3, FileAudio, FileText, GraduationCap, Headphones, History, ImagePlus,
  Languages, Loader2, Mic, MicOff, Pause, Phone, PhoneOff, Play, Plus,
  RefreshCw, Send, ShieldCheck, Sparkles, Square, Trash2, Upload, X,
  AlertCircle, Utensils, BarChart3, Briefcase, MapPin, Presentation,
} from 'lucide-react';

const DEFAULT_SCENES = [
  { id: 'english-free', name: '英语自由对话', description: '从日常话题开始，练习自然表达。', mode: 'voice', category: '语言', icon: 'languages' },
  { id: 'travel-talk', name: '旅行口语', description: '入住、点餐、问路，提前练一遍。', mode: 'voice', category: '语言', icon: 'travel' },
  { id: 'interview', name: '模拟面试', description: '说明岗位与经历，练习回答和追问。', mode: 'voice', category: '成长', icon: 'briefcase' },
  { id: 'study-qa', name: '学习问答', description: '说出卡住的知识点，一起梳理。', mode: 'voice', category: '学习', icon: 'book' },
  { id: 'speech-practice', name: '演讲练习', description: '练习开场、结构和表达节奏。', mode: 'voice', category: '成长', icon: 'presentation' },
  { id: 'homework', name: '拍题讲解', description: '拍下题目，梳理解题步骤与知识点。', mode: 'image', category: '学习', icon: 'graduation' },
  { id: 'essay-review', name: '作文批改', description: '从结构、用词到表达，逐步修改。', mode: 'image', category: '学习', icon: 'file' },
  { id: 'notes-organize', name: '笔记整理', description: '把手写笔记整理成清楚的要点。', mode: 'image', category: '学习', icon: 'book' },
  { id: 'chart-explain', name: '图表解读', description: '看懂图表中的趋势与关键数字。', mode: 'image', category: '学习', icon: 'chart' },
  { id: 'object-identify', name: '物品识别', description: '认识照片中的物品，了解使用方法。', mode: 'image', category: '生活', icon: 'camera' },
  { id: 'meal-log', name: '饮食记录', description: '描述这一餐，整理饮食记录与建议。', mode: 'image', category: '生活', icon: 'meal' },
  { id: 'class-notes', name: '课堂记录', description: '录下已获许可的课堂内容，转成文字。', mode: 'recording', category: '学习', icon: 'graduation' },
  { id: 'spoken-review', name: '复习口述', description: '把学到的内容说一遍，留下复习笔记。', mode: 'recording', category: '学习', icon: 'book' },
];
const MODES = [
  { id: 'voice', name: '实时语音', icon: Headphones, description: '说出来，一起想清楚。' },
  { id: 'image', name: '图片助手', icon: ImagePlus, description: '拍下来，看见新的思路。' },
  { id: 'recording', name: '录音转写', icon: FileAudio, description: '把声音，变成可回看的笔记。' },
];
const ICONS = { languages: Languages, travel: MapPin, briefcase: Briefcase, presentation: Presentation, book: BookOpen, graduation: GraduationCap, file: FileText, chart: BarChart3, camera: Camera, meal: Utensils };
const VOICE_LABELS = { idle: '准备好，就开口聊聊', connecting: '正在连接你的 AI 助手', listening: '正在聆听', thinking: '正在整理回答', speaking: 'AI 正在说话', ending: '正在保存本次对话' };
const SECURE_URL = 'https://154.40.47.111:3063/?view=media';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_QUESTIONS = {
  homework: '请逐步解释这道题，并说明用到的知识点。',
  'essay-review': '请指出这篇作文中可以改进的地方，并给出修改示例。',
  'notes-organize': '请把这页笔记整理成提纲和几个复习问题。',
  'chart-explain': '请解释图表中的主要趋势，并说明哪些结论需要更多数据。',
  'object-identify': '图中是什么物品？它一般如何使用？',
  'meal-log': '请帮我记录这餐食物，并给出搭配建议。',
};
const SOURCE_VIEWS = { note: 'knowledge', habit: 'life', health: 'life', event: 'life', expense: 'life' };
const uid = () => `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('')}`;
const durationLabel = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const sizeLabel = bytes => Number(bytes) === 0 ? '0 B' : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const dateLabel = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '';
const safeAssetUrl = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
const isDeletedAsset = asset => asset?.deleted === true || asset?.availability === 'deleted';

async function mediaApi(payload, params, signal) {
  const response = await fetch(params ? `/api/media?${new URLSearchParams(params)}` : '/api/media', payload ? {
    method: 'POST', body: payload instanceof FormData ? payload : JSON.stringify(payload),
    ...(payload instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }), signal,
  } : { cache: 'no-store', signal });
  let result;
  try { result = await response.json(); } catch { throw new Error('服务暂时无法连接，请稍后重试。'); }
  if (!response.ok || result.error) throw new Error(result.error || '操作未完成，请重试。');
  return result;
}

function permissionMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '麦克风未获授权。请在浏览器地址栏允许麦克风，再点击开始。';
  if (error?.name === 'NotFoundError') return '没有找到麦克风，请连接设备后重试。';
  if (error?.name === 'NotReadableError') return '麦克风暂时无法使用，请检查是否被其他应用占用。';
  return error?.message || '语音连接未完成，请重试。';
}

function AudioSources({ sources }) {
  const items = Array.isArray(sources) ? sources.filter(item => item && typeof item.title === 'string') : [];
  if (!items.length) return null;
  return <details className="media-sources"><summary><BookOpen size={14}/>本次参考资料 <small>{items.length} 条</small><ChevronDown size={14}/></summary><p>提供给 AI 的个人资料，回答仍需核对。</p>{items.map((item, index) => { const isAsset = ['image', 'audio'].includes(item.kind); const href = isDeletedAsset(item) ? undefined : isAsset ? safeAssetUrl(item.url) : `/?view=${SOURCE_VIEWS[item.kind] || 'learning'}&kind=${encodeURIComponent(item.kind || 'note')}`; return href ? <a key={item.id || index} href={href} target={isAsset ? '_blank' : undefined} rel={isAsset ? 'noreferrer' : undefined}><FileText size={14}/><span>{item.title}</span><ArrowUpRight size={13}/></a> : <div className="media-source-unavailable" key={item.id || index}><FileText size={14}/><span>{item.title}</span><small>{isDeletedAsset(item) ? '附件已删除' : '文件暂不可用'}</small></div>; })}</details>;
}

function HistoryImage({ asset }) {
  const [failed, setFailed] = useState(false);
  const url = safeAssetUrl(asset.url);
  useEffect(() => setFailed(false), [url]);
  if (isDeletedAsset(asset) || !url || failed) return <div className="media-attachment-deleted"><ImagePlus size={20}/><span>{asset.name || '图片附件'}</span><small>{isDeletedAsset(asset) ? '附件已删除' : '附件已删除或不可用'}</small></div>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={asset.name || '本次上传的图片'} loading="lazy" onError={() => setFailed(true)}/></a>;
}

function Transcript({ messages, empty, busy, endRef }) {
  return <div className="media-transcript" aria-live="polite" aria-relevant="additions text">
    {!messages.length ? <div className="media-transcript-empty"><AudioLines size={27}/><p>{empty}</p></div> : messages.map((message, index) => <article className={`media-message ${message.role}`} key={message.id || index}>
      <span className="media-speaker">{message.role === 'user' ? '你' : message.role === 'error' ? '提示' : '知序 AI'}</span>
      <div>{Array.isArray(message.attachments) && message.attachments.some(asset => asset?.kind === 'image') && <div className="media-message-images">{message.attachments.filter(asset => asset?.kind === 'image').map((asset, position) => <HistoryImage key={asset.id || position} asset={asset}/>)}</div>}
        {message.role === 'assistant' && message.content ? <MediaAnswer>{message.content}</MediaAnswer> : <p className="media-message-text">{message.content || (message.role === 'assistant' ? '正在组织回答…' : '')}</p>}
        {message.interrupted && <small className="media-interrupted">已打断</small>}
        <AudioSources sources={message.sources}/>
      </div>
    </article>)}
    {busy && <div className="media-answer-pending"><Loader2 size={15} className="spin"/><span>正在查看图片并整理回答…</span></div>}
    <div ref={endRef}/>
  </div>;
}

export default function MediaStudio({ data, notify, refresh, requireUser, initialMode = 'voice' }) {
  const [mode, setMode] = useState(MODES.some(item => item.id === initialMode) ? initialMode : 'voice');
  const [sceneIds, setSceneIds] = useState({ voice: 'english-free', image: 'homework', recording: 'class-notes' });
  const [config, setConfig] = useState({ scenes: DEFAULT_SCENES, capabilities: {}, secureUrl: SECURE_URL });
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [secure, setSecure] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [recordStatus, setRecordStatus] = useState('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recording, setRecording] = useState(null);
  const [recordUrl, setRecordUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [savedNoteId, setSavedNoteId] = useState(null);
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetStorage, setAssetStorage] = useState(null);
  const [assetsCursor, setAssetsCursor] = useState(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState('');
  const [deletingAsset, setDeletingAsset] = useState('');

  const mounted = useRef(true);
  const voice = useRef({ generation: 0, socket: null, stream: null, context: null, processor: null, nodes: new Set(), nextAudio: 0, startedAt: 0, assistantId: null, ending: false, ready: false, bargeMs: 0, lastInterruptAt: 0, timer: null });
  const recorder = useRef({ instance: null, stream: null, chunks: [], startedAt: 0, elapsed: 0, discard: false, generation: 0 });
  const aborters = useRef(new Set());
  const imagesRef = useRef(images);
  const removedImageIds = useRef(new Set());
  const previousInitialMode = useRef(initialMode);
  const pendingInitialMode = useRef(null);
  const mutedRef = useRef(false);
  const lastMeterUpdate = useRef(0);
  const filesInput = useRef(null);
  const cameraInput = useRef(null);
  const audioInput = useRef(null);
  const transcriptEnd = useRef(null);
  const currentConversationId = useRef(conversationId);
  imagesRef.current = images;
  currentConversationId.current = conversationId;

  const loadConfig = useCallback(async () => {
    setConfigLoading(true); setConfigError('');
    try {
      const result = await mediaApi(null, { resource: 'config' });
      if (!mounted.current) return;
      const scenes = Array.isArray(result.scenes) && result.scenes.length ? result.scenes : DEFAULT_SCENES;
      setConfig({ ...result, scenes, capabilities: result.capabilities || {}, secureUrl: result.secureUrl || SECURE_URL });
      setSceneIds(current => Object.fromEntries(MODES.map(item => [item.id, scenes.find(scene => scene.id === current[item.id] && scene.mode === item.id)?.id || scenes.find(scene => scene.mode === item.id)?.id || current[item.id]])));
    } catch (failure) { if (mounted.current) setConfigError(failure.message); }
    finally { if (mounted.current) setConfigLoading(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!data.user) { setHistory([]); return; }
    setHistoryLoading(true); setHistoryError('');
    try { const result = await mediaApi(null, { resource: 'history' }); if (mounted.current) setHistory(Array.isArray(result.sessions) ? result.sessions : []); }
    catch (failure) { if (mounted.current) setHistoryError(failure.message); }
    finally { if (mounted.current) setHistoryLoading(false); }
  }, [data.user?.id]);

  async function loadAssets(more = false) {
    if (!data.user || assetsLoading) return;
    setAssetsLoading(true); setAssetsError('');
    try {
      const result = await mediaApi(null, { resource: 'assets', cursor: more ? assetsCursor || '0' : '0' });
      if (!mounted.current) return;
      const next = Array.isArray(result.assets) ? result.assets : [];
      setAssets(items => more ? [...items, ...next.filter(asset => !items.some(item => item.id === asset.id))] : next);
      setAssetStorage(result.storage || null); setAssetsCursor(result.nextCursor ?? null);
    } catch (failure) { if (mounted.current) setAssetsError(failure.message); }
    finally { if (mounted.current) setAssetsLoading(false); }
  }

  async function deleteStoredAsset(asset) {
    if (deletingAsset) return;
    setDeletingAsset(asset.id); setAssetsError('');
    try {
      await mediaApi({ action: 'asset.delete', assetId: asset.id });
      if (!mounted.current) return;
      setImages(items => items.filter(item => { if (item.asset?.id === asset.id) { URL.revokeObjectURL(item.preview); return false; } return true; }));
      if (recording?.asset?.id === asset.id) setRecording(current => current ? { ...current, asset: null } : current);
      const markDeleted = reference => reference?.id === asset.id ? { ...reference, url: null, availability: 'deleted', deleted: true } : reference;
      setMessages(items => items.map(message => ({ ...message, ...(Array.isArray(message.attachments) ? { attachments: message.attachments.map(markDeleted) } : {}), ...(Array.isArray(message.sources) ? { sources: message.sources.map(markDeleted) } : {}) })));
      setAssets(items => items.filter(item => item.id !== asset.id));
      setAssetStorage(current => current ? { ...current, count: Math.max(0, (current.count || 0) - 1), usedBytes: Math.max(0, current.usedBytes - Number(asset.bytes ?? asset.size ?? 0)) } : current);
      const activeId = currentConversationId.current;
      if (activeId) {
        try {
          const result = await mediaApi(null, { resource: 'conversation', id: activeId });
          if (mounted.current && currentConversationId.current === activeId) setMessages(result.conversation.messages || []);
        } catch (failure) { if (mounted.current) setError(`附件已删除，历史刷新暂未完成：${failure.message}`); }
      }
      await loadAssets(); await refresh?.(); notify('附件已删除。历史文字记录仍然保留。');
    } catch (failure) { if (mounted.current) setAssetsError(failure.message); }
    finally { if (mounted.current) setDeletingAsset(''); }
  }

  function stopPlayback() {
    const current = voice.current;
    for (const node of current.nodes) { try { node.onended = null; node.stop(); node.disconnect(); } catch {} }
    current.nodes.clear(); current.nextAudio = 0;
  }

  function releaseVoiceMedia() {
    const current = voice.current;
    current.stream?.getTracks().forEach(track => track.stop()); current.stream = null;
    try { current.processor?.port.postMessage({ type: 'stop' }); current.processor?.disconnect(); } catch {}
    current.processor = null; stopPlayback();
    current.context?.close().catch(() => {}); current.context = null;
  }

  function cleanupVoice(closeSocket = true) {
    const current = voice.current;
    current.generation++; clearTimeout(current.timer); current.timer = null;
    releaseVoiceMedia();
    if (closeSocket && current.socket) { current.socket.onclose = null; current.socket.close(); }
    current.socket = null; current.ending = false; current.ready = false; current.assistantId = null;
    mutedRef.current = false;
    if (mounted.current) { setVoiceStatus('idle'); setMuted(false); setLevel(0); }
  }

  useEffect(() => {
    mounted.current = true; setSecure(window.isSecureContext); loadConfig();
    return () => {
      mounted.current = false;
      if (voice.current.socket?.readyState === WebSocket.OPEN) voice.current.socket.send(JSON.stringify({ type: 'end' }));
      cleanupVoice();
      recorder.current.generation++; recorder.current.discard = true;
      if (recorder.current.instance?.state !== 'inactive') { try { recorder.current.instance?.stop(); } catch {} }
      recorder.current.stream?.getTracks().forEach(track => track.stop());
      aborters.current.forEach(controller => controller.abort()); aborters.current.clear();
      imagesRef.current.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview); });
    };
  }, [loadConfig]);
  useEffect(() => { loadHistory(); setAssets([]); setAssetStorage(null); setAssetsCursor(null); setAssetsError(''); }, [loadHistory]);
  useEffect(() => { const panel = transcriptEnd.current?.parentElement; if (panel && (messages.length || visionBusy)) panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' }); }, [messages, visionBusy]);
  useEffect(() => () => { if (recordUrl) URL.revokeObjectURL(recordUrl); }, [recordUrl]);
  useEffect(() => {
    if (voiceStatus === 'idle') return;
    const timer = setInterval(() => { const elapsed = voice.current.startedAt ? Math.floor((Date.now() - voice.current.startedAt) / 1000) : 0; setVoiceSeconds(elapsed); if (elapsed >= 1200 && voiceStatus !== 'ending') { notify('本次语音已满 20 分钟，正在保存对话。', 'info'); endVoice(); } }, 1000);
    return () => clearInterval(timer);
  }, [voiceStatus]);
  useEffect(() => {
    if (recordStatus !== 'recording') return;
    const timer = setInterval(() => { const elapsed = Math.floor((recorder.current.elapsed + Date.now() - recorder.current.startedAt) / 1000); setRecordSeconds(elapsed); if (elapsed >= (Number(config.limits?.audioSeconds) || 180)) { stopRecording(); notify('录音已达到时长上限，已停止。请先试听，再上传转写。', 'info'); } }, 250);
    return () => clearInterval(timer);
  }, [recordStatus]);

  const scenes = config.scenes.filter(scene => scene.mode === mode);
  const selectedScene = scenes.find(scene => scene.id === sceneIds[mode]) || scenes[0];
  const voiceActive = voiceStatus !== 'idle';
  const recordingActive = ['starting', 'recording', 'paused', 'processing'].includes(recordStatus);
  const uploading = images.some(item => item.status === 'uploading');
  const busy = voiceActive || recordingActive || visionBusy || transcribeBusy || uploading;
  const imageBytes = Number(config.limits?.imageBytes) || 8 * 1024 * 1024;
  const audioBytes = Number(config.limits?.audioBytes) || 15 * 1024 * 1024;
  const audioSeconds = Number(config.limits?.audioSeconds) || 180;
  useEffect(() => { if (previousInitialMode.current !== initialMode) { previousInitialMode.current = initialMode; pendingInitialMode.current = MODES.some(item => item.id === initialMode) ? initialMode : null; } if (!busy && pendingInitialMode.current) { setMode(pendingInitialMode.current); pendingInitialMode.current = null; setError(''); setMessages([]); setConversationId(null); } }, [initialMode, busy]);

  function ensureMicrophone() {
    if (!requireUser()) return false;
    if (!window.isSecureContext) { setError('录音和语音对话需要安全连接，请从下方 HTTPS 入口打开。'); return false; }
    if (!navigator.mediaDevices?.getUserMedia) { setError('此浏览器暂不支持麦克风采集，请使用新版 Chrome、Edge 或 Safari。'); return false; }
    return true;
  }

  function playAudio(encoded, generation) {
    const current = voice.current;
    if (current.generation !== generation || !current.context || current.ending) return;
    const binary = atob(encoded); if (!binary.length || binary.length % 2) return;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const buffer = current.context.createBuffer(1, bytes.length / 2, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const node = current.context.createBufferSource(); node.buffer = buffer; node.connect(current.context.destination);
    const start = Math.max(current.context.currentTime + 0.025, current.nextAudio || 0);
    current.nextAudio = start + buffer.duration; current.nodes.add(node);
    node.onended = () => {
      current.nodes.delete(node); node.disconnect();
      if (mounted.current && current.generation === generation && !current.nodes.size && !current.ending) setVoiceStatus('listening');
    };
    node.start(start); setVoiceStatus('speaking');
  }

  async function startVoice() {
    if (voiceActive || recordingActive || !ensureMicrophone()) return;
    if (!config.capabilities.voice) { setError('实时语音暂未启用，请联系管理员配置语音服务。'); return; }
    const generation = ++voice.current.generation;
    voice.current.ending = false; voice.current.ready = false; voice.current.startedAt = 0; voice.current.assistantId = null; voice.current.bargeMs = 0; voice.current.lastInterruptAt = 0;
    setError(''); setMessages([]); setConversationId(null); setVoiceSeconds(0); setVoiceStatus('connecting');
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('此浏览器暂不支持实时音频，请更新浏览器后重试。');
      const context = new AudioContextClass({ sampleRate: 24000 }); voice.current.context = context;
      await context.resume();
      if (!mounted.current || voice.current.generation !== generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!mounted.current || voice.current.generation !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      voice.current.stream = stream;
      if (!context.audioWorklet) throw new Error('此浏览器暂不支持语音采集处理，请使用新版浏览器。');
      await context.audioWorklet.addModule('/voice-processor.js');
      if (!mounted.current || voice.current.generation !== generation) return;
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/live?scene=${encodeURIComponent(selectedScene.id)}`);
      voice.current.socket = socket;
      voice.current.timer = setTimeout(() => {
        if (voice.current.generation === generation) { setError('连接语音服务超时，请重试。'); cleanupVoice(); }
      }, 20000);
      const processor = new AudioWorkletNode(context, 'zhixu-voice-processor'); voice.current.processor = processor;
      const silence = context.createGain(); silence.gain.value = 0;
      context.createMediaStreamSource(stream).connect(processor); processor.connect(silence); silence.connect(context.destination);
      processor.port.onmessage = event => {
        if (voice.current.generation !== generation || voice.current.ending || event.data?.type !== 'audio') return;
        // Stop queued playback when the user speaks, including after the server has finished sending audio.
        if (voice.current.nodes.size && !mutedRef.current && Date.now() - voice.current.lastInterruptAt > 1200) {
          voice.current.bargeMs = Number(event.data.rms) >= 0.055 ? voice.current.bargeMs + event.data.pcm.byteLength / 48 : 0;
          if (voice.current.bargeMs >= 120) interruptVoice();
        } else voice.current.bargeMs = 0;
        if (Date.now() - lastMeterUpdate.current > 100) { setLevel(mutedRef.current ? 0 : Math.min(1, Number(event.data.rms || 0) * 9)); lastMeterUpdate.current = Date.now(); }
        if (socket.readyState !== WebSocket.OPEN || !voice.current.ready) return;
        if (socket.bufferedAmount > 1024 * 1024) { setError('网络发送较慢，语音连接已停止。请网络恢复后重新开始。'); cleanupVoice(); return; }
        const bytes = new Uint8Array(event.data.pcm);
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        socket.send(JSON.stringify({ type: 'audio.append', audio: btoa(binary) }));
      };
      socket.onmessage = event => {
        if (!mounted.current || voice.current.generation !== generation) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'ready') { clearTimeout(voice.current.timer); voice.current.ready = true; voice.current.startedAt = Date.now(); setConversationId(message.conversationId || null); setVoiceStatus('listening'); }
        else if (message.type === 'status' && ['listening', 'thinking', 'speaking'].includes(message.status) && !voice.current.ending) setVoiceStatus(message.status === 'listening' && voice.current.nodes.size ? 'speaking' : message.status);
        else if (message.type === 'user.transcript' && message.text) { voice.current.assistantId = null; setMessages(items => [...items, { id: uid(), role: 'user', content: message.text }]); }
        else if (message.type === 'assistant.transcript.delta' && typeof message.delta === 'string') {
          const replyId = voice.current.assistantId || uid(); voice.current.assistantId = replyId;
          setMessages(items => items.some(item => item.id === replyId) ? items.map(item => item.id === replyId ? { ...item, content: item.content + message.delta } : item) : [...items, { id: replyId, role: 'assistant', content: message.delta }]);
        } else if (message.type === 'assistant.audio' && message.audio) { try { playAudio(message.audio, generation); } catch { setError('这一段语音未能播放，可继续查看文字记录。'); } }
        else if (message.type === 'turn.completed') { voice.current.assistantId = null; if (!voice.current.ending && !voice.current.nodes.size) setVoiceStatus('listening'); }
        else if (message.type === 'interrupted') { stopPlayback(); voice.current.assistantId = null; if (!voice.current.ending) setVoiceStatus('listening'); }
        else if (message.type === 'session.saved') { if (message.conversationId) setConversationId(message.conversationId); if (voice.current.ending) cleanupVoice(); loadHistory(); refresh?.(); }
        else if (message.type === 'error') { setError(message.message || '语音服务暂时不可用，请重试。'); cleanupVoice(); loadHistory(); refresh?.(); }
      };
      socket.onerror = () => { if (mounted.current && voice.current.generation === generation) setError('语音连接失败，请检查网络后重试。'); };
      socket.onclose = () => {
        if (!mounted.current || voice.current.generation !== generation) return;
        const ended = voice.current.ending; cleanupVoice(false);
        if (!ended) setError('语音连接已断开。已保存的对话可在历史中查看，你可以重新开始。');
        loadHistory(); refresh?.();
      };
    } catch (failure) { if (mounted.current && voice.current.generation === generation) { setError(permissionMessage(failure)); cleanupVoice(); } }
  }

  function toggleMute() {
    const next = !mutedRef.current; mutedRef.current = next; setMuted(next);
    voice.current.stream?.getAudioTracks().forEach(track => { track.enabled = !next; });
    if (next) setLevel(0);
  }

  function interruptVoice() {
    const hadPlayback = voice.current.nodes.size > 0;
    stopPlayback(); voice.current.lastInterruptAt = Date.now(); voice.current.bargeMs = 0;
    const replyId = voice.current.assistantId;
    if (replyId || hadPlayback) setMessages(items => { const lastReplyId = replyId || items.findLast(item => item.role === 'assistant')?.id; return items.map(item => item.id === lastReplyId ? { ...item, interrupted: true } : item); });
    voice.current.assistantId = null;
    if (voice.current.socket?.readyState === WebSocket.OPEN) voice.current.socket.send(JSON.stringify({ type: 'interrupt' }));
    setVoiceStatus('listening');
  }

  function endVoice() {
    if (!voiceActive) return;
    voice.current.ending = true; setVoiceStatus('ending'); releaseVoiceMedia();
    clearTimeout(voice.current.timer);
    if (voice.current.socket?.readyState === WebSocket.OPEN) {
      voice.current.socket.send(JSON.stringify({ type: 'end' }));
      voice.current.timer = setTimeout(() => { cleanupVoice(); loadHistory(); refresh?.(); }, 2500);
    } else { cleanupVoice(); loadHistory(); }
  }

  async function uploadImages(files) {
    if (!requireUser()) return;
    const available = 4 - imagesRef.current.length;
    const incoming = Array.from(files || []);
    if (incoming.length > available) notify('每次最多添加 4 张图片。', 'info');
    const accepted = incoming.slice(0, available).filter(file => {
      if (!IMAGE_TYPES.has(file.type)) { notify(`${file.name}：请选择 JPEG、PNG 或 WebP 图片。`, 'error'); return false; }
      if (file.size > imageBytes) { notify(`${file.name}：每张图片最多 ${sizeLabel(imageBytes)}。`, 'error'); return false; }
      return true;
    }).map(file => ({ localId: uid(), name: file.name, preview: URL.createObjectURL(file), status: 'uploading', file }));
    setImages(items => [...items, ...accepted]); imagesRef.current = [...imagesRef.current, ...accepted];
    await Promise.all(accepted.map(async item => {
      const controller = new AbortController(); aborters.current.add(controller);
      try {
        const body = new FormData(); body.set('kind', 'image'); body.set('file', item.file);
        const result = await mediaApi(body, null, controller.signal);
        if (!result.asset?.id) throw new Error('上传未返回有效文件，请重新添加图片。');
        if (removedImageIds.current.has(item.localId)) { await mediaApi({ action: 'asset.delete', assetId: result.asset.id }); removedImageIds.current.delete(item.localId); return; }
        if (mounted.current) setImages(items => items.map(image => image.localId === item.localId ? { ...image, asset: result.asset, status: 'ready' } : image));
      } catch (failure) { if (mounted.current && failure.name !== 'AbortError') setImages(items => items.map(image => image.localId === item.localId ? { ...image, status: 'error', error: failure.message } : image)); }
      finally { aborters.current.delete(controller); }
    }));
  }

  async function removeImage(localId) {
    const selected = imagesRef.current.find(item => item.localId === localId);
    if (!selected || selected.status === 'deleting') return;
    if (selected.asset?.id) {
      setImages(items => items.map(item => item.localId === localId ? { ...item, status: 'deleting' } : item));
      try { await mediaApi({ action: 'asset.delete', assetId: selected.asset.id }); }
      catch (failure) { if (mounted.current) { setImages(items => items.map(item => item.localId === localId ? selected : item)); setError(`图片未能删除：${failure.message}`); } return; }
    } else if (selected.status === 'uploading') removedImageIds.current.add(localId);
    URL.revokeObjectURL(selected.preview);
    imagesRef.current = imagesRef.current.filter(item => item.localId !== localId);
    if (mounted.current) setImages(items => items.filter(item => item.localId !== localId));
  }

  function clearSelectedImages() {
    imagesRef.current.forEach(item => {
      URL.revokeObjectURL(item.preview);
      if (item.asset?.id) mediaApi({ action: 'asset.delete', assetId: item.asset.id }).catch(failure => { if (mounted.current) notify(`图片清理未完成：${failure.message}`, 'error'); });
      else if (item.status === 'uploading') removedImageIds.current.add(item.localId);
    });
    setImages([]); imagesRef.current = [];
  }

  async function analyzeImages(event) {
    event.preventDefault(); if (!requireUser() || visionBusy || uploading) return;
    const assets = images.filter(item => item.status === 'ready').map(item => item.asset);
    if (!assets.length && !conversationId) { setError('请先添加至少一张图片。'); return; }
    if (images.some(item => item.status === 'error')) { setError('请移除上传失败的图片，重新添加后再开始解析。'); return; }
    const question = prompt.trim() || IMAGE_QUESTIONS[selectedScene.id] || `请帮我完成${selectedScene.name}，说明依据和需要注意的地方。`;
    const questionId = uid(); const originalPrompt = prompt;
    setMessages(items => [...items, { id: questionId, role: 'user', content: question, attachments: assets }]);
    setError(''); setVisionBusy(true); setPrompt('');
    const controller = new AbortController(); aborters.current.add(controller);
    try {
      const result = await mediaApi({ action: 'vision', sceneId: selectedScene.id, prompt: question, assetIds: assets.map(asset => asset.id), ...(conversationId ? { conversationId } : {}) }, null, controller.signal);
      if (!mounted.current) return;
      setConversationId(result.conversationId); setMessages(items => [...items, { id: uid(), role: 'assistant', content: result.reply, sources: result.sources }]);
      imagesRef.current.forEach(item => URL.revokeObjectURL(item.preview)); setImages([]); imagesRef.current = [];
      loadHistory(); refresh?.();
    } catch (failure) { if (mounted.current && failure.name !== 'AbortError') { setError(failure.message); setPrompt(originalPrompt); setMessages(items => items.filter(item => item.id !== questionId)); } }
    finally { aborters.current.delete(controller); if (mounted.current) setVisionBusy(false); }
  }

  async function startRecording() {
    if (recordingActive || voiceActive || !ensureMicrophone()) return;
    if (typeof MediaRecorder === 'undefined') { setError('此浏览器暂不支持录音，可选择已有音频文件上传。'); return; }
    const generation = ++recorder.current.generation;
    setError(''); setRecordStatus('starting'); setRecordSeconds(0); setTranscript(''); setSavedNoteId(null); setRecording(null); setRecordUrl('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!mounted.current || generation !== recorder.current.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      recorder.current.stream = stream;
      const instance = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.current = { instance, stream, chunks: [], startedAt: Date.now(), elapsed: 0, discard: false, generation };
      instance.ondataavailable = event => { if (event.data?.size && recorder.current.generation === generation && !recorder.current.discard) recorder.current.chunks.push(event.data); };
      instance.onerror = () => { stream.getTracks().forEach(track => track.stop()); if (mounted.current) { setRecordStatus('idle'); setError('录音过程中出现错误，请重新录制。'); } };
      instance.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        if (!mounted.current || recorder.current.discard || recorder.current.generation !== generation) return;
        const type = instance.mimeType || mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recorder.current.chunks, { type });
        if (!blob.size) { setError('没有采集到录音，请检查麦克风后重试。'); setRecordStatus('idle'); return; }
        const file = new File([blob], `知序录音-${Date.now()}.${extension}`, { type });
        setRecording({ file, asset: null }); setRecordUrl(URL.createObjectURL(file)); setRecordStatus('ready');
      };
      instance.start(500); setRecordStatus('recording');
    } catch (failure) { if (mounted.current && generation === recorder.current.generation) { recorder.current.stream?.getTracks().forEach(track => track.stop()); setRecordStatus('idle'); setError(permissionMessage(failure)); } }
  }

  function pauseRecording() {
    const current = recorder.current;
    if (current.instance?.state === 'recording') { current.elapsed += Date.now() - current.startedAt; current.instance.pause(); setRecordStatus('paused'); setRecordSeconds(Math.floor(current.elapsed / 1000)); }
    else if (current.instance?.state === 'paused') { current.startedAt = Date.now(); current.instance.resume(); setRecordStatus('recording'); }
  }

  function stopRecording() {
    const current = recorder.current;
    if (current.instance?.state === 'recording') current.elapsed += Date.now() - current.startedAt;
    setRecordSeconds(Math.floor(current.elapsed / 1000));
    if (['recording', 'paused'].includes(current.instance?.state)) { setRecordStatus('processing'); current.instance.stop(); }
  }

  async function discardRecording(deleteAsset = true) {
    if (deleteAsset && recording?.asset?.id) {
      setTranscribeBusy(true);
      try { await mediaApi({ action: 'asset.delete', assetId: recording.asset.id }); }
      catch (failure) { setError(`录音文件未能删除：${failure.message}`); setTranscribeBusy(false); return false; }
      setTranscribeBusy(false);
    }
    recorder.current.discard = true; recorder.current.generation++;
    if (['recording', 'paused'].includes(recorder.current.instance?.state)) recorder.current.instance.stop();
    recorder.current.stream?.getTracks().forEach(track => track.stop());
    setRecording(null); setRecordUrl(''); setRecordStatus('idle'); setRecordSeconds(0); setTranscript(''); setSavedNoteId(null);
    return true;
  }

  async function selectAudio(file) {
    if (!file || !requireUser()) return;
    if (file.size > audioBytes) { setError(`录音文件最多 ${sizeLabel(audioBytes)}，请先裁剪后上传。`); return; }
    if (!file.type.startsWith('audio/') && !/\.(mp3|mp4|m4a|wav|webm|ogg)$/i.test(file.name)) { setError('请选择 MP3、M4A、WAV、WebM 或 Ogg 音频。'); return; }
    await discardRecording(false); setError(''); setRecording({ file, asset: null }); setRecordUrl(URL.createObjectURL(file)); setRecordStatus('ready');
  }

  async function transcribeRecording() {
    if (!recording || transcribeBusy || !requireUser()) return;
    if (recording.file.size > audioBytes) { setError(`录音文件超过 ${sizeLabel(audioBytes)}，请先裁剪后上传。`); return; }
    setError(''); setTranscribeBusy(true);
    const controller = new AbortController(); aborters.current.add(controller);
    try {
      let asset = recording.asset;
      if (!asset) {
        const body = new FormData(); body.set('kind', 'audio'); body.set('file', recording.file);
        const result = await mediaApi(body, null, controller.signal); asset = result.asset;
        if (!asset?.id) throw new Error('录音上传未完成，请重试。');
        if (mounted.current) setRecording(current => current ? { ...current, asset } : current);
      }
      const result = await mediaApi({ action: 'transcribe', assetId: asset.id, sceneId: selectedScene.id }, null, controller.signal);
      if (!mounted.current) return;
      setTranscript(result.text || ''); setSavedNoteId(result.noteId || null);
      notify(result.noteId ? '录音已转写，并保存到知识库。' : '录音转写完成。'); loadHistory(); refresh?.();
    } catch (failure) { if (mounted.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { aborters.current.delete(controller); if (mounted.current) setTranscribeBusy(false); }
  }

  async function openHistory(session) {
    if (busy) return;
    setHistoryLoading(true); setError('');
    try {
      const result = await mediaApi(null, { resource: 'conversation', id: session.id });
      if (!mounted.current) return;
      setMode(MODES.some(item => item.id === session.mode) ? session.mode : 'image');
      if (session.sceneId) setSceneIds(current => ({ ...current, [session.mode]: session.sceneId }));
      setConversationId(result.conversation.id); setMessages(Array.isArray(result.conversation.messages) ? result.conversation.messages : []);
      if (session.mode === 'recording') setTranscript((result.conversation.messages || []).map(item => item.content).filter(Boolean).join('\n\n'));
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setHistoryLoading(false); }
  }

  function changeMode(next) {
    if (busy) return;
    setMode(next); setMessages([]); setConversationId(null); setError(''); setPrompt('');
  }

  function newSession() {
    if (busy) return;
    setMessages([]); setConversationId(null); setError(''); setPrompt('');
    clearSelectedImages();
  }

  return <div className="media-studio">
    <header className="media-heading"><div><span className="media-heading-mark"><AudioLines size={16}/>感知与表达</span><h1>说一说，拍一拍。<br className="media-mobile-break"/>让想法更容易被理解。</h1><p>用声音和照片连接学习、生活与此刻的好奇。</p></div><span className="media-private-note"><ShieldCheck size={16}/>文件与对话保存在你的账户内</span></header>
    <div className="media-mode-tabs" role="tablist" aria-label="选择交流方式">{MODES.map(item => <button key={item.id} role="tab" aria-selected={mode === item.id} disabled={busy} className={mode === item.id ? 'active' : ''} onClick={() => changeMode(item.id)}><item.icon size={20}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{mode === item.id && <Check size={15}/>}</button>)}</div>
    {configError && <div className="media-alert" role="alert"><AlertCircle size={18}/><span>{configError}</span><button onClick={loadConfig}>重新加载</button></div>}
    {!secure && mode !== 'image' && <div className="media-secure-notice"><ShieldCheck size={21}/><div><strong>开启安全连接，就能使用麦克风</strong><p>浏览器只允许在 HTTPS 页面录音。切换后，请登录同一账户继续。</p></div><a className="btn btn-secondary" href={config.secureUrl || SECURE_URL}>打开安全入口<ArrowUpRight size={15}/></a></div>}
    <div className="media-workspace"><div className="media-main">
      <section className="media-scenes" aria-label="选择使用场景"><div className="media-section-heading"><h2>今天，想从哪里开始？</h2><span>{scenes.length} 个场景</span></div><div className="media-scene-list">{scenes.map(scene => { const Icon = ICONS[scene.icon] || MODES.find(item => item.id === mode).icon; return <button key={scene.id} disabled={busy} aria-pressed={selectedScene?.id === scene.id} className={selectedScene?.id === scene.id ? 'active' : ''} onClick={() => { setSceneIds(current => ({ ...current, [mode]: scene.id })); newSession(); }}><Icon size={17}/><span>{scene.name}</span></button>; })}</div><p className="media-scene-description">{selectedScene?.description}</p></section>
      {error && <div className="media-alert" role="alert"><AlertCircle size={18}/><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button></div>}

      {mode === 'voice' && <section className="media-voice-panel" aria-label="实时语音对话"><div className="media-voice-top"><span><Headphones size={16}/>{selectedScene?.name}</span><span className={`media-call-status ${voiceActive ? 'active' : ''}`}><i/>{voiceActive ? durationLabel(voiceSeconds) : '按需开始'}</span></div><div className={`media-voice-focus ${voiceStatus}`}><div className="media-voice-orbit"><div className="media-voice-core">{voiceStatus === 'connecting' || voiceStatus === 'ending' ? <Loader2 size={42} className="spin"/> : voiceStatus === 'speaking' ? <AudioLines size={46} strokeWidth={1.6}/> : muted ? <MicOff size={42} strokeWidth={1.6}/> : <Mic size={42} strokeWidth={1.6}/>}</div></div><h2>{muted && voiceStatus === 'listening' ? '麦克风已静音' : VOICE_LABELS[voiceStatus]}</h2><p>{voiceStatus === 'idle' ? '聊完一句，AI 会在停顿后回应。随时打断，换个思路。' : voiceStatus === 'listening' ? muted ? '你仍然可以听见 AI；打开麦克风继续聊天。' : '自然地说就好，停顿后会为你整理回答。' : voiceStatus === 'speaking' ? '你可以打断回答，继续提问。' : voiceStatus === 'thinking' ? '正在根据你刚才的话组织回应。' : voiceStatus === 'ending' ? '麦克风已关闭，正在保存记录。' : '连接成功后即可开始说话。'}</p><div className="media-level" aria-label={`麦克风音量 ${Math.round(level * 100)}%`}>{Array.from({ length: 19 }, (_, i) => <span key={i} style={{ height: `${5 + level * (28 - Math.abs(i - 9) * 2)}px` }}/>)}</div>{!voiceActive && <p className="media-usage-note">每轮回应 1 额度 · 单次发言最长 20 秒 · 每次会话最长 20 分钟</p>}<div className="media-call-actions">{voiceActive ? <><button className={`media-round-action ${muted ? 'selected' : ''}`} onClick={toggleMute} disabled={['connecting', 'ending'].includes(voiceStatus)} aria-pressed={muted}>{muted ? <MicOff size={21}/> : <Mic size={21}/>}<span>{muted ? '取消静音' : '静音'}</span></button><button className="media-hangup" onClick={endVoice} disabled={voiceStatus === 'ending'}><PhoneOff size={23}/><span>结束对话</span></button><button className="media-round-action" onClick={interruptVoice} disabled={['connecting', 'ending'].includes(voiceStatus)}><Square size={18}/><span>打断回答</span></button></> : <button className="btn btn-primary media-start-call" onClick={startVoice} disabled={configLoading || !secure || !config.capabilities.voice}><Phone size={19}/>{configLoading ? '正在准备…' : '开始语音对话'}</button>}</div>{!configLoading && !config.capabilities.voice && <p className="media-capability-note">实时语音尚未启用，请联系管理员配置。</p>}</div><div className="media-transcript-heading"><h3><AudioLines size={17}/>对话文字</h3>{!voiceActive && !!messages.length && <button onClick={newSession}><Plus size={14}/>清空当前展示</button>}</div><Transcript messages={messages} empty="开始后，你和 AI 的对话文字会显示在这里。" endRef={transcriptEnd}/></section>}

      {mode === 'image' && <section className="media-image-panel"><div className="media-section-heading"><div><h2>{selectedScene?.name}</h2><p>上传清晰图片，再补充你想了解的内容。</p></div>{!!messages.length && <button className="btn btn-text" onClick={newSession} disabled={busy}><Plus size={15}/>新对话</button>}</div><input ref={filesInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { uploadImages(event.target.files); event.target.value = ''; }}/><input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={event => { uploadImages(event.target.files); event.target.value = ''; }}/><div className={`media-upload-area ${images.length ? 'has-images' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!visionBusy) uploadImages(event.dataTransfer.files); }}>{images.length ? <div className="media-image-grid">{images.map(item => <div className={`media-upload-item ${item.status}`} key={item.localId}><img src={item.preview} alt={item.name}/><button aria-label={`移除 ${item.name}`} onClick={() => removeImage(item.localId)} disabled={visionBusy || item.status === 'deleting'}><X size={15}/></button><span>{item.status === 'deleting' ? <><Loader2 size={13} className="spin"/>删除中</> : item.status === 'uploading' ? <><Loader2 size={13} className="spin"/>上传中</> : item.status === 'ready' ? <><CheckCircle2 size={13}/>已上传</> : <><AlertCircle size={13}/>上传失败</>}</span>{item.error && <p role="alert">{item.error}</p>}</div>)}</div> : <><span className="media-upload-icon"><ImagePlus size={32} strokeWidth={1.5}/></span><h3>把问题放进镜头里</h3><p>拖入图片，或从相册中选择。</p></>}<div className="media-upload-actions"><button className="btn btn-secondary" disabled={visionBusy || images.length >= 4} onClick={() => { if (requireUser()) filesInput.current?.click(); }}><Upload size={16}/>选择图片</button><button className="btn btn-text" disabled={visionBusy || images.length >= 4} onClick={() => { if (requireUser()) cameraInput.current?.click(); }}><Camera size={17}/>拍一张</button></div><small>JPEG、PNG、WebP · 最多 4 张 · 每张 {sizeLabel(imageBytes)}</small></div><form className="media-image-composer" onSubmit={analyzeImages}><label htmlFor="media-image-prompt">想让 AI 重点看什么？<span>可选</span></label><textarea id="media-image-prompt" rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={visionBusy} maxLength={6000} placeholder={IMAGE_QUESTIONS[selectedScene?.id] || '例如：请先解释思路，再逐步说明。'}/><div><span>{images.filter(item => item.status === 'ready').length} / 4 张已就绪 · 每次解析 1 额度</span><button className="btn btn-primary" type="submit" disabled={configLoading || !config.capabilities.image || visionBusy || uploading || (!images.some(item => item.status === 'ready') && (!conversationId || !prompt.trim()))}>{visionBusy ? <Loader2 size={16} className="spin"/> : <Sparkles size={16}/>} {visionBusy ? '正在解析' : conversationId && !images.length ? '继续提问' : '开始解析'}</button></div>{!configLoading && !config.capabilities.image && <p className="media-capability-note">图片助手尚未启用，请联系管理员配置。</p>}</form><Transcript messages={messages} busy={visionBusy} empty="解析结果会显示在这里，并保留在个人历史中。" endRef={transcriptEnd}/></section>}

      {mode === 'recording' && <section className="media-record-panel"><div className="media-section-heading"><div><h2>{selectedScene?.name}</h2><p>先录制和试听，再决定是否上传转成文字。</p></div><FileAudio size={24}/></div><div className={`media-recorder ${recordStatus}`}><div className="media-recorder-symbol">{recordStatus === 'recording' ? <AudioLines size={38}/> : <Mic size={35} strokeWidth={1.5}/>}</div><strong className="media-record-time">{durationLabel(recordSeconds)}</strong><p>{recordStatus === 'recording' ? '正在录音 · 停止后可以试听' : recordStatus === 'paused' ? '录音已暂停，继续后接着记录。' : recordStatus === 'starting' ? '等待麦克风授权…' : recording ? '录音已准备好，先听听再转写。' : '给刚学到的知识，留一段声音。'}</p><div className="media-recorder-actions">{recordingActive && !['starting', 'processing'].includes(recordStatus) ? <><button className="btn btn-secondary" onClick={pauseRecording}>{recordStatus === 'paused' ? <Play size={16}/> : <Pause size={16}/>} {recordStatus === 'paused' ? '继续录音' : '暂停'}</button><button className="btn btn-primary" onClick={stopRecording}><Square size={15}/>停止并试听</button></> : <button className="btn btn-primary" onClick={startRecording} disabled={!secure || transcribeBusy || recordStatus === 'starting' || recordStatus === 'processing'}>{recordStatus === 'starting' ? <Loader2 size={16} className="spin"/> : <Mic size={17}/>} {recording ? '重新录制' : '开始录音'}</button>}{(recording || recordingActive) && <button className="btn btn-text" onClick={() => discardRecording()} disabled={transcribeBusy}><Trash2 size={16}/>删除录音</button>}</div></div><input ref={audioInput} type="file" accept="audio/*,.m4a,.webm,.ogg" hidden onChange={event => { selectAudio(event.target.files?.[0]); event.target.value = ''; }}/><div className="media-audio-import"><button onClick={() => { if (requireUser()) audioInput.current?.click(); }} disabled={recordingActive || transcribeBusy}><Upload size={15}/>选择已有录音</button><small>最多 {sizeLabel(audioBytes)} · 录音最长 {Math.floor(audioSeconds / 60)} 分钟</small></div>{recording && <div className="media-record-preview"><div><FileAudio size={21}/><span><strong>{recording.file.name}</strong><small>{sizeLabel(recording.file.size)}{recording.asset ? ' · 已上传到个人账户' : ' · 尚未上传'}</small></span></div><audio controls src={recordUrl} preload="metadata"/><p className="media-usage-note">每次转写 1 额度，完成后保存到知识库。</p><button className="btn btn-primary" onClick={transcribeRecording} disabled={transcribeBusy || !!savedNoteId || !config.capabilities.transcribe}>{transcribeBusy ? <Loader2 size={16} className="spin"/> : <Send size={16}/>} {transcribeBusy ? '正在上传与转写…' : savedNoteId ? '已保存到知识库' : '上传转写并保存'}</button>{!configLoading && !config.capabilities.transcribe && <p className="media-capability-note">录音转写尚未启用，可先保存本地录音。</p>}<a className="media-audio-download" href={recordUrl} download={recording.file.name}>下载本地录音<ArrowUpRight size={13}/></a></div>}{transcript && <div className="media-record-result"><div><h3><FileText size={18}/>转写结果</h3>{savedNoteId && <a href="/?view=knowledge"><CheckCircle2 size={14}/>已保存 · 打开知识库<ArrowUpRight size={13}/></a>}</div><p>{transcript}</p></div>}</section>}
    </div><aside className="media-history"><div className="media-section-heading"><h2><History size={17}/>个人历史</h2><button onClick={loadHistory} disabled={historyLoading || !data.user} aria-label="刷新媒体对话历史"><RefreshCw size={15} className={historyLoading ? 'spin' : ''}/></button></div>{historyError && <div className="media-history-error"><p>{historyError}</p><button onClick={loadHistory}>重试</button></div>}{history.length ? <div className="media-history-list">{history.map(session => { const Icon = MODES.find(item => item.id === session.mode)?.icon || FileText; return <button key={session.id} className={conversationId === session.id ? 'active' : ''} disabled={busy || historyLoading} onClick={() => openHistory(session)}><Icon size={17}/><span><strong>{session.title || '一段新的记录'}</strong><small>{config.scenes.find(scene => scene.id === session.sceneId)?.name || '个人记录'}<span>{dateLabel(session.updatedAt)}</span></small></span><ArrowUpRight size={13}/></button>; })}</div> : <div className="media-history-empty"><Clock3 size={25}/><p>{data.user ? '每一次开口、每一张照片，都会在这里留下线索。' : '登录后，保存和回看你的语音、图片与录音记录。'}</p>{!data.user && <button className="btn btn-secondary" onClick={() => requireUser()}>登录后开始</button>}</div>}<div className="media-history-tip"><BookOpen size={19}/><p>录音转写会保存为知识笔记。AI 的理解可能有偏差，关键内容请对照原始材料。</p></div></aside></div>
    <details className="media-attachments" onToggle={event => { if (event.currentTarget.open) loadAssets(); }}>
      <summary><FileAudio size={17}/><span>我的附件</span><small>{assetStorage ? `${sizeLabel(assetStorage.usedBytes)} / ${sizeLabel(assetStorage.limitBytes)}` : '查看空间与文件'}</small><ChevronDown size={16}/></summary>
      <div className="media-attachments-body"><p>删除文件会释放空间，历史中的图片和录音将无法再打开；文字记录保留。</p>
        {assetsError && <div className="media-alert" role="alert"><AlertCircle size={16}/><span>{assetsError}</span><button onClick={() => loadAssets()}>重试</button></div>}
        {!data.user ? <button className="btn btn-secondary" onClick={() => requireUser()}>登录后查看附件</button> : <>
          <div className="media-storage-summary"><span>{assetStorage ? `已存 ${assetStorage.count ?? assets.length} 个文件` : '正在读取空间信息'}</span><button onClick={() => loadAssets()} disabled={assetsLoading}><RefreshCw size={13} className={assetsLoading ? 'spin' : ''}/>刷新</button></div>
          {assets.length ? <ul className="media-asset-list">{assets.map(asset => <li key={asset.id}>{asset.kind === 'image' ? <ImagePlus size={19}/> : <FileAudio size={19}/>}<span><strong>{asset.name}</strong><small>{sizeLabel(asset.bytes ?? asset.size ?? 0)} · {dateLabel(asset.createdAt)}</small></span><div>{safeAssetUrl(asset.url) && <a href={safeAssetUrl(asset.url)} target="_blank" rel="noreferrer">{asset.kind === 'image' ? '预览' : '试听'}<ArrowUpRight size={12}/></a>}{safeAssetUrl(asset.url) && <a href={safeAssetUrl(asset.url)} download={asset.name}>下载</a>}<button aria-label={`删除附件 ${asset.name}`} disabled={!!deletingAsset || busy} onClick={() => deleteStoredAsset(asset)}>{deletingAsset === asset.id ? <Loader2 size={14} className="spin"/> : <Trash2 size={14}/>}删除</button></div></li>)}</ul> : !assetsLoading && <p className="media-assets-empty">还没有上传的附件。</p>}
          {assetsLoading && <div className="media-assets-loading"><Loader2 size={16} className="spin"/>正在读取附件…</div>}
          {assetsCursor !== null && <button className="btn btn-secondary media-assets-more" onClick={() => loadAssets(true)} disabled={assetsLoading}>加载更多</button>}
        </>}
      </div>
    </details>
  </div>;
}
