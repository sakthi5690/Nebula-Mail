export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          email: string
          display_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      gmail_accounts: {
        Row: {
          id: string
          user_id: string
          email_address: string
          access_token_encrypted: string | null
          refresh_token_encrypted: string | null
          token_expires_at: string | null
          scope: string[] | null
          is_active: boolean
          connected_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email_address: string
          access_token_encrypted?: string | null
          refresh_token_encrypted?: string | null
          token_expires_at?: string | null
          scope?: string[] | null
          is_active?: boolean
          connected_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email_address?: string
          access_token_encrypted?: string | null
          refresh_token_encrypted?: string | null
          token_expires_at?: string | null
          scope?: string[] | null
          is_active?: boolean
          connected_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      gmail_sync_states: {
        Row: {
          id: string
          account_id: string
          user_id: string
          status: 'idle' | 'syncing' | 'active' | 'error' | 'paused'
          last_history_id: string | null
          last_synced_at: string | null
          sync_latency_ms: number | null
          roundtrip_latency_ms: number | null
          error_message: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          account_id: string
          user_id: string
          status?: 'idle' | 'syncing' | 'active' | 'error' | 'paused'
          last_history_id?: string | null
          last_synced_at?: string | null
          sync_latency_ms?: number | null
          roundtrip_latency_ms?: number | null
          error_message?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          account_id?: string
          user_id?: string
          status?: 'idle' | 'syncing' | 'active' | 'error' | 'paused'
          last_history_id?: string | null
          last_synced_at?: string | null
          sync_latency_ms?: number | null
          roundtrip_latency_ms?: number | null
          error_message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gmail_watch_subscriptions: {
        Row: {
          id: string
          account_id: string
          user_id: string
          topic_name: string
          history_id: string
          expiration: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_id: string
          user_id: string
          topic_name: string
          history_id: string
          expiration: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          account_id?: string
          user_id?: string
          topic_name?: string
          history_id?: string
          expiration?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          id: string
          user_id: string
          theme: 'light' | 'dark' | 'system'
          keyboard_shortcuts_enabled: boolean
          ai_copilot_auto_suggest: boolean
          ai_copilot_tone: 'concise' | 'professional' | 'casual' | 'executive'
          custom_labels: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          theme?: 'light' | 'dark' | 'system'
          keyboard_shortcuts_enabled?: boolean
          ai_copilot_auto_suggest?: boolean
          ai_copilot_tone?: 'concise' | 'professional' | 'casual' | 'executive'
          custom_labels?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          theme?: 'light' | 'dark' | 'system'
          keyboard_shortcuts_enabled?: boolean
          ai_copilot_auto_suggest?: boolean
          ai_copilot_tone?: 'concise' | 'professional' | 'casual' | 'executive'
          custom_labels?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
