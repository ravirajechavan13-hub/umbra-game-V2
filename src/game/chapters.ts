import type {
  Rect, Body, Door, Plate, Lever, Saw, Boulder, Rope, Theme, Whisper,
  BearTrap, FallingLog, Platform, Conveyor, Spark, Magnet, GravZone, Spider,
} from "./types";

export interface ChapterMeta { roman: string; title: string; subtitle: string; }

const ROM = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
  "XXI", "XXII", "XXIII", "XXIV", "XXV"];
const TITLES: [string, string][] = [
  ["", ""],
  ["The Whispering Wood", "first steps in the dark"],
  ["Thorns and Patience", "the ground keeps secrets"],
  ["The Crouching Tribe", "watched from the ferns"],
  ["Canopy of Teeth", "swing, or fall"],
  ["The Drowned Path", "wood floats, you do not"],
  ["Hollow of Bone", "the caves remember"],
  ["Webbed Arches", "nothing here is empty"],
  ["The Crawling Dark", "it drops when you pass"],
  ["Stones That Dream", "push what the dead left"],
  ["The Iron Threshold", "the city wakes"],
  ["Wires and Weight", "gravity is a lever here"],
  ["Furnace Clock", "the sparks keep time"],
  ["The Pulling Dark", "let the iron carry you"],
  ["Gears Without Mercy", "the floor moves"],
  ["Where Down Betrays", "the ceiling is a floor"],
  ["The Unseen Stair", "trust the shadow"],
  ["Ceiling of Blades", "walk upside, dodge"],
  ["The Long Machine", "it does not tire"],
  ["Reverse and Ruin", "the belt runs backward"],
  ["The Blind Ascent", "climb what you cannot see"],
  ["Inverted Prayers", "every rule, flipped"],
  ["The Cruel Cadence", "dance or die"],
  ["Shadows Only", "the fog is the map"],
  ["Every Rule Undone", "all at once"],
  ["She Was Waiting", "the light at the end"],
];
export const CHAPTER_META: ChapterMeta[] = ROM.map((r, i) => ({
  roman: r || "—", title: TITLES[i]?.[0] || "", subtitle: TITLES[i]?.[1] || "",
}));
const THEMES: Theme[] = ["mist",
  "forest", "forest", "forest", "forest", "forest",
  "ruins", "ruins", "ruins", "ruins",
  "factory", "factory", "factory", "factory", "factory",
  "void", "void", "void",
  "factory", "factory",
  "void", "void",
  "factory", "void", "factory",
  "void"];

export interface LevelData {
  chapter: number; theme: Theme; width: number; groundY: number;
  spawn: { x: number; y: number }; goal: Rect; girl: boolean;
  solids: Rect[]; crates: Body[]; floats: Body[]; cages: Body[]; doors: Door[];
  plates: Plate[]; levers: Lever[]; saws: Saw[]; boulders: Boulder[]; ropes: Rope[];
  spikes: Rect[]; water: Rect[]; invisibles: Rect[]; bearTraps: BearTrap[];
  fallingLogs: FallingLog[]; platforms: Platform[]; conveyors: Conveyor[];
  sparks: Spark[]; magnets: Magnet[]; gravZones: GravZone[]; spiders: Spider[];
  whispers: Whisper[]; checkpoints: { x: number; y: number }[];
}

const G = 520;
const JMAX = 110; // max pure-jump gap — clearable even at walk speed

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
interface C { x: number; id: number; }
type Seg = (L: LevelData, c: C, r: Rng) => boolean; // returns ended-on-ground

function base(n: number): LevelData {
  return {
    chapter: n, theme: THEMES[n] || "mist", width: 0, groundY: G, girl: false,
    spawn: { x: 60, y: G - 60 }, goal: { x: 0, y: 0, w: 0, h: 0 },
    solids: [], crates: [], floats: [], cages: [], doors: [], plates: [], levers: [],
    saws: [], boulders: [], ropes: [], spikes: [], water: [], invisibles: [],
    bearTraps: [], fallingLogs: [], platforms: [], conveyors: [], sparks: [],
    magnets: [], gravZones: [], spiders: [], whispers: [], checkpoints: [],
  };
}
const ri = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const ground = (L: LevelData, c: C, len: number) => { L.solids.push({ x: c.x, y: G, w: len, h: 400 }); c.x += len; };
const pit = (L: LevelData, x: number, w: number) => {
  L.spikes.push({ x, y: G + 10, w, h: 30 }); L.solids.push({ x, y: G + 40, w, h: 360 });
};

// ----- fair segments -----
const segJump: Seg = (L, c, r) => { const w = ri(r, 70, JMAX); pit(L, c.x, w); c.x += w; return false; };
const segRope: Seg = (L, c, r) => { const w = ri(r, 150, 240); pit(L, c.x, w); L.ropes.push({ px: c.x + 88, py: 130, len: 380, angle: -0.25, angVel: 0 }); c.x += w; return false; };
const segInvis: Seg = (L, c, r) => {
  const n = ri(r, 2, 4); const stepW = 120, sp = 190, span = n * sp;
  pit(L, c.x, span); let ry = G - 70;
  for (let i = 0; i < n; i++) { L.invisibles.push({ x: c.x + 30 + i * sp, y: ry, w: stepW, h: 18 }); ry -= 40; }
  c.x += span; return false;
};
const segMplat: Seg = (L, c, r) => {
  const w = ri(r, 150, 230); const pw = 110; const range = (w - 30) / 2; const px = c.x - 40 + range;
  pit(L, c.x, w); L.platforms.push({ x: px, y: G - 18, w: pw, h: 18, px, py: G - 18, axis: "x", range, speed: 1.0, phase: 0 });
  c.x += w; return false;
};
const segWater: Seg = (L, c, r) => {
  const w = ri(r, 260, 420); const top = G - 80;
  L.solids.push({ x: c.x, y: G + 180, w, h: 220 }); L.water.push({ x: c.x, y: top, w, h: 260 });
  for (let fx = c.x + 120; fx + 100 < c.x + w - 60; fx += 170)
    L.floats.push({ x: fx, y: top - 24, w: 100, h: 40, vx: 0, vy: 0, buoyant: true, onGround: false });
  c.x += w; return false;
};
const segSawLane: Seg = (L, c, r) => {
  const n = ri(r, 1, 3); const len = n * 150 + 120; ground(L, c, len);
  for (let i = 0; i < n; i++) L.saws.push({ cx: c.x - len + 100 + i * 150, cy: G - 90, r: 34, axis: "y", range: 70, speed: 1.6 + i * 0.3, phase: i * 1.3, angle: 0 });
  return true;
};
const segSparkLane: Seg = (L, c, r) => {
  const n = ri(r, 2, 4); const per = 1.8 + r() * 0.6; const len = n * 130 + 120; ground(L, c, len);
  for (let i = 0; i < n; i++) L.sparks.push({ x: c.x - len + 90 + i * 130, y: G - 180, w: 26, h: 180, period: per, phase: (i * per) / n });
  return true;
};
const segConvey: Seg = (L, c, r) => {
  const len = ri(r, 240, 340); const dir = (r() < 0.5 ? 1 : -1) as 1 | -1; const total = len + 140;
  ground(L, c, total); L.conveyors.push({ x: c.x - len + 20, y: G - 12, w: len - 40, h: 12, dir, on: true, phase: 0 });
  return true;
};
const segTimed: Seg = (L, c, r) => {
  const sec = 1.7 + r() * 0.7; const saw = r() < 0.6; const id = c.id++; ground(L, c, 420);
  const s0 = c.x - 420; const lx = s0 + 60, dx = s0 + 230, sx = s0 + 310;
  L.levers.push({ x: lx, y: G, id, on: false, timed: sec });
  const gc = G - 220; L.doors.push({ x: dx, y: gc, w: 30, h: 220, open: false, link: id, yClosed: gc, yOpen: gc - 220 });
  if (saw) L.saws.push({ cx: sx, cy: G - 90, r: 34, axis: "y", range: 70, speed: 2.2, phase: 0, angle: 0 });
  return true;
};
const segPlate: Seg = (L, c, _r) => {
  const id = c.id++; ground(L, c, 300); const s0 = c.x - 300;
  L.crates.push({ x: s0 + 70, y: G - 56, w: 56, h: 56, vx: 0, vy: 0, onGround: false });
  L.plates.push({ x: s0 + 180, y: G - 14, w: 80, h: 14, id, pressed: false });
  const gc = G - 220; L.doors.push({ x: s0 + 250, y: gc, w: 26, h: 220, open: false, link: id, yClosed: gc, yOpen: gc - 220 });
  return true;
};
const segClimb: Seg = (L, c, r) => {
  const pw = ri(r, 130, 150); ground(L, c, 240); const s0 = c.x - 240;
  L.cages.push({ x: s0 + 90, y: G - 100, w: 70, h: 100, vx: 0, vy: 0, onGround: false });
  L.solids.push({ x: s0 + 200, y: G - 100, w: 30, h: 100 });
  pit(L, c.x, pw); L.solids.push({ x: s0 + 200, y: 340, w: pw + 120, h: 40 });
  c.x += pw; return false;
};
const segMagBonus: Seg = (L, c, r) => {
  const w = ri(r, 80, JMAX); pit(L, c.x, w); L.magnets.push({ x: c.x + w / 2, y: G - 230, r: 170, strength: 420 });
  c.x += w; return false;
};
const segGrav: Seg = (L, c, r) => {
  const w = ri(r, 300, 440); ground(L, c, w + 120); const zx = c.x - (w + 120) + 60, zw = w - 60;
  if (r() < 0.5) L.invisibles.push({ x: zx, y: 90, w: zw, h: 18 }); else L.solids.push({ x: zx, y: 80, w: zw, h: 30 });
  L.gravZones.push({ x: zx, y: 0, w: zw, h: 800, dir: -1 });
  L.saws.push({ cx: zx + zw / 2, cy: 150, r: 30, axis: "x", range: Math.max(40, zw / 2 - 50), speed: 1.6, phase: 0, angle: 0 });
  return true;
};
const segBoulder: Seg = (L, c, r) => {
  const len = ri(r, 320, 460); ground(L, c, len); const ge = c.x; const w = ri(r, 80, JMAX);
  pit(L, ge, w);
  L.boulders.push({ x: ge - len + 40, y: 40, r: 34, vx: 0, vy: 0, triggerX: ge - 70, released: false, startX: ge - len + 40, startY: 40, angle: 0 });
  c.x = ge + w; return false;
};
const segSpider: Seg = (L, c, r) => {
  const n = ri(r, 1, 3); const len = n * 150 + 120; ground(L, c, len);
  for (let i = 0; i < n; i++) L.spiders.push({ x: c.x - len + 100 + i * 150, ceilingY: 30, y: 50, restY: 50, triggered: false, vy: 0, phase: i });
  return true;
};
const segBear: Seg = (L, c, r) => {
  const len = ri(r, 220, 340); ground(L, c, len); const n = ri(r, 1, 2);
  for (let i = 0; i < n; i++) { const bx = c.x - len + 60 + Math.floor(r() * (len - 120)); L.bearTraps.push({ x: bx, y: G - 10, w: 46, hidden: true, sprung: false, timer: 0 }); }
  return true;
};

const POOLS: Record<Theme, Seg[]> = {
  mist: [segJump, segRope],
  forest: [segJump, segRope, segBear, segSpider, segClimb, segWater, segMagBonus],
  ruins: [segJump, segInvis, segMplat, segPlate, segSpider, segClimb, segWater, segSawLane],
  factory: [segSawLane, segSparkLane, segConvey, segTimed, segMagBonus, segJump, segGrav, segClimb, segPlate, segBoulder],
  void: [segGrav, segInvis, segMagBonus, segJump, segSparkLane, segSawLane, segClimb, segMplat],
};
function poolFor(n: number): Seg[] {
  let p = POOLS[THEMES[n] || "forest"].slice();
  if (n <= 1) p = p.filter((s) => s !== segBear && s !== segBoulder && s !== segGrav && s !== segTimed && s !== segSparkLane && s !== segInvis && s !== segMplat && s !== segPlate && s !== segSawLane);
  else if (n <= 3) p = p.filter((s) => s !== segGrav && s !== segTimed && s !== segSparkLane);
  else if (n <= 6) p = p.filter((s) => s !== segGrav);
  if (p.length === 0) p = [segJump, segRope];
  return p;
}

// scatter hidden bear-traps on long safe ground runs (die-once-to-learn, varied positions)
function addRandomHiddenTraps(L: LevelData, r: Rng, n: number) {
  if (n < 2) return;
  const prob = Math.min(0.8, 0.12 + n * 0.03);
  const grounds = L.solids.filter((s) => s.y === G && s.w > 240);
  for (const s of grounds) {
    if (r() > prob) continue;
    if (L.bearTraps.some((b) => b.x > s.x - 10 && b.x < s.x + s.w + 10)) continue;
    const lo = s.x + 50, hi = s.x + s.w - 50 - 46; if (hi <= lo) continue;
    const bx = lo + Math.floor(r() * (hi - lo));
    if (L.spikes.some((sp) => Math.abs(sp.x - (bx + 23)) < 70 || Math.abs(sp.x + sp.w - (bx + 23)) < 70)) continue;
    L.bearTraps.push({ x: bx, y: G - 10, w: 46, hidden: true, sprung: false, timer: 0 });
  }
}

const WHISP: Record<Theme, string[]> = {
  mist: ["walk right. jump the gap. hold grab to push."],
  forest: ["The leaves keep their own counsel.", "Something watches from the ferns.", "Don't trust the quiet.", "The tribe remembers your footsteps.", "Webs are never empty here."],
  ruins: ["Stone remembers the living.", "Bones do not lie.", "The dark drips.", "A giant patience waits above."],
  factory: ["The machines do not sleep.", "Sparks keep a cruel clock.", "Gravity is a lever here.", "The belt has no mercy."],
  void: ["Down is a memory.", "The shadow is the only truth.", "Climb what you cannot see.", "Every rule, undone."],
};
function scatterWhispers(L: LevelData) {
  const pool = WHISP[L.theme] || WHISP.mist;
  for (const f of [0.28, 0.52, 0.78]) {
    const px = L.width * f;
    if (px > 120 && px < L.width - 120) L.whispers.push({ x: px, text: pool[(L.chapter + Math.round(f * 7)) % pool.length] });
  }
}

function makeLevel(n: number): LevelData {
  const r = mulberry32(n * 99991 + 7);
  const L = base(n);
  const c: C = { x: 0, id: 1 };
  ground(L, c, 200);
  const pool = poolFor(n);
  const segCount = 4 + Math.floor(n * 0.42);
  let sinceCp = 0, lastGround = true;
  for (let i = 0; i < segCount; i++) {
    ground(L, c, lastGround ? ri(r, 80, 130) : ri(r, 110, 160));
    lastGround = true;
    const seg = pool[Math.floor(r() * pool.length)];
    lastGround = seg(L, c, r);
    if (++sinceCp >= 3 && lastGround) { L.checkpoints.push({ x: c.x - 30, y: G - 60 }); sinceCp = 0; }
  }
  if (!lastGround) ground(L, c, ri(r, 120, 160));
  ground(L, c, 180);
  L.checkpoints.push({ x: c.x - 120, y: G - 60 });
  addRandomHiddenTraps(L, r, n);
  scatterWhispers(L);
  L.width = c.x + 200;
  L.goal = { x: c.x - 110, y: G - 150, w: 70, h: 150 };
  L.girl = n === 25;
  return L;
}

export function buildChapter(n: number): LevelData {
  return makeLevel(Math.max(1, Math.min(25, n)));
}
