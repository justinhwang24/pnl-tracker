import { build } from 'esbuild';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';

// Explicit shell/CI variables take precedence over the local, gitignored file.
try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const url = process.env.SUPABASE_URL?.trim() || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || '';
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env or the build environment.');
if (key.startsWith('sb_secret_')) throw new Error('Use a publishable key, never a Supabase secret key.');
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Only a public anon key may be included in the browser build.');
}
// Update the served directory in place so local rebuilds do not briefly turn
// every route into a 404 while `python -m http.server` is still running.
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/app.js', 'src/auth.js', 'src/settings.js', 'src/home.js'], bundle: true, format: 'esm', target: 'es2022',
  outdir: 'dist/assets', minify: true,
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(key) },
});
// Explicit allowlist: never publish uploaded CSVs, tests, or backend configuration files.
for (const path of ['index.html', 'dashboard.html', 'auth.html', 'settings.html', 'kalshi_pnl_calendar.html', 'styles']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
for (const route of ['dashboard', 'auth', 'settings']) {
  await mkdir(`dist/${route}`, { recursive: true });
  const html = await readFile(`${route}.html`, 'utf8');
  await writeFile(`dist/${route}/index.html`, html.replace('<base href="./">', '<base href="../">'));
}
await writeFile('dist/.nojekyll', '');
console.log('Built dist/ (accounts enabled).');
