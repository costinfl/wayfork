import type { SupabaseConfig } from "./supabaseStore";

// Publishable configuration for the wayfork-db Supabase project. The anon
// key is intentionally public (client-side key); access is governed by
// row-level security policies on the tables. An empty url disables the
// remote store and the app runs on localStorage only.
export const SUPABASE_CONFIG: SupabaseConfig = {
  url: "https://uwffkbfwikwomzhbrthj.supabase.co",
  anonKey: "sb_publishable_mAf8edtczeP8jRR3qe38MQ_J38rse3l",
};

// Shows the Admin button for this account. Cosmetic only — the admin-users
// edge function enforces the same email server-side against its own secret.
export const ADMIN_EMAIL = "costinfl@gmail.com";
