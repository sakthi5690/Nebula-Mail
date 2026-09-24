import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database.types';
import { getClientEnv } from '../../config/env';

/**
 * Frontend Browser Supabase Client
 *
 * SECURE: Uses ONLY the public anon key.
 * Never exposes service role key or administrative privileges.
 * Respects Supabase Row Level Security (RLS) for all queries.
 */

let browserClient: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const env = getClientEnv();

  // If placeholder or missing credentials, fallback gracefully to a mock-safe stub URL to avoid client crash
  const url = env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const anonKey = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

  browserClient = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return browserClient;
}

export const supabase = getSupabaseBrowserClient();
