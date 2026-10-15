/*
 * Windbreaker — screens, state, input, persistence and audio.
 * Depends on window.WB (engine + levels) and window.WBRender.
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

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function mq(q) {
    try { return window.matchMedia(q); } catch (e) { return { matches: false, addEventListener: function () {} }; }
  }
  function onMQ(m, fn) {
    if (m.addEventListener) m.addEventListener('change', fn);
    else if (m.addListener) m.addListener(fn);
  }
  var reducedMQ = mq('(prefers-reduced-motion: reduce)');
  var darkMQ = mq('(prefers-color-scheme: dark)');

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = { has: function () { return false; }, get: function () { return null; } }; }
  var UNLOCK_ALL = params.has('unlock');

  // ================================================================== storage

  var store = loadStore();

  function loadStore() {
    var s = { completed: [], boards: {}, sound: true, seenTools: [] };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (Array.isArray(d.completed)) s.completed = d.completed.filter(function (n) { return typeof n === 'number'; });
          if (d.boards && typeof d.boards === 'object') s.boards = d.boards;
          if (typeof d.sound === 'boolean') s.sound = d.sound;
          if (Array.isArray(d.seenTools)) s.seenTools = d.seenTools.filter(function (n) { return typeof n === 'string'; });
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
        tone(220, a.currentTime + 0.005, 0.12, 'sine', 0.07, 180);
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
    tip: $('tip'), stage: $('stage'), canvas: $('board'), tooltip: $('tooltip'),
    toast: $('toast'), toastText: $('toast-text'), toastAction: $('toast-action'), toastClose: $('toast-close'),
    newtool: $('newtool'), newtoolIcon: $('newtool-icon'), newtoolTitle: $('newtool-title'), newtoolDesc: $('newtool-desc'), newtoolOk: $('newtool-ok'),
    goals: $('goals'), undo: $('btn-undo'), reset: $('btn-reset'), hint: $('btn-hint'), tray: $('tray'),
    avatar: $('drag-avatar'),
    win: $('win'), winSub: $('win-sub'), winFinal: $('win-final'), winNext: $('win-next'), winLevels: $('win-levels'),
    helpDlg: $('help'), helpBody: $('help-body'), helpClose: $('help-close'),
    confirm: $('confirm'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no')
  };

  var board = new R.Board(dom.canvas);

  // ================================================================== game state

  var G = {
    screen: 'home',
    id: null, def: null, L: null, chapter: null,
    fixed: [], pieces: [], history: [],
    sim: null, version: 0,
    sel: null, valid: null, rot: {},
    hover: null, hoverMouse: false, cursor: null,
    ghost: null, hint: null, lifted: null,
    drag: null, press: null, trayPress: null, suppressClick: false,
    previewSim: null, previewKey: null, dragBaseSim: null,
    pops: {}, shake: null,
    won: false, winAt: null, winTimer: 0, winCardTimer: 0,
    drawPieces: [], raf: 0, toastTimer: 0, tipTimer: 0, hoverTimer: 0
  };

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
  function defaultRot(type) {
    if (G.rot[type] != null) return G.rot[type];
    if (type === 'fan') return G.L.wind.strength > 0 ? G.L.wind.dir : 1;
    return 0;
  }
  function rebuildDrawPieces() {
    var list = [];
    G.fixed.forEach(function (p) { list.push({ type: p.type, x: p.x, y: p.y, d: p.d, fixed: true }); });
    G.pieces.forEach(function (p) { if (p !== G.lifted) list.push({ type: p.type, x: p.x, y: p.y, d: p.d, fixed: false }); });
    G.drawPieces = list;
  }

  // ================================================================== routing

  function navigate(id, replace) {
    var url = location.pathname + location.search + (id ? '#' + id : '');
    try {
      if (replace) history.replaceState({ id: id }, '', url);
      else history.pushState({ id: id }, '', url);
    } catch (e) { /* file:// quirks: just route */ }
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
    } else {
      showHome();
    }
  }

  // ================================================================== home

  function showHome() {
    leaveGame();
    G.screen = 'home';
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

  function renderHome() {
    var frag = document.createDocumentFragment();
    var nextId = nextPlayableId();
    CHAPTERS.forEach(function (ch) {
      var ids = [];
      for (var n = ch.first; n <= ch.last; n++) if (levelById(n)) ids.push(n);
      var done = ids.filter(isDone).length;
      var anyOpen = ids.some(isUnlocked);
      var sec = el('section', 'chapter' + (anyOpen ? '' : ' is-locked'));
      sec.setAttribute('aria-label', 'Chapter ' + ch.n + ': ' + ch.title);
      var head = el('div', 'ch-head');
      var ic = el('canvas', 'ch-icon');
      ic.setAttribute('aria-hidden', 'true');
      R.icon(ic, ch.tool ? 'tool' : 'swirl', ch.tool, 40);
      head.appendChild(ic);
      var titles = el('div', 'ch-titles');
      titles.appendChild(el('div', 'ch-kicker', 'Chapter ' + ch.n + (ch.tool ? ' · ' + WB.TOOLS[ch.tool].name : '')));
      titles.appendChild(el('div', 'ch-title', ch.title));
      head.appendChild(titles);
      head.appendChild(el('div', 'ch-count' + (done === ids.length && ids.length ? ' is-done' : ''), done + '/' + ids.length));
      sec.appendChild(head);
      var row = el('div', 'ch-levels');
      ids.forEach(function (id) {
        var b = el('button', 'lvl', String(id));
        b.type = 'button';
        b.setAttribute('data-level', id);
        var lv = levelById(id);
        var label = 'Level ' + id + (lv && lv.name ? ', ' + lv.name : '');
        if (isDone(id)) { b.classList.add('is-done'); label += ', solved'; }
        else if (isUnlocked(id)) { b.classList.add(id === nextId ? 'is-next' : 'is-open'); }
        if (!isUnlocked(id)) { b.disabled = true; label += ', locked'; }
        b.setAttribute('aria-label', label);
        b.title = lv && lv.name ? lv.name : '';
        b.addEventListener('click', function () { Sound.unlock(); navigate(id); });
        row.appendChild(b);
      });
      sec.appendChild(row);
      frag.appendChild(sec);
    });
    dom.chapters.textContent = '';
    dom.chapters.appendChild(frag);

    var solved = LEVELS.filter(function (l) { return isDone(l.id); }).length;
    if (!LEVELS.length) {
      dom.play.textContent = 'No levels';
      dom.play.disabled = true;
    } else if (solved === 0) {
      dom.play.textContent = 'Play';
    } else if (nextId != null) {
      dom.play.textContent = 'Continue · Level ' + nextId;
    } else {
      dom.play.textContent = 'Play again';
    }
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
    saveStore();
    closeDialog(dom.confirm);
    G.lastId = null;
    renderHome();
    dom.play.focus();
  });

  // ================================================================== game screen

  function leaveGame() {
    clearTimeout(G.winTimer);
    clearTimeout(G.winCardTimer);
    clearTimeout(G.toastTimer);
    clearTimeout(G.tipTimer);
    clearTimeout(G.hoverTimer);
    stopLoop();
    cancelDrag();
    hideTooltip();
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
    G.sel = null; G.valid = null; G.rot = {};
    G.hover = null; G.cursor = null; G.ghost = null; G.hint = null; G.lifted = null;
    G.drag = null; G.press = null; G.previewSim = null;
    G.pops = {}; G.shake = null; G.flash = null; G.winAt = null;
    G.sim = WB.simulate(G.L, allPieces());
    G.won = G.sim.solved; // a restored board that is already solved does not re-trigger the win card
    G.version++;
    rebuildDrawPieces();

    dom.home.hidden = true;
    dom.game.hidden = false;
    document.title = id + ' · ' + (def.name || 'Level') + ' — Windbreaker';
    dom.lvlNum.textContent = String(id);
    dom.lvlName.textContent = def.name || 'Level ' + id;
    renderWind();
    if (def.tip) { dom.tip.textContent = def.tip; dom.tip.hidden = false; } else { dom.tip.hidden = true; }
    hideToast();
    renderNewTool();
    renderTray();
    renderGoals();
    updateButtons();
    board.setLevel(G.L, id);
    layoutBoard();
    startLoop();
    window.scrollTo(0, 0);
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
    var arrow = dom.wind.querySelector('.wind-arrow');
    arrow.style.transform = 'rotate(' + ((w.dir - 1) * 90) + 'deg)';
    var ticks = dom.wind.querySelectorAll('.wind-ticks i');
    for (var i = 0; i < ticks.length; i++) ticks[i].classList.toggle('on', i < w.strength);
    var label = calm ? 'Calm day, no wind' : 'Wind from the ' + DIR_WORD[w.from] + ', ' + STRENGTH_WORD[Math.min(3, w.strength)] + ' (strength ' + w.strength + ')';
    dom.wind.setAttribute('aria-label', label);
    dom.wind.title = label;
  }

  function renderNewTool() {
    var ch = G.chapter;
    var tool = ch && ch.tool && G.id === ch.first ? ch.tool : null;
    G.newTool = tool && store.seenTools.indexOf(tool) < 0 ? tool : null;
    if (!G.newTool) { dom.newtool.hidden = true; return; }
    var t = WB.TOOLS[tool];
    dom.newtoolTitle.textContent = t.name;
    dom.newtoolDesc.textContent = t.desc;
    R.icon(dom.newtoolIcon, 'tool', tool, 48);
    dom.newtool.hidden = false;
  }
  function dismissNewTool() {
    if (G.newTool) {
      if (store.seenTools.indexOf(G.newTool) < 0) store.seenTools.push(G.newTool);
      G.newTool = null;
      dom.newtool.hidden = true;
    }
    saveStore();
    G.newTool = null;
    dom.newtool.hidden = true;
    renderTray();
  }
  dom.newtoolOk.addEventListener('click', dismissNewTool);

  // ---------------------------------------------------------------- tray

  function trayTypes() {
    return WB.TOOL_ORDER.filter(function (t) { return (G.L.inventory[t] || 0) > 0; });
  }

  function renderTray() {
    var focusedType = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-tool');
    dom.tray.textContent = '';
    trayTypes().forEach(function (type, i) {
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
      b.title = t.name + (i < 9 ? ' (' + (i + 1) + ')' : '');
      b.addEventListener('click', function (e) {
        if (G.suppressClick) { G.suppressClick = false; return; }
        Sound.unlock();
        if (G.sel === type) deselect(); else select(type);
      });
      b.addEventListener('pointerdown', onChipDown);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      dom.tray.appendChild(b);
    });
    updateTray();
    if (focusedType) {
      var f = dom.tray.querySelector('[data-tool="' + focusedType + '"]');
      if (f) f.focus();
    }
  }

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
      b.setAttribute('aria-label', WB.TOOLS[type].name + ', ' + n + ' left' + (G.sel === type ? ', selected' : ''));
    }
  }

  function select(type) {
    if (remaining(type) <= 0) return;
    G.sel = type;
    G.valid = WB.placementCells(G.L, allPieces(), type);
    hideTooltip();
    updateTray();
    updateGhostFromHover();
    updateCursorStyle();
  }
  function deselect() {
    G.sel = null;
    G.valid = null;
    G.ghost = null;
    updateTray();
    updateCursorStyle();
  }
  function isValidCell(list, x, y) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return true;
    return false;
  }

  // ---------------------------------------------------------------- goals

  function renderGoals() {
    dom.goals.textContent = '';
    var types = WB.OBJECT_ORDER.filter(function (t) {
      return G.L.objects.some(function (o) { return o.type === t; });
    });
    types.forEach(function (type) {
      var li = el('li', 'goal');
      li.setAttribute('data-type', type);
      var cv = el('canvas');
      cv.setAttribute('aria-hidden', 'true');
      R.icon(cv, 'object', type, 26);
      li.appendChild(cv);
      li.appendChild(el('span', 'goal-count'));
      dom.goals.appendChild(li);
    });
    updateGoals();
  }

  var CHECK_SVG = '<svg class="ico check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function updateGoals() {
    var goals = G.sim.goals;
    var items = dom.goals.querySelectorAll('.goal');
    for (var i = 0; i < items.length; i++) {
      var li = items[i], type = li.getAttribute('data-type');
      var mine = goals.filter(function (g) { return g.type === type; });
      var ok = mine.filter(function (g) { return g.ok; }).length;
      var bad = mine.some(function (g) { return g.state === 'bad'; });
      var all = ok === mine.length;
      li.classList.toggle('is-done', all);
      li.classList.toggle('is-bad', bad && !all);
      var span = li.querySelector('.goal-count');
      if (all) span.innerHTML = CHECK_SVG + (mine.length > 1 ? mine.length : '');
      else span.textContent = ok + '/' + mine.length;
      var name = WB.OBJECTS[type].name;
      li.setAttribute('aria-label', name + ': ' + ok + ' of ' + mine.length + ' happy');
      li.title = name + ' — ' + WB.OBJECTS[type].desc;
    }
  }

  function updateButtons() {
    dom.undo.disabled = G.history.length === 0;
    dom.reset.disabled = G.pieces.length === 0;
    var hasSolution = Array.isArray(G.def.solution) && G.def.solution.length > 0;
    dom.hint.disabled = !hasSolution;
  }

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
    if (!opts.keepHint) G.hint = null;
    rebuildDrawPieces();
    if (G.sel) {
      if (remaining(G.sel) <= 0) deselect();
      else G.valid = WB.placementCells(G.L, allPieces(), G.sel);
    }
    saveBoard();
    updateTray();
    updateGoals();
    updateButtons();
    updateGhostFromHover();
    checkWin();
  }

  function place(type, x, y, d) {
    if (remaining(type) <= 0 || !WB.canPlace(G.L, allPieces(), type, x, y)) { nope(x, y, type); return false; }
    var p = { type: type, x: x, y: y, d: rotations(type) > 1 ? (d | 0) % rotations(type) : 0 };
    commit(G.pieces.concat([p]));
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
    return true;
  }

  function movePiece(p, x, y) {
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: x, y: y, d: q.d } : q; });
    commit(np);
    G.pops[x + ',' + y] = performance.now();
    Sound.tick();
  }

  function removePiece(p, selectAfter) {
    commit(G.pieces.filter(function (q) { return q !== p; }));
    Sound.whoosh();
    if (selectAfter && remaining(p.type) > 0) select(p.type);
  }

  function rotatePiece(p) {
    var nd = WB.rotate(p.type, p.d);
    var np = G.pieces.map(function (q) { return q === p ? { type: q.type, x: q.x, y: q.y, d: nd } : q; });
    G.rot[p.type] = nd;
    commit(np);
    G.pops[p.x + ',' + p.y] = performance.now();
    Sound.turn();
  }

  function undo() {
    if (!G.history.length || G.drag) return;
    G.pieces = G.history.pop();
    afterChange({});
    Sound.whoosh();
  }
  function resetLevel() {
    if (!G.pieces.length || G.drag) return;
    commit([]);
    Sound.whoosh();
  }

  function nope(x, y, type) {
    G.shake = { x: x, y: y, t0: performance.now() };
    if (!playerAt(x, y) && !fixedAt(x, y)) G.flash = { type: type, x: x, y: y, d: defaultRot(type), t0: performance.now() };
    Sound.nope();
  }

  // ---------------------------------------------------------------- win

  function checkWin() {
    clearTimeout(G.winTimer);
    if (!G.sim.solved) { G.won = false; G.winAt = null; return; }
    if (G.won) return;
    var v = G.version, id = G.id;
    G.winTimer = setTimeout(function () {
      if (G.screen === 'game' && G.id === id && G.version === v && G.sim.solved && !G.drag) win();
    }, 350);
  }

  function win() {
    G.won = true;
    G.winAt = performance.now();
    if (!isDone(G.id)) store.completed.push(G.id);
    if (G.newTool) {
      if (store.seenTools.indexOf(G.newTool) < 0) store.seenTools.push(G.newTool);
      G.newTool = null;
      dom.newtool.hidden = true;
    }
    delete store.boards[G.id];
    saveStore();
    deselect();
    hideToast();
    hideTooltip();
    G.hint = null;
    Sound.chime();
    var id = G.id;
    clearTimeout(G.winCardTimer);
    G.winCardTimer = setTimeout(function () {
      if (G.screen === 'game' && G.id === id && G.won) showWinCard();
    }, reducedMQ.matches ? 250 : 1150);
  }

  function showWinCard() {
    var idx = levelIndex(G.id);
    var next = idx >= 0 && idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
    var allDone = LEVELS.every(function (l) { return isDone(l.id); });
    dom.winSub.textContent = 'Level ' + G.id + (G.def.name ? ' · ' + G.def.name : '') + ' solved';
    var last = !next;
    dom.winFinal.hidden = !last;
    dom.winFinal.textContent = allDone
      ? 'You finished all ' + LEVELS.length + ' levels. Thank you for playing — every room is full of fresh air.'
      : 'That was the last level! A few earlier rooms are still waiting for a breeze.';
    dom.winNext.hidden = last;
    dom.winLevels.classList.toggle('btn-primary', last);
    dom.winNext.onclick = next ? function () { closeDialog(dom.win, true); navigate(next.id, true); } : null;
    openDialog(dom.win, last ? dom.winLevels : dom.winNext);
  }
  dom.winLevels.addEventListener('click', function () { closeDialog(dom.win, true); goHome(); });

  function goHome() {
    navigate(null, true);
  }

  // ---------------------------------------------------------------- hint

  function hint() {
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
      G.hint = nextP && (wrongTurn || !playerAt(nextP.x, nextP.y)) ? nextP : null;
      if (wrongTurn) {
        showToast('Almost — try turning this ' + WB.TOOLS[nextP.type].name.toLowerCase() + '.');
        return;
      }
      showToast(conflicts.length === 1
        ? 'One piece isn’t where the solution has it.'
        : conflicts.length + ' pieces aren’t where the solution has them.', 'Clear them', function () {
        commit(G.pieces.filter(function (p) { return conflicts.indexOf(p) < 0; }));
        Sound.whoosh();
        hint();
      });
      return;
    }
    if (nextP) {
      G.hint = nextP;
      var t = WB.TOOLS[nextP.type];
      var how = '';
      if (nextP.type === 'fan') how = ', blowing ' + DIR_WORD[nextP.d];
      else if (nextP.type === 'deflector') how = nextP.d === 0 ? ', slanted like /' : ', slanted like \\';
      showToast('Try a ' + t.name.toLowerCase() + ' here' + how + '.');
    }
  }

  // ---------------------------------------------------------------- toast / tooltip

  function showToast(text, actionLabel, actionFn) {
    clearTimeout(G.toastTimer);
    dom.toastText.textContent = text;
    if (actionLabel) {
      dom.toastAction.hidden = false;
      dom.toastAction.textContent = actionLabel;
      dom.toastAction.onclick = function () { hideToast(); actionFn(); };
    } else {
      dom.toastAction.hidden = true;
      dom.toastAction.onclick = null;
    }
    dom.toast.hidden = false;
    G.toastTimer = setTimeout(hideToast, actionLabel ? 9000 : 5000);
  }
  function hideToast() {
    clearTimeout(G.toastTimer);
    dom.toast.hidden = true;
  }
  dom.toastClose.addEventListener('click', function () { hideToast(); G.hint = null; });

  function objectAt(x, y) {
    var objs = G.L.objects;
    for (var i = 0; i < objs.length; i++) if (objs[i].x === x && objs[i].y === y) return i;
    return -1;
  }

  function currentSim() { return G.drag ? (G.previewSim || G.dragBaseSim || G.sim) : G.sim; }

  function describe(x, y) {
    var L = G.L, sim = currentSim();
    var ch = WB.cellAt(L, x, y);
    var floorish = WB.isFloorish(ch);
    var f = floorish ? sim.flow[y * L.w + x] : 0;
    var p = playerAt(x, y), fixed = false;
    if (!p) { p = fixedAt(x, y); fixed = !!p; }
    var flowBit = function () { return f ? ' · flow ' + f : ''; };
    if (p) {
      var name = WB.TOOLS[p.type].name, s = '';
      switch (p.type) {
        case 'window':
          if (WB.windowRole(L, p) === 'inlet') {
            var tr = null;
            sim.trees.forEach(function (t) { if (t.kind === 'inlet' && t.source.x === p.x && t.source.y === p.y) tr = t; });
            s = 'inlet (facing the wind)' + (tr && !tr.active ? ' · no way out yet' : '');
          } else s = 'outlet';
          break;
        case 'fan': s = 'blowing ' + DIR_WORD[p.d] + flowBit(); break;
        case 'deflector': s = 'turns air 90°' + flowBit(); break;
        case 'curtain': s = 'softens air by 1' + flowBit(); break;
        case 'vent': s = 'air passes through'; break;
        case 'splitter': s = 'splits air in two' + flowBit(); break;
        case 'extractor': s = 'outlet · pulls air'; break;
        case 'skylight': s = 'outlet through the roof'; break;
        case 'filter': s = 'cleans smoke' + flowBit(); break;
        case 'ceilingfan': s = 'blows all four ways' + flowBit(); break;
      }
      return '<b>' + name + '</b> — ' + s + (fixed ? ' <span class="tt-dim">· fixed</span>' : '');
    }
    var oi = objectAt(x, y);
    if (oi >= 0) {
      var ob = L.objects[oi], g = sim.goals[oi];
      var oname = WB.OBJECTS[ob.type].name;
      var need = {
        pinwheel: 'needs a breeze', candle: 'keep air away', laundry: 'needs 2 or more',
        papers: '1 at most', fern: 'exactly 1', stove: ''
      }[ob.type];
      if (ob.type === 'stove') {
        need = g.state === 'happy' ? 'smoke is cleared' : g.state === 'bad' ? 'smoke is trapped' : 'smoke needs a way out';
        return '<b>' + oname + '</b> — ' + need;
      }
      return '<b>' + oname + '</b> — ' + need + ' <span class="tt-dim">· now ' + g.flow + '</span>';
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
    return '<b>Garden</b> — ' + (w.strength > 0 ? 'wind from the ' + DIR_WORD[w.from] : 'a calm day');
  }

  function showTooltipAt(x, y, html, ms) {
    var tt = dom.tooltip;
    tt.innerHTML = html;
    tt.hidden = false;
    var rect = board.cellRect(x, y);
    var cx = dom.canvas.offsetLeft + rect.left + rect.size / 2;
    var top = dom.canvas.offsetTop + rect.top;
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

  // ---------------------------------------------------------------- board input

  function touchOffset(ptype) {
    return ptype === 'touch' ? -Math.min(40, board.T * 0.9) : 0;
  }

  function onBoardDown(e) {
    if (G.screen !== 'game' || dom.win.hidden === false) return;
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
    if (G.press || G.drag) return;
    try { dom.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    G.press = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, cell: c, type: e.pointerType,
      piece: c.inMap ? playerAt(c.x, c.y) : null, longFired: false, timer: 0
    };
    if (e.pointerType !== 'mouse') {
      G.press.timer = setTimeout(onLongPress, 450);
    }
    hideTooltip();
  }

  function onLongPress() {
    var pr = G.press;
    if (!pr) return;
    pr.longFired = true;
    var c = pr.cell;
    if (pr.piece && G.pieces.indexOf(pr.piece) >= 0) {
      removePiece(pr.piece, false);
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
      showTooltipAt(c.x, c.y, '<b>' + WB.TOOLS[pr.piece.type].name + '</b> — back in the tray', 1400);
    } else if (c.inMap || c.onCanvas) {
      showTooltipAt(Math.max(-1, Math.min(G.L.w, c.x)), Math.max(-1, Math.min(G.L.h, c.y)), describe(c.x, c.y), 0);
    }
  }

  function onBoardMove(e) {
    if (G.screen !== 'game') return;
    if (G.drag) return; // handled by the window listener
    var pr = G.press;
    if (pr && pr.id === e.pointerId) {
      var dist = Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0);
      if (dist > 7 && !pr.longFired) {
        clearTimeout(pr.timer);
        if (pr.piece) {
          G.press = null;
          startDrag({ kind: 'move', piece: pr.piece, type: pr.piece.type, d: pr.piece.d, pointerId: e.pointerId, ptype: e.pointerType }, e);
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
    if (G.drag) return;
    var pr = G.press;
    if (!pr || pr.id !== e.pointerId) return;
    G.press = null;
    clearTimeout(pr.timer);
    if (pr.longFired) {
      if (!pr.piece) G.tipTimer = setTimeout(hideTooltip, 1200);
      return;
    }
    var c = board.pick(e.clientX, e.clientY);
    if (c.x !== pr.cell.x || c.y !== pr.cell.y) return;
    tapCell(c, pr.type);
  }

  function onBoardCancel(e) {
    if (G.press && G.press.id === e.pointerId) {
      clearTimeout(G.press.timer);
      G.press = null;
    }
  }

  function onBoardLeave(e) {
    if (e.pointerType === 'mouse') {
      G.hover = null;
      if (!G.drag) G.ghost = null;
      clearTimeout(G.hoverTimer);
      if (!G.press) hideTooltip();
      updateCursorStyle();
    }
  }

  function tapCell(c, ptype) {
    if (!c.inMap) {
      if (G.sel) deselect();
      else if (ptype !== 'mouse' && c.onCanvas) showTooltipAt(Math.max(0, Math.min(G.L.w - 1, c.x)), Math.max(0, Math.min(G.L.h - 1, c.y)), describe(c.x, c.y), 2200);
      return;
    }
    var pp = playerAt(c.x, c.y), fp = fixedAt(c.x, c.y);
    if (G.sel) {
      if (isValidCell(G.valid, c.x, c.y)) { place(G.sel, c.x, c.y, defaultRot(G.sel)); return; }
      if (!pp && !fp) {
        nope(c.x, c.y, G.sel);
        var t = WB.TOOLS[G.sel];
        showTooltipAt(c.x, c.y, '<b>' + t.name + '</b> — ' + MOUNT_HELP[t.mount], 1800);
        return;
      }
    }
    if (pp) {
      if (rotations(pp.type) > 1) rotatePiece(pp);
      else removePiece(pp, true);
      return;
    }
    if (fp) { fixedTap(c.x, c.y); return; }
    if (ptype !== 'mouse') showTooltipAt(c.x, c.y, describe(c.x, c.y), 2600);
    else showTooltipAt(c.x, c.y, describe(c.x, c.y), 2600);
  }

  function fixedTap(x, y) {
    G.shake = { x: x, y: y, t0: performance.now() };
    Sound.nope();
    showTooltipAt(x, y, '<b>Fixed</b> <span class="tt-dim">· part of the house</span>', 1500);
  }

  function setHover(c) {
    var changed = !G.hover || G.hover.x !== c.x || G.hover.y !== c.y || G.hover.inMap !== c.inMap;
    G.hover = c;
    G.hoverMouse = true;
    if (changed) {
      hideTooltip();
      updateGhostFromHover();
      updateCursorStyle();
      if (!G.sel && c.onCanvas) {
        var hx = c.x, hy = c.y;
        G.hoverTimer = setTimeout(function () {
          if (G.hover && G.hover.x === hx && G.hover.y === hy && !G.drag && !G.sel && !G.press) {
            var tx = Math.max(0, Math.min(G.L.w - 1, hx)), ty = Math.max(0, Math.min(G.L.h - 1, hy));
            if (c.inMap) showTooltipAt(hx, hy, describe(hx, hy), 0);
            else if (hx < -0 || hy < 0 || hx >= G.L.w || hy >= G.L.h) {
              if (Math.abs(hx - tx) <= 1 && Math.abs(hy - ty) <= 1) showTooltipAt(hx, hy, describe(hx, hy), 0);
            }
          }
        }, 420);
      }
    }
  }

  function updateGhostFromHover() {
    if (G.drag) return;
    var h = G.cursor || (G.hoverMouse ? G.hover : null);
    if (G.sel && h && h.x >= 0 && h.y >= 0 && h.x < G.L.w && h.y < G.L.h && isValidCell(G.valid, h.x, h.y)) {
      G.ghost = { type: G.sel, x: h.x, y: h.y, d: defaultRot(G.sel), ok: true };
    } else {
      G.ghost = null;
    }
  }

  function updateCursorStyle() {
    var cv = dom.canvas;
    var cls = '';
    if (G.drag) cls = 'is-grabbing';
    else if (G.hover && G.hover.inMap) {
      if (G.sel && isValidCell(G.valid, G.hover.x, G.hover.y)) cls = 'is-pointer';
      else if (playerAt(G.hover.x, G.hover.y)) cls = 'is-grab';
    }
    cv.classList.toggle('is-pointer', cls === 'is-pointer');
    cv.classList.toggle('is-grab', cls === 'is-grab');
    cv.classList.toggle('is-grabbing', cls === 'is-grabbing');
  }

  // ---------------------------------------------------------------- dragging

  function startDrag(d, e) {
    hideTooltip();
    G.drag = d;
    if (d.kind === 'move') {
      G.lifted = d.piece;
      rebuildDrawPieces();
      d.valid = WB.placementCells(G.L, allPieces(d.piece), d.type);
      G.dragBaseSim = WB.simulate(G.L, allPieces(d.piece));
    } else {
      d.valid = WB.placementCells(G.L, allPieces(), d.type);
      G.dragBaseSim = G.sim;
    }
    G.previewSim = null;
    G.previewKey = null;
    R.icon(dom.avatar.querySelector('canvas'), 'tool', d.type, 40);
    updateDrag(e);
    updateCursorStyle();
  }

  function dragPoint(e) {
    return { x: e.clientX, y: e.clientY + touchOffset(G.drag.ptype) };
  }

  function updateDrag(e) {
    var d = G.drag;
    var pt = dragPoint(e);
    var c = board.pick(pt.x, pt.y);
    d.last = c;
    if (c.inMap) {
      var ok = isValidCell(d.valid, c.x, c.y);
      G.ghost = { type: d.type, x: c.x, y: c.y, d: d.d | 0, ok: ok };
      var key = ok ? c.x + ',' + c.y : null;
      if (key !== G.previewKey) {
        G.previewKey = key;
        if (ok) {
          var others = d.kind === 'move' ? allPieces(d.piece) : allPieces();
          G.previewSim = WB.simulate(G.L, others.concat([{ type: d.type, x: c.x, y: c.y, d: d.d | 0 }]));
        } else {
          G.previewSim = null;
        }
      }
      dom.avatar.hidden = ok;
    } else {
      G.ghost = null;
      G.previewSim = null;
      G.previewKey = null;
      dom.avatar.hidden = false;
    }
    if (!dom.avatar.hidden) {
      dom.avatar.style.transform = 'translate(' + pt.x + 'px,' + pt.y + 'px)';
      dom.avatar.style.opacity = d.kind === 'move' && !c.inMap ? '0.6' : '0.95';
    }
  }

  function overTray(e) {
    var r = dom.tray.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function endDrag(e) {
    var d = G.drag;
    if (!d) return;
    updateDrag(e);
    var c = d.last;
    G.drag = null;
    G.ghost = null;
    G.previewSim = null;
    G.previewKey = null;
    G.dragBaseSim = null;
    dom.avatar.hidden = true;
    var lifted = G.lifted;
    G.lifted = null;
    rebuildDrawPieces();
    if (d.kind === 'move') {
      if (c.inMap && !overTray(e)) {
        if (c.x === lifted.x && c.y === lifted.y) { /* dropped where it was */ }
        else if (isValidCell(d.valid, c.x, c.y)) movePiece(lifted, c.x, c.y);
        else { nope(lifted.x, lifted.y, lifted.type); }
      } else {
        removePiece(lifted, false);
      }
    } else {
      if (c.inMap && isValidCell(d.valid, c.x, c.y)) place(d.type, c.x, c.y, d.d);
      else if (c.inMap) nope(c.x, c.y, d.type);
    }
    updateCursorStyle();
    checkWin();
  }

  function cancelDrag() {
    if (!G.drag) return;
    G.drag = null;
    G.ghost = null;
    G.previewSim = null;
    G.dragBaseSim = null;
    G.lifted = null;
    dom.avatar.hidden = true;
    rebuildDrawPieces();
  }

  function onChipDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var type = this.getAttribute('data-tool');
    Sound.unlock();
    if (remaining(type) <= 0) return;
    G.trayPress = { type: type, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, el: this, ptype: e.pointerType };
    try { this.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  window.addEventListener('pointermove', function (e) {
    if (G.drag && e.pointerId === G.drag.pointerId) {
      updateDrag(e);
      return;
    }
    var tp = G.trayPress;
    if (tp && tp.pointerId === e.pointerId) {
      var dx = e.clientX - tp.x0, dy = e.clientY - tp.y0;
      var dist = Math.hypot(dx, dy);
      var landscapeTray = mq('(max-height: 520px) and (min-aspect-ratio: 4/3)').matches;
      var intent = tp.ptype === 'mouse' || landscapeTray || Math.abs(dy) > Math.abs(dx) * 0.8;
      if (dist > 8 && intent) {
        G.trayPress = null;
        startDrag({ kind: 'new', type: tp.type, d: defaultRot(tp.type), pointerId: e.pointerId, ptype: e.pointerType }, e);
      } else if (dist > 14) {
        G.trayPress = null; // horizontal scroll of the tray
      }
    }
  });
  window.addEventListener('pointerup', function (e) {
    if (G.drag && e.pointerId === G.drag.pointerId) {
      var wasNew = G.drag.kind === 'new';
      endDrag(e);
      if (wasNew) {
        G.suppressClick = true;
        setTimeout(function () { G.suppressClick = false; }, 0);
      }
    }
    if (G.trayPress && G.trayPress.pointerId === e.pointerId) G.trayPress = null;
  });
  window.addEventListener('pointercancel', function (e) {
    if (G.drag && e.pointerId === G.drag.pointerId) cancelDrag();
    if (G.trayPress && G.trayPress.pointerId === e.pointerId) G.trayPress = null;
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

  // ---------------------------------------------------------------- help

  function openHelp() {
    var n = G.id || 1;
    var h = [];
    var inLevel = {};
    if (G.L) {
      Object.keys(G.L.inventory).forEach(function (t) { if (G.L.inventory[t] > 0) inLevel[t] = true; });
      G.fixed.forEach(function (p) { inLevel[p.type] = true; });
      G.L.objects.forEach(function (o) { inLevel[o.type] = true; });
    }
    h.push('<p>Make <b>every object</b> in the house happy at the same time by placing the tools from your tray.</p>');
    h.push('<ul class="help-rules">');
    h.push('<li><span><b>Wind</b> blows across the garden. The badge at the top shows which way it blows and how strong it is.</span></li>');
    h.push('<li><span>A <b>window facing the wind</b> is an inlet and lets the breeze in. Every other window is an outlet.</span></li>');
    h.push('<li><span><b>A breeze only flows if it has a way out.</b> An inlet with no outlet stays still — you’ll see a faint dashed line ending in ×.</span></li>');
    h.push('<li><span><b>Strength</b>: 1 is a gentle breeze, 2 is strong, 3 is a gale. Thicker, faster lines mean stronger air, and streams that cross add up.</span></li>');
    if (n >= WB.OBJECTS.stove.intro || inLevel.stove) h.push('<li><span><b>Smoke</b> from a stove must be carried outside (or through a filter) — never blown into a wall.</span></li>');
    h.push('<li><span>The dot on each object shows how it feels: <b>hollow</b> wants air, <b style="color:var(--good)">green</b> is happy, <b style="color:var(--bad)">red</b> is unhappy.</span></li>');
    h.push('</ul>');

    var tools = WB.TOOL_ORDER.filter(function (t) { return WB.TOOLS[t].intro <= n || inLevel[t]; });
    if (tools.length) {
      h.push('<h3>Tools</h3><ul class="gloss">');
      tools.forEach(function (t) {
        h.push('<li><canvas data-icon="tool" data-id="' + t + '" aria-hidden="true"></canvas><div><div class="gloss-name">' + WB.TOOLS[t].name + '</div><div class="gloss-desc">' + WB.TOOLS[t].desc + '</div></div></li>');
      });
      h.push('</ul>');
    }
    var objs = WB.OBJECT_ORDER.filter(function (o) { return WB.OBJECTS[o].intro <= n || inLevel[o]; });
    if (objs.length) {
      h.push('<h3>Things in the house</h3><ul class="gloss">');
      objs.forEach(function (o) {
        h.push('<li><canvas data-icon="object" data-id="' + o + '" aria-hidden="true"></canvas><div><div class="gloss-name">' + WB.OBJECTS[o].name + '</div><div class="gloss-desc">' + WB.OBJECTS[o].desc + '</div></div></li>');
      });
      h.push('</ul>');
    }
    h.push('<h3>Controls</h3><dl class="keys">');
    h.push('<dt>Tap a tool</dt><dd>select it, then tap a highlighted spot — or drag it onto the board</dd>');
    h.push('<dt>Tap a piece</dt><dd>turn it (fans, deflectors) or pick it up</dd>');
    h.push('<dt>Drag a piece</dt><dd>move it; drop it off the board to put it back</dd>');
    h.push('<dt>Long-press / right-click</dt><dd>remove a piece</dd>');
    h.push('<dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>select a tool</dd>');
    h.push('<dt><kbd>R</kbd></dt><dd>turn the piece under the pointer</dd>');
    h.push('<dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>undo</dd>');
    h.push('<dt><kbd>Esc</kbd></dt><dd>deselect / close</dd>');
    h.push('<dt>Arrows, <kbd>Enter</kbd></dt><dd>move around the board and place or turn</dd>');
    h.push('</dl>');
    dom.helpBody.innerHTML = h.join('');
    var cvs = dom.helpBody.querySelectorAll('canvas[data-icon]');
    for (var i = 0; i < cvs.length; i++) R.icon(cvs[i], cvs[i].getAttribute('data-icon'), cvs[i].getAttribute('data-id'), 40);
    openDialog(dom.helpDlg, dom.helpClose);
    dom.helpBody.scrollTop = 0;
  }

  // ---------------------------------------------------------------- dialogs

  var dialogStack = [];
  function openDialog(d, focusEl) {
    if (!d.hidden) return;
    dialogStack.push({ d: d, prev: document.activeElement });
    d.hidden = false;
    hideTooltip();
    setTimeout(function () { (focusEl || d.querySelector('button')).focus(); }, 30);
  }
  function closeDialog(d, silent) {
    if (d.hidden) return;
    d.hidden = true;
    for (var i = dialogStack.length - 1; i >= 0; i--) {
      if (dialogStack[i].d === d) {
        var prev = dialogStack[i].prev;
        dialogStack.splice(i, 1);
        if (!silent && prev && prev.focus && document.body.contains(prev)) prev.focus();
        break;
      }
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
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Escape') {
      if (G.drag) { cancelDrag(); return; }
      if (G.sel) { deselect(); return; }
      if (!dom.toast.hidden) { hideToast(); G.hint = null; return; }
      if (G.newTool) { dismissNewTool(); return; }
      hideTooltip();
      return;
    }
    if (/^[1-9]$/.test(k)) {
      var chips = dom.tray.querySelectorAll('.chip');
      var chip = chips[parseInt(k, 10) - 1];
      if (chip) {
        var type = chip.getAttribute('data-tool');
        if (G.sel === type) deselect(); else select(type);
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
          cur = { x: Math.max(0, Math.min(G.L.w - 1, cur.x + dirs[k][0])), y: Math.max(0, Math.min(G.L.h - 1, cur.y + dirs[k][1])) };
        }
        G.cursor = { x: cur.x, y: cur.y, inMap: true };
        updateGhostFromHover();
        showTooltipAt(cur.x, cur.y, describe(cur.x, cur.y), 0);
        return;
      }
      if ((k === 'Enter' || k === ' ') && G.cursor) {
        e.preventDefault();
        tapCell({ x: G.cursor.x, y: G.cursor.y, inMap: true, onCanvas: true }, 'keyboard');
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
    var w = dom.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = dom.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;
    board.layout(w, h);
    hideTooltip();
  }

  function frame(now) {
    G.raf = 0;
    if (G.screen !== 'game' || document.hidden) return;
    var sim = currentSim();
    var valid = G.drag ? G.drag.valid : (G.sel ? G.valid : null);
    board.draw({
      pieces: G.drawPieces,
      sim: sim,
      valid: valid,
      ghost: G.ghost,
      hint: G.hint,
      hover: !G.sel && !G.drag && G.hoverMouse && G.hover && G.hover.inMap ? G.hover : null,
      cursor: G.cursor,
      pops: G.pops,
      shake: G.shake,
      flash: G.flash,
      win: G.won ? G.winAt : null,
      reduced: reducedMQ.matches
    }, now);
    G.raf = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (!G.raf && G.screen === 'game' && !document.hidden) G.raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (G.raf) cancelAnimationFrame(G.raf);
    G.raf = 0;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopLoop(); else startLoop();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { layoutBoard(); }).observe(dom.stage);
  }
  window.addEventListener('resize', layoutBoard);

  onMQ(darkMQ, function () {
    board.refreshPalette();
    if (G.screen === 'game') { renderTray(); renderGoals(); renderNewTool(); }
    else renderHome();
  });

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

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
