// DESERT STRIKE 3D - P2P networking (host authoritative).
// Signaling: a tiny HTTPS mailbox served by the SAME worker that serves the
// game (/signal/<code>/...) — no third-party server, no WebSocket, so it works
// anywhere the game page itself loads (including networks that block or
// throttle the public PeerJS cloud / Google STUN endpoints).
// Gameplay: raw WebRTC DataChannel between peers, host authoritative.
import { LanConn } from './lan';
import { makeRoomCode, ClientMsg, HostMsg } from './constants';
import { NS_ICE, DATA_CHANNEL, gatherComplete } from './rtc';
import { MqttHost, MqttClient as MqttClientImpl, mqttNearbyScan } from './mqtt';
import { PeerConn, RelayConn, RelayHostSide, relayWsUrl } from './relay';
import { storeGet, storeSet, storeDel } from './store';

// v3.11 — public-MQTT relay re-exports (menus.ts scans the relay directory
// when the REST nearby endpoint is unreachable, e.g. on filtered origins).
export { mqttNearbyScan };
export type { RelayRoom } from './mqtt';

// ---- transport selection --------------------------------------------------
// The REST mailbox on workers.dev is SNI-filtered in some countries (Iran).
// pickMode() probes it once per page load; on failure every session switches
// to the public MQTT relay automatically. ?mqtt=1 / ?mqtt=0 force a mode;
// the last working mode is remembered in localStorage.
export type SignalMode = 'rest' | 'mqtt';
let modeMemo: SignalMode | null = null;

export async function restHealthy(timeoutMs = 3500): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(signalBase() + '/signal/health', { signal: ctl.signal, headers: { accept: 'application/json' } });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

export async function pickMode(): Promise<SignalMode> {
  try {
    const f = new URLSearchParams(location.search).get('mqtt');
    if (f === '1') return 'mqtt';
    if (f === '0') return 'rest';
    if (storeGet('ns_mqtt') === '1') return 'mqtt';
  } catch { /* storage blocked */ }
  if (modeMemo) return modeMemo;
  modeMemo = (await restHealthy()) ? 'rest' : 'mqtt';
  if (modeMemo === 'mqtt') rememberMqtt();
  return modeMemo;
}

function rememberMqtt() {
  modeMemo = 'mqtt';
  try { storeSet('ns_mqtt', '1'); } catch { /* blocked */ }
}

export interface HostHooks {
  onOpen(code: string): void;
  onPeerJoin(conn: PeerConn): void;
  onPeerLeave(conn: PeerConn): void;
  onMsg(conn: PeerConn, msg: ClientMsg): void;
  onError(err: string): void;
}

export interface ClientHooks {
  onOpen(): void;
  onMsg(msg: HostMsg): void;
  onError(err: string): void;
  onClosed(): void;
}

// (ICE + data-channel name + ICE-gather helper live in ./rtc so both
// transports — REST mailbox and public MQTT relay — stay identical)
const POLL_MS = 1200;

// v3.10 — signaling endpoint override. By default the game talks to its own
// origin (/signal/...). On hosts where THAT origin is blocked (e.g. workers.dev
// is filtered in Iran but the GitHub Pages mirror is not), a ?signal=<base-url>
// URL parameter — persisted to localStorage — repoints all signaling at any
// reachable mirror of this worker. CORS is already open on /signal/*.
let SB: string | null = null;
export function signalBase(): string {
  if (SB !== null) return SB;
  SB = '';
  try {
    const q = new URLSearchParams(location.search).get('signal');
    if (q !== null) {
      SB = q.trim().replace(/\/+$/, '');
      try {
        if (SB) storeSet('ns_signal_base', SB);
        else storeDel('ns_signal_base');
      } catch { /* storage blocked */ }
      return SB;
    }
    const s = storeGet('ns_signal_base');
    if (s) SB = s.replace(/\/+$/, '');
  } catch { /* storage blocked */ }
  return SB;
}

// v3.10 — same-WiFi auto-discovery: live rooms whose HOST shares this device's
// public IP (same router / same mobile line). Server matches on a salted IP
// hash — no IP is ever exposed, no permissions needed, works in the APK too.
export async function fetchNearby(): Promise<{ code: string; players: number }[]> {
  const res = await fetch(signalBase() + '/signal/nearby', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('nearby http ' + res.status);
  const r = await res.json() as { ok?: boolean; rooms?: { code?: unknown; players?: unknown }[] };
  return (r.rooms || []).filter(x =>
    x && typeof x.code === 'string' && /^[A-Z0-9]{4,8}$/.test(x.code)
  ).map(x => ({ code: x.code as string, players: Math.max(1, Math.min(16, Number(x.players) || 1)) }));
}
// v3.9.2 — 20s was too short: a mobile host page freezes the moment the user
// switches apps (e.g. to the chat to share the room code) and only wakes when
// they return to the tab. Offers live 300s server-side, so the joiner now
// waits just as long — the handshake completes the moment the host wakes up.
const ANSWER_TIMEOUT_MS = 300000;

// v3.12 — how long the joiner waits for the data channel to open after the
// signaling handshake completed before giving up on raw WebRTC and switching
// to the same-origin WebSocket relay (?relay=1 skips WebRTC entirely).
const RELAY_AFTER_MS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function forceRelay(): boolean {
  try { return new URLSearchParams(location.search).get('relay') === '1'; } catch { return false; }
}

async function signal<T = Record<string, unknown>>(code: string, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(signalBase() + '/signal/' + encodeURIComponent(code) + '/' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('signal http ' + res.status);
  return res.json() as Promise<T>;
}

// ---- host ----------------------------------------------------------------

export class NetHost {
  code = '';
  private restConns: LanConn[] = [];
  private relayConns: PeerConn[] = [];
  private relay: RelayHostSide | null = null;
  private pcs: RTCPeerConnection[] = [];
  private lastSeq = 0;
  private polling = false;
  private retried = false;
  private mqtt: MqttHost | null = null;
  private mqttTried = false;

  constructor(private hooks: HostHooks) {}

  /** live peer connections (REST mailbox, WS relay or MQTT relay transport) */
  get conns(): PeerConn[] {
    if (this.mqtt) return this.mqtt.conns;
    const all: PeerConn[] = [];
    for (const c of this.restConns) all.push(c);
    for (const c of this.relayConns) all.push(c);
    return all;
  }

  start() {
    this.code = makeRoomCode();
    void this.boot();
  }

  private async boot() {
    if (await pickMode() === 'mqtt') {
      await this.startMqtt();
      return;
    }
    void this.register();
  }

  private async startMqtt() {
    this.mqtt = new MqttHost(this.hooks);
    await this.mqtt.start(this.code);
  }

  private async register() {
    try {
      const r = await signal<{ ok: boolean; taken?: boolean }>(this.code, 'host', 'POST');
      if (r.ok) {
        this.polling = true;
        void this.pollLoop();
        this.startRelayHost(); // v3.12 — listen on the WS relay alongside WebRTC
        this.hooks.onOpen(this.code);
        return;
      }
      if (r.taken && !this.retried) {
        // room code collision — regenerate once, exactly like PeerJS unavailable-id
        this.retried = true;
        this.code = makeRoomCode();
        return void this.register();
      }
      this.hooks.onError('Could not create the room — try again.');
    } catch {
      // server unreachable (filtered origin / dead edge) — fall back to the
      // public MQTT relay once before surfacing the error for real
      if (!this.mqttTried) {
        this.mqttTried = true;
        rememberMqtt();
        await this.startMqtt();
        return;
      }
      this.hooks.onError('Network error — could not create the room. Check your connection.');
    }
  }

  private async pollLoop() {
    while (this.polling) {
      try {
        const r = await signal<{ offers: { seq: number; id: string; sdp: string }[] }>(
          this.code, 'offers?after=' + this.lastSeq, 'GET');
        if (!this.polling) return;
        for (const o of r.offers || []) {
          this.lastSeq = Math.max(this.lastSeq, o.seq);
          void this.accept(o.id, o.sdp);
        }
      } catch { /* transient — next tick retries */ }
      await sleep(POLL_MS);
    }
  }

  private async accept(joinerId: string, offerSdp: string) {
    try {
      const pc = new RTCPeerConnection(NS_ICE);
      this.pcs.push(pc);
      // the JOINER is the offerer and owns the data channel — it arrives here
      // as soon as the remote offer is applied
      pc.ondatachannel = (e) => {
        const conn = new LanConn(pc, e.channel);
        conn.onOpen(() => {
          if (!this.restConns.includes(conn)) {
            this.restConns.push(conn);
            this.hooks.onPeerJoin(conn);
          }
        });
        conn.onClose(() => {
          this.restConns = this.restConns.filter(c => c !== conn);
          this.hooks.onPeerLeave(conn);
        });
        conn.onData(d => this.hooks.onMsg(conn, d as ClientMsg));
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherComplete(pc);
      await signal(this.code, 'answer', 'POST', { id: joinerId, sdp: pc.localDescription!.sdp });
    } catch {
      this.hooks.onError('A player tried to join but the handshake failed.');
    }
  }

  /** v3.12 — listen for relay-only joiners (WebRTC-dead networks) */
  private startRelayHost() {
    try {
      this.relay = new RelayHostSide(relayWsUrl(this.code, signalBase()), {
        onPeer: (conn) => {
          if (!this.relayConns.includes(conn)) {
            this.relayConns.push(conn);
            this.hooks.onPeerJoin(conn);
          }
        },
        onPeerLeave: (conn) => {
          this.relayConns = this.relayConns.filter(c => c !== conn);
          this.hooks.onPeerLeave(conn);
        },
        onMsg: (conn, msg) => this.hooks.onMsg(conn, msg as ClientMsg),
      });
    } catch { /* relay is optional — WebRTC may still work */ }
  }

  broadcast(msg: HostMsg, except?: PeerConn) {
    for (const c of this.conns) {
      if (c === except) continue;
      c.send(msg);
    }
  }

  send(conn: PeerConn, msg: HostMsg) { conn.send(msg); }

  destroy() {
    this.polling = false;
    this.mqtt?.destroy();
    this.mqtt = null;
    this.relay?.close();
    this.relay = null;
    this.relayConns = [];
    this.restConns.forEach(c => c.close());
    this.restConns = [];
    this.pcs.forEach(pc => { try { pc.close(); } catch { /* */ } });
    this.pcs = [];
  }
}

// ---- client ---------------------------------------------------------------

export class NetClient {
  private pc: RTCPeerConnection | null = null;
  private conn: PeerConn | null = null;
  private relayConn: RelayConn | null = null;
  private dead = false;
  private mqtt: MqttClientImpl | null = null;
  private mqttTried = false;

  constructor(private hooks: ClientHooks) {}

  connect(code: string) {
    void this.boot(code.toUpperCase().trim());
  }

  private async boot(code: string) {
    if (await pickMode() === 'mqtt') {
      this.joinMqtt(code);
      return;
    }
    void this.join(code);
  }

  private joinMqtt(code: string) {
    this.mqtt = new MqttClientImpl(this.hooks);
    this.mqtt.connect(code);
  }

  private async join(code: string) {
    try {
      const j = await signal<{ ok: boolean; id?: string; reason?: string }>(code, 'join', 'POST');
      if (this.dead) return;
      if (!j.ok || !j.id) {
        this.hooks.onError(j.reason === 'no-room'
          ? 'Match not found. Check the room code.'
          : 'Could not join the room — try again.');
        return;
      }
      const pc = new RTCPeerConnection(NS_ICE);
      this.pc = pc;
      // the offerer owns the data channel — without it the offer SDP has no
      // m= section and the host cannot answer it
      const dc = pc.createDataChannel(DATA_CHANNEL, { ordered: true });
      const conn = new LanConn(pc, dc);
      this.conn = conn;
      conn.onOpen(() => this.hooks.onOpen());
      conn.onClose(() => this.hooks.onClosed());
      conn.onData(d => this.hooks.onMsg(d as HostMsg));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherComplete(pc);
      await signal(code, 'offer', 'POST', { id: j.id, sdp: pc.localDescription!.sdp });
      if (forceRelay()) {
        // v3.12 — debug/deep-filtered-networks switch: skip WebRTC entirely
        try { pc.close(); } catch { /* */ }
        this.pc = null;
        this.conn = null;
        this.startRelay(code, j.id);
        return;
      }
      // wait for the host's answer (host polls offers every ~1.2 s)
      const deadline = Date.now() + ANSWER_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.dead) return;
        await sleep(POLL_MS);
        const a = await signal<{ ok: boolean; sdp?: string; waiting?: boolean }>(
          code, 'answer?id=' + encodeURIComponent(j.id), 'GET');
        if (this.dead) return;
        if (a.ok && a.sdp) {
          await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
          // v3.12 — ICE can die silently here (UDP-restricted networks, VPN/TUN
          // clients without UDP forwarding, public TURN relays that come and
          // go). Give the channel a short window; if it stays dark, switch to
          // the same-origin WebSocket relay that rides the path that already
          // works (this page was served over it).
          if (await this.channelOrTimeout(conn, pc)) return;
          if (this.dead) return;
          conn.closeSilent();
          this.pc = null;
          this.conn = null;
          this.startRelay(code, j.id);
          return;
        }
      }
      if (!this.dead) {
        this.hooks.onError('Could not reach the host — the room may have expired. Get a fresh code.');
      }
    } catch {
      // server unreachable — fall back to the public MQTT relay once
      if (!this.dead && !this.mqttTried) {
        this.mqttTried = true;
        rememberMqtt();
        this.joinMqtt(code);
        return;
      }
      if (!this.dead) this.hooks.onError('Network error — check your internet connection.');
    }
  }

  /** resolve true if the data channel opened, false on ICE failure / timeout */
  private channelOrTimeout(conn: LanConn, pc: RTCPeerConnection): Promise<boolean> {
    return new Promise(resolve => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        pc.removeEventListener('connectionstatechange', on);
        clearTimeout(t);
        resolve(v);
      };
      const on = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(false);
      };
      const t = setTimeout(() => finish(false), RELAY_AFTER_MS);
      pc.addEventListener('connectionstatechange', on);
      conn.onOpen(() => finish(true));
    });
  }

  /** v3.12 — last-resort transport: the WebSocket relay on the game's own worker */
  private startRelay(code: string, id: string) {
    if (this.dead) return;
    const rc = new RelayConn(relayWsUrl(code, signalBase()), { t: 'hi', role: 'j', id });
    this.relayConn = rc;
    this.conn = rc;
    rc.onOpen(() => this.hooks.onOpen());
    rc.onClose(() => this.hooks.onClosed());
    rc.onData(d => this.hooks.onMsg(d as HostMsg));
  }

  send(msg: ClientMsg) {
    if (this.mqtt) { this.mqtt.send(msg); return; }
    this.conn?.send(msg);
  }

  destroy() {
    this.dead = true;
    this.mqtt?.destroy();
    this.mqtt = null;
    this.relayConn?.close();
    this.relayConn = null;
    try { this.conn?.close(); } catch { /* */ }
    try { this.pc?.close(); } catch { /* */ }
    this.conn = null;
    this.pc = null;
  }
}
