import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublishableKey } from './config.js';

export function createBackend() {
  if (!supabaseUrl && !supabasePublishableKey) return null;
  if (!supabaseUrl || !supabasePublishableKey) throw new Error('Account configuration is incomplete.');
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
