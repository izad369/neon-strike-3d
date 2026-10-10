// DESERT STRIKE 3D - menu system (DOM)
import { Difficulty, GameMode, MapId } from './constants';
import { esc } from './menus-utils';
import { TouchMode, touchModePref, detectTouch } from './touch';

export type MenuPanel = 'main' | 'offline' | 'online' | 'lobby' | 'pause' | 'end' | 'help';

export interface MenuCallbacks {
  onStartOffline(name: string, bots: number, diff: Difficulty, mode: GameMode, map: MapId): void;
  onHost(name: string, bots: number, diff: Difficulty, mode: GameMode, map: MapId): void;
  onJoin(name: string, code: string): void;
  onResume(): void;
  onLeaveToMenu(): void;
  onRestartMatch(): void;
  onTouchMode(mode: TouchMode): void;
}

export class Menus {
  private panels: Record<MenuPanel, HTMLElement> = {} as Record<MenuPanel, HTMLElement>;
  private wrap: HTMLElement;
  nameInput!: HTMLInputElement;
  private codeInput!: HTMLInputElement;
  private botsInput!: HTMLInputElement;
  private diff: Difficulty = 'medium';
  private mode: GameMode = 'dm';
  private lobbyCodeEl!: HTMLElement;
  private lobbyPlayersEl!: HTMLElement;
  private lobbyNoteEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private onlineStatusEl!: HTMLElement;
  private endBoardEl!: HTMLElement;
  private endTitleEl!: HTMLElement;
  private endSubEl!: HTMLElement;
  private restartBtn!: HTMLButtonElement;
  sensSlider!: HTMLInputElement;
  volSlider!: HTMLInputElement;

  constructor(private root: HTMLElement, private cb: MenuCallbacks) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'ns-menu ns-hidden';
    root.appendChild(this.wrap);
    this.buildMain();
    this.buildOffline();
    this.buildOnline();
    this.buildLobby();
    this.buildPause();
    this.buildEnd();
    this.buildHelp();
  }

  private el(html: string): HTMLDivElement {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild as HTMLDivElement;
  }

  private addPanel(id: MenuPanel, inner: HTMLElement) {
    inner.classList.add('ns-menu-inner');
    this.panels[id] = inner;
    this.wrap.appendChild(inner);
  }

  private buildMain() {
    const p = this.el(`<div>
      <div class="ns-title">DESERT STRIKE</div>
      <div class="ns-subtitle">3D Military Arena FPS &mdash; Offline &amp; Online</div>
      <div class="ns-field"><label>Player name</label><input class="ns-input ns-name" maxlength="14" placeholder="ENTER NAME" /></div>
      <button class="ns-btn primary ns-b-offline">Play Offline &nbsp;(vs Bots)</button>
      <button class="ns-btn ns-b-online">Play Online &nbsp;(with Friends)</button>
      <button class="ns-btn ns-b-help">How to Play</button>
      <div class="ns-status"></div>
      <div class="ns-foot">WEBGL &bull; PEER-TO-PEER &bull; WORKS ON CLOUDFLARE PAGES</div>
      <div class="ns-mobile-note">&#9888; Keyboard &amp; mouse required &mdash; play on a desktop browser.</div>
    </div>`);
    this.nameInput = p.querySelector('.ns-name')!;
    this.statusEl = p.querySelector('.ns-status')!;
    p.querySelector('.ns-b-offline')!.addEventListener('click', () => { this.show('offline'); });
    p.querySelector('.ns-b-online')!.addEventListener('click', () => { this.show('online'); });
    p.querySelector('.ns-b-help')!.addEventListener('click', () => { this.show('help'); });
    // positive note when touch is available (detection includes ?touch=1 for desktop preview)
    const note = p.querySelector('.ns-mobile-note') as HTMLElement;
    if (detectTouch()) {
      note.classList.add('ok');
      note.innerHTML = '&#10003; Touch controls ready &mdash; play on your phone or tablet (landscape recommended).';
      note.style.display = 'block';
    }
    this.addPanel('main', p);
  }

  private diffSeg(): HTMLElement {
    const seg = this.el(`<div class="ns-seg">
      <button data-d="easy">Easy</button><button data-d="medium" class="on">Medium</button><button data-d="hard">Hard</button>
    </div>`);
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      this.diff = b.dataset.d as Difficulty;
    }));
    return seg;
  }

  private botsSeg(): { el: HTMLElement; get: () => number } {
    const seg = this.el(`<div class="ns-seg">
      <button data-n="3">3</button><button data-n="5" class="on">5</button><button data-n="8">8</button>
    </div>`);
    let n = 5;
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      n = parseInt(b.dataset.n!, 10);
    }));
    return { el: seg, get: () => n };
  }

  private offlineBots = 5;
  private lobbyBots = 4;
  private onlineMode: GameMode = 'dm';

  private mapSeg(): { el: HTMLElement; get: () => MapId } {
    const seg = this.el(`<div class="ns-seg ns-map-seg">
      <button data-m="outpost" class="on">OUTPOST</button><button data-m="urban">URBAN</button><button data-m="oasis">OASIS</button>
    </div>`);
    let m: MapId = 'outpost';
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      m = b.dataset.m as MapId;
    }));
    return { el: seg, get: () => m };
  }

  private buildOffline() {
    const p = this.el(`<div>
      <div class="ns-panel-title">OFFLINE MATCH</div>
      <div class="ns-subtitle">Pick a mode &bull; vs bots</div>
      <div class="ns-field"><label>Game mode</label></div>
      <div class="ns-mode-slot"></div>
      <div class="ns-field ns-map-field"><label>Map</label></div>
      <div class="ns-map-slot"></div>
      <div class="ns-field"><label>Bot difficulty</label></div>
      <div class="ns-diff-slot"></div>
      <div class="ns-field ns-bots-field"><label>Bots</label></div>
      <div class="ns-bots-slot"></div>
      <div class="ns-mode-desc"></div>
      <button class="ns-btn primary ns-go">Start Match</button>
      <button class="ns-btn small ns-back">Back</button>
    </div>`);
    const modeSeg = this.el(`<div class="ns-seg ns-mode-seg">
      <button data-m="dm" class="on">DM</button><button data-m="tdm">TDM</button><button data-m="survival">SURVIVAL</button><button data-m="gun">GUN GAME</button><button data-m="duel">DUEL</button><button data-m="br">BATTLE ROYALE</button>
    </div>`);
    const modeDesc = p.querySelector('.ns-mode-desc') as HTMLElement;
    const botsField = p.querySelector('.ns-bots-field') as HTMLElement;
    const botsSlot = p.querySelector('.ns-bots-slot') as HTMLElement;
    const mapField = p.querySelector('.ns-map-field') as HTMLElement;
    const mapSlot = p.querySelector('.ns-map-slot') as HTMLElement;
    const DESCS: Record<GameMode, string> = {
      dm: 'Free-for-all. First to 25 kills or best score in 5:00 wins.',
      tdm: 'You + allied bots vs enemy squad. First team to 40 kills wins.',
      survival: 'Endless waves. Each wave is bigger and meaner. No respawns!',
      gun: 'Every kill unlocks the next weapon. Finish all 10 guns to win.',
      duel: '1v1 against one bot. First to win 3 rounds takes the duel.',
      br: 'Jump from the plane, loot 150+ items, climb the towers, survive the shrinking zone. Last squad standing wins.',
    };
    const ms = this.mapSeg();
    const applyMode = (m: GameMode) => {
      this.mode = m;
      modeDesc.textContent = DESCS[m];
      const hideBots = m !== 'dm' && m !== 'tdm';
      botsField.style.display = hideBots ? 'none' : '';
      botsSlot.style.display = hideBots ? 'none' : '';
      const hideMap = m === 'br'; // BR always plays the huge WARZONE map
      mapField.style.display = hideMap ? 'none' : '';
      mapSlot.style.display = hideMap ? 'none' : '';
    };
    modeSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      modeSeg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      applyMode(b.dataset.m as GameMode);
    }));
    applyMode('dm');
    const diffSlot = p.querySelector('.ns-diff-slot')!;
    diffSlot.replaceWith(this.diffSeg());
    p.querySelector('.ns-mode-slot')!.replaceWith(modeSeg);
    p.querySelector('.ns-map-slot')!.replaceWith(ms.el);
    const bs = this.botsSeg();
    p.querySelector('.ns-bots-slot')!.replaceWith(bs.el);
    p.querySelector('.ns-go')!.addEventListener('click', () => {
      this.offlineBots = bs.get();
      this.cb.onStartOffline(this.playerName(), this.offlineBots, this.diff, this.mode, this.mode === 'br' ? 'outpost' : ms.get());
    });
    p.querySelector('.ns-back')!.addEventListener('click', () => this.show('main'));
    this.addPanel('offline', p);
  }

  private buildOnline() {
    const p = this.el(`<div>
      <div class="ns-panel-title">ONLINE MATCH</div>
      <div class="ns-subtitle">Peer-to-peer with friends</div>
      <div class="ns-field"><label>Host mode</label></div>
      <div class="ns-hostmode-slot"></div>
      <div class="ns-field ns-hostmap-field"><label>Host map</label></div>
      <div class="ns-hostmap-slot"></div>
      <button class="ns-btn primary ns-host">Create Match (get code)</button>
      <div class="ns-field" style="margin-top:22px"><label>Or join with room code</label>
        <div class="ns-row"><input class="ns-input ns-code" maxlength="5" placeholder="ABCDE" style="text-transform:uppercase; letter-spacing:6px; text-align:center" /></div>
      </div>
      <button class="ns-btn ns-join">Join Match</button>
      <button class="ns-btn small ns-back">Back</button>
      <div class="ns-status ns-online-status"></div>
      <div class="ns-code-hint" style="margin-top:14px">Online mode uses peer-to-peer WebRTC &mdash; no game server needed. Share the room code with a friend.
      <b>No bots online</b> &mdash; only the players in your room. Battle Royale online is co-op: everyone survives the zone together.</div>
    </div>`);
    this.codeInput = p.querySelector('.ns-code')!;
    this.onlineStatusEl = p.querySelector('.ns-online-status')!;
    // host mode selection: DM / BR (+ map, hidden for BR)
    const modeSeg = this.el(`<div class="ns-seg ns-hostmode-seg">
      <button data-m="dm" class="on">DEATHMATCH</button><button data-m="br">BATTLE ROYALE</button>
    </div>`);
    const mapField = p.querySelector('.ns-hostmap-field') as HTMLElement;
    const mapSlot = p.querySelector('.ns-hostmap-slot') as HTMLElement;
    const ms = this.mapSeg();
    modeSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      modeSeg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      this.onlineMode = b.dataset.m as GameMode;
      const hideMap = this.onlineMode === 'br';
      mapField.style.display = hideMap ? 'none' : '';
      mapSlot.style.display = hideMap ? 'none' : '';
    }));
    p.querySelector('.ns-hostmode-slot')!.replaceWith(modeSeg);
    p.querySelector('.ns-hostmap-slot')!.replaceWith(ms.el);
    p.querySelector('.ns-host')!.addEventListener('click', () =>
      this.cb.onHost(this.playerName(), 4, this.diff, this.onlineMode, this.onlineMode === 'br' ? 'outpost' : ms.get()));
    p.querySelector('.ns-join')!.addEventListener('click', () => {
      const c = this.codeInput.value.trim();
      if (c.length < 4) { this.setOnlineStatus('Enter the 5-letter room code.', true); return; }
      this.cb.onJoin(this.playerName(), c);
    });
    p.querySelector('.ns-back')!.addEventListener('click', () => this.show('main'));
    this.addPanel('online', p);
  }

  private buildLobby() {
    const p = this.el(`<div>
      <div class="ns-panel-title">MATCH LOBBY</div>
      <div class="ns-code-hint">Share this code with your friends:</div>
      <div class="ns-code-box ns-lobby-code">-----</div>
      <div class="ns-lobby-players" style="font-size:17px; color:#bfe9ff">1 player connected</div>
      <div class="ns-lobby-note ns-lobby-tag"></div>
      <div class="ns-row" style="margin-top:16px">
        <button class="ns-btn primary ns-start">Start Match</button>
      </div>
      <button class="ns-btn small danger ns-leave">Leave lobby</button>
    </div>`);
    this.lobbyCodeEl = p.querySelector('.ns-lobby-code')!;
    this.lobbyPlayersEl = p.querySelector('.ns-lobby-players')!;
    this.lobbyNoteEl = p.querySelector('.ns-lobby-note')!;
    p.querySelector('.ns-start')!.addEventListener('click', () => {
      const ev = new CustomEvent('ns-lobby-start');
      window.dispatchEvent(ev);
    });
    p.querySelector('.ns-leave')!.addEventListener('click', () => this.cb.onLeaveToMenu());
    this.addPanel('lobby', p);
  }

  private buildPause() {
    const p = this.el(`<div>
      <div class="ns-panel-title">PAUSED</div>
      <div class="ns-subtitle">Match still running</div>
      <button class="ns-btn primary ns-resume">Resume</button>
      <button class="ns-btn small danger ns-leave">Leave match</button>
      <div class="ns-field" style="margin-top:22px"><label>Look sensitivity (mouse &amp; touch)</label><input type="range" class="ns-sens" min="20" max="300" value="100" style="width:100%" /></div>
      <div class="ns-field"><label>Volume</label><input type="range" class="ns-vol" min="0" max="100" value="70" style="width:100%" /></div>
      <div class="ns-field"><label>Touch controls</label>
        <div class="ns-seg ns-touch-seg">
          <button data-m="auto">Auto</button><button data-m="on">On</button><button data-m="off">Off</button>
        </div>
      </div>
    </div>`);
    this.sensSlider = p.querySelector('.ns-sens')!;
    this.volSlider = p.querySelector('.ns-vol')!;
    p.querySelector('.ns-resume')!.addEventListener('click', () => this.cb.onResume());
    p.querySelector('.ns-leave')!.addEventListener('click', () => this.cb.onLeaveToMenu());
    const seg = p.querySelector('.ns-touch-seg')!;
    this.touchSeg = seg as HTMLElement;
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const m = (b.dataset.m as TouchMode);
      localStorage.setItem('ns_touch_mode', m);
      this.cb.onTouchMode(m);
    }));
    this.addPanel('pause', p);
  }

  private touchSeg!: HTMLElement;

  /** reflect the stored touch-mode preference in the pause-menu segmented control */
  initTouchSeg() {
    const m = touchModePref();
    this.touchSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  }

  private buildEnd() {
    const p = this.el(`<div>
      <div class="ns-end-title">MATCH OVER</div>
      <div class="ns-end-sub">Final scoreboard</div>
      <div class="ns-end-board"></div>
      <div class="ns-row" style="margin-top:18px">
        <button class="ns-btn primary ns-again">Play Again</button>
        <button class="ns-btn ns-menu-btn">Main Menu</button>
      </div>
    </div>`);
    this.endTitleEl = p.querySelector('.ns-end-title')!;
    this.endSubEl = p.querySelector('.ns-end-sub')!;
    this.endBoardEl = p.querySelector('.ns-end-board')!;
    this.restartBtn = p.querySelector('.ns-again')!;
    p.querySelector('.ns-again')!.addEventListener('click', () => this.cb.onRestartMatch());
    p.querySelector('.ns-menu-btn')!.addEventListener('click', () => this.cb.onLeaveToMenu());
    this.addPanel('end', p);
  }

  private buildHelp() {
    const p = this.el(`<div>
      <div class="ns-panel-title">HOW TO PLAY</div>
      <div class="ns-help">
        <b>Loadout (3 slots):</b> primary gun + backup pistol + knife. Press <span class="k">1</span>
        <span class="k">2</span> <span class="k">3</span> to pick a slot &bull; <span class="k">Q</span> or mouse wheel cycles &bull;
        or <b>click the slot chips</b> in the top-left corner (works on mobile too) &bull; <b>WPN</b> button cycles.<br />
        <b>Holding a knife makes you faster</b> — each knife has its own speed and damage:
        Tactical Knife &bull; Karambit &bull; Bowie &bull; Machete &bull; Butterfly.<br />
        <b>Guns:</b> M9 &bull; Glock-18 &bull; Desert Eagle &bull; MP5 &bull; UMP-45 &bull; Vector &bull; M870 (8 pellets) &bull;
        M1014 auto-shotgun &bull; M4A1 &bull; AK-47 &bull; SCAR-H &bull; MK14 &bull; SVD &bull; M249 (80 rd) &bull; RPK-74 &bull;
        KAR98K &bull; AWM sniper (full scope).<br /><br />
        <b>Crouch:</b> <span class="k">C</span> toggles, <span class="k">CTRL</span> holds &bull; <b>CRCH</b> button on mobile.
        <b>Aim (ADS):</b> hold <b>RIGHT MOUSE</b> (mobile: <b>AIM</b>) — scoped weapons hide the gun for a clean scope view.<br />
        <b>Fire-drag (mobile):</b> keep <b>FIRE</b> held and drag it to aim while shooting.<br /><br />
        <b>Modes:</b> Deathmatch (first to 25) &bull; Team Deathmatch (first team to 40) &bull;
        Survival (endless waves) &bull; Gun Game (10 kills, one per weapon) &bull;
        <b>Duel</b> (1v1, first to 3 rounds) &bull; <b>Battle Royale</b> (plane drop, 150+ loot items,
        shrinking zone, climbable watchtowers / stairs / roofs, walk over guns &amp; knives to swap your loadout).<br />
        <b>Bots have real eyes now:</b> they only see what is in front of them — flank from behind!
        They do hear gunfire nearby, though.<br />
        <b>Online &amp; local multiplayer have NO bots</b> — only the humans in the room fight.
        <br />
        <b>Maps:</b> DESERT OUTPOST &bull; URBAN BLOCKS &bull; DRY OASIS &bull; WARZONE (BR only, 170&times;170).
        <b>Headshots</b> deal double damage. Health regenerates after 5s out of combat.<br />
        <b>Mobile:</b> the game ALWAYS runs landscape — even if you hold the phone upright it renders
        rotated automatically. Left stick moves &bull; drag right side to aim &bull; <b>FIRE</b> shoots &bull;
        <b>AIM</b> zoom &bull; <b>CRCH</b> crouch &bull; <b>WPN</b> swap weapon &bull; tap slot chips to switch.<br />
      </div>
      <button class="ns-btn small ns-back">Back</button>
    </div>`);
    p.querySelector('.ns-back')!.addEventListener('click', () => this.show('main'));
    this.addPanel('help', p);
  }

  playerName(): string {
    const n = this.nameInput.value.trim();
    return (n || 'PLAYER' + Math.floor(100 + Math.random() * 900)).toUpperCase().slice(0, 14);
  }

  loadName() {
    const saved = localStorage.getItem('ns_name');
    if (saved) this.nameInput.value = saved;
    else this.nameInput.value = 'PLAYER' + Math.floor(100 + Math.random() * 900);
  }
  saveName() { localStorage.setItem('ns_name', this.playerName()); }

  show(panel: MenuPanel | null) {
    if (panel === null) { this.wrap.classList.add('ns-hidden'); return; }
    this.wrap.classList.remove('ns-hidden');
    Object.entries(this.panels).forEach(([k, el]) => el.classList.toggle('ns-hidden', k !== panel));
  }
  isVisible(): boolean { return !this.wrap.classList.contains('ns-hidden'); }

  setStatus(text: string, err = false) {
    this.statusEl.textContent = text;
    this.statusEl.className = 'ns-status' + (err ? ' err' : '');
  }
  setOnlineStatus(text: string, err = false) {
    this.onlineStatusEl.textContent = text;
    this.onlineStatusEl.className = 'ns-status ns-online-status' + (err ? ' err' : '');
  }
  setLobby(code: string, players: number) {
    this.lobbyCodeEl.textContent = code;
    this.lobbyPlayersEl.textContent = `${players} player${players === 1 ? '' : 's'} connected`;
  }
  setLobbyNote(text: string) { this.lobbyNoteEl.textContent = text; }

  showEnd(board: [string, string, number, number][], myId: string, canRestart: boolean) {
    const sorted = [...board].sort((a, b) => b[2] - a[2]);
    const winner = sorted[0];
    this.endTitleEl.textContent = winner && winner[0] === myId ? 'VICTORY!' : 'MATCH OVER';
    this.endTitleEl.className = 'ns-end-title ' + (winner && winner[0] === myId ? 'win' : 'lose');
    this.endSubEl.textContent = winner ? `WINNER: ${winner[1]} — ${winner[2]} KILLS` : 'FINAL SCOREBOARD';
    this.endBoardEl.innerHTML = '';
    const head = this.el(`<div class="ns-sb-row head"><span>Player</span><span>Kills</span><span>Deaths</span></div>`);
    this.endBoardEl.appendChild(head);
    for (const [, name, k, d] of sorted) {
      const row = this.el(`<div class="ns-sb-row"><span>${esc(name)}</span><span>${k}</span><span>${d}</span></div>`);
      this.endBoardEl.appendChild(row);
    }
    this.restartBtn.style.display = canRestart ? '' : 'none';
    this.show('end');
  }

  /** survival-specific end screen (wave reached instead of scoreboard ranking) */
  showSurvivalEnd(wave: number, kills: number, myName: string) {
    this.endTitleEl.textContent = 'OVERRUN';
    this.endTitleEl.className = 'ns-end-title lose';
    this.endSubEl.textContent = `${myName} HELD OUT UNTIL WAVE ${wave} — ${kills} KILLS`;
    this.endBoardEl.innerHTML = '';
    const head = this.el(`<div class="ns-sb-row head"><span>Stat</span><span></span><span></span></div>`);
    this.endBoardEl.appendChild(head);
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row me"><span>Wave reached</span><span>${wave}</span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row"><span>Kills</span><span>${kills}</span><span></span></div>`));
    this.restartBtn.style.display = '';
    this.show('end');
  }

  /** battle royale end screen (placement + kills). squads=0 → humans-only zone survival */
  showBrEnd(won: boolean, kills: number, placement: number, myName: string, squads = 5) {
    this.endTitleEl.textContent = won ? 'WARZONE CHAMPION!' : 'ELIMINATED';
    this.endTitleEl.className = 'ns-end-title ' + (won ? 'win' : 'lose');
    this.endSubEl.textContent = squads > 0
      ? `#${placement} OF ${squads} SQUADS — ${myName}: ${kills} KILLS`
      : `ALL ZONES SURVIVED — ${myName}: ${kills} KILLS`;
    this.endBoardEl.innerHTML = '';
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row head"><span>Result</span><span></span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row me"><span>Placement</span><span>#${placement}</span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row"><span>Kills</span><span>${kills}</span><span></span></div>`));
    this.restartBtn.style.display = '';
    this.show('end');
  }

  /** duel end screen (round score) */
  showDuelEnd(won: boolean, me: number, enemy: number) {
    this.endTitleEl.textContent = won ? 'DUEL WON!' : 'DUEL LOST';
    this.endTitleEl.className = 'ns-end-title ' + (won ? 'win' : 'lose');
    this.endSubEl.textContent = `ROUNDS — YOU ${me} : ${enemy} ENEMY`;
    this.endBoardEl.innerHTML = '';
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row head"><span>Fighter</span><span>Rounds</span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row me"><span>You</span><span>${me}</span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row"><span>Enemy</span><span>${enemy}</span><span></span></div>`));
    this.restartBtn.style.display = '';
    this.show('end');
  }

  /** TDM end screen: team totals */
  showTeamEnd(allies: number, enemies: number, myName: string, iWon: boolean) {
    this.endTitleEl.textContent = iWon ? 'VICTORY!' : 'DEFEAT';
    this.endTitleEl.className = 'ns-end-title ' + (iWon ? 'win' : 'lose');
    this.endSubEl.textContent = `ALLIES ${allies} — ${enemies} ENEMIES`;
    this.endBoardEl.innerHTML = '';
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row me"><span>${esc(myName)}'s team</span><span>${allies}</span><span></span></div>`));
    this.endBoardEl.appendChild(this.el(`<div class="ns-sb-row"><span>Enemy team</span><span>${enemies}</span><span></span></div>`));
    this.restartBtn.style.display = '';
    this.show('end');
  }

  botNameFor(i: number): string {
    return 'BOT ' + ['VIPER', 'RAVEN', 'GHOST', 'TITAN', 'COBRA', 'HAWK', 'RECON', 'SARGE', 'DIESEL', 'BRONCO', 'SABER', 'WOLF', 'MAVERICK', 'TOMBSTONE'][i % 14];
  }
}
