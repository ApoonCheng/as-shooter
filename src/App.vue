<script setup>
import { ref, onUnmounted } from 'vue'
import { createGame } from './game'
import { supabase } from './lib/supabase'

const canvas = ref(null)
const phase = ref('menu') // menu | playing | over
const score = ref(0)
const wave = ref(0)
const hp = ref(100)
const hpMax = ref(100)
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

let game = null
let bannerTimer = null

function onStats(s) {
  score.value = s.score
  wave.value = s.wave
  hp.value = s.hp
  hpMax.value = s.hpMax
}

function onWaveStart(n, isBoss) {
  banner.value = isBoss ? `👹 第 ${n} 波 · 殭屍王來襲！` : `第 ${n} 波`
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = ''), 1600)
}

function onGameOver({ score: s, wave: w }) {
  finalScore.value = s
  finalWave.value = w
  phase.value = 'over'
  submitted.value = false
  if (hasLeaderboard) fetchTop()
}

function startGame() {
  playIntro()
  phase.value = 'playing'
  banner.value = ''
  // 等 canvas 出現再建立遊戲
  requestAnimationFrame(() => {
    game?.stop()
    game = createGame(canvas.value, { onStats, onWaveStart, onGameOver })
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
  const { error } = await supabase
    .from('shooter_scores')
    .insert({ name, score: finalScore.value, wave: finalWave.value })
  if (error) boardError.value = error.message
  else { submitted.value = true; await fetchTop() }
  submitting.value = false
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

onUnmounted(() => {
  game?.stop()
  clearTimeout(introTimer)
  if (introAudio) introAudio.pause()
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
        <div class="hud-right">
          <span>第 {{ wave }} 波</span>
          <span class="hud-score">{{ score }}</span>
          <button class="mute" @click="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
        </div>
      </div>
      <transition name="pop"><div v-if="banner" class="banner">{{ banner }}</div></transition>

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
          <div><b>滑鼠</b> 瞄準</div>
          <div><b>按住左鍵</b> 射擊</div>
        </div>
        <p class="sub" style="margin-top:-8px">📱 手機：左半邊拖曳移動，右半邊拖曳瞄準並自動射擊</p>
        <button class="big" @click="startGame">開始遊戲</button>
        <button v-if="hasLeaderboard" class="big alt" @click="openBoard">🏆 排行榜</button>
        <button class="mute-line" @click="toggleMute">{{ muted ? '🔇 音效關' : '🔊 音效開' }}</button>
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

        <div v-if="hasLeaderboard && !submitted" class="submit-box">
          <input v-model="playerName" maxlength="12" placeholder="輸入暱稱上榜" />
          <button class="big small" :disabled="submitting" @click="submitScore">
            {{ submitting ? '上傳中…' : '上傳' }}
          </button>
        </div>
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
    <p class="footer">非官方粉絲應援 · 純為好玩 ❤️</p>
  </div>
</template>
