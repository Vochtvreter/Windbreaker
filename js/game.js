/*
 * Windbreaker — screens, state, input, persistence and audio.
 * Depends on window.WB (engine + levels) and window.WBRender.
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
  var DIR_WORD = ['north', 'east', 'south', 'west'];
  var STRENGTH_WORD = ['calm', 'gentle', 'strong', 'gale'];
  var NEED = {
    pinwheel: 'needs a breeze', candle: 'keep the air away', laundry: 'needs 2 or more',
    papers: 'no more than 1', fern: 'wants exactly 1', stove: ''
  };

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
  var reducedMQ = mq('(prefers-reduced-motion: reduce)');
  var darkMQ = mq('(prefers-color-scheme: dark)');
  var landscapeMQ = mq('(max-height: 520px) and (min-aspect-ratio: 4/3)');
  var coarseMQ = mq('(pointer: coarse)');

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = { has: function () { return false; }, get: function () { return null; } }; }
  var UNLOCK_ALL = params.has('unlock');

  // ================================================================== storage

  var store = loadStore();

  function loadStore() {
    var s = { completed: [], boards: {}, sound: true, seenTools: [], seenTips: [] };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (Array.isArray(d.completed)) s.completed = d.completed.filter(function (n) { return typeof n === 'number'; });
          if (d.boards && typeof d.boards === 'object') s.boards = d.boards;
          if (typeof d.sound === 'boolean') s.sound = d.sound;
          if (Array.isArray(d.seenTools)) s.seenTools = d.seenTools.filter(function (n) { return typeof n === 'string'; });
          if (Array.isArray(d.seenTips)) s.seenTips = d.seenTips.filter(function (n) { return typeof n === 'string'; });
        }
      }
    } catch (e) { /* storage unavailable: play without saving */ }
    return s;
  }
  function saveStore() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  function levelById(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return null;
  }
  function levelIndex(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return i;
    return -1;
  }
  function chapterOf(id) {
    for (var i = 0; i < CHAPTERS.length; i++) if (id >= CHAPTERS[i].first && id <= CHAPTERS[i].last) return CHAPTERS[i];
    return null;
  }
  function isDone(id) { return store.completed.indexOf(id) >= 0; }
  function markDone(id) { if (!isDone(id)) store.completed.push(id); }
  function isUnlocked(id) {
    if (UNLOCK_ALL) return true;
    var first = LEVELS.length ? LEVELS[0].id : 1;
    return id === first || id === 1 || isDone(id) || isDone(id - 1);
  }
  function nextPlayableId() {
    for (var i = 0; i < LEVELS.length; i++) {
      var id = LEVELS[i].id;
      if (isUnlocked(id) && !isDone(id)) return id;
    }
    return null;
  }
  function seenTip(k) { return store.seenTips.indexOf(k) >= 0; }

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
    sound: $('btn-sound'), soundLabel: $('sound-label'), resetProgress: $('btn-reset-progress'),
    back: $('btn-back'), lvlNum: $('lvl-num'), lvlName: $('lvl-name'), wind: $('wind'), help: $('btn-help'),
    tip: $('tip'), stage: $('stage'), canvas: $('board'), tooltip: $('tooltip'), live: $('sr-live'),
    toast: $('toast'), toastText: $('toast-text'), toastAction: $('toast-action'), toastClose: $('toast-close'),
    newtool: $('newtool'), newtoolIcon: $('newtool-icon'), newtoolTitle: $('newtool-title'), newtoolDesc: $('newtool-desc'), newtoolOk: $('newtool-ok'),
    goals: $('goals'), undo: $('btn-undo'), reset: $('btn-reset'), hint: $('btn-hint'), next: $('btn-next'), nextLabel: $('btn-next-label'),
    tray: $('tray'), avatar: $('drag-avatar'),
    win: $('win'), winSub: $('win-sub'), winDots: $('win-dots'), winTeaser: $('win-teaser'), winTeaserIcon: $('win-teaser-icon'),
    winTeaserText: $('win-teaser-text'), winFinal: $('win-final'), winNext: $('win-next'), winLevels: $('win-levels'),
    helpDlg: $('help'), helpBody: $('help-body'), helpClose: $('help-close'),
    confirm: $('confirm'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no')
  };

  var board = new R.Board(dom.canvas);

  // ================================================================== game state

  var G = {
    screen: null,                    // 'home' | 'game'
    id: null, def: null, L: null, chapter: null, lastId: null,
    fixed: [], pieces: [], history: [],
    sim: null, version: 0,
    sel: null, valid: null, validWall: false, rot: {},
    hover: null, hoverMouse: false, cursor: null,
    ghost: null, hint: null, conflicts: null, lifted: null,
    previewSim: null, previewKey: null, dragBaseSim: null,
    // all pointer state lives here and is cleared by resetInput()
    input: { press: null, drag: null, tray: null, suppressClick: false, cancelledPointer: null },
    pops: {}, shake: null, flash: null, pulse: null, focus: null,
    won: false, winAt: null, winTimer: 0, winCardTimer: 0,
    newTool: null, reserve: 0,
    drawPieces: [], raf: 0, toastTimer: 0, tipTimer: 0, hoverTimer: 0, coachTimer: 0,
    pushedFromHome: false, lastSig: '', settleUntil: 0, paletteVersion: 0
  };
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
  function chapterPair(ch) {
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
    return ids[0] + '+' + ids[1];
  }

  function renderHome() {
    var frag = document.createDocumentFragment();
    var nextId = nextPlayableId();
    var shownLocked = false;
    CHAPTERS.forEach(function (ch) {
      var ids = [];
      for (var n = ch.first; n <= ch.last; n++) if (levelById(n)) ids.push(n);
      var done = ids.filter(isDone).length;
      var anyOpen = ids.some(isUnlocked);
      var label = 'Chapter ' + ch.n + ': ' + ch.title;
      var ic = el('canvas', 'ch-icon');
      ic.setAttribute('aria-hidden', 'true');
      if (ch.tool) R.icon(ic, 'tool', ch.tool, 40);
      else R.icon(ic, 'pair', chapterPair(ch), 40);

      if (!anyOpen && shownLocked) {
        // far away: one quiet line
        var row = el('section', 'chapter is-folded');
        row.setAttribute('aria-label', label + ', locked');
        row.appendChild(ic);
        var tt = el('div', 'ch-fold-title');
        tt.innerHTML = '<span>' + ch.n + ' · </span>' + esc(ch.title);
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
        if (isDone(id)) { b.classList.add('is-done'); al += ', solved'; }
        else if (isUnlocked(id)) { b.classList.add(id === nextId ? 'is-next' : 'is-open'); }
        if (!isUnlocked(id)) { b.disabled = true; al += ', locked'; }
        b.setAttribute('aria-label', al);
        b.title = def && def.name ? def.name : '';
        b.addEventListener('click', function () { Sound.unlock(); navigate(id); });
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
    updateSoundButton();
  }

  function updateSoundButton() {
    dom.sound.setAttribute('aria-pressed', store.sound ? 'true' : 'false');
    dom.sound.setAttribute('aria-label', store.sound ? 'Sound on' : 'Sound off');
    dom.soundLabel.textContent = store.sound ? 'Sound on' : 'Sound off';
  }

  dom.play.addEventListener('click', function () {
    Sound.unlock();
    var id = nextPlayableId();
    if (id == null && LEVELS.length) id = LEVELS[0].id;
    if (id != null) navigate(id);
  });
  dom.sound.addEventListener('click', function () {
    store.sound = !store.sound;
    saveStore();
    updateSoundButton();
    if (store.sound) Sound.tick();
  });
  dom.resetProgress.addEventListener('click', function () { openDialog(dom.confirm, dom.confirmNo); });
  dom.confirmNo.addEventListener('click', function () { closeDialog(dom.confirm); });
  dom.confirmYes.addEventListener('click', function () {
    store.completed = [];
    store.boards = {};
    store.seenTools = [];
    store.seenTips = [];
    saveStore();
    closeDialog(dom.confirm);
    G.lastId = null;
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
      delete store.boards[G.id];
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
    hideTooltip();
    hideToast();
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
    G.sel = null; G.valid = null; G.validWall = false; G.rot = {};
    G.hover = null; G.hoverMouse = false; G.cursor = null; G.ghost = null; G.hint = null; G.conflicts = null; G.lifted = null;
    G.previewSim = null; G.previewKey = null; G.dragBaseSim = null;
    G.pops = {}; G.shake = null; G.flash = null; G.pulse = null; G.focus = null; G.winAt = null;
    G.sim = WB.simulate(G.L, allPieces());
    G.won = G.sim.solved && isDone(id);
    G.version++;
    rebuildDrawPieces();

    dom.home.hidden = true;
    dom.game.hidden = false;
    document.title = id + ' · ' + (def.name || 'Level') + ' — Windbreaker';
    dom.lvlNum.textContent = String(id);
    dom.lvlName.textContent = def.name || 'Level ' + id;
    renderWind();
    if (def.tip) { dom.tip.textContent = def.tip; dom.tip.hidden = false; } else { dom.tip.hidden = true; }
    renderNewTool();
    renderTray();
    renderGoals();
    updateButtons();
    board.setLevel(G.L, id);
    G.reserve = 0;
    layoutBoard();
    startLoop();
    window.scrollTo(0, 0);
    // a saved board that already solves the level (closed mid-celebration, or
    // a redesigned level): let the normal win run so progress is recorded
    if (G.sim.solved && !isDone(id)) checkWin();
  }

  function restoreBoard(id) {
    var saved = store.boards[id];
    var out = [];
    if (!Array.isArray(saved)) return out;
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
    if (G.pieces.length) store.boards[G.id] = G.pieces.map(norm);
    else delete store.boards[G.id];
    saveStore();
  }

  function renderWind() {
    var w = G.L.wind;
    var calm = w.strength <= 0;
    dom.wind.classList.toggle('is-calm', calm);
    var glyph = dom.wind.querySelector('.wind-glyph');
    glyph.style.transform = 'rotate(' + ((w.dir - 1) * 90) + 'deg)';
    var chev = glyph.querySelectorAll('path');
    // chevrons light up from the front: 1 = gentle, 3 = gale
    for (var i = 0; i < chev.length; i++) chev[i].classList.toggle('on', i >= chev.length - w.strength);
    dom.wind.querySelector('.wind-word').textContent = STRENGTH_WORD[clamp(w.strength, 0, 3)];
    var label = calm ? 'Calm day, no wind' : 'Wind from the ' + DIR_WORD[w.from] + ', ' + STRENGTH_WORD[Math.min(3, w.strength)] + ' (strength ' + w.strength + ')';
    dom.wind.setAttribute('aria-label', label);
    dom.wind.title = label;
  }

  function firstSentence(s) {
    var m = /^(.+?[.!?])(\s|$)/.exec(s || '');
    return m ? m[1] : s;
  }
  function renderNewTool() {
    var ch = G.chapter;
    var tool = ch && ch.tool && G.id === ch.first ? ch.tool : null;
    G.newTool = tool && store.seenTools.indexOf(tool) < 0 ? tool : null;
    dom.newtool.classList.remove('is-leaving');
    if (!G.newTool) { dom.newtool.hidden = true; return; }
    var t = WB.TOOLS[tool];
    dom.newtoolTitle.textContent = t.name;
    dom.newtoolDesc.textContent = firstSentence(t.desc);
    dom.newtool.title = t.desc;
    R.icon(dom.newtoolIcon, 'tool', tool, 40);
    dom.newtool.hidden = false;
  }
  function markToolSeen() {
    if (G.newTool && store.seenTools.indexOf(G.newTool) < 0) {
      store.seenTools.push(G.newTool);
      saveStore();
    }
  }
  // Fades the card away. The board keeps its place (the reserved space stays
  // until the next level), so nothing jumps under the player's finger.
  function dismissNewTool() {
    if (!G.newTool) return;
    markToolSeen();
    G.newTool = null;
    updateTray();
    var card = dom.newtool;
    if (card.contains(document.activeElement)) dom.canvas.focus({ preventScroll: true });
    card.classList.add('is-leaving');
    setTimeout(function () { if (!G.newTool) { card.hidden = true; card.classList.remove('is-leaving'); } }, reducedMQ.matches ? 0 : 260);
  }
  dom.newtoolOk.addEventListener('click', dismissNewTool);

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
      b.appendChild(el('span', 'chip-count', '0'));
      b.title = t.name + (i < 10 ? ' (' + ((i + 1) % 10) + ')' : '');
      b.addEventListener('click', onChipClick);
      b.addEventListener('pointerdown', onChipDown);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      b.addEventListener('animationend', function () { b.classList.remove('is-shake'); });
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
      b.querySelector('.chip-count').textContent = String(n);
      b.disabled = n <= 0 && G.sel !== type;
      b.classList.toggle('is-selected', G.sel === type);
      b.classList.toggle('is-new', G.newTool === type);
      b.setAttribute('aria-pressed', G.sel === type ? 'true' : 'false');
      b.setAttribute('aria-label', toolName(type) + ', ' + n + ' left' + (G.sel === type ? ', selected' : ''));
    }
  }

  function onChipClick(e) {
    var type = this.getAttribute('data-tool');
    if (I.suppressClick) { I.suppressClick = false; return; }
    Sound.unlock();
    if (G.sel === type) { deselect(); return; }
    select(type);
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
    G.sel = type;
    G.valid = WB.placementCells(G.L, allPieces(), type);
    G.validWall = isWallMount(type);
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
    var best = null, bd = 1e9;
    for (var i = 0; i < valid.length; i++) {
      var v = valid[i];
      var dx = Math.max(v.x - c.fx, 0, c.fx - (v.x + 1)), dy = Math.max(v.y - c.fy, 0, c.fy - (v.y + 1));
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = v; }
    }
    return { x: best.x, y: best.y, d: bd };
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
      b.setAttribute('aria-label', name + ': ' + ok + ' of ' + mine.length + ' happy. Show on the board');
      b.title = name + ' — ' + WB.OBJECTS[type].desc;
    }
  }

  function goalText(g) {
    var name = WB.OBJECTS[g.type].name;
    if (g.type === 'stove') return name + ' — ' + (g.state === 'happy' ? 'smoke is cleared' : g.state === 'bad' ? 'smoke is trapped' : 'smoke needs a way out');
    return name + ' — ' + NEED[g.type] + ' · now ' + g.flow;
  }
  function focusGoal(type) {
    var goals = G.sim.goals.filter(function (g) { return g.type === type; });
    var off = goals.filter(function (g) { return !g.ok; });
    G.focus = { type: type, t0: performance.now() };
    var g = off[0] || goals[0];
    if (!g) return;
    var txt = goalText(g);
    if (!off.length) txt = (goals.length > 1 ? 'All ' + goals.length + ' ' + WB.OBJECTS[type].name.toLowerCase() + ' are happy' : WB.OBJECTS[type].name + ' is happy') + ' · ' + NEED[type].replace(/^$/, 'smoke is cleared');
    else if (off.length > 1) txt += ' (' + off.length + ' unhappy)';
    showToast(txt, null, null, { ms: 3200 });
  }

  function updateButtons() {
    dom.undo.disabled = G.history.length === 0;
    dom.reset.disabled = G.pieces.length === 0;
    var hasSolution = Array.isArray(G.def.solution) && G.def.solution.length > 0;
    dom.hint.disabled = !hasSolution;
    var showNext = G.won && dom.win.hidden && !G.winCardTimer;
    var idx = levelIndex(G.id);
    var nxt = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    dom.next.hidden = !showNext;
    dom.hint.hidden = showNext;
    dom.nextLabel.textContent = nxt ? 'Next level' : 'Levels';
  }
  dom.next.addEventListener('click', function () {
    var idx = levelIndex(G.id);
    var nxt = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    if (nxt) navigate(nxt.id, true); else goHome();
  });

  // ---------------------------------------------------------------- changes

  function snapshot() { return G.pieces.map(norm); }

  function commit(newPieces, opts) {
    opts = opts || {};
    if (!opts.noHistory) {
      G.history.push(snapshot());
      if (G.history.length > 200) G.history.shift();
    }
    G.pieces = newPieces;
    afterChange(opts);
  }

  function afterChange(opts) {
    opts = opts || {};
    G.version++;
    G.sim = WB.simulate(G.L, allPieces());
    G.previewSim = null; G.previewKey = null;
    if (!opts.keepHint) {
      if ((G.hint || G.conflicts) && dom.toast.getAttribute('data-kind') === 'hint') hideToast();
      G.hint = null;
      G.conflicts = null;
    }
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
  }

  function goalSummary() {
    var ok = G.sim.goals.filter(function (g) { return g.ok; }).length;
    return ok + ' of ' + G.sim.goals.length + ' happy.';
  }

  function place(type, x, y, d) {
    if (remaining(type) <= 0 || !WB.canPlace(G.L, allPieces(), type, x, y)) { nope(x, y); return false; }
    var p = { type: type, x: x, y: y, d: rotations(type) > 1 ? (d | 0) % rotations(type) : 0 };
    var first = G.pieces.length === 0;
    commit(G.pieces.concat([p]));
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
    announce(toolName(type) + ' placed. ' + goalSummary());
    coach(type, first);
    return true;
  }

  function movePiece(p, x, y) {
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: x, y: y, d: q.d } : q; });
    commit(np);
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
    announce(toolName(p.type) + ' moved. ' + goalSummary());
  }

  function removePiece(p, selectAfter) {
    commit(G.pieces.filter(function (q) { return q !== p; }));
    Sound.whoosh();
    announce(toolName(p.type) + ' back in the tray. ' + goalSummary());
    if (selectAfter && remaining(p.type) > 0) select(p.type);
  }

  function rotatePiece(p) {
    var nd = WB.rotate(p.type, p.d);
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: q.x, y: q.y, d: nd } : q; });
    G.rot[p.type] = nd;
    commit(np);
    G.pops[p.x + ',' + p.y] = performance.now();
    Sound.turn();
    announce(toolName(p.type) + ' turned. ' + goalSummary());
  }

  function undo() {
    if (!G.history.length || I.drag) return;
    G.pieces = G.history.pop();
    afterChange({});
    Sound.whoosh();
    announce('Undone. ' + goalSummary());
  }
  function resetLevel() {
    if (!G.pieces.length || I.drag) return;
    commit([]);
    Sound.whoosh();
    showToast('Board cleared.', 'Undo', undo, { ms: 6000 });
  }

  function nope(x, y) {
    G.shake = { x: x, y: y, t0: performance.now() };
    if (!playerAt(x, y) && !fixedAt(x, y)) G.flash = { x: x, y: y, t0: performance.now() };
    Sound.nope();
  }

  // One-time coaching for moving, removing and turning pieces.
  function coach(type, firstOnBoard) {
    if (G.sim.solved) return;
    var touch = coarseMQ.matches;
    var msg = null, key = null;
    if (rotations(type) > 1 && !seenTip('turn')) {
      key = 'turn';
      msg = (touch ? 'Tap' : 'Click') + ' the ' + toolName(type).toLowerCase() + ' to turn it.';
    } else if (!seenTip('move') && !firstOnBoard) {
      key = 'move';
      msg = touch ? 'Drag a piece to move it · press and hold to remove it.' : 'Drag a piece to move it · right-click to remove it.';
    }
    if (!msg || (!dom.toast.hidden && dom.toast.getAttribute('data-kind') === 'hint')) return;
    clearTimeout(G.coachTimer);
    G.coachTimer = setTimeout(function () {
      if (G.screen !== 'game' || G.sim.solved || G.won) return;
      store.seenTips.push(key);
      saveStore();
      showToast(msg, null, null, { ms: 5200, kind: 'coach' });
    }, 500);
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
    markDone(G.id);
    dismissNewTool(); // an overlay: fading it never moves the board
    delete store.boards[G.id];
    saveStore();
    resetInput();
    deselect();
    hideToast();
    hideTooltip();
    clearTimeout(G.coachTimer);
    G.hint = null; G.conflicts = null; G.cursor = null;
    Sound.chime();
    announce('Fresh air! Level ' + G.id + ' solved.');
    var id = G.id;
    clearTimeout(G.winCardTimer);
    G.winCardTimer = setTimeout(function () {
      G.winCardTimer = 0;
      if (G.screen === 'game' && G.id === id && G.won) showWinCard();
      else updateButtons();
    }, reducedMQ.matches ? 300 : 1250);
    updateButtons();
  }

  function showWinCard() {
    closeDialog(dom.helpDlg, true);
    closeDialog(dom.confirm, true);
    var idx = levelIndex(G.id);
    var next = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    var allDone = LEVELS.every(function (l) { return isDone(l.id); });
    dom.winSub.textContent = 'Level ' + G.id + (G.def.name ? ' · ' + G.def.name : '') + ' solved';
    // chapter progress
    dom.winDots.textContent = '';
    var ch = G.chapter;
    if (ch) {
      for (var n = ch.first; n <= ch.last; n++) {
        if (!levelById(n)) continue;
        var dot = el('i', (isDone(n) ? 'on' : '') + (n === G.id ? ' now' : ''));
        dom.winDots.appendChild(dot);
      }
    }
    dom.winDots.hidden = !ch;
    // tease the next chapter's new tool
    var nch = next ? chapterOf(next.id) : null;
    if (nch && ch && nch !== ch && nch.tool && nch.first === next.id) {
      dom.winTeaser.hidden = false;
      R.icon(dom.winTeaserIcon, 'tool', nch.tool, 34);
      dom.winTeaserText.innerHTML = 'Next chapter: <b>new tool — ' + esc(toolName(nch.tool)) + '</b>';
    } else {
      dom.winTeaser.hidden = true;
    }
    var last = !next;
    dom.winFinal.hidden = !last;
    dom.winFinal.textContent = allDone
      ? 'You finished all ' + LEVELS.length + ' levels. Thank you for playing — every room is full of fresh air.'
      : 'That was the last level! A few earlier rooms are still waiting for a breeze.';
    dom.winNext.hidden = last;
    dom.winLevels.classList.toggle('btn-primary', last);
    dom.winNext.onclick = next ? function () { closeDialog(dom.win, true); navigate(next.id, true); } : null;
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

  function hint() {
    if (dom.hint.disabled || dom.hint.hidden) return;
    var sol = (G.def.solution || []).map(norm);
    hideTooltip();
    if (!sol.length) { showToast('No hint for this one — experiment!'); return; }
    if (G.sim.solved) { showToast('Everything is already happy.'); return; }
    function same(a, b) {
      return a.type === b.type && a.x === b.x && a.y === b.y && (rotations(a.type) < 2 || a.d === b.d);
    }
    var mine = G.pieces;
    var conflicts = mine.filter(function (p) { return !sol.some(function (s) { return same(s, p); }); });
    var missing = sol.filter(function (s) { return !mine.some(function (p) { return same(s, p); }); });
    var nextP = missing[0] || null;
    if (conflicts.length) {
      var wrongTurn = conflicts.length === 1 && nextP && conflicts[0].x === nextP.x && conflicts[0].y === nextP.y && conflicts[0].type === nextP.type;
      if (wrongTurn) {
        G.hint = nextP;
        G.conflicts = null;
        showToast('Almost — try turning this ' + toolName(nextP.type).toLowerCase() + '.', null, null, { kind: 'hint' });
        return;
      }
      G.hint = null;
      G.conflicts = conflicts.map(function (p) { return { x: p.x, y: p.y }; });
      showToast(conflicts.length === 1
        ? 'This piece isn’t part of the solution I know.'
        : 'These ' + conflicts.length + ' pieces aren’t part of the solution I know.',
      conflicts.length === 1 ? 'Remove it' : 'Remove them (' + conflicts.length + ')', function () {
        commit(G.pieces.filter(function (p) { return conflicts.indexOf(p) < 0; }));
        Sound.whoosh();
        hint();
      }, { kind: 'hint', ms: 10000 });
      return;
    }
    if (nextP) {
      G.hint = nextP;
      var how = '';
      if (nextP.type === 'fan') how = ', blowing ' + DIR_WORD[nextP.d];
      else if (nextP.type === 'deflector') how = nextP.d === 0 ? ', slanted like /' : ', slanted like \\';
      showToast('Try a ' + toolName(nextP.type).toLowerCase() + ' here' + how + '.', null, null, { kind: 'hint' });
    }
  }

  // ---------------------------------------------------------------- toast / tooltip

  function showToast(text, actionLabel, actionFn, opts) {
    opts = opts || {};
    clearTimeout(G.toastTimer);
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
    dom.toast.hidden = false;
    G.toastTimer = setTimeout(hideToast, opts.ms || (actionLabel ? 9000 : 5000));
  }
  function hideToast() {
    clearTimeout(G.toastTimer);
    dom.toast.hidden = true;
    G.conflicts = null;
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

  // What is at (x,y), and how much air reaches it. withActions adds a dim
  // line telling a mouse user what they can do with their own pieces.
  function describe(x, y, withActions) {
    var L = G.L, sim = currentSim();
    var ch = WB.cellAt(L, x, y);
    var floorish = WB.isFloorish(ch);
    var f = floorish ? sim.flow[y * L.w + x] : 0;
    var p = playerAt(x, y), fixed = false;
    if (!p) { p = fixedAt(x, y); fixed = !!p; }
    var flowBit = function () { return ' <span class="tt-dim">· ' + (f ? 'flow ' + f : 'still air') + '</span>'; };
    if (p) {
      var name = toolName(p.type), s = '';
      switch (p.type) {
        case 'window':
          if (WB.windowRole(L, p) === 'inlet') {
            var tr = null;
            sim.trees.forEach(function (t) { if (t.kind === 'inlet' && t.source.x === p.x && t.source.y === p.y) tr = t; });
            s = 'inlet, facing the wind' + (tr && !tr.active ? ' <span class="tt-dim">· no way out yet</span>' : '');
          } else s = 'outlet, lets air out';
          break;
        case 'fan': s = 'blowing ' + DIR_WORD[p.d] + flowBit(); break;
        case 'deflector': s = 'turns air 90°' + flowBit(); break;
        case 'curtain': s = 'softens air by 1' + flowBit(); break;
        case 'vent': s = 'air passes through'; break;
        case 'splitter': s = 'splits air in two' + flowBit(); break;
        case 'extractor': s = 'outlet, pulls air'; break;
        case 'skylight': s = 'outlet through the roof'; break;
        case 'filter': s = 'cleans smoke' + flowBit(); break;
        case 'ceilingfan': s = 'blows all four ways' + flowBit(); break;
      }
      var html = '<b>' + name + '</b> — ' + s + (fixed ? ' <span class="tt-dim">· fixed</span>' : '');
      if (withActions && !fixed) {
        html += '<span class="tt-act">' + (rotations(p.type) > 1 ? 'click to turn' : 'click to pick up') + ' · drag to move · right-click to remove</span>';
      }
      return html;
    }
    var oi = objectAt(x, y);
    if (oi >= 0) {
      var ob = L.objects[oi], g = sim.goals[oi];
      var oname = WB.OBJECTS[ob.type].name;
      if (ob.type === 'stove') {
        var st = g.state === 'happy' ? 'smoke is cleared' : g.state === 'bad' ? 'smoke is trapped' : 'smoke needs a way out';
        return '<b>' + oname + '</b> — ' + st;
      }
      return '<b>' + oname + '</b> — ' + NEED[ob.type] + ' <span class="tt-dim">· now ' + g.flow + '</span>';
    }
    if (ch === '.') return '<b>Floor</b> — ' + (f ? 'flow ' + f : 'still air');
    if (ch === 'o') return '<b>Table</b> — ' + (f ? 'flow ' + f : 'still air') + ' <span class="tt-dim">· nothing fits here</span>';
    if (ch === '%') return '<b>Solid wall</b> <span class="tt-dim">· nothing can be mounted</span>';
    if (ch === '#') {
      if (WB.outwardDir(L, x, y) >= 0) return '<b>Outside wall</b> <span class="tt-dim">· windows fit here</span>';
      var inner = true;
      for (var d = 0; d < 4; d++) if (WB.isOutside(WB.cellAt(L, x + WB.DX[d], y + WB.DY[d]))) inner = false;
      return '<b>Wall</b>' + (inner ? ' <span class="tt-dim">· inside</span>' : '');
    }
    var w = L.wind;
    return '<b>Garden</b> — ' + (w.strength > 0 ? 'wind from the ' + DIR_WORD[w.from] + ', ' + STRENGTH_WORD[Math.min(3, w.strength)] : 'a calm day');
  }

  function showTooltipAt(x, y, html, ms) {
    var tt = dom.tooltip;
    tt.innerHTML = html;
    tt.hidden = false;
    var rect = board.cellRect(x, y);
    var cx = dom.canvas.offsetLeft + rect.left + rect.size / 2;
    var top = dom.canvas.offsetTop + rect.top;
    tt.style.left = '0px';
    var w = tt.offsetWidth, h = tt.offsetHeight;
    var sw = dom.stage.clientWidth;
    var left = Math.max(8, Math.min(sw - w - 8, cx - w / 2));
    var ty = top - h - 6;
    if (ty < 4) ty = top + rect.size + 6;
    tt.style.left = left + 'px';
    tt.style.top = ty + 'px';
    clearTimeout(G.tipTimer);
    if (ms) G.tipTimer = setTimeout(hideTooltip, ms);
  }
  function hideTooltip() {
    clearTimeout(G.tipTimer);
    clearTimeout(G.hoverTimer);
    dom.tooltip.hidden = true;
  }

  var MOUNT_HELP = {
    exterior: 'fits in an outside wall',
    floor: 'needs an empty floor tile',
    interior: 'fits in an inside wall, between two spaces'
  };
  function mountHelp() {
    var t = WB.TOOLS[G.sel];
    if (!t) return;
    G.pulse = performance.now();
    showToast(t.name + ' ' + MOUNT_HELP[t.mount] + ' — try a highlighted spot.', null, null, { ms: 2600 });
  }

  // ---------------------------------------------------------------- board input

  function boardLocked() {
    return G.screen !== 'game' || !dom.win.hidden || !!G.winCardTimer;
  }

  function onBoardDown(e) {
    if (boardLocked() || !e.isPrimary) return;
    Sound.unlock();
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
      piece: c.inMap ? playerAt(c.x, c.y) : null, longFired: false, timer: 0
    };
    if (e.pointerType !== 'mouse') I.press.timer = setTimeout(onLongPress, 450);
    hideTooltip();
  }

  function onLongPress() {
    var pr = I.press;
    if (!pr || G.screen !== 'game' || boardLocked()) return;
    pr.longFired = true;
    var c = pr.cell;
    if (pr.piece && G.pieces.indexOf(pr.piece) >= 0) {
      removePiece(pr.piece, false);
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
      showTooltipAt(c.x, c.y, '<b>' + toolName(pr.piece.type) + '</b> — back in the tray', 1400);
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
      if (!pr.piece) G.tipTimer = setTimeout(hideTooltip, 1200);
      return;
    }
    var c = board.pick(e.clientX, e.clientY);
    // a slightly sloppy tap still counts for the cell it started on
    if (c.x !== pr.cell.x || c.y !== pr.cell.y) {
      if (Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) > 14) return;
      c = pr.cell;
    }
    tapCell(c, pr.type);
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

  function tapCell(c, ptype) {
    var pp = c.inMap ? playerAt(c.x, c.y) : null, fp = c.inMap ? fixedAt(c.x, c.y) : null;
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
        rotatePiece(pp);
        if (ptype !== 'mouse') showTooltipAt(x, y, describe(x, y), 1500);
      } else {
        removePiece(pp, true);
        if (ptype !== 'mouse') showTooltipAt(x, y, '<b>' + toolName(type) + '</b> — back in the tray', 1400);
      }
      return;
    }
    if (fp) { fixedTap(c.x, c.y); return; }
    if (!c.inMap) {
      if (ptype !== 'mouse' && c.onCanvas) showTooltipAt(clamp(c.x, 0, G.L.w - 1), clamp(c.y, 0, G.L.h - 1), describe(c.x, c.y), 2200);
      return;
    }
    showTooltipAt(c.x, c.y, describe(c.x, c.y), 2600);
  }

  function fixedTap(x, y) {
    G.shake = { x: x, y: y, t0: performance.now() };
    showTooltipAt(x, y, describe(x, y), 2400);
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

  // Where the dragged piece is, in client coords. A moved piece stays anchored
  // where it was grabbed; on touch it only lifts above the finger once the
  // drag is clearly under way, so a sloppy tap never shifts it a cell.
  function dragPoint(e) {
    var d = I.drag;
    var T = board.T;
    d.travel = Math.max(d.travel || 0, Math.hypot(e.clientX - (d.x0 == null ? e.clientX : d.x0), e.clientY - (d.y0 == null ? e.clientY : d.y0)));
    var lift = touchy(d.ptype) ? Math.min(40, T * 0.9) : 0;
    if (d.kind === 'move') {
      var k = touchy(d.ptype) ? clamp((d.travel - 0.5 * T) / (0.5 * T), 0, 1) : 0;
      return { x: e.clientX + d.gx * (1 - k), y: e.clientY + d.gy * (1 - k) - lift * k };
    }
    return { x: e.clientX, y: e.clientY - lift };
  }

  function updateDrag(e) {
    var d = I.drag;
    var pt = dragPoint(e);
    var c = board.pick(pt.x, pt.y);
    d.last = c;
    var tgt = snapTarget(c, d.valid);
    var near = c.inMap || (tgt && tgt.d <= 1);
    if (tgt && tgt.d <= snapTol(c)) {
      G.ghost = { type: d.type, x: tgt.x, y: tgt.y, d: d.d | 0, ok: true };
      d.target = tgt;
    } else {
      d.target = null;
      G.ghost = c.inMap ? { type: d.type, x: c.x, y: c.y, d: d.d | 0, ok: false } : null;
    }
    updatePreview();
    dom.avatar.hidden = !!(G.ghost && G.ghost.ok);
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
    var lifted = G.lifted;
    G.lifted = null;
    rebuildDrawPieces();
    if (d.kind === 'move') {
      if (d.travel < Math.max(0.5 * board.T, 18)) {
        // never went anywhere: it was a (sloppy) tap
        tapCell({ x: lifted.x, y: lifted.y, inMap: true, onCanvas: true }, d.ptype);
      } else if (overTray(e)) {
        removePiece(lifted, false);
      } else if (tgt) {
        if (tgt.x === lifted.x && tgt.y === lifted.y) { /* dropped where it was */ }
        else movePiece(lifted, tgt.x, tgt.y);
      } else if (c.inMap) {
        nope(lifted.x, lifted.y);
      } else {
        removePiece(lifted, false);
      }
    } else {
      if (tgt) place(d.type, tgt.x, tgt.y, d.d);
      else if (c.inMap) nope(c.x, c.y);
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
    if (G.screen === 'game' && G.sim) updateGoals();
  }

  function onChipDown(e) {
    if (I.drag || I.press || I.tray || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (boardLocked()) return;
    var type = this.getAttribute('data-tool');
    Sound.unlock();
    if (remaining(type) <= 0) return;
    I.tray = { type: type, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, el: this, ptype: e.pointerType };
    try { this.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
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
      if (dist > 8 && intent) {
        I.tray = null;
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
  });
  window.addEventListener('pointercancel', function (e) {
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
  dom.reset.addEventListener('click', resetLevel);
  dom.hint.addEventListener('click', function () { Sound.unlock(); hint(); });
  dom.help.addEventListener('click', openHelp);
  dom.helpClose.addEventListener('click', function () { closeDialog(dom.helpDlg); });
  dom.helpDlg.addEventListener('click', function (e) { if (e.target === dom.helpDlg) closeDialog(dom.helpDlg); });

  // ---------------------------------------------------------------- help

  function cv(kind, id, size, cls) {
    return '<canvas class="' + (cls || '') + '" data-icon="' + kind + '" data-id="' + id + '" data-size="' + size + '" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true"></canvas>';
  }

  function openHelp() {
    var n = G.id || 1;
    var h = [];
    var inLevel = {};
    if (G.L) {
      Object.keys(G.L.inventory).forEach(function (t) { if (G.L.inventory[t] > 0) inLevel[t] = true; });
      G.fixed.forEach(function (p) { inLevel[p.type] = true; });
      G.L.objects.forEach(function (o) { inLevel[o.type] = true; });
    }
    function has(o) { return WB.OBJECTS[o].intro <= n || inLevel[o]; }
    h.push('<p>Make <b>every object</b> in the house happy at the same time by placing the tools from your tray. Tap or hover anything to see how much air reaches it.</p>');
    h.push('<ul class="help-rules">');
    h.push('<li><span class="rule-ico">' + cv('swirl', 'w', 28) + '</span><span><b>Wind</b> blows across the garden. The badge at the top shows which way it blows and how strong it is.</span></li>');
    h.push('<li><span class="rule-ico">' + cv('ui', 'inlet', 34) + '</span><span>A <b>window facing the wind</b> is an inlet: a bright pane with arrows pointing in. Every other window is an <b>outlet</b> ' + cv('ui', 'outlet', 22, 'inl') + ' that lets air out.</span></li>');
    h.push('<li><span class="rule-ico">' + cv('ui', 'stall', 34) + '</span><span><b>A breeze only flows if it has a way out.</b> An inlet with no outlet stays still: its path is a faint dashed line ending in a red ×.</span></li>');
    h.push('<li><span class="rule-ico">' + cv('ui', 'lanes-2', 34) + '</span><span><b>Strength</b> is the number of lines in a stream: one is a gentle breeze, two is strong, three is a gale. Streams going the same way add up.</span></li>');
    if (n >= WB.OBJECTS.stove.intro || inLevel.stove) h.push('<li><span class="rule-ico">' + cv('object', 'stove', 30) + '</span><span><b>Smoke</b> from a stove must be carried outside (or through a filter), never blown into a wall.</span></li>');
    h.push('<li><span class="rule-ico">' + cv('ui', 'pip-happy', 30) + '</span><span>The dot on each object shows how it feels: ' + cv('ui', 'pip-idle', 18, 'inl') + ' wants air, ' + cv('ui', 'pip-happy', 18, 'inl') + ' happy, ' + cv('ui', 'pip-bad', 18, 'inl') + ' unhappy.</span></li>');
    if (has('laundry') || has('papers') || has('fern')) {
      var ms = [];
      if (has('laundry')) ms.push(cv('ui', 'meter-laundry-1-idle', 34, 'inl') + ' laundry wants two or more');
      if (has('papers')) ms.push(cv('ui', 'meter-papers-0-happy', 34, 'inl') + ' papers take one at most');
      if (has('fern')) ms.push(cv('ui', 'meter-fern-1-happy', 34, 'inl') + ' a fern wants exactly one');
      h.push('<li><span class="rule-ico">' + cv('ui', 'meter-laundry-2-happy', 34) + '</span><span>Some things are picky. Their <b>meter</b> fills with the air that reaches them: ' + ms.join(', ') + '. A red dot means too much.</span></li>');
    }
    h.push('</ul>');

    var tools = WB.TOOL_ORDER.filter(function (t) { return WB.TOOLS[t].intro <= n || inLevel[t]; });
    if (tools.length) {
      h.push('<h3>Tools</h3><ul class="gloss">');
      tools.forEach(function (t) {
        h.push('<li>' + cv('tool', t, 40) + '<div><div class="gloss-name">' + esc(WB.TOOLS[t].name) + '</div><div class="gloss-desc">' + esc(WB.TOOLS[t].desc) + '</div></div></li>');
      });
      h.push('</ul>');
    }
    var objs = WB.OBJECT_ORDER.filter(has);
    if (objs.length) {
      h.push('<h3>Things in the house</h3><ul class="gloss">');
      objs.forEach(function (o) {
        h.push('<li>' + cv('object', o, 40) + '<div><div class="gloss-name">' + esc(WB.OBJECTS[o].name) + '</div><div class="gloss-desc">' + esc(WB.OBJECTS[o].desc) + '</div></div></li>');
      });
      h.push('</ul>');
    }
    h.push('<h3>Controls</h3><dl class="keys">');
    h.push('<dt>Tap a tool</dt><dd>select it, then tap a highlighted spot — or drag it onto the board</dd>');
    h.push('<dt>Tap a piece</dt><dd>turn it (fans, deflectors) or pick it up</dd>');
    h.push('<dt>Drag a piece</dt><dd>move it; drop it off the board to put it back</dd>');
    h.push('<dt>Hold / right-click</dt><dd>remove a piece</dd>');
    h.push('<dt><kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd></dt><dd>select a tool</dd>');
    h.push('<dt><kbd>R</kbd></dt><dd>turn the piece under the pointer</dd>');
    h.push('<dt><kbd>H</kbd></dt><dd>hint</dd>');
    h.push('<dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>undo</dd>');
    h.push('<dt><kbd>Esc</kbd></dt><dd>deselect / close</dd>');
    h.push('<dt>Arrows, <kbd>Enter</kbd></dt><dd>move around the board and place or turn</dd>');
    h.push('<dt><kbd>Delete</kbd></dt><dd>remove the piece under the keyboard cursor</dd>');
    h.push('</dl>');
    dom.helpBody.innerHTML = h.join('');
    paintIcons(dom.helpBody);
    openDialog(dom.helpDlg, dom.helpClose);
    dom.helpBody.scrollTop = 0;
  }
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
    if (d === dom.win && G.screen === 'game') {
      updateButtons();
      if (!silent && !dom.next.hidden) dom.next.focus();
    }
  }
  function topDialog() {
    return dialogStack.length ? dialogStack[dialogStack.length - 1].d : null;
  }

  // ---------------------------------------------------------------- keyboard

  document.addEventListener('keydown', function (e) {
    var dlg = topDialog();
    if (dlg) {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(dlg); }
      else if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(dlg.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Escape') {
      if (I.drag) { cancelDrag(); return; }
      if (G.sel) { deselect(); return; }
      if (!dom.toast.hidden) { hideToast(); G.hint = null; return; }
      if (G.newTool) { dismissNewTool(); return; }
      hideTooltip();
      return;
    }
    if (boardLocked()) return;
    if (/^[0-9]$/.test(k)) {
      var chips = dom.tray.querySelectorAll('.chip');
      var chip = chips[k === '0' ? 9 : parseInt(k, 10) - 1];
      if (chip) {
        var type = chip.getAttribute('data-tool');
        if (G.sel === type) deselect();
        else if (remaining(type) > 0) select(type);
        else { Sound.nope(); chip.classList.remove('is-shake'); void chip.offsetWidth; chip.classList.add('is-shake'); }
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
        showTooltipAt(cur.x, cur.y, describe(cur.x, cur.y), 0);
        return;
      }
      if ((k === 'Enter' || k === ' ') && G.cursor) {
        e.preventDefault();
        tapCell({ x: G.cursor.x, y: G.cursor.y, fx: G.cursor.x + 0.5, fy: G.cursor.y + 0.5, inMap: true, onCanvas: true }, 'keyboard');
        if (G.cursor) showTooltipAt(G.cursor.x, G.cursor.y, describe(G.cursor.x, G.cursor.y), 0);
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
    // keep the house clear of the "New tool" card; once reserved for a level,
    // the space stays so dismissing the card never moves the board
    if (!dom.newtool.hidden) G.reserve = Math.max(G.reserve, dom.newtool.offsetTop + dom.newtool.offsetHeight - pt + 4);
    var before = board.T + ',' + board.ox + ',' + board.oy;
    board.layout(w, h, G.reserve);
    if (before !== board.T + ',' + board.ox + ',' + board.oy) hideTooltip();
  }

  function drawSig() {
    var gh = G.ghost, hv = G.hover, cu = G.cursor;
    return [
      G.version, G.sel, gh ? gh.type + gh.x + ',' + gh.y + gh.d + gh.ok : '', hv && G.hoverMouse && !G.sel ? hv.x + ',' + hv.y : '',
      cu ? cu.x + ',' + cu.y : '', G.hint ? G.hint.x + ',' + G.hint.y : '', G.conflicts ? G.conflicts.length : 0,
      G.flash ? G.flash.t0 : 0, G.shake ? G.shake.t0 : 0, G.pulse || 0, G.focus ? G.focus.t0 : 0, G.winAt || 0,
      G.previewKey, I.drag ? 1 : 0, board.T, board.cssW, board.cssH, board.dpr, G.paletteVersion,
      dom.helpDlg.hidden && dom.confirm.hidden ? 0 : 1
    ].join('|');
  }

  function frame(now) {
    G.raf = 0;
    if (G.screen !== 'game' || document.hidden) return;
    G.raf = requestAnimationFrame(frame);
    var blocking = !dom.helpDlg.hidden || !dom.confirm.hidden;
    var reduced = reducedMQ.matches;
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
    var valid = I.drag ? I.drag.valid : (G.sel ? G.valid : null);
    board.draw({
      pieces: G.drawPieces,
      sim: sim,
      valid: valid,
      validWall: I.drag ? I.drag.wall : G.validWall,
      ghost: G.ghost,
      hint: G.hint,
      conflicts: G.conflicts,
      hover: !G.sel && !I.drag && G.hoverMouse && G.hover && G.hover.inMap ? G.hover : null,
      cursor: G.cursor,
      focus: G.focus,
      pops: G.pops,
      shake: G.shake,
      flash: G.flash,
      pulse: G.pulse,
      win: G.won ? G.winAt : null,
      reduced: reducedMQ.matches
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
      if (G.newTool) R.icon(dom.newtoolIcon, 'tool', G.newTool, 40);
      if (!dom.helpDlg.hidden) paintIcons(dom.helpBody);
    } else if (G.screen === 'home') {
      renderHome();
    }
  }
  onMQ(darkMQ, function () {
    board.refreshPalette();
    G.paletteVersion++;
    refreshIcons();
  });
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
    solve: function () { commit((G.def.solution || []).map(norm)); }
  };

  // ================================================================== boot

  (function boot() {
    var q = parseInt(params.get('level'), 10);
    if (q && levelById(q) && isUnlocked(q)) {
      try { history.replaceState({ id: q }, '', location.pathname + location.search + '#' + q); } catch (e) { /* ignore */ }
    }
    route();
  })();
})();
