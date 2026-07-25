import { AudioManager } from "./audio";
import { buildChapter, CHAPTER_META, type LevelData } from "./chapters";
import type { Rect, Body, Particle, Platform, Lever, Plate } from "./types";

const VW = 960;
const VH = 540;

const GRAV = 1500;
const WALK = 175;
const RUN = 300;
const JUMP_V = 560;
const GRAB_SPEED = 120;
const CONV_ACC = 1100;

type Btn = "left" | "right" | "jump" | "grab" | "run" | null;

function aabb(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface GameState {
  started: boolean;
  deaths: number;
  checkpoint: number;
  checkpointTotal: number;
  won: boolean;
  paused: boolean;
  chapter: number;
  chapterTitle: { roman: string; title: string; subtitle: string };
  transition: { roman: string; title: string; subtitle: string } | null;
  tutorial: { text: string; button: Btn } | null;
  whisper: { text: string; id: number } | null;
  preview: boolean;
  previewChapter: number;
  previewFrac: number;
  previewPlaying: boolean;
  previewSpeed: number;
  autoPlay: boolean;
  autoCaption: string;
  finale: boolean;
}

interface TutStep {
  until: () => boolean;
  button: Btn;
  text: string;
  world?: () => { x: number; y: number } | null;
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private audio = new AudioManager();
  private level: LevelData;
  private raf = 0;
  private last = 0;
  private running = false;

  private p: Body & { onGround: boolean };
  private facing = 1;
  private coyote = 0;
  private grabbed: Body | null = null;
  private grabSide = 0;
  private grabBuffer = 0;
  private runFlag = false;
  private grabHeld = false;
  private deathFx = 0;
  private onRope = false;
  private ropeIndex = -1;
  private drown = 0;
  private walkPhase = 0;
  private stepTimer = 0;
  private footSide = false;
  private wasAir = false;
  private lastFallVY = 0;
  private gravSign = 1;
  private prevGravSign = 1;
  private jumpedFlag = false;
  private trail: { x: number; y: number; f: number; a: number }[] = [];

  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private targetZoom = 1;

  private dead = false;
  private deadTimer = 0;
  private ragdoll: Particle[] = [];
  private particles: Particle[] = [];
  private cpIndex = -1;
  private spawn: { x: number; y: number };

  private keys: Record<string, boolean> = {};
  private prevJump = false;
  private prevGrab = false;
  private prevGrab2 = false;

  // runtime scratch
  private platLast = new Map<Platform, { x: number; y: number }>();
  private platDelta = new Map<Platform, { dx: number; dy: number }>();
  private sparkWas = new Map<number, boolean>();
  private whisperId = 0;

  // preview / demo
  private preview = false;
  private previewPlaying = false;
  private previewSpeed = 1;
  private previewX = 0;
  private previewEmit = 0;
  private profile: { x: number; y: number | null; flipped: boolean }[] = [];
  private callouts: { x: number; y: number; title: string; hint: string }[] = [];
  private snap: {
    started: boolean; chapter: number; deaths: number; cpIndex: number; checkpoint: number;
    px: number; py: number; pvx: number; pvy: number;
  } | null = null;

  // auto-play driver
  private autoPlay = true;
  private autoCaption = "";
  private autoDone = false;
  private autoStuckX = 0;
  private autoStuckT = 0;
  private onRopeTime = 0;

  // tutorial
  private tutStep = 0;
  private transitioning = false;

  state: GameState;
  onState: (s: GameState) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.level = buildChapter(1);
    this.spawn = { ...this.level.spawn };
    this.p = { x: this.spawn.x, y: this.spawn.y, w: 22, h: 42, vx: 0, vy: 0, onGround: false };
    this.state = {
      started: false,
      deaths: 0,
      checkpoint: 0,
      checkpointTotal: this.level.checkpoints.length,
      won: false,
      paused: false,
      chapter: 1,
      chapterTitle: CHAPTER_META[1],
      transition: null,
      tutorial: null,
      whisper: null,
      preview: false,
      previewChapter: 0,
      previewFrac: 0,
      previewPlaying: false,
      previewSpeed: 1,
      autoPlay: true,
      autoCaption: "",
      finale: false,
    };
  }

  private emit() {
    this.onState({ ...this.state });
  }

  start() {
    this.audio.start();
    this.audio.setThemeBed(this.level.theme);
    this.state.started = true;
    this.running = true;
    this.emit();
    this.last = performance.now();
    this.loop();
  }

  togglePause() {
    if (this.transitioning) return;
    this.state.paused = !this.state.paused;
    this.emit();
    if (!this.state.paused) {
      this.last = performance.now();
      this.loop();
    }
  }

  toggleAudio() {
    return this.audio.toggle();
  }

  setKey(name: string, down: boolean) {
    this.keys[name] = down;
  }

  attach() {
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    const unlock = () => this.audio.start();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
    window.addEventListener("mousedown", unlock, { passive: true });
  }
  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    this.keys[k] = true;
    if (k === "p") this.togglePause();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;
  };

  restart() {
    const start = 1;
    this.state.chapter = start;
    this.state.deaths = 0;
    this.loadChapter(start);
    this.state.won = false;
    this.transitioning = false;
    this.state.transition = null;
    this.state.chapterTitle = CHAPTER_META[start];
    this.emit();
  }

  nextChapter() {
    if (!this.transitioning) return;
    const next = this.state.chapter + 1;
    this.loadChapter(next);
    this.transitioning = false;
    this.state.transition = null;
    this.state.chapter = next;
    this.state.chapterTitle = CHAPTER_META[next];
    this.state.whisper = null;
    this.audio.setThemeBed(this.level.theme);
    this.emit();
  }

  private loadChapter(n: number) {
    this.level = buildChapter(n);
    this.spawn = { ...this.level.spawn };
    this.cpIndex = -1;
    this.state.checkpoint = 0;
    this.state.checkpointTotal = this.level.checkpoints.length;
    this.platLast.clear();
    this.platDelta.clear();
    this.sparkWas.clear();
    this.whisperId = 0;
    this.tutStep = 0;
    this.jumpedFlag = false;
    this.particles = [];
    this.trail = [];
    this.respawn();
    this.state.finale = !!this.level.girl;
  }

  private respawn() {
    this.p.x = this.spawn.x;
    this.p.y = this.spawn.y;
    this.p.vx = 0;
    this.p.vy = 0;
    this.p.onGround = false;
    this.dead = false;
    this.deadTimer = 0;
    this.grabbed = null;
    this.onRope = false;
    this.drown = 0;
    this.ragdoll = [];
    this.gravSign = 1;
    this.prevGravSign = 1;
    this.autoStuckX = this.p.x;
    this.autoStuckT = 0;
    this.autoDone = false;
    this.onRopeTime = 0;
    for (const bt of this.level.bearTraps) { bt.hidden = true; bt.sprung = false; bt.timer = 0; }
    for (const fl of this.level.fallingLogs) { fl.fallen = false; fl.y = fl.restY; fl.vy = 0; fl.angle = 0; }
    for (const bo of this.level.boulders) { bo.released = false; bo.x = bo.startX; bo.y = bo.startY; bo.vx = 0; bo.vy = 0; }
    for (const sp of this.level.spiders) { sp.triggered = false; sp.y = sp.restY; sp.vy = 0; }
  }

  private die(kind: string) {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 0.7;
    this.deathFx = 1;
    this.state.deaths++;
    this.autoStuckT = 0;
    this.autoStuckX = this.p.x;
    this.emit();
    this.audio.death();
    this.ragdoll = [];
    for (let i = 0; i < 16; i++) {
      this.ragdoll.push({
        x: this.p.x + this.p.w / 2,
        y: this.p.y + this.p.h / 2,
        vx: (Math.random() - 0.5) * 340,
        vy: -Math.random() * 360 - 40,
        life: 1.2,
        size: 3 + Math.random() * 5,
      });
    }
    if (kind === "water") this.audio.splash();
  }

  private loop = () => {
    if (!this.running || this.state.paused) return;
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (this.preview && this.autoPlay) dt = Math.min(0.05, dt * this.previewSpeed);
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  // ---------- collision helpers ----------
  private playerSolids(): Rect[] {
    const s: Rect[] = [
      ...this.level.solids,
      ...this.level.invisibles,
      ...this.level.crates,
      ...this.level.cages,
      ...this.level.floats,
    ];
    for (const d of this.level.doors) if (!d.open) s.push(d);
    for (const pl of this.level.platforms) s.push(pl);
    return s;
  }

  private moveX(body: Body, dx: number, solids: Rect[]) {
    body.x += dx;
    for (const s of solids) {
      if (aabb(body, s)) {
        // step up small ledges / platform edges while grounded
        if (body.onGround && dx !== 0 && body.y + body.h - s.y > 0 && body.y + body.h - s.y <= 20) {
          body.y = s.y - body.h;
          continue;
        }
        if (dx > 0) body.x = s.x - body.w;
        else if (dx < 0) body.x = s.x + s.w;
        body.vx = 0;
      }
    }
  }
  private moveY(body: Body, dy: number, solids: Rect[], sign = 1) {
    body.y += dy;
    body.onGround = false;
    for (const s of solids) {
      if (aabb(body, s)) {
        if (dy > 0) {
          body.y = s.y - body.h;
          if (sign > 0) body.onGround = true;
        } else if (dy < 0) {
          body.y = s.y + s.h;
          if (sign < 0) body.onGround = true;
        }
        body.vy = 0;
      }
    }
  }

  private inWater(r: Rect): { depth: number } | null {
    for (const w of this.level.water) {
      if (aabb(r, w)) {
        const depth = Math.min(r.h, r.y + r.h - w.y);
        return { depth: Math.max(0, depth) };
      }
    }
    return null;
  }

  private feetRect(): Rect {
    const y = this.gravSign > 0 ? this.p.y + this.p.h - 10 : this.p.y;
    return { x: this.p.x + 2, y, w: this.p.w - 4, h: 12 };
  }

  // ---------- main update ----------
  private update(dt: number) {
    if (this.deathFx > 0) this.deathFx = Math.max(0, this.deathFx - dt * 3);
    if (this.preview && !this.autoPlay) {
      this.updatePreview(dt);
      return;
    }
    if (this.preview && this.autoPlay) {
      this.autoPilotTick(dt);
      this.state.autoCaption = this.autoCaption;
      this.state.previewFrac = this.p.x / Math.max(1, this.level.width);
      this.previewEmit += dt;
      if (this.previewEmit > 0.1) {
        this.previewEmit = 0;
        this.emit();
      }
    }
    if (this.transitioning) {
      this.updateParticles(dt);
      return;
    }
    if (this.state.won) {
      this.updateParticles(dt);
      this.updateCamera(dt);
      return;
    }
    if (this.dead) {
      this.deadTimer -= dt;
      for (const r of this.ragdoll) {
        r.vy += GRAV * dt * 0.7;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.life -= dt;
      }
      if (this.deadTimer <= 0) this.respawn();
      this.updateCamera(dt);
      return;
    }

    this.updatePlatforms(dt);
    this.updateBodies(dt);
    this.applyRiding();
    this.updatePlayer(dt);
    this.updateSaws(dt);
    this.updateBoulders(dt);
    this.updateRopes(dt);
    this.updateBearTraps(dt);
    this.updateFallingLogs(dt);
    this.updateSpiders(dt);
    this.updateSparks();
    this.updateMechanisms(dt);
    this.updateParticles(dt);
    this.spawnThemeParticles(dt);
    this.checkHazards();
    this.checkProgress();
    if (this.level.chapter === 0) this.updateTutorial();
    else this.state.tutorial = null;
    this.updateCamera(dt);
    this.updateAudioAmbience();
  }

  // ---------- platforms ----------
  private updatePlatforms(dt: number) {
    const active = (pl: Platform) => {
      if (pl.link == null) return true;
      for (const lv of this.level.levers) if (lv.id === pl.link && lv.on) return true;
      for (const pt of this.level.plates) if (pt.id === pl.link && pt.pressed) return true;
      return false;
    };
    for (const pl of this.level.platforms) {
      const last = this.platLast.get(pl) ?? { x: pl.x, y: pl.y };
      let nx = pl.x;
      let ny = pl.y;
      if (pl.axis !== "none" && active(pl)) {
        pl.phase += pl.speed * dt;
        if (pl.axis === "x") nx = pl.px + Math.sin(pl.phase) * pl.range;
        else ny = pl.py - (Math.sin(pl.phase) * 0.5 + 0.5) * pl.range; // one-way lift
      }
      this.platDelta.set(pl, { dx: nx - last.x, dy: ny - last.y });
      pl.x = nx;
      pl.y = ny;
      this.platLast.set(pl, { x: nx, y: ny });
    }
  }

  private applyRiding() {
    if (this.gravSign < 0) return;
    const sensor = { x: this.p.x + 1, y: this.p.y + this.p.h - 3, w: this.p.w - 2, h: 6 };
    for (const pl of this.level.platforms) {
      if (aabb(sensor, pl) && Math.abs(this.p.y + this.p.h - pl.y) < 6) {
        const d = this.platDelta.get(pl);
        if (d) {
          this.p.x += d.dx;
          this.p.y += d.dy;
          if (this.grabbed) this.grabbed.x += d.dx; // keep held object glued on moving platforms
        }
        return;
      }
    }
  }

  // ---------- bodies (crates, cages, floats) ----------
  private updateBodies(dt: number) {
    const solids: Rect[] = [...this.level.solids, ...this.level.invisibles];
    for (const d of this.level.doors) if (!d.open) solids.push(d);
    for (const pl of this.level.platforms) solids.push(pl);
    const all = [...this.level.crates, ...this.level.cages, ...this.level.floats];

    for (const b of all) {
      const others = all.filter((o) => o !== b);
      const obstacles = [...solids, ...others];
      const water = this.inWater(b);
      if (b.buoyant && water) {
        const sub = water.depth / b.h;
        b.vy -= sub * 900 * dt;
        b.vy *= 0.9;
        b.vx *= 0.9;
        b.vy += GRAV * 0.4 * dt;
      } else {
        b.vy += GRAV * dt;
      }
      // conveyor push
      if (b.onGround) {
        for (const c of this.level.conveyors) {
          if (!c.on) continue;
          const foot = { x: b.x + 2, y: b.y + b.h - 4, w: b.w - 4, h: 8 };
          if (aabb(foot, c)) b.vx += c.dir * 600 * dt;
        }
      }
      b.vx *= 0.82;
      if (Math.abs(b.vx) < 2) b.vx = 0;
      this.moveX(b, b.vx * dt, obstacles);
      this.moveY(b, b.vy * dt, obstacles);
    }
  }

  // ---------- player ----------
  private updatePlayer(dt: number) {
    const p = this.p;
    const left = this.keys["arrowleft"] || this.keys["a"];
    const right = this.keys["arrowright"] || this.keys["d"];
    const up = this.keys["arrowup"] || this.keys["w"];
    const running = this.keys["shift"];
    const jump = this.keys[" "] || up;
    const grabKey = this.keys["e"] || this.keys["k"];
    const grabEdge = grabKey && !this.prevGrab;
    if (grabEdge) this.grabBuffer = 0.16;
    this.grabBuffer = Math.max(0, this.grabBuffer - dt);
    this.runFlag = running;
    this.grabHeld = grabKey;

    // gravity zone
    const pcx = p.x + p.w / 2;
    const pcy = p.y + p.h / 2;
    let gs = 1;
    for (const z of this.level.gravZones) {
      if (pcx > z.x && pcx < z.x + z.w && pcy > z.y && pcy < z.y + z.h) {
        gs = z.dir;
        break;
      }
    }
    this.prevGravSign = this.gravSign;
    this.gravSign = gs;
    if (this.gravSign !== this.prevGravSign) this.audio.gravFlip();

    const water = this.inWater({ ...p });

    // rope
    if (this.onRope) {
      const rope = this.level.ropes[this.ropeIndex];
      if (left) rope.angVel -= 2.2 * dt;
      if (right) rope.angVel += 2.2 * dt;
      rope.angVel += (-9.8 / rope.len) * Math.sin(rope.angle) * dt * 6;
      rope.angVel *= 0.995;
      rope.angle += rope.angVel * dt;
      const ex = rope.px + Math.sin(rope.angle) * rope.len;
      const ey = rope.py + Math.cos(rope.angle) * rope.len;
      p.x = ex - p.w / 2;
      p.y = ey - 6;
      p.vx = Math.cos(rope.angle) * rope.angVel * rope.len;
      p.vy = -Math.sin(rope.angle) * rope.angVel * rope.len;
      const jumpPressed = jump && !this.prevJump;
      if (jumpPressed || !grabKey) {
        this.onRope = false;
        p.vy -= 260;
        this.audio.jump();
      }
      this.prevJump = jump;
      this.prevGrab = grabKey;
      return;
    }

    if (grabKey && !this.prevGrab) {
      for (let i = 0; i < this.level.ropes.length; i++) {
        const rope = this.level.ropes[i];
        const ex = rope.px + Math.sin(rope.angle) * rope.len;
        const ey = rope.py + Math.cos(rope.angle) * rope.len;
        const dEnd = Math.hypot(pcx - ex, pcy - ey);
        const dSeg = this.distToSeg(pcx, pcy, rope.px, rope.py, ex, ey);
        if (dEnd < 95 || dSeg < 60) {
          this.onRope = true;
          this.ropeIndex = i;
          rope.angVel += (this.facing >= 0 ? 1 : -1) * 1.8; // swing assist
          this.prevJump = jump;
          this.prevGrab = grabKey;
          return;
        }
      }
    }

    // horizontal
    let speed = running ? RUN : WALK;
    if (this.grabbed) speed = GRAB_SPEED;
    if (water) speed *= 0.6;
    let target = 0;
    if (left) {
      target = -speed;
      this.facing = -1;
    }
    if (right) {
      target = speed;
      this.facing = 1;
    }
    const accel = p.onGround ? 2400 : 1200;
    if (target !== 0) {
      p.vx += Math.sign(target - p.vx) * accel * dt;
      if ((target > 0 && p.vx > target) || (target < 0 && p.vx < target)) p.vx = target;
    } else {
      const fr = p.onGround ? 2600 : 600;
      if (p.vx > 0) p.vx = Math.max(0, p.vx - fr * dt);
      else p.vx = Math.min(0, p.vx + fr * dt);
    }

    // conveyor push on player
    let onConv = 0;
    if (p.onGround && this.gravSign > 0) {
      for (const c of this.level.conveyors) {
        if (!c.on) continue;
        const foot = { x: p.x + 2, y: p.y + p.h - 4, w: p.w - 4, h: 8 };
        if (aabb(foot, c)) onConv = c.dir;
      }
    }
    if (onConv !== 0) p.vx += onConv * CONV_ACC * dt;

    // magnet pull
    let magInt = 0;
    for (const m of this.level.magnets) {
      const d = Math.hypot(pcx - m.x, pcy - m.y);
      if (d < m.r && d > 1) {
        const f = m.strength * (1 - d / m.r);
        const ux = (m.x - pcx) / d;
        const uy = (m.y - pcy) / d;
        p.vx += ux * f * dt;
        p.vy += uy * f * dt;
        magInt = Math.max(magInt, 1 - d / m.r);
      }
    }
    this.audio.setMagnet(magInt);

    // gravity / jump
    if (water) {
      p.vy += GRAV * 0.35 * dt;
      p.vy *= 0.92;
      if (jump) p.vy -= 520 * dt * 8;
      if (p.vy > 180) p.vy = 180;
    } else {
      p.vy += GRAV * this.gravSign * dt;
    }

    if (p.onGround) this.coyote = 0.1;
    else this.coyote -= dt;

    const jumpPressed = jump && !this.prevJump;
    if (jumpPressed && (this.coyote > 0 || water)) {
      p.vy = -JUMP_V * this.gravSign * (water ? 0.7 : 1);
      p.onGround = false;
      this.coyote = 0;
      this.jumpedFlag = true;
      this.audio.jump();
      this.spawnDust(p.x + p.w / 2, this.gravSign > 0 ? p.y + p.h : p.y);
    }

    // grab crates / cages (forgiving: buffer + air tolerance + wider reach)
    const wantGrab = grabKey || this.grabBuffer > 0;
    if (wantGrab) {
      const canGrab = p.onGround || this.coyote > 0 || Math.abs(p.vy) < 150;
      if (!this.grabbed && canGrab) {
        const pool = [...this.level.crates, ...this.level.cages];
        for (const c of pool) {
          const vOverlap = p.y + p.h > c.y + 14 && p.y < c.y + c.h + 6;
          if (!vOverlap) continue;
          if (Math.abs(p.x + p.w - c.x) < 18) {
            this.grabbed = c;
            this.grabSide = 1;
            break;
          }
          if (Math.abs(p.x - (c.x + c.w)) < 18) {
            this.grabbed = c;
            this.grabSide = -1;
            break;
          }
        }
      }
    } else {
      this.grabbed = null;
    }

    const solids = this.playerSolids();
    const pSolids = solids.filter((s) => s !== (this.grabbed as unknown as Rect));

    const oldX = p.x;
    this.moveX(p, p.vx * dt, pSolids);
    const dx = p.x - oldX;

    if (this.grabbed) {
      const c = this.grabbed;
      const crateObs = [
        ...this.level.solids,
        ...this.level.invisibles,
        ...this.level.doors.filter((d) => !d.open),
        ...this.level.crates.filter((o) => o !== c),
        ...this.level.cages.filter((o) => o !== c),
        ...this.level.floats,
        ...this.level.platforms,
      ];
      const before = c.x;
      c.x += dx;
      for (const s of crateObs) {
        if (aabb(c, s)) {
          if (dx > 0) c.x = s.x - c.w;
          else if (dx < 0) c.x = s.x + s.w;
        }
      }
      const actual = c.x - before;
      if (Math.abs(actual - dx) > 0.5) p.x += actual - dx;
      if (this.grabSide === 1 && Math.abs(p.x + p.w - c.x) > 26) this.grabbed = null;
      if (this.grabSide === -1 && Math.abs(p.x - (c.x + c.w)) > 26) this.grabbed = null;
    }

    this.moveY(p, p.vy * dt, pSolids, this.gravSign);

    if (p.onGround && this.wasAir) {
      this.audio.land(Math.min(3, Math.abs(this.lastFallVY) / 300));
      if (Math.abs(this.lastFallVY) > 200)
        this.spawnDust(p.x + p.w / 2, this.gravSign > 0 ? p.y + p.h : p.y);
    }
    this.wasAir = !p.onGround;
    this.lastFallVY = p.vy;

    if (p.onGround && Math.abs(p.vx) > 22) {
      this.walkPhase += Math.abs(p.vx) * dt * 0.11;
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.audio.footstep();
        this.stepTimer = running ? 0.2 : 0.3;
        this.footSide = !this.footSide;
        this.spawnFootDust(p.x + p.w / 2 + (this.footSide ? 3 : -3) * this.facing, p.y + p.h, running);
      }
      // afterimage trail when running
      if (running && Math.random() < 0.6) {
        this.trail.push({ x: p.x, y: p.y, f: this.facing, a: 0.35 });
        if (this.trail.length > 5) this.trail.shift();
      }
    }
    for (const t of this.trail) t.a -= dt * 1.4;
    this.trail = this.trail.filter((t) => t.a > 0);

    // drowning
    const head =
      this.gravSign > 0
        ? { x: p.x + 4, y: p.y, w: p.w - 8, h: 8 }
        : { x: p.x + 4, y: p.y + p.h - 8, w: p.w - 8, h: 8 };
    if (this.inWater(head)) {
      this.drown += dt;
      if (Math.random() < 0.05) this.spawnBubble(p.x + p.w / 2, p.y);
      if (this.drown > 4.5) this.die("water");
    } else this.drown = Math.max(0, this.drown - dt * 2);

    if (p.y > this.level.groundY + 700 || p.y < -400) this.die("fall");

    this.prevJump = jump;
    this.prevGrab = grabKey;
  }

  private updateSaws(dt: number) {
    for (const s of this.level.saws) {
      s.phase += s.speed * dt;
      s.angle += dt * 14;
    }
  }
  private sawPos(s: { cx: number; cy: number; axis: "x" | "y"; range: number; phase: number }) {
    const off = Math.sin(s.phase) * s.range;
    return s.axis === "x" ? { x: s.cx + off, y: s.cy } : { x: s.cx, y: s.cy + off };
  }

  private distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private updateBoulders(dt: number) {
    for (const b of this.level.boulders) {
      if (!b.released) {
        if (this.p.x + this.p.w > b.triggerX) {
          b.released = true;
          this.audio.clank();
        }
        continue;
      }
      b.vy += GRAV * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += (b.vx / b.r) * dt;
      for (const s of this.level.solids) {
        if (b.x + b.r > s.x && b.x - b.r < s.x + s.w && b.y + b.r > s.y && b.y - b.r < s.y + s.h) {
          if (b.vy > 0 && b.y < s.y + 20) {
            b.y = s.y - b.r;
            b.vy = 0;
            b.vx = Math.min(b.vx + 200 * dt, 260);
          }
        }
      }
      if (b.y > this.level.groundY + 400) {
        b.released = false;
        b.x = b.startX;
        b.y = b.startY;
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  private updateRopes(dt: number) {
    for (let i = 0; i < this.level.ropes.length; i++) {
      const rope = this.level.ropes[i];
      if (this.onRope && this.ropeIndex === i) continue;
      rope.angVel += (-9.8 / rope.len) * Math.sin(rope.angle) * dt * 6;
      rope.angVel *= 0.99;
      rope.angle += rope.angVel * dt;
    }
  }

  private updateBearTraps(dt: number) {
    const foot = this.feetRect();
    for (const t of this.level.bearTraps) {
      if (t.hidden && aabb(foot, { x: t.x, y: t.y - 6, w: t.w, h: 16 })) {
        t.hidden = false;
        t.sprung = true;
        this.audio.snap();
        this.die("trap");
      }
      if (t.sprung) t.timer += dt;
    }
  }

  private updateFallingLogs(dt: number) {
    for (const l of this.level.fallingLogs) {
      if (!l.fallen) {
        if (this.p.x + this.p.w > l.triggerX) {
          l.fallen = true;
          this.audio.creak();
        }
        continue;
      }
      l.vy += GRAV * dt;
      l.y += l.vy * dt;
      l.angle += 0.6 * dt;
    }
  }

  private updateSpiders(dt: number) {
    for (const s of this.level.spiders) {
      s.phase += dt;
      if (!s.triggered && Math.abs(this.p.x + this.p.w / 2 - s.x) < 90 && this.p.y > s.ceilingY) {
        s.triggered = true;
        this.audio.spider();
      }
      if (s.triggered && s.y < s.restY + 360) s.y += 230 * dt;
    }
  }

  private updateSparks() {
    const t = performance.now() / 1000;
    for (let i = 0; i < this.level.sparks.length; i++) {
      const s = this.level.sparks[i];
      const active = (t + s.phase) % s.period < s.period * 0.5;
      const was = this.sparkWas.get(i) ?? false;
      if (active && !was) this.audio.spark();
      this.sparkWas.set(i, active);
    }
  }

  private updateMechanisms(dt: number) {
    for (const plate of this.level.plates) {
      let pressed = false;
      const sensor = { x: plate.x, y: plate.y - 6, w: plate.w, h: plate.h + 8 };
      if (aabb(this.p, sensor)) pressed = true;
      for (const c of this.level.crates) if (aabb(c, sensor)) pressed = true;
      for (const c of this.level.cages) if (aabb(c, sensor)) pressed = true;
      if (pressed !== plate.pressed) {
        plate.pressed = pressed;
        this.audio.clank();
      }
    }
    const grabKey = this.keys["e"] || this.keys["k"];
    for (const lv of this.level.levers) {
      if (
        grabKey &&
        !this.prevGrab2 &&
        Math.abs(this.p.x + this.p.w / 2 - lv.x) < 44 &&
        Math.abs(this.p.y + this.p.h - lv.y) < 70
      ) {
        lv.on = !lv.on;
        if (lv.on && lv.timed) lv.timer = lv.timed;
        this.audio.lever();
      }
      if (lv.on && lv.timed && lv.timer != null) {
        lv.timer -= dt;
        if (lv.timer <= 0) {
          lv.on = false;
          lv.timer = undefined;
          this.audio.lever();
        }
      }
    }
    this.prevGrab2 = grabKey;

    for (const c of this.level.conveyors) {
      if (c.link != null) {
        let on = true;
        for (const lv of this.level.levers) if (lv.id === c.link) on = !lv.on; // lever ON kills belt
        c.on = on;
      }
      c.phase += dt * (c.on ? 4 : 0);
    }

    for (const d of this.level.doors) {
      let active = false;
      for (const plate of this.level.plates) if (plate.id === d.link && plate.pressed) active = true;
      for (const lv of this.level.levers) if (lv.id === d.link && lv.on) active = true;
      const targetY = active ? d.yOpen : d.yClosed;
      d.y += (targetY - d.y) * Math.min(1, dt * 4);
      d.open = Math.abs(d.y - d.yOpen) < 6;
    }
  }

  private checkHazards() {
    if (this.dead) return;
    const p = this.p;
    const foot = this.feetRect();
    for (const sp of this.level.spikes) if (aabb(foot, sp)) return this.die("spike");
    for (const s of this.level.saws) {
      const pos = this.sawPos(s);
      if (Math.hypot(p.x + p.w / 2 - pos.x, p.y + p.h / 2 - pos.y) < s.r + 10) return this.die("saw");
    }
    for (const b of this.level.boulders) {
      if (!b.released) continue;
      if (Math.hypot(p.x + p.w / 2 - b.x, p.y + p.h / 2 - b.y) < b.r + 8) return this.die("boulder");
    }
    for (const l of this.level.fallingLogs) {
      if (!l.fallen) continue;
      if (aabb(p, l) && l.vy > 60) return this.die("log");
    }
    for (const s of this.level.spiders) {
      if (!s.triggered) continue;
      if (aabb(p, { x: s.x - 14, y: s.y - 10, w: 28, h: 22 })) return this.die("spider");
    }
    const t = performance.now() / 1000;
    for (const s of this.level.sparks) {
      const active = (t + s.phase) % s.period < s.period * 0.5;
      if (active && aabb(p, s)) return this.die("spark");
    }
  }

  private checkProgress() {
    const p = this.p;
    for (let i = 0; i < this.level.checkpoints.length; i++) {
      const c = this.level.checkpoints[i];
      if (i > this.cpIndex && p.x + p.w / 2 > c.x) {
        this.cpIndex = i;
        this.spawn = { x: c.x, y: c.y };
        this.state.checkpoint = i + 1;
        this.audio.checkpoint();
        this.spawnGlow(c.x, c.y);
        this.emit();
      }
    }
    // whispers
    for (const w of this.level.whispers) {
      if (!w.fired && p.x + p.w / 2 > w.x) {
        w.fired = true;
        this.whisperId++;
        this.state.whisper = { text: w.text, id: this.whisperId };
        this.emit();
      }
    }
    if (aabb(p, this.level.goal) && !this.transitioning && !this.state.won) {
      if (this.preview) {
        this.autoDone = true;
        this.autoCaption = "chapter complete — tap next ►";
      } else if (this.level.chapter < CHAPTER_META.length - 1) {
        this.transitioning = true;
        this.state.transition = CHAPTER_META[this.level.chapter + 1];
        this.audio.chapterGong();
      } else {
        this.state.won = true;
        this.audio.win();
      }
      this.emit();
    }
  }

  // ---------- tutorial state machine ----------
  private tutorialSteps: TutStep[] = [];
  private buildTutorialSteps() {
    const L = this.level;
    this.tutorialSteps = [
      { until: () => this.p.x > 220, button: "right", text: "Hold  ►  to walk into the dark" },
      {
        until: () => this.jumpedFlag,
        button: "jump",
        text: "Tap  JUMP  to cross the thorns",
        world: () => ({ x: 520, y: L.groundY - 90 }),
      },
      {
        until: () => this.grabbed != null,
        button: "grab",
        text: "Stand beside the crate. Hold  GRAB",
        world: () => (L.crates[0] ? { x: L.crates[0].x + 28, y: L.crates[0].y - 30 } : null),
      },
      {
        until: () => !!L.plates[0]?.pressed,
        button: null,
        text: "Drag the crate onto the plate",
        world: () => ({ x: L.plates[0].x + 40, y: L.plates[0].y - 30 }),
      },
      { until: () => this.p.x > 1380, button: "right", text: "The gate remembers — walk through" },
      {
        until: () => this.onRope,
        button: "grab",
        text: "Near the rope, hold  GRAB  to swing",
        world: () => {
          const r = L.ropes[0];
          if (!r) return null;
          return { x: r.px + Math.sin(r.angle) * r.len, y: r.py + Math.cos(r.angle) * r.len - 30 };
        },
      },
      {
        until: () => !this.onRope && this.p.x > 1820,
        button: "jump",
        text: "At the peak — tap  JUMP  to leap off",
      },
      { until: () => this.p.x > 2300, button: "right", text: "Reach the light" },
    ];
  }

  private updateTutorial() {
    if (this.tutorialSteps.length === 0) this.buildTutorialSteps();
    if (this.tutStep >= this.tutorialSteps.length) {
      this.state.tutorial = null;
      return;
    }
    const step = this.tutorialSteps[this.tutStep];
    if (step.until()) this.tutStep++;
    const cur = this.tutorialSteps[this.tutStep];
    this.state.tutorial = cur ? { text: cur.text, button: cur.button } : null;
  }

  private tutorialWorldMarker(): { x: number; y: number } | null {
    if (this.level.chapter !== 0) return null;
    if (this.tutStep >= this.tutorialSteps.length) return null;
    const step = this.tutorialSteps[this.tutStep];
    return step.world ? step.world() : null;
  }

  // ---------- camera ----------
  private updateCamera(dt: number) {
    const p = this.p;
    const tx = p.x + p.w / 2;
    const ty = p.y + p.h / 2 - 40;
    let tz = 1;
    const x = p.x;
    if (this.level.theme === "forest" && x > 1500 && x < 2050) tz = 0.86;
    if (this.level.theme === "ruins" && x > 600 && x < 1150) tz = 0.88;
    if (this.level.theme === "void") tz = 0.92;
    this.targetZoom = tz;
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 2.5);
    const viewW = VW / this.zoom;
    let cx = Math.max(viewW / 2, Math.min(this.level.width - viewW / 2, tx));
    let cy = Math.min(this.level.groundY + 80, ty);
    this.camX += (cx - this.camX) * Math.min(1, dt * 4);
    this.camY += (cy - this.camY) * Math.min(1, dt * 4);
  }

  // ---------- particles ----------
  private updateParticles(dt: number) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.kind !== "leaf" && pt.kind !== "mote") pt.vy += 120 * dt;
      else pt.vy += 12 * dt;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
  private spawnThemeParticles(dt: number) {
    const rate =
      this.level.theme === "forest" ? 0.6 : this.level.theme === "factory" ? 0.5 : this.level.theme === "void" ? 0.7 : 0.25;
    if (Math.random() < rate * dt * 60 * 0.05) {
      const x = this.camX + (Math.random() - 0.5) * VW;
      const y = this.camY - VH / 2 + Math.random() * VH;
      const kind =
        this.level.theme === "forest"
          ? "leaf"
          : this.level.theme === "factory"
          ? "spark"
          : this.level.theme === "void"
          ? "mote"
          : this.level.theme === "ruins"
          ? "ash"
          : "dust";
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 30 + (kind === "leaf" ? 18 : 0),
        vy: kind === "mote" ? -10 - Math.random() * 14 : 12 + Math.random() * 20,
        life: 3 + Math.random() * 3,
        size: 1 + Math.random() * 2,
        kind,
      });
    }
  }
  private spawnDust(x: number, y: number) {
    for (let i = 0; i < 6; i++)
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 90,
        vy: -Math.random() * 60,
        life: 0.4 + Math.random() * 0.3,
        size: 2 + Math.random() * 3,
        kind: "dust",
      });
  }
  private spawnFootDust(x: number, y: number, hard: boolean) {
    const n = hard ? 4 : 2;
    for (let i = 0; i < n; i++)
      this.particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y,
        vx: (Math.random() - 0.5) * 50 - this.p.vx * 0.05,
        vy: -Math.random() * 30 - 6,
        life: 0.25 + Math.random() * 0.2,
        size: 1.5 + Math.random() * 2,
        kind: "dust",
      });
  }
  private spawnBubble(x: number, y: number) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: -40 - Math.random() * 30,
      life: 0.9,
      size: 2 + Math.random() * 2,
      kind: "bubble",
    });
  }
  private spawnGlow(x: number, y: number) {
    for (let i = 0; i < 12; i++)
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 120,
        life: 0.8,
        size: 2 + Math.random() * 2,
        kind: "glow",
      });
  }

  private updateAudioAmbience() {
    const openness = this.p.y < this.level.groundY - 120 ? 1 : 0.4;
    this.audio.setWind(openness);
    let nearest = 9999;
    for (const s of this.level.saws) {
      const pos = this.sawPos(s);
      nearest = Math.min(nearest, Math.hypot(this.p.x - pos.x, this.p.y - pos.y));
    }
    this.audio.setSaw(Math.max(0, 1 - nearest / 350));
    let convNear = 9999;
    for (const c of this.level.conveyors) {
      if (!c.on) continue;
      const d = Math.abs(this.p.x - (c.x + c.w / 2));
      if (d < c.w) convNear = Math.min(convNear, d);
    }
    this.audio.setConveyor(convNear < 200 ? 1 - convNear / 200 : 0);
  }

  // ================= RENDER =================
  private render() {
    const ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(cw * dpr) || this.canvas.height !== Math.floor(ch * dpr)) {
      this.canvas.width = Math.floor(cw * dpr);
      this.canvas.height = Math.floor(ch * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scale = Math.min(this.canvas.width / VW, this.canvas.height / VH);
    const ox = (this.canvas.width - VW * scale) / 2;
    const oy = (this.canvas.height - VH * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.clearRect(-9999, -9999, 99999, 99999);

    this.drawSky(ctx);
    this.drawParallax(ctx);
    this.drawSceneProps(ctx);

    ctx.save();
    ctx.translate(VW / 2, VH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);
    if (this.deathFx > 0) {
      const s = this.deathFx * 4;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this.drawWater(ctx);
    this.drawWorld(ctx);
    this.drawConveyors(ctx);
    this.drawMechanisms(ctx);
    this.drawMagnets(ctx);
    this.drawHazards(ctx);
    this.drawSpiders(ctx);
    this.drawGoal(ctx);
    if (this.level.girl) this.drawGirl(ctx, this.level.goal.x - 90, this.level.groundY);
    if (this.preview) {
      this.drawPreviewGhost(ctx);
      this.drawCallouts(ctx);
    } else {
      this.drawPlayer(ctx);
      this.drawTutorialMarker(ctx);
    }
    this.drawParticles(ctx);

    ctx.restore();

    this.drawFog(ctx);
    this.drawVignette(ctx);
    if (this.deathFx > 0) {
      const a = this.deathFx;
      const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.22, VW / 2, VH / 2, VH * 0.72);
      g.addColorStop(0, "rgba(120,8,8,0)");
      g.addColorStop(0.6, "rgba(120,8,8,0)");
      g.addColorStop(1, `rgba(150,12,12,${0.5 * a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, VH);
      if (a > 0.55) {
        ctx.fillStyle = `rgba(255,238,232,${(a - 0.55) * 0.55})`;
        ctx.fillRect(0, 0, VW, VH);
      }
    }
  }

  private drawSky(ctx: CanvasRenderingContext2D) {
    const theme = this.level.theme;
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    if (theme === "forest") {
      g.addColorStop(0, "#6f756a");
      g.addColorStop(0.5, "#3c4038");
      g.addColorStop(1, "#0c0d0a");
    } else if (theme === "ruins") {
      g.addColorStop(0, "#7a756c");
      g.addColorStop(0.5, "#3a362f");
      g.addColorStop(1, "#0b0a08");
    } else if (theme === "factory") {
      g.addColorStop(0, "#8a7a66");
      g.addColorStop(0.45, "#3e342a");
      g.addColorStop(1, "#0a0806");
    } else if (theme === "void") {
      g.addColorStop(0, "#1a1a22");
      g.addColorStop(0.5, "#2a2a34");
      g.addColorStop(1, "#060608");
    } else {
      g.addColorStop(0, "#8a8f96");
      g.addColorStop(0.4, "#5f656c");
      g.addColorStop(0.75, "#2c2f33");
      g.addColorStop(1, "#141517");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // volumetric light shafts
    ctx.save();
    ctx.globalAlpha = theme === "void" ? 0.05 : 0.12;
    for (let i = 0; i < 5; i++) {
      const rx = ((i * 220 - (this.camX * 0.1) % 220) + 220) % (VW + 200) - 100;
      const grd = ctx.createLinearGradient(rx, 0, rx + 120, VH);
      grd.addColorStop(0, "rgba(255,255,255,0.9)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx + 70, 0);
      ctx.lineTo(rx + 210, VH);
      ctx.lineTo(rx + 120, VH);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawParallax(ctx: CanvasRenderingContext2D) {
    const theme = this.level.theme;
    const cam = this.camX;
    const tnow = performance.now() * 0.001;
    if (theme === "void") {
      for (let b = 0; b < 3; b++) {
        ctx.fillStyle = `rgba(40,40,54,${0.18 - b * 0.04})`;
        ctx.fillRect(0, VH * (0.3 + b * 0.22), VW, 40);
      }
      ctx.fillStyle = "#15151b";
      for (let i = 0; i < 26; i++) {
        const bx = ((i * 311 - cam * 0.2) % 1400 + 1400) % 1400 - 200;
        const by = ((i * 173) % VH + Math.sin(tnow * 0.3 + i) * 14) % VH;
        const s = 10 + (i % 4) * 8;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(i * 0.7 + tnow * 0.05);
        ctx.fillRect(-s / 2, -s / 2, s, s * 0.4);
        ctx.restore();
      }
      return;
    }
    const layers =
      theme === "factory"
        ? [
            { f: 0.18, base: VH * 0.55, col: "#3a3027", step: 260 },
            { f: 0.35, base: VH * 0.7, col: "#241d16", step: 180 },
            { f: 0.55, base: VH * 0.82, col: "#120e0a", step: 120 },
          ]
        : theme === "ruins"
        ? [
            { f: 0.18, base: VH * 0.55, col: "#3a362f", step: 280 },
            { f: 0.35, base: VH * 0.7, col: "#241f1a", step: 200 },
            { f: 0.55, base: VH * 0.82, col: "#100d0a", step: 140 },
          ]
        : [
            { f: 0.15, base: VH * 0.55, col: "#33382e", step: 300 },
            { f: 0.3, base: VH * 0.68, col: "#21261d", step: 220 },
            { f: 0.5, base: VH * 0.8, col: "#10130d", step: 160 },
          ];
    for (const L of layers) {
      ctx.fillStyle = L.col;
      const offset = -this.camX * L.f;
      ctx.beginPath();
      ctx.moveTo(-100, VH);
      for (let x = -100; x < VW + 100; x += L.step) {
        const wx = x - (offset % L.step);
        const h = L.base + Math.sin((x + offset) * 0.01) * 30 + Math.cos((x + offset) * 0.003) * 40;
        ctx.lineTo(wx, h);
        const m = Math.floor((x + offset) / L.step) % 3;
        if (theme === "factory") {
          // pipes / chimneys
          ctx.lineTo(wx + 12, h);
          ctx.lineTo(wx + 12, h - 80 - (m * 20));
          ctx.lineTo(wx + 28, h - 80 - (m * 20));
          ctx.lineTo(wx + 28, h);
        } else if (theme === "ruins") {
          // broken pillars
          if (m === 0) {
            ctx.lineTo(wx + 10, h - 110);
            ctx.lineTo(wx + 26, h - 100);
            ctx.lineTo(wx + 30, h);
          }
        } else {
          // trees
          if (m === 0) {
            ctx.lineTo(wx + 8, h - 90);
            ctx.lineTo(wx + 16, h);
          }
        }
      }
      ctx.lineTo(VW + 100, VH);
      ctx.closePath();
      ctx.fill();
    }
    if (theme === "forest") {
      // hanging vines mid layer
      ctx.strokeStyle = "#0a0c08";
      ctx.lineWidth = 2;
      for (let i = 0; i < 20; i++) {
        const bx = i * 180 - (this.camX * 0.4) % 180;
        ctx.beginPath();
        ctx.moveTo(bx, VH * 0.2);
        ctx.quadraticCurveTo(bx + 6, VH * 0.4, bx + 2, VH * 0.55);
        ctx.stroke();
      }
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D) {
    for (const w of this.level.water) {
      const g = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
      g.addColorStop(0, "rgba(70,80,90,0.55)");
      g.addColorStop(1, "rgba(15,18,22,0.85)");
      ctx.fillStyle = g;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = "rgba(200,210,220,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const t = performance.now() * 0.002;
      for (let x = w.x; x < w.x + w.w; x += 8) {
        const y = w.y + Math.sin(x * 0.05 + t) * 2;
        if (x === w.x) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawWorld(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0a0b0c";
    for (const s of this.level.solids) ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = "rgba(180,190,200,0.12)";
    ctx.lineWidth = 2;
    for (const s of this.level.solids) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + 1);
      ctx.lineTo(s.x + s.w, s.y + 1);
      ctx.stroke();
    }
    // invisible platforms as fog shadows
    for (const iv of this.level.invisibles) {
      ctx.save();
      ctx.shadowColor = "rgba(180,190,200,0.35)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "rgba(160,170,180,0.06)";
      ctx.fillRect(iv.x, iv.y, iv.w, iv.h);
      ctx.restore();
      ctx.strokeStyle = "rgba(200,210,220,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(iv.x + 0.5, iv.y + 0.5, iv.w - 1, iv.h - 1);
    }
    for (const c of this.level.crates) this.drawCrate(ctx, c, false);
    for (const f of this.level.floats) this.drawCrate(ctx, f, true);
    for (const c of this.level.cages) this.drawCage(ctx, c);
  }

  private drawCrate(ctx: CanvasRenderingContext2D, c: Body, wood: boolean) {
    ctx.fillStyle = "#0c0d0e";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = wood ? "rgba(150,160,170,0.35)" : "rgba(150,160,170,0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
    ctx.beginPath();
    if (!wood) {
      ctx.moveTo(c.x + 2, c.y + 2);
      ctx.lineTo(c.x + c.w - 2, c.y + c.h - 2);
      ctx.moveTo(c.x + c.w - 2, c.y + 2);
      ctx.lineTo(c.x + 2, c.y + c.h - 2);
    } else {
      ctx.moveTo(c.x + 2, c.y + c.h / 2);
      ctx.lineTo(c.x + c.w - 2, c.y + c.h / 2);
    }
    ctx.stroke();
  }

  private drawCage(ctx: CanvasRenderingContext2D, c: Body) {
    ctx.fillStyle = "rgba(8,9,10,0.6)";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = "rgba(170,180,190,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
    for (let x = c.x + 8; x < c.x + c.w - 4; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, c.y + 2);
      ctx.lineTo(x, c.y + c.h - 2);
      ctx.stroke();
    }
  }

  private drawConveyors(ctx: CanvasRenderingContext2D) {
    for (const c of this.level.conveyors) {
      ctx.fillStyle = c.on ? "#0a0b0c" : "#151618";
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = c.on ? "rgba(200,210,220,0.4)" : "rgba(120,120,120,0.2)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();
      ctx.strokeStyle = c.on ? "rgba(220,225,230,0.55)" : "rgba(120,120,120,0.25)";
      const off = (c.phase * 14 * c.dir) % 18;
      for (let x = c.x - 18 + off; x < c.x + c.w; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, c.y + 2);
        ctx.lineTo(x + 6 * c.dir, c.y + c.h / 2);
        ctx.lineTo(x, c.y + c.h - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawMechanisms(ctx: CanvasRenderingContext2D) {
    for (const pl of this.level.plates) {
      ctx.fillStyle = "#0a0b0c";
      const yy = pl.pressed ? pl.y + 5 : pl.y;
      ctx.fillRect(pl.x, yy, pl.w, pl.h);
      ctx.strokeStyle = "rgba(200,210,220,0.3)";
      ctx.strokeRect(pl.x, yy, pl.w, pl.h);
      ctx.fillStyle = pl.pressed ? "rgba(220,230,240,0.8)" : "rgba(120,130,140,0.4)";
      ctx.fillRect(pl.x + pl.w / 2 - 4, yy - 3, 8, 3);
    }
    for (const lv of this.level.levers) {
      ctx.strokeStyle = "#0a0b0c";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(lv.x, lv.y);
      const angle = lv.on ? -0.7 : 0.7;
      ctx.lineTo(lv.x + Math.sin(angle) * 34, lv.y - Math.cos(angle) * 34);
      ctx.stroke();
      ctx.fillStyle = lv.on ? "rgba(230,240,250,0.9)" : "#1a1c1f";
      ctx.beginPath();
      ctx.arc(lv.x + Math.sin(angle) * 34, lv.y - Math.cos(angle) * 34, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(lv.x - 6, lv.y, 12, 10);
    }
    for (const d of this.level.doors) {
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = "rgba(160,170,180,0.25)";
      ctx.lineWidth = 2;
      for (let yy = d.y + 10; yy < d.y + d.h; yy += 16) {
        ctx.beginPath();
        ctx.moveTo(d.x, yy);
        ctx.lineTo(d.x + d.w, yy);
        ctx.stroke();
      }
    }
    for (const pl of this.level.platforms) {
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      ctx.strokeStyle = "rgba(180,190,200,0.3)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pl.x + 1, pl.y + 1, pl.w - 2, pl.h - 2);
      for (let xx = pl.x + 8; xx < pl.x + pl.w - 4; xx += 14) {
        ctx.beginPath();
        ctx.arc(xx, pl.y + pl.h / 2, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(180,190,200,0.4)";
        ctx.fill();
      }
    }
    for (const rope of this.level.ropes) {
      const ex = rope.px + Math.sin(rope.angle) * rope.len;
      const ey = rope.py + Math.cos(rope.angle) * rope.len;
      ctx.strokeStyle = "#0a0b0c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rope.px, rope.py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#0a0b0c";
      ctx.beginPath();
      ctx.arc(ex, ey, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(rope.px - 6, rope.py - 6, 12, 8);
    }
  }

  private drawMagnets(ctx: CanvasRenderingContext2D) {
    const t = performance.now() * 0.003;
    for (const m of this.level.magnets) {
      const hostile = m.strength < 0;
      // field rings
      for (let i = 0; i < 3; i++) {
        const rr = (m.r * (0.3 + i * 0.25) + Math.sin(t + i) * 4);
        ctx.strokeStyle = `rgba(${hostile ? "220,80,80" : "200,210,220"},${0.18 - i * 0.04})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      // core device
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(m.x - 14, m.y - 10, 28, 20);
      ctx.fillStyle = hostile ? "rgba(220,60,60,0.8)" : "rgba(220,230,240,0.8)";
      ctx.fillRect(m.x - 10, m.y - 3, 20, 6);
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D) {
    // spikes
    ctx.fillStyle = "#0a0b0c";
    for (const sp of this.level.spikes) {
      const n = Math.max(1, Math.floor(sp.w / 18));
      const bw = sp.w / n;
      for (let i = 0; i < n; i++) {
        const x = sp.x + i * bw;
        ctx.beginPath();
        ctx.moveTo(x, sp.y + sp.h);
        ctx.lineTo(x + bw / 2, sp.y - 6);
        ctx.lineTo(x + bw, sp.y + sp.h);
        ctx.closePath();
        ctx.fill();
      }
    }
    // bear traps
    for (const t of this.level.bearTraps) {
      if (t.hidden) {
        ctx.fillStyle = "rgba(20,18,14,0.6)";
        ctx.beginPath();
        ctx.ellipse(t.x + t.w / 2, t.y + 4, t.w / 2, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // a couple of leaf hints
        ctx.fillStyle = "rgba(40,50,35,0.5)";
        ctx.fillRect(t.x + 4, t.y, 6, 3);
        ctx.fillRect(t.x + t.w - 12, t.y + 1, 6, 3);
      } else {
        ctx.strokeStyle = "#0a0b0c";
        ctx.lineWidth = 3;
        const open = Math.min(1, t.timer * 6);
        const ang = 0.3 + open * 1.0;
        ctx.beginPath();
        ctx.arc(t.x + t.w / 2, t.y + 8, t.w / 2, Math.PI + ang, Math.PI * 2 - ang);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(t.x + t.w / 2, t.y + 8, t.w / 2, ang, Math.PI - ang);
        ctx.stroke();
        // teeth
        ctx.fillStyle = "#0a0b0c";
        for (let i = 0; i < 5; i++) {
          const a = (i / 4) * Math.PI;
          const rx = t.x + t.w / 2 + Math.cos(a) * (t.w / 2);
          const ry = t.y + 8 - Math.sin(a) * (t.w / 2);
          ctx.fillRect(rx - 1, ry - 4, 2, 4);
          ctx.fillRect(rx - 1, ry + 8, 2, 4);
        }
      }
    }
    // falling logs
    for (const l of this.level.fallingLogs) {
      ctx.save();
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
      ctx.rotate(l.angle);
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
      ctx.strokeStyle = "rgba(170,150,120,0.25)";
      ctx.lineWidth = 1;
      for (let i = -l.w / 2 + 6; i < l.w / 2; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, -l.h / 2 + 2);
        ctx.lineTo(i, l.h / 2 - 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // saws
    for (const s of this.level.saws) {
      const pos = this.sawPos(s);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = "#0a0b0c";
      const teeth = 12;
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2;
        const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
        ctx.lineTo(Math.cos(a0) * s.r, Math.sin(a0) * s.r);
        ctx.lineTo(Math.cos(a1) * s.r * 0.78, Math.sin(a1) * s.r * 0.78);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(210,220,230,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s.r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // boulders
    for (const b of this.level.boulders) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = "#0a0b0c";
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // sparks
    const t = performance.now() / 1000;
    for (const s of this.level.sparks) {
      const active = (t + s.phase) % s.period < s.period * 0.5;
      ctx.fillStyle = "#0a0b0c";
      ctx.fillRect(s.x, s.y, s.w, 10);
      ctx.fillRect(s.x, s.y + s.h - 10, s.w, 10);
      if (active) {
        ctx.save();
        ctx.shadowColor = "rgba(240,250,255,0.95)";
        ctx.shadowBlur = 22;
        ctx.strokeStyle = "rgba(245,250,255,0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const segs = 6;
        for (let i = 0; i <= segs; i++) {
          const yy = s.y + 10 + ((s.h - 20) * i) / segs;
          const xx = s.x + s.w / 2 + (Math.random() - 0.5) * 18;
          if (i === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = "rgba(180,190,200,0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w / 2, s.y + 10);
        ctx.lineTo(s.x + s.w / 2, s.y + s.h - 10);
        ctx.stroke();
      }
    }
  }

  private drawSpiders(ctx: CanvasRenderingContext2D) {
    for (const s of this.level.spiders) {
      ctx.strokeStyle = "rgba(10,10,10,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.ceilingY);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = "#0a0b0c";
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 12, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // legs
      ctx.strokeStyle = "#0a0b0c";
      ctx.lineWidth = 1.5;
      const wig = Math.sin(s.phase * 8) * 3;
      for (let i = 0; i < 4; i++) {
        const a = (i / 3) * Math.PI - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(a) * 14, s.y + Math.sin(a) * 10 + wig);
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - Math.cos(a) * 14, s.y + Math.sin(a) * 10 - wig);
        ctx.stroke();
      }
      // tiny eyes
      ctx.fillStyle = "rgba(220,40,40,0.9)";
      ctx.fillRect(s.x - 3, s.y - 2, 2, 2);
      ctx.fillRect(s.x + 1, s.y - 2, 2, 2);
    }
  }

  private drawGoal(ctx: CanvasRenderingContext2D) {
    const g = this.level.goal;
    const grd = ctx.createLinearGradient(0, g.y, 0, g.y + g.h);
    grd.addColorStop(0, "rgba(255,255,255,0.85)");
    grd.addColorStop(1, "rgba(255,255,255,0.15)");
    ctx.fillStyle = grd;
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 40;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.restore();
    ctx.strokeStyle = "#0a0b0c";
    ctx.lineWidth = 6;
    ctx.strokeRect(g.x - 3, g.y - 3, g.w + 6, g.h + 6);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    if (this.dead) {
      ctx.fillStyle = "#0a0b0c";
      for (const r of this.ragdoll) {
        ctx.globalAlpha = Math.max(0, r.life);
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    for (const tr of this.trail) {
      ctx.globalAlpha = Math.max(0, tr.a) * 0.45;
      this.drawSilhouette(ctx, tr.x + this.p.w / 2, tr.y, tr.f, 1, 0);
    }
    ctx.globalAlpha = 1;
    const originY = this.gravSign > 0 ? this.p.y : this.p.y + this.p.h;
    this.drawSilhouette(ctx, this.p.x + this.p.w / 2, originY, this.facing, this.gravSign, 1);
  }

  private drawSilhouette(
    ctx: CanvasRenderingContext2D,
    cx: number,
    originY: number,
    facing: number,
    scaleY: number,
    alpha: number,
  ) {
    const p = this.p;
    const now = performance.now();
    const solid = alpha >= 0.9;
    const airborne = solid ? !p.onGround : false;
    const dragging = solid && this.grabbed != null;
    const roping = solid && this.onRope;
    const reaching = solid && this.grabHeld && !dragging && !roping;
    const run = solid && this.runFlag && p.onGround && Math.abs(p.vx) > 30;
    const moving = solid && p.onGround && Math.abs(p.vx) > 22;
    const t = this.walkPhase;
    const slow = Math.sin(now * 0.004);
    const thL = 11, shL = 12, armL = 8, armF = 8, H = p.h;

    // pose angles (from +Y down, +toward facing) for the non-gait states
    let fThigh = 0, fShin = 0, bThigh = 0, bShin = 0;
    let fUp = 0, fFore = 0, bUp = 0, bFore = 0, lean = 0;
    if (roping) {
      const sw = Math.sin(now * 0.003) * 0.28;
      fUp = 2.85; fFore = 0.5; bUp = 2.95; bFore = 0.5;
      fThigh = 0.35 + sw; fShin = 0.9; bThigh = -0.1 + sw; bShin = 0.7;
    } else if (dragging) {
      lean = 4;
      fUp = 1.42; fFore = 0.2; bUp = -0.5; bFore = 1.5;
      fThigh = 0.7; fShin = 1.0; bThigh = -0.55; bShin = 1.0;
    } else if (reaching) {
      lean = 2;
      fUp = 1.1 + Math.sin(now * 0.012) * 0.12; fFore = -0.25; bUp = -0.4; bFore = 0.9;
      fThigh = 0.3; fShin = 0.25; bThigh = -0.25; bShin = 0.25;
    } else if (airborne) {
      lean = 1;
      if (p.vy * scaleY < 0) { fThigh = -1.1; fShin = 1.8; bThigh = -0.5; bShin = 1.5; fUp = 2.5; fFore = 0.5; bUp = 2.1; bFore = 0.7; }
      else { fThigh = 0.5; fShin = 0.6; bThigh = -0.45; bShin = 0.5; fUp = 1.6; fFore = 0.6; bUp = -1.5; bFore = 0.6; }
    } else if (run) {
      lean = 3.5;
      fUp = Math.sin(t + Math.PI) * 1.0; fFore = 1.3; bUp = Math.sin(t) * 1.0; bFore = 1.3;
    } else if (moving) {
      lean = 1.2;
      fUp = Math.sin(t + Math.PI) * 0.5; fFore = 0.6; bUp = Math.sin(t) * 0.5; bFore = 0.6;
    } else {
      fThigh = 0.1 + slow * 0.03; fShin = 0.08; bThigh = -0.1 + slow * 0.03; bShin = 0.08;
      fUp = 0.14 + slow * 0.05; fFore = 0.35; bUp = -0.14 + slow * 0.05; bFore = 0.35;
    }

    const bobUp = moving ? Math.abs(Math.sin(t)) * (run ? 2.4 : 1.3) : 0;
    const breath = solid && !moving && !airborne ? Math.sin(now * 0.004) * 0.6 : 0;
    const crouch = dragging ? 4 : 0;
    const shY = 11 - bobUp + crouch;
    const hpY = 24 - bobUp + crouch;
    const hdY = 1 - bobUp + crouch * 0.4 + breath * 0.3;
    const wind = Math.max(-12, Math.min(12, -p.vx * 0.04)) - (run ? 3 : 0);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, originY);
    ctx.scale(facing, scaleY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const coat = "#070708", pant = "#0a0a0c", skin = "#050506", hair = "#040405";
    const seg = (x1: number, y1: number, x2: number, y2: number, w: number, col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const ik = (hipX: number, hipYv: number, fx: number, fy: number) => {
      let dx = fx - hipX, dy = fy - hipYv;
      let d = Math.hypot(dx, dy);
      const mx = thL + shL - 0.4;
      if (d > mx) { const s = mx / d; dx *= s; dy *= s; d = mx; }
      const base = Math.atan2(dx, dy);
      const ck = Math.max(-1, Math.min(1, (thL * thL + d * d - shL * shL) / (2 * thL * Math.max(0.001, d))));
      const ka = Math.acos(ck);
      const c1 = base + ka, c2 = base - ka;
      const thA = (hipX + Math.sin(c1) * thL) >= (hipX + Math.sin(c2) * thL) ? c1 : c2;
      const kx = hipX + Math.sin(thA) * thL, ky = hipYv + Math.cos(thA) * thL;
      const shA = Math.atan2(hipX + dx - kx, hipYv + dy - ky);
      return { thA, knRel: shA - thA };
    };
    const foot = (phase: number, sH: number, lift: number) => {
      const p2 = ((phase % 1) + 1) % 1;
      if (p2 < 0.5) { const u = p2 / 0.5; return { fx: sH * (1 - 2 * u), fy: H }; }
      const u = (p2 - 0.5) / 0.5; return { fx: sH * (-1 + 2 * u), fy: H - lift * Math.sin(u * Math.PI) };
    };
    const drawShoe = (x: number, y: number, sc: number) => {
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(x + 2.4 * sc, y + 0.5, 5 * sc, 2.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(170,172,182,0.28)"; ctx.fillRect(x - 1.5 * sc, y + 1.7, 7 * sc, 1.1);
    };
    const drawLeg = (hipX: number, hipYv: number, thA: number, knRel: number, w: number, sc: number) => {
      const kx = hipX + Math.sin(thA) * thL, ky = hipYv + Math.cos(thA) * thL;
      const sa = thA + knRel; const ex = kx + Math.sin(sa) * shL, ey = ky + Math.cos(sa) * shL;
      seg(hipX, hipYv, kx, ky, w, pant); seg(kx, ky, ex, ey, w * 0.82, pant);
      drawShoe(ex, ey, sc);
    };
    const drawArm = (sx: number, sy: number, upA: number, foreRel: number, w: number) => {
      const ex = sx + Math.sin(upA) * armL, ey = sy + Math.cos(upA) * armL;
      seg(sx, sy, ex, ey, w, coat);
      const fa = upA + foreRel; const hx2 = ex + Math.sin(fa) * armF, hy2 = ey + Math.cos(fa) * armF;
      seg(ex, ey, hx2, hy2, w * 0.8, coat);
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hx2, hy2, 2.1, 0, Math.PI * 2); ctx.fill();
    };

    // resolve legs: IK gait when moving, else direct pose angles
    const hx = lean;
    let fLeg: { thA: number; knRel: number }, bLeg: { thA: number; knRel: number };
    if (moving && !dragging && !roping && !reaching) {
      const sH = run ? 14 : 9, lift = run ? 13 : 7;
      const phase = t / (Math.PI * 2);
      const ff = foot(phase, sH, lift), bf = foot(phase + 0.5, sH, lift);
      fLeg = ik(2 + hx * 0.3, hpY, 2 + hx * 0.3 + ff.fx, ff.fy);
      bLeg = ik(-2.5 + hx * 0.3, hpY, -2.5 + hx * 0.3 + bf.fx, bf.fy);
    } else {
      fLeg = { thA: fThigh, knRel: fShin }; bLeg = { thA: bThigh, knRel: bShin };
    }

    const sway = Math.sin(now * 0.006) * 1.2;
    // back arm + back leg
    drawArm(-3 + hx * 0.5, shY + 1, bUp, bFore, 4.0);
    drawLeg(-2.5 + hx * 0.3, hpY, bLeg.thA, bLeg.knRel, 5.0, 0.9);

    // hood resting on the back of the neck (hood DOWN) + hoodie body
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-6 + hx, shY - 1); ctx.quadraticCurveTo(-8 + hx, shY + 5, -4 + hx, shY + 8);
    ctx.lineTo(4 + hx, shY + 7); ctx.quadraticCurveTo(7 + hx, shY + 2, 5 + hx, shY - 1); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5 + hx, shY); ctx.lineTo(5 + hx, shY);
    ctx.lineTo(6 + hx * 0.6, hpY + 6); ctx.lineTo(3.2 + hx * 0.6, hpY + 3); ctx.lineTo(0.8 + hx * 0.6, hpY + 7);
    ctx.lineTo(-1.8 + hx * 0.6, hpY + 3); ctx.lineTo(-4 + hx * 0.6, hpY + 7); ctx.lineTo(-6 + hx * 0.6, hpY + 4);
    ctx.closePath(); ctx.fill();
    // kangaroo pocket + hood strings
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-3.5 + hx * 0.7, hpY - 1); ctx.lineTo(3.5 + hx * 0.7, hpY - 1); ctx.stroke();
    ctx.strokeStyle = "rgba(150,150,160,0.22)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-1 + hx, shY + 2); ctx.lineTo(-1.4 + hx + sway * 0.2, shY + 7); ctx.moveTo(1 + hx, shY + 2); ctx.lineTo(1.4 + hx + sway * 0.2, shY + 7); ctx.stroke();
    if (solid) { ctx.strokeStyle = "rgba(195,200,210,0.14)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5 + hx, shY); ctx.lineTo(-6 + hx * 0.6, hpY + 4); ctx.stroke(); }

    // neck — keeps the head welded to the body (no floating)
    ctx.fillStyle = skin;
    ctx.fillRect(hx - 2.4, hdY + 2, 4.8, shY - hdY + 1);
    // hoodie collar wrapping the neck base
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(hx - 5, shY + 2); ctx.quadraticCurveTo(hx - 3, shY - 3.5, hx, shY - 2.5);
    ctx.quadraticCurveTo(hx + 3, shY - 3.5, hx + 5, shY + 2);
    ctx.quadraticCurveTo(hx, shY + 1.5, hx - 5, shY + 2); ctx.closePath(); ctx.fill();
    // head — boyish oval with brow, nose (faces +x), jaw and ear
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(hx - 1, hdY - 7);
    ctx.bezierCurveTo(hx + 4.5, hdY - 7.6, hx + 6.6, hdY - 3.2, hx + 6.2, hdY + 0.2);
    ctx.lineTo(hx + 7.6, hdY + 0.4);
    ctx.lineTo(hx + 6.1, hdY + 2.4);
    ctx.quadraticCurveTo(hx + 5.4, hdY + 5.2, hx + 2.4, hdY + 6.7);
    ctx.quadraticCurveTo(hx - 1.2, hdY + 7.5, hx - 4.2, hdY + 5.2);
    ctx.quadraticCurveTo(hx - 6.6, hdY + 2.2, hx - 6.2, hdY - 1.8);
    ctx.quadraticCurveTo(hx - 5, hdY - 7, hx - 1, hdY - 7);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx - 4.2, hdY + 0.6, 1.5, 2.3, 0, 0, Math.PI * 2); ctx.fill(); // ear
    // short crop of hair on the skull + fringe + back tuft
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(hx - 5.6, hdY + 1.2);
    ctx.quadraticCurveTo(hx - 6.8, hdY - 6.4, hx - 1, hdY - 7.7);
    ctx.quadraticCurveTo(hx + 4.2, hdY - 7.9, hx + 6.2, hdY - 3.2);
    ctx.lineTo(hx + 4.4, hdY - 2.6);
    ctx.quadraticCurveTo(hx + 2, hdY - 4.4, hx + 0.5, hdY - 3.2);
    ctx.lineTo(hx + 1.5, hdY - 5.0); ctx.lineTo(hx - 0.5, hdY - 3.6);
    ctx.lineTo(hx - 1.5, hdY - 5.2); ctx.lineTo(hx - 3, hdY - 3.4);
    ctx.quadraticCurveTo(hx - 4.6, hdY - 4.6, hx - 5.2, hdY - 1.6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - 5.2, hdY - 0.5); ctx.quadraticCurveTo(hx - 6 + wind * 0.2, hdY + 3, hx - 4 + wind * 0.3, hdY + 5); ctx.lineTo(hx - 3.2, hdY + 1); ctx.closePath(); ctx.fill();

    // front leg + front arm
    drawLeg(2 + hx * 0.3, hpY, fLeg.thA, fLeg.knRel, 5.6, 1);
    drawArm(3 + hx * 0.5, shY + 1, fUp, fFore, 4.4);

    if (solid) {
      ctx.fillStyle = "rgba(214,22,22,0.98)";
      ctx.save(); ctx.shadowColor = "rgba(255,34,34,0.95)"; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(hx + 2.4, hdY - 0.6, 1.6, 0, Math.PI * 2); ctx.arc(hx + 5.0, hdY - 0.6, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawTutorialMarker(ctx: CanvasRenderingContext2D) {
    const m = this.tutorialWorldMarker();
    if (!m) return;
    const t = performance.now() * 0.005;
    const pulse = 0.6 + Math.sin(t) * 0.4;
    ctx.save();
    ctx.strokeStyle = `rgba(220,40,40,${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 16 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    // chevron down
    ctx.fillStyle = `rgba(220,40,40,${0.7})`;
    ctx.beginPath();
    ctx.moveTo(m.x - 6, m.y - 26);
    ctx.lineTo(m.x + 6, m.y - 26);
    ctx.lineTo(m.x, m.y - 18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const pt of this.particles) {
      const a = Math.max(0, Math.min(1, pt.life / 2));
      if (pt.kind === "spark") {
        ctx.fillStyle = `rgba(255,220,160,${a * 0.8})`;
      } else if (pt.kind === "leaf") {
        ctx.fillStyle = `rgba(30,35,25,${a * 0.7})`;
      } else if (pt.kind === "mote") {
        ctx.fillStyle = `rgba(220,220,235,${a * 0.5})`;
      } else if (pt.kind === "ash") {
        ctx.fillStyle = `rgba(180,180,180,${a * 0.4})`;
      } else if (pt.kind === "glow") {
        ctx.fillStyle = `rgba(240,245,255,${a})`;
      } else {
        ctx.fillStyle = `rgba(200,210,220,${a * 0.6})`;
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFog(ctx: CanvasRenderingContext2D) {
    const t = performance.now() * 0.00004;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const y = VH * (0.6 + i * 0.13);
      const g = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      const tint =
        this.level.theme === "forest"
          ? "60,70,55"
          : this.level.theme === "ruins"
          ? "80,72,60"
          : this.level.theme === "factory"
          ? "90,75,55"
          : this.level.theme === "void"
          ? "50,50,70"
          : "150,158,166";
      g.addColorStop(0, `rgba(${tint},0)`);
      g.addColorStop(0.5, `rgba(${tint},${0.12 - i * 0.02})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      const shift = Math.sin(t * 1000 + i) * 20;
      ctx.fillRect(-50 + shift, y - 60, VW + 100, 120);
    }
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.85);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }

  // ================= PREVIEW / DEMO MODE =================
  private kick() {
    cancelAnimationFrame(this.raf);
    this.running = true;
    this.last = performance.now();
    this.loop();
  }

  private precompute() {
    const L = this.level;
    const G = L.groundY;
    this.autoDone = false;
    this.autoStuckT = 0;
    this.autoStuckX = this.p.x;
    this.onRopeTime = 0;
    this.autoCaption = "";
    const step = 6;
    const n = Math.ceil(L.width / step) + 1;
    const prof: { x: number; y: number | null; flipped: boolean }[] = [];
    const floors = [...L.solids, ...L.invisibles, ...L.crates, ...L.cages, ...L.floats];
    const floorAt = (x: number) => {
      let best = -1e9;
      for (const s of floors)
        if (x >= s.x && x <= s.x + s.w && s.y <= G + 5 && s.y >= G - 340 && s.y > best) best = s.y;
      for (const p of L.platforms)
        if (x >= p.x && x <= p.x + p.w && p.y <= G + 5 && p.y >= G - 340 && p.y > best) best = p.y;
      return best > -1e9 ? best : null;
    };
    const ceils = [...L.solids, ...L.invisibles];
    const ceilAt = (x: number) => {
      let best = 1e9;
      for (const s of ceils)
        if (x >= s.x && x <= s.x + s.w && s.y <= 220) {
          const b = s.y + s.h;
          if (b < best) best = b;
        }
      return best < 1e9 ? best : null;
    };
    const gzAt = (x: number) => {
      for (const z of L.gravZones) if (x >= z.x && x <= z.x + z.w) return z;
      return null;
    };
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const gz = gzAt(x);
      if (gz && gz.dir < 0) prof.push({ x, y: ceilAt(x), flipped: true });
      else prof.push({ x, y: floorAt(x), flipped: false });
    }
    for (let i = 0; i < n; i++) {
      if (prof[i].y == null) {
        let j = i;
        while (j < n && prof[j].y == null) j++;
        const yL = i > 0 && prof[i - 1].y != null ? (prof[i - 1].y as number) : G;
        const yR = j < n && prof[j].y != null ? (prof[j].y as number) : G;
        const len = Math.max(1, j - i);
        for (let k = i; k < j; k++) {
          const t = (k - i) / len;
          prof[k].y = yL + (yR - yL) * t - Math.sin(t * Math.PI) * 130;
          prof[k].flipped = false;
        }
        i = j - 1;
      }
    }
    this.profile = prof;
    this.buildCallouts();
  }

  private buildCallouts() {
    const L = this.level;
    const G = L.groundY;
    const C: { x: number; y: number; title: string; hint: string }[] = [];
    const add = (x: number, y: number, title: string, hint: string) => C.push({ x, y, title, hint });
    for (const b of L.bearTraps) add(b.x + b.w / 2, G - 12, "HIDDEN BEAR TRAP", "Don't sprint blind — it snaps on contact");
    for (const l of L.fallingLogs) add(l.x + l.w / 2, 96, "FALLING LOG", "Hear the creak — then run straight through");
    for (const r of L.ropes) add(r.px, r.py + 50, "ROPE", "Hold GRAB to catch it, swing, JUMP to let go");
    for (const s of L.spiders) add(s.x, s.ceilingY + 34, "SPIDER", "It drops the instant you pass beneath");
    for (const c of L.crates) add(c.x + c.w / 2, c.y - 8, "CRATE", "Hold GRAB and drag it where it's needed");
    for (const c of L.cages) add(c.x + c.w / 2, c.y - 8, "CAGE", "Push it close, then climb on top");
    for (const p of L.plates) add(p.x + p.w / 2, p.y - 8, "PRESSURE PLATE", "Weigh it down with you or a crate");
    for (const d of L.doors) add(d.x + d.w / 2, d.y + 12, "GATE", "Opens when its plate / lever / timer fires");
    for (const lv of L.levers)
      add(lv.x, G - 54, lv.timed ? `TIMED LEVER · ${lv.timed.toFixed(1)}s` : "LEVER", lv.timed ? "Pull it, then RUN before it resets" : "Tap GRAB beside it to flip");
    for (const s of L.saws) add(s.cx, s.cy - s.r - 8, "SAW BLADE", "Read its rhythm, slip between the teeth");
    for (const b of L.boulders) add(b.startX, 96, "BOULDER", "It falls and chases — outrun or climb");
    for (const c of L.conveyors)
      add(c.x + c.w / 2, G - 32, c.link != null ? "CONVEYOR + SWITCH" : "CONVEYOR", c.link != null ? "It shoves you; the switch can kill it" : "It shoves you — time the blades riding it");
    for (const s of L.sparks) add(s.x + s.w / 2, s.y - 8, "ELECTRIC ARC", "Cross in the dark gap between pulses");
    for (const m of L.magnets)
      add(m.x, m.y - 12, m.strength < 0 ? "MAGNET · REPEL" : "MAGNET · PULL", m.strength < 0 ? "It throws you off line — don't linger" : "Let it bend your jump across the gap");
    for (const z of L.gravZones) add(z.x + z.w / 2, 64, "GRAVITY FLIP", "You'll fall UP and walk on the ceiling");
    for (const iv of L.invisibles) add(iv.x + iv.w / 2, iv.y - 8, "INVISIBLE PATH", "A faint shadow in the fog — trust it");
    for (const w of L.water) add(w.x + w.w / 2, w.y - 8, "WATER", "Ride the floating blocks; don't stay under");
    for (const p of L.platforms)
      add(p.px + p.w / 2, p.py - 8, p.axis === "y" ? "LIFT" : "MOVING PLATFORM", p.axis === "y" ? "Stand on, rise to the top, step off" : "Ride it across, leap off at the far edge");
    C.sort((a, b) => a.x - b.x);
    this.callouts = C;
  }

  private previewAt(x: number) {
    const G = this.level.groundY;
    const p = this.profile;
    if (!p.length) return { y: G, flipped: false };
    if (x <= p[0].x) return p[0];
    if (x >= p[p.length - 1].x) return p[p.length - 1];
    const i = Math.max(0, Math.min(p.length - 2, Math.floor(x / 6)));
    const a = p[i];
    const b = p[i + 1];
    const t = (x - a.x) / Math.max(1, b.x - a.x);
    const ya = a.y ?? G;
    const yb = b.y ?? G;
    return { y: ya + (yb - ya) * t, flipped: a.flipped };
  }

  enterPreview(n: number, startX?: number) {
    const G = this.level.groundY;
    this.snap = {
      started: this.state.started,
      chapter: this.state.chapter,
      deaths: this.state.deaths,
      cpIndex: this.cpIndex,
      checkpoint: this.state.checkpoint,
      px: this.p.x,
      py: this.p.y,
      pvx: this.p.vx,
      pvy: this.p.vy,
    };
    this.audio.start();
    this.preview = true;
    this.state.paused = false;
    this.loadChapter(n);
    if (this.snap) this.state.deaths = this.snap.deaths;
    this.audio.setThemeBed(this.level.theme);
    this.precompute();
    const w = Math.max(1, this.level.width);
    this.previewX = startX != null ? Math.max(20, Math.min(w - 20, startX)) : 20;
    this.previewPlaying = startX == null;
    this.camX = this.previewX;
    this.camY = G - 100;
    this.zoom = 0.82;
    this.state.preview = true;
    this.state.previewChapter = n;
    this.state.previewPlaying = this.previewPlaying;
    this.state.previewSpeed = this.previewSpeed;
    this.state.previewFrac = this.previewX / w;
    this.emit();
    this.kick();
  }

  exitPreview() {
    if (!this.preview) return;
    this.preview = false;
    const s = this.snap;
    this.snap = null;
    this.state.preview = false;
    if (s && s.started) {
      this.state.started = true;
      this.state.paused = false;
      this.loadChapter(s.chapter);
      this.state.chapter = s.chapter;
      this.state.chapterTitle = CHAPTER_META[s.chapter];
      this.state.deaths = s.deaths;
      this.state.checkpoint = s.checkpoint;
      this.cpIndex = s.cpIndex;
      this.p.x = s.px;
      this.p.y = s.py;
      this.p.vx = 0;
      this.p.vy = 0;
      this.p.onGround = false;
      this.dead = false;
      this.emit();
      this.kick();
    } else {
      this.state.started = false;
      cancelAnimationFrame(this.raf);
      this.running = false;
      this.emit();
    }
  }

  previewSetChapter(n: number) {
    if (!this.preview) return;
    const deaths = this.state.deaths;
    this.loadChapter(n);
    this.state.deaths = deaths;
    this.audio.setThemeBed(this.level.theme);
    this.precompute();
    const w = Math.max(1, this.level.width);
    this.previewX = 20;
    this.previewPlaying = true;
    this.camX = 20;
    this.state.previewChapter = n;
    this.state.previewPlaying = true;
    this.state.previewFrac = this.previewX / w;
    this.emit();
  }

  previewToggle() {
    if (!this.preview) return;
    if (this.autoPlay) {
      if (this.autoDone) {
        this.autoDone = false;
        this.state.paused = false;
        this.loadChapter(this.state.previewChapter);
        if (this.snap) this.state.deaths = this.snap.deaths;
        this.precompute();
        this.kick();
      } else {
        this.state.paused = !this.state.paused;
        if (!this.state.paused) this.kick();
      }
    } else {
      if (!this.previewPlaying && this.previewX >= this.level.width - 40) this.previewX = 20;
      this.previewPlaying = !this.previewPlaying;
      this.state.previewPlaying = this.previewPlaying;
    }
    this.emit();
  }

  cycleSpeed() {
    if (!this.preview) return;
    this.previewSpeed = this.previewSpeed === 1 ? 2 : this.previewSpeed === 2 ? 0.5 : 1;
    this.state.previewSpeed = this.previewSpeed;
    this.emit();
  }

  previewScrub(frac: number) {
    if (!this.preview) return;
    const w = Math.max(1, this.level.width);
    const f = Math.max(0, Math.min(1, frac));
    this.state.previewFrac = f;
    if (this.autoPlay) {
      const g = this.previewAt(f * w);
      this.p.x = Math.max(20, Math.min(w - 20, f * w));
      this.p.y = (g.y ?? this.level.groundY) - this.p.h;
      this.p.vx = 0;
      this.p.vy = 0;
      this.p.onGround = false;
      this.grabbed = null;
      this.onRope = false;
      this.autoStuckX = this.p.x;
      this.autoStuckT = 0;
      this.autoDone = false;
      this.emit();
      return;
    }
    this.previewX = Math.max(20, Math.min(w - 20, f * w));
    this.previewPlaying = false;
    this.state.previewPlaying = false;
    this.emit();
  }

  playChapter(n: number) {
    const deaths = this.snap ? this.snap.deaths : this.state.deaths;
    this.preview = false;
    this.snap = null;
    this.loadChapter(n);
    this.state.preview = false;
    this.state.started = true;
    this.state.paused = false;
    this.state.chapter = n;
    this.state.chapterTitle = CHAPTER_META[n];
    this.state.deaths = deaths;
    this.state.won = false;
    this.transitioning = false;
    this.state.transition = null;
    this.state.whisper = null;
    this.emit();
    this.kick();
  }

  previewCurrentChapter() {
    this.enterPreview(this.state.chapter, this.p.x);
  }

  private updatePreview(dt: number) {
    const G = this.level.groundY;
    if (this.previewPlaying) {
      this.previewX += dt * 230 * this.previewSpeed;
      if (this.previewX >= this.level.width - 30) {
        this.previewX = this.level.width - 30;
        this.previewPlaying = false;
        this.state.previewPlaying = false;
      }
    }
    this.p.vx = 175;
    this.walkPhase += dt * 7;
    const g = this.previewAt(this.previewX);
    const tcy = (g.y ?? G) - 40;
    this.camX += (this.previewX - this.camX) * Math.min(1, dt * 6);
    this.camY += (tcy - this.camY) * Math.min(1, dt * 4);
    this.camY = Math.min(this.level.groundY + 60, this.camY);
    this.zoom += (0.82 - this.zoom) * Math.min(1, dt * 3);
    this.updateParticles(dt);
    this.spawnThemeParticles(dt);
    this.previewEmit += dt;
    if (this.previewEmit > 0.08) {
      this.previewEmit = 0;
      this.state.previewFrac = this.previewX / Math.max(1, this.level.width);
      this.emit();
    }
  }

  private drawPreviewGhost(ctx: CanvasRenderingContext2D) {
    const G = this.level.groundY;
    const g = this.previewAt(this.previewX);
    const y = g.y ?? G;
    const originY = g.flipped ? y + this.p.h : y - this.p.h;
    ctx.save();
    ctx.shadowColor = "rgba(184,26,26,0.45)";
    ctx.shadowBlur = 16;
    this.drawSilhouette(ctx, this.previewX, originY, 1, g.flipped ? -1 : 1, 0.92);
    ctx.restore();
  }

  private drawCallouts(ctx: CanvasRenderingContext2D) {
    const half = (VW / this.zoom) * 0.52;
    const left = this.camX - half;
    const right = this.camX + half;
    ctx.textBaseline = "top";
    for (let idx = 0; idx < this.callouts.length; idx++) {
      const c = this.callouts[idx];
      const dx = c.x - this.camX;
      if (Math.abs(dx) > half) continue;
      const a = Math.max(0, 1 - Math.abs(dx) / half);
      const tagY = c.y - 72 - (idx % 2) * 44;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(184,26,26,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, tagY + 16);
      ctx.stroke();
      ctx.fillStyle = "rgba(184,26,26,0.95)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'italic 15px "Cormorant Garamond", serif';
      const tw1 = ctx.measureText(c.title).width;
      ctx.font = '10px "IBM Plex Mono", monospace';
      const tw2 = ctx.measureText(c.hint).width;
      const bw = Math.max(tw1, tw2) + 20;
      const bh = 36;
      let bx = c.x - bw / 2;
      bx = Math.max(left + 6, Math.min(right - bw - 6, bx));
      ctx.fillStyle = "rgba(8,8,10,0.82)";
      ctx.fillRect(bx, tagY, bw, bh);
      ctx.strokeStyle = "rgba(217,212,200,0.35)";
      ctx.strokeRect(bx + 0.5, tagY + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = "rgba(184,26,26,0.95)";
      ctx.fillRect(bx, tagY, 2, bh);
      ctx.fillStyle = "rgba(232,227,217,0.96)";
      ctx.font = 'italic 15px "Cormorant Garamond", serif';
      ctx.fillText(c.title, bx + 11, tagY + 4);
      ctx.fillStyle = "rgba(170,168,160,0.9)";
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(c.hint, bx + 11, tagY + 21);
      ctx.restore();
    }
  }

  // ================= AUTO-PLAY DRIVER =================
  private setAutoKeys(right: boolean, run: boolean, jump: boolean, interact: boolean) {
    this.keys["arrowright"] = right;
    this.keys["d"] = right;
    this.keys["arrowleft"] = false;
    this.keys["a"] = false;
    this.keys["shift"] = run;
    this.keys[" "] = jump;
    this.keys["w"] = jump;
    this.keys["arrowup"] = jump;
    this.keys["e"] = interact;
    this.keys["k"] = interact;
  }

  private ridingPlatform(): Platform | null {
    const p = this.p;
    const sensor = { x: p.x + 1, y: p.y + p.h - 3, w: p.w - 2, h: 6 };
    for (const pl of this.level.platforms) if (aabb(sensor, pl) && Math.abs(p.y + p.h - pl.y) < 8) return pl;
    return null;
  }

  private leverUseful(lv: Lever): boolean {
    const L = this.level;
    const cx = this.p.x;
    for (const d of L.doors) if (d.link === lv.id && !d.open && d.x > cx - 20 && d.x < cx + 700) return true;
    for (const c of L.conveyors) if (c.link === lv.id && c.x > cx - 20 && c.x < cx + 500) return true;
    for (const pl of L.platforms) if (pl.link === lv.id) return true;
    return false;
  }

  private autoSkip() {
    const p = this.p;
    p.x += 320;
    const g = this.previewAt(p.x);
    p.y = (g.y ?? this.level.groundY) - p.h;
    p.vx = 0;
    p.vy = 0;
    p.onGround = false;
    this.grabbed = null;
    this.onRope = false;
    this.autoStuckX = p.x;
    this.autoStuckT = 0;
    this.autoCaption = "— the demo unties a knot —";
  }

  setAutoPlay(b: boolean) {
    this.autoPlay = b;
    this.state.autoPlay = b;
    if (b) {
      this.state.paused = false;
      this.autoStuckT = 0;
      this.autoStuckX = this.p.x;
      if (this.autoDone) {
        this.autoDone = false;
        this.loadChapter(this.state.previewChapter);
        if (this.snap) this.state.deaths = this.snap.deaths;
        this.precompute();
      }
    } else {
      this.previewX = this.p.x;
      this.previewPlaying = true;
      this.state.previewPlaying = true;
    }
    this.kick();
    this.emit();
  }

  private autoPilotTick(dt: number) {
    this.setAutoKeys(false, false, false, false);
    if (this.dead || this.autoDone || this.state.paused) return;
    const L = this.level;
    const p = this.p;
    const cx = p.x + p.w / 2;
    const gy = (x: number) => this.previewAt(x).y;

    if (p.x > this.autoStuckX + 30) {
      this.autoStuckX = p.x;
      this.autoStuckT = 0;
    } else {
      this.autoStuckT += dt;
      if (this.autoStuckT > 3.2) {
        this.autoSkip();
        return;
      }
    }

    let right = false;
    let run = false;
    let jump = false;
    let interact = false;
    let cap = "";

    // --- on a rope: pump right, release at the peak ---
    if (this.onRope) {
      this.onRopeTime += dt;
      const r = L.ropes[this.ropeIndex];
      interact = true;
      right = true;
      cap = "swing the rope";
      if ((r && r.angle > 0.4 && r.angVel > 0) || this.onRopeTime > 3) {
        interact = false;
        jump = true;
        cap = "let go at the peak";
        this.onRopeTime = 0;
      }
      this.setAutoKeys(right, run, jump, interact);
      this.autoCaption = cap;
      return;
    }
    this.onRopeTime = 0;

    // --- holding a crate / cage ---
    if (this.grabbed) {
      const c = this.grabbed;
      let goalPlate: Plate | null = null;
      for (const pl of L.plates) if (!pl.pressed && pl.x > p.x - 60 && pl.x < p.x + 360) goalPlate = pl;
      const placed = !!goalPlate && c.x + c.w / 2 > goalPlate.x && c.x + c.w / 2 < goalPlate.x + goalPlate.w;
      let barrierX = -1;
      for (const s of L.solids)
        if (s.h >= 60 && s.h <= 200 && s.w <= 40 && s.x > c.x - 10 && s.x < c.x + 200) {
          barrierX = s.x;
          break;
        }
      const atBarrier = barrierX >= 0 && c.x + c.w >= barrierX - 8;
      if (placed) {
        interact = false;
        right = true;
        cap = "placed — walk on";
      } else if (atBarrier && !goalPlate) {
        interact = false;
        right = true;
        jump = p.onGround;
        cap = "climb the cage";
      } else if (goalPlate || barrierX >= 0) {
        interact = true;
        right = true;
        cap = goalPlate ? "push onto the plate" : "push it to the wall";
      } else {
        interact = false;
        right = true;
        cap = "drag it";
      }
      this.setAutoKeys(right, false, jump, interact);
      this.autoCaption = cap;
      return;
    }

    // --- flip a useful lever ---
    for (const lv of L.levers) {
      if (Math.abs(cx - lv.x) < 44 && Math.abs(p.y + p.h - lv.y) < 70) {
        if (this.leverUseful(lv) && !lv.on) {
          interact = true;
          cap = lv.timed ? "pull the lever" : "flip the lever";
          this.setAutoKeys(false, false, false, interact);
          this.autoCaption = cap;
          return;
        }
        if (lv.on && lv.timed) {
          right = true;
          run = true;
          cap = "RUN — the gate closes";
          this.setAutoKeys(right, run, false, false);
          this.autoCaption = cap;
          return;
        }
      }
    }

    // --- catch a rope at a chasm ---
    for (const r of L.ropes) {
      const leftEdge = r.px - 88;
      if (p.onGround && cx >= leftEdge - 34 && cx <= leftEdge + 18 && gy(cx + 70) == null) {
        interact = true;
        cap = "catch the rope";
        this.setAutoKeys(false, false, false, interact);
        this.autoCaption = cap;
        return;
      }
    }

    // --- grab a needed crate / cage ---
    for (const c of [...L.crates, ...L.cages]) {
      const vOverlap = p.y + p.h > c.y + 14 && p.y < c.y + c.h + 6;
      const adjLeft = Math.abs(p.x + p.w - c.x) < 16;
      if (vOverlap && adjLeft && p.onGround) {
        const needPlate = L.plates.some((pl) => !pl.pressed && pl.x > cx && pl.x < cx + 320);
        const needBarrier = L.solids.some((s) => s.h >= 60 && s.h <= 200 && s.w <= 40 && s.x > cx && s.x < cx + 260);
        if (needPlate || needBarrier) {
          interact = true;
          right = true;
          cap = "grab & push";
          this.setAutoKeys(right, false, false, interact);
          this.autoCaption = cap;
          return;
        }
      }
    }

    // --- wait out a blade / arc at the forward column ---
    const col = cx + 14;
    let wait = false;
    for (const s of L.saws) {
      const pos = this.sawPos(s);
      if (Math.abs(pos.x - col) < s.r + 6 && Math.abs(pos.y - (p.y + p.h / 2)) < s.r + 16) wait = true;
    }
    const tnow = performance.now() / 1000;
    for (const s of L.sparks)
      if (col >= s.x - 4 && col <= s.x + s.w + 4 && (tnow + s.phase) % s.period < s.period * 0.5) wait = true;
    if (wait) {
      cap = "wait for the blade";
      this.setAutoKeys(false, false, false, false);
      this.autoCaption = cap;
      return;
    }

    // --- boulder chasing: sprint ---
    for (const b of L.boulders) if (b.released && b.x < cx && b.x > cx - 320) run = true;

    // --- hidden bear trap: hop it, else walk to react ---
    let trapClose = false;
    let trapNear = false;
    for (const bt of L.bearTraps)
      if (bt.x > cx - 10 && bt.x < cx + 130) {
        if (bt.x < cx + 30) trapClose = true;
        trapNear = true;
      }
    if (trapClose && p.onGround) {
      jump = true;
      right = true;
      cap = "hop the hidden trap";
      this.setAutoKeys(right, false, jump, false);
      this.autoCaption = cap;
      return;
    }

    // --- riding a moving platform / lift ---
    const ride = this.ridingPlatform();
    if (ride) {
      if (ride.axis === "y") {
        const top = ride.py - ride.range;
        if (ride.y <= top + 22) {
          right = true;
          cap = "step off the lift";
        } else {
          right = false;
          cap = "ride the lift up";
        }
      } else {
        right = true;
        cap = "ride the platform";
        if (ride.x >= ride.px + ride.range - 28) {
          jump = true;
          cap = "leap off the platform";
        }
      }
      this.setAutoKeys(right, run, jump, false);
      this.autoCaption = cap;
      return;
    }

    // --- board / wait for a lift ---
    for (const pl of L.platforms) {
      if (pl.axis === "y" && pl.x + pl.w > p.x - 6 && pl.x < cx + 10) {
        if (pl.y >= pl.py - 50) {
          right = true;
          cap = "step on the lift";
        } else {
          right = false;
          cap = "wait for the lift";
        }
        this.setAutoKeys(right, false, false, false);
        this.autoCaption = cap;
        return;
      }
    }

    // --- gap / jump from profile ---
    const here = gy(cx + 2);
    const ahead = gy(cx + 20);
    if (p.onGround && here != null && ahead == null) {
      let gEnd = cx + 20;
      while (gEnd < cx + 420 && gy(gEnd) == null) gEnd += 8;
      const gw = gEnd - cx;
      run = gw > 150;
      jump = true;
      right = true;
      cap = gw > 220 ? "long jump" : "jump the gap";
      this.setAutoKeys(right, run, jump, false);
      this.autoCaption = cap;
      return;
    }

    // --- gravity corridor: walk the ceiling ---
    if (this.gravSign < 0) {
      right = true;
      cap = "walk the ceiling";
      this.setAutoKeys(right, run, false, false);
      this.autoCaption = cap;
      return;
    }

    // --- default: advance ---
    right = true;
    const nearPuzzle =
      L.levers.some((lv) => Math.abs(cx - lv.x) < 120) ||
      L.plates.some((pl) => !pl.pressed && Math.abs(pl.x - cx) < 120) ||
      L.crates.some((c) => Math.abs(c.x - cx) < 120);
    if (!trapNear && !nearPuzzle && !this.grabbed) run = true;
    cap = run ? "run right" : "walk right";
    this.setAutoKeys(right, run, false, false);
    this.autoCaption = cap;
  }

  // ================= LIVING WORLD LAYER =================
  private drawSceneProps(ctx: CanvasRenderingContext2D) {
    const theme = this.level.theme;
    const cam = this.camX;
    const tnow = performance.now() * 0.001;
    ctx.save();
    if (theme === "forest") {
      for (let i = 0; i < 16; i++) {
        const fx = (i * 137 - cam * 0.6) % (VW + 200);
        const x = fx < 0 ? fx + VW + 200 : fx;
        const y = VH * (0.3 + (i % 5) * 0.12) + Math.sin(tnow * 1.3 + i) * 16;
        const a = 0.25 + 0.25 * Math.sin(tnow * 2 + i * 1.7);
        ctx.fillStyle = `rgba(220,210,150,${a})`;
        ctx.save();
        ctx.shadowColor = "rgba(220,210,150,0.8)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 8; i++) {
        const bx = i * 320 - ((cam * 0.45) % 320);
        const ground = VH * 0.82;
        const sw = Math.sin(tnow * 1.1 + i) * 7;
        ctx.strokeStyle = "#0a0b08";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx + 40, VH * 0.1);
        ctx.lineTo(bx + 40 + sw, ground - 120);
        ctx.stroke();
        ctx.fillStyle = "#0a0b08";
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo(bx + 40 + sw + k * 6 - 3, ground - 120);
          ctx.lineTo(bx + 40 + sw + k * 6, ground - 102);
          ctx.lineTo(bx + 40 + sw + k * 6 + 3, ground - 120);
          ctx.closePath();
          ctx.fill();
        }
        if (i % 2 === 0) {
          ctx.fillStyle = "#0a0b08";
          ctx.beginPath();
          ctx.ellipse(bx + 210, ground - 12, 13, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(bx + 219, ground - 24, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#0a0b08";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx + 224, ground - 40);
          ctx.lineTo(bx + 228, ground + 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx + 224, ground - 40);
          ctx.lineTo(bx + 230, ground - 46);
          ctx.lineTo(bx + 226, ground - 38);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "rgba(214,22,22,0.85)";
          ctx.fillRect(bx + 220, ground - 25, 1.8, 1.8);
          ctx.strokeStyle = "#0c100a";
          ctx.lineWidth = 2;
          for (let f = 0; f < 4; f++) {
            ctx.beginPath();
            ctx.moveTo(bx + 205, ground);
            ctx.quadraticCurveTo(bx + 205 + (f - 1.5) * 6, ground - 16, bx + 205 + (f - 1.5) * 12, ground - 22);
            ctx.stroke();
          }
        }
        if (i % 3 === 0) {
          const wx = bx + 130;
          const wy = VH * 0.3;
          ctx.strokeStyle = "rgba(220,220,225,0.14)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          for (let s = 0; s < 6; s++) {
            const a = (s / 5) * Math.PI;
            ctx.moveTo(wx, wy);
            ctx.lineTo(wx + Math.cos(a) * 40, wy + Math.sin(a) * 26);
          }
          for (let rr = 10; rr <= 38; rr += 9) {
            ctx.moveTo(wx + rr, wy);
            ctx.arc(wx, wy, rr, 0, Math.PI);
          }
          ctx.stroke();
          ctx.fillStyle = "#0a0b08";
          ctx.beginPath();
          ctx.arc(wx, wy + 2, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (theme === "factory") {
      for (let i = 0; i < 5; i++) {
        const gx = i * 360 - ((cam * 0.3) % 360) + 80;
        const gy = VH * (0.34 + (i % 2) * 0.12);
        const R = 30 + (i % 3) * 12;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(tnow * (i % 2 ? 0.6 : -0.6));
        ctx.strokeStyle = "rgba(18,14,10,0.92)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(18,14,10,0.92)";
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          ctx.save();
          ctx.rotate(a);
          ctx.fillRect(R - 2, -3, 7, 6);
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 4; i++) {
        const px = i * 440 - ((cam * 0.4) % 440) + 60;
        const top = VH * 0.28;
        ctx.strokeStyle = "#100c08";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, VH * 0.82);
        ctx.lineTo(px, top);
        ctx.moveTo(px + 150, VH * 0.82);
        ctx.lineTo(px + 150, top);
        ctx.stroke();
        if (Math.sin(tnow * 9 + i * 2) > -0.3) {
          ctx.save();
          ctx.shadowColor = "rgba(235,240,255,0.9)";
          ctx.shadowBlur = 10;
          ctx.strokeStyle = "rgba(235,240,255,0.85)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(px, top);
          const segs = 6;
          for (let s = 1; s <= segs; s++) ctx.lineTo(px + (150 * s) / segs, top + (Math.random() - 0.5) * 16);
          ctx.stroke();
          ctx.restore();
        }
        const blink = Math.sin(tnow * 4 + i) > 0.4;
        ctx.fillStyle = blink ? "rgba(214,40,40,0.95)" : "rgba(80,20,20,0.6)";
        ctx.save();
        if (blink) {
          ctx.shadowColor = "rgba(255,40,40,0.9)";
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.arc(px + 75, top - 6, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 5; i++) {
        const sx = i * 300 - ((cam * 0.35) % 300) + 40;
        const baseY = VH * 0.4;
        for (let q = 0; q < 3; q++) {
          const ph = (tnow * 0.4 + q * 0.33 + i * 0.1) % 1;
          ctx.fillStyle = `rgba(120,116,110,${0.16 * (1 - ph)})`;
          ctx.beginPath();
          ctx.arc(sx + Math.sin(ph * 6 + i) * 8, baseY - ph * 70, 6 + ph * 16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (theme === "ruins") {
      for (let i = 0; i < 7; i++) {
        const bx = i * 300 - ((cam * 0.4) % 300) + 30;
        const by = VH * 0.84;
        ctx.fillStyle = "#0c0a08";
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(bx + k * 8, by);
          ctx.lineTo(bx + 4 + k * 8, by - 8 - (k % 2) * 4);
          ctx.lineTo(bx + 8 + k * 8, by);
          ctx.closePath();
          ctx.fill();
        }
      }
      for (let i = 0; i < 4; i++) {
        const ax = i * 420 - ((cam * 0.3) % 420) + 60;
        const ay = VH * 0.34;
        ctx.strokeStyle = "rgba(210,205,195,0.12)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(ax, ay, 44, 0, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        for (let s = 0; s < 5; s++) {
          const a = (s / 4) * Math.PI;
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + Math.cos(a) * 44, ay + Math.sin(a) * 44);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 3; i++) {
        const sx = i * 620 - ((cam * 0.22) % 620) + 120;
        const sy = VH * 0.12 + Math.sin(tnow * 0.6 + i) * 8;
        ctx.fillStyle = "rgba(8,8,8,0.88)";
        ctx.beginPath();
        ctx.ellipse(sx, sy, 20, 13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(8,8,8,0.88)";
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 4; k++) {
          const a = (k / 3) * Math.PI - Math.PI / 2;
          const wig = Math.sin(tnow * 4 + k) * 3;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a) * 28, sy + Math.sin(a) * 18 + wig);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - Math.cos(a) * 28, sy + Math.sin(a) * 18 - wig);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(214,22,22,0.75)";
        ctx.fillRect(sx - 4, sy - 2, 2, 2);
        ctx.fillRect(sx + 2, sy - 2, 2, 2);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const ix = i * 360 - ((cam * 0.25) % 360) + 80;
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.translate(ix, VH * 0.16 + Math.sin(tnow * 0.4 + i) * 6);
        ctx.scale(1, -1);
        ctx.fillStyle = "#101016";
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-4, 4, 8, 22);
        ctx.restore();
      }
      for (let i = 0; i < 18; i++) {
        const x = (i * 97 - cam * 0.3) % (VW + 100);
        const xx = x < 0 ? x + VW + 100 : x;
        const y = VH - ((tnow * 30 + i * 60) % VH);
        ctx.fillStyle = `rgba(210,210,225,${0.18 + 0.12 * Math.sin(tnow + i)})`;
        ctx.beginPath();
        ctx.arc(xx, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawGirl(ctx: CanvasRenderingContext2D, gx: number, feetY: number) {
    const now = performance.now();
    const sway = Math.sin(now * 0.0016) * 1.4;
    const breath = Math.sin(now * 0.0024) * 0.8;
    ctx.save();
    const aura = ctx.createRadialGradient(gx, feetY - 36, 4, gx, feetY - 36, 72);
    aura.addColorStop(0, "rgba(255,244,224,0.3)");
    aura.addColorStop(1, "rgba(255,244,224,0)");
    ctx.fillStyle = aura;
    ctx.fillRect(gx - 84, feetY - 112, 168, 144);
    ctx.translate(gx, feetY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const body = "#0c0c0d";
    const hair = "#060607";
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-5, -34);
    ctx.lineTo(5, -34);
    ctx.lineTo(11, -4 + sway * 0.4);
    ctx.quadraticCurveTo(6, -2, 3, -5 + sway * 0.4);
    ctx.quadraticCurveTo(0, -2, -3, -5 + sway * 0.4);
    ctx.quadraticCurveTo(-6, -2, -11, -4 + sway * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4, -50 + breath * 0.3);
    ctx.lineTo(4, -50 + breath * 0.3);
    ctx.lineTo(5, -34);
    ctx.lineTo(-5, -34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = body;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-3, -48 + breath * 0.3);
    ctx.quadraticCurveTo(-9, -38, -8 + sway, -28);
    ctx.moveTo(3, -48 + breath * 0.3);
    ctx.quadraticCurveTo(9, -38, 8 + sway, -28);
    ctx.stroke();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, -56 + breath * 0.3, 6.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(-5, -60 + breath * 0.3);
    ctx.quadraticCurveTo(-9, -52, -8 + sway, -30);
    ctx.quadraticCurveTo(-6, -44, -3, -60 + breath * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5, -60 + breath * 0.3);
    ctx.quadraticCurveTo(8, -50, 6 + sway, -34);
    ctx.quadraticCurveTo(4, -46, 2, -60 + breath * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -57 + breath * 0.3, 6.8, -2.4, -0.6);
    ctx.lineTo(4, -54);
    ctx.quadraticCurveTo(0, -57, -4, -55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,236,200,0.95)";
    ctx.save();
    ctx.shadowColor = "rgba(255,236,200,0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(1.8, -56 + breath * 0.3, 1.2, 0, Math.PI * 2);
    ctx.arc(4.6, -56 + breath * 0.3, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }
}
