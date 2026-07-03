import type { SupabaseConfig } from "./supabaseStore";

// Publishable configuration for the wayfork-db Supabase project. The anon
// key is intentionally public (client-side key); access is governed by
// row-level security policies on the tables. An empty url disables the
// remote store and the app runs on localStorage only.
export const SUPABASE_CONFIG: SupabaseConfig = {
  url: "",
  anonKey: "",
};
