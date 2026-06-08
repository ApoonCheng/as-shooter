// 自動去背：從邊緣洗掉白色背景（保留物件內部白色），
// 並只保留最大連通物件（人＋炫砲），去掉右邊的紅色 logo。
import sharp from 'sharp'

const input = process.argv[2] || 'C:/Users/HP/Desktop/77.png'
const out = 'public/dogbo.png'

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const idx = (x, y) => (y * W + x) * 4
const isWhite = (x, y) => {
  const i = idx(x, y)
  return data[i] > 205 && data[i + 1] > 205 && data[i + 2] > 205
}

// 1) 從四邊做 flood fill，標記與邊界相連的白色 = 背景
const bg = new Uint8Array(W * H)
const stack = []
const pushIf = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const p = y * W + x
  if (!bg[p] && isWhite(x, y)) { bg[p] = 1; stack.push(p) }
}
for (let x = 0; x < W; x++) { pushIf(x, 0); pushIf(x, H - 1) }
for (let y = 0; y < H; y++) { pushIf(0, y); pushIf(W - 1, y) }
while (stack.length) {
  const p = stack.pop()
  const x = p % W, y = (p / W) | 0
  pushIf(x - 1, y); pushIf(x + 1, y); pushIf(x, y - 1); pushIf(x, y + 1)
}

// 2) 前景連通元件，找最大的（人＋炫砲）
const comp = new Int32Array(W * H).fill(-1)
let best = -1, bestSize = 0, cid = 0
for (let start = 0; start < W * H; start++) {
  if (bg[start] || comp[start] !== -1) continue
  let size = 0
  const s = [start]
  comp[start] = cid
  while (s.length) {
    const q = s.pop()
    size++
    const x = q % W, y = (q / W) | 0
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const np = ny * W + nx
      if (!bg[np] && comp[np] === -1) { comp[np] = cid; s.push(np) }
    }
  }
  if (size > bestSize) { bestSize = size; best = cid }
  cid++
}

// 3) 非最大元件 → 透明；同時算 bounding box
let minx = W, miny = H, maxx = 0, maxy = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (comp[p] === best) {
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    } else {
      data[idx(x, y) + 3] = 0
    }
  }
}

const cw = maxx - minx + 1
const ch = maxy - miny + 1

// 4) 洗掉右側殘留的紅色「美秀」logo（炫砲在左側、襯衫較深紅，不受影響）
const cutX = minx + Math.floor(cw * 0.6)
for (let y = miny; y <= maxy; y++) {
  for (let x = cutX; x <= maxx; x++) {
    const i = idx(x, y)
    if (data[i + 3] === 0) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // 偏紅（含抗鋸齒粉紅邊）一律去除
    if (r > 150 && r - g > 45 && r - b > 40) data[i + 3] = 0
  }
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: minx, top: miny, width: cw, height: ch })
  .png()
  .toFile(out)

console.log(`完成：${out}  尺寸 ${cw}x${ch}（原圖 ${W}x${H}）`)
