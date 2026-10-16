/*
 * Windbreaker — screens, state, input, persistence and audio.
 * Depends on window.WB (engine + levels), window.WBRender, and window.WBTheme
 * and window.WBSprites (repaints when the theme or the art changes).
 *
 * Sections: helpers · storage · audio · DOM · game state · routing · home ·
 * game screen · tray · goals · changes · win · hint · toast/tooltip ·
 * board input · dragging · help · dialogs · keyboard · render loop · boot.
 */
(function () {
  'use strict';

  var WB = window.WB;
  var R = window.WBRender;
  var LEVELS = WB.LEVELS || [];
  var CHAPTERS = WB.CHAPTERS || [];
  var STORE_KEY = 'windbreaker.v1';
  // Directions the way the board shows them: players read "up" and "from the
  // left", never compass words (DESIGN.md keeps N/E/S/W for the rules).
  var DIR_WORD = ['up', 'right', 'down', 'left'];
  var DIR_ARROW = ['\u2191', '\u2192', '\u2193', '\u2190'];
  var FROM_SIDE = ['the top', 'the right', 'the bottom', 'the left'];
  var STRENGTH_WORD = ['calm', 'gentle', 'strong', 'gale'];
  var NEED = {
    pinwheel: 'needs a breeze', candle: 'wants still air', laundry: 'needs a clean breeze of 2 or more',
    papers: 'a breeze of 1 at most', fern: 'wants a breeze of exactly 1', stove: ''
  };
  // the goals bar, for a house with just one thing in it
  var WANT_ONE = {
    pinwheel: 'Make the pinwheel spin', candle: 'Keep the candle lit', stove: 'Get the smoke outside',
    laundry: 'Dry the laundry', papers: 'Keep the papers in place', fern: 'Give the fern a gentle breeze'
  };
  function breezeWord(f) { return f <= 0 ? 'still air' : f === 1 ? 'a gentle breeze of 1' : f === 2 ? 'a strong breeze of 2' : 'a gale of ' + f; }
  function dirWords(d) { return DIR_WORD[d] + ' ' + DIR_ARROW[d]; }

  // The field guide (js/guides.js): a "Meet the …" card for every tool, object
  // and twist. A card shows by itself on the level that introduces its thing;
  // seen cards are remembered in store.seenTools (by id).
  var GUIDES = WB.GUIDES || {};
  var Hints = WB.Hints; // js/hints.js: what the Hint button thinks
  var GUIDE_ORDER = WB.GUIDE_ORDER || [];
  var TWIST_ICON = { courtyard: 'courtyard', calm: 'calm', solid: 'solid', table: 'table', wind2: 'lanes-2', wind3: 'lanes-3' };
  var KIND_NEW = { tool: 'New tool', object: 'New in the house', twist: 'Something new' };
  var KIND_WORD = { tool: 'Tool', object: 'In the house', twist: 'Good to know' };
  var KIND_GROUP = { tool: 'Tools', object: 'Things in the house', twist: 'Weather and rooms' };
  var DEMO_MS = 2600; // each scene of a card's little demo
  // Compass words in level tips, said the way the board shows them (the
  // level files keep their own wording: this happens when the tip is shown).
  var SCREEN_SIDE = { north: 'top', east: 'right', south: 'bottom', west: 'left' };
  // A few phrases are said the way the cards say them, in plainer words.
  function plainTip(s) {
    return String(s || '')
      .replace(/\bfrom the (north|east|south|west)\b/gi, function (m, d) { return 'from the ' + SCREEN_SIDE[d.toLowerCase()]; })
      .replace(/\bthe far side\b/gi, 'the other side')
      .replace(/\b(north|east|south|west)(ern)?\b/gi, function (m, d) { return SCREEN_SIDE[d.toLowerCase()]; })
      .replace(/\bon the side facing the wind\b/gi, 'on the windy side')
      .replace(/\b(?:that )?(?:faces|facing) the wind\b/gi, 'on the windy side')
      .replace(/\bby 90 degrees\b/gi, 'round a corner')
      .replace(/\bflip between \/ and \\\./g, 'flip it the other way.')
      .replace(/\s*\(half, rounded down\)/gi, '')
      .replace(/\bthe way it faces\b/gi, 'the way it points');
  }

  // ================================================================== helpers

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function mq(q) {
    try { return window.matchMedia(q); } catch (e) { return { matches: false }; }
  }
  function onMQ(m, fn) {
    if (m.addEventListener) m.addEventListener('change', fn);
    else if (m.addListener) m.addListener(fn);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // tooltip HTML as one line of text (for the screen-reader live region)
  function plainText(html) {
    return String(html).replace(/<span class="tt-act">[\s\S]*?<\/span>/g, '').replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  }
  var reducedMQ = mq('(prefers-reduced-motion: reduce)');
  // Settings → Less motion wins over the device's setting, either way.
  function reducedMotion() {
    var m = typeof store === 'object' && store ? store.motion : null;
    return m === 'calm' ? true : m === 'full' ? false : reducedMQ.matches;
  }
  var landscapeMQ = mq('(max-height: 520px) and (min-aspect-ratio: 4/3)');
  var coarseMQ = mq('(pointer: coarse)');

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = { has: function () { return false; }, get: function () { return null; } }; }
  var UNLOCK_ALL = params.has('unlock');
  // ?unlock (QA) keeps its own progress, so levels solved there never unlock
  // anything in normal play
  if (UNLOCK_ALL) STORE_KEY += '.unlock';

  // ================================================================== storage

  // { completed, boards: {id: pieces}, boardSigs: {id: level signature}, sound, seenTools, seenTips,
  //   textSize: 'normal' | 'large', motion: null (follow the device) | 'calm' | 'full' }
  var store = loadStore();

  function parseStore(raw) {
    var s = { completed: [], boards: {}, boardSigs: {}, sound: true, seenTools: [], seenTips: [], textSize: 'normal', motion: null };
    try {
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (Array.isArray(d.completed)) s.completed = d.completed.filter(function (n) { return typeof n === 'number'; });
          if (d.boards && typeof d.boards === 'object') s.boards = d.boards;
          if (d.boardSigs && typeof d.boardSigs === 'object') s.boardSigs = d.boardSigs;
          if (typeof d.sound === 'boolean') s.sound = d.sound;
          if (d.textSize === 'large') s.textSize = 'large';
          if (d.motion === 'calm' || d.motion === 'full') s.motion = d.motion;
          if (Array.isArray(d.seenTools)) s.seenTools = d.seenTools.filter(function (n) { return typeof n === 'string'; });
          if (Array.isArray(d.seenTips)) s.seenTips = d.seenTips.filter(function (n) { return typeof n === 'string'; });
        }
      }
    } catch (e) { /* corrupt: start fresh */ }
    return s;
  }
  function loadStore() {
    // progress js/migrate.js translated but could not write back: that, not the old numbers
    if (WB.migratedStore && !UNLOCK_ALL) return parseStore(JSON.stringify(WB.migratedStore));
    var raw = null;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { /* storage unavailable: play without saving */ }
    return parseStore(raw);
  }
  function union(a, b) {
    var out = a.slice();
    b.forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  // Saved boards come from `from`, except the one for the level this tab is
  // playing, which this tab knows best.
  function takeBoards(from) {
    var mine = G.screen === 'game' ? G.id : null;
    if (mine != null) {
      if (store.boards[mine]) { from.boards[mine] = store.boards[mine]; from.boardSigs[mine] = store.boardSigs[mine]; }
      else { delete from.boards[mine]; delete from.boardSigs[mine]; }
    }
    store.boards = from.boards;
    store.boardSigs = from.boardSigs;
  }
  // The game may be open in several tabs. Each write keeps what another tab
  // saved in the meantime (solved levels, seen cards, its boards), so a stale
  // tab never erases progress. `replace` (reset progress) writes as is.
  function saveStore(replace) {
    try {
      // (what storage holds is the untranslated v1.0 progress when js/migrate.js could not write: never merged)
      if (!replace && !(WB.migratedStore && !UNLOCK_ALL)) {
        var raw = window.localStorage.getItem(STORE_KEY);
        if (raw) {
          var o = parseStore(raw);
          store.completed = union(store.completed, o.completed);
          store.seenTools = union(store.seenTools, o.seenTools);
          store.seenTips = union(store.seenTips, o.seenTips);
          takeBoards(o);
        }
      }
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      // saved in today's level numbering (js/migrate.js must never translate it again)
      if (!UNLOCK_ALL && WB.LEVELSET) window.localStorage.setItem('windbreaker.levelset', WB.LEVELSET);
    } catch (e) { /* ignore */ }
  }
  // Another tab saved: take its view (it already merged ours), keep our board.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY && e.key !== null) return;
    var o = parseStore(e.key === null ? null : e.newValue);
    store.completed = o.completed;
    store.seenTools = o.seenTools;
    store.seenTips = o.seenTips;
    store.sound = o.sound;
    store.textSize = o.textSize;
    store.motion = o.motion;
    takeBoards(o);
    applySettings();
    if (G.screen === 'home') renderHome();
    else if (G.screen === 'game') updateButtons();
  });

  // A short signature of what a saved board depends on, so a board saved for
  // an older version of a level is not restored onto a redesigned one.
  var sigCache = {};
  function levelSig(id) {
    if (sigCache[id]) return sigCache[id];
    var def = levelById(id);
    if (!def) return '';
    var s = JSON.stringify([def.map, def.fixed || [], def.inventory || {}, def.wind]);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    sigCache[id] = h.toString(36);
    return sigCache[id];
  }

  var INDEX = {};
  LEVELS.forEach(function (l, i) { INDEX[l.id] = i; });
  function levelById(id) {
    var i = INDEX[id];
    return i == null ? null : LEVELS[i];
  }
  function levelIndex(id) {
    var i = INDEX[id];
    return i == null ? -1 : i;
  }
  function chapterOf(id) {
    for (var i = 0; i < CHAPTERS.length; i++) if (id >= CHAPTERS[i].first && id <= CHAPTERS[i].last) return CHAPTERS[i];
    return null;
  }
  function isDone(id) { return store.completed.indexOf(id) >= 0; }
  function markDone(id) { if (!isDone(id)) store.completed.push(id); }
  // The furthest solved level, as an index into LEVELS (-1: none).
  var furthestMemo = { list: null, n: -1, f: -1 };
  function furthestDone() {
    var c = store.completed;
    // progress only grows by push (or is replaced): the list and its length say whether it changed
    if (furthestMemo.list === c && furthestMemo.n === c.length) return furthestMemo.f;
    var f = -1;
    c.forEach(function (id) { var i = levelIndex(id); if (i > f) f = i; });
    furthestMemo = { list: c, n: c.length, f: f };
    return f;
  }
  // Level n is playable when it is the first level, is solved, or the level
  // before it in the list is solved (ids are 1..100; a gap never locks the rest).
  // Players coming back from an older version can have solved levels here and
  // there (the levels were reordered): every level before their furthest
  // solved one is open too. Playing in order, that changes nothing.
  function isUnlocked(id) {
    if (UNLOCK_ALL) return true;
    var i = levelIndex(id);
    if (i < 0) return false;
    return i === 0 || isDone(id) || isDone(LEVELS[i - 1].id) || i < furthestDone();
  }
  function chapterDone(ch) {
    for (var n = ch.first; n <= ch.last; n++) if (levelById(n) && !isDone(n)) return false;
    return true;
  }
  function nextPlayableId() {
    for (var i = 0; i < LEVELS.length; i++) {
      var id = LEVELS[i].id;
      if (isUnlocked(id) && !isDone(id)) return id;
    }
    return null;
  }
  // Where "Continue" goes: the first open level after the furthest solved one
  // (players coming back from an older version can have gaps before it: those
  // are offered apart, as "Catch up"), else the first open level.
  function continueId() {
    for (var i = furthestDone() + 1; i < LEVELS.length; i++) {
      var id = LEVELS[i].id;
      if (isUnlocked(id) && !isDone(id)) return id;
    }
    return nextPlayableId();
  }
  // Open levels left unsolved before the furthest solved one.
  function gapIds() {
    var out = [], f = furthestDone();
    for (var i = 0; i < f; i++) if (isUnlocked(LEVELS[i].id) && !isDone(LEVELS[i].id)) out.push(LEVELS[i].id);
    return out;
  }
  function seenTip(k) { return store.seenTips.indexOf(k) >= 0; }

  // Progress carried over from v1.0 (js/migrate.js): { from, solved, furthest, noted }.
  var MIGRATED_KEY = 'windbreaker.migrated';
  function migratedInfo() {
    if (UNLOCK_ALL) return null;
    try {
      var r = window.localStorage.getItem(MIGRATED_KEY);
      if (r) { var o = JSON.parse(r); if (o && typeof o === 'object') return o; }
    } catch (e) { /* no storage */ }
    return WB.migratedInfo || null;
  }
  function noteMigrated() {
    var m = migratedInfo();
    if (!m || m.noted) return;
    m.noted = true;
    WB.migratedInfo = m;
    try { window.localStorage.setItem(MIGRATED_KEY, JSON.stringify(m)); } catch (e) { /* no storage */ }
  }

  // ================================================================== audio

  var Sound = (function () {
    var ac = null, master = null, noise = null;
    function ensure() {
      if (!store.sound) return null;
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          ac = new AC();
          master = ac.createGain();
          master.gain.value = 0.55;
          master.connect(ac.destination);
        } catch (e) { ac = null; return null; }
      }
      if (ac.state === 'suspended') { try { ac.resume(); } catch (e) { /* ignore */ } }
      return ac;
    }
    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function tone(freq, start, dur, type, vol, freqEnd) {
      var a = ensure(); if (!a) return;
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, start);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
      env(g, start, vol, 0.006, dur);
      o.connect(g); g.connect(master);
      o.start(start); o.stop(start + dur + 0.05);
    }
    function noiseBuf(a) {
      if (noise) return noise;
      var len = Math.floor(a.sampleRate * 0.6);
      noise = a.createBuffer(1, len, a.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noise;
    }
    return {
      unlock: function () { if (store.sound) ensure(); },
      tick: function () {
        var a = ensure(); if (!a) return;
        var t = a.currentTime + 0.005;
        tone(740, t, 0.07, 'triangle', 0.09, 1040);
        tone(1480, t, 0.04, 'sine', 0.025);
      },
      turn: function () {
        var a = ensure(); if (!a) return;
        tone(560, a.currentTime + 0.005, 0.06, 'triangle', 0.07, 700);
      },
      nope: function () {
        var a = ensure(); if (!a) return;
        tone(220, a.currentTime + 0.005, 0.12, 'sine', 0.06, 180);
      },
      whoosh: function () {
        var a = ensure(); if (!a) return;
        var t = a.currentTime + 0.005;
        var src = a.createBufferSource();
        src.buffer = noiseBuf(a);
        var f = a.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 0.9;
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(260, t + 0.32);
        var g = a.createGain();
        env(g, t, 0.16, 0.04, 0.3);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t); src.stop(t + 0.4);
      },
      chime: function () {
        var a = ensure(); if (!a) return;
        var t = a.currentTime + 0.02;
        [659.25, 783.99, 987.77, 1318.51].forEach(function (fq, i) {
          tone(fq, t + i * 0.095, 1.3, 'sine', 0.055);
          tone(fq * 2, t + i * 0.095, 0.5, 'sine', 0.012);
        });
      }
    };
  })();

  // ================================================================== DOM refs

  var dom = {
    home: $('home'), game: $('game'), chapters: $('chapters'), play: $('btn-play'), progress: $('home-progress'),
    catchup: $('btn-catchup'), homeNote: $('home-note'), homeNoteText: $('home-note-text'), homeNoteOk: $('home-note-ok'),
    howto: $('btn-howto'), homeGear: $('btn-settings-home'), footGear: $('btn-settings-foot'), resetProgress: $('btn-reset-progress'), homeToast: $('home-toast'),
    back: $('btn-back'), lvlNum: $('lvl-num'), lvlName: $('lvl-name'), lvlDone: $('lvl-done'), wind: $('wind'), help: $('btn-help'),
    tip: $('tip'), guideLine: $('guide-line'), tipIcon: $('tip-icon'), tipMore: $('tip-more'), guide: $('guide'),
    coach: $('coach'), coachText: $('coach-text'), coachArrow: document.querySelector('#coach .coach-arrow'),
    stage: $('stage'), canvas: $('board'), tooltip: $('tooltip'), live: $('sr-live'),
    toast: $('toast'), toastText: $('toast-text'), toastAction: $('toast-action'), toastClose: $('toast-close'),
    goals: $('goals'), goalsSay: $('goals-say'), undo: $('btn-undo'), redo: $('btn-redo'), reset: $('btn-reset'), hint: $('btn-hint'),
    next: $('btn-next'), nextLabel: $('btn-next-label'), gear: $('btn-settings'),
    pmenu: $('pmenu'), pmenuText: $('pmenu-text'), pmenuTurn: $('pmenu-turn'), pmenuRemove: $('pmenu-remove'),
    pmenuAbout: $('pmenu-about'), pmenuAboutLabel: $('pmenu-about-label'),
    tray: $('tray'), trayWrap: document.querySelector('.tray-wrap'), side: document.querySelector('.side'), avatar: $('drag-avatar'),
    win: $('win'), winTitle: $('win-title'), winSub: $('win-sub'), winDots: $('win-dots'), winTeaser: $('win-teaser'), winTeaserIcon: $('win-teaser-icon'),
    winChapter: $('win-chapter'), winChapterIcon: $('win-chapter-icon'), winChapterName: $('win-chapter-name'), winRecap: $('win-recap'),
    winTeaserText: $('win-teaser-text'), winFinal: $('win-final'), winNext: $('win-next'), winLevels: $('win-levels'),
    helpDlg: $('help'), helpBody: $('help-body'), helpClose: $('help-close'), helpGear: $('help-settings'),
    settings: $('settings'), settingsClose: $('settings-close'), setSound: $('set-sound'), setMotion: $('set-motion'),
    setMotionNote: $('set-motion-note'), setGuides: $('set-guides'), setProgressNote: $('set-progress-note'),
    confirm: $('confirm'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no')
  };

  var board = new R.Board(dom.canvas);

  // ================================================================== game state

  var G = {
    screen: null,                    // 'home' | 'game'
    id: null, def: null, L: null, chapter: null, lastId: null,
    fixed: [], pieces: [], history: [], future: [],
    sim: null, version: 0,
    sel: null, valid: null, validWall: false, rot: {},
    hover: null, hoverMouse: false, cursor: null,
    ghost: null, hint: null, conflicts: null, lifted: null,
    previewSim: null, previewKey: null, dragBaseSim: null,
    // all pointer state lives here and is cleared by resetInput()
    input: { press: null, drag: null, tray: null, suppressClick: false, cancelledPointer: null, chipLong: null, infoDown: null, swallowClick: 0 },
    pops: {}, shake: null, flash: null, pulse: null, focus: null,
    won: false, winAt: null, winTimer: 0, winCardTimer: 0, chapterDoneBefore: false,
    newTool: null, newToolUsed: false, lastPtr: null, sawKeys: false,
    // the field guide: the card this level introduces, the card on screen,
    // the coach bubble (and its ring on the board), the first level's steps
    levelGuide: null, guide: null, helpGuide: null, coach: null, spot: null, c1: null, c1Timer: 0, coachGoal: null, coachHide: 0, chipCoach: null,
    drawPieces: [], raf: 0, toastTimer: 0, tipTimer: 0, hoverTimer: 0, coachTimer: 0,
    pushedFromHome: false, lastSig: '', settleUntil: 0, paletteVersion: 0,
    openedAt: -1e9, focusBoardOnOpen: false,
    // a tapped piece's little menu; tool spots that stay lit after a missed drop; the tooltip's cell
    pmenu: null, pmenuTimer: 0, linger: null, lingerTimer: 0, tipAt: null, chipCoachTimer: 0,
    // hints go one step at a time: words first, then one piece
    hintStep: 0, hintBoard: null, hintFollowed: false,
    // "Stuck? A hint is free": progress (most things happy at once), moves and time since
    best: 0, sinceMoves: 0, sinceAt: 0, offered: false, stuckTimer: 0,
    // how many things are happy in the empty house (the goals bar praises only progress)
    startHappy: 0
  };
  var sessionOffered = false; // the "a hint is free" toast: once per visit
  var I = G.input;

  function norm(p) { return { type: p.type, x: p.x | 0, y: p.y | 0, d: p.d | 0 }; }
  function allPieces(exclude) {
    var out = G.fixed.slice();
    for (var i = 0; i < G.pieces.length; i++) if (G.pieces[i] !== exclude) out.push(G.pieces[i]);
    return out;
  }
  function playerAt(x, y) {
    for (var i = 0; i < G.pieces.length; i++) if (G.pieces[i].x === x && G.pieces[i].y === y) return G.pieces[i];
    return null;
  }
  function fixedAt(x, y) {
    for (var i = 0; i < G.fixed.length; i++) if (G.fixed[i].x === x && G.fixed[i].y === y) return G.fixed[i];
    return null;
  }
  function remaining(type) {
    var n = (G.L.inventory[type] || 0);
    for (var i = 0; i < G.pieces.length; i++) if (G.pieces[i].type === type) n--;
    return n;
  }
  function rotations(type) { return WB.TOOLS[type] ? WB.TOOLS[type].rotations : 1; }
  function toolName(type) { return WB.TOOLS[type].name; }
  function defaultRot(type) {
    if (G.rot[type] != null) return G.rot[type];
    if (type === 'fan') return G.L.wind.strength > 0 ? G.L.wind.dir : 1;
    return 0;
  }
  function isWallMount(type) { return WB.TOOLS[type] && WB.TOOLS[type].mount !== 'floor'; }
  function rebuildDrawPieces() {
    var list = [];
    G.fixed.forEach(function (p) { list.push({ type: p.type, x: p.x, y: p.y, d: p.d, fixed: true }); });
    G.pieces.forEach(function (p) { if (p !== G.lifted) list.push({ type: p.type, x: p.x, y: p.y, d: p.d, fixed: false }); });
    G.drawPieces = list;
  }
  function touchy(ptype) { return ptype === 'touch' || ptype === 'pen'; }
  // Wording follows the input the player actually uses, not the device's
  // primary pointer (a touch laptop is 'fine' but may be used by finger).
  function usingTouch() { return G.lastPtr ? touchy(G.lastPtr) : coarseMQ.matches; }
  window.addEventListener('pointerdown', function (e) {
    G.lastPtr = e.pointerType || G.lastPtr;
    // a tooltip stays until the next tap anywhere (the board handles its own taps)
    if (!dom.tooltip.hidden && e.target !== dom.canvas) hideTooltip();
  }, true);
  function announce(text) {
    dom.live.textContent = '';
    setTimeout(function () { dom.live.textContent = text; }, 30);
  }

  // ================================================================== routing

  function navigate(id, replace) {
    var url = location.pathname + location.search + (id ? '#' + id : '');
    try {
      if (replace) history.replaceState({ id: id }, '', url);
      else {
        history.pushState({ id: id }, '', url);
        if (id && G.screen === 'home') G.pushedFromHome = true;
      }
    } catch (e) {
      // sandboxed or odd file:// contexts: let the hash do the routing
      location.hash = id ? '#' + id : '';
      return;
    }
    route();
  }
  function hashId() {
    var m = /^#\/?(\d+)$/.exec(location.hash || '');
    return m ? parseInt(m[1], 10) : null;
  }
  function route() {
    var id = hashId();
    if (id != null && levelById(id) && isUnlocked(id)) {
      if (G.screen !== 'game' || G.id !== id) openLevel(id);
    } else if (G.screen !== 'home') {
      showHome();
    }
  }

  // ================================================================== home

  function showHome() {
    leaveGame();
    G.screen = 'home';
    G.id = null;
    dom.game.hidden = true;
    dom.home.hidden = false;
    document.title = 'Windbreaker';
    renderHome();
    if (G.lastId) {
      var b = dom.chapters.querySelector('[data-level="' + G.lastId + '"]');
      if (b) {
        var r = b.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) b.scrollIntoView({ block: 'center' });
        b.focus({ preventScroll: true });
      }
    } else {
      window.scrollTo(0, 0);
    }
  }

  var LOCK_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
  var CHECK_SVG = '<svg class="ico check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // The two tools a mastery chapter leans on most (by inventory), for its icon.
  // `used` holds pairs earlier chapters already show (in either order): the
  // best pair not yet taken is picked, so no two chapters share an icon.
  function chapterPair(ch, used) {
    var count = {};
    for (var n = ch.first; n <= ch.last; n++) {
      var lv = levelById(n);
      if (!lv || !lv.inventory) continue;
      Object.keys(lv.inventory).forEach(function (t) { if (WB.TOOLS[t]) count[t] = (count[t] || 0) + lv.inventory[t]; });
    }
    var ids = Object.keys(count).filter(function (t) { return t !== 'window'; });
    ids.sort(function (a, b) { return count[b] - count[a] || WB.TOOL_ORDER.indexOf(b) - WB.TOOL_ORDER.indexOf(a); });
    if (!ids.length) return 'window+fan';
    if (ids.length === 1) return 'window+' + ids[0];
    var cands = [];
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) cands.push({ k: ids[i] + '+' + ids[j], score: count[ids[i]] + count[ids[j]], r: i + j });
    }
    cands.sort(function (a, b) { return b.score - a.score || a.r - b.r; });
    for (var c = 0; c < cands.length; c++) if (!used || !used[pairKey(cands[c].k)]) return cands[c].k;
    return cands[0].k;
  }
  function pairKey(k) { return k.split('+').sort().join('+'); }
  // The icon pair of each challenge chapter, picked in chapter order (so no two share one).
  var PAIRS = null;
  function masteryPair(ch) {
    if (!PAIRS) {
      PAIRS = {};
      var used = {};
      CHAPTERS.forEach(function (c) {
        if (chapterIntro(c)) return;
        var pr = chapterPair(c, used);
        used[pairKey(pr)] = true;
        PAIRS[c.n] = pr;
      });
    }
    return PAIRS[ch.n] || chapterPair(ch, null);
  }

  // What a challenge chapter (no new thing) is about, in a few words.
  function chapterTheme(ch, pair) {
    var lvls = [];
    for (var n = ch.first; n <= ch.last; n++) if (levelById(n)) lvls.push(levelById(n));
    function all(f) { return lvls.length > 0 && lvls.every(f); }
    function has(c) { return function (l) { return (l.map || []).join('').indexOf(c) >= 0; }; }
    if (all(function (l) { return (l.wind.strength | 0) === 0; })) return 'no wind at all';
    if (all(function (l) { return (l.wind.strength | 0) >= 3; })) return 'gale days';
    if (ch === CHAPTERS[CHAPTERS.length - 1]) return 'everything you know';
    if (all(has('s')) && all(has('l'))) return 'smoke and washing';
    if (all(has('s'))) return 'smoky kitchens';
    var ids = pair.split('+');
    return ids.map(function (t) { return WB.TOOLS[t] ? WB.TOOLS[t].name.toLowerCase() + 's' : t; }).join(' and ');
  }

  function renderHome() {
    var frag = document.createDocumentFragment();
    var nextId = continueId();
    var shownLocked = false;
    CHAPTERS.forEach(function (ch) {
      var ids = [];
      for (var n = ch.first; n <= ch.last; n++) if (levelById(n)) ids.push(n);
      var done = ids.filter(isDone).length;
      var anyOpen = ids.some(isUnlocked);
      var label = 'Chapter ' + ch.n + ': ' + ch.title;
      var ic = el('canvas', 'ch-icon');
      ic.setAttribute('aria-hidden', 'true');
      // a chapter that brings something new shows it (a tool, or an object:
      // never a tool that has not arrived yet); a challenge chapter shows the
      // two tools it leans on most
      var intro = chapterIntro(ch), tag = null;
      if (intro) {
        guideIcon(ic, intro.id, 40);
        tag = '<b>New:</b> ' + esc(thingTitle(intro.id));
        label += ', new: ' + thingTitle(intro.id);
      } else {
        var pair = masteryPair(ch);
        R.icon(ic, 'pair', pair, 40);
        var theme = chapterTheme(ch, pair);
        tag = '<b>Challenge:</b> ' + esc(theme);
        label += ', challenge: ' + theme;
      }

      if (!anyOpen && shownLocked) {
        // far away: one quiet line
        var row = el('section', 'chapter is-folded');
        row.setAttribute('aria-label', label + ', locked');
        row.appendChild(ic);
        var tt = el('div', 'ch-fold-title');
        tt.innerHTML = '<span>' + ch.n + ' · </span>' + esc(ch.title) + (tag ? '<small class="ch-new" aria-hidden="true">' + tag + '</small>' : '');
        row.appendChild(tt);
        var meta = el('div', 'ch-fold-meta');
        meta.innerHTML = LOCK_SVG + ids.length + ' levels';
        row.appendChild(meta);
        frag.appendChild(row);
        return;
      }
      if (!anyOpen) shownLocked = true;
      var sec = el('section', 'chapter' + (anyOpen ? '' : ' is-locked'));
      sec.setAttribute('aria-label', label + (anyOpen ? '' : ', locked'));
      var head = el('div', 'ch-head');
      head.appendChild(ic);
      var titles = el('div', 'ch-titles');
      titles.appendChild(el('div', 'ch-kicker', 'Chapter ' + ch.n));
      titles.appendChild(el('div', 'ch-title', ch.title));
      if (tag) {
        var tg = el('div', 'ch-new');
        tg.innerHTML = tag;
        tg.setAttribute('aria-hidden', 'true'); // said in the section label
        titles.appendChild(tg);
      }
      head.appendChild(titles);
      var cnt = el('div', 'ch-count' + (done === ids.length && ids.length ? ' is-done' : ''));
      if (!anyOpen) cnt.innerHTML = LOCK_SVG;
      else if (done === ids.length && ids.length) cnt.innerHTML = CHECK_SVG + done + '/' + ids.length;
      else cnt.textContent = done + '/' + ids.length;
      head.appendChild(cnt);
      sec.appendChild(head);
      var lv = el('div', 'ch-levels');
      ids.forEach(function (id) {
        var b = el('button', 'lvl', String(id));
        b.type = 'button';
        b.setAttribute('data-level', id);
        var def = levelById(id);
        var al = 'Level ' + id + (def && def.name ? ', ' + def.name : '');
        var locked = !isUnlocked(id);
        // solved: a small tick in the corner too (never colour alone)
        if (isDone(id)) { b.classList.add('is-done'); b.insertAdjacentHTML('beforeend', '<span class="lvl-tick" aria-hidden="true">' + CHECK_SVG + '</span>'); al += ', solved'; }
        else if (!locked) { b.classList.add(id === nextId ? 'is-next' : 'is-open'); }
        // locked buttons stay tappable (aria-disabled), so a tap can say why
        if (locked) { b.classList.add('is-locked'); b.setAttribute('aria-disabled', 'true'); al += ', locked'; }
        b.setAttribute('aria-label', al);
        b.title = def && def.name ? def.name : '';
        b.addEventListener('click', function () {
          if (!isUnlocked(id)) { lockedTap(b, id); return; }
          Sound.unlock();
          navigate(id);
        });
        b.addEventListener('animationend', function () { b.classList.remove('is-shake'); });
        lv.appendChild(b);
      });
      sec.appendChild(lv);
      frag.appendChild(sec);
    });
    dom.chapters.textContent = '';
    dom.chapters.appendChild(frag);

    var solved = LEVELS.filter(function (l) { return isDone(l.id); }).length;
    dom.play.disabled = !LEVELS.length;
    if (!LEVELS.length) dom.play.textContent = 'No levels';
    else if (solved === 0) dom.play.textContent = 'Play';
    else if (nextId != null) dom.play.textContent = 'Continue · Level ' + nextId;
    else dom.play.textContent = 'Play again';
    dom.progress.textContent = solved === 0
      ? LEVELS.length + ' levels · ' + WB.TOOL_ORDER.length + ' tools'
      : (solved === LEVELS.length ? 'All ' + LEVELS.length + ' levels solved — lovely.' : solved + ' of ' + LEVELS.length + ' levels solved');
    // levels skipped here and there, offered quietly
    var gaps = gapIds();
    dom.catchup.hidden = !gaps.length;
    if (gaps.length) dom.catchup.textContent = 'Catch up: ' + gaps.length + ' open level' + (gaps.length === 1 ? '' : 's');
    // once: progress from an older version was carried over
    var m = migratedInfo();
    dom.homeNote.hidden = !m || !!m.noted || !solved;
    if (!dom.homeNote.hidden) {
      var lastOpen = 0;
      LEVELS.forEach(function (l) { if (isUnlocked(l.id)) lastOpen = l.id; });
      dom.homeNoteText.textContent = 'Welcome back! The levels have a new, gentler order. Your ' + solved + ' solved house' + (solved === 1 ? ' is' : 's are') +
        ' kept, and levels 1\u2013' + lastOpen + ' are open.';
    }
  }
  dom.catchup.addEventListener('click', function () {
    var g = gapIds();
    if (!g.length) return;
    Sound.unlock();
    noteMigrated();
    navigate(g[0]);
  });
  dom.homeNoteOk.addEventListener('click', function () {
    noteMigrated();
    dom.homeNote.hidden = true;
    dom.play.focus();
  });

  var homeToastTimer = 0;
  function lockedTap(b, id) {
    b.classList.remove('is-shake');
    void b.offsetWidth;
    b.classList.add('is-shake');
    var i = levelIndex(id);
    var prev = i > 0 ? LEVELS[i - 1].id : null;
    var msg = prev != null && isUnlocked(prev)
      ? 'Solve level ' + prev + ' to unlock level ' + id + '.'
      : 'Level ' + id + ' is locked' + (continueId() != null ? ' — level ' + continueId() + ' is next.' : '.');
    dom.homeToast.textContent = msg;
    dom.homeToast.hidden = false;
    clearTimeout(homeToastTimer);
    homeToastTimer = setTimeout(function () { dom.homeToast.hidden = true; }, 2400);
  }

  // ---------------------------------------------------------------- settings
  //
  // A small sheet, reachable from the home screen (the gear, and the footer)
  // and in the game (the gear in the top bar on wide screens, and in Help):
  // sound, text size, less motion, the guide cards again, and, last and quiet,
  // reset progress.

  var rootEl = document.documentElement;
  function applySettings() {
    rootEl.classList.toggle('is-large-text', store.textSize === 'large');
    rootEl.classList.toggle('motion-calm', store.motion === 'calm');
    rootEl.classList.toggle('motion-full', store.motion === 'full');
    renderSettings();
  }
  function setSwitch(b, on) {
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.querySelector('.switch-word').textContent = on ? 'On' : 'Off';
  }
  function renderSettings() {
    setSwitch(dom.setSound, store.sound);
    setSwitch(dom.setMotion, reducedMotion());
    dom.setMotionNote.textContent = store.motion == null && reducedMQ.matches
      ? 'On, because your device asks for less motion.' : 'Less spinning and moving on the screen.';
    var segs = dom.settings.querySelectorAll('[data-text]');
    for (var i = 0; i < segs.length; i++) segs[i].setAttribute('aria-checked', segs[i].getAttribute('data-text') === store.textSize ? 'true' : 'false');
    var solved = store.completed.length;
    dom.resetProgress.disabled = solved === 0 && !Object.keys(store.boards).length;
    dom.setProgressNote.textContent = solved ? 'Forget all ' + solved + ' solved level' + (solved === 1 ? '' : 's') + '.' : 'Nothing solved yet.';
  }
  function updateSoundButton() { renderSettings(); }
  function openSettings() {
    // from Help: Settings take its place, and closing them comes back to the game
    if (!dom.helpDlg.hidden) { closeDialog(dom.helpDlg, true); if (G.screen === 'game') dom.help.focus({ preventScroll: true }); }
    renderSettings();
    dom.setGuides.textContent = 'Show again';
    dom.setGuides.disabled = false;
    openDialog(dom.settings, dom.settingsClose);
  }
  function toggleSound() {
    store.sound = !store.sound;
    saveStore();
    renderSettings();
    if (store.sound) Sound.tick();
  }
  dom.setSound.addEventListener('click', toggleSound);
  dom.setMotion.addEventListener('click', function () {
    var calm = !reducedMotion();
    // back to "follow the device" when that is what the device wants anyway
    store.motion = calm === reducedMotionDevice() ? null : calm ? 'calm' : 'full';
    saveStore();
    applySettings();
    G.lastSig = '';
    rebuildDemos();
  });
  dom.settings.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-text]') : null;
    if (b) {
      store.textSize = b.getAttribute('data-text') === 'large' ? 'large' : 'normal';
      saveStore();
      applySettings();
      layoutBoard();
      updateTrayFade();
      return;
    }
    if (e.target === dom.settings) closeDialog(dom.settings);
  });
  dom.setGuides.addEventListener('click', function () {
    store.seenTools = [];
    store.seenTips = [];
    saveStore(true); // a merge would bring the old ones straight back
    dom.setGuides.textContent = 'Done';
    dom.setGuides.disabled = true;
  });
  dom.settingsClose.addEventListener('click', function () { closeDialog(dom.settings); });
  onMQ(reducedMQ, function () { renderSettings(); G.lastSig = ''; rebuildDemos(); });
  function reducedMotionDevice() { return reducedMQ.matches; }
  // Less motion switched while a card is open: its demo changes to the still,
  // side-by-side view (or back) at once.
  function rebuildDemos() {
    if (G.guide && G.guide.built.demo && G.guide.built.demo.still !== reducedMotion()) {
      var focusIn = dom.guide.contains(document.activeElement);
      openGuide(G.guide.id, { intro: G.guide.intro, at: G.guide.at, focus: focusIn, keepScroll: true });
      if (!dom.helpDlg.hidden && G.guide && G.guide.built.demo) G.guide.built.demo.stop(); // Help is over it: it waits
    }
    if (G.helpGuide && G.helpGuide.built.demo && G.helpGuide.built.demo.still !== reducedMotion()) {
      var top = dom.helpBody.scrollTop;
      showHelpGuide(G.helpGuide.id, G.helpGuide.scroll);
      dom.helpBody.scrollTop = top;
    }
  }
  [dom.homeGear, dom.footGear, dom.gear, dom.helpGear].forEach(function (b) { b.addEventListener('click', openSettings); });
  dom.howto.addEventListener('click', function () { openHelp(); });

  dom.play.addEventListener('click', function () {
    Sound.unlock();
    noteMigrated();
    var id = continueId();
    if (id == null && LEVELS.length) id = LEVELS[0].id;
    if (id != null) navigate(id);
  });
  dom.resetProgress.addEventListener('click', function () { openDialog(dom.confirm, dom.confirmNo); });
  dom.confirmNo.addEventListener('click', function () { closeDialog(dom.confirm); });
  dom.confirmYes.addEventListener('click', function () {
    store.completed = [];
    store.boards = {};
    store.boardSigs = {};
    store.seenTools = [];
    store.seenTips = [];
    saveStore(true);
    try { window.localStorage.removeItem(MIGRATED_KEY); } catch (e) { /* no storage */ }
    WB.migratedInfo = null;
    closeDialog(dom.confirm, true);
    closeDialog(dom.settings, true);
    G.lastId = null;
    if (G.screen === 'game') { G.pushedFromHome = false; navigate(null, true); }
    renderHome();
    dom.play.focus();
  });

  // ================================================================== game screen

  // Clears every pointer/drag/press in flight. The only way input state is reset.
  function resetInput() {
    if (I.press) clearTimeout(I.press.timer);
    I.press = null;
    I.tray = null;
    cancelDrag();
    I.suppressClick = false;
  }

  // A solved board must never be left without the level being recorded.
  function flushPendingWin() {
    if (G.screen === 'game' && G.sim && G.sim.solved && G.id != null && !isDone(G.id)) {
      markDone(G.id);
      forgetBoard(G.id);
      saveStore();
    }
  }

  function leaveGame() {
    flushPendingWin();
    clearTimeout(G.winTimer);
    clearTimeout(G.winCardTimer);
    G.winCardTimer = 0;
    clearTimeout(G.toastTimer);
    clearTimeout(G.tipTimer);
    clearTimeout(G.hoverTimer);
    clearTimeout(G.coachTimer);
    stopLoop();
    resetInput();
    clearTimeout(G.winTimer); // a cancelled drag re-checks the win
    hideTooltip();
    hideToast();
    hidePieceMenu();
    closeGuide({ silent: true, keep: true });
    hideCoach();
    clearTimeout(G.c1Timer);
    clearTimeout(G.stuckTimer);
    clearTimeout(G.lingerTimer);
    clearTimeout(G.chipCoachTimer);
    G.linger = null;
    G.c1 = null;
    dom.hint.classList.remove('is-offer');
    closeDialog(dom.win, true);
    closeDialog(dom.helpDlg, true);
  }

  function openLevel(id) {
    var def = levelById(id);
    if (!def) return showHome();
    leaveGame();
    G.screen = 'game';
    G.id = id;
    G.lastId = id;
    G.def = def;
    G.L = WB.parseLevel(def);
    G.chapter = chapterOf(id);
    G.fixed = G.L.fixed.map(norm);
    G.pieces = restoreBoard(id);
    G.history = [];
    G.future = [];
    G.sel = null; G.valid = null; G.validWall = false; G.rot = {};
    G.hover = null; G.hoverMouse = false; G.cursor = null; G.ghost = null; G.hint = null; G.conflicts = null; G.lifted = null;
    G.previewSim = null; G.previewKey = null; G.dragBaseSim = null;
    G.pops = {}; G.shake = null; G.flash = null; G.pulse = null; G.focus = null; G.winAt = null;
    G.hintStep = 0; G.hintBoard = null; G.hintFollowed = false; G.tipAt = null;
    G.sim = WB.simulate(G.L, allPieces());
    // how many are happy in the empty house: the goals bar praises only progress past this
    G.startHappy = happyCount(G.pieces.length ? WB.simulate(G.L, G.fixed) : G.sim);
    G.best = happyCount(G.sim); G.sinceMoves = 0; G.sinceAt = performance.now(); G.offered = false;
    G.won = G.sim.solved && isDone(id);
    G.version++;
    rebuildDrawPieces();

    dom.home.hidden = true;
    dom.game.hidden = false;
    document.title = id + ' · ' + (def.name || 'Level') + ' — Windbreaker';
    dom.lvlNum.textContent = String(id);
    dom.lvlName.textContent = def.name || 'Level ' + id;
    dom.lvlDone.hidden = !isDone(id);
    renderWind();
    // the card this level introduces: shown by itself the first time, then
    // folded into the guidance line above the board
    G.levelGuide = levelGuideId(id);
    dom.guideLine.classList.remove('is-open');
    var autoGuide = !!G.levelGuide && store.seenTools.indexOf(G.levelGuide) < 0;
    var intro = chapterIntro(G.chapter);
    G.newTool = autoGuide && intro && intro.kind === 'tool' && intro.id === G.levelGuide ? intro.id : null;
    G.newToolUsed = false;
    // the very first level: three soft steps pinned to the board
    G.c1 = firstLevelCoach();
    G.coachGoal = G.c1 ? goalLine() : null;
    renderTray();
    renderGoals();
    updateButtons();
    board.setLevel(G.L, id);
    if (autoGuide) openGuide(G.levelGuide, { intro: true, focus: G.focusBoardOnOpen });
    else updateGuideLine();
    layoutBoard();
    startLoop();
    window.scrollTo(0, 0);
    G.openedAt = performance.now();
    // "Next" (win card or pill) disappears with the old level: keep keyboard
    // focus on the board (or the new card) instead of letting it fall back to the page
    if (G.focusBoardOnOpen && !G.guide) dom.canvas.focus({ preventScroll: true });
    G.focusBoardOnOpen = false;
    if (!G.guide) startCoachSoon();
    armStuck();
    // a saved board that already solves the level (closed mid-celebration, or
    // a redesigned level): let the normal win run so progress is recorded
    if (G.sim.solved && !isDone(id)) checkWin();
  }

  function restoreBoard(id) {
    var saved = store.boards[id];
    var out = [];
    if (!Array.isArray(saved)) return out;
    // saved for another version of this level (or before boards were signed):
    // its pieces belonged to a different puzzle
    if (store.boardSigs[id] !== levelSig(id)) { forgetBoard(id); return out; }
    var L = WB.parseLevel(levelById(id));
    var fixed = L.fixed.map(norm);
    var used = {};
    saved.forEach(function (p) {
      if (!p || !WB.TOOLS[p.type]) return;
      var q = norm(p);
      if (q.d < 0 || q.d >= rotations(q.type)) q.d = 0;
      if ((used[q.type] || 0) >= (L.inventory[q.type] || 0)) return;
      if (!WB.canPlace(L, fixed.concat(out), q.type, q.x, q.y)) return;
      used[q.type] = (used[q.type] || 0) + 1;
      out.push(q);
    });
    return out;
  }

  function saveBoard() {
    if (G.id == null) return;
    if (G.pieces.length) { store.boards[G.id] = G.pieces.map(norm); store.boardSigs[G.id] = levelSig(G.id); }
    else forgetBoard(G.id);
    saveStore();
  }
  function forgetBoard(id) {
    delete store.boards[id];
    delete store.boardSigs[id];
  }

  // The wind badge: "Wind", an arrow made of the stream's lanes (one line for
  // gentle, two strong, three a gale) pointing the way it blows, and a word.
  function renderWind() {
    var w = G.L.wind;
    var calm = w.strength <= 0;
    dom.wind.classList.toggle('is-calm', calm);
    dom.wind.setAttribute('data-s', String(clamp(w.strength, 0, 3)));
    var glyph = dom.wind.querySelector('.wind-glyph');
    glyph.style.transform = 'rotate(' + ((w.dir - 1) * 90) + 'deg)';
    dom.wind.querySelector('.wind-word').textContent = STRENGTH_WORD[clamp(w.strength, 0, 3)];
    var label = calm ? 'Wind: calm, no wind today' : 'Wind from ' + FROM_SIDE[w.from] + ', ' + STRENGTH_WORD[Math.min(3, w.strength)];
    dom.wind.setAttribute('aria-label', label);
    dom.wind.title = label;
  }
  function windText() {
    var w = G.L.wind;
    if (w.strength <= 0) return 'A calm day: no wind blows in, so windows only let air out. Fans make the breeze.';
    var n = Math.min(3, w.strength);
    return 'The wind blows in from ' + FROM_SIDE[w.from] + '. It is ' + (n === 3 ? 'a gale' : STRENGTH_WORD[n]) + ': ' +
      ['', 'one line', 'two lines', 'three lines'][n] + ' in the stream. A window on the windy side lets it in.';
  }
  dom.wind.addEventListener('click', function () {
    if (G.screen !== 'game') return;
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'wind') { hideToast(); return; }
    showToast(windText(), null, null, { ms: 7000, kind: 'wind' });
  });

  // ---------------------------------------------------------------- field guide: data

  function chapterIntro(ch) {
    if (!ch) return null;
    if (ch.intro) return ch.intro;
    return ch.tool ? { kind: 'tool', id: ch.tool } : null;
  }
  function guideKind(id) { return WB.TOOLS[id] ? 'tool' : WB.OBJECTS[id] ? 'object' : 'twist'; }
  // A thing's card; a thing without one gets a plain card from the engine's words.
  function guideFor(id) {
    if (GUIDES[id]) return GUIDES[id];
    var src = WB.TOOLS[id] || WB.OBJECTS[id] || (WB.CONDITIONS && WB.CONDITIONS[id]);
    if (!src) return null;
    return { id: id, kind: guideKind(id), title: src.name, oneLiner: src.desc, points: [], controls: '' };
  }
  function thingTitle(id) { var c = guideFor(id); return c ? c.title : String(id); }
  function lowerName(id) { return thingTitle(id).toLowerCase(); }
  function guideIcon(canvas, id, size) {
    var k = guideKind(id);
    if (k === 'tool') R.icon(canvas, 'tool', id, size);
    else if (k === 'object') R.icon(canvas, 'object', id, size);
    else R.icon(canvas, 'ui', TWIST_ICON[id] || 'calm', size);
  }
  // The first level (in play order) that has each twist.
  var firstTwist = null;
  function firstTwistLevel(id) {
    if (!firstTwist) {
      firstTwist = {};
      LEVELS.forEach(function (lv) {
        (WB.levelConditions ? WB.levelConditions(lv) : []).forEach(function (c) { if (firstTwist[c] == null) firstTwist[c] = lv.id; });
      });
    }
    return firstTwist[id];
  }
  // The card a level introduces: its chapter's new thing on the chapter's first
  // level, or a twist on the first level that has it. Practice levels: none.
  function levelGuideId(id) {
    var ch = chapterOf(id), it = chapterIntro(ch);
    if (it && ch.first === id && guideFor(it.id)) return it.id;
    var def = levelById(id);
    var conds = def && WB.levelConditions ? WB.levelConditions(def) : [];
    for (var i = 0; i < conds.length; i++) if (firstTwistLevel(conds[i]) === id && guideFor(conds[i])) return conds[i];
    return null;
  }
  // Has the player met this thing by level n?
  function metBy(id, n) {
    var k = guideKind(id);
    if (k === 'tool') return WB.TOOLS[id].intro <= n;
    if (k === 'object') return WB.OBJECTS[id].intro <= n;
    var f = firstTwistLevel(id);
    return f != null && f <= n;
  }
  // The cards say "tap"; with a mouse it is a click.
  function tapWords(s) { return usingTouch() ? String(s) : String(s).replace(/\bTap\b/g, 'Click').replace(/\btap\b/g, 'click'); }

  var CLOSE_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  var HAND_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 12.5V5.8a1.6 1.6 0 0 1 3.2 0v5.4"/><path d="M12.7 10.6a1.6 1.6 0 0 1 3.2 0v1.2"/><path d="M15.9 11.4a1.6 1.6 0 0 1 3.1.4v3.4a5.8 5.8 0 0 1-5.8 5.8h-.6a5.6 5.6 0 0 1-4.4-2.1l-2.8-3.6a1.6 1.6 0 0 1 2.4-2.1l1.9 1.8"/></svg>';
  var CHEVRON_SVG = '<svg class="ico fg-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';
  var BACK_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';

  // ---------------------------------------------------------------- field guide: the demo

  // A card's demo: its tiny house, drawn by the real board renderer on a canvas
  // of its own, looping between the "before" and "after" scenes (tap to switch)
  // with their captions. With reduced motion both scenes stand still, side by side.
  function makeDemo(card) {
    var d = card.demo;
    if (!d || !d.map) return null;
    var L;
    try { L = WB.parseLevel({ name: card.title, wind: d.wind, map: d.map, fixed: d.fixed || [], inventory: {} }); } catch (e) { return null; }
    var fixed = L.fixed.map(norm);
    function scene(list) {
      list = (list || []).map(norm);
      var draw = fixed.map(function (p) { return { type: p.type, x: p.x, y: p.y, d: p.d, fixed: true }; })
        .concat(list.map(function (p) { return { type: p.type, x: p.x, y: p.y, d: p.d, fixed: false }; }));
      return { list: list, pieces: draw, sim: WB.simulate(L, fixed.concat(list)) };
    }
    var scenes = [scene(d.before), scene(d.after)];
    var caps = [d.caption_before || '', d.caption_after || ''];
    var still = reducedMotion();
    var wrap = el('div', 'gdemo' + (still ? ' is-still' : ''));
    var views = [];
    function view(parent, si) {
      var box = el('div', 'gdemo-box');
      var c = el('canvas', 'gdemo-canvas');
      c.setAttribute('aria-hidden', 'true');
      box.appendChild(c);
      parent.appendChild(box);
      var b = new R.Board(c);
      b.setLevel(L, 11 + views.length);
      var v = { box: box, board: b, si: si, pops: {} };
      views.push(v);
      return v;
    }
    var cap = null, dots = null;
    if (still) {
      [0, 1].forEach(function (si) {
        var fig = el('figure', 'gdemo-fig');
        view(fig, si);
        fig.appendChild(el('figcaption', 'gdemo-cap', caps[si]));
        wrap.appendChild(fig);
      });
    } else {
      var v0 = view(wrap, 0);
      v0.box.addEventListener('click', function () { flip(); });
      cap = el('p', 'gdemo-cap');
      cap.setAttribute('aria-hidden', 'true');
      wrap.appendChild(cap);
      dots = el('div', 'gdemo-dots');
      dots.setAttribute('aria-hidden', 'true');
      dots.appendChild(el('i'));
      dots.appendChild(el('i'));
      wrap.appendChild(dots);
      // screen readers hear both scenes once, not every few seconds
      wrap.appendChild(el('p', 'sr-only', 'Before: ' + caps[0] + ' After: ' + caps[1]));
    }
    var running = false, raf = 0, t0 = 0, cur = -1, ro = null;
    // As wide as there is room for, but never taller than the box's max-height
    // (css: on a phone sheet the demo must leave room for the words below it).
    function layout() {
      views.forEach(function (v) {
        var room = Math.floor(v.box.parentNode.clientWidth);
        var cap = parseFloat(getComputedStyle(v.box).maxHeight);
        var w = isFinite(cap) && cap > 0 ? Math.min(room, Math.floor(cap * (L.w + 1.5) / (L.h + 1.5))) : room;
        if (w < 40) return;
        v.box.style.width = w + 'px';
        v.board.layout(w, Math.round(w * (L.h + 1.5) / (L.w + 1.5)), 0, 0.75);
      });
    }
    function paint(v, si, now) {
      v.board.draw({ pieces: scenes[si].pieces, sim: scenes[si].sim, pops: v.pops, reduced: still }, now);
    }
    function show(si, now) {
      var v = views[0];
      v.pops = {};
      // the piece that makes the difference pops in
      if (cur === 0 && si === 1) {
        scenes[1].list.forEach(function (p) {
          var same = scenes[0].list.some(function (q) { return q.type === p.type && q.x === p.x && q.y === p.y && q.d === p.d; });
          if (!same) v.pops[p.x + ',' + p.y] = now;
        });
      }
      cur = si;
      cap.textContent = caps[si];
      cap.classList.remove('is-in');
      void cap.offsetWidth;
      cap.classList.add('is-in');
      dots.children[0].classList.toggle('on', si === 0);
      dots.children[1].classList.toggle('on', si === 1);
      wrap.setAttribute('data-scene', si ? 'after' : 'before');
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      if (still) { views.forEach(function (v) { paint(v, v.si, now); }); return; } // drawn once per change
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      // the visual check draws a frozen moment: always the "after" scene
      var si = typeof window.__wbFreezeTime === 'number' ? 1 : Math.floor(Math.max(0, now - t0) / DEMO_MS) % 2;
      if (si !== cur) show(si, now);
      paint(views[0], cur, now);
    }
    function kick() { if (running && !raf) raf = requestAnimationFrame(frame); }
    function flip() { t0 = performance.now() - (cur === 0 ? DEMO_MS : 0); }
    return {
      el: wrap,
      still: still,
      start: function () {
        if (running) return;
        running = true;
        cur = -1;
        t0 = performance.now();
        layout();
        if (window.ResizeObserver && !ro) {
          ro = new ResizeObserver(function () { layout(); kick(); });
          views.forEach(function (v) { ro.observe(v.box.parentNode); });
        }
        kick();
      },
      stop: function () {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (ro) { ro.disconnect(); ro = null; }
      },
      repaint: function () { views.forEach(function (v) { v.board.refreshPalette(); }); kick(); }
    };
  }

  // ---------------------------------------------------------------- field guide: the card

  // A card's content: head, what it does, the demo, how it works, how to use it.
  // opts: { intro, titleId, close: fn, status: html, buttons: [{ id, label, cls, fn }] }
  function buildCard(card, opts) {
    opts = opts || {};
    var root = el('div', 'gcard');
    var head = el('div', 'gcard-head');
    var ic = el('canvas', 'gcard-icon');
    ic.setAttribute('aria-hidden', 'true');
    guideIcon(ic, card.id, 44);
    head.appendChild(ic);
    var tt = el('div', 'gcard-titles');
    tt.appendChild(el('p', 'gcard-kicker', (opts.intro ? KIND_NEW : KIND_WORD)[card.kind] || ''));
    var h = el('h2', 'gcard-title', opts.intro ? 'Meet the ' + card.title.toLowerCase() : card.title);
    if (opts.titleId) h.id = opts.titleId;
    tt.appendChild(h);
    head.appendChild(tt);
    if (opts.close) {
      var x = el('button', 'icon-btn icon-btn-small gcard-close');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.innerHTML = CLOSE_SVG;
      x.addEventListener('click', opts.close);
      head.appendChild(x);
    }
    root.appendChild(head);
    var main = el('div', 'gcard-main');
    main.appendChild(el('p', 'gcard-one', tapWords(card.oneLiner)));
    var status = null;
    if (opts.status != null) {
      status = el('p', 'gcard-status');
      status.innerHTML = opts.status;
      main.appendChild(status);
    }
    var demo = makeDemo(card);
    if (demo) main.appendChild(demo.el);
    // how to use it comes right after the demo, before the fine points, so a
    // small screen shows it without scrolling
    if (card.controls) {
      var ctl = el('p', 'gcard-controls');
      ctl.innerHTML = HAND_SVG + '<span>' + esc(tapWords(card.controls)) + '</span>';
      main.appendChild(ctl);
    }
    if (card.points && card.points.length) {
      var ul = el('ul', 'gcard-points');
      card.points.forEach(function (p) { ul.appendChild(el('li', null, tapWords(p))); });
      main.appendChild(ul);
    }
    root.appendChild(main);
    var more = null;
    if (opts.buttons && opts.buttons.length) {
      var bar = el('div', 'gcard-buttons');
      // more to read below: a small "More" that scrolls to it
      more = el('button', 'btn btn-quiet gcard-more');
      more.type = 'button';
      more.hidden = true;
      more.innerHTML = '<span>More</span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5L12 15l5.5-5.5"/></svg>';
      more.setAttribute('aria-label', 'Show more of this card');
      more.addEventListener('click', function () { main.scrollBy({ top: Math.max(80, main.clientHeight * 0.7), behavior: reducedMotion() ? 'auto' : 'smooth' }); });
      bar.appendChild(more);
      opts.buttons.forEach(function (b) {
        var btn = el('button', b.cls, b.label);
        btn.type = 'button';
        if (b.id) btn.id = b.id;
        btn.addEventListener('click', b.fn);
        bar.appendChild(btn);
      });
      root.appendChild(bar);
    }
    return { el: root, demo: demo, status: status, icon: ic, more: more };
  }

  // ---------------------------------------------------------------- field guide: on the game screen
  //
  // One card at a time. Phones and tablets: a bottom sheet in place of the tray
  // (the board takes the rest of the screen). Wide screens: a panel beside the
  // board. Landscape phones: the side column. The board is laid out in the
  // space that is left, so the card never covers the house. Closed, the card
  // folds into the guidance line above the board, which opens it again.
  // While it is open it is the only voice: no tip line, coach bubble or tooltip.

  function openGuide(id, opts) {
    opts = opts || {};
    var card = guideFor(id);
    if (!card || G.screen !== 'game' || boardLocked()) return;
    // the same card rebuilt (Less motion switched): it stays where it was read
    var oldScroll = opts.keepScroll && G.guide ? G.guide.built.el.querySelector('.gcard-main').scrollTop : 0;
    closeGuide({ silent: true, keep: true });
    hideTooltip();
    hidePieceMenu();
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') !== 'reset') hideToast();
    var at = opts.at || null;
    var buttons = [];
    // the first time: "Let's try it" (and "Show me"); opened again mid-level, it
    // is a reminder: "Got it" (a tool keeps "Show me": where it can go)
    if (showMeTarget(id) && (opts.intro || WB.TOOLS[id])) buttons.push({ id: 'guide-show', label: 'Show me', cls: 'btn btn-quiet', fn: function () { closeGuide({ how: 'show' }); } });
    buttons.push({ id: 'guide-go', label: opts.intro ? 'Let’s try it' : 'Got it', cls: 'btn btn-primary', fn: function () { closeGuide({ how: 'go' }); } });
    var built = buildCard(card, {
      intro: !!opts.intro, titleId: 'guide-title', status: at ? describe(at.x, at.y) : null, buttons: buttons,
      close: function () { closeGuide({ how: 'close' }); }
    });
    dom.guide.textContent = '';
    dom.guide.appendChild(built.el);
    dom.guide.setAttribute('data-kind', card.kind);
    dom.guide.hidden = false;
    dom.game.classList.add('is-guiding');
    // more to read below? the last lines fade out
    var main = built.el.querySelector('.gcard-main');
    var fade = function () {
      var below = main.scrollHeight - main.scrollTop - main.clientHeight > 6;
      main.classList.toggle('can-scroll', below);
      if (built.more) built.more.hidden = !below;
    };
    main.addEventListener('scroll', fade, { passive: true });
    G.guide = { id: id, intro: !!opts.intro, at: at, built: built, fade: fade };
    renderCoach();
    updateGuideLine();
    if (built.demo) built.demo.start();
    if (oldScroll) main.scrollTop = oldScroll;
    fade();
    if (opts.focus) { var go = $('guide-go'); if (go) go.focus({ preventScroll: true }); }
    if (!opts.keepScroll) announce((opts.intro ? 'Meet the ' + card.title.toLowerCase() : card.title) + '. ' + tapWords(card.oneLiner));
  }

  // how: 'go' (Let's try it), 'show' (Show me), 'close' (× or Esc).
  // keep: another card takes its place, or the level is left (this level's
  // card then opens by itself again next time).
  function closeGuide(opts) {
    opts = opts || {};
    var g = G.guide;
    if (!g) return;
    var hadFocus = dom.guide.contains(document.activeElement);
    if (g.built.demo) g.built.demo.stop();
    G.guide = null;
    dom.guide.hidden = true;
    dom.guide.textContent = '';
    dom.game.classList.remove('is-guiding');
    if (opts.keep) return; // replaced, or the level is left: not read yet
    if (g.id === G.levelGuide) {
      markGuideSeen(g.id);
      // the new tool keeps its "New" label in the tray until it is first used
      if (G.newTool) updateTray();
      // a new thing in the house: its goal chip says hello once
      if (g.intro && WB.OBJECTS[g.id]) helloGoal(g.id);
    }
    // the board takes the freed space: let it settle in softly
    dom.canvas.classList.remove('is-settling');
    void dom.canvas.offsetWidth;
    dom.canvas.classList.add('is-settling');
    updateGuideLine();
    if (opts.how === 'show') showMe(g.id);
    if (hadFocus && !opts.silent) {
      var f = opts.how !== 'show' && !dom.guideLine.hidden && !dom.tipMore.hidden ? dom.tipMore : dom.canvas;
      f.focus({ preventScroll: true });
    }
    startCoachSoon();
    renderCoach();
  }

  function markGuideSeen(id) {
    if (store.seenTools.indexOf(id) >= 0) return;
    store.seenTools.push(id);
    saveStore();
  }

  // "Show me": light up where a tool can go, or ring the objects of that kind.
  function showMeTarget(id) {
    if (!G.L) return false;
    if (WB.TOOLS[id]) return remaining(id) > 0;
    if (WB.OBJECTS[id]) return G.L.objects.some(function (o) { return o.type === id; });
    return false;
  }
  function showMe(id) {
    if (WB.TOOLS[id]) {
      if (remaining(id) > 0 && !boardLocked()) { select(id); G.pulse = performance.now(); }
    } else if (WB.OBJECTS[id]) {
      G.focus = { type: id, t0: performance.now() };
    }
  }

  // The guidance line above the board: the level's tip. On a level that brings
  // something new it also carries that thing's icon and an (i) that opens its card.
  function updateGuideLine() {
    if (!G.def) return;
    var gid = G.levelGuide;
    var text = G.coachGoal || (G.def.tip ? tapWords(plainTip(G.def.tip)) : '');
    if (gid && !text) text = tapWords(guideFor(gid).oneLiner);
    if (dom.tip.textContent !== text) dom.tip.textContent = text;
    dom.tipIcon.hidden = !gid;
    dom.tipMore.hidden = !gid;
    dom.guideLine.classList.toggle('has-guide', !!gid);
    if (gid) {
      guideIcon(dom.tipIcon, gid, 28);
      var nm = lowerName(gid);
      dom.tipMore.setAttribute('aria-label', 'About the ' + nm);
      dom.tipMore.title = 'Meet the ' + nm;
    }
    // one voice: while the card is open, it says it all
    dom.guideLine.hidden = !text || !!G.guide;
    markClamped();
  }
  // On a phone the line shows two lines at most; a longer tip ends in "…" and
  // a tap shows all of it (the (i) still opens the card).
  function markClamped() {
    if (dom.guideLine.hidden) return;
    var open = dom.guideLine.classList.contains('is-open');
    dom.guideLine.classList.toggle('is-clamped', !open && dom.tip.scrollHeight > dom.tip.clientHeight + 2);
  }
  dom.guideLine.addEventListener('click', function (e) {
    if (G.screen !== 'game' || G.guide) return;
    var onMore = dom.tipMore.contains(e.target);
    if (!onMore && dom.guideLine.classList.contains('is-clamped')) {
      dom.guideLine.classList.add('is-open');
      dom.guideLine.classList.remove('is-clamped');
      return;
    }
    if (G.levelGuide) openGuide(G.levelGuide);
  });

  onMQ(landscapeMQ, function () {
    layoutBoard();
    positionCoach();
  });

  // ---------------------------------------------------------------- coach bubbles
  //
  // One soft bubble pinned to a cell of the board, with a ring breathing on
  // that cell: the first level's steps, and one-time tips (turning a fan,
  // moving pieces, a window off the breeze's path, smoky laundry). It waits
  // while a card, a toast or the help is open, and no tooltip shows with it.
  // Taps go through it to the board; it moves on or fades by itself.

  function showCoach(x, y, text, opts) {
    opts = opts || {};
    clearTimeout(G.coachHide);
    var c = G.coach = { x: x, y: y, text: text, key: opts.key || null, t0: performance.now() };
    if (opts.ms) G.coachHide = setTimeout(function () { if (G.coach === c) hideCoach(); }, opts.ms);
    renderCoach();
  }
  function coachShowing() { return !!G.coach && !dom.coach.hidden; }
  function renderCoach() {
    var c = G.coach;
    var show = !!c && G.screen === 'game' && !G.guide && dom.toast.hidden && dom.helpDlg.hidden && dom.win.hidden;
    dom.coach.hidden = !show;
    G.spot = show ? { x: c.x, y: c.y, t0: c.t0 } : null;
    if (!show) return;
    hideTooltip();
    if (dom.coachText.textContent !== c.text) {
      dom.coachText.textContent = c.text;
      dom.coach.classList.remove('is-in');
      void dom.coach.offsetWidth;
      dom.coach.classList.add('is-in');
    }
    positionCoach();
  }
  function hideCoach() {
    clearTimeout(G.coachHide);
    G.coach = null;
    G.spot = null;
    dom.coach.hidden = true;
    markChipCoach(null);
  }
  function positionCoach() {
    var c = G.coach;
    if (!c || dom.coach.hidden || !G.L) return;
    var p = placeNear(dom.coach, c.x, c.y, true, 12);
    var a = dom.coachArrow.style;
    dom.coach.setAttribute('data-side', p.side);
    a.left = a.top = '';
    if (p.side === 'above' || p.side === 'below') a.left = clamp(p.cx - p.l - 6, 12, p.w - 24) + 'px';
    else a.top = clamp(p.cy - p.t - 6, 10, p.h - 22) + 'px';
  }
  // a tray chip that softly calls for a tap
  function markChipCoach(type) {
    G.chipCoach = type;
    var chips = dom.tray.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('is-coach', chips[i].getAttribute('data-tool') === type);
  }

  // ---------------------------------------------------------------- the first level's coach
  //
  // Three soft steps pinned to the board: where the wind comes in, where it
  // stops for want of a way out (the dashed line and the red ×, explained right
  // where they are), and the happy ending. A window placed off the breeze's
  // path gets a gentle word, once.

  var C1_TEXT = {
    in: 'The wind blows in here. The dashed line shows where it wants to go.',
    out: 'But it stops at this wall, at the red ×: no way out yet. Put a window here!',
    move: 'But it stops at this wall, at the red \u00d7: no way out yet. Drag your window here!',
    offpath: 'Breezes blow in straight lines. Try where the dashed line ends, at the red \u00d7.',
    offpathMove: 'Breezes blow in straight lines. Drag your window to where the dashed line ends.',
    inside: 'Inside walls stop a breeze. Line your window up with a doorway.',
    flow: 'The breeze flows! Now let it reach the pinwheel.',
    done: 'In one window, out the other: that’s a breeze! The pinwheel is happy.'
  };
  function firstLevelCoach() {
    if (!LEVELS.length || G.id !== LEVELS[0].id || G.levelGuide !== 'window' || isDone(G.id) || seenTip('coach1')) return null;
    var inlet = stalledInlets(G.sim)[0];
    return inlet ? { step: null, inlet: { x: inlet.source.x, y: inlet.source.y } } : null;
  }
  function stalledInlets(sim) { return sim.trees.filter(function (t) { return t.kind === 'inlet' && !t.active; }); }
  // The tip for a window just placed off the breeze's path: pinned to the red
  // × it talks about, and only where the advice works (a window can go there,
  // moved or from the tray). A breeze stopped by an inside wall gets its own words.
  function offpathTip(placed) {
    var cells = stallInfo(G.sim).cells, wp = placed ? playerAt(placed.x, placed.y) : null;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (WB.canPlace(G.L, allPieces(wp), 'window', c.x, c.y)) {
        return { x: c.x, y: c.y, text: remaining('window') > 0 ? C1_TEXT.offpath : C1_TEXT.offpathMove };
      }
    }
    for (var j = 0; j < cells.length; j++) {
      var d = cells[j], inner = WB.cellAt(G.L, d.x, d.y) === '#';
      for (var k = 0; k < 4 && inner; k++) if (WB.isOutside(WB.cellAt(G.L, d.x + WB.DX[k], d.y + WB.DY[k]))) inner = false;
      if (inner) return { x: d.x, y: d.y, text: C1_TEXT.inside };
    }
    return null;
  }
  // the wall cell where a stalled breeze stops (its red ×)
  function stallCell(sim) { return stallInfo(sim).first; }
  function goalLine() {
    var objs = G.L.objects;
    if (!objs.length || !objs.every(function (o) { return o.type === 'pinwheel'; })) return null;
    return objs.length === 1 ? 'Make the pinwheel spin!' : 'Make every pinwheel spin!';
  }
  function startCoachSoon() {
    var c1 = G.c1;
    if (!c1 || c1.step || G.guide || G.sim.solved) return;
    c1.step = 'wait';
    clearTimeout(G.c1Timer);
    G.c1Timer = setTimeout(function () { if (G.c1 === c1) c1Step('in'); }, 450);
  }
  function c1Step(step) {
    var c1 = G.c1;
    if (!c1 || G.screen !== 'game' || G.won) return;
    clearTimeout(G.c1Timer);
    c1.step = step;
    markChipCoach(null);
    if (step === 'in') {
      showCoach(c1.inlet.x, c1.inlet.y, C1_TEXT.in);
      G.c1Timer = setTimeout(function () { if (G.c1 === c1 && c1.step === 'in') c1Step('out'); }, 4200);
    } else if (step === 'out') {
      var sc = stallCell(G.sim);
      if (!sc) { hideCoach(); return; }
      // no window left in the tray: the one on the board has to move
      showCoach(sc.x, sc.y, remaining('window') > 0 ? C1_TEXT.out : C1_TEXT.move);
      if (G.sel !== 'window' && remaining('window') > 0) markChipCoach('window');
    } else if (step === 'offpath') {
      var tip = c1.tip;
      showCoach(tip.x, tip.y, tip.text);
      G.c1Timer = setTimeout(function () { if (G.c1 === c1 && c1.step === 'offpath') c1Step('out'); }, 4500);
    } else if (step === 'flow') {
      var g = null;
      G.sim.goals.forEach(function (x) { if (!g && !x.ok) g = x; });
      if (g) showCoach(g.x, g.y, C1_TEXT.flow, { ms: 6000 }); else hideCoach();
    }
  }
  // after every move on the first level (placed: the piece just placed)
  function c1Update(placed) {
    var c1 = G.c1;
    if (!c1 || !c1.step || c1.step === 'wait' || G.sim.solved) return;
    if (!stalledInlets(G.sim).length) { c1Step('flow'); return; }
    var tip = placed && placed.type === 'window' && !seenTip('offpath') ? offpathTip(placed) : null;
    if (tip) {
      store.seenTips.push('offpath');
      saveStore();
      c1.tip = tip;
      c1Step('offpath');
      return;
    }
    if (c1.step !== 'offpath' && c1.step !== 'in') c1Step('out');
  }

  // ---------------------------------------------------------------- tray

  function trayTypes() {
    return WB.TOOL_ORDER.filter(function (t) { return (G.L.inventory[t] || 0) > 0; });
  }

  function renderTray() {
    var focusedType = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-tool');
    dom.tray.textContent = '';
    var types = trayTypes();
    dom.tray.classList.toggle('is-many', types.length > 5);
    types.forEach(function (type, i) {
      var t = WB.TOOLS[type];
      var b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('data-tool', type);
      var cv = el('canvas');
      cv.setAttribute('aria-hidden', 'true');
      R.icon(cv, 'tool', type, 38);
      b.appendChild(cv);
      b.appendChild(el('span', 'chip-name', t.name));
      b.appendChild(el('span', 'chip-count', '\u00d70'));
      // on the selected chip: an (i) that opens the tool's card (so does a long-press)
      var info = el('span', 'chip-info', 'i');
      info.setAttribute('aria-hidden', 'true');
      b.appendChild(info);
      b.title = t.name + (i < 10 ? ' (' + ((i + 1) % 10) + ')' : '') + ' \u00b7 ' + (coarseMQ.matches ? 'press and hold' : 'right-click') + ' to learn more';
      b.addEventListener('click', onChipClick);
      b.addEventListener('pointerdown', onChipDown);
      b.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (G.lastPtr === 'mouse' && !boardLocked()) openGuide(type);
      });
      b.addEventListener('animationend', function () { b.classList.remove('is-shake'); b.classList.remove('is-bounce'); });
      dom.tray.appendChild(b);
    });
    updateTray();
    if (focusedType) {
      var f = dom.tray.querySelector('[data-tool="' + focusedType + '"]');
      if (f) f.focus();
    }
    // make sure a tool with copies left is in view
    var first = null;
    for (var k = 0; k < types.length; k++) if (remaining(types[k]) > 0) { first = dom.tray.querySelector('[data-tool="' + types[k] + '"]'); break; }
    dom.tray.scrollLeft = 0;
    if (first) revealChip(first);
    updateTrayFade();
  }

  function revealChip(chip) {
    var t = dom.tray;
    if (t.scrollWidth <= t.clientWidth + 1) return;
    var cl = chip.offsetLeft - t.offsetLeft, cr = cl + chip.offsetWidth;
    if (cl < t.scrollLeft + 12) t.scrollLeft = Math.max(0, cl - 24);
    else if (cr > t.scrollLeft + t.clientWidth - 12) t.scrollLeft = cr - t.clientWidth + 24;
    updateTrayFade();
  }
  function updateTrayFade() {
    var t = dom.tray, max = t.scrollWidth - t.clientWidth;
    var horiz = getComputedStyle(t).flexWrap !== 'wrap';
    t.classList.toggle('fade-l', horiz && max > 2 && t.scrollLeft > 2);
    t.classList.toggle('fade-r', horiz && max > 2 && t.scrollLeft < max - 2);
  }
  dom.tray.addEventListener('scroll', updateTrayFade, { passive: true });

  function updateTray() {
    var chips = dom.tray.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      var b = chips[i], type = b.getAttribute('data-tool');
      var n = remaining(type);
      b.querySelector('.chip-count').textContent = '\u00d7' + n;
      // used up: still pressable (press and hold opens its card; a tap says where they all are)
      var used = n <= 0 && G.sel !== type;
      b.classList.toggle('is-used', used);
      if (used) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.classList.toggle('is-selected', G.sel === type);
      b.classList.toggle('is-new', G.newTool === type && !G.newToolUsed);
      b.classList.toggle('is-coach', G.chipCoach === type && G.sel !== type);
      b.setAttribute('aria-pressed', G.sel === type ? 'true' : 'false');
      b.setAttribute('aria-label', toolName(type) + ', ' + n + ' left' + (G.sel === type ? ', selected' : ''));
    }
  }

  function onChipClick(e) {
    var type = this.getAttribute('data-tool');
    if (I.suppressClick) { I.suppressClick = false; return; }
    var info = I.infoDown === type;
    I.infoDown = null;
    if (info && e.detail !== 0) { openGuide(type); return; }
    // not during the win celebration, and not the second click of a
    // double-click on "Next level" (the pill sits over the new tray)
    if (boardLocked()) return;
    if (e.detail > 1 && performance.now() - G.openedAt < 700) return;
    Sound.unlock();
    // all of this tool's copies are on the board: say so (and where to find them)
    if (remaining(type) <= 0 && G.sel !== type) { usedChip(this, type); return; }
    // tapping the selected tool again keeps it (a little bounce, and where it goes)
    if (G.sel === type && e.detail !== 0) { againChip(this, type); return; }
    if (G.sel !== type) select(type);
    // keyboard activation: hand focus to the board, on a cell where the tool fits
    if (e.detail === 0 && G.sel === type) {
      var c = nearestValid(G.cursor || { x: (G.L.w - 1) / 2, y: (G.L.h - 1) / 2 });
      if (c) {
        G.cursor = { x: c.x, y: c.y, inMap: true };
        dom.canvas.focus({ preventScroll: true });
        updateGhostFromHover();
        showTooltipAt(c.x, c.y, describe(c.x, c.y) + '<span class="tt-act">Arrows to move · Enter to place</span>', 0);
      }
    }
  }

  // A used-up tool, tapped: a little shake, and where its pieces are.
  function usedChip(chip, type) {
    chip.classList.remove('is-shake');
    void chip.offsetWidth;
    chip.classList.add('is-shake');
    Sound.nope();
    var on = G.pieces.filter(function (p) { return p.type === type; });
    if (on.length) G.focus = { cell: { x: on[0].x, y: on[0].y }, t0: performance.now() };
    var nm = lowerName(type), many = (G.L.inventory[type] || 0) > 1;
    if (!G.guide) showToast((many ? 'All your ' + (ABOUT_NAME[type] || nm + 's') + ' are' : 'Your ' + nm + ' is') + ' on the board. Drag ' + (many ? 'one' : 'it') + ' to move ' + (many ? 'it' : 'it') + '.', null, null, { ms: 4000, kind: 'mount' });
  }

  // The selected tool, picked again: it stays selected. Say where it goes.
  function againChip(chip, type) {
    chip.classList.remove('is-bounce');
    void chip.offsetWidth;
    chip.classList.add('is-bounce');
    G.pulse = performance.now();
    if (!G.guide) showToast((usingTouch() ? 'Tap' : 'Click') + ' a glowing spot to place the ' + lowerName(type) + '.', null, null, { ms: 3200, kind: 'mount' });
  }

  function nearestValid(p) {
    var best = null, bd = 1e9;
    (G.valid || []).forEach(function (v) {
      var d = Math.abs(v.x - p.x) + Math.abs(v.y - p.y);
      if (d < bd) { bd = d; best = v; }
    });
    return best;
  }

  function select(type) {
    if (remaining(type) <= 0) return;
    hidePieceMenu();
    G.sel = type;
    G.valid = WB.placementCells(G.L, allPieces(), type);
    G.validWall = isWallMount(type);
    if (G.chipCoach === type) markChipCoach(null);
    hideTooltip();
    updateTray();
    var chip = dom.tray.querySelector('[data-tool="' + type + '"]');
    if (chip) revealChip(chip);
    updateGhostFromHover();
    updateCursorStyle();
  }
  function deselect() {
    G.sel = null;
    G.valid = null;
    G.ghost = null;
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'mount') hideToast();
    updatePreview();
    updateTray();
    updateCursorStyle();
  }
  function isValidCell(list, x, y) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return true;
    return false;
  }

  // Nearest valid cell to a fractional pointer position, with its distance in
  // tiles from the pointer to that cell's square (0 = inside it).
  function snapTarget(c, valid) {
    if (!valid || !valid.length) return null;
    var fx = c.fx != null ? c.fx : c.x + 0.5, fy = c.fy != null ? c.fy : c.y + 0.5;
    var best = null, bd = 1e9;
    for (var i = 0; i < valid.length; i++) {
      var v = valid[i];
      var dx = Math.max(v.x - fx, 0, fx - (v.x + 1)), dy = Math.max(v.y - fy, 0, fy - (v.y + 1));
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = v; }
    }
    return best ? { x: best.x, y: best.y, d: bd } : null;
  }
  function snapTol(c) { return c.inMap ? 0.3 : 0.6; }

  // ---------------------------------------------------------------- goals

  function renderGoals() {
    dom.goals.textContent = '';
    var types = WB.OBJECT_ORDER.filter(function (t) {
      return G.L.objects.some(function (o) { return o.type === t; });
    });
    types.forEach(function (type) {
      var li = el('li');
      var b = el('button', 'goal');
      b.type = 'button';
      b.setAttribute('data-type', type);
      var cv = el('canvas');
      cv.setAttribute('aria-hidden', 'true');
      R.icon(cv, 'object', type, 26);
      b.appendChild(cv);
      b.appendChild(el('span', 'goal-count'));
      b.addEventListener('click', function () { focusGoal(type); });
      b.addEventListener('animationend', function () { b.classList.remove('is-hello'); });
      li.appendChild(b);
      dom.goals.appendChild(li);
    });
    updateGoals();
  }

  function updateGoals() {
    var goals = currentSim().goals;
    var items = dom.goals.querySelectorAll('.goal');
    for (var i = 0; i < items.length; i++) {
      var b = items[i], type = b.getAttribute('data-type');
      var mine = goals.filter(function (g) { return g.type === type; });
      var ok = mine.filter(function (g) { return g.ok; }).length;
      var bad = mine.some(function (g) { return g.state === 'bad'; });
      var all = ok === mine.length;
      b.classList.toggle('is-done', all);
      b.classList.toggle('is-bad', bad && !all);
      var span = b.querySelector('.goal-count');
      var html = all ? CHECK_SVG + (mine.length > 1 ? mine.length : '') : ok + '/' + mine.length;
      if (span.innerHTML !== html) span.innerHTML = html;
      var name = WB.OBJECTS[type].name;
      b.setAttribute('aria-label', name + ': ' + ok + ' of ' + mine.length + ' happy' + (bad && !all ? ', ' + (mine.length > 1 ? 'one is unhappy' : 'unhappy') : '') + '. Show on the board');
      b.title = name + ' — ' + WB.OBJECTS[type].desc;
    }
    // the goals bar says it in words: what everyone wants, until the player's
    // moves make more of them happy than were happy at the start
    var okAll = goals.filter(function (g) { return g.ok; }).length, n = goals.length;
    var progress = okAll > G.startHappy;
    var say, cls = '';
    if (n && okAll === n) { say = n > 1 ? 'Everyone is happy!' : 'Happy!'; cls = 'is-done'; }
    else if (n === 1) say = WANT_ONE[goals[0].type] || 'Make it happy';
    else if (progress && n - okAll === 1) { say = 'Almost! One more to go'; cls = 'is-almost'; }
    else if (progress) say = okAll + ' of ' + n + ' happy';
    else say = wantLine(goals);
    if (dom.goalsSay.textContent !== say) dom.goalsSay.textContent = say;
    dom.goalsSay.className = 'goals-say' + (cls ? ' ' + cls : '');
  }
  function happyCount(sim) { return sim.goals.filter(function (g) { return g.ok; }).length; }
  // "Spin the pinwheel and keep the candle lit": what each kind of thing wants
  // (two kinds at most; more than that is "Make everyone happy")
  var WANT_SHORT = {
    pinwheel: ['spin the pinwheel', 'spin the pinwheels'], candle: ['keep the candle lit', 'keep the candles lit'],
    stove: ['clear the smoke', 'clear the smoke'], laundry: ['dry the laundry', 'dry the laundry'],
    papers: ['keep the papers still', 'keep the papers still'], fern: ['give the fern a gentle breeze', 'give the ferns a gentle breeze']
  };
  function wantLine(goals) {
    var count = {}, kinds = [];
    goals.forEach(function (g) { if (!count[g.type]) { count[g.type] = 0; kinds.push(g.type); } count[g.type]++; });
    if (!kinds.length || kinds.length > 2) return 'Make everyone happy';
    kinds.sort(function (a, b) { return WB.OBJECT_ORDER.indexOf(a) - WB.OBJECT_ORDER.indexOf(b); });
    var s = kinds.map(function (t) { return WANT_SHORT[t] ? WANT_SHORT[t][count[t] > 1 ? 1 : 0] : ''; }).join(' and ');
    // short enough for two lines beside the buttons on a phone
    return s && s.length <= 44 ? s.charAt(0).toUpperCase() + s.slice(1) : 'Make everyone happy';
  }
  // a goal chip says hello once (a new thing in the house)
  function helloGoal(type) {
    var b = dom.goals.querySelector('.goal[data-type="' + type + '"]');
    if (!b || reducedMotion()) return;
    b.classList.remove('is-hello');
    void b.offsetWidth;
    b.classList.add('is-hello');
  }

  // How a thing in the house is doing, in words: "blown out: a breeze crosses it".
  function objWords(g, sim) {
    var f = g.flow;
    switch (g.type) {
      case 'pinwheel': return g.ok ? 'spinning: a breeze reaches it' : 'still: it needs a breeze';
      case 'candle': return g.ok ? 'lit: the air is still' : 'blown out: a breeze crosses it';
      case 'stove':
        return g.state === 'happy' ? 'the smoke goes outside' : g.state === 'bad' ? 'smoke trapped: ' + trapReason(g, sim)
          : 'smoky: the smoke needs a breeze to carry it out';
      case 'laundry':
        return g.smoky ? 'dirty: smoky air blows through it' : g.ok ? 'drying: it gets ' + f : 'damp: it needs 2, and gets ' + (f || 'none');
      case 'papers': return g.ok ? 'in place: ' + (f ? 'a gentle breeze of 1' : 'still air') : 'scattered: 1 at most, and it gets ' + f;
      case 'fern':
        return g.ok ? 'happy: a gentle breeze of 1' : g.state === 'bad' ? 'battered: it needs 1, and gets ' + f : 'droopy: it needs a breeze of 1';
    }
    return g.ok ? 'happy' : 'not happy yet';
  }
  // what a kind of thing is called in "About candles ›"
  var ABOUT_NAME = { pinwheel: 'pinwheels', candle: 'candles', stove: 'stoves', laundry: 'laundry', papers: 'papers', fern: 'ferns' };
  // Why a stove's smoke counts as trapped: where its smoky air is stopped.
  function trapReason(g, sim) {
    var cx = g.x + 0.5, cy = g.y + 0.5, why = null;
    sim.trees.forEach(function (t) {
      if (why || !t.active) return;
      if (!t.segments.some(function (s) { return s.bx === cx && s.by === cy; })) return; // never reaches this stove
      t.ends.forEach(function (e) {
        if (why || e.type !== 'blocked') return;
        var sg = null;
        t.segments.forEach(function (s) { if (s.smoke && s.bx === e.x && s.by === e.y) sg = s; });
        if (!sg) return;
        var sx = Math.sign(sg.bx - sg.ax), sy = Math.sign(sg.by - sg.ay);
        // a wall face lies between two cells; a curtain stops air at its centre
        var atCentre = e.x % 1 !== 0 && e.y % 1 !== 0;
        var wx = Math.floor(atCentre ? e.x : e.x + 0.5 * sx), wy = Math.floor(atCentre ? e.y : e.y + 0.5 * sy);
        var p = playerAt(wx, wy) || fixedAt(wx, wy);
        if (p && p.type === 'window') why = 'it is blown into a window on the windy side, which pushes it back';
        else if (p && p.type === 'curtain') why = 'a curtain stops it';
        else why = 'it is blown into a wall';
      });
    });
    return why || 'it goes round in circles';
  }
  function goalText(g) { return WB.OBJECTS[g.type].name + ' — ' + objWords(g, G.sim); }
  function focusGoal(type) {
    var goals = G.sim.goals.filter(function (g) { return g.type === type; });
    var off = goals.filter(function (g) { return !g.ok; });
    G.focus = { type: type, t0: performance.now() };
    var g = off[0] || goals[0];
    if (!g) return;
    var txt = goalText(g);
    if (!off.length) txt = (goals.length > 1 ? 'All ' + goals.length + ' ' + WB.OBJECTS[type].name.toLowerCase() + ' are happy' : WB.OBJECTS[type].name + ' is happy') + ' · ' + NEED[type].replace(/^$/, 'smoke is cleared');
    else if (off.length > 1) txt += ' (' + off.length + ' unhappy)';
    // nearly there (thanks to the player's moves, not because it started that way): say so
    var left = G.sim.goals.filter(function (x) { return !x.ok; }).length;
    if (off.length && left === 1 && G.sim.goals.length > 1 && happyCount(G.sim) > G.startHappy) txt += '. Close! Just this one to go.';
    showToast(txt, null, null, { ms: usingTouch() ? 6000 : 4200, near: g });
  }

  function updateButtons() {
    dom.undo.disabled = G.history.length === 0;
    dom.redo.disabled = G.future.length === 0;
    dom.reset.disabled = G.pieces.length === 0;
    var hasSolution = Array.isArray(G.def.solution) && G.def.solution.length > 0;
    dom.hint.disabled = !hasSolution || G.won;
    var showNext = G.won && dom.win.hidden && !G.winCardTimer;
    var idx = levelIndex(G.id);
    var nxt = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    // "Next level" covers the tray (whose chips are hidden meanwhile), so the
    // hud and the board never move when it appears
    dom.next.hidden = !showNext;
    dom.trayWrap.classList.toggle('is-won', showNext);
    dom.nextLabel.textContent = nxt ? 'Next level' : 'Levels';
    dom.lvlDone.hidden = !isDone(G.id);
  }
  dom.next.addEventListener('click', function () {
    var idx = levelIndex(G.id);
    var nxt = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    if (nxt) { G.focusBoardOnOpen = true; navigate(nxt.id, true); } else goHome();
  });

  // ---------------------------------------------------------------- changes

  function snapshot() { return G.pieces.map(norm); }

  function commit(newPieces, opts) {
    opts = opts || {};
    if (!opts.noHistory) {
      G.history.push(snapshot());
      if (G.history.length > 200) G.history.shift();
      G.future = [];
    }
    G.pieces = newPieces;
    afterChange(opts);
  }

  function afterChange(opts) {
    opts = opts || {};
    G.version++;
    G.hintFollowed = !!opts.followed;
    G.sim = WB.simulate(G.L, allPieces());
    G.previewSim = null; G.previewKey = null;
    if (!opts.keepHint) {
      if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'hint') hideToast();
      G.hint = null;
      G.conflicts = null;
    }
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'reset') hideToast();
    rebuildDrawPieces();
    if (G.sel) {
      if (remaining(G.sel) <= 0) deselect();
      else G.valid = WB.placementCells(G.L, allPieces(), G.sel);
    }
    saveBoard();
    updateTray();
    updateGhostFromHover();
    updateGoals();
    updateButtons();
    checkWin();
    noteDirty();
    // a tip pinned to a piece goes with it
    if (G.coach && /^(turn|move)$/.test(G.coach.key || '') && !playerAt(G.coach.x, G.coach.y)) hideCoach();
    // a tip about a red × goes with the ×
    if (G.coach && G.coach.key === 'offpath' && !stallInfo(G.sim).end[G.coach.x + ',' + G.coach.y]) hideCoach();
    if (G.c1) c1Update(opts.placed || null);
    // progress, for the gentle "stuck? a hint is free"
    var hc = happyCount(G.sim);
    if (hc > G.best) { G.best = hc; G.sinceMoves = 0; G.sinceAt = performance.now(); }
    else if (++G.sinceMoves >= 8) maybeOfferHint();
    // the piece menu stays with its piece (a thing's menu says how it is doing now)
    if (G.pmenu) {
      var mp = G.pmenu.obj ? G.pmenu : playerAt(G.pmenu.x, G.pmenu.y);
      if (!mp || mp.type !== G.pmenu.type) hidePieceMenu(); else refreshPieceMenu();
    }
    // a card opened from an object says how that object is doing right now
    if (G.guide && G.guide.at && G.guide.built.status) G.guide.built.status.innerHTML = describe(G.guide.at.x, G.guide.at.y);
  }

  // Once ever: the first time a move leaves laundry dirty, say why.
  function noteDirty() {
    if (seenTip('dirty') || G.sim.solved) return;
    var g = null;
    G.sim.goals.forEach(function (x) { if (!g && x.smoky) g = x; });
    if (!g || !dom.toast.hidden || G.guide) return;
    store.seenTips.push('dirty');
    saveStore();
    var filter = metBy('filter', reachedLevel());
    showCoach(g.x, g.y, 'Smoky air made the laundry dirty. Send the smoke another way' + (filter ? ', or through a filter.' : '.'), { key: 'dirty', ms: 7000 });
  }

  function goalSummary() {
    var ok = G.sim.goals.filter(function (g) { return g.ok; }).length;
    return ok + ' of ' + G.sim.goals.length + ' happy.';
  }

  function place(type, x, y, d) {
    if (remaining(type) <= 0 || !WB.canPlace(G.L, allPieces(), type, x, y)) { nope(x, y); return false; }
    // placed right on the hint ghost: take the hinted rotation too
    var onHint = !!(G.hint && G.hint.x === x && G.hint.y === y && G.hint.type === type);
    if (onHint) d = G.hint.d;
    var p = { type: type, x: x, y: y, d: rotations(type) > 1 ? (d | 0) % rotations(type) : 0 };
    var first = G.pieces.length === 0;
    var stalledBefore = stalledInlets(G.sim).length;
    if (type === G.newTool) G.newToolUsed = true;
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'mount') hideToast();
    // placed on the hint: the next hint goes straight to the next piece
    commit(G.pieces.concat([p]), { placed: { type: type, x: x, y: y }, followed: onHint });
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
    announce(toolName(type) + ' placed. ' + goalSummary());
    coach(type, x, y, first, stalledBefore, onHint);
    return true;
  }

  // The player's piece `p` refers to, also when the board was rebuilt since
  // (undo, a turn) and `p` is an older copy: matched by type and cell.
  function livePiece(p) {
    if (!p) return null;
    if (G.pieces.indexOf(p) >= 0) return p;
    var q = playerAt(p.x, p.y);
    return q && q.type === p.type ? q : null;
  }

  function movePiece(p, x, y, d) {
    p = livePiece(p);
    if (!p) return;
    var nd = d == null ? p.d : d;
    // moved right onto the hint ghost: take the hinted rotation too
    var onHint = !!(G.hint && G.hint.x === x && G.hint.y === y && G.hint.type === p.type);
    if (onHint) nd = G.hint.d | 0;
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: x, y: y, d: nd } : q; });
    if (nd !== p.d) G.rot[p.type] = nd;
    commit(np, { followed: onHint });
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
    announce(toolName(p.type) + ' moved. ' + goalSummary());
  }

  function removePiece(p, selectAfter) {
    p = livePiece(p);
    if (!p) return;
    commit(G.pieces.filter(function (q) { return q !== p; }));
    Sound.whoosh();
    announce(toolName(p.type) + ' back in the tray. ' + goalSummary());
    if (selectAfter && remaining(p.type) > 0) select(p.type);
  }

  // Turns a piece one step, or to rotation `to`.
  function rotatePiece(p, to) {
    p = livePiece(p);
    if (!p) return;
    var nd = to == null ? WB.rotate(p.type, p.d) : to;
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: q.x, y: q.y, d: nd } : q; });
    G.rot[p.type] = nd;
    var followed = !!(G.hint && G.hint.x === p.x && G.hint.y === p.y && G.hint.d === nd);
    if (G.coach && G.coach.key === 'turn') hideCoach();
    commit(np, { followed: followed });
    G.pops[p.x + ',' + p.y] = performance.now();
    Sound.turn();
    announce(toolName(p.type) + ' turned. ' + goalSummary());
  }

  // A press on the board that has not become a drag yet is dropped when the
  // board changes under it (undo, redo, reset), so it never acts on a piece
  // that is gone.
  function dropPress() {
    if (I.press) { clearTimeout(I.press.timer); I.press = null; }
  }
  function undo() {
    if (!G.history.length || I.drag) return;
    dropPress();
    G.future.push(snapshot());
    G.pieces = G.history.pop();
    afterChange({});
    Sound.whoosh();
    announce('Undone. ' + goalSummary());
  }
  function redo() {
    if (!G.future.length || I.drag) return;
    dropPress();
    G.history.push(snapshot());
    G.pieces = G.future.pop();
    afterChange({});
    Sound.tick();
    announce('Redone. ' + goalSummary());
  }
  function resetLevel() {
    if (!G.pieces.length || I.drag) return;
    dropPress();
    commit([]);
    Sound.whoosh();
    // any later change hides this toast (afterChange), so its Undo always
    // undoes the reset itself
    showToast('Board cleared.', 'Undo', undo, { ms: 6000, kind: 'reset' });
  }

  function nope(x, y) {
    G.shake = { x: x, y: y, t0: performance.now() };
    if (!playerAt(x, y) && !fixedAt(x, y)) G.flash = { x: x, y: y, t0: performance.now() };
    Sound.nope();
  }

  // One-time tips after placing a piece, in a coach bubble pinned next to it:
  // a window that missed the breeze's path, turning a fan, moving pieces
  // (not on a level that brings something new: one voice at a time).
  function coach(type, x, y, firstOnBoard, stalledBefore, onHint) {
    if (G.sim.solved || G.c1) return;
    var touch = usingTouch();
    var msg = null, key = null, at = null;
    var wp = type === 'window' ? playerAt(x, y) : null;
    var off = wp && WB.windowRole(G.L, wp) === 'outlet' && !seenTip('offpath') && stalledBefore > 0 && stalledInlets(G.sim).length >= stalledBefore ? offpathTip(wp) : null;
    if (off) {
      key = 'offpath';
      msg = off.text;
      at = off;
    } else if (rotations(type) > 1 && !seenTip('turn') && !onHint) {
      key = 'turn';
      msg = (touch ? 'Tap' : 'Click') + ' it to turn it.';
    } else if (!seenTip('move') && !firstOnBoard && !G.levelGuide) {
      key = 'move';
      msg = touch ? 'Drag a piece to move it. Press and hold to take it away.' : 'Drag a piece to move it. Right-click to take it away.';
    }
    if (!msg || (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'hint')) return;
    clearTimeout(G.coachTimer);
    G.coachTimer = setTimeout(function () {
      if (G.screen !== 'game' || G.sim.solved || G.won || G.guide || !dom.toast.hidden) return;
      var p = playerAt(x, y);
      if (!p || p.type !== type) return; // already moved or gone
      if (at && !stallInfo(G.sim).end[at.x + ',' + at.y]) return; // that breeze found its way out meanwhile
      store.seenTips.push(key);
      saveStore();
      showCoach(at ? at.x : x, at ? at.y : y, msg, { key: key, ms: 6000 });
    }, key === 'offpath' ? 250 : 500);
  }

  // ---------------------------------------------------------------- win

  function checkWin() {
    clearTimeout(G.winTimer);
    if (!G.sim.solved) {
      if (G.won) { G.won = false; updateButtons(); }
      G.winAt = null;
      return;
    }
    if (G.won) return;
    var v = G.version, id = G.id;
    G.winTimer = setTimeout(function () {
      if (G.screen === 'game' && G.id === id && G.version === v && G.sim.solved && !I.drag) win();
    }, 350);
  }

  function win() {
    G.won = true;
    G.winAt = performance.now();
    G.chapterDoneBefore = !!G.chapter && chapterDone(G.chapter);
    markDone(G.id);
    if (G.levelGuide) markGuideSeen(G.levelGuide);
    G.newTool = null;
    forgetBoard(G.id);
    saveStore();
    resetInput();
    deselect();
    hideToast();
    hideTooltip();
    hidePieceMenu();
    hideCoach();
    clearTimeout(G.coachTimer);
    dom.hint.classList.remove('is-offer');
    G.hint = null; G.conflicts = null; G.cursor = null;
    Sound.chime();
    announce('Fresh air! Level ' + G.id + ' solved.');
    // the first level's last step: the happy ending, said where it happened
    var c1 = G.c1;
    if (c1) {
      clearTimeout(G.c1Timer);
      G.c1 = null;
      store.seenTips.push('coach1');
      saveStore();
      var ob = G.L.objects[0];
      if (ob && !G.guide) showCoach(ob.x, ob.y, C1_TEXT.done);
    }
    var id = G.id;
    clearTimeout(G.winCardTimer);
    G.winCardTimer = setTimeout(function () {
      G.winCardTimer = 0;
      if (G.screen === 'game' && G.id === id && G.won) showWinCard();
      else updateButtons();
    }, c1 ? (reducedMotion() ? 1500 : 2600) : reducedMotion() ? 300 : 1250);
    updateButtons();
  }

  function showWinCard() {
    closeDialog(dom.helpDlg, true);
    closeDialog(dom.confirm, true);
    hideCoach();
    var idx = levelIndex(G.id);
    var next = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    var allDone = LEVELS.every(function (l) { return isDone(l.id); });
    dom.winSub.textContent = 'Level ' + G.id + (G.def.name ? ' · ' + G.def.name : '') + ' solved';
    // chapter progress
    var ch = G.chapter;
    var complete = !!ch && !G.chapterDoneBefore && chapterDone(ch);
    dom.winTitle.textContent = complete ? 'Chapter complete!' : 'Fresh air!';
    dom.winDots.textContent = '';
    if (ch) {
      for (var n = ch.first; n <= ch.last; n++) {
        if (!levelById(n)) continue;
        var dot = el('i', (isDone(n) ? 'on' : '') + (n === G.id ? ' now' : ''));
        dom.winDots.appendChild(dot);
      }
    }
    dom.winDots.hidden = !ch;
    dom.winDots.classList.toggle('is-full', complete);
    // a finished chapter: a small, warm moment and what you can do now
    dom.winChapter.hidden = !complete;
    if (complete) {
      var it = chapterIntro(ch), card = it && guideFor(it.id);
      if (it) guideIcon(dom.winChapterIcon, it.id, 40); else R.icon(dom.winChapterIcon, 'pair', masteryPair(ch), 40);
      dom.winChapterName.textContent = ch.title + ': all done.';
      dom.winRecap.textContent = card && card.recap ? card.recap : 'Every house in it is full of fresh air.';
    }
    // what comes next: the next chapter's new thing (a tool or an object), or its challenge
    var nch = next ? chapterOf(next.id) : null, tease = null;
    if (nch && nch !== ch && nch.first === next.id) {
      var nit = chapterIntro(nch);
      var lead = complete ? 'Next: ' : 'Next chapter: ';
      if (nit) {
        guideIcon(dom.winTeaserIcon, nit.id, 34);
        tease = lead + '<b class="nw">meet the ' + esc(lowerName(nit.id)) + '</b>';
      } else {
        R.icon(dom.winTeaserIcon, 'pair', masteryPair(nch), 34);
        tease = lead + '<b>' + esc(nch.title) + '</b>, a challenge: ' + esc(chapterTheme(nch, masteryPair(nch)));
      }
    }
    dom.winTeaser.hidden = !tease;
    if (tease) dom.winTeaserText.innerHTML = tease;
    var last = !next;
    dom.winFinal.hidden = !last;
    dom.winFinal.textContent = allDone
      ? 'You finished all ' + LEVELS.length + ' levels. Thank you for playing — every room is full of fresh air.'
      : 'That was the last level! A few earlier rooms are still waiting for a breeze.';
    dom.winNext.hidden = last;
    dom.winLevels.classList.toggle('btn-primary', last);
    dom.winNext.onclick = next ? function () { closeDialog(dom.win, true); G.focusBoardOnOpen = true; navigate(next.id, true); } : null;
    openDialog(dom.win, last ? dom.winLevels : dom.winNext);
    updateButtons();
  }
  dom.winLevels.addEventListener('click', function () { closeDialog(dom.win, true); goHome(); });
  dom.win.addEventListener('click', function (e) { if (e.target === dom.win) closeDialog(dom.win); });

  function goHome() {
    if (G.pushedFromHome && history.state && history.state.id != null && history.state.id === G.id) {
      G.pushedFromHome = false;
      history.back();
      return;
    }
    G.pushedFromHome = false;
    navigate(null, true);
  }

  // ---------------------------------------------------------------- hint
  //
  // A hint goes one small step per press, never the whole answer at once:
  //   1. an idea, in words, about what is wrong (with "Show me" for step 2);
  //   2. one piece: where the next one goes (a ghost), the piece in the way,
  //      or the one that needs a turn.
  // The steps start again when the player changes the board; after following
  // a hint (placing or turning the hinted piece), the next press goes straight
  // to the next piece. Hints are free: nothing counts against the player.

  // The thinking (what differs from the reference solution, and the idea to
  // say first) is in js/hints.js (WB.Hints); this part shows it.
  function boardKey() { return G.pieces.map(function (p) { return key4(p); }).sort().join(';'); }
  function key4(p) { return p.type + '@' + p.x + ',' + p.y + '/' + (p.d | 0); }
  function hintPlan() { return Hints.plan(G.L, G.def, G.pieces); }
  function hintIdea(plan) { return Hints.idea(G.L, G.pieces, G.sim, plan, { name: lowerName }); }
  // which way a piece points, for the hint's words
  function hintHow(p) {
    if (p.type === 'fan') return ', blowing ' + dirWords(p.d);
    if (p.type === 'deflector') return p.d === 0 ? ', slanted like /' : ', slanted like \\';
    return '';
  }

  function hint() {
    if (dom.hint.disabled || dom.hint.hidden) return;
    var sol = (G.def.solution || []).map(norm);
    hideTooltip();
    hidePieceMenu();
    hideCoachTip();
    closeGuide({ silent: true }); // one voice: the hint speaks now
    dom.hint.classList.remove('is-offer');
    G.offered = true; // asked for help: no need to offer it
    if (!sol.length) { showToast('No hint for this one. Try things out!'); return; }
    if (G.sim.solved) { showToast('Everything is already happy.'); return; }
    var bk = boardKey();
    if (G.hintBoard !== bk) G.hintStep = G.hintFollowed ? 1 : 0;
    G.hintBoard = bk;
    var plan = hintPlan();
    var tap = usingTouch() ? 'Tap' : 'Click';

    if (G.hintStep === 0) {
      // step 1: just an idea
      G.hintStep = 1;
      G.hint = null;
      G.conflicts = null;
      var idea = hintIdea(plan);
      var text = idea.text;
      if (!seenTip('hintfree')) {
        store.seenTips.push('hintfree');
        saveStore();
        text = 'Hints are free! ' + text;
      }
      // ring what the words are about: a thing in the house, or the spot where a breeze stops
      if (idea.focus) G.focus = { type: idea.focus.type, t0: performance.now() };
      else if (idea.at) G.focus = { cell: { x: idea.at.x, y: idea.at.y }, t0: performance.now() };
      showToast(text, 'Show me', function () { hint(); }, { kind: 'hint', ms: 14000, near: idea.focus || idea.at || null });
      return;
    }

    // step 2: one piece
    if (plan.turns.length) {
      var tp = plan.turns[0];
      G.hint = tp;
      G.conflicts = null;
      showToast('Try turning this ' + lowerName(tp.type) + '. ' + tap + ' it to turn it.', null, null, { kind: 'hint', ms: 9000, near: tp });
      return;
    }
    // a piece the answer needs, in the wrong spot: where it goes, with an arrow from where it is
    if (plan.moves.length) {
      var mv = plan.moves[0];
      G.hint = { type: mv.to.type, x: mv.to.x, y: mv.to.y, d: mv.to.d, from: { x: mv.from.x, y: mv.from.y } };
      G.conflicts = null;
      showToast('Move your ' + lowerName(mv.to.type) + ' here' + hintHow(mv.to) + '. Drag it, or ' + tap.toLowerCase() + ' this spot.', null, null,
        { kind: 'hint', ms: 10000, near: mv.to });
      return;
    }
    if (plan.conflicts.length) {
      var conflicts = plan.conflicts;
      // a piece that makes something happy right now is never marked like a mistake
      var helps = conflicts.filter(function (p) { return plan.helping.indexOf(p) >= 0; }).length === conflicts.length;
      G.hint = null;
      G.conflicts = conflicts.map(function (p) { return { x: p.x, y: p.y, soft: plan.helping.indexOf(p) >= 0 }; });
      var say = conflicts.length === 1
        ? (helps ? 'You won\u2019t need that one in the end. Put it back?' : 'That one isn\u2019t needed here. Put it back?')
        : (helps ? 'You won\u2019t need these ' + conflicts.length + ' in the end. Put them back?' : 'These ' + conflicts.length + ' aren\u2019t needed here. Put them back?');
      showToast(say, 'Put back', function () {
        commit(G.pieces.filter(function (p) { return conflicts.indexOf(p) < 0; }), { followed: true });
        Sound.whoosh();
        hint();
      }, { kind: 'hint', ms: 12000, near: conflicts[0] });
      return;
    }
    var nextP = plan.next;
    if (nextP) {
      G.hint = nextP;
      G.conflicts = null;
      var canTap = remaining(nextP.type) > 0 && WB.canPlace(G.L, allPieces(), nextP.type, nextP.x, nextP.y);
      // following it makes something unhappy for a moment: say so first
      var worse = plan.nextSim && plan.nextSim.goals.some(function (g, i) { return g.state === 'bad' && G.sim.goals[i].state !== 'bad'; });
      showToast('Try a ' + lowerName(nextP.type) + ' here' + hintHow(nextP) + '.' + (canTap ? ' ' + tap + ' it to place it.' : '') +
        (worse ? ' It may look wrong until the next piece.' : ''), null, null, { kind: 'hint', ms: 9000, near: nextP });
    }
  }

  // ---------------------------------------------------------------- "stuck? a hint is free"
  //
  // After about a minute, or 8 moves, with nothing new becoming happy, the Hint
  // button glows softly (once a level), and the first time in a visit a toast
  // says hints are free. It never shows the answer by itself.

  function armStuck() {
    clearTimeout(G.stuckTimer);
    G.stuckTimer = setTimeout(checkStuck, 5000);
  }
  function stuckBusy() {
    return G.screen !== 'game' || document.hidden || !!G.guide || !!G.c1 || !dom.helpDlg.hidden || !dom.settings.hidden || !!I.drag;
  }
  function checkStuck() {
    if (G.screen !== 'game') return;
    G.stuckTimer = setTimeout(checkStuck, 5000);
    if (stuckBusy()) { G.sinceAt += 5000; return; } // time with a card or Help open does not count
    if (performance.now() - G.sinceAt >= 60000) maybeOfferHint();
  }
  function maybeOfferHint() {
    if (G.offered || G.won || G.sim.solved || dom.hint.disabled || stuckBusy()) return;
    if (!dom.toast.hidden || coachShowing() || G.hint || G.conflicts) return; // something is already talking: later
    G.offered = true;
    dom.hint.classList.remove('is-offer');
    void dom.hint.offsetWidth;
    dom.hint.classList.add('is-offer');
    var once = false;
    try { once = window.sessionStorage.getItem('windbreaker.hintOffer') === '1'; } catch (e) { once = sessionOffered; }
    if (!once && !sessionOffered) {
      sessionOffered = true;
      try { window.sessionStorage.setItem('windbreaker.hintOffer', '1'); } catch (e) { /* ignore */ }
      showToast('Stuck? A hint is free, and there is no penalty.', 'Hint', function () { hint(); }, { kind: 'offer', ms: 9000 });
    }
  }
  dom.hint.addEventListener('animationend', function () { dom.hint.classList.remove('is-offer'); });

  // ---------------------------------------------------------------- toast / tooltip

  function showToast(text, actionLabel, actionFn, opts) {
    opts = opts || {};
    clearTimeout(G.toastTimer);
    if (opts.kind !== 'coach') clearTimeout(G.coachTimer); // coaching never replaces a real message
    dom.toastText.textContent = text;
    dom.toast.setAttribute('data-kind', opts.kind || 'info');
    if (actionLabel) {
      dom.toastAction.hidden = false;
      dom.toastAction.textContent = actionLabel;
      dom.toastAction.onclick = function () { hideToast(); actionFn(); };
    } else {
      dom.toastAction.hidden = true;
      dom.toastAction.onclick = null;
    }
    // keep the toast away from the cell it talks about
    var top = !!(opts.near && G.L && opts.near.y >= G.L.h / 2);
    dom.toast.classList.toggle('at-top', top);
    dom.toast.hidden = false;
    renderCoach(); // a coach bubble waits while a toast speaks
    armToast(opts.ms || (actionLabel ? 9000 : 5000));
  }
  // A toast fades after a while, but never from under keyboard focus or a
  // hovering pointer: it waits, and tries again.
  function armToast(ms) {
    clearTimeout(G.toastTimer);
    G.toastTimer = setTimeout(function () {
      if (dom.toast.hidden) return;
      if (dom.toast.contains(document.activeElement) || dom.toast.matches(':hover')) { armToast(3000); return; }
      hideToast();
    }, ms);
  }
  function hideToast() {
    clearTimeout(G.toastTimer);
    var was = !dom.toast.hidden;
    var hadFocus = was && dom.toast.contains(document.activeElement);
    dom.toast.hidden = true;
    G.conflicts = null;
    if (was) renderCoach();
    // focus was on its button: back to the board, not to the top of the page
    if (hadFocus && G.screen === 'game') dom.canvas.focus({ preventScroll: true });
  }
  dom.toastClose.addEventListener('click', function () { hideToast(); G.hint = null; });

  function objectAt(x, y) {
    var objs = G.L.objects;
    for (var i = 0; i < objs.length; i++) if (objs[i].x === x && objs[i].y === y) return i;
    return -1;
  }

  function currentSim() {
    if (G.previewSim) return G.previewSim;
    if (I.drag) return G.dragBaseSim || G.sim;
    return G.sim;
  }

  // A fan pointing straight into the wall next to it: its breeze stops at once.
  function fanIntoWall(sim, p) {
    var fx = p.x + 0.5 + WB.DX[p.d] * 0.5, fy = p.y + 0.5 + WB.DY[p.d] * 0.5, hit = false;
    sim.trees.forEach(function (t) {
      if (hit || t.kind !== 'fan' || t.source.x !== p.x || t.source.y !== p.y) return;
      t.ends.forEach(function (e) { if (e.type === 'blocked' && Math.abs(e.x - fx) < 1e-6 && Math.abs(e.y - fy) < 1e-6) hit = true; });
    });
    return hit;
  }

  // How strong a fan's own stream is when it loops back into the fan's cell
  // (0 when it never comes back).
  function ownFlowAt(sim, p) {
    var own = 0, cx = p.x + 0.5, cy = p.y + 0.5;
    sim.trees.forEach(function (t) {
      if (t.kind !== 'fan' || t.source.x !== p.x || t.source.y !== p.y) return;
      t.segments.forEach(function (s) { if (s.bx === cx && s.by === cy && s.s > own) own = s.s; });
    });
    return own;
  }

  // Cells on the path of a stalled breeze (its dashed line) and where it stops
  // (its red ×), cached on the simulation result.
  function stallInfo(sim) {
    if (sim._wbStall) return sim._wbStall;
    var out = { path: {}, end: {}, first: null, cells: [] };
    var A = R.analyze(sim, G.L);
    A.stalled.forEach(function (st) {
      out.path[Math.floor((st.hx + WB.DX[st.d] * 0.5) / 2) + ',' + Math.floor((st.hy + WB.DY[st.d] * 0.5) / 2)] = true;
    });
    // the red × sits just inside the wall (or window) that stops the breeze (see js/hints.js)
    out.cells = Hints.stallCells(G.L, sim);
    out.cells.forEach(function (c) { out.end[c.x + ',' + c.y] = true; });
    out.first = out.cells[0] || null;
    sim._wbStall = out;
    return out;
  }

  // What is at (x,y), and how much air reaches it. withActions adds a dim
  // line telling a mouse user what they can do with their own pieces.
  function describe(x, y, withActions) {
    var L = G.L, sim = currentSim();
    var ch = WB.cellAt(L, x, y);
    var floorish = WB.isFloorish(ch);
    var f = floorish ? sim.flow[y * L.w + x] : 0;
    var p = playerAt(x, y), fixed = false;
    if (!p) { p = fixedAt(x, y); fixed = !!p; }
    var flowBit = function () { return ' <span class="tt-dim">· ' + breezeWord(f) + '</span>'; };
    if (p) {
      var name = toolName(p.type), s = '';
      switch (p.type) {
        case 'window':
          if (WB.windowRole(L, p) === 'inlet') {
            var tr = null;
            sim.trees.forEach(function (t) { if (t.kind === 'inlet' && t.source.x === p.x && t.source.y === p.y) tr = t; });
            s = 'on the windy side: lets the wind in' + (tr && !tr.active ? ' <span class="tt-dim">· no way out yet</span>' : '');
          } else s = 'lets air out';
          break;
        // a source reports what it sends out: its own 1, plus the air of other
        // sources it pushes on (its own stream coming round again adds nothing)
        case 'fan':
          s = 'blowing ' + dirWords(p.d) + (fanIntoWall(sim, p) ? ' <span class="tt-dim">· straight into the wall, so no breeze</span>'
            : ' <span class="tt-dim">· pushes a breeze of ' + (f - ownFlowAt(sim, p) + 1) + '</span>');
          break;
        case 'deflector': s = 'turns air round a corner' + flowBit(); break;
        case 'curtain': s = 'makes air 1 weaker' + flowBit(); break;
        case 'vent': s = 'lets air through the wall'; break;
        case 'splitter': s = 'splits air out to both sides' + flowBit(); break;
        case 'extractor': s = 'lets air out, and pulls a gentle breeze'; break;
        case 'skylight': s = 'lets air out through the roof'; break;
        case 'filter': s = 'cleans the smoke out of the air' + flowBit(); break;
        case 'ceilingfan': s = 'a gentle breeze every way' + (f ? ' <span class="tt-dim">· ' + f + ' passes beneath</span>' : ''); break;
      }
      var html = '<b>' + name + '</b> — ' + s + (fixed ? ' <span class="tt-dim">· part of the house</span>' : '');
      if (withActions && !fixed) {
        html += '<span class="tt-act">' + (rotations(p.type) > 1 ? 'click to turn' : 'click for more') + ' · drag to move · right-click to put back</span>';
      }
      return html;
    }
    var oi = objectAt(x, y);
    if (oi >= 0) {
      var ob = L.objects[oi], g = sim.goals[oi];
      return '<b>' + WB.OBJECTS[ob.type].name + '</b> — ' + esc(objWords(g, sim)) +
        (withActions ? '<span class="tt-act">click to learn more</span>' : '');
    }
    // where a breeze is stuck: the dashed line and its red ×, explained
    var stuck = stallInfo(sim);
    var outFit = ch === '#' && WB.outwardDir(L, x, y) >= 0 ? wallTools() : '';
    if (stuck.end[x + ',' + y]) {
      return '<b>No way out</b> — the breeze stops at this wall' +
        (outFit ? ' <span class="tt-dim">· ' + outFit + ' here would let it out</span>' : '');
    }
    // smoky air blown into this wall
    if (WB.isWall(ch) && smokeHits(sim, x, y)) {
      return '<b>' + (ch === '%' ? 'Hatched wall' : 'Wall') + '</b> — the smoke hits this wall: no way out' +
        (outFit ? ' <span class="tt-dim">· ' + outFit + ' here would let it out</span>' : '');
    }
    if (ch === '.') return '<b>Floor</b> — ' + breezeWord(f) + (stuck.path[x + ',' + y] && !f ? ' <span class="tt-dim">· the dashed breeze is waiting for a way out</span>' : '');
    if (ch === 'o') return '<b>Table</b> — air passes over <span class="tt-dim">· ' + breezeWord(f) + ' · nothing can be placed here</span>';
    if (ch === '%') return '<b>Hatched wall</b> <span class="tt-dim">· nothing fits in it</span>';
    if (ch === '#') {
      if (WB.outwardDir(L, x, y) >= 0) return '<b>Outside wall</b>' + (outFit ? ' <span class="tt-dim">· ' + outFit + ' fits here</span>' : '');
      var inner = true;
      for (var d = 0; d < 4; d++) if (WB.isOutside(WB.cellAt(L, x + WB.DX[d], y + WB.DY[d]))) inner = false;
      return inner ? '<b>Inside wall</b>' : '<b>Wall</b>';
    }
    var w = L.wind;
    return '<b>Garden</b> — ' + (w.strength > 0 ? 'the wind blows from ' + FROM_SIDE[w.from] + ' <span class="tt-dim">· ' + STRENGTH_WORD[Math.min(3, w.strength)] + '</span>' : 'a calm day, no wind');
  }

  // "a window", "a window or an extractor": what of this level's tools fits in an outside wall
  function wallTools() {
    var ts = trayTypes().filter(function (t) { return WB.TOOLS[t].mount === 'exterior'; });
    return ts.map(function (t) { return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + lowerName(t); }).join(' or ');
  }
  // Does smoky air run into the wall at (x,y)?
  function smokeHits(sim, x, y) {
    var A = R.analyze(sim, G.L);
    return A.blockEnds.some(function (be) {
      return be.smoke && be.d >= 0 && Math.floor(be.x + be.dx * 0.25) === x && Math.floor(be.y + be.dy * 0.25) === y;
    });
  }

  // Places a floating box (the tooltip or a coach bubble) next to cell (x,y):
  // above it, else below. With `avoid` (a touch turn, where the player wants to
  // see what changed, or a coach bubble) it takes the spot around the cell that
  // hides the fewest objects, pieces and streams. Returns where it went.
  function placeNear(box, x, y, avoid, gap) {
    gap = gap || 6;
    var rect = board.cellRect(x, y);
    var ox = dom.canvas.offsetLeft, oy = dom.canvas.offsetTop, T = rect.size;
    var cx = ox + rect.left + T / 2;
    var top = oy + rect.top;
    box.style.left = '0px';
    box.style.top = '0px';
    var w = box.offsetWidth, h = box.offsetHeight;
    var sw = dom.stage.clientWidth, sh = dom.stage.clientHeight;
    var cands = [{ l: cx - w / 2, t: top - h - gap, s: 'above' }, { l: cx - w / 2, t: top + T + gap, s: 'below' }];
    if (avoid) {
      cands.push({ l: ox + rect.left + T + gap, t: top + T / 2 - h / 2, s: 'right' });
      cands.push({ l: ox + rect.left - w - gap, t: top + T / 2 - h / 2, s: 'left' });
      cands.push({ l: cx - w / 2, t: top - T - h - gap, s: 'above' });
      cands.push({ l: cx - w / 2, t: top + 2 * T + gap, s: 'below' });
      // last resort: just outside the house, above or below it
      cands.push({ l: cx - w / 2, t: oy + board.oy - h - gap, s: 'above' });
      cands.push({ l: cx - w / 2, t: oy + board.oy + G.L.h * T + gap, s: 'below' });
    }
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      c.l = Math.max(8, Math.min(sw - w - 8, c.l));
      var cost = (c.t >= 4 && c.t + h <= sh - 4 ? 0 : 1000) + i * 0.5;
      // a box beside the cell must not slide over it
      if ((c.s === 'right' && c.l < ox + rect.left + T) || (c.s === 'left' && c.l + w > ox + rect.left)) cost += 500;
      if (avoid) cost += coverCost(c.l - ox, c.t - oy, w, h, box === dom.coach);
      if (!best || cost < best.cost) best = { l: c.l, t: c.t, s: c.s, cost: cost };
    }
    var t = Math.max(4, Math.min(sh - h - 4, best.t));
    box.style.left = best.l + 'px';
    box.style.top = t + 'px';
    return { l: best.l, t: t, w: w, h: h, side: best.s, cx: cx, cy: top + T / 2 };
  }
  // Shows the tooltip next to a cell, for `ms` (0: until hidden). Never while
  // a card or a coach bubble is speaking.
  function showTooltipAt(x, y, html, ms, avoid) {
    if (G.guide || coachShowing()) return;
    var tt = dom.tooltip;
    tt.innerHTML = html;
    tt.hidden = false;
    G.tipAt = { x: x, y: y };
    placeNear(tt, x, y, avoid, 6);
    clearTimeout(G.tipTimer);
    if (ms) G.tipTimer = setTimeout(hideTooltip, ms);
  }
  // How much of the board a box (canvas px) hides: objects matter most, then
  // pieces, then cells with air moving through them.
  // A coach bubble also keeps off the house where it can, and off the spots
  // where the selected tool could go.
  function coverCost(l, t, w, h, coach) {
    var L = G.L, T = board.T, sim = G.sim, cost = 0;
    var valid = coach && (I.drag ? I.drag.valid : G.valid);
    var x0 = Math.floor((l - board.ox) / T), x1 = Math.floor((l + w - board.ox) / T);
    var y0 = Math.floor((t - board.oy) / T), y1 = Math.floor((t + h - board.oy) / T);
    for (var y = Math.max(0, y0); y <= Math.min(L.h - 1, y1); y++) {
      for (var x = Math.max(0, x0); x <= Math.min(L.w - 1, x1); x++) {
        var cl = board.ox + x * T, ct = board.oy + y * T;
        var ow = Math.min(cl + T, l + w) - Math.max(cl, l), oh = Math.min(ct + T, t + h) - Math.max(ct, t);
        if (ow <= 0 || oh <= 0) continue;
        var frac = (ow * oh) / (T * T);
        // hiding any part of an object (its sprite, dot or meter) is the worst
        if (objectAt(x, y) >= 0) cost += 12 + 24 * frac;
        else if (playerAt(x, y) || fixedAt(x, y)) cost += 6 * frac;
        else if (WB.isFloorish(WB.cellAt(L, x, y)) && sim.flow[y * L.w + x] > 0) cost += 2 * frac;
        if (coach) cost += (isValidCell(valid, x, y) ? 5 : 1) * frac;
      }
    }
    return cost;
  }
  function hideTooltip() {
    clearTimeout(G.tipTimer);
    clearTimeout(G.hoverTimer);
    dom.tooltip.hidden = true;
    G.tipAt = null;
  }

  var MOUNT_HELP = {
    exterior: 'goes in an outside wall',
    floor: 'goes on an empty bit of floor',
    interior: 'goes in an inside wall, between two rooms'
  };
  // Where a tool can go, in words, with its spots lit up.
  function mountHelp(type) {
    var t = WB.TOOLS[type || G.sel];
    if (!t) return;
    G.pulse = performance.now();
    if (G.guide) return; // the card beside the board already explains it
    showToast('The ' + t.name.toLowerCase() + ' ' + MOUNT_HELP[t.mount] + '. Try a glowing spot.', null, null, { ms: usingTouch() ? 4500 : 3200, kind: 'mount' });
  }
  // After a drop that missed, the spots where it fits stay lit for a moment.
  function lingerSpots(type, valid) {
    if (!valid || !valid.length) return;
    G.linger = { valid: valid, wall: isWallMount(type), type: type, t0: performance.now() };
    G.pulse = performance.now();
    clearTimeout(G.lingerTimer);
    G.lingerTimer = setTimeout(function () { G.linger = null; }, 1700);
  }
  // How long a tooltip stays: on touch, long enough to read (the next tap anywhere also closes it).
  function tipMs(ms, html) {
    if (!usingTouch()) return ms;
    return Math.max(6000, (html ? plainText(html).length : 0) * 60);
  }

  // ---------------------------------------------------------------- a tapped piece
  //
  // Tapping your own piece never takes it away by surprise. A piece that turns
  // turns (and says how it points now); any other piece shows a small menu with
  // what it does and "Put back" (Delete, a right-click, a long-press or a drag
  // off the board still take a piece away at once).

  // p: a placed piece, or { x, y, type, obj: true } for a thing in the house
  function showPieceMenu(p, ms) {
    if (!p || G.guide) return;
    hideTooltip();
    // one voice: the menu speaks now (a hint about this piece would say the same with another button)
    if (!dom.toast.hidden && dom.toast.getAttribute('data-kind') !== 'reset') hideToast();
    hideCoachTip();
    var obj = !!p.obj;
    G.pmenu = { x: p.x, y: p.y, type: p.type, obj: obj };
    dom.pmenuTurn.hidden = obj || rotations(p.type) < 2;
    dom.pmenuRemove.hidden = obj;
    dom.pmenuAbout.hidden = !obj;
    dom.pmenu.setAttribute('aria-label', obj ? WB.OBJECTS[p.type].name : toolName(p.type));
    if (obj) {
      dom.pmenuAboutLabel.textContent = 'About ' + (ABOUT_NAME[p.type] || lowerName(p.type));
      dom.pmenuAbout.setAttribute('aria-label', 'About ' + (ABOUT_NAME[p.type] || lowerName(p.type)) + ': open its card');
    }
    refreshPieceMenu();
    dom.pmenu.hidden = false;
    placeNear(dom.pmenu, p.x, p.y, true, 8);
    armPieceMenu(ms || 9000);
  }
  // The menu fades after a while, but never from under keyboard focus or a
  // hovering pointer: it waits, and tries again.
  function armPieceMenu(ms) {
    clearTimeout(G.pmenuTimer);
    G.pmenuTimer = setTimeout(function () {
      if (!G.pmenu) return;
      if (dom.pmenu.contains(document.activeElement) || dom.pmenu.matches(':hover')) { armPieceMenu(3000); return; }
      hidePieceMenu();
    }, ms);
  }
  function refreshPieceMenu() {
    if (!G.pmenu) return;
    var html = describe(G.pmenu.x, G.pmenu.y);
    if (dom.pmenuText.innerHTML !== html) dom.pmenuText.innerHTML = html;
    if (!G.pmenu.obj) dom.pmenuRemove.setAttribute('aria-label', 'Put the ' + lowerName(G.pmenu.type) + ' back in the tray');
  }
  function hidePieceMenu() {
    clearTimeout(G.pmenuTimer);
    if (!G.pmenu && dom.pmenu.hidden) return;
    var hadFocus = dom.pmenu.contains(document.activeElement);
    G.pmenu = null;
    dom.pmenu.hidden = true;
    // focus was in the menu: it goes back to the board, not to the top of the page
    if (hadFocus && G.screen === 'game') dom.canvas.focus({ preventScroll: true });
  }
  dom.pmenuRemove.addEventListener('click', function () {
    var m = G.pmenu;
    hidePieceMenu();
    var p = m && playerAt(m.x, m.y);
    if (!p || boardLocked()) return;
    removePiece(p, true);
    showTooltipAt(m.x, m.y, '<b>' + toolName(p.type) + '</b> — back in your tray', tipMs(1600));
  });
  dom.pmenuAbout.addEventListener('click', function () {
    var m = G.pmenu;
    if (!m || !m.obj || boardLocked()) return;
    var kb = dom.pmenu.contains(document.activeElement);
    hidePieceMenu();
    openGuide(m.type, { at: { x: m.x, y: m.y }, focus: kb });
  });
  dom.pmenuTurn.addEventListener('click', function () {
    var m = G.pmenu;
    var p = m && playerAt(m.x, m.y);
    if (!p || boardLocked()) return;
    rotatePiece(p);
    refreshPieceMenu();
  });
  // a tap on the menu's words closes it
  dom.pmenu.addEventListener('click', function (e) { if (e.target === dom.pmenu || dom.pmenuText.contains(e.target)) hidePieceMenu(); });

  // ---------------------------------------------------------------- board input

  function boardLocked() {
    return G.screen !== 'game' || !dom.win.hidden || !!G.winCardTimer;
  }

  function onBoardDown(e) {
    if (boardLocked() || !e.isPrimary) return;
    Sound.unlock();
    if (G.c1 && G.c1.step === 'in') c1Step('out');
    G.cursor = null;
    var c = board.pick(e.clientX, e.clientY);
    if (e.button === 2) {
      e.preventDefault();
      var rp = c.inMap ? playerAt(c.x, c.y) : null;
      if (rp) removePiece(rp, false);
      else if (c.inMap && fixedAt(c.x, c.y)) fixedTap(c.x, c.y);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (I.press || I.drag) return;
    try { dom.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    I.press = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, cell: c, type: e.pointerType,
      piece: c.inMap ? playerAt(c.x, c.y) : null, longFired: false, timer: 0,
      // the tooltip already says this cell: a second tap closes it
      hadTip: !dom.tooltip.hidden && !!G.tipAt && G.tipAt.x === c.x && G.tipAt.y === c.y
    };
    if (G.pmenu && !(c.inMap && c.x === G.pmenu.x && c.y === G.pmenu.y)) hidePieceMenu();
    if (e.pointerType !== 'mouse') I.press.timer = setTimeout(onLongPress, 450);
    hideTooltip();
  }

  function onLongPress() {
    var pr = I.press;
    if (!pr || G.screen !== 'game' || boardLocked()) return;
    pr.longFired = true;
    var c = pr.cell;
    pr.piece = livePiece(pr.piece);
    if (pr.piece) {
      hidePieceMenu();
      removePiece(pr.piece, false);
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
      showTooltipAt(c.x, c.y, '<b>' + toolName(pr.piece.type) + '</b> — back in your tray <span class="tt-dim">· Undo brings it back</span>', tipMs(1600));
    } else if (c.inMap || c.onCanvas) {
      showTooltipAt(clamp(c.x, -1, G.L.w), clamp(c.y, -1, G.L.h), describe(c.x, c.y), 0);
    }
  }

  function onBoardMove(e) {
    if (G.screen !== 'game') return;
    if (I.drag) return; // handled by the window listener
    var pr = I.press;
    if (pr && pr.id === e.pointerId) {
      var dist = Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0);
      var slop = pr.type === 'mouse' ? 6 : 11;
      if (dist > slop && !pr.longFired) {
        clearTimeout(pr.timer);
        pr.piece = livePiece(pr.piece); // the board may have changed under the press (a key)
        if (pr.piece) {
          I.press = null;
          var cr = dom.canvas.getBoundingClientRect(), rc = board.cellRect(pr.piece.x, pr.piece.y);
          startDrag({
            kind: 'move', piece: pr.piece, type: pr.piece.type, d: pr.piece.d, pointerId: e.pointerId, ptype: e.pointerType,
            x0: pr.x0, y0: pr.y0, gx: cr.left + rc.left + rc.size / 2 - pr.x0, gy: cr.top + rc.top + rc.size / 2 - pr.y0, travel: 0
          }, e);
          return;
        }
      }
      if (pr.longFired && !pr.piece) {
        var cc = board.pick(e.clientX, e.clientY);
        if (cc.inMap) showTooltipAt(cc.x, cc.y, describe(cc.x, cc.y), 0);
      }
    }
    if (e.pointerType === 'mouse') setHover(board.pick(e.clientX, e.clientY));
  }

  function onBoardUp(e) {
    if (I.drag) return;
    var pr = I.press;
    if (!pr || pr.id !== e.pointerId) return;
    I.press = null;
    clearTimeout(pr.timer);
    if (boardLocked()) return;
    if (pr.longFired) {
      if (!pr.piece) { clearTimeout(G.tipTimer); G.tipTimer = setTimeout(hideTooltip, tipMs(1200, dom.tooltip.innerHTML)); }
      return;
    }
    var c = board.pick(e.clientX, e.clientY);
    // a slightly sloppy tap still counts for the cell it started on
    if (c.x !== pr.cell.x || c.y !== pr.cell.y) {
      if (Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) > 14) return;
      c = pr.cell;
    }
    tapCell(c, pr.type, pr.hadTip);
  }

  function onBoardCancel(e) {
    if (I.press && I.press.id === e.pointerId) {
      clearTimeout(I.press.timer);
      I.press = null;
    }
  }

  function onBoardLeave(e) {
    if (e.pointerType === 'mouse') {
      G.hover = null;
      if (!I.drag) { G.ghost = null; updatePreview(); }
      clearTimeout(G.hoverTimer);
      if (!I.press) hideTooltip();
      updateCursorStyle();
    }
  }

  function tapCell(c, ptype, hadTip) {
    var pp = c.inMap ? playerAt(c.x, c.y) : null, fp = c.inMap ? fixedAt(c.x, c.y) : null;
    // a tap on the hint ghost places the hinted piece, turned the hinted way
    var hp = G.hint;
    if (hp && c.inMap && c.x === hp.x && c.y === hp.y && !pp && !fp && (!G.sel || G.sel === hp.type)) {
      // a hinted move: the piece comes over from where it is
      var mp = hp.from ? playerAt(hp.from.x, hp.from.y) : null;
      if (mp && mp.type === hp.type && WB.canPlace(G.L, allPieces(mp), hp.type, hp.x, hp.y)) { movePiece(mp, hp.x, hp.y, hp.d); return; }
      if (!hp.from && remaining(hp.type) > 0 && WB.canPlace(G.L, allPieces(), hp.type, hp.x, hp.y)) { place(hp.type, hp.x, hp.y, hp.d); return; }
    }
    if (G.sel && !pp && !fp) {
      var tgt = snapTarget(c, G.valid);
      if (tgt && tgt.d <= snapTol(c)) { place(G.sel, tgt.x, tgt.y, defaultRot(G.sel)); return; }
      if (c.inMap) { nope(c.x, c.y); mountHelp(); return; }
      if (!tgt || tgt.d > 1.0) deselect();
      return;
    }
    if (pp) {
      var x = pp.x, y = pp.y, type = pp.type;
      if (rotations(type) > 1) {
        hidePieceMenu();
        rotatePiece(pp);
        // on touch, say what it does now, but never over what the turn changed
        // (and not at all when the turn solves the level)
        if (ptype !== 'mouse' && !G.sim.solved) {
          var th = describe(x, y) + (ptype === 'keyboard' ? '' : '<span class="tt-act">Tap again to turn · press and hold to put it back</span>');
          showTooltipAt(x, y, th, tipMs(1500, th), ptype !== 'keyboard');
        }
      } else if (G.pmenu && G.pmenu.x === x && G.pmenu.y === y) {
        hidePieceMenu(); // a second tap closes its menu
      } else {
        showPieceMenu(pp);
      }
      return;
    }
    if (fp) { fixedTap(c.x, c.y); return; }
    if (!c.inMap) {
      if (hadTip) return;
      if (ptype !== 'mouse' && c.onCanvas) {
        var gx = clamp(c.x, 0, G.L.w - 1), gy = clamp(c.y, 0, G.L.h - 1), gh = describe(c.x, c.y);
        showTooltipAt(gx, gy, gh, tipMs(2200, gh));
        G.tipAt = { x: c.x, y: c.y };
      }
      return;
    }
    // an object: how it is doing, in words, with a way to its card
    var oi = objectAt(c.x, c.y);
    if (oi >= 0) {
      if (G.guide && G.guide.at && G.guide.at.x === c.x && G.guide.at.y === c.y) { closeGuide({ how: 'close' }); return; }
      if (G.pmenu && G.pmenu.obj && G.pmenu.x === c.x && G.pmenu.y === c.y) { hidePieceMenu(); return; } // a second tap closes it
      showPieceMenu({ x: c.x, y: c.y, type: G.L.objects[oi].type, obj: true });
      return;
    }
    // nothing picked up, on a spot where a tool of yours would fit
    var left = G.sel ? [] : trayTypes().filter(function (t) { return remaining(t) > 0; });
    var fits = left.filter(function (t) { return WB.canPlace(G.L, allPieces(), t, c.x, c.y); });
    // only one kind of tool in the tray: there is nothing to choose, so it goes right here
    if (left.length === 1 && fits.length === 1) { place(fits[0], c.x, c.y, defaultRot(fits[0])); return; }
    if (hadTip) return; // the same spot again: the tooltip closes
    var html = describe(c.x, c.y);
    if (fits.length) {
      var tap = usingTouch() ? 'Tap' : 'Click';
      html += '<span class="tt-act">' + (fits.length === 1 ? tap + ' the ' + lowerName(fits[0]) + ' in your tray first' : tap + ' a tool in your tray first') + '</span>';
      if (fits.length === 1) {
        markChipCoach(fits[0]);
        clearTimeout(G.chipCoachTimer);
        G.chipCoachTimer = setTimeout(function () { if (G.chipCoach === fits[0] && !(G.c1 && G.c1.step === 'out')) markChipCoach(null); }, 3500);
      }
    } else if (!G.sel) {
      // all of them are on the board already: one of yours could come here
      var mover = null;
      trayTypes().forEach(function (t) {
        if (mover || remaining(t) > 0) return;
        G.pieces.forEach(function (p) { if (!mover && p.type === t && WB.canPlace(G.L, allPieces(p), t, c.x, c.y)) mover = p; });
      });
      if (mover) {
        html += '<span class="tt-act">Drag your ' + lowerName(mover.type) + ' here</span>';
        G.focus = { cell: { x: mover.x, y: mover.y }, t0: performance.now() };
      }
    }
    // a coach bubble is speaking about this very spot: it says it again, instead of a tooltip
    if (coachShowing()) { nudgeCoach(); return; }
    showTooltipAt(c.x, c.y, html, tipMs(2600, html));
  }
  // The coach bubble says its words again (a tap on the spot it points at).
  function nudgeCoach() {
    dom.coach.classList.remove('is-in');
    void dom.coach.offsetWidth;
    dom.coach.classList.add('is-in');
    G.spot = G.coach ? { x: G.coach.x, y: G.coach.y, t0: performance.now() } : G.spot;
    if (G.c1 && G.c1.step === 'out' && remaining('window') > 0) {
      markChipCoach('window');
      var chip = dom.tray.querySelector('.chip[data-tool="window"]');
      if (chip) { chip.classList.remove('is-bounce'); void chip.offsetWidth; chip.classList.add('is-bounce'); }
    }
  }
  // a one-time tip gives way to what the player asked for
  function hideCoachTip() { if (G.coach && G.coach.key) hideCoach(); }

  function fixedTap(x, y) {
    G.shake = { x: x, y: y, t0: performance.now() };
    var html = describe(x, y);
    showTooltipAt(x, y, html, tipMs(2400, html));
  }

  function setHover(c) {
    var changed = !G.hover || G.hover.x !== c.x || G.hover.y !== c.y || G.hover.inMap !== c.inMap;
    G.hover = c;
    G.hoverMouse = true;
    if (G.sel) updateGhostFromHover(); // the ghost snaps, so it may change within a cell
    if (changed) {
      hideTooltip();
      updateGhostFromHover();
      updateCursorStyle();
      if (!G.sel && c.onCanvas) {
        var hx = c.x, hy = c.y;
        G.hoverTimer = setTimeout(function () {
          if (G.screen !== 'game') return;
          if (G.hover && G.hover.x === hx && G.hover.y === hy && !I.drag && !G.sel && !I.press) {
            if (c.inMap) showTooltipAt(hx, hy, describe(hx, hy, true), 0);
            else if (hx >= -1 && hy >= -1 && hx <= G.L.w && hy <= G.L.h) showTooltipAt(hx, hy, describe(hx, hy), 0);
          }
        }, 420);
      }
    }
  }

  function updateGhostFromHover() {
    if (I.drag) return;
    var h = G.cursor || (G.hoverMouse ? G.hover : null);
    var ng = null;
    if (G.sel && h) {
      var tgt = G.cursor ? (isValidCell(G.valid, h.x, h.y) ? { x: h.x, y: h.y, d: 0 } : null)
        : snapTarget(h, G.valid);
      if (tgt && tgt.d <= (G.cursor ? 0 : snapTol(h))) ng = { type: G.sel, x: tgt.x, y: tgt.y, d: defaultRot(G.sel), ok: true };
    }
    var og = G.ghost;
    if (!ng !== !og || (ng && (ng.x !== og.x || ng.y !== og.y || ng.d !== og.d || ng.type !== og.type))) {
      G.ghost = ng;
      updatePreview();
      updateCursorStyle();
    }
  }

  // Live airflow preview for the ghost piece (hover, keyboard cursor or drag).
  function updatePreview() {
    var gh = G.ghost;
    if (gh && gh.ok) {
      var moving = I.drag && I.drag.kind === 'move';
      var key = gh.type + ',' + gh.x + ',' + gh.y + ',' + (gh.d | 0) + (moving ? 'm' : '') + '@' + G.version;
      if (key === G.previewKey) return;
      G.previewKey = key;
      var others = moving ? allPieces(I.drag.piece) : allPieces();
      G.previewSim = WB.simulate(G.L, others.concat([{ type: gh.type, x: gh.x, y: gh.y, d: gh.d | 0 }]));
      updateGoals();
    } else if (G.previewKey !== null || G.previewSim) {
      G.previewKey = null;
      G.previewSim = null;
      updateGoals();
    }
  }

  function updateCursorStyle() {
    var cv = dom.canvas;
    var cls = '';
    if (I.drag) cls = 'is-grabbing';
    else if (G.hover && G.hoverMouse) {
      if (G.sel && G.ghost) cls = 'is-pointer';
      else if (G.hover.inMap && playerAt(G.hover.x, G.hover.y)) cls = 'is-grab';
    }
    cv.classList.toggle('is-pointer', cls === 'is-pointer');
    cv.classList.toggle('is-grab', cls === 'is-grab');
    cv.classList.toggle('is-grabbing', cls === 'is-grabbing');
  }

  // ---------------------------------------------------------------- dragging

  function startDrag(d, e) {
    hideTooltip();
    hidePieceMenu();
    G.linger = null;
    I.drag = d;
    if (d.kind === 'move') {
      G.lifted = d.piece;
      rebuildDrawPieces();
      d.valid = WB.placementCells(G.L, allPieces(d.piece), d.type);
      G.dragBaseSim = WB.simulate(G.L, allPieces(d.piece));
    } else {
      d.valid = WB.placementCells(G.L, allPieces(), d.type);
      G.dragBaseSim = G.sim;
    }
    d.wall = isWallMount(d.type);
    G.previewSim = null;
    G.previewKey = null;
    R.icon(dom.avatar.querySelector('canvas'), 'tool', d.type, 40);
    updateDrag(e);
    updateCursorStyle();
  }

  // Where the dragged piece floats, in client coords. A moved piece stays
  // anchored where it was grabbed; on touch it only lifts above the finger
  // once the drag is clearly under way, so a sloppy tap never shifts it a cell.
  // (This is where the piece is drawn; where it lands is dropTarget's call.)
  function dragPoint(e) {
    var d = I.drag;
    var T = board.T;
    d.travel = Math.max(d.travel || 0, Math.hypot(e.clientX - (d.x0 == null ? e.clientX : d.x0), e.clientY - (d.y0 == null ? e.clientY : d.y0)));
    var lift = touchy(d.ptype) ? Math.min(40, T * 0.9) : 0;
    if (d.kind === 'move') {
      // stays anchored for the first tile of travel (so nudging a piece one
      // slot works), then eases up to about half a tile above the finger
      var mlift = touchy(d.ptype) ? Math.min(28, T * 0.55) : 0;
      var k = touchy(d.ptype) ? clamp((d.travel - T) / (1.5 * T), 0, 1) : 0;
      return { x: e.clientX + d.gx * (1 - k), y: e.clientY + d.gy * (1 - k) - mlift * k };
    }
    return { x: e.clientX, y: e.clientY - lift };
  }

  // Where a dragged piece lands. With a mouse: the cell under the pointer.
  // With a finger, where the player is pointing: the cell under the finger
  // (its touch point sits a little below what it aims at), as long as tiles
  // are big enough to see past a fingertip; on small tiles the cell the
  // floating piece is over, unless the finger itself is on a spot where the
  // piece fits. A spot the coach or the hint points at wins when the finger is
  // within about a tile of it.
  function dropTarget(e, pt) {
    var d = I.drag, T = board.T;
    var c = board.pick(pt.x, pt.y);
    if (!touchy(d.ptype)) {
      var t0 = snapTarget(c, d.valid);
      return { c: c, tgt: t0 && t0.d <= snapTol(c) ? t0 : null };
    }
    var fc = board.pick(e.clientX, e.clientY - Math.min(12, T * 0.3));
    var tol = function (q) { return q.inMap ? 0.6 : 0.75; };
    // the coach's ring or the hint's ghost, if this piece fits there
    var magnets = [];
    if (G.spot) magnets.push(G.spot);
    if (G.hint && G.hint.type === d.type) magnets.push(G.hint);
    for (var i = 0; i < magnets.length; i++) {
      var m = magnets[i];
      if (!isValidCell(d.valid, m.x, m.y)) continue;
      var mt = snapTarget(fc, [m]);
      if (mt && mt.d <= 0.6) return { c: fc, tgt: mt };
    }
    var ft = snapTarget(fc, d.valid);
    if (T >= 40) return { c: fc, tgt: ft && ft.d <= tol(fc) ? ft : null };
    // small tiles: the finger on a spot where it fits, else where the piece floats
    if (ft && ft.d === 0) return { c: fc, tgt: ft };
    var lt = snapTarget(c, d.valid);
    return { c: c, tgt: lt && lt.d <= tol(c) ? lt : null };
  }

  function updateDrag(e) {
    var d = I.drag;
    var pt = dragPoint(e);
    var drop = dropTarget(e, pt);
    var c = drop.c, tgt = drop.tgt;
    d.last = c;
    var near = c.inMap || !!tgt || (snapTarget(c, d.valid) || { d: 9 }).d <= 1;
    var finger = touchy(d.ptype);
    if (tgt) {
      // on touch, a clear ring around the cell it lands in (the finger hides the cell itself)
      G.ghost = { type: d.type, x: tgt.x, y: tgt.y, d: d.d | 0, ok: true, ring: finger };
      d.target = tgt;
    } else {
      d.target = null;
      G.ghost = c.inMap ? { type: d.type, x: c.x, y: c.y, d: d.d | 0, ok: false } : null;
    }
    updatePreview();
    // with a mouse the piece snaps into its spot; a finger keeps it floating
    // in view above it
    dom.avatar.hidden = !!(G.ghost && G.ghost.ok) && !finger;
    if (!dom.avatar.hidden) {
      dom.avatar.style.transform = 'translate(' + pt.x + 'px,' + pt.y + 'px)';
      dom.avatar.style.opacity = d.kind === 'move' && !near ? '0.6' : '0.95';
    }
  }

  function overTray(e) {
    var r = dom.tray.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function endDrag(e) {
    var d = I.drag;
    if (!d) return;
    updateDrag(e);
    var c = d.last, tgt = d.target;
    I.drag = null;
    G.ghost = null;
    G.previewSim = null;
    G.previewKey = null;
    G.dragBaseSim = null;
    dom.avatar.hidden = true;
    var lifted = livePiece(G.lifted);
    G.lifted = null;
    rebuildDrawPieces();
    if (d.kind === 'move' && lifted) {
      // R during the drag turns the piece being dragged (see the keyboard)
      var turned = (d.d | 0) !== (lifted.d | 0);
      if (d.travel < Math.max(0.5 * board.T, 18)) {
        // never went anywhere: it was a (sloppy) tap, unless it was turned
        if (turned) rotatePiece(lifted, d.d | 0);
        else tapCell({ x: lifted.x, y: lifted.y, fx: lifted.x + 0.5, fy: lifted.y + 0.5, inMap: true, onCanvas: true }, d.ptype);
      } else if (overTray(e)) {
        removePiece(lifted, false);
      } else if (tgt) {
        if (tgt.x === lifted.x && tgt.y === lifted.y) { if (turned) rotatePiece(lifted, d.d | 0); }
        else movePiece(lifted, tgt.x, tgt.y, d.d | 0);
      } else if (c.inMap) {
        if (turned) rotatePiece(lifted, d.d | 0);
        nope(lifted.x, lifted.y);
        lingerSpots(d.type, d.valid);
        mountHelp(d.type);
      } else {
        removePiece(lifted, false);
      }
    } else if (d.kind !== 'move') {
      if (tgt) place(d.type, tgt.x, tgt.y, d.d);
      else if (c.inMap) {
        // dropped where it can't go: say where it can, and keep those spots lit for a moment
        nope(c.x, c.y);
        lingerSpots(d.type, d.valid);
        mountHelp(d.type);
      }
    }
    updateGoals();
    updateCursorStyle();
    checkWin();
  }

  function cancelDrag() {
    var d = I.drag;
    if (!d) return;
    if (d.kind === 'new') I.cancelledPointer = d.pointerId; // swallow the click that follows
    I.drag = null;
    G.ghost = null;
    G.previewSim = null;
    G.previewKey = null;
    G.dragBaseSim = null;
    G.lifted = null;
    dom.avatar.hidden = true;
    rebuildDrawPieces();
    // a win held back while the piece was up (checkWin waits for the drop)
    if (G.screen === 'game' && G.sim) { updateGoals(); checkWin(); }
  }

  // R while dragging turns the dragged piece; it lands turned.
  function turnDragged() {
    var d = I.drag;
    if (!d || rotations(d.type) < 2) return;
    d.d = WB.rotate(d.type, d.d | 0);
    if (d.kind === 'new') G.rot[d.type] = d.d;
    var g = G.ghost;
    if (g) { G.ghost = { type: g.type, x: g.x, y: g.y, d: d.d, ok: g.ok }; updatePreview(); }
    Sound.turn();
  }

  function onChipDown(e) {
    if (I.drag || I.press || I.tray || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (boardLocked()) return;
    var type = this.getAttribute('data-tool');
    I.infoDown = e.target && e.target.closest && e.target.closest('.chip-info') ? type : null;
    Sound.unlock();
    // a used-up tool cannot be dragged out, but press and hold still opens its card
    var tp = I.tray = { type: type, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, el: this, ptype: e.pointerType, used: remaining(type) <= 0 };
    try { this.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    // press and hold (finger or pen): the tool's card
    if (e.pointerType !== 'mouse') {
      setTimeout(function () {
        if (I.tray !== tp || boardLocked()) return;
        I.tray = null;
        I.chipLong = tp.pointerId;
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* ignore */ }
        openGuide(type);
      }, 520);
    }
  }

  window.addEventListener('pointermove', function (e) {
    if (I.drag && e.pointerId === I.drag.pointerId) {
      updateDrag(e);
      return;
    }
    var tp = I.tray;
    if (tp && tp.pointerId === e.pointerId) {
      var dx = e.clientX - tp.x0, dy = e.clientY - tp.y0;
      var dist = Math.hypot(dx, dy);
      var intent = tp.ptype === 'mouse' || landscapeMQ.matches || Math.abs(dy) > Math.abs(dx) * 0.8;
      if (tp.used) {
        if (dist > 14) I.tray = null; // nothing to drag out: a scroll of the tray, or nothing
      } else if (dist > 8 && intent) {
        I.tray = null;
        I.infoDown = null;
        startDrag({ kind: 'new', type: tp.type, d: defaultRot(tp.type), pointerId: e.pointerId, ptype: e.pointerType }, e);
      } else if (dist > 14) {
        I.tray = null; // horizontal scroll of the tray
      }
    }
  });
  window.addEventListener('pointerup', function (e) {
    if (I.drag && e.pointerId === I.drag.pointerId) {
      var wasNew = I.drag.kind === 'new';
      endDrag(e);
      if (wasNew) {
        I.suppressClick = true;
        setTimeout(function () { I.suppressClick = false; }, 0);
      }
    }
    if (I.cancelledPointer === e.pointerId) {
      I.cancelledPointer = null;
      I.suppressClick = true;
      setTimeout(function () { I.suppressClick = false; }, 0);
    }
    if (I.tray && I.tray.pointerId === e.pointerId) I.tray = null;
    // the click that ends a long-press on a chip is not a tap (the card may
    // have opened right under the finger)
    if (I.chipLong === e.pointerId) {
      I.chipLong = null;
      I.swallowClick = performance.now() + 150; // a real next tap takes longer than this
    }
  });
  window.addEventListener('click', function (e) {
    if (I.swallowClick && performance.now() < I.swallowClick) { e.stopPropagation(); e.preventDefault(); }
    I.swallowClick = 0;
  }, true);
  window.addEventListener('pointercancel', function (e) {
    if (I.chipLong === e.pointerId) I.chipLong = null;
    if (I.drag && e.pointerId === I.drag.pointerId) cancelDrag();
    if (I.tray && I.tray.pointerId === e.pointerId) I.tray = null;
  });

  dom.canvas.addEventListener('pointerdown', onBoardDown);
  dom.canvas.addEventListener('pointermove', onBoardMove);
  dom.canvas.addEventListener('pointerup', onBoardUp);
  dom.canvas.addEventListener('pointercancel', onBoardCancel);
  dom.canvas.addEventListener('pointerleave', onBoardLeave);
  dom.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  dom.canvas.addEventListener('blur', function () { G.cursor = null; updateGhostFromHover(); });

  dom.back.addEventListener('click', goHome);
  dom.undo.addEventListener('click', undo);
  dom.redo.addEventListener('click', redo);
  dom.reset.addEventListener('click', resetLevel);
  dom.hint.addEventListener('click', function () { Sound.unlock(); hint(); });
  dom.help.addEventListener('click', openHelp);
  dom.helpClose.addEventListener('click', function () { closeDialog(dom.helpDlg); });
  dom.helpDlg.addEventListener('click', function (e) { if (e.target === dom.helpDlg) closeDialog(dom.helpDlg); });

  // ---------------------------------------------------------------- help

  function cv(kind, id, size, cls) {
    return '<canvas class="' + (cls || '') + '" data-icon="' + kind + '" data-id="' + id + '" data-size="' + size + '" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true"></canvas>';
  }

  // The furthest level the player has reached: the help lists what they have
  // met so far, also when they replay an early level.
  function reachedLevel() {
    var n = G.id || 1;
    store.completed.forEach(function (id) {
      var i = levelIndex(id);
      if (i < 0) return;
      n = Math.max(n, i + 1 < LEVELS.length ? LEVELS[i + 1].id : id);
    });
    return n;
  }

  function openHelp() {
    updateSoundButton();
    renderHelp();
    openDialog(dom.helpDlg, dom.helpClose);
    dom.helpBody.scrollTop = 0;
  }
  // Help, in layers: the goal first (three small pictures), then the field
  // guide of everything met so far, then folded sections: how air moves (the
  // fine print, only for what has been met), the controls for this device, and
  // the keyboard.
  function renderHelp() {
    stopHelpGuide();
    var n = reachedLevel();
    var h = [];
    var inLevel = {};
    var playing = G.screen === 'game' && G.L;
    if (playing) {
      Object.keys(G.L.inventory).forEach(function (t) { if (G.L.inventory[t] > 0) inLevel[t] = true; });
      G.fixed.forEach(function (p) { inLevel[p.type] = true; });
      G.L.objects.forEach(function (o) { inLevel[o.type] = true; });
      if (WB.levelConditions) WB.levelConditions(G.def).forEach(function (c) { inLevel[c] = true; });
    }
    function has(o) { return metBy(o, n) || inLevel[o]; }
    var touch = usingTouch(), tap = touch ? 'Tap' : 'Click';
    var CHEV = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';
    function more(title, note, body, open) {
      return '<details class="help-more"' + (open ? ' open' : '') + '><summary><span>' + title + '</span>' + (note ? '<small>' + note + '</small>' : '') + CHEV + '</summary>' + body + '</details>';
    }

    // 1. the goal
    h.push('<p class="help-lead">Make <b>everyone</b> in the house happy, all at the same time.</p>');
    h.push('<ul class="help-goal">' +
      '<li>' + cv('ui', 'inlet', 46) + '<span>Wind blows in on the windy side.</span></li>' +
      '<li>' + cv('ui', 'outlet', 46) + '<span>It needs a way out: another window.</span></li>' +
      '<li>' + cv('object', 'pinwheel', 46) + '<span>Air makes everyone happy!</span></li>' +
      '</ul>');
    h.push('<p>' + tap + ' anything on the board to see how much air reaches it. Stuck? <b>Hints are free.</b></p>');

    // 2. the field guide: every tool, thing and twist met so far, each opening its card
    var met = GUIDE_ORDER.filter(function (gid) { return metBy(gid, n) || inLevel[gid]; });
    if (met.length) {
      h.push('<h3>Field guide</h3><p class="fg-note">Everything you have met so far. ' + tap + ' one to see how it works.</p>');
      ['tool', 'object', 'twist'].forEach(function (k) {
        var ids = met.filter(function (gid) { return guideFor(gid).kind === k; });
        if (!ids.length) return;
        h.push('<h4>' + KIND_GROUP[k] + '</h4><ul class="fguide">');
        ids.forEach(function (gid) {
          var c = guideFor(gid);
          var ic = k === 'tool' ? cv('tool', gid, 40) : k === 'object' ? cv('object', gid, 40) : cv('ui', TWIST_ICON[gid] || 'calm', 40);
          h.push('<li><button type="button" class="fg-item" data-guide="' + esc(gid) + '">' + ic +
            '<span class="fg-text"><span class="gloss-name">' + esc(c.title) + '</span><span class="gloss-desc">' + esc(tapWords(c.oneLiner)) + '</span></span>' +
            CHEVRON_SVG + '</button></li>');
        });
        h.push('</ul>');
      });
    }

    // 3. how air moves: the fine print, only for what has been met
    var r = ['<ul class="help-rules">'];
    r.push('<li><span class="rule-ico">' + cv('swirl', 'w', 28) + '</span><span><b>Wind</b> blows across the garden. The wind badge at the top shows which way it blows and how strong it is.</span></li>');
    r.push('<li><span class="rule-ico">' + cv('ui', 'inlet', 34) + '</span><span>A <b>window on the windy side</b> lets the breeze in: a bright pane with arrows pointing in. Every other window <b>lets air out</b> ' + cv('ui', 'outlet', 22, 'inl') + '.' +
      (has('fan') ? ' Air blown back into a window on the windy side is pushed back, just like a wall.' : '') + '</span></li>');
    r.push('<li><span class="rule-ico">' + cv('ui', 'stall', 34) + '</span><span><b>A breeze only flows if it has a way out.</b> With no way out it stays still: its path is a faint dashed line that ends in a red ×.</span></li>');
    if (has('fan') || has('laundry') || has('wind2')) {
      r.push('<li><span class="rule-ico">' + cv('ui', 'lanes-2', 34) + '</span><span><b>Strength</b> is the number of lines in a stream: one is a gentle breeze, two is strong, three is a gale. Breezes from different places add up where they meet' +
        (n >= 51 ? ' (a breeze crossing its own path does not add to itself)' : '') + '.</span></li>');
    }
    if (has('stove')) r.push('<li><span class="rule-ico">' + cv('object', 'stove', 30) + '</span><span><b>Smoke</b> from a stove must be carried outside' + (has('filter') ? ' or through a filter' : '') + ', never blown into a wall.' + (has('laundry') ? ' Smoky air also makes laundry dirty.' : '') + '</span></li>');
    r.push('<li><span class="rule-ico">' + cv('ui', 'pip-happy', 30) + '</span><span>The dot on each thing shows how it feels: ' + cv('ui', 'pip-idle', 18, 'inl') + ' waiting, ' + cv('ui', 'pip-happy', 18, 'inl') + ' happy, ' + cv('ui', 'pip-bad', 18, 'inl') + ' unhappy' +
      (has('laundry') && has('stove') ? ', ' + cv('ui', 'pip-dirty', 18, 'inl') + ' dirty from smoke' : '') + '.</span></li>');
    if (has('laundry') || has('papers') || has('fern')) {
      var ms = [];
      if (has('laundry')) ms.push(cv('ui', 'meter-laundry-1-idle', 34, 'inl') + ' laundry wants two or more, of clean air');
      if (has('papers')) ms.push(cv('ui', 'meter-papers-0-happy', 34, 'inl') + ' papers take one at most');
      if (has('fern')) ms.push(cv('ui', 'meter-fern-1-happy', 34, 'inl') + ' a fern wants exactly one');
      r.push('<li><span class="rule-ico">' + cv('ui', 'meter-laundry-2-happy', 34) + '</span><span>Some things are picky. Their <b>meter</b> fills with the air that reaches them: ' + ms.join(', ') + '. A red dot means too much.</span></li>');
    }
    r.push('</ul>');
    h.push(more('How air moves', 'the fine print', r.join('')));

    // 4. controls, for the device in use
    var c = ['<dl class="keys">'];
    c.push('<dt>' + tap + ' a tool</dt><dd>pick it up, then ' + tap.toLowerCase() + ' a glowing spot. Or drag the tool onto the board.</dd>');
    c.push('<dt>' + tap + ' it again</dt><dd>it stays picked up. ' + (touch ? 'Tap the garden' : 'Press Esc') + ' to put it down.</dd>');
    c.push('<dt>' + (touch ? 'Press and hold a tool' : 'Right-click a tool') + '</dt><dd>learn what it does</dd>');
    c.push('<dt>' + tap + ' a piece</dt><dd>turn it, if it turns. Other pieces say what they do, with a Put back button.</dd>');
    c.push('<dt>' + tap + ' a thing in the house</dt><dd>see what it wants, and how it is doing</dd>');
    c.push('<dt>Drag a piece</dt><dd>move it. Drop it off the board to put it back.</dd>');
    c.push('<dt>' + (touch ? 'Press and hold a piece' : 'Right-click a piece') + '</dt><dd>put it back in your tray</dd>');
    c.push('<dt>Undo, Redo, Clear</dt><dd>take back a move, do it again, or clear the board (Clear can be undone too)</dd>');
    c.push('</dl>');
    h.push(more('Controls', touch ? 'for touch' : 'for the mouse', c.join('')));
    // keyboard shortcuts only where a keyboard is likely (or has been used)
    if (!(touch && coarseMQ.matches && !G.sawKeys)) {
      var k = ['<dl class="keys">'];
      k.push('<dt><kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd></dt><dd>pick a tool</dd>');
      k.push('<dt><kbd>R</kbd></dt><dd>turn the piece under the pointer</dd>');
      k.push('<dt><kbd>H</kbd></dt><dd>hint</dd>');
      k.push('<dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>undo (add <kbd>Shift</kbd> to redo)</dd>');
      k.push('<dt><kbd>Esc</kbd></dt><dd>put the tool down / close</dd>');
      k.push('<dt>Arrows, <kbd>Enter</kbd></dt><dd>move around the board and place or turn</dd>');
      k.push('<dt><kbd>Delete</kbd></dt><dd>put back the piece under the keyboard cursor</dd>');
      k.push('<dt><kbd>I</kbd></dt><dd>about the picked-up tool, or what this level brings</dd>');
      k.push('</dl>');
      h.push(more('Keyboard', null, k.join('')));
    }
    dom.helpBody.innerHTML = h.join('');
    paintIcons(dom.helpBody);
  }

  // A card from the field guide, inside the help sheet (with a way back).
  // backScroll: where the list was (when the card is only being rebuilt)
  function showHelpGuide(id, backScroll) {
    var card = guideFor(id);
    if (!card) return;
    var scroll = backScroll != null ? backScroll : dom.helpBody.scrollTop;
    stopHelpGuide();
    var built = buildCard(card, {});
    dom.helpBody.textContent = '';
    var back = el('button', 'btn btn-quiet btn-small help-back');
    back.type = 'button';
    back.innerHTML = BACK_SVG + '<span>Field guide</span>';
    back.addEventListener('click', function () {
      renderHelp();
      dom.helpBody.scrollTop = scroll;
      var b = dom.helpBody.querySelector('[data-guide="' + id + '"]');
      if (b) b.focus({ preventScroll: true });
    });
    dom.helpBody.appendChild(back);
    var wrap = el('div', 'help-guide');
    wrap.appendChild(built.el);
    dom.helpBody.appendChild(wrap);
    G.helpGuide = { id: id, built: built, scroll: scroll };
    if (built.demo) built.demo.start();
    dom.helpBody.scrollTop = 0;
    back.focus({ preventScroll: true });
  }
  function stopHelpGuide() {
    if (G.helpGuide && G.helpGuide.built.demo) G.helpGuide.built.demo.stop();
    G.helpGuide = null;
  }
  dom.helpBody.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-guide]') : null;
    if (b) showHelpGuide(b.getAttribute('data-guide'));
  });
  function paintIcons(root) {
    var cvs = root.querySelectorAll('canvas[data-icon]');
    for (var i = 0; i < cvs.length; i++) {
      R.icon(cvs[i], cvs[i].getAttribute('data-icon'), cvs[i].getAttribute('data-id'), +(cvs[i].getAttribute('data-size') || 40));
    }
  }

  // ---------------------------------------------------------------- dialogs

  var dialogStack = [];
  function openDialog(d, focusEl) {
    if (!d.hidden) return;
    dialogStack.push({ d: d, prev: document.activeElement });
    d.hidden = false;
    hideTooltip();
    hidePieceMenu();
    if (d === dom.helpDlg) {
      renderCoach();
      if (G.guide && G.guide.built.demo) G.guide.built.demo.stop();
    }
    setTimeout(function () { if (!d.hidden) (focusEl || d.querySelector('button')).focus(); }, 30);
  }
  function closeDialog(d, silent) {
    if (d.hidden) return;
    d.hidden = true;
    for (var i = dialogStack.length - 1; i >= 0; i--) {
      if (dialogStack[i].d === d) {
        var prev = dialogStack[i].prev;
        dialogStack.splice(i, 1);
        if (!silent && prev && prev.focus && document.body.contains(prev) && prev.offsetParent !== null) prev.focus();
        break;
      }
    }
    if (d === dom.helpDlg) {
      stopHelpGuide();
      renderCoach();
      if (G.guide && G.guide.built.demo) G.guide.built.demo.start();
    }
    if (d === dom.win && G.screen === 'game') {
      closeGuide({ silent: true });
      updateButtons();
      if (!silent && !dom.next.hidden) dom.next.focus();
    }
  }
  function topDialog() {
    return dialogStack.length ? dialogStack[dialogStack.length - 1].d : null;
  }

  // ---------------------------------------------------------------- keyboard

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' && e.key !== 'Escape' && !e.isComposing) G.sawKeys = true;
    var dlg = topDialog();
    if (dlg) {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(dlg); }
      else if (e.key === 'Tab') {
        // (summary: the folded sections of Help; a closed one's insides have no offsetParent)
        var f = Array.prototype.filter.call(dlg.querySelectorAll('button, [href], summary, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
        if (f.length) {
          var i = f.indexOf(document.activeElement);
          if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      return;
    }
    if (G.screen !== 'game') return;
    Sound.unlock();
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); if (!boardLocked()) undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (((k === 'z' || k === 'Z') && e.shiftKey) || k === 'y' || k === 'Y')) { e.preventDefault(); if (!boardLocked()) redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Escape') {
      if (I.drag) { cancelDrag(); return; }
      if (G.pmenu) { hidePieceMenu(); return; }
      if (G.sel) { deselect(); return; }
      if (G.guide) { closeGuide({ how: 'close' }); return; }
      if (!dom.toast.hidden) { hideToast(); G.hint = null; return; }
      if (G.coach) { hideCoach(); return; }
      hideTooltip();
      return;
    }
    if (boardLocked()) return;
    if (I.drag) {
      // a piece is in the hand: R turns it, other board keys wait for the drop
      if (k === 'r' || k === 'R') turnDragged();
      return;
    }
    if (/^[0-9]$/.test(k)) {
      var chips = dom.tray.querySelectorAll('.chip');
      var chip = chips[k === '0' ? 9 : parseInt(k, 10) - 1];
      if (chip) {
        var type = chip.getAttribute('data-tool');
        if (G.sel === type) againChip(chip, type); // the same key again keeps it, like a second tap
        else if (remaining(type) > 0) select(type);
        else usedChip(chip, type);
      }
      return;
    }
    if (k === 'r' || k === 'R') {
      var h = G.cursor || G.hover;
      var p = h && h.x >= 0 && h.y >= 0 ? playerAt(h.x, h.y) : null;
      if (p && rotations(p.type) > 1) rotatePiece(p);
      else if (p) {
        G.shake = { x: p.x, y: p.y, t0: performance.now() };
      } else if (G.sel && rotations(G.sel) > 1) {
        G.rot[G.sel] = WB.rotate(G.sel, defaultRot(G.sel));
        updateGhostFromHover();
        Sound.turn();
      }
      return;
    }
    if (k === 'h' || k === 'H') { hint(); return; }
    if (k === 'i' || k === 'I') {
      var gid = G.sel || G.levelGuide;
      if (gid && !(G.guide && G.guide.id === gid)) openGuide(gid, { focus: true });
      return;
    }
    if (document.activeElement === dom.canvas) {
      var dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (dirs[k]) {
        e.preventDefault();
        var cur = G.cursor || { x: Math.floor(G.L.w / 2), y: Math.floor(G.L.h / 2) };
        if (G.cursor) {
          cur = { x: clamp(cur.x + dirs[k][0], 0, G.L.w - 1), y: clamp(cur.y + dirs[k][1], 0, G.L.h - 1) };
        }
        G.cursor = { x: cur.x, y: cur.y, inMap: true };
        updateGhostFromHover();
        var desc = describe(cur.x, cur.y);
        showTooltipAt(cur.x, cur.y, desc, 0);
        // the tooltip is only drawn: say it for screen readers too
        announce(plainText(desc) + '. Column ' + (cur.x + 1) + ', row ' + (cur.y + 1) + '.');
        return;
      }
      if ((k === 'Enter' || k === ' ') && G.cursor) {
        e.preventDefault();
        tapCell({ x: G.cursor.x, y: G.cursor.y, fx: G.cursor.x + 0.5, fy: G.cursor.y + 0.5, inMap: true, onCanvas: true }, 'keyboard');
        if (G.cursor && !G.pmenu) showTooltipAt(G.cursor.x, G.cursor.y, describe(G.cursor.x, G.cursor.y), 0);
        return;
      }
      if ((k === 'Delete' || k === 'Backspace') && G.cursor) {
        e.preventDefault();
        var dp = playerAt(G.cursor.x, G.cursor.y);
        if (dp) removePiece(dp, false);
        return;
      }
    }
  });

  // ================================================================== render loop

  function layoutBoard() {
    if (G.screen !== 'game' || !G.L) return;
    var cs = getComputedStyle(dom.stage);
    var pt = parseFloat(cs.paddingTop);
    var w = dom.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = dom.stage.clientHeight - pt - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;
    var before = board.T + ',' + board.ox + ',' + board.oy;
    board.layout(w, h, 0);
    if (before !== board.T + ',' + board.ox + ',' + board.oy) {
      hideTooltip();
      positionCoach();
      if (G.pmenu) placeNear(dom.pmenu, G.pmenu.x, G.pmenu.y, true, 8);
    }
    if (G.guide) G.guide.fade();
    markClamped();
  }

  function drawSig() {
    var gh = G.ghost, hv = G.hover, cu = G.cursor;
    return [
      G.version, G.sel, gh ? gh.type + gh.x + ',' + gh.y + gh.d + gh.ok : '', hv && G.hoverMouse && !G.sel ? hv.x + ',' + hv.y : '',
      cu ? cu.x + ',' + cu.y : '', G.hint ? G.hint.x + ',' + G.hint.y + (G.hint.from ? '<' + G.hint.from.x + ',' + G.hint.from.y : '') : '', G.conflicts ? G.conflicts.length : 0,
      G.flash ? G.flash.t0 : 0, G.shake ? G.shake.t0 : 0, G.pulse || 0, G.focus ? G.focus.t0 : 0, G.winAt || 0,
      G.previewKey, I.drag ? 1 : 0, board.T, board.cssW, board.cssH, board.dpr, G.paletteVersion,
      G.spot ? G.spot.x + ',' + G.spot.y + ',' + G.spot.t0 : '',
      G.linger ? G.linger.t0 : 0, G.pmenu ? G.pmenu.x + ',' + G.pmenu.y : '',
      dom.helpDlg.hidden && dom.confirm.hidden && dom.settings.hidden ? 0 : 1
    ].join('|');
  }

  function frame(now) {
    G.raf = 0;
    if (G.screen !== 'game' || document.hidden) return;
    G.raf = requestAnimationFrame(frame);
    var blocking = !dom.helpDlg.hidden || !dom.confirm.hidden || !dom.settings.hidden;
    var reduced = reducedMotion();
    if (blocking || reduced) {
      // draw on demand: on any change, then let eased values settle
      var sig = drawSig();
      if (sig !== G.lastSig) {
        G.lastSig = sig;
        G.settleUntil = blocking ? 0 : now + 1600;
        drawNow(now);
      } else if (now < G.settleUntil) {
        drawNow(now);
      } else {
        board.lastNow = now;
      }
      return;
    }
    G.lastSig = '';
    drawNow(now);
  }
  function drawNow(now) {
    var sim = currentSim();
    // a missed drop: where it fits stays lit for a moment
    var lg = !I.drag && !G.sel ? G.linger : null;
    var valid = I.drag ? I.drag.valid : (G.sel ? G.valid : lg ? lg.valid : null);
    board.draw({
      pieces: G.drawPieces,
      sim: sim,
      valid: valid,
      validWall: I.drag ? I.drag.wall : lg ? lg.wall : G.validWall,
      validType: I.drag ? I.drag.type : G.sel ? G.sel : lg ? lg.type : null,
      ghost: G.ghost,
      hint: G.hint,
      conflicts: G.conflicts,
      hover: !G.sel && !I.drag && G.hoverMouse && G.hover && G.hover.inMap ? G.hover : null,
      // the keyboard cursor, or the ring around a tapped piece
      cursor: G.cursor || G.pmenu,
      focus: G.focus,
      pops: G.pops,
      shake: G.shake,
      flash: G.flash,
      pulse: G.pulse,
      spot: G.spot,
      win: G.won ? G.winAt : null,
      reduced: reducedMotion()
    }, now);
  }
  function startLoop() {
    if (!G.raf && G.screen === 'game' && !document.hidden) G.raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (G.raf) cancelAnimationFrame(G.raf);
    G.raf = 0;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopLoop(); flushPendingWin(); } else startLoop();
  });
  window.addEventListener('pagehide', flushPendingWin);

  if (window.ResizeObserver) {
    new ResizeObserver(function () { layoutBoard(); updateTrayFade(); }).observe(dom.stage);
  } else {
    window.addEventListener('resize', function () { layoutBoard(); updateTrayFade(); });
  }

  function refreshIcons() {
    if (G.screen === 'game') {
      renderTray();
      renderGoals();
      updateGuideLine();
      if (G.guide) {
        guideIcon(G.guide.built.icon, G.guide.id, 44);
        if (G.guide.built.demo) G.guide.built.demo.repaint();
      }
      if (!dom.helpDlg.hidden) {
        if (G.helpGuide) {
          guideIcon(G.helpGuide.built.icon, G.helpGuide.id, 44);
          if (G.helpGuide.built.demo) G.helpGuide.built.demo.repaint();
        } else paintIcons(dom.helpBody);
      }
    } else if (G.screen === 'home') {
      renderHome();
    }
  }
  // light/dark switched, or the art manifest (art/art.js) retheme'd tokens,
  // changed a tuning number (the largest tile size needs a new layout) or
  // finished loading images: repaint the board's cached layers and the icons
  function repaintArt(why) {
    if (why === 'tuning' || why === 'manifest') layoutBoard();
    board.refreshPalette();
    G.paletteVersion++;
    refreshIcons();
  }
  window.WBTheme.onChange(repaintArt);
  window.WBSprites.onChange(repaintArt);
  // icons are painted at the current devicePixelRatio; repaint when it changes
  (function watchDpr() {
    var m = mq('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    if (!m.addEventListener && !m.addListener) return;
    var fired = false;
    onMQ(m, function () {
      if (fired) return;
      fired = true;
      layoutBoard();
      refreshIcons();
      watchDpr();
    });
  })();

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  // ================================================================== QA hooks (handy for automated checks)

  window.WBGame = {
    state: G,
    board: board,
    open: function (id) { navigate(id); },
    home: goHome,
    setPieces: function (list) {
      var out = [];
      list.map(norm).forEach(function (p) {
        var used = out.filter(function (q) { return q.type === p.type; }).length;
        if (used < (G.L.inventory[p.type] || 0) && WB.canPlace(G.L, G.fixed.concat(out), p.type, p.x, p.y)) out.push(p);
      });
      commit(out);
      return out.length;
    },
    place: place,
    select: select,
    hint: hint,
    openGuide: function (id) { openGuide(id); },
    closeGuide: function () { closeGuide({ how: 'close' }); },
    solve: function () { commit((G.def.solution || []).map(norm)); }
  };

  // Read-only view for the end-to-end test (tools/e2e.js), which drives the
  // game only through real pointer and keyboard input.
  window.__wb = {
    // viewport (client) coordinates of a cell's centre on the board
    cell: function (x, y) {
      var r = dom.canvas.getBoundingClientRect(), c = board.cellRect(x, y);
      return { x: r.left + c.left + c.size / 2, y: r.top + c.top + c.size / 2, size: c.size };
    },
    state: function () {
      return {
        screen: G.screen, id: G.id, sel: G.sel,
        pieces: G.pieces.map(norm), fixed: G.fixed.map(norm),
        undo: G.history.length, redo: G.future.length,
        solved: !!(G.sim && G.sim.solved), won: G.won, celebrating: !!G.winCardTimer,
        hint: G.hint ? norm(G.hint) : null, hintFrom: G.hint && G.hint.from ? { x: G.hint.from.x, y: G.hint.from.y } : null,
        conflicts: G.conflicts ? G.conflicts.map(function (c) { return { x: c.x, y: c.y }; }) : null,
        cursor: G.cursor ? { x: G.cursor.x, y: G.cursor.y } : null,
        dragging: !!I.drag, newTool: G.newTool, T: board.T,
        // the field guide: the card on screen, this level's card, the coach bubble
        guide: G.guide ? G.guide.id : null, levelGuide: G.levelGuide,
        coach: G.coach && !dom.coach.hidden ? { x: G.coach.x, y: G.coach.y, key: G.coach.key, text: G.coach.text } : null,
        coachStep: G.c1 ? G.c1.step : null
      };
    }
  };

  // ================================================================== boot

  (function boot() {
    applySettings();
    var q = parseInt(params.get('level'), 10);
    if (q && levelById(q) && isUnlocked(q)) {
      try { history.replaceState({ id: q }, '', location.pathname + location.search + '#' + q); } catch (e) { /* ignore */ }
    }
    route();
  })();
})();
