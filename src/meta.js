// 局外永久養成：金幣 + 強化等級，存在 localStorage
const KEY = 'as-meta'

export const META_UPGRADES = [
  { id: 'atk', icon: '💥', name: '攻擊力', desc: '每級 +10% 傷害', max: 12, baseCost: 60 },
  { id: 'hp', icon: '❤️', name: '最大血量', desc: '每級 +20 血', max: 12, baseCost: 60 },
  { id: 'rate', icon: '⚡', name: '攻速', desc: '每級 +5% 攻速', max: 10, baseCost: 80 },
  { id: 'speed', icon: '👟', name: '移速', desc: '每級 +4% 移速', max: 8, baseCost: 70 },
  { id: 'coin', icon: '💰', name: '金幣加成', desc: '每級 +15% 金幣', max: 8, baseCost: 50 },
]

export const ACHIEVEMENTS = [
  { id: 'kill100', icon: '🧟', name: '除殭屍新手', desc: '累積擊殺 100 隻', stat: 'kills', goal: 100, reward: 100 },
  { id: 'kill1000', icon: '🧟', name: '殭屍剋星', desc: '累積擊殺 1000 隻', stat: 'kills', goal: 1000, reward: 400 },
  { id: 'kill5000', icon: '🧟', name: '清道夫', desc: '累積擊殺 5000 隻', stat: 'kills', goal: 5000, reward: 1500 },
  { id: 'wave5', icon: '🌊', name: '初試啼聲', desc: '單局撐到第 5 波', stat: 'bestWave', goal: 5, reward: 80 },
  { id: 'wave10', icon: '🌊', name: '身經百戰', desc: '單局撐到第 10 波', stat: 'bestWave', goal: 10, reward: 300 },
  { id: 'wave20', icon: '🌊', name: '屹立不搖', desc: '單局撐到第 20 波', stat: 'bestWave', goal: 20, reward: 800 },
  { id: 'boss1', icon: '👹', name: '屠王', desc: '擊殺 1 隻殭屍王', stat: 'bosses', goal: 1, reward: 150 },
  { id: 'boss10', icon: '👹', name: '王者收割', desc: '累積擊殺 10 隻殭屍王', stat: 'bosses', goal: 10, reward: 600 },
  { id: 'games10', icon: '🎮', name: '樂此不疲', desc: '遊玩 10 場', stat: 'games', goal: 10, reward: 200 },
  { id: 'kill10000', icon: '🧟', name: '殭屍末日', desc: '累積擊殺 10000 隻', stat: 'kills', goal: 10000, reward: 3000 },
  { id: 'wave30', icon: '🌊', name: '不死傳說', desc: '單局撐到第 30 波', stat: 'bestWave', goal: 30, reward: 1500 },
  { id: 'boss25', icon: '👹', name: '弒王者', desc: '累積擊殺 25 隻殭屍王', stat: 'bosses', goal: 25, reward: 1200 },
  { id: 'games50', icon: '🎮', name: '骨灰玩家', desc: '遊玩 50 場', stat: 'games', goal: 50, reward: 800 },
]

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function loadMeta() {
  let m
  try { m = JSON.parse(localStorage.getItem(KEY)) } catch { /* ignore */ }
  if (!m || typeof m !== 'object') m = {}
  if (!m.lv || typeof m.lv !== 'object') m.lv = {}
  m.coins = num(m.coins)
  for (const u of META_UPGRADES) m.lv[u.id] = num(m.lv[u.id]) // 淨化，避免 NaN
  if (!m.stats || typeof m.stats !== 'object') m.stats = {}
  for (const k of ['kills', 'games', 'bestWave', 'bosses']) m.stats[k] = num(m.stats[k])
  if (!Array.isArray(m.done)) m.done = []
  if (!Array.isArray(m.unlocked)) m.unlocked = [] // 已解鎖角色 id（第一個角色永遠免費）
  return m
}

// 一局結束後更新累積數據，回傳這局新解鎖的成就（並發金幣獎勵）
export function recordGame(m, run) {
  m.stats.kills += run.kills || 0
  m.stats.bosses += run.bosses || 0
  m.stats.games += 1
  if ((run.wave || 0) > m.stats.bestWave) m.stats.bestWave = run.wave || 0
  const unlocked = []
  for (const a of ACHIEVEMENTS) {
    if (!m.done.includes(a.id) && m.stats[a.stat] >= a.goal) {
      m.done.push(a.id)
      m.coins += a.reward
      unlocked.push(a)
    }
  }
  return unlocked
}

export function saveMeta(m) {
  localStorage.setItem(KEY, JSON.stringify(m))
}

export function costOf(up, level) {
  return Math.round(up.baseCost * Math.pow(1.6, num(level)))
}

// 把養成等級換算成遊戲加成（全程 num() 防呆，不可能 NaN）
export function bonuses(m) {
  const lv = m.lv
  return {
    dmgMul: 1 + 0.10 * num(lv.atk),
    hpAdd: 20 * num(lv.hp),
    rateMul: Math.pow(0.95, num(lv.rate)),
    speedMul: 1 + 0.04 * num(lv.speed),
    coinMul: 1 + 0.15 * num(lv.coin),
  }
}
