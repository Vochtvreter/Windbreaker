/*
 * Windbreaker — saved-progress migration between level sets.
 *
 * Saved progress lists solved levels by NUMBER. When the level order changes
 * (v1.1 reordered the levels so new things arrive one at a time), those numbers
 * must be translated. Each level has a stable `key` (from its unique name), and
 * V1_KEYS below records which key each number had in v1.0. This runs before
 * js/game.js reads the store, once per browser (marked under MARK_KEY).
 * Unfinished boards are dropped (they belonged to the old positions).
 */
(function () {
  'use strict';
  var STORE_KEY = 'windbreaker.v1';
  var MARK_KEY = 'windbreaker.levelset';
  var LEVELSET = '2'; // bump together with a new legacy map when the order changes again
  // v1.0 level number (index + 1) -> level key
  var V1_KEYS = [
    "first-breeze", "wind-shift", "candlelight", "doorway-draft", "garden-court",
    "becalmed", "turning-point", "smoke-signals", "into-the-wind", "sunday-roast",
    "round-the-corner", "candle-detour", "clothesline", "confluence", "crossroads",
    "shielded-flame", "strong-enough", "loose-papers", "draught-stopper", "second-wind",
    "through-the-wall", "night-light", "potted-fern", "side-door", "blustery-washday",
    "forked-breeze", "smoke-and-spin", "gentle-halves", "bent-branch", "two-to-dry",
    "upwind-exit", "range-hood", "candlelit-supper", "wash-house", "headwind-kitchen",
    "through-the-roof", "table-for-two", "smoke-hole", "dead-end", "laundry-chute",
    "clean-air", "two-burners", "galley-kitchen", "supper-smoke", "hood-and-hearth",
    "overhead", "sidestep", "backdraft", "drying-room", "gale-house",
    "tailwind", "split-decision", "meeting-point", "study-hall", "spin-cycle",
    "eddy", "fern-aisle", "potting-shed", "quiet-wing", "glasshouse-storm",
    "wet-cloak", "velvet-curtain", "reading-nook", "the-stacks", "fireside",
    "back-to-back", "hot-plates", "round-trip", "tea-towels", "dinner-rush",
    "delicates", "airing-cupboard", "cross-stitch", "three-sheets", "tumble-dry",
    "locked-study", "inner-court", "chimney-corner", "servants-pantry", "chandelier",
    "crossed-lines", "scullery", "under-the-eaves", "single-flue", "still-house",
    "gale-warning", "stormy-hearth", "storm-shutters", "clothes-horse", "squall-line",
    "double-duty", "trading-places", "broadside", "roof-hatch", "every-which-way",
    "full-circle", "linen-passage", "pushback", "long-draw", "spring-cleaning"
  ];

  var MIGRATED_KEY = 'windbreaker.migrated'; // { from, solved, furthest }: for the "welcome back" note
  var WB = window.WB = window.WB || {};
  WB.LEVELSET = LEVELSET; // js/game.js marks every save with it

  var ls;
  try { ls = window.localStorage; if (!ls || ls.getItem(MARK_KEY) === LEVELSET) return; } catch (e) { return; }
  var raw = null;
  try { raw = ls.getItem(STORE_KEY); } catch (e) { return; }
  var d = null;
  // unreadable progress: the game starts afresh, and saves in today's numbering,
  // so it is marked as migrated below all the same (a later load must not
  // "translate" those new numbers as if they were v1.0's)
  try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
  if (d && typeof d === 'object' && Array.isArray(d.completed)) {
    var byKey = {}, levels = WB.LEVELS || [];
    levels.forEach(function (l) { if (l.key) byKey[l.key] = l.id; });
    var out = [];
    d.completed.forEach(function (n) {
      var id = typeof n === 'number' ? byKey[V1_KEYS[n - 1]] : null;
      if (id && out.indexOf(id) < 0) out.push(id);
    });
    out.sort(function (a, b) { return a - b; });
    var furthest = out.length ? out[out.length - 1] : 0;
    d.completed = out;
    d.boards = {};
    d.boardSigs = {};
    // A save without the cards seen (made outside the game): every card of
    // something met by the furthest solved level counts as seen, so replaying
    // an old level does not bring its "Meet the …" card back.
    if (!Array.isArray(d.seenTools) && furthest) d.seenTools = metBy(levels, furthest);
    var info = { from: '1.0', solved: out.length, furthest: furthest };
    try {
      ls.setItem(STORE_KEY, JSON.stringify(d));
      if (out.length) ls.setItem(MIGRATED_KEY, JSON.stringify(info));
    } catch (e) {
      // storage reads but cannot write: the game plays this translated
      // progress (for this visit) instead of the old numbers
      WB.migratedStore = d;
      if (out.length) WB.migratedInfo = info;
    }
  }
  try { ls.setItem(MARK_KEY, LEVELSET); } catch (e) { /* the game marks its own saves too */ }

  // Ids of the tools, objects and twists met by level n (what the field guide calls them).
  function metBy(levels, n) {
    var ids = [];
    (WB.TOOL_ORDER || []).forEach(function (t) { if (WB.TOOLS[t].intro <= n) ids.push(t); });
    (WB.OBJECT_ORDER || []).forEach(function (o) { if (WB.OBJECTS[o].intro <= n) ids.push(o); });
    if (WB.levelConditions) {
      levels.forEach(function (l) {
        if (l.id > n) return;
        WB.levelConditions(l).forEach(function (c) { if (ids.indexOf(c) < 0) ids.push(c); });
      });
    }
    return ids;
  }
})();
