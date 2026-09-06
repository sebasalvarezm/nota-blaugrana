import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function hasSupabaseServerConfig(requireServiceRole = false) {
  const base = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  return requireServiceRole ? base && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) : base;
}

export function getServerSupabase(useServiceRole = false): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = useServiceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
