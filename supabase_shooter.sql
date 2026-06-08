-- ============================================================
-- 美秀打殭屍 線上排行榜資料表
-- 在 Supabase 專案的 SQL Editor 貼上整段執行一次即可。
-- （可沿用你其他專案的同一個 Supabase 專案）
-- 公開排行榜：任何人都能讀取與新增成績（無需登入）。
-- ============================================================

create table if not exists public.shooter_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  score int not null,
  wave int,
  created_at timestamptz not null default now()
);

alter table public.shooter_scores enable row level security;

create policy "anyone can read shooter scores"
  on public.shooter_scores for select using (true);

create policy "anyone can insert shooter score"
  on public.shooter_scores for insert with check (true);
