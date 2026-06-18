<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { createGame, CHARACTERS } from './game'
import { supabase } from './lib/supabase'
import { loadMeta, saveMeta, META_UPGRADES, costOf, bonuses, ACHIEVEMENTS, recordGame } from './meta'

const canvas = ref(null)
const phase = ref('menu') // menu | playing | over
const score = ref(0)
const wave = ref(0)
const hp = ref(100)
const hpMax = ref(100)
const level = ref(1)
const xpRatio = ref(0)
const levelChoices = ref(null)
const banner = ref('')
const muted = ref(false)
const combo = ref(0)
const comboMult = ref(1)
const dashRatio = ref(1)
const ultRatio = ref(1)
const paused = ref(false)

// 角色選擇
const characters = CHARACTERS
const charIdx = ref(Math.min(CHARACTERS.length - 1, Number(localStorage.getItem('as-char')) || 0))
function selectChar(i) { charIdx.value = i; localStorage.setItem('as-char', String(i)) }

// 遊戲模式
const MODES = [
  { id: 'normal', name: '🎮 普通' },
  { id: 'bossrush', name: '👹 Boss Rush' },
  { id: 'daily', name: '📅 每日挑戰' },
]
const modeIdx = ref(Math.min(2, Number(localStorage.getItem('as-mode')) || 0))
function selectMode(i) { modeIdx.value = i; localStorage.setItem('as-mode', String(i)) }
// 每日挑戰：依日期決定當天修正（同一天全玩家一致）
const DAILY_MODS = [
  { label: '狂暴日 · 敵人變多', countMul: 1.5 },
  { label: '精英橫行 · 菁英大增', eliteMul: 5 },
  { label: '高速殭屍 · 移動加快', speedMul: 1.35 },
  { label: '鋼鐵屍 · 血量加倍', hpMul: 1.7 },
  { label: '兇殘日 · 傷害提升', dmgMul: 1.4 },
]
const dailyMod = DAILY_MODS[Math.floor(Date.now() / 86400000) % DAILY_MODS.length]

// 難度
const DIFFICULTIES = [
  { id: 'easy', name: '😊 簡單', mod: { hpMul: 0.7, dmgMul: 0.7 } },
  { id: 'normal', name: '😎 普通', mod: { hpMul: 1, dmgMul: 1 } },
  { id: 'hard', name: '💀 困難', mod: { hpMul: 1.5, dmgMul: 1.35 } },
]
const diffIdx = ref(Math.min(2, Number(localStorage.getItem('as-diff') ?? 1)))
function selectDiff(i) { diffIdx.value = i; localStorage.setItem('as-diff', String(i)) }

// 設定：音量 + 震動
const volume = ref(localStorage.getItem('as-vol') !== null ? Number(localStorage.getItem('as-vol')) : 0.8)
const vibrate = ref(localStorage.getItem('as-vib') !== '0')
function openSettings() { phase.value = 'settings' }
watch(volume, (v) => {
  localStorage.setItem('as-vol', String(v))
  game?.setVolume(v)
  if (bgmMenu) bgmMenu.volume = BGM_VOL * v
  if (bgmGame) bgmGame.volume = BGM_VOL * v
})
function toggleVibrate() {
  vibrate.value = !vibrate.value
  localStorage.setItem('as-vib', vibrate.value ? '1' : '0')
  game?.setVibrate(vibrate.value)
}

// 魔王登場預警
const bossWarn = ref(false)
let bossWarnTimer = null

// 新手引導（只第一次）
const showTut = ref(false)

const hasLeaderboard = !!supabase
const playerName = ref(localStorage.getItem('as-name') || '')
const top = ref([])
const submitting = ref(false)
const submitted = ref(false)
const boardError = ref('')
const finalScore = ref(0)
const finalWave = ref(0)

// 局外養成
const meta = ref(loadMeta())
const coinsEarned = ref(0)
const newAchievements = ref([])
const upgrades = META_UPGRADES
const achievements = ACHIEVEMENTS

function openShop() { phase.value = 'shop' }
function openAch() { phase.value = 'ach' }
function buy(up) {
  const lvl = meta.value.lv[up.id]
  if (lvl >= up.max) return
  const cost = costOf(up, lvl)
  if (meta.value.coins < cost) return
  meta.value.coins -= cost
  meta.value.lv[up.id] = lvl + 1
  saveMeta(meta.value)
}

let game = null
let bannerTimer = null

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d)
function onStats(s) {
  score.value = fin(s.score)
  wave.value = fin(s.wave)
  hp.value = fin(s.hp)
  hpMax.value = fin(s.hpMax, 100) || 100
  level.value = fin(s.level, 1)
  xpRatio.value = fin(s.xpRatio)
  combo.value = fin(s.combo)
  comboMult.value = fin(s.comboMult, 1)
  dashRatio.value = fin(s.dashRatio, 1)
  ultRatio.value = fin(s.ultRatio, 1)
}

function onLevelUp(choices) {
  levelChoices.value = choices
}

function chooseUpgrade(c) {
  game?.choose(c.id)
  levelChoices.value = null
}

function onWaveStart(n, isBoss, bossName, waveLabel) {
  banner.value = isBoss
    ? `👹 第 ${n} 波 · ${bossName || '殭屍王'}來襲！`
    : waveLabel
      ? `第 ${n} 波 · ${waveLabel}`
      : `第 ${n} 波`
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = ''), 1600)
  if (isBoss) {
    bossWarn.value = true
    clearTimeout(bossWarnTimer)
    bossWarnTimer = setTimeout(() => (bossWarn.value = false), 1800)
  }
}

function onGameOver({ score: s, wave: w, coins, kills, bosses }) {
  game?.stop() // 停掉遊戲輸入監聽，避免干擾結束畫面操作
  levelChoices.value = null
  finalScore.value = s
  finalWave.value = w
  const earned = Number.isFinite(coins) ? coins : 0
  coinsEarned.value = earned
  meta.value.coins = (Number.isFinite(meta.value.coins) ? meta.value.coins : 0) + earned
  newAchievements.value = recordGame(meta.value, { kills, bosses, wave: w })
  saveMeta(meta.value)
  phase.value = 'over'
  submitted.value = false
  if (hasLeaderboard) fetchTop()
}

function startGame() {
  playIntro()
  levelChoices.value = null
  paused.value = false
  phase.value = 'playing'
  banner.value = ''
  // 等 canvas 出現再建立遊戲
  requestAnimationFrame(() => {
    game?.stop()
    const opts = { bonuses: bonuses(meta.value), character: characters[charIdx.value].mod, difficulty: DIFFICULTIES[diffIdx.value].mod }
    const m = MODES[modeIdx.value]
    if (m.id === 'bossrush') opts.mode = 'bossrush'
    else if (m.id === 'daily') opts.modifier = dailyMod
    game = createGame(canvas.value, { onStats, onWaveStart, onGameOver, onLevelUp }, opts)
    game.setMuted(muted.value)
    game.setVolume(volume.value)
    game.setVibrate(vibrate.value)
    game.start()
  })
  // 新手引導：只第一次顯示
  if (localStorage.getItem('as-tut') !== '1') {
    showTut.value = true
    localStorage.setItem('as-tut', '1')
    setTimeout(() => (showTut.value = false), 5000)
  }
}

function backToMenu() {
  game?.stop()
  paused.value = false
  phase.value = 'menu'
}

function togglePause() {
  if (phase.value !== 'playing') return
  paused.value = !paused.value
  game?.setPaused(paused.value)
}

function doDash() {
  game?.dash()
}

function doUlt() {
  game?.ult()
}

function openBoard() {
  phase.value = 'board'
  fetchTop()
}

function toggleMute() {
  muted.value = !muted.value
  game?.setMuted(muted.value)
}

async function fetchTop() {
  if (!supabase) return
  const { data, error } = await supabase
    .from('shooter_scores')
    .select('*')
    .order('score', { ascending: false })
    .limit(20)
  if (error) boardError.value = error.message
  else top.value = data
}

async function submitScore() {
  if (!supabase) return
  const name = (playerName.value || '匿名玩家').trim().slice(0, 12)
  playerName.value = name
  localStorage.setItem('as-name', name)
  submitting.value = true
  boardError.value = ''
  try {
    const { error } = await supabase
      .from('shooter_scores')
      .insert({ name, score: finalScore.value, wave: finalWave.value })
    if (error) boardError.value = '上傳失敗：' + error.message
    else { submitted.value = true; await fetchTop() }
  } catch (e) {
    boardError.value = '上傳失敗：' + (e.message || e)
  } finally {
    submitting.value = false
  }
}

// 每次開始遊戲 / 再玩一次 → 播放 2.9 秒音效
let introAudio = null
let introTimer = null
function playIntro() {
  if (muted.value) return
  if (!introAudio) introAudio = new Audio('/intro.webm')
  clearTimeout(introTimer)
  introAudio.pause()
  introAudio.currentTime = 0
  introAudio.play().catch(() => {}) // 沒有音檔或被擋就略過
  introTimer = setTimeout(() => {
    introAudio.pause()
    introAudio.currentTime = 0
  }, 2900)
}

// 背景音樂（CC-BY CodeManu）：選單與遊戲各一軌，依狀態切換
const BGM_VOL = 0.4
let bgmMenu = null
let bgmGame = null
function ensureBgm() {
  if (!bgmMenu) { bgmMenu = new Audio('/bgm-menu.mp3'); bgmMenu.loop = true; bgmMenu.volume = BGM_VOL * volume.value }
  if (!bgmGame) { bgmGame = new Audio('/bgm.mp3'); bgmGame.loop = true; bgmGame.volume = BGM_VOL * volume.value }
}
function updateBgm() {
  ensureBgm()
  if (muted.value) { bgmMenu.pause(); bgmGame.pause(); return }
  if (phase.value === 'playing') {
    bgmMenu.pause()
    if (paused.value) bgmGame.pause()
    else bgmGame.play().catch(() => {})
  } else {
    bgmGame.pause()
    bgmMenu.play().catch(() => {})
  }
}
watch([phase, muted, paused], updateBgm)

const blockContextMenu = (e) => e.preventDefault()

// 切到背景／被訊息打斷時自動暫停
function onVisibility() {
  if (document.hidden && phase.value === 'playing' && !paused.value) {
    paused.value = true
    game?.setPaused(true)
  }
}

const kickstartBgm = () => updateBgm() // 首次互動解除瀏覽器自動播放限制

onMounted(() => {
  window.addEventListener('contextmenu', blockContextMenu)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pointerdown', kickstartBgm, { once: true })
})

onUnmounted(() => {
  game?.stop()
  clearTimeout(introTimer)
  if (introAudio) introAudio.pause()
  bgmMenu?.pause()
  bgmGame?.pause()
  window.removeEventListener('contextmenu', blockContextMenu)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pointerdown', kickstartBgm)
})
</script>

<template>
  <div class="page">
    <div class="game-box">
      <!-- 遊戲畫布 -->
      <canvas v-show="phase === 'playing'" ref="canvas" width="600" height="900"></canvas>

      <!-- 遊戲中 HUD -->
      <div v-if="phase === 'playing'" class="hud">
        <div class="hud-left">
          <div class="hp-bar"><div class="hp-fill" :style="{ width: (hp / hpMax * 100) + '%' }"></div></div>
          <span class="hud-hp">❤️ {{ hp }}</span>
        </div>
        <div class="hud-center">
          <span class="lvl">Lv {{ level }}</span>
          <div class="xp-bar"><div class="xp-fill" :style="{ width: xpRatio * 100 + '%' }"></div></div>
        </div>
        <div class="hud-right">
          <span>第 {{ wave }} 波</span>
          <span class="hud-score">{{ score }}</span>
          <button class="mute" @click="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
          <button class="mute" @click="togglePause">⏸</button>
        </div>
      </div>

      <!-- combo 連擊 -->
      <transition name="pop"><div v-if="phase === 'playing' && combo >= 3" class="combo">🔥 {{ combo }} 連擊 <span class="combo-mult">×{{ comboMult.toFixed(1) }}</span></div></transition>

      <!-- 魔王登場預警 -->
      <transition name="pop"><div v-if="phase === 'playing' && bossWarn" class="boss-warn">⚠️ 魔王降臨 ⚠️</div></transition>

      <!-- 新手引導（只第一次） -->
      <div v-if="phase === 'playing' && showTut" class="tut" @pointerdown="showTut = false">
        <p>🕹️ 拖曳移動閃殭屍，會自動射擊<br />👟 右下衝刺 · 💥 左下大招 · ⏸ 暫停<br /><small>(點一下關閉)</small></p>
      </div>

      <!-- 衝刺按鈕（手機拇指可及，電腦也可按；空白鍵亦可） -->
      <button
        v-if="phase === 'playing'"
        class="dash-btn"
        :class="{ ready: dashRatio >= 1 }"
        :style="{ '--p': dashRatio }"
        @pointerdown.prevent="doDash"
      >👟</button>

      <!-- 大招按鈕（左下，CD 制；電腦 E 鍵） -->
      <button
        v-if="phase === 'playing'"
        class="ult-btn"
        :class="{ ready: ultRatio >= 1 }"
        :style="{ '--p': ultRatio }"
        @pointerdown.prevent="doUlt"
      >💥</button>

      <transition name="pop"><div v-if="banner" class="banner">{{ banner }}</div></transition>

      <!-- 暫停 -->
      <div v-if="phase === 'playing' && paused" class="overlay pause-overlay">
        <h1>⏸ 暫停</h1>
        <button class="big" @click="togglePause">繼續遊戲</button>
        <button class="big alt" @click="backToMenu">回主選單</button>
      </div>

      <!-- 升級三選一 -->
      <div v-if="levelChoices" class="levelup">
        <h2>⬆️ 升級！選一個強化</h2>
        <div class="upg-cards">
          <button v-for="c in levelChoices" :key="c.id" class="upg" :class="'upg--' + (c.tier || 'normal')" @click="chooseUpgrade(c)">
            <span class="upg-icon">{{ c.icon }}</span>
            <span class="upg-name">{{ c.name }}</span>
          </button>
        </div>
      </div>

      <!-- 主選單 -->
      <div v-if="phase === 'menu'" class="overlay">
        <svg class="menu-logo" viewBox="0 0 150 64">
          <defs>
            <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#e23b3b" />
              <stop offset="0.2" stop-color="#ef8b3b" />
              <stop offset="0.4" stop-color="#f4d23b" />
              <stop offset="0.6" stop-color="#49c46a" />
              <stop offset="0.8" stop-color="#3aa0f7" />
              <stop offset="1" stop-color="#8e5bf0" />
            </linearGradient>
          </defs>
          <rect x="6" y="36" width="48" height="14" rx="3" fill="#c9a468" stroke="#9c7b45" />
          <rect x="22" y="46" width="12" height="15" rx="2" fill="#2f7ef0" />
          <rect x="26" y="16" width="82" height="28" rx="13" fill="url(#rainbow)" stroke="#2f6fe0" stroke-width="2" />
          <rect x="28" y="16" width="8" height="28" rx="4" fill="#2f6fe0" />
          <rect x="100" y="16" width="8" height="28" rx="4" fill="#2f6fe0" />
          <polygon points="108,14 108,46 140,30" fill="#fff" stroke="#2f6fe0" stroke-width="1.5" />
          <polygon points="124,21 124,39 140,30" fill="#e23b3b" />
        </svg>
        <h1>美秀打殭屍</h1>
        <p class="sub">用炫砲擊退湧來的殭屍，撐過一波波攻勢，每 5 波會出現殭屍王！</p>
        <div class="controls">
          <div><b>按住畫面拖曳</b> 移動</div>
          <div><b>自動</b> 瞄準射擊</div>
        </div>
        <p class="sub" style="margin-top:-8px">🔫 自動瞄準射擊，你只要專心拖曳閃殭屍！升級可三選一強化。<br />💻 電腦：用 WASD / 方向鍵移動</p>
        <div class="coin-bal">💰 {{ meta.coins }}</div>
        <!-- 模式選擇 -->
        <div class="char-pick">
          <button v-for="(m, i) in MODES" :key="m.id" class="char-card diff-card" :class="{ sel: i === modeIdx }" @click="selectMode(i)">
            <span class="char-name">{{ m.name }}</span>
          </button>
        </div>
        <p v-if="MODES[modeIdx].id === 'daily'" class="char-desc">今日：{{ dailyMod.label }}</p>
        <!-- 角色選擇 -->
        <div class="char-pick">
          <button
            v-for="(c, i) in characters"
            :key="c.id"
            class="char-card"
            :class="{ sel: i === charIdx }"
            @click="selectChar(i)"
          >
            <span class="char-icon">{{ c.icon }}</span>
            <span class="char-name">{{ c.name }}</span>
          </button>
        </div>
        <p class="char-desc">{{ characters[charIdx].name }}：{{ characters[charIdx].desc }}</p>
        <!-- 難度 -->
        <div class="char-pick">
          <button v-for="(d, i) in DIFFICULTIES" :key="d.id" class="char-card diff-card" :class="{ sel: i === diffIdx }" @click="selectDiff(i)">
            <span class="char-name">{{ d.name }}</span>
          </button>
        </div>
        <button class="big" @click="startGame">開始遊戲</button>
        <button class="big alt" @click="openShop">🛒 強化</button>
        <button class="big alt" @click="openAch">🏅 成就</button>
        <button v-if="hasLeaderboard" class="big alt" @click="openBoard">🏆 排行榜</button>
        <button class="big alt" @click="openSettings">⚙️ 設定</button>
        <button class="big alt" @click="phase = 'stats'">📊 統計</button>
        <button class="mute-line" @click="toggleMute">{{ muted ? '🔇 音效關' : '🔊 音效開' }}</button>
        <p class="footer">非官方粉絲應援 · 純為好玩 ❤️<br />音樂：CodeManu (CC-BY 3.0)</p>
      </div>

      <!-- 統計 -->
      <div v-if="phase === 'stats'" class="overlay">
        <h1>📊 統計</h1>
        <div class="stats-grid">
          <div class="stat-cell"><div class="stat-num">{{ meta.stats.kills }}</div><div class="stat-lbl">總擊殺</div></div>
          <div class="stat-cell"><div class="stat-num">{{ meta.stats.bosses }}</div><div class="stat-lbl">擊殺魔王</div></div>
          <div class="stat-cell"><div class="stat-num">{{ meta.stats.bestWave }}</div><div class="stat-lbl">最高波數</div></div>
          <div class="stat-cell"><div class="stat-num">{{ meta.stats.games }}</div><div class="stat-lbl">遊玩場數</div></div>
          <div class="stat-cell"><div class="stat-num">{{ meta.done.length }}/{{ achievements.length }}</div><div class="stat-lbl">成就</div></div>
          <div class="stat-cell"><div class="stat-num">💰{{ meta.coins }}</div><div class="stat-lbl">金幣</div></div>
        </div>
        <button class="big" @click="phase = 'menu'">返回</button>
      </div>

      <!-- 設定 -->
      <div v-if="phase === 'settings'" class="overlay">
        <h1>⚙️ 設定</h1>
        <div class="set-row">
          <span>🔊 音量</span>
          <input type="range" min="0" max="1" step="0.05" v-model.number="volume" />
          <span class="set-val">{{ Math.round(volume * 100) }}%</span>
        </div>
        <div class="set-row">
          <span>📳 震動回饋</span>
          <button class="toggle" :class="{ on: vibrate }" @click="toggleVibrate">{{ vibrate ? '開' : '關' }}</button>
        </div>
        <button class="big" @click="phase = 'menu'">返回</button>
      </div>

      <!-- 成就 -->
      <div v-if="phase === 'ach'" class="overlay shop">
        <h1>🏅 成就</h1>
        <div class="shop-list">
          <div v-for="a in achievements" :key="a.id" class="shop-row" :class="{ achieved: meta.done.includes(a.id) }">
            <span class="shop-icon">{{ a.icon }}</span>
            <div class="shop-info">
              <div class="shop-name">{{ a.name }} <span class="shop-lv">{{ Math.min(meta.stats[a.stat], a.goal) }}/{{ a.goal }}</span></div>
              <div class="shop-desc">{{ a.desc }} · 獎勵 💰 {{ a.reward }}</div>
            </div>
            <span class="maxed">{{ meta.done.includes(a.id) ? '✅' : '🔒' }}</span>
          </div>
        </div>
        <button class="big" @click="phase = 'menu'">返回</button>
      </div>

      <!-- 強化商店 -->
      <div v-if="phase === 'shop'" class="overlay shop">
        <h1>🛒 永久強化</h1>
        <div class="coin-bal">💰 {{ meta.coins }}</div>
        <div class="shop-list">
          <div v-for="u in upgrades" :key="u.id" class="shop-row">
            <span class="shop-icon">{{ u.icon }}</span>
            <div class="shop-info">
              <div class="shop-name">{{ u.name }} <span class="shop-lv">Lv {{ meta.lv[u.id] }}/{{ u.max }}</span></div>
              <div class="shop-desc">{{ u.desc }}</div>
            </div>
            <button
              v-if="meta.lv[u.id] < u.max"
              class="buy"
              :disabled="meta.coins < costOf(u, meta.lv[u.id])"
              @click="buy(u)"
            >💰 {{ costOf(u, meta.lv[u.id]) }}</button>
            <span v-else class="maxed">MAX</span>
          </div>
        </div>
        <button class="big" @click="phase = 'menu'">返回</button>
      </div>

      <!-- 排行榜畫面 -->
      <div v-if="phase === 'board'" class="overlay">
        <h1>🏆 排行榜</h1>
        <div v-if="top.length" class="board">
          <ol>
            <li v-for="(r, i) in top" :key="r.id">
              <span class="rk">{{ i + 1 }}</span>
              <span class="nm">{{ r.name }}</span>
              <span class="sc">{{ r.score }}</span>
            </li>
          </ol>
        </div>
        <p v-else class="sub">{{ boardError || '還沒有人上榜，快去當第一名！' }}</p>
        <button class="big" @click="phase = 'menu'">返回</button>
      </div>

      <!-- 結束畫面 -->
      <div v-if="phase === 'over'" class="overlay">
        <h1>💀 GAME OVER</h1>
        <div class="final">{{ finalScore }}</div>
        <p class="sub">撐到第 {{ finalWave }} 波 · 得分 {{ finalScore }}</p>
        <p class="coins-got">💰 獲得 {{ coinsEarned }} 金幣（總計 {{ meta.coins }}）</p>
        <div v-if="newAchievements.length" class="ach-unlock">
          🏅 解鎖成就：{{ newAchievements.map((a) => a.name).join('、') }}
        </div>

        <form v-if="hasLeaderboard && !submitted" class="submit-box" @submit.prevent="submitScore">
          <input v-model="playerName" maxlength="12" placeholder="輸入暱稱上榜" enterkeyhint="send" />
          <button type="submit" class="big small" :disabled="submitting">
            {{ submitting ? '上傳中…' : '上傳' }}
          </button>
        </form>
        <p v-if="boardError" class="err">{{ boardError }}</p>

        <div v-if="submitted || (hasLeaderboard && top.length)" class="board">
          <h3>🏆 排行榜</h3>
          <ol>
            <li v-for="(r, i) in top" :key="r.id" :class="{ me: r.name === playerName && submitted }">
              <span class="rk">{{ i + 1 }}</span>
              <span class="nm">{{ r.name }}</span>
              <span class="sc">{{ r.score }}</span>
            </li>
          </ol>
        </div>

        <div class="btn-row">
          <button class="big alt" @click="backToMenu">回主選單</button>
          <button class="big" @click="startGame">再玩一次</button>
        </div>
      </div>
    </div>
  </div>
</template>
