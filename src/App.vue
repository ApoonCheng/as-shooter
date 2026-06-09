<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { createGame } from './game'
import { supabase } from './lib/supabase'
import { loadMeta, saveMeta, META_UPGRADES, costOf, bonuses } from './meta'

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
const upgrades = META_UPGRADES

function openShop() { phase.value = 'shop' }
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

function onStats(s) {
  score.value = s.score
  wave.value = s.wave
  hp.value = s.hp
  hpMax.value = s.hpMax
  level.value = s.level
  xpRatio.value = s.xpRatio
}

function onLevelUp(choices) {
  levelChoices.value = choices
}

function chooseUpgrade(c) {
  game?.choose(c.id)
  levelChoices.value = null
}

function onWaveStart(n, isBoss) {
  banner.value = isBoss ? `👹 第 ${n} 波 · 殭屍王來襲！` : `第 ${n} 波`
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = ''), 1600)
}

function onGameOver({ score: s, wave: w, coins }) {
  game?.stop() // 停掉遊戲輸入監聽，避免干擾結束畫面操作
  levelChoices.value = null
  finalScore.value = s
  finalWave.value = w
  coinsEarned.value = coins || 0
  meta.value.coins += coinsEarned.value
  saveMeta(meta.value)
  phase.value = 'over'
  submitted.value = false
  if (hasLeaderboard) fetchTop()
}

function startGame() {
  playIntro()
  levelChoices.value = null
  phase.value = 'playing'
  banner.value = ''
  // 等 canvas 出現再建立遊戲
  requestAnimationFrame(() => {
    game?.stop()
    game = createGame(canvas.value, { onStats, onWaveStart, onGameOver, onLevelUp }, { bonuses: bonuses(meta.value) })
    game.setMuted(muted.value)
    game.start()
  })
}

function backToMenu() {
  game?.stop()
  phase.value = 'menu'
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

// 手機直向 → 提示橫放（瀏覽器無法強制旋轉裝置）
const rotateHint = ref(false)
function checkOrient() {
  const mobile = window.matchMedia('(pointer: coarse)').matches
  rotateHint.value = mobile && window.innerHeight > window.innerWidth
}

const blockContextMenu = (e) => e.preventDefault()

onMounted(() => {
  checkOrient()
  window.addEventListener('resize', checkOrient)
  window.addEventListener('orientationchange', checkOrient)
  window.addEventListener('contextmenu', blockContextMenu)
})

onUnmounted(() => {
  game?.stop()
  clearTimeout(introTimer)
  if (introAudio) introAudio.pause()
  window.removeEventListener('resize', checkOrient)
  window.removeEventListener('orientationchange', checkOrient)
  window.removeEventListener('contextmenu', blockContextMenu)
})
</script>

<template>
  <div class="page">
    <div class="game-box">
      <!-- 遊戲畫布 -->
      <canvas v-show="phase === 'playing'" ref="canvas" width="900" height="600"></canvas>

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
        </div>
      </div>
      <transition name="pop"><div v-if="banner" class="banner">{{ banner }}</div></transition>

      <!-- 升級三選一 -->
      <div v-if="levelChoices" class="levelup">
        <h2>⬆️ 升級！選一個強化</h2>
        <div class="upg-cards">
          <button v-for="c in levelChoices" :key="c.id" class="upg" @click="chooseUpgrade(c)">
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
          <div><b>WASD / 方向鍵</b> 移動</div>
          <div><b>自動</b> 瞄準射擊</div>
        </div>
        <p class="sub" style="margin-top:-8px">🔫 自動瞄準射擊，你只要專心移動閃殭屍！升級可三選一強化。<br />📱 手機：按住畫面拖曳即可移動</p>
        <div class="coin-bal">💰 {{ meta.coins }}</div>
        <button class="big" @click="startGame">開始遊戲</button>
        <button class="big alt" @click="openShop">🛒 強化</button>
        <button v-if="hasLeaderboard" class="big alt" @click="openBoard">🏆 排行榜</button>
        <button class="mute-line" @click="toggleMute">{{ muted ? '🔇 音效關' : '🔊 音效開' }}</button>
        <p class="footer">非官方粉絲應援 · 純為好玩 ❤️</p>
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
    <!-- 手機直向提示 -->
    <div v-if="rotateHint" class="rotate-overlay">
      <div class="rotate-inner">
        <div class="rotate-icon">🔄</div>
        <p>請將手機橫放<br />以獲得最佳遊玩體驗</p>
      </div>
    </div>
  </div>
</template>
