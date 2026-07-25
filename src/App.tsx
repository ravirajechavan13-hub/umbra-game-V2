import { useEffect, useRef, useState } from "react";
import { Game, type GameState } from "./game/Game";

function isTouchDevice() {
  return typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}

const TRIALS = 25;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [state, setState] = useState<GameState>({
    started: false,
    deaths: 0,
    checkpoint: 0,
    checkpointTotal: 0,
    won: false,
    paused: false,
    chapter: 1,
    chapterTitle: { roman: "I", title: "The Whispering Wood", subtitle: "" },
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
  });
  const [audioOn, setAudioOn] = useState(true);
  const [touch] = useState(isTouchDevice);
  const [running, setRunning] = useState(false);
  const [portrait, setPortrait] = useState(
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false,
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current);
    g.onState = setState;
    g.attach();
    gameRef.current = g;
    return () => g.destroy();
  }, []);

  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    if (!state.transition) return;
    const id = setTimeout(() => gameRef.current?.nextChapter(), 1700);
    return () => clearTimeout(id);
  }, [state.transition]);

  const startGame = () => gameRef.current?.start();

  const holdProps = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      gameRef.current?.setKey(key, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      gameRef.current?.setKey(key, false);
    },
    onPointerCancel: () => gameRef.current?.setKey(key, false),
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.buttons !== 0) return;
      gameRef.current?.setKey(key, false);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const toggleRun = () => {
    const next = !running;
    setRunning(next);
    gameRef.current?.setKey("shift", next);
  };

  const btn =
    "relative flex select-none items-center justify-center rounded-full border border-white/20 bg-black/55 text-neutral-200 backdrop-blur-[2px] active:bg-white/20 transition-colors touch-none overflow-visible font-body";

  return (
    <div className="relative flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-black">
      <canvas ref={canvasRef} className="h-full w-full" style={{ touchAction: "none" }} />

      {/* ===== HUD ===== */}
      {state.started && !state.won && !state.transition && (
        <div className="pointer-events-none absolute inset-0 select-none">
          <div className="absolute left-4 top-3 flex items-baseline gap-4 font-body text-[10px] uppercase tracking-[0.28em] text-neutral-400">
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl leading-none text-neutral-100">{state.chapterTitle.roman}</span>
              <span className="font-body text-[9px] uppercase tracking-[0.3em] text-neutral-500">{state.chapterTitle.title}</span>
            </span>
            <span>
              deaths <span className="text-[#d8b4b4]">{String(state.deaths).padStart(2, "0")}</span>
            </span>
            <span>
              cp <span className="text-neutral-200">{state.checkpoint}</span>
              <span className="text-neutral-600">/{state.checkpointTotal}</span>
            </span>
          </div>

          <div className="absolute right-3 top-3 flex gap-1.5">
            <button
              className="pointer-events-auto rounded-sm border border-white/15 bg-black/50 px-2.5 py-1 font-body text-[10px] tracking-widest text-neutral-300 transition hover:bg-white/10"
              onClick={() => {
                const on = gameRef.current?.toggleAudio();
                setAudioOn(!!on);
              }}
            >
              {audioOn ? "sound ◆" : "sound ◇"}
            </button>
            <button
              className="pointer-events-auto rounded-sm border border-white/15 bg-black/50 px-2.5 py-1 font-body text-[10px] tracking-widest text-neutral-300 transition hover:bg-white/10"
              onClick={() => gameRef.current?.togglePause()}
            >
              {state.paused ? "resume" : "pause"}
            </button>
            <button
              className="pointer-events-auto rounded-sm border border-white/15 bg-black/50 px-2.5 py-1 font-body text-[10px] tracking-widest text-neutral-300 transition hover:bg-white/10"
              onClick={() => {
                setRunning(false);
                gameRef.current?.restart();
              }}
            >
              restart
            </button>
          </div>

          {state.whisper && (
            <div className="absolute inset-x-0 top-14 flex justify-center px-6">
              <p
                key={state.whisper.id}
                className="font-display text-lg italic tracking-[0.18em] text-neutral-300 sm:text-xl"
                style={{ animation: "umbra-whisper 4.4s ease-in-out forwards", textShadow: "0 2px 14px rgba(0,0,0,0.9)" }}
              >
                {state.whisper.text}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ===== Touch controls ===== */}
      {state.started && !state.won && !state.transition && touch && !state.paused && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="absolute bottom-5 left-4 flex items-end gap-3">
            <button {...holdProps("arrowleft")} className={`pointer-events-auto h-[74px] w-[74px] text-2xl ${btn}`} aria-label="Left">◄</button>
            <button {...holdProps("arrowright")} className={`pointer-events-auto h-[74px] w-[74px] text-2xl ${btn}`} aria-label="Right">►</button>
          </div>
          <div className="absolute bottom-5 right-4 flex items-end gap-3">
            <div className="flex flex-col items-center gap-3">
              <button onClick={toggleRun} className={`pointer-events-auto h-12 w-12 font-body text-[9px] uppercase tracking-widest ${btn} ${running ? "border-[#d62828]/80 bg-[#d62828]/15" : ""}`} aria-label="Run">run</button>
              <button {...holdProps("e")} className={`pointer-events-auto h-16 w-16 font-body text-[10px] uppercase tracking-widest ${btn}`} aria-label="Grab">grab</button>
            </div>
            <button {...holdProps(" ")} className={`pointer-events-auto mb-1 h-[92px] w-[92px] font-body text-xs uppercase tracking-widest ${btn}`} aria-label="Jump">jump</button>
          </div>
        </div>
      )}

      {/* ===== Portrait nudge ===== */}
      {state.started && touch && portrait && !state.transition && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/85 px-8 text-center backdrop-blur-sm">
          <div className="mb-4 font-display text-5xl text-neutral-300">↻</div>
          <p className="font-display text-2xl italic tracking-[0.1em] text-neutral-200">Turn the device</p>
          <p className="mt-2 font-body text-[10px] uppercase tracking-[0.35em] text-neutral-500">The dark is wider sideways</p>
        </div>
      )}

      {/* ===== Pause overlay ===== */}
      {state.started && state.paused && !state.won && !state.transition && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <p className="mb-6 font-display text-5xl italic tracking-[0.2em] text-neutral-300">stillness</p>
          <button onClick={() => gameRef.current?.togglePause()} className="rounded-sm border border-white/25 px-8 py-3 font-body text-xs uppercase tracking-[0.35em] text-neutral-200 transition hover:bg-white hover:text-black">
            resume
          </button>
        </div>
      )}

      {/* ===== Between-trial card ===== */}
      {state.transition && (
        <button onClick={() => gameRef.current?.nextChapter()} className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/92 px-6 text-center" style={{ animation: "umbra-breathe 1.7s ease-in-out" }}>
          <div className="umbra-grain pointer-events-none absolute inset-0" />
          <p className="font-body text-[10px] uppercase tracking-[0.6em] text-[#b81a1a]">trial {state.chapter} held</p>
          <div className="my-4 h-px w-16 bg-[#8a1414]" />
          <p className="font-display text-6xl leading-none text-neutral-100 sm:text-7xl">{state.transition.roman}</p>
          <h2 className="mt-3 font-display text-2xl italic tracking-[0.06em] text-neutral-200 sm:text-3xl">{state.transition.title}</h2>
          <p className="mt-2 font-body text-[10px] uppercase tracking-[0.35em] text-neutral-500">{state.transition.subtitle}</p>
          <p className="mt-8 font-body text-[9px] uppercase tracking-[0.5em] text-neutral-600" style={{ animation: "umbra-breathe 1.4s ease-in-out infinite" }}>tap to descend</p>
        </button>
      )}

      {/* ===== TITLE — a living dark jungle ===== */}
      {!state.started && (
        <div className="absolute inset-0 overflow-hidden bg-black">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(ellipse 60% 40% at 28% 72%, rgba(60,72,52,0.4), transparent 70%), radial-gradient(ellipse 50% 30% at 78% 38%, rgba(40,48,36,0.35), transparent 70%)", animation: "umbra-drift 22s ease-in-out infinite alternate" }} />
          <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: "radial-gradient(ellipse 70% 34% at 50% 96%, rgba(10,12,8,0.95), transparent 70%)", animation: "umbra-drift-rev 30s ease-in-out infinite alternate" }} />
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className="absolute block h-[2px] w-[2px] rounded-full bg-emerald-100/40" style={{ left: `${(i * 5.7 + 3) % 100}%`, top: "-5%", animation: `umbra-fall ${9 + (i % 5) * 2}s linear ${i * 0.6}s infinite` }} />
            ))}
          </div>
          <div className="pointer-events-none absolute right-[16%] top-0" style={{ transformOrigin: "top center", animation: "umbra-sway 5.5s ease-in-out infinite" }}>
            <svg width="40" height="220" viewBox="0 0 40 220" className="opacity-70">
              <line x1="20" y1="0" x2="20" y2="150" stroke="rgba(220,220,225,0.22)" strokeWidth="0.8" />
              <g fill="#050505">
                <ellipse cx="20" cy="158" rx="9" ry="6.5" />
                <circle cx="20" cy="150" r="4.5" />
                {[-1, 1].map((s) =>
                  [0, 1, 2, 3].map((k) => (
                    <path key={`${s}-${k}`} d={`M20 156 q ${s * (8 + k * 3)} ${-4 + k * 5} ${s * (14 + k * 2)} ${10 + k * 3}`} stroke="#050505" strokeWidth="1.3" fill="none" />
                  )),
                )}
                <rect x="18" y="148" width="1.6" height="1.6" fill="#d62828" />
                <rect x="21" y="148" width="1.6" height="1.6" fill="#d62828" />
              </g>
            </svg>
          </div>
          <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] w-full" viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ opacity: 0.95 }}>
            <g fill="#070906">
              <path d="M0 300 L0 150 L40 120 L70 160 L110 90 L150 150 L190 70 L230 140 L280 100 L320 160 L370 80 L420 150 L470 110 L520 160 L570 90 L620 150 L680 100 L730 160 L790 80 L840 150 L900 110 L950 160 L1000 120 L1000 300 Z" />
            </g>
            <g stroke="#050704" strokeWidth="2" fill="none" opacity="0.9">
              <path d="M120 110 q 6 60 2 120" />
              <path d="M360 90 q -5 70 3 130" />
              <path d="M640 110 q 7 60 -2 120" />
              <path d="M880 120 q -6 60 4 110" />
            </g>
            <g fill="#050704">
              <rect x="494" y="120" width="12" height="120" />
              <circle cx="500" cy="112" r="13" />
              <rect x="495" y="108" width="2.4" height="2.4" fill="#d62828" />
              <rect x="502" y="108" width="2.4" height="2.4" fill="#d62828" />
            </g>
          </svg>
          <div className="umbra-grain pointer-events-none absolute inset-0" />

          <div className="relative z-10 flex h-full flex-col px-6 sm:px-10">
            <div className="flex items-center justify-between pt-6 font-body text-[10px] uppercase tracking-[0.4em] text-neutral-500">
              <span>a game of shadow &amp; silence</span>
              <span>mmxxvi</span>
            </div>

            <div className="flex flex-1 flex-col justify-center">
              <p className="mb-3 font-body text-[10px] uppercase tracking-[0.55em] text-[#b81a1a]">twenty-five trials · no map · no mercy</p>
              <h1 className="font-display text-[26vw] font-light leading-[0.82] tracking-[0.04em] text-neutral-100 sm:text-[15vw] md:text-[11rem]" style={{ animation: "umbra-flicker 7s linear infinite" }}>
                UMBRA
              </h1>
              <div className="mt-4 h-px w-28 bg-gradient-to-r from-[#8a1414] to-transparent" style={{ animation: "umbra-breathe 3s ease-in-out infinite" }} />
              <p className="mt-4 max-w-md font-display text-xl italic leading-snug tracking-[0.04em] text-neutral-400 sm:text-2xl">
                a shadow that learned to walk — and a girl who waits at the end of the dark.
              </p>

              <div className="mt-9 flex items-stretch gap-5">
                <button onClick={startGame} className="group relative overflow-hidden border border-white/30 px-12 py-4 font-body text-sm uppercase tracking-[0.5em] text-neutral-100 transition hover:border-white active:bg-white active:text-black">
                  <span className="relative z-10">begin</span>
                  <span className="absolute inset-0 origin-left scale-x-0 bg-white transition-transform duration-300 group-hover:scale-x-100" />
                </button>
                <div className="flex flex-col justify-center border-l border-white/10 pl-5 font-body text-[9px] uppercase leading-relaxed tracking-[0.35em] text-neutral-500">
                  <span className="text-neutral-300">{TRIALS} trials</span>
                  <span>one way out</span>
                  <span className="text-[#8a1414]">the last is the cruelest</span>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between gap-4 pb-7">
              <div className="grid grid-cols-2 gap-x-7 gap-y-1 font-body text-[10px] tracking-[0.18em] text-neutral-500">
                {touch ? (
                  <>
                    <span className="text-right text-neutral-300">◄ ►</span><span>walk</span>
                    <span className="text-right text-neutral-300">run</span><span>sprint</span>
                    <span className="text-right text-neutral-300">jump</span><span>leap / let go</span>
                    <span className="text-right text-neutral-300">grab</span><span>hold · pull · climb</span>
                  </>
                ) : (
                  <>
                    <span className="text-right text-neutral-300">A / D</span><span>walk</span>
                    <span className="text-right text-neutral-300">shift</span><span>sprint</span>
                    <span className="text-right text-neutral-300">space</span><span>leap / let go</span>
                    <span className="text-right text-neutral-300">E</span><span>hold · pull · climb</span>
                  </>
                )}
              </div>
              <p className="hidden font-body text-[9px] uppercase tracking-[0.4em] text-neutral-700 sm:block">rotate to landscape</p>
            </div>
          </div>
        </div>
      )}

      {/* ===== FINALE — she was waiting ===== */}
      {state.won && state.finale && (
        <div className="absolute inset-0 z-40 overflow-hidden bg-black">
          <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(ellipse 50% 50% at 50% 46%, rgba(120,90,70,0.28), transparent 70%)" }} />
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} className="absolute block h-[6px] w-[3px] rounded-full bg-neutral-200/50" style={{ left: `${(i * 6.3 + 4) % 100}%`, top: "-6%", animation: `umbra-petal ${10 + (i % 4) * 2}s linear ${i * 0.8}s infinite` }} />
            ))}
          </div>
          <div className="umbra-grain pointer-events-none absolute inset-0" />

          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="relative mb-2" style={{ animation: "umbra-rise 1.4s ease-out both" }}>
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,240,210,0.32), transparent 65%)", animation: "umbra-halo 3.4s ease-in-out infinite" }} />
              <svg width="120" height="190" viewBox="0 0 120 190" className="relative">
                <g fill="#d9d4c8">
                  <path d="M52 70 L68 70 L82 150 Q72 146 66 150 Q60 146 54 150 Q48 146 38 150 Z" />
                  <path d="M54 50 L66 50 L68 72 L52 72 Z" />
                  <path d="M54 54 Q44 64 46 86" stroke="#d9d4c8" strokeWidth="4" fill="none" strokeLinecap="round" />
                  <path d="M66 54 Q76 64 74 86" stroke="#d9d4c8" strokeWidth="4" fill="none" strokeLinecap="round" />
                  <circle cx="60" cy="40" r="9" />
                </g>
                <g fill="#0c0c0d">
                  <path d="M51 33 Q60 26 69 33 L66 40 Q60 36 54 40 Z" />
                  <path d="M52 34 Q44 44 47 78 Q51 60 55 34 Z" />
                  <path d="M68 34 Q76 44 73 78 Q69 60 65 34 Z" />
                </g>
                <g fill="#fff3d8">
                  <circle cx="57" cy="40" r="1.5" />
                  <circle cx="63" cy="40" r="1.5" />
                </g>
              </svg>
            </div>

            <p className="font-body text-[10px] uppercase tracking-[0.6em] text-[#b81a1a]" style={{ animation: "umbra-rise 1.6s ease-out 0.2s both" }}>the dark releases you</p>
            <h2 className="mt-3 font-display text-5xl font-light tracking-[0.06em] text-neutral-100 sm:text-7xl" style={{ animation: "umbra-rise 1.6s ease-out 0.35s both" }}>
              ALL MISSIONS PASSED
            </h2>
            <div className="my-5 h-px w-40 bg-gradient-to-r from-transparent via-[#8a1414] to-transparent" />
            <p className="font-display text-lg italic tracking-[0.08em] text-neutral-400" style={{ animation: "umbra-rise 1.6s ease-out 0.5s both" }}>
              {TRIALS} / {TRIALS} trials · {state.deaths} {state.deaths === 1 ? "shadow" : "shadows"} left in the wood
            </p>

            <div className="mt-8 flex flex-col items-center" style={{ animation: "umbra-rise 1.6s ease-out 0.7s both" }}>
              <p className="font-body text-sm uppercase tracking-[0.45em] text-neutral-200">
                next part
                <span className="ml-1 inline-flex gap-1 align-middle">
                  <span className="inline-block h-1 w-1 rounded-full bg-[#b81a1a]" style={{ animation: "umbra-dots 1.4s ease-in-out infinite" }} />
                  <span className="inline-block h-1 w-1 rounded-full bg-[#b81a1a]" style={{ animation: "umbra-dots 1.4s ease-in-out 0.2s infinite" }} />
                  <span className="inline-block h-1 w-1 rounded-full bg-[#b81a1a]" style={{ animation: "umbra-dots 1.4s ease-in-out 0.4s infinite" }} />
                </span>
              </p>
              <p className="mt-1 font-display text-2xl italic tracking-[0.06em] text-neutral-300">coming soon</p>
            </div>

            <button
              onClick={() => { setRunning(false); gameRef.current?.restart(); }}
              className="mt-9 rounded-sm border border-white/25 px-10 py-3 font-body text-xs uppercase tracking-[0.35em] text-neutral-100 transition hover:bg-white hover:text-black"
              style={{ animation: "umbra-rise 1.6s ease-out 0.9s both" }}
            >
              wander again
            </button>
          </div>
        </div>
      )}

      {state.won && !state.finale && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black px-6 text-center">
          <h2 className="font-display text-4xl italic text-neutral-100 sm:text-6xl">You reached the light.</h2>
          <button onClick={() => { setRunning(false); gameRef.current?.restart(); }} className="mt-8 rounded-sm border border-white/25 px-10 py-3 font-body text-xs uppercase tracking-[0.35em] text-neutral-100 transition hover:bg-white hover:text-black">
            wander again
          </button>
        </div>
      )}
    </div>
  );
}
