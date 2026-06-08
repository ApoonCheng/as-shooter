import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// 沒設定金鑰時為 null → 遊戲照常玩，只是沒有線上排行榜
export const supabase = url && key ? createClient(url, key) : null
