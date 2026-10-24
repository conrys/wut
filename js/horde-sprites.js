// ==========================================================================
// «Орда» — піксельні спрайти як текстові сітки.
//   '.' — прозоро, інші символи — кольори з PALETTE.
//   Цифри 1–6 — кольори героя (HERO_COLORS): 1/2 обладунок, 3 плащ, 5/6 голова.
//   mirror: true — записана лише ліва половина, права дзеркалиться.
// Обводка (1 px) і білий «спалах удару» генеруються автоматично в рендері.
// Щоб замінити графіку на намальовану — досить підмінити HordeSprites.get()
// на вирізання з PNG-аркуша; решта коду не зміниться.
// ==========================================================================
(function () {
  const PALETTE = {
    k: "#16131d", K: "#2b2638", w: "#f2ecd9", W: "#bdb4a0", g: "#8b8f98", G: "#565a66",
    r: "#d23c3c", R: "#7c1f2b", o: "#e8853a", y: "#f4cc4c", Y: "#a8781f",
    l: "#86c556", L: "#3e7d3a", d: "#24452a", z: "#a3c76a", Z: "#5e8c3d",
    b: "#58a0e8", B: "#2e568f", c: "#9be7ff", p: "#a066e0", P: "#5b3290",
    n: "#b47c4a", N: "#6a4328", s: "#f2bd92", S: "#c48a5e", m: "#e07ab8",
    e: "#ff4636", E: "#ffe25a", v: "#3d7ea6", V: "#22455e",
  };

  const HERO_COLORS = {
    knight:    { 1: "#c9cfd8", 2: "#8b93a1", 3: "#b8323a", 4: "#7c1f2b", 5: "#d9dee6", 6: "#8b93a1" },
    huntress:  { 1: "#8a6440", 2: "#55402a", 3: "#3f6b2a", 4: "#284a1c", 5: "#4f8a3a", 6: "#2f5a24" },
    mage:      { 1: "#6a4bd0", 2: "#3f2c8a", 3: "#2e2470", 4: "#1d1748", 5: "#5a3fc0", 6: "#3a2a80" },
    priest:    { 1: "#ece4cc", 2: "#b8ac8a", 3: "#d6a93a", 4: "#9c7420", 5: "#f2ecd9", 6: "#d6a93a" },
    barbarian: { 1: "#d09a6a", 2: "#9a6a42", 3: "#6b3b1f", 4: "#44240f", 5: "#8b8f98", 6: "#565a66" },
    witch:     { 1: "#3a2f4a", 2: "#241c30", 3: "#1f4f4a", 4: "#123330", 5: "#2b2238", 6: "#4fb89a" },
    scholar:   { 1: "#7a5a9a", 2: "#4f3a6a", 3: "#5a3b8a", 4: "#382456", 5: "#6a4a9a", 6: "#3f2a5f" },
  };

  // ---------- герої: голова (7 рядків) + тіло (9 рядків), 12×16 ----------
  const HEADS = {
    knight: [
      ".....rr.....",
      "....r5555...",
      "...5555555..",
      "...5555kk5..",
      "...55555k5..",
      "...6555556..",
      "....666666..",
    ],
    huntress: [
      "....5555....",
      "...555555...",
      "..55555ss5..",
      "..5555sks...",
      "..5555sss...",
      "..65555ss...",
      "...666666...",
    ],
    mage: [
      "......5.....",
      ".....555....",
      "....55y5....",
      "..55555555..",
      "...sssss....",
      "...sssks....",
      "....sss.....",
    ],
    priest: [
      "....5555....",
      "...555555...",
      "..555ssss...",
      "..55ssks5...",
      "..55ssss5...",
      "..6555555...",
      "...666666...",
    ],
    barbarian: [
      ".w.......w..",
      ".w.5555..w..",
      "..w555555w..",
      "...5555ss...",
      "...555sks...",
      "...5sssss...",
      "...nnnnnn...",
    ],
    witch: [
      ".....5......",
      "....55......",
      "...555m.....",
      ".555555555..",
      "...ssss66...",
      "...ssks666..",
      "...sss666...",
    ],
    scholar: [
      "....5555....",
      "...555555...",
      "..5555sss...",
      "..555kwkw...",
      "..555ssss...",
      "..6555ss....",
      "...66666....",
    ],
  };
  const BODY_A = [
    "...3311111..",
    "..33111111s.",
    "..3312211ss.",
    "..331222111.",
    "..34.yyyy...",
    "...4.1111...",
    ".....1..1...",
    ".....2..2...",
    "....kk..kk..",
  ];
  const BODY_B = [
    "...3311111..",
    "..33111111s.",
    "..3312211ss.",
    "..331222111.",
    "..34.yyyy...",
    "...4.1111...",
    "....1....1..",
    "....2....2..",
    "...kk....kk.",
  ];

  // ---------- вороги ----------
  const S = {
    bat: {
      frames: [
        ["P......", "PP.....", "PpP..P.", ".PpPPpP", "..PpppP", "...PpeP", "....PP.", "......."],
        [".......", "....PPP", "..PPppp", ".PpPppp", "PpP.Ppe", "Pp...PP", "P......", "......."],
      ], mirror: true,
    },
    zombie: {
      frames: [[
        "..ZZZZ", ".Zzzzz", ".Zzezz", ".Zzzzz", ".Zzzkk", "..ZZZZ",
        "zz.NNN", "zZNnnn", "..Nnnn", "..NnRn", "..BBBB", "..BB..", "..BB..", ".kkk..",
      ]], mirror: true,
    },
    skeleton: {
      frames: [[
        "..wwww", ".wwwww", ".wkkww", ".wkkww", ".wwwww", "..wkwk",
        "....WW", "..wWww", ".w.kwk", ".w.wkw", "...kwk", "...ww.", "...w..", "...w..", "..kk..",
      ]], mirror: true,
    },
    wolf: {
      frames: [
        [
          "...........G.G..", "..........GgGg..", "G........Ggggg..", "Gg......GggEgggk",
          ".GgGGGGGggggwwk.", "..Ggggggggggw...", "..GgggggggggG...", "..GG.GG..GG.GG..",
          "..G..G...G...G..", ".kk.kk..kk..kk..",
        ],
        [
          "...........G.G..", "..........GgGg..", "G........Ggggg..", "Gg......GggEgggk",
          ".GgGGGGGggggwwk.", "..Ggggggggggw...", "..GgggggggggG...", "...GG.GG.GG.GG..",
          "...G..G..G..G...", "..kk.kk.kk.kk...",
        ],
      ],
    },
    ghost: {
      frames: [
        ["..wwww", ".wwwww", ".wwwww", "wwkkww", "wwkkww", "wwwwww", "wwwwwk", "wwwwww", "wwwwww", "wcwwcw", "w.ww.w"],
        ["..wwww", ".wwwww", ".wwwww", "wwkkww", "wwkkww", "wwwwww", "wwwwwk", "wwwwww", "wwwwww", "cwwcww", ".ww.ww"],
      ], mirror: true, alpha: 0.85,
    },
    cultist: {
      frames: [[
        "....RR", "...Rrr", "..Rrrr", "..Rkkk", ".Rrkek", ".Rrkkk", ".Rrrrr",
        "Rrrrrr", "RrrrrY", "Rrrrrr", "Rrrrrr", ".RRrrr", ".RRRRR", "...kk.",
      ]], mirror: true,
    },
    golem: {
      frames: [[
        "....GGGGG", "...Gggggg", "...GgcgGg", "...Gggggg", ".GGGGgggg", "GggggGggg",
        "GgGgggGgg", "GggggggGg", "GgggggggG", ".GGgggggg", "..Ggggggg", "..GgggGGG",
        "..Gggg...", ".GGggg...", ".kkkkk...",
      ]], mirror: true,
    },
    ogre: {
      frames: [[
        "........LLLL", "......LLllll", ".....Lllllll", "....Lllllll", "....LllllEll", "....Llllllll",
        "....LllwkkkK", "....LLllllll", "..LLLLLLLLLL", ".Lllllllllll", "Llll.Lllllll", "Llll.Lllllll",
        "lll..LLlllll", "ll...YYYYYYY", "LL...Nnnnnnn", ".....Nnnnnnn", ".....NnNnnNn", "......Llll..",
        "......Llll..", "......Llll..", ".....kkkkk..",
      ]], mirror: true,
    },
    lich: {
      frames: [[
        "....y..y.y", "....yyyyyy", "....wwwwww", "...wwwwwww", "...wkcwwww", "...wwwwwww",
        "....wkwkwk", "..VVvvvvvv", ".Vvvvvvvvv", "Vvvv.Vvvvv", "Vvv..Vvvvv", "ww...Vvvyv",
        ".....Vvvvy", ".....Vvvvv", "....Vvvvvv", "....Vvvvvv", "...Vvvvvvv", "...VvvvvVv",
        "..VvvvvVvv", "..VVvVVvVV", "..V.V..V.V",
      ]], mirror: true,
    },
    reaper: {
      frames: [[
        "........KKK", "......KKKKK", ".....KKkkkk", ".....Kkkkkk", "....KKkekkk", "....Kkkkkkk",
        "....KKkkkkk", "...KKKKkkkk", "..KKKKKKKKK", ".KKKKKKKKKK", "KKK.KKKKKKK", "ww..KKKKKKK",
        "....KKKKKKK", "....KKKKKKK", "...KKKKKKKK", "...KKKKKKKK", "..KKKKKKKKK", "..KKKGKKKKK",
        ".KKGKKKGKKK", ".KK.KK.KK.K",
      ]], mirror: true,
    },
    scythe: {
      frames: [[
        "....WWWWW.....", "..WWwwwwwWW...", ".Ww.......Ww..", "W...........w.", "..............",
        "...........N..", "..........N...", ".........N....", "........N.....", ".......N......",
        "......N.......", ".....N........", "....N.........", "...N..........",
      ]],
    },
  };

  // ---------- предмети ----------
  const GEM = ["..w..", ".wxX.", "wxxxX", "xxxXX", ".xXX.", "..X.."];
  Object.assign(S, {
    gemB: { frames: [GEM], map: { x: "b", X: "B" } },
    gemG: { frames: [GEM], map: { x: "l", X: "L" } },
    gemR: { frames: [GEM], map: { x: "r", X: "R" } },
    coin: {
      frames: [
        [".yyyy.", "yyYyyy", "yyYyyy", "yyYyyy", "yyYyyy", ".yyyy."],
        ["..yy..", ".yYyy.", ".yYyy.", ".yYyy.", ".yYyy.", "..yy.."],
        ["...y..", "...Y..", "...Y..", "...Y..", "...Y..", "...y.."],
        ["..yy..", ".yyYy.", ".yyYy.", ".yyYy.", ".yyYy.", "..yy.."],
      ],
    },
    food: { frames: [["..nnn....", ".nonnn...", "nooonnw..", "noooonww.", ".noonn.ww", "..nnn...w"]] },
    chest: {
      frames: [[
        ".NNNNNNNNNN.", "NnnnnnnnnnnN", "NnnnnnnnnnnN", "YYYYYyyYYYYY",
        "NnnnnyYnnnnN", "NnnnnnnnnnnN", "NnnnnnnnnnnN", "NNNNNNNNNNNN",
      ]],
    },
    vortex: { frames: [["..cccc..", ".c....c.", "c..bb..c", "c.b..b.c", "c.b..b.c", "c..b...c", ".c....c.", "..ccc..."]] },
  });

  // ---------- снаряди ----------
  Object.assign(S, {
    arrow: { frames: [["..ppccw.", ".pcccwww", "..ppccw."]] },
    knife: { frames: [["...G....", "nnGWWWWw", "...G...."]] },
    axe: { frames: [["..WWW...", ".WgWWW..", ".WgWWWn.", "..WWWn..", "....n...", "...n....", "..n.....", ".n......"]] },
    book: { frames: [["RRRRRR.", "RwwwwwR", "RwkkwwR", "RwwwwwR", "RwkkwwR", "RwwwwwR", "RRRRRR."]] },
    bookGold: { frames: [["YYYYYY.", "YwwwwwY", "YwkkwwY", "YwwwwwY", "YwkkwwY", "YwwwwwY", "YYYYYY."]] },
  });

  // ---------- декор мапи ----------
  Object.assign(S, {
    grave: { frames: [["..GGGG..", ".GggggG.", "GgggkggG", "GggkkkgG", "GgggkggG", "GgggkggG", "GggggggG", "GggggggG", "dLdLLdLd"]] },
    graveOld: { frames: [[".GGG....", "GgggG...", "GgkgG...", "GkkkGG..", "GgkgggG.", "GggggggG", "dLdLLdLd"]] },
    tree: {
      frames: [[
        "...N.....N...", "....N...N....", "..N.N..N..N..", "...NN.N.NN...", ".....NNN.....",
        "......N......", "......NN.....", "......Nn.....", "......Nn.....", ".....NNn.....",
        "....NNnnN....", "...NN.n..N...",
      ]],
    },
    rock: { frames: [[".GGGG...", "GggggGG.", "GgWgggGG", "GgggggGG", ".GGGGGG."]] },
    bush: { frames: [["...LLL....", ".LLlllL...", "LlllllLL..", "LllylllLL.", "LlllllllL.", ".LLLLLLL.."]] },
    bones: { frames: [["w.....w.", ".wwwww..", "w.....w.", "...www.."]] },
    mushroom: { frames: [[".rrr.", "rwrwr", "rrrrr", "..w..", "..w.."]] },
    candleProp: { frames: [["..o..", ".oyo.", "..y..", ".www.", ".wWw.", ".www.", "GGGGG"]] },
  });

  // ---------- іконки 12×12 для інтерфейсу ----------
  const ICONS = {
    sword: ["..........wW", ".........wWw", "........wWw.", ".......wWw..", "......wWw...", "..y..wWw....",
      "...yWWw.....", "....yw......", "...nyy......", "..nn..y.....", ".nn.........", "kn.........."],
    wand: [".....yy.....", ".....yy.....", "....yEEy....", "yyyyyEEyyyyy", ".yyyEEEEyyy.", "..yyEEEEyy..",
      "...yyEEyy...", "..yyy..yyy..", "..yy....yy..", ".yy......yy.", "............", "............"],
    knife: ["............", ".........ww.", "........wWw.", ".......wWw..", "......wWw...", ".....wWw....",
      "...G.Ww.....", "....GG......", "...nG.G.....", "..nn........", ".nn.........", "............"],
    axe: ["...WWWW.....", "..WgWWWW....", ".WggWWWnn...", ".WgWWWn.....", "..WWWn......", "....n.......",
      "...n........", "..n.........", ".n..........", "n...........", "............", "............"],
    pool: [".....b......", ".....b......", "....bcb.....", "....bcb.....", "...bccbb....", "..bbcbbbB...",
      "..bcbbbbB...", "..bbbbbbB...", "..bbbbbBB...", "...bbbBB....", "....BBB.....", "............"],
    orbit: ["............", ".RRRRRRRR...", ".RwwwwwwRR..", ".RwkkkwwRR..", ".RwwwwwwRR..", ".RwkkwwwRR..",
      ".RwwwwwwRR..", ".RwkkkwwRR..", ".RwwwwwwRR..", ".RRRRRRRRR..", "..RRRRRRRR..", "............"],
    aura: [".....l......", ".....L......", "....wLw.....", "...wwwww....", "..wwWwwWw...", "..wwWwwWw...",
      "..wwWwwWw...", "..wwWwwWw...", "...wWwwW....", "....www.....", "...W.W.W....", "............"],
    bolt: [".......yyy..", "......yyy...", ".....yyy....", "....yyy.....", "...yyyyyyy..", "......yyy...",
      ".....yyy....", "....yyy.....", "...yy.......", "..yy........", ".y..........", "............"],
    might: ["............", "....yyy.....", "...yrrry....", "...yrrry....", "....yyy.....", "...y...y....",
      "..y.....y...", "..y.....y...", "..y.....y...", "...y...y....", "....yyy.....", "............"],
    tome: ["............", "..RRRRRRR...", "..RyyyyyRR..", "..RyRRRyRR..", "..RyyyyyRR..", "..RRRRRRRR..",
      "..RRRyRRRR..", "..RRyyyRRR..", "..RRRyRRRR..", "..RRRRRRRR..", "...wwwwwww..", "............"],
    candle: [".....o......", "....oyo.....", "....oyo.....", ".....k......", "....www.....", "....wWw.....",
      "....wWw.....", "....wWw.....", "....wWw.....", "..YYYYYYY...", "...YYYYY....", "............"],
    bracer: ["............", "...gggg.....", "..gGGGGg....", "..gGWWGg....", "..gGGGGg....", "..gGWWGg....",
      "..gGGGGg....", "..nnnnnn....", "..nNNNNn....", "...nnnn.....", "............", "............"],
    hourglass: ["..NNNNNNN...", "...wwwww....", "...wyyyw....", "....wyw.....", ".....y......", "....w.w.....",
      "...w.y.w....", "...wyyyw....", "...wwwww....", "..NNNNNNN...", "............", "............"],
    amulet: ["....yyy.....", "...y...y....", "...y...y....", "....y.y.....", "...bbbbb....", "..bwwwwwb...",
      "..bwbkbwb...", "..bwwwwwb...", "...bbbbb....", "............", "............", "............"],
    heart: ["............", "..rr...rr...", ".rwrr.rrrr..", ".rwrrrrrrR..", ".rrrrrrrrR..", "..rrrrrrR...",
      "...rrrrrR...", "....rrrR....", ".....rR.....", "............", "............", "............"],
    armor: ["............", "..gggggggg..", "..gWWWWWWg..", "..gWwwwwWg..", "..gWwrrwWg..", "..gWwrrwWg..",
      "..gWwwwwWg..", "...gWwwWg...", "....gWWg....", ".....gg.....", "............", "............"],
    crown: ["............", "..y..y..y...", "..yy.yy.yy..", "..yyyyyyyy..", "..yryybyry..", "..yyyyyyyy..",
      "..YYYYYYYY..", "............", "............", "............", "............", "............"],
    magnet: ["............", "..rrr..ggg..", "..rrr..ggg..", "..rr....gg..", "..rr....gg..", "..rr....gg..",
      "..rrr..ggg..", "...rrrggg...", "....rggg....", "............", "............", "............"],
    boots: ["............", "...nnn......", "...nNn......", "...nNn......", "...nNn......", "...nNnn.....",
      "...nNNnnn...", "..nNNNNNnn..", "..kkkkkkkk..", "............", "............", "............"],
    clover: ["............", "...ll.ll....", "..lllLlll...", "..lLlLlLl...", "...lLLLl....", "..lllLlll...",
      "..lLlLlLl...", "...ll.ll....", ".....L......", "......L.....", "............", "............"],
    regen: ["............", "......lL....", ".....llL....", "....lllL....", "...llllL....", "..lllLLL....",
      "..llLlLL....", "..lLllL.....", "...LLL......", "..L.........", "............", "............"],
    scroll: ["............", "..wwwwwwww..", ".wWwwwwwwW..", "..wkkkkkw...", "..wwwwwww...", "..wkkkkw....",
      "..wwwwwww...", "..wkkkkkw...", ".wWwwwwwwW..", "..wwwwwwww..", "............", "............"],
    greed: ["............", ".....N......", "....NNN.....", "...nnnnn....", "..nnnynnn...", "..nnyyynn...",
      "..nnnyynn...", "..nnyyynn...", "..nnnynnn...", "...nnnnn....", "............", "............"],
    dice: ["............", "..wwwwwww...", ".wWwwwwkWw..", ".wwwwwwwww..", ".wwwwkwwww..", ".wwwwwwwww..",
      ".wkwwwwwww..", ".wWwwwwwWw..", "..wwwwwww...", "............", "............", "............"],
    feather: ["........ww..", ".......wWw..", "......wWw...", ".....wWww...", "....wWww....", "...wWww.....",
      "...wWw......", "..wWw.......", "..ww........", ".n..........", "n...........", "............"],
    gold: ["............", "...yyyyy....", "..yyYYYyy...", ".yyYyyyYyy..", ".yyYyyyyyy..", ".yyYyyyyyy..",
      ".yyYyyyYyy..", "..yyYYYyy...", "...yyyyy....", "............", "............", "............"],
    food: ["............", "...nnn......", "..nonnn.....", ".nooonnw....", ".noooonww...", "..noonn.ww..",
      "...nnn...w..", "............", "............", "............", "............", "............"],
    skull: ["............", "...wwwww....", "..wwwwwww...", "..wkkwkkw...", "..wkkwkkw...", "..wwwwwww...",
      "...wwkww....", "...wkwkw....", "............", "............", "............", "............"],
  };

  window.HordeSprites = { PALETTE, HERO_COLORS, HEADS, BODY_A, BODY_B, SPRITES: S, ICONS };
})();
