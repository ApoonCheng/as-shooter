import { Sound } from './sound'

// 美秀打殭屍 — 自動瞄準射擊 + 升級養成 + 特殊技能 + 道具掉落
export function createGame(canvas, callbacks = {}, opts = {}) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const sound = new Sound()
  const bonus = opts.bonuses || {}

  const dogbo = new Image()
  let dogboOk = false
  dogbo.onload = () => { dogboOk = true }
  dogbo.src = '/dogbo.png'

  const keys = {}
  const mouse = { x: W / 2, y: H / 2 }
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const MAXR = 55
  const ORB_R = 56
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }

  let player, bullets, zombies, particles, pickups, ebullets
  let wave, spawnQueue, spawnTimer, spawnInterval
  let betweenWaves, betweenTimer
  let score, running, raf, lastTime, hurtSoundTimer
  let levelingUp, shakeAmt, coins, killCount, bossKills, orbAngle

  const UPGRADES = [
    { id: 'dmg', icon: '💥', name: '傷害 +12', apply: (p) => { p.dmg += 12 } },
    { id: 'rate', icon: '⚡', name: '攻速 +12%', apply: (p) => { p.fireCd = Math.max(0.06, p.fireCd * 0.88) } },
    { id: 'multi', icon: '🔱', name: '多重彈 +1', apply: (p) => { p.multishot += 1 }, capped: (p) => p.multishot >= 5 },
    { id: 'pierce', icon: '➡️', name: '穿透 +1', apply: (p) => { p.pierce += 1 }, capped: (p) => p.pierce >= 4 },
    { id: 'hp', icon: '❤️', name: '最大血量 +30（回滿）', apply: (p) => { p.hpMax += 30; p.hp = p.hpMax } },
    { id: 'explosive', icon: '🧨', name: '爆裂彈（命中爆炸）', apply: (p) => { p.explosive += 1 }, capped: (p) => p.explosive >= 3 },
    { id: 'poison', icon: '☠️', name: '毒彈（持續傷害）', apply: (p) => { p.poison += 1 }, capped: (p) => p.poison >= 3 },
    { id: 'lifesteal', icon: '🩸', name: '吸血 +1（擊殺回血）', apply: (p) => { p.lifesteal += 1 }, capped: (p) => p.lifesteal >= 4 },
    { id: 'bounce', icon: '🪃', name: '彈跳 +1（撞牆反彈）', apply: (p) => { p.bounce += 1 }, capped: (p) => p.bounce >= 3 },
    { id: 'orbit', icon: '🛡️', name: '環繞檳榔 +1', apply: (p) => { p.orbit += 1 }, capped: (p) => p.orbit >= 4 },
  ]

  function reset() {
    const hpMax = 100 + (bonus.hpAdd || 0)
    player = {
      x: W / 2, y: H / 2, r: 13, angle: 0, cd: 0,
      hp: hpMax, hpMax, speed: 230 * (bonus.speedMul || 1),
      dmg: 26 * (bonus.dmgMul || 1), fireCd: 0.18 * (bonus.rateMul || 1),
      bulletSpeed: 620, multishot: 1, pierce: 0,
      explosive: 0, poison: 0, lifesteal: 0, bounce: 0, orbit: 0,
      invincT: 0, rageT: 0,
      xp: 0, level: 1, xpNext: 5,
    }
    bullets = []; zombies = []; particles = []; pickups = []; ebullets = []
    score = 0; coins = 0; killCount = 0; bossKills = 0; orbAngle = 0
    shakeAmt = 0; levelingUp = false
    wave = 0; spawnQueue = []; spawnTimer = 0; spawnInterval = 0.7
    betweenWaves = true; betweenTimer = 1.5
    hurtSoundTimer = 0
    joy.id = null
    pushStats()
  }

  function pushStats() {
    callbacks.onStats?.({
      score, wave,
      hp: Math.max(0, Math.ceil(player.hp)), hpMax: player.hpMax,
      level: player.level, xpRatio: Math.min(1, player.xp / player.xpNext),
      invinc: player.invincT > 0, rage: player.rageT > 0,
    })
  }

  function nextWave() {
    wave++
    const isBoss = wave % 5 === 0
    spawnInterval = Math.max(0.1, 0.48 - wave * 0.045)
    spawnQueue = []
    if (isBoss) {
      spawnQueue.push('boss')
      for (let i = 0; i < 6 + wave * 1.5; i++) {
        const r = Math.random()
        spawnQueue.push(r < 0.32 ? 'tank' : r < 0.55 ? 'fast' : 'z')
      }
      sound.bossSpawn()
    } else {
      const n = 8 + wave * 3.5
      const pool = ['z', 'z', 'fast']
      if (wave >= 3) pool.push('tank', 'fast')
      if (wave >= 4) pool.push('spitter', 'exploder')
      if (wave >= 6) pool.push('charger', 'tank')
      for (let i = 0; i < n; i++) spawnQueue.push(pool[Math.floor(Math.random() * pool.length)])
    }
    spawnTimer = 0
    sound.waveStart()
    callbacks.onWaveStart?.(wave, isBoss)
    pushStats()
  }

  function spawnOne(type) {
    const edge = Math.floor(Math.random() * 4)
    let x, y
    if (edge === 0) { x = Math.random() * W; y = -30 }
    else if (edge === 1) { x = W + 30; y = Math.random() * H }
    else if (edge === 2) { x = Math.random() * W; y = H + 30 }
    else { x = -30; y = Math.random() * H }
    const q = wave * wave
    if (type === 'boss') {
      const bhp = Math.round(2300 + wave * 440 + q * 20)
      zombies.push({ x, y, r: 46, speed: Math.min(135, 60 + wave * 2), hp: bhp, hpMax: bhp, dmg: 85, value: 250, xp: 8, coin: 60, boss: true, kind: 'boss', fireT: 2, emoji: '👹' })
      shake(16)
    } else if (type === 'charger') {
      const chp = Math.round(110 + wave * 20 + q * 1.1)
      zombies.push({ x, y, r: 16, speed: Math.min(165, 100 + wave * 2), hp: chp, hpMax: chp, dmg: 20, value: 25, xp: 2, coin: 5, kind: 'charger', cstate: 'chase', t: 0, emoji: '😡' })
    } else if (type === 'tank') {
      const thp = Math.round(280 + wave * 60 + q * 4)
      zombies.push({ x, y, r: 27, speed: Math.min(160, 48 + wave * 2), hp: thp, hpMax: thp, dmg: 48, value: 40, xp: 3, coin: 6, kind: 'tank', emoji: '🧟‍♂️' })
    } else if (type === 'exploder') {
      const ehp = Math.round(120 + wave * 26 + q * 1.7)
      zombies.push({ x, y, r: 15, speed: Math.min(215, 85 + wave * 4), hp: ehp, hpMax: ehp, dmg: 28, value: 20, xp: 2, coin: 4, kind: 'exploder', emoji: '🤢' })
    } else if (type === 'spitter') {
      const shp = Math.round(110 + wave * 20 + q * 1.5)
      zombies.push({ x, y, r: 15, speed: Math.min(170, 86 + wave * 2), hp: shp, hpMax: shp, dmg: 18, value: 20, xp: 2, coin: 4, kind: 'spitter', fireT: 1.8, emoji: '🤮' })
    } else if (type === 'fast') {
      const fhp = Math.round(50 + wave * 14 + q * 1)
      zombies.push({ x, y, r: 13, speed: Math.min(360, 150 + wave * 7), hp: fhp, hpMax: fhp, dmg: 38, value: 15, xp: 1, coin: 3, kind: 'fast', emoji: '🧟‍♀️' })
    } else {
      const zhp = Math.round(90 + wave * 26 + q * 1.8)
      zombies.push({ x, y, r: 17, speed: Math.min(235, 78 + wave * 6), hp: zhp, hpMax: zhp, dmg: 34, value: 10, xp: 1, coin: 2, kind: 'z', emoji: '🧟' })
    }
  }

  function fire() {
    if (player.cd > 0) return
    player.cd = player.fireCd * (player.rageT > 0 ? 0.5 : 1)
    const n = player.multishot
    const spread = 0.14
    const base = player.angle - (spread * (n - 1)) / 2
    for (let i = 0; i < n; i++) {
      const a = base + spread * i
      bullets.push({
        x: player.x + Math.cos(a) * player.r, y: player.y + Math.sin(a) * player.r,
        vx: Math.cos(a) * player.bulletSpeed, vy: Math.sin(a) * player.bulletSpeed,
        r: 6, life: 1.4, dmg: player.dmg, pierceLeft: player.pierce, bounceLeft: player.bounce, hit: new Set(),
      })
    }
    sound.shoot()
  }

  function burst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 40 + Math.random() * 120
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, color })
    }
  }

  function shake(m) { shakeAmt = Math.min(22, Math.max(shakeAmt, m)) }

  function explodeAt(x, y, radius, dmg, color) {
    burst(x, y, color || '#ff7a3b', 30)
    shake(12)
    sound.kill()
    if (player.invincT <= 0 && Math.hypot(player.x - x, player.y - y) < radius + player.r) {
      player.hp -= dmg
      sound.hurt()
      if (player.hp <= 0) { player.hp = 0; gameOver() }
    }
  }

  function enemyExplode(x, y, radius, dmg) {
    burst(x, y, '#ffb13b', 10)
    for (const z of zombies) {
      if (z.dead) continue
      if (Math.hypot(z.x - x, z.y - y) < radius + z.r) hurtZombie(z, dmg)
    }
  }

  function hurtZombie(z, dmg) {
    if (z.dead) return
    z.hp -= dmg
    if (z.hp <= 0) onKill(z)
  }

  function spitAt(z) {
    const a = Math.atan2(player.y - z.y, player.x - z.x)
    const sp = 265
    ebullets.push({ x: z.x, y: z.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 9, dmg: 18, life: 4 })
  }

  function bossVolley(z) {
    const base = Math.atan2(player.y - z.y, player.x - z.x)
    const n = 7, spread = 0.42, sp = 260
    for (let i = 0; i < n; i++) {
      const a = base - (spread * (n - 1)) / 2 + spread * i
      ebullets.push({ x: z.x, y: z.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 11, dmg: 22, life: 4 })
    }
    shake(6)
  }

  function onKill(z) {
    if (z.dead) return
    z.dead = true
    score += z.value || 0
    player.xp += z.xp || 0
    coins += z.coin || 0
    killCount++
    if (z.boss) bossKills++
    if (player.lifesteal) player.hp = Math.min(player.hpMax, player.hp + player.lifesteal)
    if (z.kind === 'exploder') explodeAt(z.x, z.y, 82, 30)
    else if (z.kind === 'charger') explodeAt(z.x, z.y, 96, 28, '#ff4d6d')
    else { burst(z.x, z.y, z.boss ? '#ffd23f' : '#a855f7', z.boss ? 28 : 10); sound.kill() }
    if (z.boss) shake(18)
    rollDrop(z)
  }

  function rollDrop(z) {
    if (z.boss) {
      pickups.push({ x: z.x - 24, y: z.y, r: 16, type: 'heart', life: 10 })
      pickups.push({ x: z.x + 24, y: z.y, r: 16, type: Math.random() < 0.5 ? 'rage' : 'star', life: 10 })
      return
    }
    const r = Math.random()
    let type = null
    if (r < 0.012) type = 'heart'
    else if (r < 0.017) type = 'bomb'
    else if (r < 0.021) type = 'star'
    else if (r < 0.026) type = 'rage'
    else if (r < 0.034) type = 'coin'
    if (type) pickups.push({ x: z.x, y: z.y, r: 14, type, life: 8 })
  }

  function applyPickup(pk) {
    if (pk.type === 'heart') player.hp = Math.min(player.hpMax, player.hp + 12)
    else if (pk.type === 'coin') coins += 25
    else if (pk.type === 'star') player.invincT = 6
    else if (pk.type === 'rage') player.rageT = 7
    else if (pk.type === 'bomb') {
      shake(20)
      burst(player.x, player.y, '#ffd23f', 30)
      for (const z of zombies) if (!z.dead) hurtZombie(z, 600)
    }
  }

  function update(dt) {
    // 計時器
    if (player.invincT > 0) player.invincT -= dt
    if (player.rageT > 0) player.rageT -= dt
    orbAngle += dt * 2.6

    // 移動
    let dx = 0, dy = 0, factor = 1
    if (joy.id !== null) {
      dx = joy.x - joy.ox; dy = joy.y - joy.oy
      const m = Math.hypot(dx, dy)
      if (m < 8) { dx = dy = 0 } else { factor = Math.min(1, m / MAXR) }
    } else {
      if (keys['w'] || keys['arrowup']) dy -= 1
      if (keys['s'] || keys['arrowdown']) dy += 1
      if (keys['a'] || keys['arrowleft']) dx -= 1
      if (keys['d'] || keys['arrowright']) dx += 1
    }
    const spd = player.speed * (player.rageT > 0 ? 1.4 : 1)
    if (dx || dy) {
      const len = Math.hypot(dx, dy)
      player.x = Math.max(player.r, Math.min(W - player.r, player.x + (dx / len) * spd * factor * dt))
      player.y = Math.max(player.r, Math.min(H - player.r, player.y + (dy / len) * spd * factor * dt))
    }

    // 自動瞄準 + 開火
    player.cd -= dt
    let nearest = null, nd = Infinity
    for (const z of zombies) {
      const d = (z.x - player.x) ** 2 + (z.y - player.y) ** 2
      if (d < nd) { nd = d; nearest = z }
    }
    if (nearest) { player.angle = Math.atan2(nearest.y - player.y, nearest.x - player.x); fire() }

    // 子彈移動（含撞牆反彈）
    for (const b of bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt
      if (b.bounceLeft > 0) {
        if (b.x < b.r) { b.x = b.r; b.vx = -b.vx; b.bounceLeft-- }
        else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -b.vx; b.bounceLeft-- }
        if (b.y < b.r) { b.y = b.r; b.vy = -b.vy; b.bounceLeft-- }
        else if (b.y > H - b.r) { b.y = H - b.r; b.vy = -b.vy; b.bounceLeft-- }
      }
    }

    // 波次
    if (betweenWaves) {
      betweenTimer -= dt
      if (betweenTimer <= 0) { betweenWaves = false; nextWave() }
    } else if (spawnQueue.length) {
      spawnTimer -= dt
      if (spawnTimer <= 0) { spawnTimer = spawnInterval; spawnOne(spawnQueue.shift()) }
    } else if (zombies.length === 0) { betweenWaves = true; betweenTimer = 1.2 }

    // 殭屍 AI + 毒
    hurtSoundTimer -= dt
    for (const z of zombies) {
      if (z.dead) continue
      const a = Math.atan2(player.y - z.y, player.x - z.x)
      const d = Math.hypot(player.x - z.x, player.y - z.y)
      if (z.kind === 'spitter') {
        if (d > 290) { z.x += Math.cos(a) * z.speed * dt; z.y += Math.sin(a) * z.speed * dt }
        else if (d < 230) { z.x -= Math.cos(a) * z.speed * dt; z.y -= Math.sin(a) * z.speed * dt }
        z.fireT -= dt
        if (z.fireT <= 0) { z.fireT = 1.6; spitAt(z) }
      } else if (z.kind === 'charger') {
        if (z.cstate === 'chase') {
          z.x += Math.cos(a) * z.speed * dt; z.y += Math.sin(a) * z.speed * dt
          if (d < 250) { z.cstate = 'windup'; z.t = 0.45 }
        } else if (z.cstate === 'windup') {
          z.t -= dt
          if (z.t <= 0) { z.cstate = 'dash'; z.t = 0.55; z.dvx = Math.cos(a) * 440; z.dvy = Math.sin(a) * 440 }
        } else {
          z.x += z.dvx * dt; z.y += z.dvy * dt; z.t -= dt
          if (d < player.r + z.r || z.t <= 0) { explodeAt(z.x, z.y, 96, 28, '#ff4d6d'); z.dead = true; z.hp = 0 }
        }
      } else {
        z.x += Math.cos(a) * z.speed * dt; z.y += Math.sin(a) * z.speed * dt
        if (z.boss) { z.fireT -= dt; if (z.fireT <= 0) { z.fireT = 1.4; bossVolley(z) } }
      }
      // 毒傷害
      if (z.poisonT > 0) { z.poisonT -= dt; hurtZombie(z, z.poisonDps * dt) }
      // 接觸玩家
      if (!z.dead && player.invincT <= 0 && d < player.r + z.r) {
        player.hp -= z.dmg * dt
        if (hurtSoundTimer <= 0) { sound.hurt(); hurtSoundTimer = 0.35 }
        if (player.hp <= 0) { player.hp = 0; return gameOver() }
      }
    }

    // 環繞檳榔傷害
    if (player.orbit > 0) {
      for (let i = 0; i < player.orbit; i++) {
        const a = orbAngle + (i * Math.PI * 2) / player.orbit
        const ox = player.x + Math.cos(a) * ORB_R, oy = player.y + Math.sin(a) * ORB_R
        for (const z of zombies) {
          if (z.dead) continue
          if (Math.hypot(z.x - ox, z.y - oy) < 13 + z.r) hurtZombie(z, player.dmg * 1.4 * dt)
        }
      }
    }

    // 敵方口水彈
    for (const eb of ebullets) {
      eb.x += eb.vx * dt; eb.y += eb.vy * dt; eb.life -= dt
      if (Math.hypot(player.x - eb.x, player.y - eb.y) < player.r + eb.r) {
        eb.life = 0
        if (player.invincT <= 0) {
          player.hp -= eb.dmg
          if (hurtSoundTimer <= 0) { sound.hurt(); hurtSoundTimer = 0.2 }
          if (player.hp <= 0) { player.hp = 0; return gameOver() }
        }
      }
    }
    ebullets = ebullets.filter((eb) => eb.life > 0 && eb.x > -20 && eb.x < W + 20 && eb.y > -20 && eb.y < H + 20)

    // 子彈 vs 殭屍（爆裂、毒、穿透）
    for (const b of bullets) {
      if (b.life <= 0) continue
      for (const z of zombies) {
        if (z.dead || b.hit.has(z)) continue
        if (Math.hypot(b.x - z.x, b.y - z.y) < b.r + z.r) {
          b.hit.add(z)
          burst(b.x, b.y, '#ff8fcf', 4)
          sound.hit()
          if (player.poison) { z.poisonT = 2; z.poisonDps = player.dmg * 0.25 * player.poison }
          hurtZombie(z, b.dmg)
          if (player.explosive) enemyExplode(b.x, b.y, 34 + player.explosive * 14, b.dmg * 0.5)
          if (b.pierceLeft <= 0) { b.life = 0; break } else b.pierceLeft--
        }
      }
    }

    // 道具（會逐漸消失）
    for (const pk of pickups) {
      pk.life -= dt
      if (Math.hypot(player.x - pk.x, player.y - pk.y) < player.r + pk.r) { applyPickup(pk); pk.dead = true }
    }
    pickups = pickups.filter((pk) => !pk.dead && pk.life > 0)

    bullets = bullets.filter((b) => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20)
    zombies = zombies.filter((z) => z.hp > 0)
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt }
    particles = particles.filter((p) => p.life > 0)

    if (shakeAmt > 0) shakeAmt = Math.max(0, shakeAmt - dt * 55)
    if (player.xp >= player.xpNext) startLevelUp()
    pushStats()
  }

  function startLevelUp() {
    levelingUp = true
    const pool = UPGRADES.filter((u) => !(u.capped && u.capped(player)))
    const choices = []
    const tmp = [...pool]
    for (let i = 0; i < 3 && tmp.length; i++) {
      const u = tmp.splice(Math.floor(Math.random() * tmp.length), 1)[0]
      choices.push({ id: u.id, icon: u.icon, name: u.name })
    }
    callbacks.onLevelUp?.(choices)
  }

  function choose(id) {
    const up = UPGRADES.find((u) => u.id === id)
    if (up) up.apply(player)
    player.xp -= player.xpNext
    player.level++
    player.xpNext = Math.round(5 + player.level * 3)
    levelingUp = false
    pushStats()
    if (player.xp >= player.xpNext) startLevelUp()
  }

  function drawEmoji(emoji, x, y, size) {
    ctx.font = `${size}px serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(emoji, x, y)
  }

  const PICK_EMOJI = { heart: '❤️', bomb: '💣', star: '⭐', rage: '⚡', coin: '💰' }

  function render() {
    ctx.fillStyle = '#16111f'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(168,85,247,0.10)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    ctx.save()
    if (shakeAmt > 0) ctx.translate((Math.random() * 2 - 1) * shakeAmt, (Math.random() * 2 - 1) * shakeAmt)

    for (const pk of pickups) {
      if (pk.life < 2 && Math.floor(pk.life * 6) % 2 === 0) continue // 快消失時閃爍
      drawEmoji(PICK_EMOJI[pk.type] || '❔', pk.x, pk.y, 26)
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    }
    ctx.globalAlpha = 1

    for (const eb of ebullets) {
      ctx.fillStyle = '#8ed13b'; ctx.shadowColor = '#3f7a25'; ctx.shadowBlur = 6
      ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.shadowBlur = 0

    for (const b of bullets) {
      const a = Math.atan2(b.vy, b.vx)
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a)
      ctx.fillStyle = '#6cb83f'
      ctx.beginPath(); ctx.ellipse(0, 0, b.r + 4, b.r, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#e3ecb4'
      ctx.beginPath(); ctx.ellipse(b.r + 3, 0, 2.6, 3, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    for (const z of zombies) {
      if (z.kind === 'charger' && z.cstate === 'windup') {
        ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r + 7, 0, Math.PI * 2); ctx.stroke()
      }
      if (z.poisonT > 0) { ctx.globalAlpha = 0.5; drawEmoji('☠️', z.x + z.r * 0.7, z.y - z.r * 0.7, 16); ctx.globalAlpha = 1 }
      drawEmoji(z.emoji, z.x, z.y, z.r * 2)
      if (z.boss) {
        const w = 80, hpr = z.hp / z.hpMax
        ctx.fillStyle = '#000'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w, 7)
        ctx.fillStyle = '#ff4d6d'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w * hpr, 7)
      }
    }

    // 環繞檳榔
    if (player.orbit > 0) {
      for (let i = 0; i < player.orbit; i++) {
        const a = orbAngle + (i * Math.PI * 2) / player.orbit
        const ox = player.x + Math.cos(a) * ORB_R, oy = player.y + Math.sin(a) * ORB_R
        ctx.fillStyle = '#6cb83f'; ctx.strokeStyle = '#3f7a25'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
    }

    // 玩家 + 狀態光環
    if (player.invincT > 0) { ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y, 30, 0, Math.PI * 2); ctx.stroke() }
    if (player.rageT > 0) { ctx.strokeStyle = '#ff7a3b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y, 26, 0, Math.PI * 2); ctx.stroke() }
    if (dogboOk) {
      const h = 84
      const w = h * (dogbo.width / dogbo.height)
      const faceRight = Math.cos(player.angle) >= 0
      ctx.save(); ctx.translate(player.x, player.y)
      if (faceRight) ctx.scale(-1, 1)
      ctx.drawImage(dogbo, -w * 0.5, -h * 0.5, w, h)
      ctx.restore()
    } else {
      ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill()
    }

    ctx.restore()

    if (isTouch && joy.id !== null) drawStick()
  }

  function drawStick() {
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, MAXR, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.5
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, m = Math.hypot(dx, dy)
    const r = Math.min(MAXR, m), a = Math.atan2(dy, dx)
    const kx = m > 0 ? joy.ox + Math.cos(a) * r : joy.ox
    const ky = m > 0 ? joy.oy + Math.sin(a) * r : joy.oy
    ctx.beginPath(); ctx.arc(kx, ky, 24, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
  }

  function loop(t) {
    if (!running) return
    const dt = Math.min(0.05, (t - lastTime) / 1000 || 0)
    lastTime = t
    if (!levelingUp) update(dt)
    if (!running) return
    render()
    raf = requestAnimationFrame(loop)
  }

  function gameOver() {
    running = false
    cancelAnimationFrame(raf)
    sound.gameOver()
    callbacks.onGameOver?.({ score, wave, coins: Math.round(coins * (bonus.coinMul || 1)), kills: killCount, bosses: bossKills })
  }

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }
  const onKeyDown = (e) => { keys[e.key.toLowerCase()] = true }
  const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false }
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') return
    if (joy.id === null) { const p = canvasPos(e); joy.id = e.pointerId; joy.ox = p.x; joy.oy = p.y; joy.x = p.x; joy.y = p.y }
  }
  const onPointerMove = (e) => { if (e.pointerId === joy.id) { const p = canvasPos(e); joy.x = p.x; joy.y = p.y } }
  const onPointerUp = (e) => { if (e.pointerId === joy.id) joy.id = null }

  function start() {
    reset(); running = true; lastTime = performance.now()
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

  return { start, stop, setMuted, choose }
}
