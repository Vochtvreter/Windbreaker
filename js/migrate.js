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

  var ls;
  try { ls = window.localStorage; if (!ls || ls.getItem(MARK_KEY) === LEVELSET) return; } catch (e) { return; }
  try {
    var raw = ls.getItem(STORE_KEY);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && typeof d === 'object' && Array.isArray(d.completed)) {
        var byKey = {};
        ((window.WB && window.WB.LEVELS) || []).forEach(function (l) { if (l.key) byKey[l.key] = l.id; });
        var out = [];
        d.completed.forEach(function (n) {
          var id = typeof n === 'number' ? byKey[V1_KEYS[n - 1]] : null;
          if (id && out.indexOf(id) < 0) out.push(id);
        });
        out.sort(function (a, b) { return a - b; });
        d.completed = out;
        d.boards = {};
        d.boardSigs = {};
        ls.setItem(STORE_KEY, JSON.stringify(d));
      }
    }
    ls.setItem(MARK_KEY, LEVELSET);
  } catch (e) { /* unreadable progress: leave it for the game to handle */ }
})();
