// Builds a single self-contained HTML file: dist/index.html (+ dist/neon-strike.html)
// Upload this one file to Cloudflare Pages (or any static host) and you're done.
// The soldier avatar GLB is embedded as base64 on globalThis.__NS_SOLDIER_GLB__.
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await esbuild.build({
  entryPoints: [join(root, 'src/game/standalone.ts')],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

let js = result.outputFiles[0].text;
// guard against accidental </script> termination inside inline JS
js = js.replace(/<\/script/gi, '<\\/script');

// embed the soldier avatar (base64) so the single file stays fully self-contained
let soldierEmbed = '';
try {
  const glb = readFileSync(join(root, 'public', 'soldier.glb'));
  const b64 = glb.toString('base64');
  soldierEmbed = `globalThis.__NS_SOLDIER_GLB__="${b64}";`;
  console.log(`  soldier.glb embedded (${(b64.length / 1024 / 1024).toFixed(2)} MB base64)`);
} catch {
  console.warn('  public/soldier.glb not found — avatars fall back to blocky soldiers');
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>DESERT STRIKE 3D — Online & Offline Military FPS</title>
<meta name="description" content="Desert military arena FPS. Play offline vs bots or host peer-to-peer online matches. Single file, no server needed." />
<meta name="theme-color" content="#171410" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='%23171410'/><path d='M28 22 L50 50 L28 78' stroke='%23d6b96a' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/><path d='M56 22 L78 50 L56 78' stroke='%237d8f4e' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
<style>
  html, body { margin: 0; padding: 0; background: #171410; overflow: hidden; height: 100%; }
  #ns-boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Black Ops One', 'Segoe UI', sans-serif; color: #cdb27a; letter-spacing: 5px; font-size: 16px; z-index: 1; }
</style>
</head>
<body>
<div id="ns-boot">LOADING DESERT STRIKE…</div>
<script>
${soldierEmbed}
${js}
</script>
</body>
</html>
`;

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'neon-strike.html');
writeFileSync(outPath, html);
// Cloudflare Pages / any static host serves index.html at the site root,
// so dist/ is committed with BOTH names (zero-build deploy).
writeFileSync(join(outDir, 'index.html'), html);
console.log(`✔ Built ${outPath} + index.html (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
