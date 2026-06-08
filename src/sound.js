// 用 WebAudio 即時合成音效，不需要任何音檔
export class Sound {
  constructor() {
    this.ctx = null
    this.muted = false
    this.killBuf = null
    this.shootBuf = null
    this.master = null
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.67 // 整體音量（比原本小 1/3）
      this.master.connect(this.ctx.destination)
      this.loadSample('/zombie-die.mp3', (b) => { this.killBuf = b })
      this.loadSample('/shoot.wav', (b) => { this.shootBuf = b })
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  loadSample(url, set) {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => this.ctx.decodeAudioData(b))
      .then((buf) => set(buf))
      .catch(() => {}) // 沒檔案就用合成後備音
  }

  playBuf(buf, vol = 0.9, dur = null) {
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = vol
    s.connect(g).connect(this.master)
    if (dur) s.start(0, 0, dur) // 只播前段
    else s.start()
  }

  tone(freq, dur, type = 'square', vol = 0.15, slideTo = null) {
    if (this.muted) return
    this.ensure()
    const c = this.ctx
    const t = c.currentTime
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur)
  }

  noise(dur = 0.15, vol = 0.2) {
    if (this.muted) return
    this.ensure()
    const c = this.ctx
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const s = c.createBufferSource()
    s.buffer = buf
    const g = c.createGain()
    g.gain.value = vol
    s.connect(g).connect(this.master)
    s.start()
  }

  shoot() {
    if (this.muted) return
    this.ensure()
    if (this.shootBuf) this.playBuf(this.shootBuf, 0.15, this.shootBuf.duration * 0.75) // 只播前 3/4
    else this.tone(680, 0.07, 'square', 0.06, 320) // 後備
  }
  hit() { this.tone(180, 0.04, 'square', 0.05) }
  kill() {
    if (this.muted) return
    this.ensure()
    if (this.killBuf) this.playBuf(this.killBuf, 0.9) // public/zombie-die.mp3
    else this.noise(0.14, 0.14) // 後備
  }
  hurt() { this.tone(150, 0.18, 'sawtooth', 0.16, 70) }
  bossSpawn() { this.tone(90, 0.7, 'sawtooth', 0.22, 240) }
  waveStart() { this.tone(520, 0.18, 'triangle', 0.14, 800) }
  gameOver() { this.tone(440, 0.9, 'sine', 0.25, 70) }
}
