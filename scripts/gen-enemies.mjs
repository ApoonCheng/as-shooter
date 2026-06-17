// 從一張 CC0 俯視殭屍基底（scripts/zombie-src.png，來源 OpenGameArt「Animated Top Down Zombie」/ Riley Gombart / CC0）
// 產生各種敵人類型的色調變體到 public/enemy-*.png。
// .tint() 會保留明暗與透明，只改色相 → 清楚的顏色分型。
import sharp from 'sharp'

const SRC = 'scripts/zombie-src.png'
const TARGET_H = 120

// null = 維持原色（綠衣殭屍）
const variants = {
  z: null,
  fast: { r: 255, g: 226, b: 120 },     // 黃：快速
  tank: { r: 110, g: 150, b: 120 },     // 暗綠：坦克
  spitter: { r: 150, g: 255, b: 90 },   // 毒綠：吐口水
  exploder: { r: 255, g: 140, b: 80 },  // 橘：爆破
  charger: { r: 255, g: 95, b: 95 },    // 紅：衝撞
  boss: { r: 200, g: 110, b: 255 },     // 紫：魔王
}

const { data, info } = await sharp(SRC)
  .trim()
  .resize({ height: TARGET_H, fit: 'inside' })
  .png()
  .toBuffer({ resolveWithObject: true })

for (const [name, tint] of Object.entries(variants)) {
  let img = sharp(data)
  if (tint) img = img.tint(tint)
  await img.png().toFile(`public/enemy-${name}.png`)
  console.log(`完成：public/enemy-${name}.png  ${info.width}x${info.height}`)
}
