// NEON STRIKE 3D - all CSS (injected from JS so the game is fully self-contained)
export function injectStyles() {
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&display=swap');

.ns-root, .ns-root * { box-sizing: border-box; margin: 0; padding: 0; }
.ns-root {
  position: fixed; inset: 0; overflow: hidden; background: #0a0a14;
  font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif; color: #e8f6ff;
  user-select: none; -webkit-user-select: none;
}
.ns-root canvas { display: block; }
.ns-hidden { display: none !important; }

/* ---------- HUD ---------- */
.ns-hud { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.ns-crosshair { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; transform: translate(-50%, -50%); }
.ns-crosshair::before, .ns-crosshair::after {
  content: ''; position: absolute; background: #7df9ff; box-shadow: 0 0 4px #00f0ff;
}
.ns-crosshair::before { left: 50%; top: 0; width: 2px; height: 100%; transform: translateX(-50%); }
.ns-crosshair::after { top: 50%; left: 0; height: 2px; width: 100%; transform: translateY(-50%); }
.ns-crosshair-dot { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; border-radius: 50%;
  background: #fff; transform: translate(-50%, -50%); box-shadow: 0 0 6px #00f0ff; }

.ns-hp-wrap { position: absolute; left: 24px; bottom: 24px; width: 240px; }
.ns-hp-label { font-family: 'Orbitron', sans-serif; font-size: 12px; letter-spacing: 2px; color: #7df9ff; margin-bottom: 5px; display: flex; justify-content: space-between; }
.ns-hp-bar { height: 14px; background: rgba(10,16,40,0.8); border: 1px solid #26406b; border-radius: 3px; overflow: hidden; }
.ns-hp-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #00f0ff, #39ff88); transition: width 0.15s; }
.ns-hp-fill.low { background: linear-gradient(90deg, #ff3355, #ff8800); }
.ns-ammo { position: absolute; right: 28px; bottom: 20px; text-align: right; }
.ns-ammo-num { font-family: 'Orbitron', sans-serif; font-size: 42px; font-weight: 900; color: #fff; text-shadow: 0 0 12px #00f0ff; line-height: 1; }
.ns-ammo-num.empty { color: #ff3355; text-shadow: 0 0 12px #ff3355; }
.ns-ammo-sub { font-size: 14px; letter-spacing: 2px; color: #6d84b8; }
.ns-ammo-sub .rel { color: #ffe14d; animation: ns-blink 0.6s infinite; }
@keyframes ns-blink { 50% { opacity: 0.25; } }

.ns-timer { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); text-align: center; }
.ns-timer-time { font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 700; color: #fff; text-shadow: 0 0 10px #8b5cf6; }
.ns-timer-mode { font-size: 12px; letter-spacing: 3px; color: #7df9ff; text-transform: uppercase; }
.ns-kd { position: absolute; top: 14px; left: 24px; font-family: 'Orbitron', sans-serif; font-size: 15px; color: #bfe9ff;
  background: rgba(10,16,40,0.7); border: 1px solid #26406b; padding: 6px 12px; border-radius: 4px; }
.ns-kd b { color: #39ff88; }
.ns-room { position: absolute; top: 14px; right: 24px; font-size: 13px; letter-spacing: 2px; color: #7df9ff;
  background: rgba(10,16,40,0.7); border: 1px solid #26406b; padding: 6px 12px; border-radius: 4px; }

.ns-feed { position: absolute; top: 64px; right: 24px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.ns-feed-item { background: rgba(8,12,30,0.82); border: 1px solid #26406b; border-left: 3px solid #00f0ff;
  padding: 4px 10px; font-size: 14px; font-weight: 600; border-radius: 3px; animation: ns-feed-in 0.18s ease-out; }
.ns-feed-item b { color: #ffe14d; }
.ns-feed-item .vic { color: #ff6b8a; }
.ns-feed-item.hs { border-left-color: #ff2bd6; }
@keyframes ns-feed-in { from { transform: translateX(30px); opacity: 0; } }

.ns-hitmarker { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) rotate(45deg); width: 22px; height: 22px; opacity: 0; }
.ns-hitmarker span { position: absolute; background: #fff; box-shadow: 0 0 4px #fff; }
.ns-hitmarker span:nth-child(1) { left: 0; top: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(2) { right: 0; top: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(3) { left: 0; bottom: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(4) { right: 0; bottom: 0; width: 7px; height: 2px; }
.ns-hitmarker.show { animation: ns-hm 0.22s ease-out; }
.ns-hitmarker.hs span { background: #ff2bd6; box-shadow: 0 0 5px #ff2bd6; }
@keyframes ns-hm { 0% { opacity: 1; transform: translate(-50%,-50%) rotate(45deg) scale(1.35); } 100% { opacity: 0; transform: translate(-50%,-50%) rotate(45deg) scale(0.9); } }

.ns-vignette { position: absolute; inset: 0; opacity: 0; transition: opacity 0.25s;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(255,20,60,0.55) 100%); }
.ns-scoreboard { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 420px;
  background: rgba(7,10,26,0.92); border: 1px solid #2b4a80; border-radius: 8px; padding: 18px 22px; }
.ns-scoreboard h3 { font-family: 'Orbitron', sans-serif; letter-spacing: 4px; color: #7df9ff; text-align: center; margin-bottom: 12px; font-size: 16px; }
.ns-sb-row { display: grid; grid-template-columns: 1fr 60px 60px; padding: 5px 10px; font-size: 15px; font-weight: 600; border-radius: 3px; }
.ns-sb-row.head { color: #6d84b8; font-size: 12px; letter-spacing: 2px; }
.ns-sb-row.me { background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.25); }
.ns-sb-row:nth-child(even):not(.head) { background: rgba(255,255,255,0.03); }
.ns-respawn { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); text-align: center; }
.ns-respawn h2 { font-family: 'Orbitron', sans-serif; font-size: 34px; color: #ff3355; text-shadow: 0 0 18px rgba(255,51,85,0.7); letter-spacing: 4px; }
.ns-respawn p { font-size: 18px; color: #bfe9ff; margin-top: 8px; }
.ns-hint { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); font-size: 13px; color: #55688f; letter-spacing: 1px; }

/* ---------- Menus ---------- */
.ns-menu { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.16), transparent 55%),
              radial-gradient(ellipse at 75% 80%, rgba(0,240,255,0.12), transparent 50%),
              rgba(6,8,20,0.94); }
.ns-menu-inner { width: min(520px, 92vw); max-height: 92vh; overflow-y: auto; padding: 34px 36px; text-align: center; }
.ns-title { font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 52px; letter-spacing: 6px; line-height: 1;
  background: linear-gradient(90deg, #00f0ff, #8b5cf6 55%, #ff2bd6); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 22px rgba(0,240,255,0.35)); }
.ns-subtitle { font-size: 15px; letter-spacing: 6px; color: #6d84b8; margin: 8px 0 26px; text-transform: uppercase; }
.ns-btn { display: block; width: 100%; margin: 10px 0; padding: 13px 18px; font-family: 'Orbitron', sans-serif; font-size: 15px;
  font-weight: 700; letter-spacing: 2px; color: #e8f6ff; background: rgba(15,22,52,0.9); border: 1px solid #2b4a80;
  border-radius: 6px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; }
.ns-btn:hover { border-color: #00f0ff; color: #00f0ff; box-shadow: 0 0 18px rgba(0,240,255,0.25); transform: translateY(-1px); }
.ns-btn:disabled { opacity: 0.45; cursor: wait; }
.ns-btn.primary { background: linear-gradient(90deg, rgba(0,240,255,0.16), rgba(139,92,246,0.16)); border-color: #00f0ff; }
.ns-btn.danger:hover { border-color: #ff3355; color: #ff3355; box-shadow: 0 0 18px rgba(255,51,85,0.3); }
.ns-btn.small { font-size: 12px; padding: 9px 12px; }
.ns-field { margin: 14px 0; text-align: left; }
.ns-field label { display: block; font-size: 12px; letter-spacing: 2px; color: #6d84b8; margin-bottom: 6px; text-transform: uppercase; }
.ns-input { width: 100%; padding: 11px 14px; background: rgba(10,16,40,0.9); border: 1px solid #2b4a80; border-radius: 5px;
  color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: 1px; outline: none; }
.ns-input:focus { border-color: #00f0ff; box-shadow: 0 0 12px rgba(0,240,255,0.2); }
.ns-row { display: flex; gap: 10px; }
.ns-row > * { flex: 1; }
.ns-seg { display: flex; gap: 6px; }
.ns-seg button { flex: 1; padding: 9px 6px; background: rgba(10,16,40,0.9); border: 1px solid #2b4a80; color: #8aa3cf;
  font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 1px; border-radius: 5px; cursor: pointer; text-transform: uppercase; }
.ns-seg button.on { border-color: #00f0ff; color: #00f0ff; background: rgba(0,240,255,0.08); box-shadow: 0 0 10px rgba(0,240,255,0.15) inset; }
.ns-panel-title { font-family: 'Orbitron', sans-serif; font-size: 22px; letter-spacing: 4px; color: #fff; margin-bottom: 4px; }
.ns-back { margin-top: 18px; }
.ns-status { min-height: 20px; font-size: 14px; color: #ffe14d; margin-top: 10px; }
.ns-status.err { color: #ff6b8a; }
.ns-code-box { font-family: 'Orbitron', sans-serif; font-size: 44px; font-weight: 900; letter-spacing: 10px; color: #39ff88;
  text-shadow: 0 0 20px rgba(57,255,136,0.5); background: rgba(10,16,40,0.9); border: 1px dashed #39ff88; border-radius: 8px; padding: 14px 10px 10px; margin: 12px 0; }
.ns-code-hint { font-size: 13px; color: #6d84b8; margin-bottom: 14px; line-height: 1.5; }
.ns-help { text-align: left; font-size: 15px; line-height: 1.75; color: #b8c9e8; background: rgba(10,16,40,0.6);
  border: 1px solid #22345c; border-radius: 6px; padding: 16px 20px; margin-top: 8px; }
.ns-help b { color: #7df9ff; }
.ns-help .k { display: inline-block; min-width: 26px; text-align: center; background: #1b2547; border: 1px solid #35508a;
  border-bottom-width: 3px; border-radius: 4px; padding: 0 7px; font-weight: 700; color: #fff; font-size: 13px; }
.ns-end-title { font-family: 'Orbitron', sans-serif; font-size: 40px; font-weight: 900; letter-spacing: 5px; margin-bottom: 2px; }
.ns-end-title.win { color: #39ff88; text-shadow: 0 0 24px rgba(57,255,136,0.55); }
.ns-end-title.lose { color: #ff2bd6; text-shadow: 0 0 24px rgba(255,43,214,0.5); }
.ns-end-sub { color: #6d84b8; letter-spacing: 3px; font-size: 13px; margin-bottom: 18px; text-transform: uppercase; }
.ns-lobby-tag { font-size: 14px; color: #8aa3cf; margin-top: 8px; min-height: 20px; }
.ns-foot { margin-top: 22px; font-size: 11px; letter-spacing: 2px; color: #3d4f78; }
.ns-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 5;
  font-family: 'Orbitron', sans-serif; letter-spacing: 4px; color: #00f0ff; font-size: 18px; }

/* mobile note */
.ns-mobile-note { display: none; }
@media (pointer: coarse) {
  .ns-mobile-note { display: block; margin-top: 14px; font-size: 13px; color: #ffb14d; }
}
.ns-mobile-note.ok { color: #39ff88; }

/* ---------- Touch controls (mobile) ---------- */
.ns-touch { position: absolute; inset: 0; z-index: 15; }
.ns-touch-zone { position: absolute; touch-action: none; }
.ns-zone-move { left: 0; bottom: 0; width: 45%; height: 75%; }
.ns-zone-look { right: 0; bottom: 0; width: 55%; height: 100%; }
.ns-joy { position: absolute; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%;
  border: 2px solid rgba(0,240,255,0.4); background: rgba(10,16,40,0.35); display: none; pointer-events: none; }
.ns-joy-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
  background: rgba(0,240,255,0.22); border: 2px solid rgba(0,240,255,0.75); box-shadow: 0 0 14px rgba(0,240,255,0.35); }
.ns-tbtn { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 50%;
  font-family: 'Orbitron', sans-serif; font-weight: 700; letter-spacing: 1px; color: #bfe9ff;
  background: rgba(10,16,40,0.5); border: 2px solid rgba(43,74,128,0.9);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.ns-tbtn.on { border-color: #00f0ff; color: #00f0ff; box-shadow: 0 0 16px rgba(0,240,255,0.35); background: rgba(0,240,255,0.12); }
.ns-tbtn.fire { right: 24px; bottom: 92px; width: 96px; height: 96px; font-size: 15px;
  color: #ffdbe4; border-color: rgba(255,51,85,0.85); background: rgba(40,10,20,0.45); }
.ns-tbtn.fire.on { border-color: #ff3355; color: #ff8fa3; box-shadow: 0 0 18px rgba(255,51,85,0.5); background: rgba(255,51,85,0.16); }
.ns-tbtn.jump { right: 138px; bottom: 30px; width: 66px; height: 66px; font-size: 12px; }
.ns-tbtn.reload { right: 34px; bottom: 204px; width: 58px; height: 58px; font-size: 11px; }
.ns-tbtn.sb { left: 22px; top: 66px; width: 52px; height: 40px; border-radius: 8px; font-size: 10px; }
.ns-tbtn.pause { left: 50%; margin-left: 86px; top: 12px; width: 46px; height: 46px; font-size: 13px; letter-spacing: 2px; }

/* rotate-your-device overlay (touch mode + portrait only) */
.ns-rotate { position: absolute; inset: 0; z-index: 60; display: none; align-items: center; justify-content: center;
  flex-direction: column; gap: 18px; background: rgba(5,7,18,0.95); text-align: center;
  font-family: 'Orbitron', sans-serif; font-size: 16px; letter-spacing: 3px; color: #7df9ff; line-height: 1.8; }
.ns-rotate span { font-size: 11px; color: #6d84b8; letter-spacing: 2px; }
.ns-rotate-icon { width: 58px; height: 82px; border: 3px solid #7df9ff; border-radius: 10px;
  animation: ns-rot 1.8s ease-in-out infinite; box-shadow: 0 0 18px rgba(0,240,255,0.25); }
@keyframes ns-rot { 0%, 25% { transform: rotate(0deg); } 65%, 100% { transform: rotate(-90deg) scaleY(0.72); } }
@media (orientation: portrait) {
  .ns-touch:not(.ns-hidden) .ns-rotate { display: flex; }
}

/* HUD adjustments while touch controls are active */
.ns-touch-mode .ns-root-canvas, .ns-touch-mode canvas { touch-action: none; }
.ns-root.ns-touch-mode { touch-action: none; overscroll-behavior: none; -webkit-touch-callout: none; }
.ns-root.ns-touch-mode .ns-ammo { right: 140px; bottom: 24px; }
.ns-root.ns-touch-mode .ns-hp-wrap { bottom: 200px; width: 190px; left: 20px; }
.ns-root.ns-touch-mode .ns-hint { display: none; }
.ns-root.ns-touch-mode .ns-feed { top: 64px; right: 18px; max-width: 60vw; }
@media (max-width: 760px) {
  .ns-menu-inner { padding: 22px 18px; }
  .ns-title { font-size: 38px; letter-spacing: 4px; }
  .ns-ammo-num { font-size: 32px; }
  .ns-timer-time { font-size: 20px; }
  .ns-scoreboard { min-width: 0; width: 92vw; }
  .ns-kd { font-size: 12px; padding: 5px 8px; }
}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
