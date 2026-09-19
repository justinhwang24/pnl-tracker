// Only public browser credentials belong here; the build reads environment variables.
export const supabaseUrl = typeof __SUPABASE_URL__ === 'undefined' ? '' : __SUPABASE_URL__;
export const supabasePublishableKey = typeof __SUPABASE_PUBLISHABLE_KEY__ === 'undefined' ? '' : __SUPABASE_PUBLISHABLE_KEY__;
export const maxCsvBytes = 2 * 1024 * 1024;
