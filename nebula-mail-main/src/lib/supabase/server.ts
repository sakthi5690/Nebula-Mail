import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database.types';
import { getServerEnv } from '../../config/env';

/**
 * Server-Side Supabase Admin Client
 *
 * PRIVILEGED: Uses SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
 * CRITICAL SECURITY INVARIANT:
 * - This module MUST NOT be bundled or imported in browser-facing client components.
 * - Used exclusively for Gmail Webhook receivers, background sync workers, and secure token refresh operations.
 */

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;

  const env = getServerEnv();

  if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.includes('your-supabase-service-role')) {
    throw new Error(
      'Server Supabase client error: SUPABASE_SERVICE_ROLE_KEY is required for server admin operations.'
    );
  }

  adminClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}
