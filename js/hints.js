/*
 * Windbreaker — what the Hint button thinks, worked out from the level's
 * reference solution. No DOM: js/game.js shows it one small step at a time
 * (an idea in words, then one piece), and tests/hints.test.js checks it on
 * every level.
 * Browser: window.WB.Hints. Node: module.exports.
 *
 *   Hints.plan(L, def, pieces)        how the board differs from the solution
 *   Hints.idea(L, pieces, sim, plan, opts)   step 1: an idea in words
 *   Hints.stallCells(L, sim)          where stalled breezes stop (their red ×)
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./engine.js') : root.WB);
  if (node) module.exports = api;
  else { root.WB = root.WB || {}; root.WB.Hints = api; }
})(typeof self !== 'undefined' ? self : this, function (WB) {
  'use strict';

  var DX = WB.DX, DY = WB.DY;

  function norm(p) { return { type: p.type, x: p.x | 0, y: p.y | 0, d: p.d | 0 }; }
  function rotations(type) { return WB.TOOLS[type] ? WB.TOOLS[type].rotations : 1; }
  function happyCount(sim) { return sim.goals.filter(function (g) { return g.ok; }).length; }
  function badCount(sim) { return sim.goals.filter(function (g) { return g.state === 'bad'; }).length; }
  function remaining(L, pieces, type) {
    var n = L.inventory[type] || 0;
    for (var i = 0; i < pieces.length; i++) if (pieces[i].type === type) n--;
    return n;
  }
  // Does `after` harm something that `before` did not?
  function harms(before, after) {
    return after.goals.some(function (g, i) { return g.state === 'bad' && before.goals[i].state !== 'bad'; });
  }
  function stalledInlets(sim) { return sim.trees.filter(function (t) { return t.kind === 'inlet' && !t.active; }); }

  // ------------------------------------------------------------------ the red ×

  // Where each stalled breeze stops: the wall cell (or window, or curtain) its
  // red × sits in, the same way js/render.js places the mark (just inside the
  // wall face the breeze runs into). In tree order, without repeats.
  function stallCells(L, sim) {
    var out = [], seen = {};
    stalledInlets(sim).forEach(function (tr) {
      tr.ends.forEach(function (e) {
        // the step that runs into this end; at a wall face two can meet, and the
        // one heading into the wall is the one that stops
        var pick = null, any = null;
        for (var d = 0; d < 4; d++) {
          if (!reaches(tr, e, d)) continue;
          if (WB.isWall(WB.cellAt(L, Math.floor(e.x + DX[d] * 0.25), Math.floor(e.y + DY[d] * 0.25)))) { pick = d; break; }
          if (any == null) any = d;
        }
        if (pick == null) pick = any;
        var dx = pick == null ? 0 : DX[pick], dy = pick == null ? 0 : DY[pick];
        var c = { x: Math.floor(e.x + dx * 0.32), y: Math.floor(e.y + dy * 0.32) };
        if (seen[c.x + ',' + c.y]) return;
        seen[c.x + ',' + c.y] = true;
        out.push(c);
      });
    });
    return out;
  }
  // Does a segment of the tree, moving in direction d, arrive at point e?
  function reaches(tr, e, d) {
    for (var i = 0; i < tr.segments.length; i++) {
      var s = tr.segments[i];
      var dx = Math.sign(s.bx - s.ax), dy = Math.sign(s.by - s.ay);
      if (dx !== DX[d] || dy !== DY[d]) continue;
      var len = Math.abs(s.bx - s.ax) + Math.abs(s.by - s.ay);
      if (len < 1e-6) continue;
      // e on the segment, past its start: (e - a) is a positive multiple of d, at most len
      var t = (e.x - s.ax) * dx + (e.y - s.ay) * dy;
      var off = (e.x - s.ax) * -dy + (e.y - s.ay) * dx;
      if (Math.abs(off) < 1e-6 && t > 1e-6 && t <= len + 1e-6) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ the plan

  // How the board differs from the reference solution:
  //   turns      solution pieces whose cell holds the right piece, turned wrong
  //   moves      [{ from, to, sim }]: a piece the answer needs, in the wrong
  //              spot, with no copy left in the tray to put there instead
  //   conflicts  pieces the answer does not need (of a type it uses fewer of);
  //              helping: those of them that make something happy right now
  //   next       the next piece to place from the tray (and nextSim, the board after it)
  // `pieces` are the player's pieces (fixed ones come from L); conflicts and
  // moves[].from are the very objects in `pieces`.
  function plan(L, def, pieces) {
    var fixed = L.fixed.map(norm);
    var sol = (def.solution || []).map(norm);
    function same(a, b) {
      return a.type === b.type && a.x === b.x && a.y === b.y && (rotations(a.type) < 2 || a.d === b.d);
    }
    var here = fixed.concat(pieces);
    var sim = WB.simulate(L, here);
    var conflicts = pieces.filter(function (p) { return !sol.some(function (s) { return same(s, p); }); });
    var missing = sol.filter(function (s) { return !pieces.some(function (p) { return same(s, p); }); });
    // A piece on a solution cell that is only turned the wrong way is not a
    // conflict: it needs a turn, and turning comes first.
    var turns = [];
    conflicts = conflicts.filter(function (p) {
      for (var i = 0; i < missing.length; i++) {
        var s = missing[i];
        if (s.type === p.type && s.x === p.x && s.y === p.y && turns.indexOf(s) < 0) { turns.push(s); return false; }
      }
      return true;
    });
    // A piece the answer needs elsewhere, when the tray has no copy left for
    // that spot: a move (never "not needed"). Each pairing picked is the one
    // that leaves the house happiest.
    var moves = [];
    var open = missing.filter(function (s) { return turns.indexOf(s) < 0; });
    var types = [];
    conflicts.forEach(function (p) { if (types.indexOf(p.type) < 0) types.push(p.type); });
    types.forEach(function (t) {
      var cs = conflicts.filter(function (p) { return p.type === t; });
      var ms = open.filter(function (s) { return s.type === t; });
      var need = ms.length - Math.max(0, remaining(L, pieces, t));
      while (need > 0 && cs.length && ms.length) {
        var best = null;
        cs.forEach(function (c) {
          var others = here.filter(function (q) { return q !== c; });
          ms.forEach(function (s, si) {
            if (!WB.canPlace(L, others, t, s.x, s.y)) return;
            var after = WB.simulate(L, others.concat([s]));
            var score = badCount(after) * 100 - happyCount(after) * 10 + (Math.abs(c.x - s.x) + Math.abs(c.y - s.y)) * 0.01 + si * 0.0001;
            if (!best || score < best.score) best = { c: c, s: s, sim: after, score: score };
          });
        });
        if (!best) break;
        moves.push({ from: best.c, to: best.s, sim: best.sim });
        cs.splice(cs.indexOf(best.c), 1);
        ms.splice(ms.indexOf(best.s), 1);
        need--;
      }
    });
    conflicts = conflicts.filter(function (p) { return !moves.some(function (m) { return m.from === p; }); });
    // conflicts that make something happy right now (taking them away would undo it)
    var happyNow = happyCount(sim);
    var helping = conflicts.filter(function (p) {
      return happyCount(WB.simulate(L, here.filter(function (q) { return q !== p; }))) < happyNow;
    });
    // The next piece from the tray: of those that fit now, the one that leaves
    // the fewest things unhappy (so following the hints rarely makes something
    // go red); the solution's order breaks ties.
    var best = null;
    missing.forEach(function (sp, i) {
      if (moves.some(function (m) { return m.to === sp; })) return;
      if (remaining(L, pieces, sp.type) <= 0 || !WB.canPlace(L, here, sp.type, sp.x, sp.y)) return;
      var after = WB.simulate(L, here.concat([sp]));
      var score = badCount(after) * 100 - happyCount(after) * 10 + i * 0.01;
      if (!best || score < best.score) best = { p: sp, sim: after, score: score };
    });
    // nothing fits right now: still name the first piece the answer is missing
    var first = missing.filter(function (s) { return turns.indexOf(s) < 0 && !moves.some(function (m) { return m.to === s; }); })[0] || null;
    return {
      sim: sim, turns: turns, moves: moves, conflicts: conflicts, helping: helping, missing: missing,
      next: best ? best.p : first, nextSim: best ? best.sim : null
    };
  }

  // ------------------------------------------------------------------ step 1: an idea in words

  // what a tool can do, said as an idea
  var TOOL_IDEA = {
    window: 'it lets the wind in on the windy side',
    fan: 'it makes its own breeze, the way it points',
    deflector: 'it turns a breeze round a corner',
    curtain: 'it makes a breeze 1 weaker',
    vent: 'it lets air through an inside wall',
    splitter: 'it sends a breeze out to both sides',
    extractor: 'it lets air out of any outside wall, and pulls a gentle breeze',
    skylight: 'it lets air out through the roof',
    filter: 'it cleans the smoke out of the air',
    ceilingfan: 'it blows a gentle breeze every way at once'
  };
  function toolIdea(L, p) {
    if (p.type === 'window' && WB.windowRole(L, p) === 'outlet') return 'away from the windy side, it lets air out';
    return TOOL_IDEA[p.type];
  }
  function goalIdea(g) {
    switch (g.type) {
      case 'pinwheel': return 'The pinwheel needs a breeze.';
      case 'candle': return 'The candle is being blown out. Keep every breeze away from it.';
      case 'stove': return g.state === 'bad' ? 'The smoke is blown into a wall. It needs a way outside.' : 'The smoke needs a breeze to carry it outside.';
      case 'laundry': return g.smoky ? 'Smoky air is reaching the laundry. Keep the smoke away from it.' : 'The laundry needs a stronger breeze: 2 or more.';
      case 'papers': return 'Too much air on the papers: they can only take a breeze of 1.';
      case 'fern': return g.state === 'bad' ? 'Too much air on the fern: it wants exactly 1.' : 'The fern needs a gentle breeze: exactly 1.';
    }
    return 'Something in the house is not happy yet.';
  }
  var DASHED = 'The breeze needs a way out. Follow the dashed line to where it stops.';
  // the breeze has no way out yet, and the obvious way out would harm this
  var HARM = {
    candle: 'Let the breeze out, but keep it away from the candle{s}.',
    papers: 'Let the breeze out, but make it gentler before it reaches the papers.',
    fern: 'Let the breeze out, but make it gentle for the fern{s}: exactly 1.',
    laundry: 'Let the breeze out, but keep the smoke away from the laundry.',
    stove: 'Let the breeze out, and carry the smoke outside, not into a wall.'
  };

  // Step 1 of a hint: what is wrong, in words. opts.name(type) -> 'fan'.
  // Returns { text, focus (a goal to ring), at (a cell the words are about) }.
  function idea(L, pieces, sim, p, opts) {
    opts = opts || {};
    var name = opts.name || function (t) { return WB.TOOLS[t].name.toLowerCase(); };
    if (p.turns.length) return { text: 'Almost! One of your pieces just needs a turn.' };
    if (p.moves.length) {
      return { text: p.moves.length === 1 ? 'Your ' + name(p.moves[0].from.type) + ' could do more somewhere else.' : 'Some of your pieces could do more somewhere else.' };
    }
    if (p.conflicts.length) {
      if (p.helping.length === p.conflicts.length) return { text: p.conflicts.length === 1 ? 'One of your pieces won’t be needed in the end.' : 'Some of your pieces won’t be needed in the end.' };
      return { text: p.conflicts.length === 1 ? 'One of your pieces isn’t helping here.' : 'Some of your pieces aren’t helping here.' };
    }
    var nx = p.next, after = p.nextSim;
    var untried = nx && TOOL_IDEA[nx.type] && remaining(L, pieces, nx.type) === (L.inventory[nx.type] || 0);
    var stuck = stalledInlets(sim).length > 0 && !sim.trees.some(function (t) { return t.active; });
    if (stuck) {
      var cells = stallCells(L, sim);
      var candles = sim.goals.filter(function (g) { return g.type === 'candle'; });
      var at = null;
      if (nx && (nx.type === 'window' || nx.type === 'extractor') && after && !harms(sim, after)) {
        cells.forEach(function (c) { if (!at && c.x === nx.x && c.y === nx.y) at = c; });
      }
      // "follow the dashed line" only when the answer really is a way out right
      // where it stops (with several lines and a candle, the candle comes first)
      if (at && cells.length === 1) return { text: DASHED, at: at };
      if (at && !candles.length) return { text: 'A breeze needs a way out. Follow its dashed line to where it stops.', at: at };
      // letting the breeze out where it stops would harm something: say that first
      var harmed = null;
      var probe = (L.inventory.window || 0) > 0 ? 'window' : (L.inventory.extractor || 0) > 0 ? 'extractor' : null;
      var here = L.fixed.map(norm).concat(pieces);
      if (probe) {
        cells.forEach(function (c) {
          if (harmed || !WB.canPlace(L, here, probe, c.x, c.y)) return;
          var s2 = WB.simulate(L, here.concat([{ type: probe, x: c.x, y: c.y, d: 0 }]));
          s2.goals.forEach(function (g, i) { if (!harmed && g.state === 'bad' && sim.goals[i].state !== 'bad') harmed = sim.goals[i]; });
        });
      }
      if (!harmed && candles.length) harmed = candles[0];
      if (harmed && HARM[harmed.type]) {
        var many = sim.goals.filter(function (g) { return g.type === harmed.type; }).length > 1;
        var ht = HARM[harmed.type].replace('{s}', many ? 's' : '');
        // and the tool that does it, if it is not the window itself
        if (untried && nx.type !== 'window' && nx.type !== 'extractor') ht += ' Try your ' + name(nx.type) + ': ' + toolIdea(L, nx) + '.';
        return { text: ht, focus: harmed };
      }
    }
    // the thing the next piece helps, else the first unhappy one (a harmed one first)
    var g = null;
    if (after) sim.goals.forEach(function (x, i) { if (!g && !x.ok && after.goals[i].ok) g = x; });
    if (!g) sim.goals.forEach(function (x) { if (!g && x.state === 'bad') g = x; });
    if (!g) sim.goals.forEach(function (x) { if (!g && !x.ok) g = x; });
    var text = g ? goalIdea(g) : 'Something in the house is not happy yet.';
    // a tool the answer uses that has not been tried yet
    if (untried) {
      text += ' Try your ' + name(nx.type) + ': ' + toolIdea(L, nx) + '.';
    } else if (g && g.type === 'pinwheel') text += ' How can air reach it?';
    return { text: text, focus: g };
  }

  return { plan: plan, idea: idea, stallCells: stallCells, DASHED: DASHED, TOOL_IDEA: TOOL_IDEA };
});
