/**
 * Centralized Environment Configuration & Validation
 *
 * Enforces strict boundary between:
 * - Public Browser Environment (VITE_ prefixed)
 * - Private Server/Backend Environment (Never exposed to client)
 */

interface ClientEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  IS_CONFIGURED: boolean;
}

interface ServerEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DATABASE_URL?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REDIRECT_URI?: string;
  GMAIL_PUBSUB_TOPIC?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  AI_API_KEY?: string;
}

// Client-safe environment reader (works in browser Vite and Node)
export function getClientEnv(): ClientEnv {
  // Vite client-side variables
  const metaEnv: Record<string, string | undefined> =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as unknown as Record<string, string | undefined>)
      : {};
  // Fallback for Node/server scripts
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  const supabaseUrl =
    (metaEnv.VITE_SUPABASE_URL as string) ||
    procEnv.VITE_SUPABASE_URL ||
    procEnv.SUPABASE_URL ||
    '';

  const supabaseAnonKey =
    (metaEnv.VITE_SUPABASE_ANON_KEY as string) ||
    procEnv.VITE_SUPABASE_ANON_KEY ||
    procEnv.SUPABASE_ANON_KEY ||
    '';

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
    IS_CONFIGURED: Boolean(
      supabaseUrl &&
        supabaseAnonKey &&
        !supabaseUrl.includes('your-project-id') &&
        !supabaseAnonKey.includes('your-supabase-anon-key')
    ),
  };
}

// Server-side environment reader (Throws if called in browser or if service role is missing in server mode)
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'SECURITY VIOLATION: getServerEnv() must never be invoked in a browser context! Service-role credentials cannot be exposed to the client.'
    );
  }

  const client = getClientEnv();
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  const serviceRoleKey = procEnv.SUPABASE_SERVICE_ROLE_KEY || '';

  return {
    SUPABASE_URL: client.SUPABASE_URL,
    SUPABASE_ANON_KEY: client.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    DATABASE_URL: procEnv.DATABASE_URL,
    GMAIL_CLIENT_ID: procEnv.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: procEnv.GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URI: procEnv.GMAIL_REDIRECT_URI,
    GMAIL_PUBSUB_TOPIC: procEnv.GMAIL_PUBSUB_TOPIC,
    TOKEN_ENCRYPTION_KEY: procEnv.TOKEN_ENCRYPTION_KEY,
    AI_API_KEY: procEnv.AI_API_KEY,
  };
}
