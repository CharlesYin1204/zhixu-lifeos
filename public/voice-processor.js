/* Convert the browser's capture rate into 24 kHz mono PCM16 in 40 ms chunks. */
class ZhixuVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.ratio = sampleRate / this.targetRate;
    this.pending = new Float32Array(0);
    this.position = 0;
    this.frame = new Int16Array(960);
    this.frameOffset = 0;
    this.energy = 0;
    this.active = true;
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) {
      for (let i = 0; i < mono.length; i++) mono[i] += (channel[i] || 0) / channels.length;
    }
    const samples = new Float32Array(this.pending.length + mono.length);
    samples.set(this.pending);
    samples.set(mono, this.pending.length);
    while (this.position < samples.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      if (fraction > 0 && index + 1 >= samples.length) break;
      const interpolated = fraction ? samples[index] + (samples[index + 1] - samples[index]) * fraction : samples[index];
      const value = Math.max(-1, Math.min(1, interpolated));
      this.frame[this.frameOffset++] = Math.round(value < 0 ? value * 32768 : value * 32767);
      this.energy += value * value;
      if (this.frameOffset === this.frame.length) {
        // DataView fixes byte order independently of the device's native architecture.
        const buffer = new ArrayBuffer(this.frame.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < this.frame.length; i++) view.setInt16(i * 2, this.frame[i], true);
        this.port.postMessage({ type: 'audio', pcm: buffer, rms: Math.sqrt(this.energy / this.frame.length) }, [buffer]);
        this.frameOffset = 0;
        this.energy = 0;
      }
      this.position += this.ratio;
    }
    const consumed = Math.min(Math.floor(this.position), samples.length);
    this.pending = samples.slice(consumed);
    this.position -= consumed;
    return true;
  }
}

registerProcessor('zhixu-voice-processor', ZhixuVoiceProcessor);
