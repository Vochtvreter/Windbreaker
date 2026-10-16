/*
 * Windbreaker — the field guide: one "Meet the …" card for every tool, object
 * and twist (courtyards, calm days, hatched walls, tables, strong wind, gales).
 *
 * The game shows a card by itself the first time its thing turns up: on the
 * first level of the chapter that introduces it (chapter.intro in
 * js/levels.js), or, for a twist, on the first level that has it
 * (WB.levelConditions). After that, the card opens from the guidance line above
 * the board, by long-pressing a tool in the tray (or the (i) on a selected
 * tool), by tapping an object on the board, and from the Field guide in Help.
 *
 * EDITING THE TEXT (no programming needed)
 *   Change any text between the quotes and reload the game. Keep it short and
 *   warm, in plain words a 9-year-old understands. Point at things on the
 *   screen ("the windy side", "up, down, left and right") instead of compass
 *   words: the tests refuse north/east/south/west in this file's text.
 *   An apostrophe inside 'single quotes' needs a backslash: 'can\'t'.
 *     title       the thing's name ("Meet the window", "New: Window")
 *     oneLiner    one sentence: what it does
 *     points      2 or 3 short sentences: how it works
 *     controls    one sentence: how to use it with your fingers or mouse
 *     recap       (tools and objects) said when the player finishes its chapter
 *     demo        the little animated house on the card (see below)
 *
 * EDITING A DEMO
 *   The card loops between two scenes of one tiny house, drawn by the real
 *   board renderer, every couple of seconds, with a caption for each:
 *     wind        { from: 'N' | 'E' | 'S' | 'W', strength: 0..3 }
 *     map         the house, in the level format of DESIGN.md (at most 7 x 5)
 *     fixed       pieces that are in both scenes (drawn as part of the house)
 *     before      the player's pieces in the first scene ...
 *     after       ... and in the second one: this is what the card teaches
 *     caption_before, caption_after
 *   `node --test tests/guides.test.js` checks every demo with the engine: the
 *   house must be valid, "before" must leave something unhappy and "after"
 *   must make everything happy. Run it after editing a demo.
 *
 * Exposes WB.GUIDES ({ id: card }) and WB.GUIDE_ORDER (ids, in the order the
 * player meets them). Also loads in Node for the tests.
 */
(function (root) {
  'use strict';

  var CARDS = [
    {
      id: 'window', kind: 'tool', title: 'Window',
      oneLiner: 'Lets the wind in on the windy side, and lets air out anywhere else.',
      points: [
        'A window on the windy side lets the breeze in. It blows straight across the house.',
        'The breeze needs a way out: another window, where the breeze reaches a wall.',
        'No way out? Then nothing moves, and you see a dashed line that stops at a red ×.'
      ],
      controls: 'Tap the window in your tray, then a glowing spot on an outside wall. Or drag it there.',
      recap: 'You can open windows to make a breeze.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#..p..#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'window', x: 6, y: 2, d: 0 }],
        caption_before: 'One window: the breeze has no way out, so nothing moves.',
        caption_after: 'A second window lets it out. Now the breeze flows!'
      }
    },
    {
      id: 'pinwheel', kind: 'object', title: 'Pinwheel',
      oneLiner: 'Happy as soon as any breeze reaches it.',
      points: [
        'A pinwheel spins in any breeze, even a gentle one.',
        'Breezes blow in straight lines, so line up a window, the pinwheel and another window.',
        'Make every thing in the house happy at the same time to finish.'
      ],
      controls: 'Pinwheels stay where they are. Tap one to see how much air reaches it.',
      recap: 'You can make a pinwheel spin.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#..p..#', '#.....#', '#######'],
        fixed: [],
        before: [{ type: 'window', x: 0, y: 1, d: 0 }, { type: 'window', x: 6, y: 1, d: 0 }],
        after: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        caption_before: 'The breeze goes past, so the pinwheel stays still.',
        caption_after: 'Line the windows up with it, and it spins.'
      }
    },
    {
      id: 'candle', kind: 'object', title: 'Candle',
      oneLiner: 'Wants still air: any breeze blows it out.',
      points: [
        'A candle stays lit only if no air at all reaches it.',
        'Send the breeze along another row, around the candle.',
        'Remember: a breeze with no way out does not move at all.'
      ],
      controls: 'Candles stay where they are. Tap one to see how much air reaches it.',
      recap: 'You can keep a candle out of the wind.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#..p..#', '#.....#', '#..c..#', '#######'],
        fixed: [],
        before: [{ type: 'window', x: 0, y: 3, d: 0 }, { type: 'window', x: 6, y: 3, d: 0 }],
        after: [{ type: 'window', x: 0, y: 1, d: 0 }, { type: 'window', x: 6, y: 1, d: 0 }],
        caption_before: 'A breeze across the candle blows it out.',
        caption_after: 'Send the breeze another way: the pinwheel spins and the candle stays lit.'
      }
    },
    {
      id: 'courtyard', kind: 'twist', title: 'Courtyard',
      oneLiner: 'A little garden inside the house. Its walls are outside walls.',
      points: [
        'The garden patch inside the house counts as outside, so windows fit in the walls around it.',
        'A courtyard window works like any other: on the windy side it lets the breeze in, anywhere else it lets air out.'
      ],
      controls: 'Pick up a window and look for glowing spots on the courtyard walls.',
      demo: {
        wind: { from: 'N', strength: 1 },
        map: ['#######', '#.#~#.#', '#.###.#', '#..p..#', '#######'],
        fixed: [{ type: 'window', x: 3, y: 4, d: 0 }],
        before: [],
        after: [{ type: 'window', x: 3, y: 2, d: 0 }],
        caption_before: 'The pinwheel is tucked away, out of the wind.',
        caption_after: 'A window on the courtyard wall lets the wind in.'
      }
    },
    {
      id: 'fan', kind: 'tool', title: 'Fan',
      oneLiner: 'Blows a gentle breeze the way it points. No window needed.',
      points: [
        'A fan makes its own gentle breeze (1), the way it points. It blows even with no way out.',
        'Air that reaches a fan is pushed on the way it points, so a fan can steer the wind round a corner.',
        'Tap a fan to turn it. It can point four ways.'
      ],
      controls: 'Tap the fan in your tray, then a glowing spot on the floor. Tap it on the board to turn it.',
      recap: 'You can make your own breeze with a fan.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#...p.#', '#.....#', '#######'],
        fixed: [],
        before: [],
        after: [{ type: 'fan', x: 2, y: 2, d: 1 }],
        caption_before: 'No breeze reaches the pinwheel.',
        caption_after: 'A fan blows a gentle breeze the way it points.'
      }
    },
    {
      id: 'calm', kind: 'twist', title: 'Calm day',
      oneLiner: 'No wind today: windows only let air out.',
      points: [
        'On a calm day no wind blows in, so every window lets air out.',
        'You make the breeze yourself: point a fan at what needs air, and a window lets it out.'
      ],
      controls: 'The wind badge at the top says "calm". Tap it any time to check the wind.',
      demo: {
        wind: { from: 'W', strength: 0 },
        map: ['#######', '#.....#', '#...p.#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'fan', x: 2, y: 2, d: 1 }],
        caption_before: 'No wind today, so nothing comes in.',
        caption_after: 'A fan makes its own breeze, and a window lets it out.'
      }
    },
    {
      id: 'stove', kind: 'object', title: 'Stove',
      oneLiner: 'Its smoke must be blown out of the house, never into a wall.',
      points: [
        'A stove is happy once a breeze carries its smoke out through a window.',
        'Smoke rides along with the breeze. If smoky air hits a wall or goes round in circles, the smoke stays in.',
        'So every breeze that passes the stove has to end up outside.'
      ],
      controls: 'Stoves stay where they are. Tap one to check on its smoke.',
      recap: 'You can blow kitchen smoke out of the house.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#..s..#', '#.....#', '#######'],
        fixed: [{ type: 'fan', x: 1, y: 2, d: 1 }],
        before: [],
        after: [{ type: 'window', x: 6, y: 2, d: 0 }],
        caption_before: 'Smoke blown into a wall stays in the house.',
        caption_after: 'Open a window in its path, and the smoke blows outside.'
      }
    },
    {
      id: 'solid', kind: 'twist', title: 'Hatched wall',
      oneLiner: 'Nothing fits into a hatched wall.',
      points: [
        'Hatched walls are solid: no window, and no other piece, fits in them.',
        'Air stops there like at any wall, so steer the breeze (and the smoke) to a plain wall instead.'
      ],
      controls: 'When you pick up a window, hatched walls never glow.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....%', '#.s...%', '#.....%', '#######'],
        fixed: [{ type: 'fan', x: 1, y: 2, d: 1 }],
        before: [{ type: 'fan', x: 4, y: 2, d: 1 }, { type: 'window', x: 4, y: 0, d: 0 }],
        after: [{ type: 'fan', x: 4, y: 2, d: 0 }, { type: 'window', x: 4, y: 0, d: 0 }],
        caption_before: 'The smoke heads for the hatched wall, where no window fits.',
        caption_after: 'Turn the fan, and the smoke goes out through a plain wall.'
      }
    },
    {
      id: 'deflector', kind: 'tool', title: 'Deflector',
      oneLiner: 'Turns a breeze round a corner, without slowing it.',
      points: [
        'A deflector turns any breeze a quarter turn. The breeze keeps its strength.',
        'It can slant two ways, / or \\. Think of a mirror: the breeze bounces off it.',
        'It works from every side, so one deflector can turn two breezes at once.'
      ],
      controls: 'Tap the deflector in your tray, then a glowing spot on the floor. Tap it on the board to flip it.',
      recap: 'You can turn a breeze round a corner.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#.....#', '#..p..#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 1, d: 0 }, { type: 'window', x: 3, y: 4, d: 0 }],
        before: [],
        after: [{ type: 'deflector', x: 3, y: 1, d: 1 }],
        caption_before: 'Going straight on, the breeze has no way out.',
        caption_after: 'A deflector turns it down, through the pinwheel and out.'
      }
    },
    {
      id: 'table', kind: 'twist', title: 'Table',
      oneLiner: 'Air passes over a table, but nothing can be placed on it.',
      points: [
        'Breezes blow straight over tables, as if they were not there.',
        'You can\'t put a piece on a table, so use the plain floor around it.'
      ],
      controls: 'Tables never glow when you pick up a tool.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#...p.#', '#.oo..#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }, { type: 'window', x: 4, y: 0, d: 0 }],
        before: [],
        after: [{ type: 'deflector', x: 4, y: 2, d: 0 }],
        caption_before: 'The breeze blows over the tables, right past the pinwheel.',
        caption_after: 'A deflector past the tables turns it up to the pinwheel.'
      }
    },
    {
      id: 'laundry', kind: 'object', title: 'Laundry',
      oneLiner: 'Dries only in a clean breeze of 2 or more.',
      points: [
        'Laundry needs a breeze of 2 or more. Count the lines: one line is gentle (1), two lines is strong (2).',
        'Breezes add up where they meet: a fan blowing along a breeze adds its own 1, making 2.',
        'It needs clean air too: smoky air makes it dirty.'
      ],
      controls: 'Laundry stays where it is. Its meter fills with the air that reaches it.',
      recap: 'You can dry the washing with a strong breeze.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#...l.#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'fan', x: 2, y: 2, d: 1 }],
        caption_before: 'One gentle breeze (1): the laundry stays damp.',
        caption_after: 'A fan adds its own breeze: 1 + 1 = 2, and it dries.'
      }
    },
    {
      id: 'wind2', kind: 'twist', title: 'Strong wind',
      oneLiner: 'The wind blows in at 2 today: two lines in the stream.',
      points: [
        'On a strong-wind day, a window on the windy side lets in a strong breeze (2). Count the lines.',
        'A strong breeze dries laundry all by itself. Fans still blow a gentle 1.'
      ],
      controls: 'The wind badge at the top shows how strong the wind is. Tap it to check.',
      demo: {
        wind: { from: 'W', strength: 2 },
        map: ['#######', '#.....#', '#...l.#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 6, y: 2, d: 0 }],
        before: [{ type: 'fan', x: 1, y: 2, d: 1 }],
        after: [{ type: 'window', x: 0, y: 2, d: 0 }],
        caption_before: 'A fan\'s gentle breeze (1) is not enough to dry it.',
        caption_after: 'Let the strong wind in: two lines, and it dries.'
      }
    },
    {
      id: 'curtain', kind: 'tool', title: 'Curtain',
      oneLiner: 'Softens any breeze passing through it by 1.',
      points: [
        'A breeze going through a curtain gets 1 weaker: a strong 2 comes out as a gentle 1.',
        'A gentle breeze stops right at the curtain, so a curtain can shield a candle.',
        'A breeze stopped by a curtain has not found a way out, so a window breeze still needs another path outside.'
      ],
      controls: 'Tap the curtain in your tray, then a glowing spot on the floor. Drag it to move it, or tap it to put it back.',
      recap: 'You can soften a breeze with a curtain.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#....c#', '#.....#', '#######'],
        fixed: [{ type: 'fan', x: 1, y: 2, d: 1 }],
        before: [],
        after: [{ type: 'curtain', x: 3, y: 2, d: 0 }],
        caption_before: 'A gentle breeze (1) blows the candle out.',
        caption_after: 'The curtain takes 1 off, so the gentle breeze stops there.'
      }
    },
    {
      id: 'papers', kind: 'object', title: 'Papers',
      oneLiner: 'A gentle breeze is fine, but anything stronger scatters them.',
      points: [
        'Papers can take a gentle breeze (1) at most. Still air is fine too.',
        'A strong breeze (2) blows them everywhere. Breezes that meet on them add up.',
        'Soften a strong breeze with a curtain, or keep breezes apart.'
      ],
      controls: 'Papers stay where they are. Their meter turns red when the air is too strong.',
      recap: 'You can keep papers from blowing away.',
      demo: {
        wind: { from: 'W', strength: 2 },
        map: ['#######', '#.....#', '#...n.#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'curtain', x: 2, y: 2, d: 0 }],
        caption_before: 'A strong breeze (2) scatters the papers.',
        caption_after: 'A curtain softens it to a gentle 1, and the papers stay put.'
      }
    },
    {
      id: 'vent', kind: 'tool', title: 'Wall vent',
      oneLiner: 'Lets air pass straight through an inside wall.',
      points: [
        'Fit a vent into an inside wall between two rooms, and breezes go right through it.',
        'It only fits an inside wall with floor on both sides. Outside walls take windows.',
        'A vent does not turn or soften the air.'
      ],
      controls: 'Tap the vent in your tray, then a glowing spot on an inside wall.',
      recap: 'You can send air through inside walls.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#..#..#', '#..#p.#', '#..#..#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'vent', x: 3, y: 2, d: 0 }],
        caption_before: 'The inside wall stops the breeze: no way out.',
        caption_after: 'A vent lets it through to the next room and out.'
      }
    },
    {
      id: 'fern', kind: 'object', title: 'Fern',
      oneLiner: 'Wants just a gentle breeze: exactly 1.',
      points: [
        'A fern is happy with a gentle breeze of exactly 1.',
        'Still air leaves it wanting, and 2 or more batters it. Watch out for a second breeze joining in.',
        'A curtain can soften a strong breeze to just right.'
      ],
      controls: 'Ferns stay where they are. Their meter shows the air that reaches them.',
      recap: 'You can give a fern just the right breeze.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#...f.#', '#...p.#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [{ type: 'fan', x: 2, y: 2, d: 1 }],
        after: [{ type: 'fan', x: 2, y: 3, d: 1 }],
        caption_before: 'A fan joins the breeze: 2 is too much for the fern.',
        caption_after: 'Move the fan down a row: the fern gets just 1, and the pinwheel spins.'
      }
    },
    {
      id: 'splitter', kind: 'tool', title: 'Splitter',
      oneLiner: 'Splits a breeze in two, out to both sides.',
      points: [
        'A breeze going into a splitter comes out as two breezes, one to each side.',
        'Each side gets half, but never less than 1: a strong 2 splits into two gentle 1s.',
        'The air flows as long as one of the two finds a way out.'
      ],
      controls: 'Tap the splitter in your tray, then a glowing spot on the floor. There is nothing to turn.',
      recap: 'You can split one breeze into two.',
      demo: {
        wind: { from: 'W', strength: 2 },
        map: ['#######', '#..f..#', '#.....#', '#..f..#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }, { type: 'window', x: 3, y: 0, d: 0 }],
        before: [],
        after: [{ type: 'splitter', x: 3, y: 2, d: 0 }],
        caption_before: 'A strong breeze (2) rushes past both ferns.',
        caption_after: 'Split it: two gentle breezes, one for each fern.'
      }
    },
    {
      id: 'wind3', kind: 'twist', title: 'Gale',
      oneLiner: 'The wind blows in at 3 today: a gale!',
      points: [
        'On a gale day, a window on the windy side lets in a gale (3): three lines in the stream.',
        'A curtain takes off 1 at a time. A splitter halves it: a gale splits into two gentle 1s.'
      ],
      controls: 'The wind badge at the top shows how strong the wind is. Tap it to check.',
      demo: {
        wind: { from: 'W', strength: 3 },
        map: ['#######', '#.....#', '#....n#', '#.....#', '#######'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }, { type: 'window', x: 6, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'curtain', x: 2, y: 2, d: 0 }, { type: 'curtain', x: 3, y: 2, d: 0 }],
        caption_before: 'A gale (3) scatters the papers.',
        caption_after: 'Two curtains soften it: 3, then 2, then a gentle 1.'
      }
    },
    {
      id: 'extractor', kind: 'tool', title: 'Extractor',
      oneLiner: 'Lets air out of any outside wall, and pulls a gentle breeze.',
      points: [
        'An extractor lets air out of any outside wall, even on the windy side, where a window would let air in.',
        'It also pulls a gentle breeze (1) toward itself, in a straight line.',
        'The pull needs no window and no wind, so it works on calm days too.'
      ],
      controls: 'Tap the extractor in your tray, then a glowing spot on an outside wall.',
      recap: 'You can pull air out with an extractor.',
      demo: {
        wind: { from: 'E', strength: 1 },
        map: ['#######', '#.....#', '#..p..#', '#.....#', '#######'],
        fixed: [],
        before: [{ type: 'window', x: 6, y: 2, d: 0 }],
        after: [{ type: 'extractor', x: 6, y: 2, d: 0 }],
        caption_before: 'A window on the windy side only lets air in, so nothing moves.',
        caption_after: 'An extractor in the same spot pulls a gentle breeze out.'
      }
    },
    {
      id: 'skylight', kind: 'tool', title: 'Skylight',
      oneLiner: 'A way out through the roof, right in the floor.',
      points: [
        'A skylight sits in the floor and lets any breeze that reaches it out through the roof.',
        'You can put it anywhere on the floor, so a breeze can get out even where no window fits.',
        'The air leaves there: nothing carries on past a skylight.'
      ],
      controls: 'Tap the skylight in your tray, then a glowing spot on the floor.',
      recap: 'You can let air out through the roof.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['%%%%%%%', '#.....%', '#.p...%', '#.....%', '%%%%%%%'],
        fixed: [{ type: 'window', x: 0, y: 2, d: 0 }],
        before: [],
        after: [{ type: 'skylight', x: 4, y: 2, d: 0 }],
        caption_before: 'No window fits the hatched walls: the breeze has no way out.',
        caption_after: 'A skylight lets it out through the roof.'
      }
    },
    {
      id: 'filter', kind: 'tool', title: 'Air filter',
      oneLiner: 'Cleans the smoke out of any air passing through it.',
      points: [
        'Air that goes through a filter comes out clean, just as strong.',
        'Clean air can hit a wall without harm, so smoke no longer has to get outside.',
        'A filter between a stove and the laundry keeps the washing clean.'
      ],
      controls: 'Tap the filter in your tray, then a glowing spot on the floor.',
      recap: 'You can clean smoky air with a filter.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#.....#', '#.s...#', '#.....#', '#######'],
        fixed: [{ type: 'fan', x: 1, y: 2, d: 1 }],
        before: [],
        after: [{ type: 'filter', x: 4, y: 2, d: 0 }],
        caption_before: 'Smoke blown into a wall stays in the house.',
        caption_after: 'A filter cleans the air on the way, so no smoke hits the wall.'
      }
    },
    {
      id: 'ceilingfan', kind: 'tool', title: 'Ceiling fan',
      oneLiner: 'Blows a gentle breeze every way at once.',
      points: [
        'A ceiling fan blows a gentle breeze (1) up, down, left and right, all at the same time. No window needed.',
        'Other breezes pass straight under it, unchanged.',
        'It blows every way at once, so mind the candles and papers nearby.'
      ],
      controls: 'Tap the ceiling fan in your tray, then a glowing spot on the floor. There is nothing to turn.',
      recap: 'You can blow air every way with a ceiling fan.',
      demo: {
        wind: { from: 'W', strength: 1 },
        map: ['#######', '#..p..#', '#p...p#', '#..p..#', '#######'],
        fixed: [],
        before: [],
        after: [{ type: 'ceilingfan', x: 3, y: 2, d: 0 }],
        caption_before: 'Four pinwheels, all still.',
        caption_after: 'One ceiling fan blows on all four.'
      }
    }
  ];

  var GUIDES = {}, ORDER = [];
  CARDS.forEach(function (c) { GUIDES[c.id] = c; ORDER.push(c.id); });

  if (typeof module === 'object' && module.exports) module.exports = { GUIDES: GUIDES, GUIDE_ORDER: ORDER };
  if (root) {
    root.WB = root.WB || {};
    root.WB.GUIDES = GUIDES;
    root.WB.GUIDE_ORDER = ORDER;
  }
})(typeof self !== 'undefined' ? self : null);
