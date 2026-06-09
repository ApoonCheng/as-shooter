// 局外永久養成：金幣 + 強化等級，存在 localStorage
const KEY = 'as-meta'

export const META_UPGRADES = [
  { id: 'atk', icon: '💥', name: '攻擊力', desc: '每級 +10% 傷害', max: 12, baseCost: 60 },
  { id: 'hp', icon: '❤️', name: '最大血量', desc: '每級 +20 血', max: 12, baseCost: 60 },
  { id: 'rate', icon: '⚡', name: '攻速', desc: '每級 +5% 攻速', max: 10, baseCost: 80 },
  { id: 'speed', icon: '👟', name: '移速', desc: '每級 +4% 移速', max: 8, baseCost: 70 },
  { id: 'coin', icon: '🪙', name: '金幣加成', desc: '每級 +15% 金幣', max: 8, baseCost: 50 },
]

export function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY))
    if (m && m.lv) {
      // 補齊可能新增的欄位
      for (const u of META_UPGRADES) if (m.lv[u.id] == null) m.lv[u.id] = 0
      return m
    }
  } catch { /* ignore */ }
  const lv = {}
  for (const u of META_UPGRADES) lv[u.id] = 0
  return { coins: 0, lv }
}

export function saveMeta(m) {
  localStorage.setItem(KEY, JSON.stringify(m))
}

export function costOf(up, level) {
  return Math.round(up.baseCost * Math.pow(1.6, level))
}

// 把養成等級換算成遊戲加成
export function bonuses(m) {
  const lv = m.lv
  return {
    dmgMul: 1 + 0.10 * lv.atk,
    hpAdd: 20 * lv.hp,
    rateMul: Math.pow(0.95, lv.rate),
    speedMul: 1 + 0.04 * lv.speed,
    coinMul: 1 + 0.15 * lv.coin,
  }
}
