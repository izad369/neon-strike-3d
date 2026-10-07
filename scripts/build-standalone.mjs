// Builds a single self-contained HTML file: dist/neon-strike.html
// Upload this one file to Cloudflare Pages (or any static host) and you're done.
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>NEON STRIKE 3D — Online & Offline FPS</title>
<meta name="description" content="Neon arena FPS. Play offline vs bots or host peer-to-peer online matches. Single file, no server needed." />
<meta name="theme-color" content="#0a0a14" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='%230a0a14'/><path d='M28 22 L50 50 L28 78' stroke='%2300f0ff' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/><path d='M56 22 L78 50 L56 78' stroke='%23ff2bd6' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
<style>
  html, body { margin: 0; padding: 0; background: #0a0a14; overflow: hidden; height: 100%; }
  #ns-boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Orbitron', 'Segoe UI', sans-serif; color: #00f0ff; letter-spacing: 5px; font-size: 16px; z-index: 1; }
</style>
</head>
<body>
<div id="ns-boot">LOADING NEON STRIKE…</div>
<script>
${js}
</script>
</body>
</html>
`;

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'neon-strike.html');
writeFileSync(outPath, html);
console.log(`✔ Built ${outPath} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
