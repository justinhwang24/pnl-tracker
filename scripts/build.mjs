import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

const defaults = JSON.parse(await readFile('public-config.json', 'utf8'));
const hasOverride = Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY);
const url = hasOverride ? process.env.SUPABASE_URL || '' : defaults.supabaseUrl;
const key = hasOverride ? process.env.SUPABASE_PUBLISHABLE_KEY || '' : defaults.supabasePublishableKey;
if (Boolean(url) !== Boolean(key)) throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither for guest mode.');
if (key.startsWith('sb_secret_')) throw new Error('Use a publishable key, never a Supabase secret key.');
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Only a public anon key may be included in the browser build.');
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/app.js', 'src/auth.js', 'src/settings.js'], bundle: true, format: 'esm', target: 'es2022',
  outdir: 'dist/assets', minify: true,
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(key) },
});
// Explicit allowlist: never publish uploaded CSVs, tests, or backend configuration files.
for (const path of ['index.html', 'dashboard.html', 'auth.html', 'settings.html', 'kalshi_pnl_calendar.html', 'styles']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await writeFile('dist/.nojekyll', '');
console.log(`Built dist/ (${url ? 'accounts enabled' : 'guest mode'}).`);
