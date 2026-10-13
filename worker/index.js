// DESERT STRIKE 3D — Discord Interactions endpoint on Cloudflare Workers edge.
// This runs 24/7 for FREE (serverless): no process to keep awake, no cron needed.
// Slash commands (/ping /help /apk /ask) are answered straight from the edge.
//
// The full Node bot (scripts/discord-bot.mjs, Gateway + channel watching + LLM)
// keeps running on the dev node while it is alive; this Worker guarantees the
// commands NEVER die when the dev node sleeps.
//
// Routes:
//   GET  /bot/health   -> 200 {ok:true}
//   POST /bot/discord  -> Discord interactions endpoint (Ed25519 verified)
//   anything else      -> static assets (dist/), SPA fallback

const APP_PUBLIC_KEY = '8f16f09b4df7780805d4f0feb7543bdbd4dbc115ed18211a5c7d867691899a95';

const APK_URL = 'https://github.com/izad369/neon-strike-3d/releases/download/v3.5/DesertStrike3D-v3.5.apk';
const GAME_URL = 'https://neon-strike-3d.rezaei-reza1092.workers.dev/';

const HELP_TEXT = [
  '**DESERT STRIKE 3D** — command list',
  '\u2022 `/ping` \u2014 check I am alive',
  '\u2022 `/apk` \u2014 latest Android APK (v3.5)',
  '\u2022 `/ask <question>` \u2014 ask about the game (edge edition)',
  '\u2022 `/help` \u2014 this list',
  '',
  'Play in your browser: <' + GAME_URL + '>',
  'Modes: Deathmatch, TDM, Survival, Gun Game, Duel, Battle Royale.',
].join('\n');

const APK_TEXT = [
  '\uD83D\uDD25 **DESERT STRIKE 3D v3.5** \u2014 Android APK:',
  APK_URL,
  '',
  'Install: download \u2192 allow "install unknown apps" \u2192 open the APK.',
  'Same signing key as v3.0/v3.1 \u2014 installs directly over them.',
  'v3.5: inverted joystick fixed in embedded apps (Aippy) + new ROT flip button \u2022 v3.4: START button on portrait phones always visible & tappable (sticky) \u2022 v3.3: Duel death-screen rounds reset properly \u2022 Career & Stats screen \u2014 every finished match + your name recorded on-device \u2022 v3.2: shaped BR loot, smart pickups \u2022 v3.0/v3.1: 17 weapons, 3-slot loadout, Battle Royale (limited ammo, zone, plane drop), Duel 1v1, no friendly fire, tap weapon bar, forced landscape.',
].join('\n');

// Tiny on-edge knowledge base for /ask (the big LLM brain lives on the dev node)
function askAnswer(q) {
  const s = (q || '').toLowerCase();
  const has = (...ws) => ws.some(w => s.includes(w));
  if (has('hello', 'hi ', 'hey', 'salam')) return 'Hey! Soldier ready. Try `/help` to see what I can do. \uD83C\uDFAE';
  if (has('apk', 'install', 'android', 'download')) return APK_TEXT;
  if (has('multiplayer', 'online', 'friend', 'room', 'p2p', 'server')) return [
    '**Online multiplayer** is peer-to-peer (WebRTC via PeerJS) \u2014 no game server needed.',
    'Host: PLAY ONLINE \u2192 CREATE \u2192 share the 5-letter room code. Friends: PLAY ONLINE \u2192 JOIN + code.',
    'The host\u2019s phone/browser is the authority; snapshots sync at 12 Hz.',
    'Multiplayer is humans-only \u2014 zero bots, ever.',
  ].join('\n');
  if (has('mode', 'battle royale', 'duel', 'gun game', 'survival')) return [
    '**6 game modes:** DM (free-for-all) \u2022 TDM (squads, no FF) \u2022 Survival (waves) \u2022 Gun Game (13-gun ladder) \u2022 Duel (strict 1v1, first to 3) \u2022 **Battle Royale** (plane drop, 130 ground loots, limited ammo, SWAP pickup, shrinking zone, climbable towers).',
  ].join('\n');
  if (has('weapon', 'gun', 'knife', 'loadout', 'swap')) return [
    '**Loadout = knife + primary + backup (3 slots).** Tap a slot in the top-right bar to switch.',
    '17 weapons incl. AWM, Kar98K, AK-47, Deagle, Vector\u2026 knives boost your move speed.',
    'In Battle Royale every gun must be looted \u2014 walk over it, press **E / SWAP**.',
  ].join('\n');
  if (has('update', 'new', 'changelog', 'version', 'v3')) return [
    '**v3.0 highlights:** bots can no longer see behind their backs (FOV + line-of-sight), sniper scope no longer shows the gun model, enemy nameplates hidden, knife speed boost, 3-slot weapon bar, BR structures + weapon swapping, limited BR ammo, friendly fire OFF, no bots in multiplayer, forced landscape with fixed joystick mapping.',
  ].join('\n');
  return [
    '\u26A0 **My big AI brain is resting** (it runs on the dev node, which sleeps sometimes).',
    'I\u2019m still always awake here on Cloudflare for: `/ping` `/apk` `/help` and game questions about **modes, weapons, multiplayer, install, updates** \u2014 just ask one of those!',
  ].join('\n');
}

async function verifySignature(request, body) {
  const sig = request.headers.get('x-signature-ed25519') || '';
  const ts = request.headers.get('x-signature-timestamp') || '';
  if (!/^[0-9a-f]{128}$/i.test(sig) || !ts) return false;
  try {
    const keyBytes = Uint8Array.from(APP_PUBLIC_KEY.match(/.{2}/g), h => parseInt(h, 16));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    const sigBytes = Uint8Array.from(sig.match(/.{2}/g), h => parseInt(h, 16));
    const data = new TextEncoder().encode(ts + body);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, data);
  } catch { return false; }
}

function cmdResponse(content) {
  return Response.json({ type: 4, data: { content } });
}

export async function handleInteraction(body) {
  const t = body.type;
  if (t === 1) return Response.json({ type: 1 }); // PING
  if (t === 2) {
    const name = body.data?.name;
    if (name === 'ping') return cmdResponse('\uD83C\uDFD3 Pong! Always-on edition (Cloudflare edge) \u2014 uptime 24/7.');
    if (name === 'help') return cmdResponse(HELP_TEXT);
    if (name === 'apk') return cmdResponse(APK_TEXT);
    if (name === 'ask') {
      const q = body.data?.options?.find(o => o.name === 'question')?.value || '';
      return cmdResponse(askAnswer(q));
    }
    return cmdResponse('Unknown command \u2014 try `/help`.');
  }
  return Response.json({ type: 5 }); // defer anything else
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/bot/health') {
      return Response.json({ ok: true, bot: 'DesertStrike3D', mode: 'cloudflare-edge', ts: Date.now() });
    }
    // Discord Domain Connection verification (profile website link).
    // Discord fetches this exact URL and must see the challenge token as plain text.
    if (url.pathname === '/.well-known/discord') {
      return new Response('dh=4d7044daf1e72a009e541bd119abb799f675fabb', {
        status: 200,
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    if (url.pathname === '/bot/discord' && request.method === 'POST') {
      const body = await request.text();
      if (!(await verifySignature(request, body))) {
        return new Response('invalid signature', { status: 401 });
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
      return handleInteraction(parsed);
    }
    // short link: latest Android APK (always points at the newest release asset)
    if (url.pathname === '/apk' && request.method === 'GET') {
      return Response.redirect(APK_URL, 302);
    }
    // everything else: serve the game (assets binding, SPA fallback)
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
