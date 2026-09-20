import { createHandler } from './handler.js';

Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  supabaseKey: Deno.env.get('SUPABASE_ANON_KEY'),
}));
