import { Sound } from './sound'

// 美秀打殭屍 — 俯視角生存射擊
// 控制：WASD / 方向鍵移動，滑鼠瞄準，按住滑鼠左鍵射擊
export function createGame(canvas, callbacks = {}) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const sound = new Sound()

  // 狗柏去背圖（面向左）；載入失敗時用手繪角色當後備
  const dogbo = new Image()
  let dogboOk = false
  dogbo.onload = () => { dogboOk = true }
  dogbo.src = '/dogbo.png'

  const keys = {}
  const mouse = { x: W / 2, y: H / 2, down: false }
  // 手機虛擬搖桿（MOBA 風格：左下移動、右下瞄準射擊，固定可見）
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const JOY_R = 70
  const baseL = { cx: 0, cy: 0, r: JOY_R }
  const baseR = { cx: 0, cy: 0, r: JOY_R }
  const joyL = { id: null, kx: 0, ky: 0 } // 旋鈕相對底座的位移
  const joyR = { id: null, kx: 0, ky: 0 }

  function setKnob(joy, base, p) {
    let dx = p.x - base.cx, dy = p.y - base.cy
    const m = Math.hypot(dx, dy)
    if (m > base.r) { dx = (dx / m) * base.r; dy = (dy / m) * base.r }
    joy.kx = dx; joy.ky = dy
  }

  let player, bullets, zombies, particles
  let wave, spawnQueue, spawnTimer, spawnInterval
  let betweenWaves, betweenTimer
  let score, running, raf, lastTime, hurtSoundTimer

  function reset() {
    player = { x: W / 2, y: H / 2, r: 13, speed: 230, hp: 100, hpMax: 100, angle: 0, cd: 0 }
    // 固定搖桿底座（左下 / 右下）
    baseL.cx = 100; baseL.cy = H - 100
    baseR.cx = W - 100; baseR.cy = H - 100
    joyL.id = null; joyL.kx = 0; joyL.ky = 0
    joyR.id = null; joyR.kx = 0; joyR.ky = 0
    bullets = []
    zombies = []
    particles = []
    wave = 0
    spawnQueue = []
    spawnTimer = 0
    spawnInterval = 0.7
    betweenWaves = true
    betweenTimer = 1.5 // 開場準備時間
    score = 0
    hurtSoundTimer = 0
    pushStats()
  }

  function pushStats() {
    callbacks.onStats?.({ score, wave, hp: Math.max(0, Math.ceil(player.hp)), hpMax: player.hpMax })
  }

  function nextWave() {
    wave++
    const isBoss = wave % 5 === 0
    spawnInterval = Math.max(0.25, 0.7 - wave * 0.03)
    spawnQueue = []
    if (isBoss) {
      spawnQueue.push('boss')
      for (let i = 0; i < 3 + wave; i++) spawnQueue.push('z')
      sound.bossSpawn()
    } else {
      const n = 4 + wave * 2
      for (let i = 0; i < n; i++) spawnQueue.push(Math.random() < 0.22 ? 'fast' : 'z')
    }
    spawnTimer = 0
    sound.waveStart()
    callbacks.onWaveStart?.(wave, isBoss)
    pushStats()
  }

  function spawnOne(type) {
    // 從畫面外圍隨機一邊生成
    const edge = Math.floor(Math.random() * 4)
    let x, y
    if (edge === 0) { x = Math.random() * W; y = -30 }
    else if (edge === 1) { x = W + 30; y = Math.random() * H }
    else if (edge === 2) { x = Math.random() * W; y = H + 30 }
    else { x = -30; y = Math.random() * H }

    if (type === 'boss') {
      zombies.push({ x, y, r: 42, speed: 38 + wave, hp: 700 + wave * 120, hpMax: 700 + wave * 120, dmg: 45, value: 250, boss: true, emoji: '👹' })
    } else if (type === 'fast') {
      zombies.push({ x, y, r: 13, speed: 110 + wave * 4, hp: 30 + wave * 5, hpMax: 30 + wave * 5, dmg: 26, value: 15, emoji: '🧟‍♀️' })
    } else {
      zombies.push({ x, y, r: 17, speed: 52 + wave * 3, hp: 50 + wave * 9, hpMax: 50 + wave * 9, dmg: 22, value: 10, emoji: '🧟' })
    }
  }

  function fire() {
    if (player.cd > 0) return
    player.cd = 0.16
    const a = player.angle
    const sp = 620
    bullets.push({
      x: player.x + Math.cos(a) * player.r,
      y: player.y + Math.sin(a) * player.r,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: 6,
      life: 1.2,
      dmg: 26,
    })
    sound.shoot()
  }

  function burst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 40 + Math.random() * 120
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, color })
    }
  }

  function update(dt) {
    // ---- 玩家移動 ----
    let dx = 0, dy = 0, factor = 1
    if (joyL.id !== null) {
      // 觸控搖桿（類比）
      dx = joyL.kx
      dy = joyL.ky
      const m = Math.hypot(dx, dy)
      if (m < 8) { dx = dy = 0 } else { factor = Math.min(1, m / JOY_R) }
    } else {
      if (keys['w'] || keys['arrowup']) dy -= 1
      if (keys['s'] || keys['arrowdown']) dy += 1
      if (keys['a'] || keys['arrowleft']) dx -= 1
      if (keys['d'] || keys['arrowright']) dx += 1
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy)
      player.x += (dx / len) * player.speed * factor * dt
      player.y += (dy / len) * player.speed * factor * dt
      player.x = Math.max(player.r, Math.min(W - player.r, player.x))
      player.y = Math.max(player.r, Math.min(H - player.r, player.y))
    }

    // ---- 瞄準 + 射擊 ----
    player.cd -= dt
    if (joyR.id !== null) {
      const m = Math.hypot(joyR.kx, joyR.ky)
      if (m > 10) player.angle = Math.atan2(joyR.ky, joyR.kx)
      fire() // 右搖桿按著就持續射擊
    } else {
      player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x)
      if (mouse.down) fire()
    }

    // ---- 子彈 ----
    for (const b of bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
    }

    // ---- 生成波次 ----
    if (betweenWaves) {
      betweenTimer -= dt
      if (betweenTimer <= 0) { betweenWaves = false; nextWave() }
    } else if (spawnQueue.length) {
      spawnTimer -= dt
      if (spawnTimer <= 0) { spawnTimer = spawnInterval; spawnOne(spawnQueue.shift()) }
    } else if (zombies.length === 0) {
      betweenWaves = true
      betweenTimer = 2.5
    }

    // ---- 殭屍 AI ----
    hurtSoundTimer -= dt
    for (const z of zombies) {
      const a = Math.atan2(player.y - z.y, player.x - z.x)
      z.x += Math.cos(a) * z.speed * dt
      z.y += Math.sin(a) * z.speed * dt
      // 接觸玩家 → 持續扣血
      if (Math.hypot(player.x - z.x, player.y - z.y) < player.r + z.r) {
        player.hp -= z.dmg * dt
        if (hurtSoundTimer <= 0) { sound.hurt(); hurtSoundTimer = 0.35 }
        if (player.hp <= 0) { player.hp = 0; return gameOver() }
      }
    }

    // ---- 子彈 vs 殭屍 ----
    for (const b of bullets) {
      for (const z of zombies) {
        if (z.hp <= 0) continue
        if (Math.hypot(b.x - z.x, b.y - z.y) < b.r + z.r) {
          z.hp -= b.dmg
          b.life = 0
          burst(b.x, b.y, '#ff8fcf', 4)
          sound.hit()
          if (z.hp <= 0) {
            score += z.value
            burst(z.x, z.y, z.boss ? '#ffd23f' : '#a855f7', z.boss ? 24 : 10)
            sound.kill()
          }
          break
        }
      }
    }

    // ---- 清除 ----
    bullets = bullets.filter((b) => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20)
    zombies = zombies.filter((z) => z.hp > 0)
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt }
    particles = particles.filter((p) => p.life > 0)

    pushStats()
  }

  function render() {
    // 背景
    ctx.fillStyle = '#16111f'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(168,85,247,0.10)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    }
    ctx.globalAlpha = 1

    // 子彈（檳榔）
    for (const b of bullets) {
      const a = Math.atan2(b.vy, b.vx)
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(a)
      // 檳榔身體（綠色橢圓）
      ctx.fillStyle = '#6cb83f'
      ctx.beginPath()
      ctx.ellipse(0, 0, b.r + 4, b.r, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#3f7a25'
      ctx.lineWidth = 1.2
      ctx.stroke()
      // 前端淺色蒂頭
      ctx.fillStyle = '#e3ecb4'
      ctx.beginPath()
      ctx.ellipse(b.r + 3, 0, 2.6, 3, 0, 0, Math.PI * 2)
      ctx.fill()
      // 反光
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.beginPath()
      ctx.ellipse(-2, -2, 2.2, 1.2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 殭屍
    for (const z of zombies) {
      drawEmoji(z.emoji, z.x, z.y, z.r * 2)
      if (z.boss) {
        // 魔王血條
        const w = 80, hpr = z.hp / z.hpMax
        ctx.fillStyle = '#000'
        ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w, 7)
        ctx.fillStyle = '#ff4d6d'
        ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w * hpr, 7)
      }
    }

    // 狗柏 扛著炫砲
    if (dogboOk) {
      const h = 84
      const w = h * (dogbo.width / dogbo.height)
      const faceRight = mouse.x >= player.x
      ctx.save()
      ctx.translate(player.x, player.y)
      if (faceRight) ctx.scale(-1, 1) // 照片面向左，瞄右邊時翻面
      ctx.drawImage(dogbo, -w * 0.5, -h * 0.5, w, h)
      ctx.restore()
    } else {
      // 後備：手繪角色（整體跟著瞄準方向旋轉）
      ctx.save()
      ctx.translate(player.x, player.y)
      ctx.rotate(player.angle)
      drawPlayerCharacter()
      drawWeapon()
      ctx.restore()
    }

    // 手機固定搖桿（MOBA 風格，始終顯示）
    if (isTouch) {
      drawJoyBase(baseL, joyL, '🕹️', '#a855f7')
      drawJoyBase(baseR, joyR, '🎯', '#ff4d6d')
    }
  }

  function drawJoyBase(base, joy, icon, knobColor) {
    // 底座
    ctx.globalAlpha = 0.15
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(base.cx, base.cy, base.r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'
    ctx.beginPath(); ctx.arc(base.cx, base.cy, base.r, 0, Math.PI * 2); ctx.stroke()
    // 圖示
    ctx.globalAlpha = 0.6
    ctx.font = '24px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(icon, base.cx, base.cy)
    // 旋鈕
    ctx.globalAlpha = 0.85
    ctx.fillStyle = knobColor
    ctx.beginPath(); ctx.arc(base.cx + joy.kx, base.cy + joy.ky, 30, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
  }

  function drawPlayerCharacter() {
    // 紅花襯衫（身體，位於砲身後方）
    ctx.fillStyle = '#b5302a'
    ctx.beginPath(); ctx.roundRect(-22, -13, 26, 26, 10); ctx.fill()
    ctx.strokeStyle = '#7d1f1b'; ctx.lineWidth = 1.5; ctx.stroke()
    // 襯衫花紋小點
    ctx.fillStyle = '#f4c542'
    for (const [dx, dy] of [[-16, -6], [-9, -3], [-13, 5], [-6, 7], [-18, 2]]) {
      ctx.beginPath(); ctx.arc(dx, dy, 1.4, 0, Math.PI * 2); ctx.fill()
    }
    // 雙手抱住砲身
    ctx.strokeStyle = '#b5302a'; ctx.lineWidth = 7; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(18, -5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(14, 5); ctx.stroke()
    // 頭（黑髮）
    ctx.fillStyle = '#171717'
    ctx.beginPath(); ctx.arc(-13, 0, 10, 0, Math.PI * 2); ctx.fill()
    // 臉（朝前）
    ctx.fillStyle = '#f0c39a'
    ctx.beginPath(); ctx.arc(-10, 0, 6, 0, Math.PI * 2); ctx.fill()
  }

  function drawWeapon() {
    // 木質槍托
    ctx.fillStyle = '#c9a468'
    ctx.beginPath(); ctx.roundRect(-4, 3, 26, 9, 2); ctx.fill()
    ctx.strokeStyle = '#9c7b45'; ctx.lineWidth = 1; ctx.stroke()
    // 藍色握把
    ctx.fillStyle = '#2f7ef0'
    ctx.beginPath(); ctx.roundRect(5, 10, 7, 10, 2); ctx.fill()

    // 砲身（彩虹條紋）
    const x0 = 12, x1 = 60, y = -11, h = 22
    ctx.save()
    ctx.beginPath(); ctx.roundRect(x0, y, x1 - x0, h, 9); ctx.clip()
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x0, y, x1 - x0, h)
    const colors = ['#e23b3b', '#ef8b3b', '#f4d23b', '#49c46a', '#3aa0f7', '#8e5bf0']
    let ci = 0
    for (let sx = x0 - h; sx < x1 + h; sx += 8) {
      ctx.fillStyle = colors[ci++ % colors.length]
      ctx.beginPath()
      ctx.moveTo(sx, y); ctx.lineTo(sx + 8, y)
      ctx.lineTo(sx + 8 - h, y + h); ctx.lineTo(sx - h, y + h)
      ctx.closePath(); ctx.fill()
    }
    ctx.restore()

    // 藍色金屬環（前後）
    ctx.fillStyle = '#2f6fe0'
    ctx.beginPath(); ctx.roundRect(x0, y, 6, h, 3); ctx.fill()
    ctx.beginPath(); ctx.roundRect(x1 - 7, y, 7, h, 3); ctx.fill()

    // 紅白藍彈頭（圓錐）
    const tip = x1 + 18
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1, y + h); ctx.lineTo(tip, 0); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#e23b3b'
    ctx.beginPath(); ctx.moveTo(tip - 9, y * 0.55); ctx.lineTo(tip - 9, h * 0.55); ctx.lineTo(tip, 0); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#2f6fe0'
    ctx.beginPath(); ctx.roundRect(x1 - 2, y, 4, h, 2); ctx.fill()
  }

  function drawEmoji(emoji, x, y, size) {
    ctx.font = `${size}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(emoji, x, y)
  }

  function loop(t) {
    if (!running) return
    const dt = Math.min(0.05, (t - lastTime) / 1000 || 0)
    lastTime = t
    update(dt)
    if (!running) return // update 可能觸發 gameOver
    render()
    raf = requestAnimationFrame(loop)
  }

  function gameOver() {
    running = false
    cancelAnimationFrame(raf)
    sound.gameOver()
    callbacks.onGameOver?.({ score, wave })
  }

  // ---- 輸入 ----
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }
  const onKeyDown = (e) => { keys[e.key.toLowerCase()] = true }
  const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false }

  const onPointerDown = (e) => {
    const p = canvasPos(e)
    if (e.pointerType === 'touch') {
      if (p.x < W / 2 && joyL.id === null) { joyL.id = e.pointerId; setKnob(joyL, baseL, p) }
      else if (joyR.id === null) { joyR.id = e.pointerId; setKnob(joyR, baseR, p) }
    } else {
      mouse.down = true; mouse.x = p.x; mouse.y = p.y
    }
  }
  const onPointerMove = (e) => {
    const p = canvasPos(e)
    if (e.pointerId === joyL.id) setKnob(joyL, baseL, p)
    else if (e.pointerId === joyR.id) setKnob(joyR, baseR, p)
    else if (e.pointerType !== 'touch') { mouse.x = p.x; mouse.y = p.y }
  }
  const onPointerUp = (e) => {
    if (e.pointerId === joyL.id) { joyL.id = null; joyL.kx = 0; joyL.ky = 0 }
    else if (e.pointerId === joyR.id) { joyR.id = null; joyR.kx = 0; joyR.ky = 0 }
    else mouse.down = false
  }

  function start() {
    reset()
    running = true
    lastTime = performance.now()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    sound.ensure()
    raf = requestAnimationFrame(loop)
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }

  function setMuted(m) { sound.muted = m }

  return { start, stop, setMuted }
}
