# 🎸 美秀打殭屍 (AS Shooter)

Amazing Show（美秀集團，簡稱 AS）主題的俯視角殭屍生存射擊遊戲。用音符擊退一波波殭屍，每 5 波出現魔王，撐越久分數越高，可上線排行榜比拼。純前端 + Supabase 排行榜。

## 玩法（電腦／鍵盤滑鼠）

- **WASD / 方向鍵**：移動
- **滑鼠**：瞄準
- **按住滑鼠左鍵**：射擊
- 血量歸零就 Game Over；每 5 波會出現魔王 👹

## 本機執行

```powershell
npm install
npm run dev
```

> 排行榜要設定 Supabase（見下），不設也能玩，只是不會記錄成績。

## 線上排行榜（選用）

1. Supabase → SQL Editor 執行 `supabase_shooter.sql`（建立 `shooter_scores` 表，可沿用你其他專案的同一個 Supabase）
2. 複製 `.env.example` 為 `.env`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`

## 部署（Vercel，免費）

```powershell
git init
git add .
git commit -m "美秀打殭屍"
git branch -M main
git remote add origin https://github.com/你的帳號/as-shooter.git
git push -u origin main
```

到 [vercel.com](https://vercel.com) → Add New → Project → 選 repo → 在 Environment Variables 填那兩個變數 → Deploy。

## 技術

Vue 3 + Vite + HTML5 Canvas，音效用 WebAudio 即時合成（無音檔），排行榜用 Supabase。
