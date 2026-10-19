// DESERT STRIKE 3D — LAN (Wi-Fi) multiplayer: manual-signaling WebRTC.
// Zero servers, zero internet: both devices must be on the same Wi-Fi network.
// The invite/answer codes carry the full SDP (deflate-compressed, base64url),
// exchanged by QR scan or copy/paste. ICE servers are intentionally EMPTY so the
// connection can only ever form over the local network (host candidates only).
//
// Code format:  "DSL" + ver + base64url(payload)   → invite (offer)  DSL1/DSL0
//               "DSA" + ver + base64url(payload)   → answer           DSA1/DSA0
// payload (ver 1) = deflate-raw(JSON {type,sdp});  ver 0 = uncompressed JSON.

export class LanConn {
  open = false;
  private dataCb: ((msg: unknown) => void) | null = null;
  private openCbs: (() => void)[] = [];
  private closeCbs: (() => void)[] = [];

  constructor(public pc: RTCPeerConnection, private ch: RTCDataChannel) {
    ch.onopen = () => {
      this.open = true;
      this.openCbs.forEach(f => { try { f(); } catch { /* */ } });
    };
    ch.onclose = () => {
      this.open = false;
      this.closeCbs.forEach(f => { try { f(); } catch { /* */ } });
    };
    ch.onerror = () => { /* close event follows */ };
    ch.onmessage = e => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
        if (msg && typeof msg === 'object') this.dataCb?.(msg);
      } catch { /* ignore malformed frames */ }
    };
  }

  onData(cb: (msg: unknown) => void) { this.dataCb = cb; }
  onOpen(cb: () => void) { if (this.open) cb(); this.openCbs.push(cb); }
  onClose(cb: () => void) { this.closeCbs.push(cb); }

  send(msg: unknown) {
    if (this.ch.readyState === 'open') {
      try { this.ch.send(JSON.stringify(msg)); } catch { /* channel closing */ }
    }
  }

  close() {
    try { this.ch.close(); } catch { /* */ }
    try { this.pc.close(); } catch { /* */ }
  }

  /** v3.12 — abandon a never-opened path without firing onClose (the game must
   * not mistake a transport switch for a peer leaving) */
  closeSilent() {
    this.closeCbs = [];
    this.openCbs = [];
    this.dataCb = null;
    this.open = false;
    try { this.ch.close(); } catch { /* */ }
    try { this.pc.close(); } catch { /* */ }
  }
}

// ---- SDP <-> code helpers ------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeCode(kind: 'DSL' | 'DSA', desc: RTCSessionDescriptionInit): Promise<string> {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp });
  const raw: Uint8Array = new TextEncoder().encode(json);
  let ver = '0';
  let payload: Uint8Array = raw;
  if (typeof CompressionStream !== 'undefined') {
    try { payload = await deflateRaw(raw); ver = '1'; } catch { /* keep raw */ }
  }
  return kind + ver + b64urlEncode(payload);
}

async function decodeCode(code: string): Promise<{ kind: 'DSL' | 'DSA'; desc: RTCSessionDescriptionInit }> {
  const c = (code || '').trim().replace(/\s+/g, '');
  const kind = c.startsWith('DSL') ? 'DSL' : c.startsWith('DSA') ? 'DSA' : null;
  if (!kind || c.length < 12) throw new Error('That does not look like a Wi-Fi code.');
  const bytes = b64urlDecode(c.slice(4));
  const ver = c[3];
  let json: string;
  try {
    json = new TextDecoder().decode(ver === '1' ? await inflateRaw(bytes) : bytes);
  } catch {
    throw new Error('Corrupted code — copy it again.');
  }
  let desc: RTCSessionDescriptionInit;
  try {
    const o = JSON.parse(json) as { t?: string; s?: string };
    desc = { type: o.t as RTCSdpType, sdp: o.s };
  } catch {
    throw new Error('Corrupted code — copy it again.');
  }
  if (!desc.sdp || (desc.type !== 'offer' && desc.type !== 'answer')) throw new Error('Corrupted code — copy it again.');
  return { kind, desc };
}

/** resolve after ICE gathering finishes (or timeout — host candidates appear fast) */
function gatherComplete(pc: RTCPeerConnection, ms = 2000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', on); clearTimeout(t); res(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

function rtcErr(e: unknown): string {
  const m = (e as Error)?.message || 'Unknown Wi-Fi link error.';
  if (/setRemote|Sdp|sdp|Answer|answer/i.test(m)) return 'Wrong code or code from another session — use the LATEST codes.';
  return m;
}

// ---- host ----------------------------------------------------------------

export interface LanHostHooks {
  onPeerJoin(conn: LanConn): void;
  onPeerLeave(conn: LanConn): void;
  onMsg(conn: LanConn, msg: unknown): void;
  onError(err: string): void;
  /** a fresh invite code is ready to show as QR / copy-paste */
  onInviteReady(invite: string): void;
  /** the pending invite produced a live connection */
  onPlayerConnected(): void;
}

export class LanHost {
  conns: LanConn[] = [];
  code = 'WI-FI'; // hud label compatibility
  private pending: { pc: RTCPeerConnection; conn: LanConn } | null = null;
  private pcs: RTCPeerConnection[] = [];

  constructor(private hooks: LanHostHooks) {}

  /** create (or re-create) an invite for the NEXT player */
  async createInvite() {
    try {
      this.pending = null;
      const pc = new RTCPeerConnection({ iceServers: [] }); // LAN only — no STUN/TURN
      this.pcs.push(pc);
      const dc = pc.createDataChannel('ns3d', { ordered: true });
      const conn = new LanConn(pc, dc);
      conn.onOpen(() => {
        if (this.pending?.conn === conn) this.pending = null;
        if (!this.conns.includes(conn)) {
          this.conns.push(conn);
          this.hooks.onPlayerConnected();
          this.hooks.onPeerJoin(conn);
        }
      });
      conn.onClose(() => this.dropConn(conn));
      conn.onData(d => this.hooks.onMsg(conn, d));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherComplete(pc);
      this.pending = { pc, conn };
      const invite = await encodeCode('DSL', pc.localDescription!);
      this.hooks.onInviteReady(invite);
    } catch (e) {
      this.hooks.onError(rtcErr(e));
    }
  }

  /** complete the pending invite with the joiner's answer code */
  async acceptAnswer(code: string) {
    if (!this.pending) throw new Error('No invite waiting — tap "New invite code" first.');
    try {
      const { kind, desc } = await decodeCode(code);
      if (kind !== 'DSA') throw new Error('That is an INVITE code. Paste the ANSWER code your friend got.');
      await this.pending.pc.setRemoteDescription(desc);
    } catch (e) {
      throw new Error(rtcErr(e));
    }
  }

  private dropConn(conn: LanConn) {
    this.conns = this.conns.filter(c => c !== conn);
    try { conn.pc.close(); } catch { /* */ }
    this.hooks.onPeerLeave(conn);
  }

  hasPendingInvite() { return !!this.pending; }

  broadcast(msg: unknown, except?: LanConn) {
    for (const c of this.conns) {
      if (c === except) continue;
      c.send(msg);
    }
  }

  send(conn: LanConn, msg: unknown) { conn.send(msg); }

  destroy() {
    this.conns.forEach(c => c.close());
    this.conns = [];
    this.pcs.forEach(pc => { try { pc.close(); } catch { /* */ } });
    this.pcs = [];
    this.pending = null;
  }
}

// ---- client ---------------------------------------------------------------

export interface LanClientHooks {
  onOpen(): void;
  onMsg(msg: unknown): void;
  onError(err: string): void;
  onClosed(): void;
  /** the answer code the joiner must hand back to the host */
  onAnswerReady(answer: string): void;
  onInviteAccepted(): void; // offer parsed, answer being generated
}

export class LanClient {
  private pc: RTCPeerConnection | null = null;
  private conn: LanConn | null = null;

  constructor(private hooks: LanClientHooks) {}

  async connect(inviteCode: string) {
    try {
      const { kind, desc } = await decodeCode(inviteCode);
      if (kind !== 'DSL') throw new Error('That is an ANSWER code. Paste the INVITE code shown on the host screen.');
      const pc = new RTCPeerConnection({ iceServers: [] }); // LAN only
      this.pc = pc;
      pc.ondatachannel = e => {
        const conn = new LanConn(pc, e.channel);
        this.conn = conn;
        conn.onOpen(() => this.hooks.onOpen());
        conn.onClose(() => this.hooks.onClosed());
        conn.onData(d => this.hooks.onMsg(d));
      };
      await pc.setRemoteDescription(desc);
      this.hooks.onInviteAccepted();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherComplete(pc);
      this.hooks.onAnswerReady(await encodeCode('DSA', pc.localDescription!));
    } catch (e) {
      this.hooks.onError(rtcErr(e));
    }
  }

  send(msg: unknown) { this.conn?.send(msg); }

  destroy() {
    try { this.conn?.close(); } catch { /* */ }
    try { this.pc?.close(); } catch { /* */ }
    this.conn = null;
    this.pc = null;
  }
}
