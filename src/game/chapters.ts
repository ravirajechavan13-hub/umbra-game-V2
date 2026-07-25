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
  ["The Whispering Wood", "learn to breathe quietly"],
  ["Thorns and Patience", "the ground keeps teeth"],
  ["The Crouching Tribe", "you are being watched"],
  ["Canopy of Teeth", "rope, or fall"],
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
const GAP = new Set(["pit", "rope", "invis", "water", "magPit", "mplat"]);
type Beat = [string, ...number[]];
interface Ctx { x: number; onGround: boolean; id: number; }

function base(chapter: number): LevelData {
  return {
    chapter, theme: THEMES[chapter] || "mist", width: 0, groundY: G, girl: false,
    spawn: { x: 60, y: G - 60 }, goal: { x: 0, y: 0, w: 0, h: 0 },
    solids: [], crates: [], floats: [], cages: [], doors: [], plates: [], levers: [],
    saws: [], boulders: [], ropes: [], spikes: [], water: [], invisibles: [],
    bearTraps: [], fallingLogs: [], platforms: [], conveyors: [], sparks: [],
    magnets: [], gravZones: [], spiders: [], whispers: [], checkpoints: [],
  };
}
const mb = (x: number, y: number, w: number, h: number, buoyant = false): Body =>
  ({ x, y, w, h, vx: 0, vy: 0, buoyant, onGround: false });

function pad(L: LevelData, c: Ctx, len: number) {
  if (len <= 0) return;
  L.solids.push({ x: c.x, y: G, w: len, h: 400 });
  c.x += len; c.onGround = true;
}

function applyBeat(L: LevelData, b: Beat, c: Ctx) {
  const t = b[0];
  const x = c.x;
  switch (t) {
    case "ground": case "run": pad(L, c, b[1]); return;
    case "bear": {
      const n = b[1]; const span = n * 180 + 120;
      L.solids.push({ x, y: G, w: span, h: 400 });
      for (let i = 0; i < n; i++) L.bearTraps.push({ x: x + 80 + i * 180, y: G - 10, w: 46, hidden: true, sprung: false, timer: 0 });
      c.x += span; c.onGround = true; return;
    }
    case "spider": {
      const n = b[1]; const span = n * 150 + 120;
      L.solids.push({ x, y: G, w: span, h: 400 });
      for (let i = 0; i < n; i++) L.spiders.push({ x: x + 100 + i * 150, ceilingY: 30, y: 50, restY: 50, triggered: false, vy: 0, phase: i });
      c.x += span; c.onGround = true; return;
    }
    case "sawsG": {
      const n = b[1]; const span = n * 150 + 140;
      L.solids.push({ x, y: G, w: span, h: 400 });
      for (let i = 0; i < n; i++) L.saws.push({ cx: x + 100 + i * 150, cy: G - 30, r: 38, axis: "y", range: 70, speed: 2.2 + i * 0.2, phase: i * 0.8, angle: 0 });
      c.x += span; c.onGround = true; return;
    }
    case "sparks": {
      const n = b[1]; const per = b[2] || 1.8; const span = n * 140 + 140;
      L.solids.push({ x, y: G, w: span, h: 400 });
      for (let i = 0; i < n; i++) L.sparks.push({ x: x + 90 + i * 140, y: G - 180, w: 26, h: 180, period: per, phase: (i * per) / n });
      c.x += span; c.onGround = true; return;
    }
    case "conv": {
      const w = b[1]; const dir = (b[2] || 1) as 1 | -1; const n = b[3] || 2;
      L.solids.push({ x, y: G, w: w + 120, h: 400 });
      L.conveyors.push({ x: x + 40, y: G - 12, w: w - 80, h: 12, dir, on: true, phase: 0 });
      for (let i = 0; i < n; i++) L.saws.push({ cx: x + 40 + ((i + 1) * (w - 80)) / (n + 1), cy: G - 90, r: 36, axis: "y", range: 70, speed: 2.4 + i * 0.2, phase: i * 0.7, angle: 0 });
      c.x += w + 120; c.onGround = true; return;
    }
    case "beltKill": {
      const w = b[1]; const dir = (b[2] || 1) as 1 | -1; const id = c.id++;
      L.solids.push({ x, y: G, w: w + 220, h: 400 });
      L.levers.push({ x: x + 60, y: G, id, on: false });
      L.conveyors.push({ x: x + 150, y: G - 12, w: w - 120, h: 12, dir, on: true, link: id, phase: 0 });
      L.saws.push({ cx: x + w + 40, cy: G - 90, r: 40, axis: "y", range: 70, speed: 2.2, phase: 0, angle: 0 });
      c.x += w + 220; c.onGround = true; return;
    }
    case "timedGate": {
      const sec = b[1]; const saw = b[2]; const id = c.id++;
      L.solids.push({ x, y: G, w: 540, h: 400 });
      L.levers.push({ x: x + 80, y: G, id, on: false, timed: sec });
      const gc = G - 220;
      L.doors.push({ x: x + 250, y: gc, w: 30, h: 220, open: false, link: id, yClosed: gc, yOpen: gc - 220 });
      if (saw) L.saws.push({ cx: x + 350, cy: G - 90, r: 36, axis: "y", range: 70, speed: 2.6, phase: 0, angle: 0 });
      c.x += 540; c.onGround = true; return;
    }
    case "plate": {
      const id = c.id++;
      L.solids.push({ x, y: G, w: 480, h: 400 });
      L.crates.push(mb(x + 80, G - 56, 56, 56));
      L.plates.push({ x: x + 250, y: G - 14, w: 80, h: 14, id, pressed: false });
      const gc = G - 220;
      L.doors.push({ x: x + 400, y: gc, w: 26, h: 220, open: false, link: id, yClosed: gc, yOpen: gc - 220 });
      c.x += 480; c.onGround = true; return;
    }
    case "magNudge": {
      const str = b[1] || -320;
      L.solids.push({ x, y: G, w: 380, h: 400 });
      L.magnets.push({ x: x + 180, y: G - 40, r: 165, strength: str });
      L.saws.push({ cx: x + 310, cy: G - 90, r: 38, axis: "y", range: 70, speed: 2.4, phase: 0.5, angle: 0 });
      c.x += 380; c.onGround = true; return;
    }
    case "boulder": {
      const len = b[1];
      L.solids.push({ x, y: G, w: len + 200, h: 400 });
      L.boulders.push({ x: x + 40, y: 40, r: 34, vx: 0, vy: 0, triggerX: x + 130, released: false, startX: x + 40, startY: 40, angle: 0 });
      c.x += len + 200; c.onGround = true; return;
    }
    case "climb": {
      const pitW = b[1];
      L.solids.push({ x, y: G, w: 300, h: 400 });
      L.cages.push(mb(x + 100, G - 100, 70, 100));
      L.solids.push({ x: x + 240, y: G - 100, w: 30, h: 100 });
      L.spikes.push({ x: x + 300, y: G + 10, w: pitW, h: 30 });
      L.solids.push({ x: x + 300, y: G + 40, w: pitW, h: 360 });
      L.solids.push({ x: x + 240, y: 340, w: pitW + 100, h: 40 });
      L.solids.push({ x: x + 300 + pitW, y: G, w: 200, h: 400 });
      c.x += 300 + pitW + 200; c.onGround = true; return;
    }
    case "grav": {
      const w = b[1]; const inv = b[2];
      L.solids.push({ x, y: G, w: w + 120, h: 400 });
      const zx = x + 60; const zw = w - 60;
      if (inv) L.invisibles.push({ x: zx, y: 90, w: zw, h: 18 });
      else L.solids.push({ x: zx, y: 80, w: zw, h: 30 });
      L.gravZones.push({ x: zx, y: 0, w: zw, h: 800, dir: -1 });
      L.saws.push({ cx: zx + zw / 2, cy: 150, r: 32, axis: "x", range: Math.max(40, zw / 2 - 40), speed: 1.8, phase: 0, angle: 0 });
      c.x += w + 120; c.onGround = true; return;
    }
    case "cp":
      L.checkpoints.push({ x: Math.max(40, c.x - 30), y: G - 60 });
      return;
    case "pit":
      L.spikes.push({ x, y: G + 10, w: b[1], h: 30 });
      L.solids.push({ x, y: G + 40, w: b[1], h: 360 });
      c.x += b[1]; c.onGround = false; return;
    case "rope":
      L.spikes.push({ x, y: G + 10, w: b[1], h: 30 });
      L.solids.push({ x, y: G + 40, w: b[1], h: 360 });
      L.ropes.push({ px: x + 88, py: 130, len: 380, angle: -0.25, angVel: 0 });
      c.x += b[1]; c.onGround = false; return;
    case "invis": {
      const steps = b[1]; const span = steps * 200;
      L.spikes.push({ x, y: G + 10, w: span, h: 30 });
      L.solids.push({ x, y: G + 40, w: span, h: 360 });
      for (let i = 0; i < steps; i++) L.invisibles.push({ x: x + 30 + i * 200, y: G - 70 - i * 46, w: 130, h: 18 });
      c.x += span; c.onGround = false; return;
    }
    case "water": {
      const w = b[1]; const n = b[2] || 4; const top = G - 80;
      L.solids.push({ x, y: G + 180, w, h: 220 });
      L.water.push({ x, y: top, w, h: 260 });
      const inner = w / (n + 1);
      for (let i = 0; i < n; i++) L.floats.push(mb(x + inner * (i + 1) - 45, top - 24, 90, 40, true));
      c.x += w; c.onGround = false; return;
    }
    case "magPit": {
      const w = b[1]; const str = b[2] || 560;
      L.spikes.push({ x, y: G + 10, w, h: 30 });
      L.solids.push({ x, y: G + 40, w, h: 360 });
      L.magnets.push({ x: x + w / 2, y: G - 240, r: Math.max(180, w * 0.6), strength: str });
      c.x += w; c.onGround = false; return;
    }
    case "mplat": {
      const pitW = b[1]; const pw = 110; const range = Math.max(60, (pitW - 50) / 2);
      const px = x - 30 + range;
      L.spikes.push({ x, y: G + 10, w: pitW, h: 30 });
      L.solids.push({ x, y: G + 40, w: pitW, h: 360 });
      L.platforms.push({ x: px, y: G - 18, w: pw, h: 18, px, py: G - 18, axis: "x", range, speed: 1.0, phase: 0 });
      c.x += pitW; c.onGround = false; return;
    }
    default: return;
  }
}

const WHISP: Record<Theme, string[]> = {
  mist: ["walk right. jump the gap. hold GRAB to push."],
  forest: ["The leaves keep their own counsel.", "Something watches from the ferns.", "Don't trust the quiet.", "The tribe remembers your footsteps.", "Webs are never empty here."],
  ruins: ["Stone remembers the living.", "Bones do not lie.", "The dark drips.", "A giant patience waits above."],
  factory: ["The machines do not sleep.", "Sparks keep a cruel clock.", "Gravity is a lever here.", "The belt has no mercy."],
  void: ["Down is a memory.", "The shadow is the only truth.", "Climb what you cannot see.", "Every rule, undone."],
};
function scatterWhispers(L: LevelData) {
  const pool = WHISP[L.theme] || WHISP.mist;
  const spots = [0.3, 0.55, 0.82];
  for (let i = 0; i < spots.length; i++) {
    const px = L.width * spots[i];
    if (px > 120 && px < L.width - 120) L.whispers.push({ x: px, text: pool[(L.chapter + i) % pool.length] });
  }
}

const LEVELS: Beat[][] = [
  [], // 0 unused
  [["ground", 220], ["pit", 130], ["ground", 160], ["bear", 1], ["ground", 160], ["pit", 150], ["ground", 160], ["spider", 1], ["ground", 180], ["cp"], ["rope", 300], ["ground", 220]],
  [["ground", 180], ["pit", 150], ["sawsG", 1], ["ground", 160], ["plate"], ["ground", 160], ["bear", 2], ["ground", 160], ["cp"], ["pit", 170], ["ground", 160], ["rope", 320], ["ground", 220]],
  [["ground", 160], ["spider", 2], ["ground", 140], ["climb", 300], ["ground", 140], ["boulder", 420], ["ground", 140], ["cp"], ["pit", 180], ["ground", 160], ["bear", 2], ["ground", 220]],
  [["ground", 140], ["bear", 2], ["ground", 120], ["pit", 190], ["ground", 120], ["rope", 360], ["ground", 120], ["spider", 2], ["ground", 120], ["cp"], ["sawsG", 2], ["ground", 120], ["pit", 200], ["ground", 220]],
  [["ground", 140], ["water", 720, 4], ["ground", 140], ["magNudge", -300], ["ground", 120], ["cp"], ["timedGate", 2.6, 1], ["ground", 120], ["bear", 3], ["ground", 120], ["rope", 380], ["ground", 220]],
  [["ground", 140], ["mplat", 420], ["ground", 140], ["invis", 3], ["ground", 140], ["plate"], ["ground", 120], ["cp"], ["spider", 2], ["ground", 120], ["pit", 190], ["ground", 220]],
  [["ground", 120], ["climb", 320], ["ground", 120], ["invis", 4], ["ground", 120], ["cp"], ["timedGate", 2.4, 1], ["ground", 120], ["bear", 2], ["ground", 120], ["pit", 200], ["ground", 220]],
  [["ground", 120], ["mplat", 440], ["ground", 120], ["water", 760, 4], ["ground", 120], ["boulder", 440], ["ground", 120], ["cp"], ["bear", 2], ["ground", 220]],
  [["ground", 120], ["invis", 4], ["ground", 120], ["grav", 480, 0], ["ground", 120], ["plate"], ["ground", 120], ["cp"], ["spider", 3], ["ground", 120], ["pit", 200], ["ground", 220]],
  [["ground", 120], ["conv", 420, 1, 2], ["ground", 120], ["sparks", 4, 1.8], ["ground", 120], ["beltKill", 420, 1], ["ground", 120], ["cp"], ["sawsG", 2], ["ground", 220]],
  [["ground", 120], ["grav", 520, 0], ["ground", 120], ["timedGate", 2.2, 1], ["ground", 120], ["magNudge", -340], ["ground", 120], ["cp"], ["conv", 420, -1, 2], ["ground", 220]],
  [["ground", 120], ["sparks", 5, 1.5], ["ground", 120], ["beltKill", 440, 1], ["ground", 120], ["grav", 480, 1], ["ground", 120], ["cp"], ["boulder", 460], ["ground", 220]],
  [["ground", 120], ["conv", 440, 1, 2], ["ground", 120], ["magPit", 380, 540], ["ground", 120], ["timedGate", 2.0, 1], ["ground", 120], ["cp"], ["invis", 3], ["ground", 220]],
  [["ground", 120], ["beltKill", 440, 1], ["ground", 120], ["sparks", 4, 1.4], ["ground", 120], ["conv", 440, -1, 2], ["ground", 120], ["cp"], ["grav", 560, 1], ["ground", 220]],
  [["ground", 120], ["grav", 520, 1], ["ground", 120], ["invis", 4], ["ground", 120], ["magPit", 380, 560], ["ground", 120], ["cp"], ["grav", 480, 0], ["ground", 220]],
  [["ground", 120], ["invis", 5], ["ground", 120], ["grav", 560, 1], ["ground", 120], ["magNudge", -360], ["ground", 120], ["cp"], ["invis", 4], ["ground", 220]],
  [["ground", 120], ["grav", 520, 1], ["ground", 120], ["invis", 5], ["ground", 120], ["magPit", 400, 580], ["ground", 120], ["cp"], ["sparks", 4, 1.4], ["ground", 220]],
  [["ground", 110], ["timedGate", 1.8, 1], ["ground", 110], ["beltKill", 440, 1], ["ground", 110], ["sparks", 5, 1.4], ["ground", 110], ["cp"], ["conv", 440, 1, 2], ["ground", 110], ["magNudge", -360], ["ground", 220]],
  [["ground", 110], ["conv", 440, -1, 2], ["ground", 110], ["beltKill", 440, 1], ["ground", 110], ["grav", 520, 1], ["ground", 110], ["cp"], ["timedGate", 1.8, 1], ["ground", 110], ["invis", 3], ["ground", 220]],
  [["ground", 110], ["invis", 6], ["ground", 110], ["grav", 560, 1], ["ground", 110], ["magPit", 400, 580], ["ground", 110], ["cp"], ["invis", 5], ["ground", 220]],
  [["ground", 110], ["grav", 520, 1], ["ground", 110], ["invis", 5], ["ground", 110], ["magPit", 400, 580], ["ground", 110], ["grav", 480, 1], ["ground", 110], ["cp"], ["sparks", 4, 1.3], ["ground", 220]],
  [["ground", 100], ["beltKill", 440, 1], ["ground", 100], ["sparks", 5, 1.3], ["ground", 100], ["conv", 440, -1, 2], ["ground", 100], ["cp"], ["timedGate", 1.6, 1], ["ground", 100], ["magNudge", -380], ["ground", 100], ["invis", 3], ["ground", 220]],
  [["ground", 100], ["invis", 6], ["ground", 100], ["grav", 560, 1], ["ground", 100], ["magPit", 420, 600], ["ground", 100], ["cp"], ["invis", 5], ["ground", 100], ["grav", 480, 1], ["ground", 220]],
  [["ground", 100], ["conv", 440, 1, 2], ["ground", 100], ["beltKill", 440, 1], ["ground", 100], ["sparks", 5, 1.2], ["ground", 100], ["cp"], ["timedGate", 1.6, 1], ["ground", 100], ["magNudge", -400], ["ground", 100], ["grav", 520, 1], ["ground", 100], ["invis", 4], ["ground", 220]],
  [["ground", 100], ["grav", 520, 1], ["ground", 90], ["invis", 5], ["ground", 90], ["magPit", 420, 600], ["ground", 90], ["sparks", 5, 1.2], ["ground", 90], ["cp"], ["timedGate", 1.5, 1], ["ground", 90], ["grav", 560, 1], ["ground", 90], ["invis", 6], ["ground", 90], ["magNudge", -420], ["ground", 90], ["cp"], ["conv", 460, -1, 3], ["ground", 90], ["invis", 5], ["ground", 240]],
];

function buildFromBeats(chapter: number, beats: Beat[], girl = false): LevelData {
  const L = base(chapter);
  const c: Ctx = { x: 0, onGround: false, id: 1 };
  pad(L, c, 220);
  for (const b of beats) {
    if (GAP.has(b[0]) && !c.onGround) pad(L, c, 140);
    if (b[0] === "cp" && !c.onGround) pad(L, c, 120);
    applyBeat(L, b, c);
  }
  if (!c.onGround) pad(L, c, 160);
  pad(L, c, 240);
  L.width = c.x + 200;
  L.goal = { x: c.x - 120, y: G - 150, w: 70, h: 150 };
  L.girl = girl;
  scatterWhispers(L);
  return L;
}

export function buildChapter(n: number): LevelData {
  const idx = Math.max(1, Math.min(LEVELS.length - 1, n));
  return buildFromBeats(idx, LEVELS[idx], idx === 25);
}
