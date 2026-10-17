// DESERT STRIKE 3D - P2P networking (host authoritative).
// Signaling: a tiny HTTPS mailbox served by the SAME worker that serves the
// game (/signal/<code>/...) — no third-party server, no WebSocket, so it works
// anywhere the game page itself loads (including networks that block or
// throttle the public PeerJS cloud / Google STUN endpoints).
// Gameplay: raw WebRTC DataChannel between peers, host authoritative.
import { LanConn } from './lan';
import { makeRoomCode, ClientMsg, HostMsg } from './constants';

export interface HostHooks {
  onOpen(code: string): void;
  onPeerJoin(conn: LanConn): void;
  onPeerLeave(conn: LanConn): void;
  onMsg(conn: LanConn, msg: ClientMsg): void;
  onError(err: string): void;
}

export interface ClientHooks {
  onOpen(): void;
  onMsg(msg: HostMsg): void;
  onError(err: string): void;
  onClosed(): void;
}

// Public STUN so peers behind different NATs can find each other.
// Cloudflare STUN lives on the same edge as the game itself (reachable
// wherever the page loads); Google STUN stays as a backup.
// v3.9.2 — added free public TURN relay (metered.ca OpenRelay) so peers on
// UDP-restricted networks (mobile carriers, censoring ISPs) can still
// connect: TURN/TCP 443 traverses almost every firewall. One side relaying
// is enough for the pair to connect.
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    {
      urls: [
        'turn:openrelay.metered.ca:80?transport=udp',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

const DATA_CHANNEL = 'ns3d';
const POLL_MS = 1200;
const ANSWER_TIMEOUT_MS = 20000;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function signal<T = Record<string, unknown>>(code: string, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch('/signal/' + encodeURIComponent(code) + '/' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('signal http ' + res.status);
  return res.json() as Promise<T>;
}

/** resolve after ICE gathering finishes (or timeout — keep the handshake snappy) */
function gatherComplete(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', on); clearTimeout(t); res(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

// ---- host ----------------------------------------------------------------

export class NetHost {
  code = '';
  conns: LanConn[] = [];
  private pcs: RTCPeerConnection[] = [];
  private lastSeq = 0;
  private polling = false;
  private retried = false;

  constructor(private hooks: HostHooks) {}

  start() {
    this.code = makeRoomCode();
    void this.register();
  }

  private async register() {
    try {
      const r = await signal<{ ok: boolean; taken?: boolean }>(this.code, 'host', 'POST');
      if (r.ok) {
        this.polling = true;
        void this.pollLoop();
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
      const pc = new RTCPeerConnection(ICE);
      this.pcs.push(pc);
      // the JOINER is the offerer and owns the data channel — it arrives here
      // as soon as the remote offer is applied
      pc.ondatachannel = (e) => {
        const conn = new LanConn(pc, e.channel);
        conn.onOpen(() => {
          if (!this.conns.includes(conn)) {
            this.conns.push(conn);
            this.hooks.onPeerJoin(conn);
          }
        });
        conn.onClose(() => {
          this.conns = this.conns.filter(c => c !== conn);
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

  broadcast(msg: HostMsg, except?: LanConn) {
    for (const c of this.conns) {
      if (c === except) continue;
      c.send(msg);
    }
  }

  send(conn: LanConn, msg: HostMsg) { conn.send(msg); }

  destroy() {
    this.polling = false;
    this.conns.forEach(c => c.close());
    this.conns = [];
    this.pcs.forEach(pc => { try { pc.close(); } catch { /* */ } });
    this.pcs = [];
  }
}

// ---- client ---------------------------------------------------------------

export class NetClient {
  private pc: RTCPeerConnection | null = null;
  private conn: LanConn | null = null;
  private dead = false;

  constructor(private hooks: ClientHooks) {}

  connect(code: string) {
    void this.join(code.toUpperCase().trim());
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
      const pc = new RTCPeerConnection(ICE);
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
          return; // datachannel opens (or errors) from here
        }
      }
      if (!this.dead) {
        this.hooks.onError('Could not reach the host — the room may have expired. Get a fresh code.');
      }
    } catch {
      if (!this.dead) this.hooks.onError('Network error — check your internet connection.');
    }
  }

  send(msg: ClientMsg) { this.conn?.send(msg); }

  destroy() {
    this.dead = true;
    try { this.conn?.close(); } catch { /* */ }
    try { this.pc?.close(); } catch { /* */ }
    this.conn = null;
    this.pc = null;
  }
}
