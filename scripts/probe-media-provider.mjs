import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import WebSocket from 'next/dist/compiled/ws/index.js';
import { entities, pool } from '../lib/db.mjs';
import { decrypt } from '../lib/security.mjs';

const models = await entities('model');
const configured = models.find(item => item.isDefault && item.apiKey) || models.find(item => item.apiKey);
if (!configured) throw new Error('No configured server-side key');
const base = configured.baseUrl.replace(/\/$/, '');
const key = decrypt(configured.apiKey);
const directory = 'docs/tests/media-fixtures';
await fs.mkdir(directory, { recursive: true });
const report = {
  testedAt: new Date().toISOString(), baseUrl: base,
  scope: 'Controlled real provider calls using self-created math image and synthetic English speech; no account/settings/service mutations',
  documentation: ['https://gpt-best.apifox.cn/doc-5287337', 'https://1km97fp1cj.apifox.cn/websocket-3566853', 'https://1km97fp1cj.apifox.cn/websocket-3566860'],
  attempts: [], capabilities: {},
};
const clean = value => String(value || '').split(key).join('[redacted]').replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[redacted]').slice(0, 700);
async function save(result) {
  if (result) { report.attempts.push(result); console.log(JSON.stringify(result)); }
  await fs.writeFile('docs/tests/media-provider-probe.json', JSON.stringify(report, null, 2));
}
function wav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
async function realtime(model) {
  const started = Date.now();
  const url = new URL(`${base}/realtime`); url.protocol = 'wss:'; url.searchParams.set('model', model);
  const result = { capability: 'realtime', model, protocol: 'OpenAI-Beta: realtime=v1', endpoint: '/v1/realtime', opened: false, sessionUpdated: false, audioBytes: 0, transcript: '', eventTypes: [] };
  const pcm = [], events = new Set();
  await new Promise(resolve => {
    let finished = false, triggered = false;
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1' }, handshakeTimeout: 20000, maxPayload: 4 * 1024 * 1024 });
    const timer = setTimeout(() => finish({ error: 'Probe timed out after 40 seconds' }), 40000);
    function finish(extra = {}) {
      if (finished) return;
      finished = true; clearTimeout(timer); Object.assign(result, extra);
      socket.removeAllListeners('message'); socket.close();
      setTimeout(() => { if (socket.readyState !== WebSocket.CLOSED) socket.terminate(); }, 1000).unref();
      resolve();
    }
    socket.on('open', () => {
      result.opened = true;
      socket.send(JSON.stringify({ type: 'session.update', session: { modalities: ['text', 'audio'], instructions: 'Speak English. Keep responses under twelve words.', voice: 'alloy', input_audio_format: 'pcm16', output_audio_format: 'pcm16', turn_detection: null } }));
    });
    socket.on('message', raw => {
      let event; try { event = JSON.parse(String(raw)); } catch { return finish({ error: 'Non-JSON websocket message' }); }
      events.add(event.type);
      if (event.type === 'error') return finish({ error: clean(event.error?.message || JSON.stringify(event.error)), errorCode: clean(event.error?.code) });
      if (event.type === 'session.updated' && !triggered) {
        result.sessionUpdated = true; triggered = true;
        socket.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say only: Hello, let us practice English together.' }] } }));
        socket.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text', 'audio'], max_output_tokens: 100 } }));
      }
      if (['response.audio.delta', 'response.output_audio.delta'].includes(event.type) && event.delta) pcm.push(Buffer.from(event.delta, 'base64'));
      if (['response.audio_transcript.delta', 'response.output_audio_transcript.delta', 'response.text.delta', 'response.output_text.delta'].includes(event.type)) result.transcript += event.delta || '';
      if (['response.audio_transcript.done', 'response.output_audio_transcript.done'].includes(event.type) && event.transcript) result.transcript = event.transcript;
      if (event.type === 'response.done') finish({ responseStatus: event.response?.status, usage: event.response?.usage || null, ...(event.response?.status === 'failed' ? { error: clean(JSON.stringify(event.response?.status_details)) } : {}) });
    });
    socket.on('unexpected-response', (_request, response) => {
      result.httpStatus = response.statusCode;
      let text = ''; response.on('data', chunk => { if (text.length < 1000) text += String(chunk); });
      response.on('end', () => finish({ error: clean(text || `HTTP ${response.statusCode}`) }));
    });
    socket.on('error', error => finish({ error: clean(error.message) }));
    socket.on('close', (code, reason) => { if (!finished) finish({ closeCode: code, error: clean(reason || 'Connection closed before a completed response') }); });
  });
  result.eventTypes = [...events]; result.audioBytes = pcm.reduce((sum, item) => sum + item.length, 0);
  result.durationMs = Date.now() - started;
  result.success = result.responseStatus === 'completed' && result.audioBytes > 0 && result.transcript.length > 0;
  result.transcript = clean(result.transcript);
  if (result.audioBytes) {
    const file = `${directory}/realtime-${model}.wav`;
    await fs.writeFile(file, wav(Buffer.concat(pcm)));
    result.audioFixture = file; result.sampleRate = 24000; result.encoding = 'PCM16 mono';
  }
  await save(result); return result;
}
async function jsonCall(endpoint, body) {
  return fetch(`${base}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
}
async function speech(model) {
  const start = Date.now(), result = { capability: 'speech', model, endpoint: '/v1/audio/speech' };
  let bytes;
  try {
    const response = await jsonCall('/audio/speech', { model, input: 'I study English for twenty minutes every day.', voice: 'alloy', response_format: 'mp3' });
    result.httpStatus = response.status; result.contentType = response.headers.get('content-type');
    if (!response.ok) result.error = clean(await response.text());
    else {
      bytes = Buffer.from(await response.arrayBuffer());
      result.bytes = bytes.length; result.success = bytes.length > 1000 && !result.contentType?.includes('json');
      if (result.success) { result.fixture = `${directory}/speech-${model}.mp3`; await fs.writeFile(result.fixture, bytes); result.sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); }
      else result.error = clean(bytes.toString('utf8').slice(0, 500));
    }
  } catch (error) { result.error = clean(error.message); }
  result.durationMs = Date.now() - start; await save(result); return { result, bytes };
}
async function transcribe(model, audio) {
  const start = Date.now(), result = { capability: 'transcription', model, endpoint: '/v1/audio/transcriptions', input: 'Previously generated synthetic English speech' };
  try {
    const form = new FormData(); form.set('model', model); form.set('language', 'en'); form.set('response_format', 'json'); form.set('file', new Blob([audio], { type: 'audio/mpeg' }), 'english-practice.mp3');
    const response = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(55000) });
    result.httpStatus = response.status;
    const text = await response.text();
    if (!response.ok) result.error = clean(text);
    else { let data; try { data = JSON.parse(text); } catch { data = { text }; } result.transcript = clean(data.text); result.success = /study English/i.test(result.transcript) && /twenty|20/i.test(result.transcript); }
  } catch (error) { result.error = clean(error.message); }
  result.durationMs = Date.now() - start; await save(result); return result;
}
async function vision(model, picture) {
  const start = Date.now(), result = { capability: 'vision', model, endpoint: '/v1/chat/completions', fixture: `${directory}/linear-equation.png` };
  try {
    const response = await jsonCall('/chat/completions', { model, max_tokens: 200, messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the equation in this image and solve for x. Quote the equation and show one concise calculation.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${picture.toString('base64')}`, detail: 'low' } }] }] });
    result.httpStatus = response.status;
    const text = await response.text();
    if (!response.ok) result.error = clean(text);
    else { const data = JSON.parse(text); result.answer = clean(data.choices?.[0]?.message?.content); result.usage = data.usage; result.success = /2\s*x|2x/i.test(result.answer) && /17/.test(result.answer) && /6/.test(result.answer); }
  } catch (error) { result.error = clean(error.message); }
  result.durationMs = Date.now() - start; await save(result); return result;
}
try {
  const picture = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="white"/><text x="48" y="85" fill="#123524" font-family="sans-serif" font-size="30">Solve for x</text><text x="80" y="200" fill="black" font-family="sans-serif" font-size="64">2x + 5 = 17</text></svg>')).png().toBuffer();
  await fs.writeFile(`${directory}/linear-equation.png`, picture);
  for (const model of ['gpt-4o-mini-realtime-preview', 'gpt-4o-realtime-preview']) { const result = await realtime(model); if (result.success) { report.capabilities.realtime = model; break; } }
  let speechOutput;
  for (const model of ['gpt-4o-mini-tts', 'tts-1']) { const attempt = await speech(model); if (attempt.result.success) { speechOutput = attempt.bytes; report.capabilities.speech = model; break; } }
  if (speechOutput) for (const model of ['gpt-4o-mini-transcribe', 'whisper-1']) { const result = await transcribe(model, speechOutput); if (result.success) { report.capabilities.transcription = model; break; } }
  for (const model of ['gpt-4o-mini', 'gpt-4o']) { const result = await vision(model, picture); if (result.success) { report.capabilities.vision = model; break; } }
  await save();
} finally { await pool.end(); }
