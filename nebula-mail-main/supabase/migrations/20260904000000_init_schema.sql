-- ==============================================================================
-- Stitch AI Mail - Supabase Database Schema Migration
-- Migration: 20260904000000_init_schema.sql
-- Description: Sets up application metadata, user accounts, Gmail connection
--              records, synchronization state, watch history, and user settings.
-- Note: Gmail remains the source of truth for email bodies and attachments.
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. USER PROFILES TABLE
-- ------------------------------------------------------------------------------
-- Stores application user identity linked to Supabase Auth.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security (RLS) for user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
    ON public.user_profiles
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.user_profiles
    FOR UPDATE
    USING (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 2. GMAIL ACCOUNTS CONNECTION TABLE
-- ------------------------------------------------------------------------------
-- Stores connection metadata and securely encrypted OAuth tokens on the server.
-- Frontend clients can only query non-sensitive connection status (email_address, connected_at).
CREATE TABLE IF NOT EXISTS public.gmail_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    email_address TEXT NOT NULL,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at TIMESTAMPTZ,
    scope TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, email_address)
);

ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;

-- Allow users to see that they have connected an account (excluding raw tokens via selective select)
CREATE POLICY "Users can view their connected accounts"
    ON public.gmail_accounts
    FOR SELECT
    USING (auth.uid() = user_id);

-- Only backend service-role or user can delete their connection
CREATE POLICY "Users can delete their account connection"
    ON public.gmail_accounts
    FOR DELETE
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 3. GMAIL SYNCHRONIZATION STATE TABLE
-- ------------------------------------------------------------------------------
-- Tracks real-time sync telemetry, last history ID from Gmail API, and pub/sub latency.
CREATE TABLE IF NOT EXISTS public.gmail_sync_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE UNIQUE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('idle', 'syncing', 'active', 'error', 'paused')) DEFAULT 'idle',
    last_history_id TEXT,
    last_synced_at TIMESTAMPTZ,
    sync_latency_ms INTEGER DEFAULT 0,
    roundtrip_latency_ms INTEGER DEFAULT 12,
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gmail_sync_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their sync states"
    ON public.gmail_sync_states
    FOR SELECT
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 4. GMAIL WATCH / PUBSUB SUBSCRIPTIONS TABLE
-- ------------------------------------------------------------------------------
-- Stores Google Cloud Pub/Sub watch expiration & subscription metadata.
-- Google requires refreshing the watch() subscription periodically (every 7 days).
CREATE TABLE IF NOT EXISTS public.gmail_watch_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE UNIQUE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    topic_name TEXT NOT NULL,
    history_id TEXT NOT NULL,
    expiration TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gmail_watch_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their watch subscriptions"
    ON public.gmail_watch_subscriptions
    FOR SELECT
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 5. USER PREFERENCES & SETTINGS TABLE
-- ------------------------------------------------------------------------------
-- Stores application preferences (UI theme, shortcut bindings, AI Copilot settings).
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE UNIQUE,
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
    keyboard_shortcuts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ai_copilot_auto_suggest BOOLEAN NOT NULL DEFAULT TRUE,
    ai_copilot_tone TEXT NOT NULL DEFAULT 'professional' CHECK (ai_copilot_tone IN ('concise', 'professional', 'casual', 'executive')),
    custom_labels JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their preferences"
    ON public.user_preferences
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their preferences"
    ON public.user_preferences
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their preferences"
    ON public.user_preferences
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 6. AUTOMATIC PROFILE & PREFERENCES INITIALIZATION TRIGGER
-- ------------------------------------------------------------------------------
-- Whenever a user signs up via Supabase Auth, automatically create their profile & preferences.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, display_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable Realtime publication for tables that stream live UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.gmail_sync_states;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_preferences;
