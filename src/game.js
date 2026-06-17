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

  // 敵人圖（CC0 俯視殭屍 + 各類型色調變體），載入前用 emoji 後備
  const ENEMY_KINDS = ['z', 'fast', 'tank', 'spitter', 'exploder', 'charger', 'boss']
  const enemyImgs = {}
  for (const k of ENEMY_KINDS) { const im = new Image(); im.src = `/enemy-${k}.png`; enemyImgs[k] = im }
  // 各魔王專屬配色圖（鍵：boss_<bossType>）
  for (const k of ['volley', 'summon', 'ring', 'charger', 'spiral', 'blink']) {
    const im = new Image(); im.src = `/enemy-boss-${k}.png`; enemyImgs['boss_' + k] = im
  }

  // 地板平鋪材質（CC0 柏油，ambientCG）
  const floorImg = new Image()
  let floorPat = null
  floorImg.onload = () => { floorPat = ctx.createPattern(floorImg, 'repeat') }
  floorImg.src = '/floor.png'

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
  let levelingUp, shakeAmt, coins, killCount, bossKills, orbAngle, pendingBossType
  let floaters, combo, comboTimer, hurtFlash, paused

  const DASH_CD = 1.2     // 衝刺冷卻（秒）
  const DASH_TIME = 0.18  // 衝刺持續（含無敵）
  const DASH_SPEED = 900  // 衝刺速度

  const BOSS_TYPES = [
    { key: 'volley', name: '彈幕王', emoji: '👹', color: '#c86eff' },
    { key: 'summon', name: '召喚王', emoji: '🧛', color: '#eb4650' },
    { key: 'ring', name: '環射王', emoji: '👻', color: '#96d2ff' },
    { key: 'charger', name: '衝撞王', emoji: '🐗', color: '#eb9646' },
    { key: 'spiral', name: '螺旋王', emoji: '🌀', color: '#50dcc8' },
    { key: 'blink', name: '瞬移王', emoji: '🧿', color: '#ff5fc8' },
  ]

  // 特殊波次：某些波改成主題型生怪（min = 解鎖波數）
  const SPECIAL_WAVES = [
    { key: 'swarm', name: '⚡ 快速狂潮', min: 3, build: (n) => Array(Math.round(n * 1.5)).fill('fast') },
    { key: 'tankwall', name: '🛡️ 坦克陣', min: 5, build: (n) => { const a = []; const t = Math.round(n * 0.45); for (let i = 0; i < t; i++) a.push('tank'); for (let i = 0; i < n - t; i++) a.push('z'); return a } },
    { key: 'boom', name: '💥 爆破危機', min: 4, build: (n) => Array.from({ length: n }, () => (Math.random() < 0.6 ? 'exploder' : 'fast')) },
    { key: 'toxic', name: '🤮 毒氣瀰漫', min: 4, build: (n) => Array.from({ length: n }, () => (Math.random() < 0.55 ? 'spitter' : 'z')) },
    { key: 'rush', name: '🐗 衝撞狂潮', min: 6, build: (n) => Array.from({ length: n }, () => (Math.random() < 0.5 ? 'charger' : 'fast')) },
  ]

  // 場景主題：每 10 波換一個區域氛圍
  const STAGE_THEMES = [
    { name: '紫夜街區', base: '#16111f', grid: 'rgba(168,85,247,0.10)', tint: null },
    { name: '黃昏廢墟', base: '#1c1410', grid: 'rgba(255,170,80,0.10)', tint: 'rgba(255,140,40,0.10)' },
    { name: '血月墓園', base: '#1a0e10', grid: 'rgba(255,70,90,0.12)', tint: 'rgba(200,30,50,0.13)' },
    { name: '極夜冰原', base: '#0e1320', grid: 'rgba(90,150,255,0.12)', tint: 'rgba(60,110,220,0.12)' },
  ]
  const currentTheme = () => STAGE_THEMES[Math.floor((Math.max(1, wave) - 1) / 10) % STAGE_THEMES.length]

  const UPGRADES = [
    // —— 輸出 ——
    { id: 'dmg', icon: '💥', name: '傷害 +9', apply: (p) => { p.dmg += 9 } },
    { id: 'rate', icon: '⚡', name: '攻速 +10%', apply: (p) => { p.fireCd = Math.max(0.07, p.fireCd * 0.9) } },
    { id: 'multi', icon: '🔱', name: '多重彈 +1', apply: (p) => { p.multishot += 1 }, capped: (p) => p.multishot >= 5 },
    { id: 'pierce', icon: '➡️', name: '穿透 +1', apply: (p) => { p.pierce += 1 }, capped: (p) => p.pierce >= 4 },
    { id: 'crit', icon: '🎯', name: '暴擊 +12%（2.2倍傷害）', apply: (p) => { p.crit += 0.12 }, capped: (p) => p.crit >= 0.6 - 1e-6 },
    // —— 特殊彈 ——
    { id: 'explosive', icon: '🧨', name: '爆裂彈（命中爆炸）', apply: (p) => { p.explosive += 1 }, capped: (p) => p.explosive >= 3 },
    { id: 'poison', icon: '☠️', name: '毒彈（毒死會擴散感染）', apply: (p) => { p.poison += 1 }, capped: (p) => p.poison >= 4, weight: 1.3 },
    { id: 'bounce', icon: '🪃', name: '彈跳 +1（撞牆反彈）', apply: (p) => { p.bounce += 1 }, capped: (p) => p.bounce >= 3 },
    // —— 防禦／控場 ——
    { id: 'hp', icon: '❤️', name: '最大血量 +30（補30血）', apply: (p) => { p.hpMax += 30; p.hp = Math.min(p.hpMax, p.hp + 30) } },
    { id: 'lifesteal', icon: '🩸', name: '吸血 +0.5（擊殺回血）', apply: (p) => { p.lifesteal += 0.5 }, capped: (p) => p.lifesteal >= 2.5 - 1e-6 },
    { id: 'orbit', icon: '🛡️', name: '環繞檳榔 +1（旋轉護體＋擊退）', apply: (p) => { p.orbit += 1 }, capped: (p) => p.orbit >= 5, weight: 1.3 },
    { id: 'knockback', icon: '👊', name: '擊退 +1（子彈推開殭屍）', apply: (p) => { p.knockback += 1 }, capped: (p) => p.knockback >= 3 },
    { id: 'slow', icon: '🕸️', name: '緩速光環（拖慢周圍殭屍）', apply: (p) => { p.slow += 1 }, capped: (p) => p.slow >= 3, weight: 1.2 },
  ]

  // 滿級進化：某升級點滿後出現，選了就質變（每種一次、權重高更易出現）
  const EVOLUTIONS = [
    { id: 'evo_multi', icon: '🌟', name: '✨爆音波·全方位環射', weight: 3, when: (p) => p.multishot >= 5 && !p.multiEvo, apply: (p) => { p.multiEvo = true } },
    { id: 'evo_pierce', icon: '🌟', name: '✨貫穿之雷·無限穿透', weight: 3, when: (p) => p.pierce >= 4 && !p.pierceEvo, apply: (p) => { p.pierceEvo = true } },
    { id: 'evo_explosive', icon: '🌟', name: '✨核爆彈·大範圍爆炸', weight: 3, when: (p) => p.explosive >= 3 && !p.explosiveEvo, apply: (p) => { p.explosiveEvo = true } },
    { id: 'evo_poison', icon: '🌟', name: '✨劇毒瘟疫·毒霧蔓延', weight: 3, when: (p) => p.poison >= 4 && !p.poisonEvo, apply: (p) => { p.poisonEvo = true } },
    { id: 'evo_orbit', icon: '🌟', name: '✨檳榔風暴·高速大護體', weight: 3, when: (p) => p.orbit >= 5 && !p.orbitEvo, apply: (p) => { p.orbitEvo = true } },
  ]

  function reset() {
    const hpMax = 100 + (bonus.hpAdd || 0)
    player = {
      x: W / 2, y: H * 0.64, r: 13, angle: 0, cd: 0,
      hp: hpMax, hpMax, speed: 230 * (bonus.speedMul || 1),
      dmg: 26 * (bonus.dmgMul || 1), fireCd: 0.18 * (bonus.rateMul || 1),
      bulletSpeed: 620, multishot: 1, pierce: 0,
      explosive: 0, poison: 0, lifesteal: 0, bounce: 0, orbit: 0,
      crit: 0, knockback: 0, slow: 0,
      multiEvo: false, pierceEvo: false, explosiveEvo: false, poisonEvo: false, orbitEvo: false,
      dashCd: 0, dashT: 0, dashDx: 0, dashDy: 0,
      invincT: 0, rageT: 0,
      xp: 0, level: 1, xpNext: 5,
    }
    bullets = []; zombies = []; particles = []; pickups = []; ebullets = []; floaters = []
    score = 0; coins = 0; killCount = 0; bossKills = 0; orbAngle = 0
    combo = 0; comboTimer = 0; hurtFlash = 0; paused = false
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
      combo,
      dashRatio: Math.max(0, Math.min(1, 1 - player.dashCd / DASH_CD)),
    })
  }

  function nextWave() {
    wave++
    const isBoss = wave % 5 === 0
    spawnInterval = Math.max(0.1, 0.48 - wave * 0.045)
    spawnQueue = []
    let bossName = '', waveLabel = ''
    if (isBoss) {
      const bt = BOSS_TYPES[(wave / 5 - 1) % BOSS_TYPES.length]
      pendingBossType = bt.key
      bossName = bt.name
      spawnQueue.push('boss')
      for (let i = 0; i < 6 + wave * 1.5; i++) {
        const r = Math.random()
        spawnQueue.push(r < 0.32 ? 'tank' : r < 0.55 ? 'fast' : 'z')
      }
      sound.bossSpawn()
    } else {
      const n = Math.round(8 + wave * 3.5)
      const specials = SPECIAL_WAVES.filter((s) => wave >= s.min)
      if (specials.length && wave >= 3 && Math.random() < 0.45) {
        const sp = specials[Math.floor(Math.random() * specials.length)]
        spawnQueue = sp.build(n)
        waveLabel = sp.name
      } else {
        const pool = ['z', 'z', 'fast']
        if (wave >= 3) pool.push('tank', 'fast')
        if (wave >= 4) pool.push('spitter', 'exploder')
        if (wave >= 6) pool.push('charger', 'tank')
        for (let i = 0; i < n; i++) spawnQueue.push(pool[Math.floor(Math.random() * pool.length)])
      }
    }
    // 進入新區域 → 蓋過標籤，提示區域名
    if (wave > 1 && (wave - 1) % 10 === 0) waveLabel = `🌍 ${currentTheme().name}`
    spawnTimer = 0
    sound.waveStart()
    callbacks.onWaveStart?.(wave, isBoss, bossName, waveLabel)
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
      const bt = BOSS_TYPES.find((b) => b.key === pendingBossType) || BOSS_TYPES[0]
      let bhp = Math.round(2900 + wave * 540 + q * 23)
      if (bt.key === 'charger') bhp = Math.round(bhp * 2) // 衝撞王血量加倍
      zombies.push({ x, y, r: 46, speed: Math.min(135, 60 + wave * 2), hp: bhp, hpMax: bhp, dmg: 85, value: 250, xp: 8, coin: 60, boss: true, kind: 'boss', bossType: bt.key, fireT: 2, cstate: 'chase', t: 0, emoji: bt.emoji, color: bt.color })
      shake(16)
    } else if (type === 'charger') {
      const chp = Math.round(100 + wave * 18 + q * 0.9)
      zombies.push({ x, y, r: 16, speed: Math.min(165, 100 + wave * 2), hp: chp, hpMax: chp, dmg: 20, value: 25, xp: 2, coin: 5, kind: 'charger', cstate: 'chase', t: 0, emoji: '😡' })
    } else if (type === 'tank') {
      const thp = Math.round(260 + wave * 52 + q * 3.2)
      zombies.push({ x, y, r: 27, speed: Math.min(160, 48 + wave * 2), hp: thp, hpMax: thp, dmg: 48, value: 40, xp: 3, coin: 6, kind: 'tank', emoji: '🧟‍♂️' })
    } else if (type === 'exploder') {
      const ehp = Math.round(110 + wave * 22 + q * 1.3)
      zombies.push({ x, y, r: 15, speed: Math.min(205, 82 + wave * 4), hp: ehp, hpMax: ehp, dmg: 28, value: 20, xp: 2, coin: 4, kind: 'exploder', emoji: '🤢' })
    } else if (type === 'spitter') {
      const shp = Math.round(100 + wave * 18 + q * 1.2)
      zombies.push({ x, y, r: 15, speed: Math.min(170, 86 + wave * 2), hp: shp, hpMax: shp, dmg: 18, value: 20, xp: 2, coin: 4, kind: 'spitter', fireT: 1.8, emoji: '🤮' })
    } else if (type === 'fast') {
      const fhp = Math.round(45 + wave * 12 + q * 0.8)
      zombies.push({ x, y, r: 13, speed: Math.min(340, 143 + wave * 6), hp: fhp, hpMax: fhp, dmg: 38, value: 15, xp: 1, coin: 3, kind: 'fast', emoji: '🧟‍♀️' })
    } else {
      const zhp = Math.round(85 + wave * 22 + q * 1.4)
      zombies.push({ x, y, r: 17, speed: Math.min(220, 74 + wave * 5), hp: zhp, hpMax: zhp, dmg: 34, value: 10, xp: 1, coin: 2, kind: 'z', emoji: '🧟' })
    }
  }

  function fire() {
    if (player.cd > 0) return
    player.cd = player.fireCd * (player.rageT > 0 ? 0.5 : 1)
    const evo = player.multiEvo
    const n = evo ? player.multishot + 5 : player.multishot // 進化：全方位環射
    const step = evo ? (Math.PI * 2) / n : 0.14
    const base = evo ? player.angle : player.angle - (0.14 * (n - 1)) / 2
    for (let i = 0; i < n; i++) {
      const a = base + step * i
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

  // 就地壓縮陣列（取代每幀 filter 的重新配置，減少 GC）
  function compact(arr, keep) {
    let n = 0
    for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[n++] = arr[i]
    arr.length = n
  }

  function explodeAt(x, y, radius, dmg, color) {
    burst(x, y, color || '#ff7a3b', 30)
    shake(12)
    sound.kill()
    if (!invulnerable() && Math.hypot(player.x - x, player.y - y) < radius + player.r) {
      player.hp -= dmg
      hurtFlash = 1
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

  // 擊退：給殭屍一個離開來源方向的速度（會在 AI 迴圈逐漸衰減）；王／坦克較重
  function applyKnock(z, ang, force) {
    if (z.dead) return
    if (z.boss) force *= 0.12
    else if (z.kind === 'tank') force *= 0.45
    z.kx = (z.kx || 0) + Math.cos(ang) * force
    z.ky = (z.ky || 0) + Math.sin(ang) * force
    const m = Math.hypot(z.kx, z.ky), cap = 520
    if (m > cap) { z.kx = (z.kx / m) * cap; z.ky = (z.ky / m) * cap }
  }

  // 毒擴散：毒死的殭屍會把毒感染給周圍（進化後範圍更大、毒更強）
  function spreadPoison(z) {
    const R = player.poisonEvo ? 95 : 60
    burst(z.x, z.y, '#7CFC00', player.poisonEvo ? 16 : 9)
    const dps = player.dmg * 0.7 * player.poison * (player.poisonEvo ? 1.8 : 1)
    for (const o of zombies) {
      if (o.dead || o === z || o.poisonT > 0) continue
      if (Math.hypot(o.x - z.x, o.y - z.y) < R + o.r) { o.poisonT = 4; o.poisonDps = dps }
    }
  }

  // 無敵判定（吃星星 or 衝刺中）
  function invulnerable() { return player.invincT > 0 || player.dashT > 0 }

  // 飄字傷害數字
  function addFloater(x, y, amount, crit) {
    floaters.push({ x: x + (Math.random() * 10 - 5), y, vy: -46, life: 0.7, text: Math.round(amount), crit })
  }

  // 衝刺/翻滾：往移動方向（無輸入則面向）高速位移，期間無敵
  function dash() {
    if (!running || levelingUp || paused) return
    if (player.dashT > 0 || player.dashCd > 0) return
    let dx = 0, dy = 0
    if (joy.id !== null) { dx = joy.x - joy.ox; dy = joy.y - joy.oy }
    else {
      if (keys['w'] || keys['arrowup']) dy -= 1
      if (keys['s'] || keys['arrowdown']) dy += 1
      if (keys['a'] || keys['arrowleft']) dx -= 1
      if (keys['d'] || keys['arrowright']) dx += 1
    }
    let m = Math.hypot(dx, dy)
    if (m < 0.01) { dx = Math.cos(player.angle); dy = Math.sin(player.angle); m = 1 }
    player.dashDx = dx / m; player.dashDy = dy / m
    player.dashT = DASH_TIME
    player.dashCd = DASH_CD
    shake(5)
    burst(player.x, player.y, '#22d3ee', 12)
    sound.dash()
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

  function bossSummon() {
    // 從四面八方生怪（spawnOne 會在隨機邊緣生成），避免被彈幕一次掃光
    const kinds = ['fast', 'fast', 'tank', 'spitter', 'fast']
    for (const k of kinds) spawnOne(k)
    shake(6)
  }

  function bossRing(z) {
    z.ringPhase = (z.ringPhase || 0) + 0.45 // 每次旋轉錯位，縫隙會移動更難閃
    const cnt = 26, sp = 250
    for (let i = 0; i < cnt; i++) {
      const a = z.ringPhase + (i / cnt) * Math.PI * 2
      ebullets.push({ x: z.x, y: z.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 9, dmg: 20, life: 4.5 })
    }
    shake(8)
  }

  function bossSpiral(z) {
    z.ringPhase = (z.ringPhase || 0) + 0.5 // 連續旋轉 → 螺旋彈道
    const arms = 3, sp = 235
    for (let k = 0; k < arms; k++) {
      const a = z.ringPhase + (k / arms) * Math.PI * 2
      ebullets.push({ x: z.x, y: z.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 9, dmg: 18, life: 4 })
    }
  }

  function bossBlink(z) {
    // 瞬移到玩家附近 + 全方位爆射
    const ang = Math.random() * Math.PI * 2, dist = 150 + Math.random() * 120
    z.x = Math.max(60, Math.min(W - 60, player.x + Math.cos(ang) * dist))
    z.y = Math.max(60, Math.min(H - 60, player.y + Math.sin(ang) * dist))
    burst(z.x, z.y, '#b061ff', 20); shake(8)
    const n = 14, sp = 230
    for (let i = 0; i < n; i++) { const aa = (i / n) * Math.PI * 2; ebullets.push({ x: z.x, y: z.y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, r: 10, dmg: 20, life: 4 }) }
  }

  function bossAI(z, dt, a, d) {
    const cos = Math.cos(a), sin = Math.sin(a)
    z.fireT -= dt
    if (z.bossType === 'spiral') {
      z.x += cos * z.speed * 0.55 * dt; z.y += sin * z.speed * 0.55 * dt
      if (z.fireT <= 0) { z.fireT = 0.16; bossSpiral(z) }
    } else if (z.bossType === 'blink') {
      z.x += cos * z.speed * 0.8 * dt; z.y += sin * z.speed * 0.8 * dt
      if (z.fireT <= 0) { z.fireT = 1.8; bossBlink(z) }
    } else if (z.bossType === 'summon') {
      z.x += cos * z.speed * 0.7 * dt; z.y += sin * z.speed * 0.7 * dt
      if (z.fireT <= 0) { z.fireT = 2.2; bossSummon(z) }
    } else if (z.bossType === 'ring') {
      z.x += cos * z.speed * 0.7 * dt; z.y += sin * z.speed * 0.7 * dt
      if (z.fireT <= 0) { z.fireT = 1.3; bossRing(z) }
    } else if (z.bossType === 'charger') {
      if (z.cstate === 'chase') { z.x += cos * z.speed * dt; z.y += sin * z.speed * dt; if (d < 340) { z.cstate = 'windup'; z.t = 0.6 } }
      else if (z.cstate === 'windup') { z.t -= dt; if (z.t <= 0) { z.cstate = 'dash'; z.t = 0.7; z.dvx = cos * 640; z.dvy = sin * 640 } }
      else { z.x += z.dvx * dt; z.y += z.dvy * dt; z.t -= dt; if (z.t <= 0) z.cstate = 'chase' }
    } else {
      z.x += cos * z.speed * dt; z.y += sin * z.speed * dt
      if (z.fireT <= 0) { z.fireT = 1.4; bossVolley(z) }
    }
  }

  function onKill(z) {
    if (z.dead) return
    z.dead = true
    score += z.value || 0
    player.xp += z.xp || 0
    coins += z.coin || 0
    killCount++
    combo++; comboTimer = 2
    if (z.boss) bossKills++
    if (player.lifesteal) player.hp = Math.min(player.hpMax, player.hp + player.lifesteal)
    if (z.kind === 'exploder') explodeAt(z.x, z.y, 82, 30)
    else if (z.kind === 'charger') explodeAt(z.x, z.y, 96, 28, '#ff4d6d')
    else { burst(z.x, z.y, z.boss ? '#ffd23f' : '#a855f7', z.boss ? 28 : 10); sound.kill() }
    if (z.boss) shake(18)
    if (player.poison && z.poisonT > 0) spreadPoison(z)
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
    orbAngle += dt * (player.orbitEvo ? 4.8 : 2.6)

    // 計時器：衝刺
    if (player.dashCd > 0) player.dashCd -= dt
    hurtFlash = Math.max(0, hurtFlash - dt * 3)
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0 }
    for (const f of floaters) { f.y += f.vy * dt; f.vy += 80 * dt; f.life -= dt }
    compact(floaters, (f) => f.life > 0)

    // 移動
    const clampX = (v) => Math.max(player.r, Math.min(W - player.r, v))
    const clampY = (v) => Math.max(player.r, Math.min(H - player.r, v))
    if (player.dashT > 0) {
      // 衝刺中：固定方向高速位移
      player.dashT -= dt
      player.x = clampX(player.x + player.dashDx * DASH_SPEED * dt)
      player.y = clampY(player.y + player.dashDy * DASH_SPEED * dt)
      if (Math.random() < 0.6) burst(player.x, player.y, '#22d3ee', 1) // 殘影
    } else {
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
        player.x = clampX(player.x + (dx / len) * spd * factor * dt)
        player.y = clampY(player.y + (dy / len) * spd * factor * dt)
      }
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
    } else if (zombies.some((z) => z.boss)) {
      // 王還活著 → 持續補怪
      spawnTimer -= dt
      if (spawnTimer <= 0) { spawnTimer = 1.0; spawnOne(Math.random() < 0.35 ? 'fast' : 'z') }
    } else if (zombies.length === 0) { betweenWaves = true; betweenTimer = 1.2 }

    // 殭屍 AI + 毒
    hurtSoundTimer -= dt
    for (const z of zombies) {
      if (z.dead) continue
      const a = Math.atan2(player.y - z.y, player.x - z.x)
      const d = Math.hypot(player.x - z.x, player.y - z.y)
      // 緩速光環：靠近玩家的殭屍變慢（暫時縮放速度，本幀結束還原）
      const realSpeed = z.speed
      if (player.slow > 0 && d < 120 + player.slow * 30) z.speed *= 1 - Math.min(0.62, 0.18 * player.slow)
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
      } else if (z.boss) {
        bossAI(z, dt, a, d)
      } else {
        z.x += Math.cos(a) * z.speed * dt; z.y += Math.sin(a) * z.speed * dt
      }
      z.speed = realSpeed
      // 擊退位移（逐漸衰減）
      if (z.kx || z.ky) {
        z.x += z.kx * dt; z.y += z.ky * dt
        const k = Math.max(0, 1 - dt * 6)
        z.kx *= k; z.ky *= k
        if (Math.abs(z.kx) < 3 && Math.abs(z.ky) < 3) { z.kx = 0; z.ky = 0 }
      }
      // 毒傷害
      if (z.poisonT > 0) { z.poisonT -= dt; hurtZombie(z, z.poisonDps * dt) }
      // 接觸玩家
      if (!z.dead && !invulnerable() && d < player.r + z.r) {
        player.hp -= z.dmg * dt
        hurtFlash = 1
        if (hurtSoundTimer <= 0) { sound.hurt(); hurtSoundTimer = 0.35 }
        if (player.hp <= 0) { player.hp = 0; return gameOver() }
      }
    }

    // 環繞檳榔傷害（貼身防禦：大判定、高傷、命中擊退；進化更猛）
    if (player.orbit > 0) {
      const orbR = ORB_R + (player.orbitEvo ? 26 : 0)
      const hitR = player.orbitEvo ? 30 : 22
      const dps = player.dmg * (player.orbitEvo ? 6 : 4.2)
      const push = player.orbitEvo ? 240 : 150
      for (let i = 0; i < player.orbit; i++) {
        const a = orbAngle + (i * Math.PI * 2) / player.orbit
        const ox = player.x + Math.cos(a) * orbR, oy = player.y + Math.sin(a) * orbR
        for (const z of zombies) {
          if (z.dead) continue
          if (Math.hypot(z.x - ox, z.y - oy) < hitR + z.r) {
            hurtZombie(z, dps * dt)
            applyKnock(z, Math.atan2(z.y - player.y, z.x - player.x), push)
          }
        }
      }
    }

    // 敵方口水彈
    for (const eb of ebullets) {
      eb.x += eb.vx * dt; eb.y += eb.vy * dt; eb.life -= dt
      if (Math.hypot(player.x - eb.x, player.y - eb.y) < player.r + eb.r) {
        eb.life = 0
        if (!invulnerable()) {
          player.hp -= eb.dmg
          hurtFlash = 1
          if (hurtSoundTimer <= 0) { sound.hurt(); hurtSoundTimer = 0.2 }
          if (player.hp <= 0) { player.hp = 0; return gameOver() }
        }
      }
    }
    compact(ebullets, (eb) => eb.life > 0 && eb.x > -20 && eb.x < W + 20 && eb.y > -20 && eb.y < H + 20)

    // 子彈 vs 殭屍（爆裂、毒、穿透）
    for (const b of bullets) {
      if (b.life <= 0) continue
      for (const z of zombies) {
        if (z.dead || b.hit.has(z)) continue
        if (Math.hypot(b.x - z.x, b.y - z.y) < b.r + z.r) {
          b.hit.add(z)
          sound.hit()
          // 暴擊
          let dmg = b.dmg
          const isCrit = player.crit > 0 && Math.random() < player.crit
          if (isCrit) { dmg *= 2.2; burst(b.x, b.y, '#ffd23f', 7) }
          else burst(b.x, b.y, '#ff8fcf', 4)
          addFloater(z.x, z.y - z.r, dmg, isCrit)
          // 毒彈（毒傷隨傷害與層數提升，進化更毒）
          if (player.poison) { z.poisonT = 4; z.poisonDps = player.dmg * 0.7 * player.poison * (player.poisonEvo ? 1.8 : 1) }
          hurtZombie(z, dmg)
          if (player.explosive) enemyExplode(b.x, b.y, (34 + player.explosive * 14) * (player.explosiveEvo ? 1.9 : 1), b.dmg * (player.explosiveEvo ? 0.9 : 0.5))
          if (player.knockback) applyKnock(z, Math.atan2(b.vy, b.vx), 80 * player.knockback)
          if (player.pierceEvo) continue // 進化：無限穿透，子彈不因命中而消失
          if (b.pierceLeft <= 0) { b.life = 0; break } else b.pierceLeft--
        }
      }
    }

    // 道具（會逐漸消失）
    for (const pk of pickups) {
      pk.life -= dt
      if (Math.hypot(player.x - pk.x, player.y - pk.y) < player.r + pk.r) { applyPickup(pk); pk.dead = true }
    }
    compact(pickups, (pk) => !pk.dead && pk.life > 0)

    compact(bullets, (b) => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20)
    compact(zombies, (z) => z.hp > 0)
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt }
    compact(particles, (p) => p.life > 0)

    if (shakeAmt > 0) shakeAmt = Math.max(0, shakeAmt - dt * 55)
    if (player.xp >= player.xpNext) startLevelUp()
    pushStats()
  }

  function startLevelUp() {
    levelingUp = true
    const avail = [
      ...UPGRADES.filter((u) => !(u.capped && u.capped(player))),
      ...EVOLUTIONS.filter((e) => e.when(player)),
    ]
    const choices = []
    while (choices.length < 3 && avail.length) {
      let total = 0
      for (const u of avail) total += u.weight || 1
      let r = Math.random() * total
      let idx = 0
      for (let i = 0; i < avail.length; i++) { r -= avail[i].weight || 1; if (r <= 0) { idx = i; break } }
      const u = avail.splice(idx, 1)[0]
      choices.push({ id: u.id, icon: u.icon, name: u.name })
    }
    callbacks.onLevelUp?.(choices)
  }

  function choose(id) {
    const up = UPGRADES.find((u) => u.id === id) || EVOLUTIONS.find((e) => e.id === id)
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

  // 畫敵人：sprite 預設朝上，旋轉成面向玩家；未載入則用 emoji 後備
  function drawEnemy(z) {
    const img = (z.boss && enemyImgs['boss_' + z.bossType]) || enemyImgs[z.kind]
    if (img && img.complete && img.naturalWidth) {
      const fa = Math.atan2(player.y - z.y, player.x - z.x)
      const h = z.r * 2.6
      const w = h * (img.naturalWidth / img.naturalHeight)
      ctx.save()
      ctx.translate(z.x, z.y)
      ctx.rotate(fa + Math.PI / 2)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
    } else {
      drawEmoji(z.emoji, z.x, z.y, z.r * 2)
    }
  }

  // 荖葉包紅灰檳榔（前端 +x 為切口），子彈與環繞護體共用
  function drawBetelNut(cx, cy, ang, R) {
    const L = R + 4
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang)
    ctx.fillStyle = '#356b1f' // 深綠葉緣
    ctx.beginPath(); ctx.ellipse(0, 0, L, R, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#6cb83f' // 亮綠檳榔身
    ctx.beginPath(); ctx.ellipse(-0.4, 0, L - 1.6, R - 1.6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(227,236,180,0.65)' // 高光
    ctx.beginPath(); ctx.ellipse(-L * 0.18, -R * 0.32, L * 0.42, R * 0.3, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#f3f0d8' // 前端白色切口
    ctx.beginPath(); ctx.ellipse(L - 2.2, 0, 2.3, R * 0.7, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#d23b3b' // 中心紅灰
    ctx.beginPath(); ctx.arc(L - 2.2, 0, Math.max(1, R * 0.32), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  const PICK_EMOJI = { heart: '❤️', bomb: '💣', star: '⭐', rage: '⚡', coin: '💰' }

  function render() {
    const th = currentTheme()
    ctx.fillStyle = th.base
    ctx.fillRect(0, 0, W, H)
    if (floorPat) { ctx.fillStyle = floorPat; ctx.fillRect(0, 0, W, H) }
    if (th.tint) { ctx.fillStyle = th.tint; ctx.fillRect(0, 0, W, H) }
    ctx.strokeStyle = th.grid
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

    // 敵方子彈＝紫色毒液球（外暈取代 shadowBlur，省效能）
    for (const eb of ebullets) {
      ctx.fillStyle = 'rgba(196,77,255,0.22)' // 外暈
      ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r + 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#6a1b9a' // 外圈暗紫
      ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#c44dff' // 毒液本體
      ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r * 0.72, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#f0c8ff' // 高光
      ctx.beginPath(); ctx.arc(eb.x - eb.r * 0.28, eb.y - eb.r * 0.28, eb.r * 0.32, 0, Math.PI * 2); ctx.fill()
    }

    // 子彈＝飛行中的檳榔，切口朝飛行方向
    for (const b of bullets) {
      drawBetelNut(b.x, b.y, Math.atan2(b.vy, b.vx), b.r)
    }

    for (const z of zombies) {
      if (z.cstate === 'windup' && (z.kind === 'charger' || z.bossType === 'charger')) {
        const wa = Math.atan2(player.y - z.y, player.x - z.x)
        ctx.strokeStyle = 'rgba(255,77,109,0.45)'
        ctx.lineWidth = z.boss ? 11 : 6
        ctx.beginPath(); ctx.moveTo(z.x, z.y); ctx.lineTo(z.x + Math.cos(wa) * 470, z.y + Math.sin(wa) * 470); ctx.stroke()
        if (Math.floor(performance.now() / 110) % 2 === 0) {
          ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 5
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r + 12, 0, Math.PI * 2); ctx.stroke()
        }
      }
      if (z.poisonT > 0) { ctx.globalAlpha = 0.5; drawEmoji('☠️', z.x + z.r * 0.7, z.y - z.r * 0.7, 16); ctx.globalAlpha = 1 }
      if (z.boss) {
        // 專屬配色光環（脈動）
        const pulse = z.r + 8 + Math.sin(performance.now() / 200) * 4
        ctx.strokeStyle = z.color || '#c86eff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.6
        ctx.beginPath(); ctx.arc(z.x, z.y, pulse, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1
      }
      drawEnemy(z)
      if (z.boss) {
        // 王冠標記（類型 emoji）
        drawEmoji(z.emoji, z.x, z.y - z.r - 24, 26)
        const w = 80, hpr = z.hp / z.hpMax
        ctx.fillStyle = '#000'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w, 7)
        ctx.fillStyle = z.color || '#ff4d6d'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w * hpr, 7)
      }
    }

    // 緩速光環
    if (player.slow > 0) {
      const sr = 120 + player.slow * 30
      ctx.fillStyle = 'rgba(120,180,255,0.06)'
      ctx.beginPath(); ctx.arc(player.x, player.y, sr, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(140,190,255,0.28)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8])
      ctx.beginPath(); ctx.arc(player.x, player.y, sr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    }

    // 環繞檳榔（護體）
    if (player.orbit > 0) {
      const orbR = ORB_R + (player.orbitEvo ? 26 : 0)
      const nutR = player.orbitEvo ? 11 : 8
      for (let i = 0; i < player.orbit; i++) {
        const a = orbAngle + (i * Math.PI * 2) / player.orbit
        const ox = player.x + Math.cos(a) * orbR, oy = player.y + Math.sin(a) * orbR
        drawBetelNut(ox, oy, a + Math.PI / 2, nutR)
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

    // 傷害飄字
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 2.4)
      ctx.font = `700 ${f.crit ? 22 : 15}px "Microsoft JhengHei", sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.strokeText(f.text, f.x, f.y)
      ctx.fillStyle = f.crit ? '#ffd23f' : '#fff'
      ctx.fillText(f.text, f.x, f.y)
    }
    ctx.globalAlpha = 1

    ctx.restore()

    // 受傷紅閃（畫面邊緣暈紅）
    if (hurtFlash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.62)
      g.addColorStop(0, 'rgba(255,0,40,0)')
      g.addColorStop(1, `rgba(255,0,40,${0.5 * hurtFlash})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    // 場外威脅指示箭頭（魔王／衝撞王）
    const margin = 22
    for (const z of zombies) {
      if (z.dead || !(z.boss || z.kind === 'charger')) continue
      if (z.x >= margin && z.x <= W - margin && z.y >= margin && z.y <= H - margin) continue
      const ang = Math.atan2(z.y - H / 2, z.x - W / 2)
      const dirx = Math.cos(ang), diry = Math.sin(ang)
      const tx = dirx !== 0 ? (W / 2 - margin) / Math.abs(dirx) : Infinity
      const ty = diry !== 0 ? (H / 2 - margin) / Math.abs(diry) : Infinity
      const t = Math.min(tx, ty)
      const ax = W / 2 + dirx * t, ay = H / 2 + diry * t
      const size = z.boss ? 16 : 10
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.globalAlpha = 0.9
      ctx.fillStyle = z.boss ? (z.color || '#ff4d6d') : '#ff5a5a'
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.7); ctx.lineTo(-size * 0.7, -size * 0.7); ctx.closePath(); ctx.fill()
      ctx.restore(); ctx.globalAlpha = 1
      if (z.boss) drawEmoji(z.emoji, ax - dirx * 22, ay - diry * 22, 20)
    }

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
    if (!levelingUp && !paused) update(dt)
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
  const onKeyDown = (e) => {
    keys[e.key.toLowerCase()] = true
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); dash() }
  }
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
  function setPaused(p) { paused = p; if (!p) lastTime = performance.now() }

  return { start, stop, setMuted, choose, dash, setPaused }
}
