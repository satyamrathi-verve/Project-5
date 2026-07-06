import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
  The configured Supabase client for this team's project. The URL + anon key live
  in .env.local (already filled in for you). Import `supabase` anywhere and read/
  write the existing tables — never create or alter tables.

  If the env vars are missing it returns null so the app still renders with a
  friendly "connect Supabase" notice instead of crashing.
*/

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url as string, anonKey as string)
  : null;
