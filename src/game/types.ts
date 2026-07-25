export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Body extends Rect {
  vx: number;
  vy: number;
  buoyant?: boolean;
  onGround?: boolean;
}

export interface Door extends Rect {
  open: boolean;
  link: number;
  yClosed: number;
  yOpen: number;
}

export interface Plate extends Rect {
  id: number;
  pressed: boolean;
}

export interface Lever {
  x: number;
  y: number;
  id: number;
  on: boolean;
  timed?: number; // if set, auto-switches off after N seconds
  timer?: number;
}

export interface Saw {
  cx: number;
  cy: number;
  r: number;
  axis: "x" | "y";
  range: number;
  speed: number;
  phase: number;
  angle: number;
}

export interface Boulder {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  triggerX: number;
  released: boolean;
  startX: number;
  startY: number;
  angle: number;
}

export interface Rope {
  px: number;
  py: number;
  len: number;
  angle: number;
  angVel: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  kind?: "dust" | "bubble" | "glow" | "leaf" | "spark" | "ash" | "mote";
}

// --- new chapter entities ---

export interface BearTrap {
  x: number;
  y: number;
  w: number;
  hidden: boolean;
  sprung: boolean;
  timer: number;
}

export interface FallingLog {
  x: number;
  y: number;
  w: number;
  h: number;
  triggerX: number;
  fallen: boolean;
  vy: number;
  angle: number;
  restY: number;
}

export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number; // previous x (for carry delta)
  py: number;
  axis: "x" | "y" | "none";
  range: number;
  speed: number;
  phase: number;
  link?: number; // only moves when linked lever/plate active
}

export interface Conveyor {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: 1 | -1;
  on: boolean;
  link?: number;
  phase: number;
}

export interface Spark {
  x: number;
  y: number;
  w: number;
  h: number;
  period: number;
  phase: number;
}

export interface Magnet {
  x: number;
  y: number;
  r: number;
  strength: number;
}

export interface GravZone {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: 1 | -1;
}

export interface Spider {
  x: number;
  ceilingY: number;
  y: number;
  restY: number;
  triggered: boolean;
  vy: number;
  phase: number;
}

export type Theme = "mist" | "forest" | "ruins" | "factory" | "void";

export interface Whisper {
  x: number;
  text: string;
  fired?: boolean;
}
