/*
 * Windbreaker gallery rooms: three hand-made levels that show every tool and
 * every object in every state at once. They are not part of the game.
 *
 *   tools/visual.js appends them to the levels (ids 901-903, open with
 *   ?unlock#901) for its pictures; studio.html shows them as live boards.
 *
 * Works in Node (module.exports) and in the browser (window.WBGallery).
 */
(function (root, rooms) {
  if (typeof module === 'object' && module.exports) module.exports = rooms;
  if (root) root.WBGallery = rooms;
})(typeof self !== 'undefined' ? self : null, [
  {
    id: 901, chapter: 0, name: 'Gallery: every tool', tip: 'Every tool at work, every object happy.',
    wind: { from: 'W', strength: 2 },
    map: [
      '#############',
      '#c..........#',
      '#.p...fn....#',
      '#...........#',
      '#############',
      '#.s.........#',
      '#...........#',
      '#......l....#',
      '#...........#',
      '#############'],
    fixed: [{ type: 'window', x: 0, y: 2 }],
    inventory: { window: 1, fan: 1, deflector: 2, curtain: 1, vent: 1, splitter: 1, extractor: 1, skylight: 1, filter: 2, ceilingfan: 1 },
    solution: [
      { type: 'curtain', x: 4, y: 2 }, { type: 'filter', x: 8, y: 2 }, { type: 'deflector', x: 10, y: 2, d: 1 },
      { type: 'vent', x: 10, y: 4 }, { type: 'splitter', x: 10, y: 6 }, { type: 'window', x: 12, y: 6 },
      { type: 'skylight', x: 6, y: 6 }, { type: 'ceilingfan', x: 3, y: 7 }, { type: 'extractor', x: 12, y: 7 },
      { type: 'fan', x: 1, y: 5, d: 1 }, { type: 'filter', x: 4, y: 5 }, { type: 'deflector', x: 3, y: 8, d: 0 }],
  },
  {
    id: 902, chapter: 0, name: 'Gallery: trouble', tip: 'A gale: candle out, papers flying, fern battered, laundry sooty, smoke stuck.',
    wind: { from: 'W', strength: 3 },
    map: [
      '#############',
      '#...........#',
      '#.s.c.n.f.l.#',
      '#...........#',
      '#...........#',
      '#...s.......#',
      '#.........s.#',
      '####%%%%%####'],
    fixed: [{ type: 'window', x: 0, y: 2 }, { type: 'fan', x: 2, y: 5, d: 1 }],
    inventory: { window: 1 },
    solution: [{ type: 'window', x: 12, y: 2 }],
  },
  {
    id: 903, chapter: 0, name: 'Gallery: quiet', tip: 'A stalled window, a gentle fan and things still waiting for air.',
    wind: { from: 'W', strength: 1 },
    map: [
      '#############',
      '#.........c.#',
      '#..p....l...#',
      '#....oo.....#',
      '######.######',
      '#...........#',
      '#.l.f.n.....#',
      '#.........s.#',
      '#############'],
    fixed: [
      { type: 'window', x: 0, y: 2 }, { type: 'fan', x: 1, y: 6, d: 1 }, { type: 'vent', x: 6, y: 4 },
      { type: 'deflector', x: 9, y: 5, d: 1 }, { type: 'ceilingfan', x: 11, y: 5 }],
    inventory: { fan: 1, window: 1, curtain: 1 },
    solution: [],
  },
]);
