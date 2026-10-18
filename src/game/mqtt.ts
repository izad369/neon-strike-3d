// DESERT STRIKE 3D — v3.11 censorship-proof signaling relay.
//
// workers.dev is SNI-filtered in Iran (and other networks), but WebRTC
// itself usually still works — the SDP handshake is the only thing that
// needs a mailbox. This module mirrors the REST signaling flow over free
// public MQTT-over-WSS brokers (EMQX / HiveMQ / Mosquitto test brokers —
// no account, no key, plain pub/sub). Topic map:
//
//   ns3d/p1/dir                  -> live-room directory (host presence)
//   ns3d/p1/r/<CODE>/h           -> host presence for one room
//   ns3d/p1/r/<CODE>/o/<peer>    -> joiner -> host : offer SDP
//   ns3d/p1/r/<CODE>/a/<peer>    -> host -> joiner : answer SDP
//
// Security model is identical to the open REST API: the room code is the
// capability. Only payload JSON is validated; topics are matched strictly.
import mqtt, { type MqttClient as IMqtt } from 'mqtt';
import { LanConn } from './lan';
import { NS_ICE, DATA_CHANNEL, gatherComplete } from './rtc';
import type { ClientMsg, HostMsg } from './constants';
import type { HostHooks, ClientHooks } from './net';
import { storeGet, storeSet } from './store';

const PREFIX = 'ns3d/p1';
const ANNOUNCE_MS = 2000;   // host presence cadence
const FRESH_MS = 15000;     // presence older than this is dead
const ANSWER_TIMEOUT_MS = 300000; // mirror the REST transport (frozen mobile hosts)

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

let brokerMemo = -1;
try { brokerMemo = Number(storeGet('ns_broker')) || -1; } catch { /* blocked */ }

function brokerOrder(): string[] {
  if (brokerMemo >= 0 && brokerMemo < BROKERS.length) {
    return [BROKERS[brokerMemo], ...BROKERS.filter((_, i) => i !== brokerMemo)];
  }
  return BROKERS;
}

function newClientId(): string {
  return ('ns3d' + Math.random().toString(36).slice(2, 10)).slice(0, 23);
}

/** connect to the first reachable public broker (remembers the winner) */
function connectBroker(): Promise<IMqtt> {
  return new Promise((resolve, reject) => {
    const list = brokerOrder();
    let i = 0;
    const tryNext = () => {
      if (i >= list.length) { reject(new Error('no relay reachable')); return; }
      const url = list[i++];
      let settled = false;
      const cli = mqtt.connect(url, {
        clientId: newClientId(),
        keepalive: 60,
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 4000, // auto-reconnect keeps live sessions alive
        resubscribe: true,     // re-subscribe after reconnect (clean session)
      });
      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { cli.end(true); } catch { /* */ }
        tryNext();
      }, 7000);
      cli.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        brokerMemo = BROKERS.indexOf(url);
        try { storeSet('ns_broker', String(brokerMemo)); } catch { /* */ }
        resolve(cli);
      });
      cli.on('error', () => { /* pre-connect failures land in failTimer */ });
    };
    tryNext();
  });
}

function sdpOf(payload: Uint8Array): string {
  try {
    const d = JSON.parse(new TextDecoder().decode(payload)) as { sdp?: unknown };
    const s = typeof d.sdp === 'string' ? d.sdp : '';
    return s && s.length < 40000 ? s : '';
  } catch { return ''; }
}

function sub(cli: IMqtt, topic: string, qos: 0 | 1): Promise<void> {
  return new Promise(res => { try { cli.subscribe(topic, { qos }, () => res()); } catch { res(); } });
}

function pub(cli: IMqtt, topic: string, payload: string, qos: 0 | 1): Promise<void> {
  return new Promise(res => { try { cli.publish(topic, payload, { qos }, () => res()); } catch { res(); } });
}

// ---- host -----------------------------------------------------------------

export class MqttHost {
  code = '';
  readonly conns: LanConn[] = [];
  private relay: IMqtt | null = null;
  private alive = false;
  private seen = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private hooks: HostHooks) {}

  async start(code: string) {
    this.code = code;
    this.alive = true;
    try {
      this.relay = await connectBroker();
    } catch {
      if (this.alive) this.hooks.onError('Could not reach the relay network — check your connection.');
      return;
    }
    if (!this.alive) return;
    const cli = this.relay;
    cli.on('message', (t, p) => this.onMessage(t, p));
    await sub(cli, `${PREFIX}/r/${code}/o/+`, 1);
    await sub(cli, `${PREFIX}/r/${code}/p/+`, 0);
    this.timer = setInterval(() => void this.announce(), ANNOUNCE_MS);
    void this.announce();
    this.hooks.onOpen(code);
  }

  private async announce() {
    if (!this.relay || !this.alive) return;
    const m = JSON.stringify({ code: this.code, t: Date.now(), players: this.conns.length + 1 });
    await pub(this.relay, `${PREFIX}/r/${this.code}/h`, m, 0);
    await pub(this.relay, `${PREFIX}/dir`, m, 0);
  }

  private onMessage(topic: string, payload: Uint8Array) {
    if (!this.alive) return;
    const pm = topic.match(/^ns3d\/p1\/r\/([A-Z0-9]{4,8})\/p\/([A-Za-z0-9]+)$/);
    if (pm && pm[1] === this.code) {
      // a joiner is probing for this room — answer immediately. Websocket
      // events are NOT timer-throttled in background tabs (unlike
      // setInterval), so this keeps the handshake alive even when the host
      // tab is backgrounded/mobile-frozen.
      this.announceSoon();
      return;
    }
    const m = topic.match(/^ns3d\/p1\/r\/([A-Z0-9]{4,8})\/o\/([A-Za-z0-9]+)$/);
    if (!m || m[1] !== this.code || this.seen.has(m[2])) return;
    this.seen.add(m[2]);
    const sdp = sdpOf(payload);
    if (sdp) void this.accept(m[2], sdp);
  }

  private lastPingAnnounce = 0;
  private announceSoon() {
    const now = Date.now();
    if (now - this.lastPingAnnounce < 400) return;
    this.lastPingAnnounce = now;
    void this.announce();
  }

  private async accept(peer: string, offerSdp: string) {
    try {
      const pc = new RTCPeerConnection(NS_ICE);
      // the JOINER is the offerer and owns the data channel
      pc.ondatachannel = (e) => {
        const conn = new LanConn(pc, e.channel);
        conn.onOpen(() => {
          if (!this.conns.includes(conn)) {
            this.conns.push(conn);
            this.hooks.onPeerJoin(conn);
          }
        });
        conn.onClose(() => {
          const i = this.conns.indexOf(conn);
          if (i >= 0) this.conns.splice(i, 1);
          this.hooks.onPeerLeave(conn);
        });
        conn.onData(d => this.hooks.onMsg(conn, d as ClientMsg));
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherComplete(pc);
      if (this.relay) await pub(this.relay, `${PREFIX}/r/${this.code}/a/${peer}`, JSON.stringify({ sdp: pc.localDescription!.sdp }), 1);
    } catch {
      this.hooks.onError('A player tried to join but the handshake failed.');
    }
  }

  broadcast(msg: HostMsg, except?: LanConn) {
    for (const c of this.conns) { if (c === except) continue; c.send(msg); }
  }

  send(conn: LanConn, msg: HostMsg) { conn.send(msg); }

  destroy() {
    this.alive = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const c of this.conns) { try { c.close(); } catch { /* */ } }
    this.conns.length = 0;
    try { this.relay?.end(true); } catch { /* */ }
    this.relay = null;
  }
}

// ---- client ---------------------------------------------------------------

export class MqttClient {
  private pc: RTCPeerConnection | null = null;
  private conn: LanConn | null = null;
  private relay: IMqtt | null = null;
  private dead = false;

  constructor(private hooks: ClientHooks) {}

  connect(code: string) { void this.join(code.toUpperCase().trim()); }

  private async join(code: string) {
    try {
      this.relay = await connectBroker();
      if (this.dead) return;
      const cli = this.relay;
      const myId = 'J' + Math.random().toString(36).slice(2, 8);

      // subscriptions FIRST so no message can slip between offer and listen
      await sub(cli, `${PREFIX}/r/${code}/a/${myId}`, 1);
      await sub(cli, `${PREFIX}/r/${code}/h`, 0);
      if (this.dead) return;

      // fast "Match not found" probe: ping the room; a live host answers
      // with an immediate presence announce (event-driven, throttle-proof).
      const live = await this.waitPresence(code, myId, 8000);
      if (this.dead) return;

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
      await pub(cli, `${PREFIX}/r/${code}/o/${myId}`, JSON.stringify({ sdp: pc.localDescription!.sdp }), 1);

      // presence seen -> wait as long as the REST transport does (frozen
      // mobile hosts). No presence at all -> short grace, then it really is
      // a wrong/dead room code.
      const answerSdp = await this.waitAnswer(live ? ANSWER_TIMEOUT_MS : 30000);
      if (this.dead) return;
      if (answerSdp) {
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        return; // datachannel opens (or errors) from here
      }
      if (live) {
        this.hooks.onError('Could not reach the host — the room may have expired. Get a fresh code.');
      } else {
        this.hooks.onError('Match not found. Check the room code.');
      }
    } catch {
      if (!this.dead) this.hooks.onError('Network error — check your internet connection.');
    }
  }

  private waitPresence(code: string, myId: string, ms: number): Promise<boolean> {
    return new Promise(res => {
      const cli = this.relay!;
      let got = false;
      const onMsg = (_t: string, p: Uint8Array) => {
        try {
          const d = JSON.parse(new TextDecoder().decode(p)) as { t?: unknown };
          if (typeof d.t === 'number' && Date.now() - d.t < FRESH_MS) got = true;
        } catch { /* */ }
      };
      cli.on('message', onMsg);
      const t0 = Date.now();
      // probe pings wake an event-driven host announcement even when the
      // host tab is background-throttled
      const ping = setInterval(() => {
        if (got || this.dead) return;
        void pub(cli, `${PREFIX}/r/${code}/p/${myId}`, JSON.stringify({ t: Date.now() }), 0);
      }, 1500);
      void pub(cli, `${PREFIX}/r/${code}/p/${myId}`, JSON.stringify({ t: Date.now() }), 0);
      const iv = setInterval(() => {
        if (got || this.dead || Date.now() - t0 > ms) {
          clearInterval(iv);
          clearInterval(ping);
          cli.removeListener('message', onMsg);
          res(got);
        }
      }, 250);
    });
  }

  private waitAnswer(timeoutMs: number): Promise<string | null> {
    return new Promise(res => {
      const cli = this.relay!;
      const onMsg = (_t: string, p: Uint8Array) => {
        const sdp = sdpOf(p);
        if (sdp) { cleanup(); res(sdp); }
      };
      const cleanup = () => { clearTimeout(timer); cli.removeListener('message', onMsg); };
      cli.on('message', onMsg);
      const timer = setTimeout(() => { cleanup(); res(null); }, ANSWER_TIMEOUT_MS);
    });
  }

  send(msg: ClientMsg) { this.conn?.send(msg); }

  destroy() {
    this.dead = true;
    try { this.conn?.close(); } catch { /* */ }
    try { this.pc?.close(); } catch { /* */ }
    try { this.relay?.end(true); } catch { /* */ }
    this.conn = null;
    this.pc = null;
    this.relay = null;
  }
}

// ---- directory ------------------------------------------------------------

export interface RelayRoom { code: string; players: number }

/** one-shot directory scan: which rooms are live on the relay right now */
export async function mqttNearbyScan(ms = 3200): Promise<RelayRoom[]> {
  const cli = await connectBroker();
  const rooms = new Map<string, RelayRoom>();
  await sub(cli, `${PREFIX}/dir`, 0);
  await new Promise<void>(res => {
    const onMsg = (_t: string, p: Uint8Array) => {
      try {
        const d = JSON.parse(new TextDecoder().decode(p)) as { code?: unknown; t?: unknown; players?: unknown };
        if (typeof d.code !== 'string' || !/^[A-Z0-9]{4,8}$/.test(d.code)) return;
        if (typeof d.t !== 'number' || Date.now() - d.t > FRESH_MS) return;
        rooms.set(d.code, { code: d.code, players: Math.max(1, Math.min(16, Number(d.players) || 1)) });
      } catch { /* */ }
    };
    cli.on('message', onMsg);
    setTimeout(() => { cli.removeListener('message', onMsg); res(); }, ms);
  });
  try { cli.end(true); } catch { /* */ }
  return [...rooms.values()].sort((a, b) => b.players - a.players).slice(0, 6);
}
