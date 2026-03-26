import type { Variables, VarValues } from "./types.js";
import type { PreparedScene } from "./render.js";
import { renderFrame } from "./render.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayerState = "idle" | "playing" | "paused" | "ended";

export interface PlayerOptions {
  background?: string;
  onStateChange?: (state: PlayerState) => void;
  onTimeUpdate?: (t: number) => void;
}

export interface Player {
  play(): void;
  pause(): void;
  reset(): void;
  seek(t: number): void;
  /** Replace the current variable values and immediately re-render. */
  setVariables(vars: VarValues): void;
  getVariables(): VarValues;
  getState(): PlayerState;
  getTime(): number;
  dispose(): void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract default values from a spec's variables block. */
export function defaultVarValues(variables: Variables = {}): VarValues {
  return Object.fromEntries(
    Object.entries(variables).map(([k, def]) => [k, def.default])
  );
}

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Valid state transitions:
 *
 *   idle  ──play──► playing ──pause──► paused ──play──► playing
 *                     │                  │
 *                  reaches end        reset()
 *                     │                  │
 *                     ▼                  ▼
 *                   ended ◄──────────── idle
 *
 *  reset() from any state → idle (t=0, no active RAF)
 */

export const TRANSITIONS: Record<PlayerState, PlayerState[]> = {
  idle: ["playing"],
  playing: ["paused", "ended"],
  paused: ["playing", "idle"],
  ended: ["idle"],
};

export function canTransition(from: PlayerState, to: PlayerState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── createPlayer ─────────────────────────────────────────────────────────────

export function createPlayer(
  canvas: HTMLCanvasElement,
  prepared: PreparedScene,
  options: PlayerOptions = {},
  /** Initial variable values. Typically from defaultVarValues(spec.variables). */
  initialVars: VarValues = {}
): Player {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context from canvas");
  const ctx2d: CanvasRenderingContext2D = ctx;

  const { meta } = prepared;
  const dt = 1 / meta.fps;
  const { background = "#0a0a0f", onStateChange, onTimeUpdate } = options;

  let state: PlayerState = "idle";
  let t = 0;
  let rafHandle: number | null = null;
  let vars: VarValues = { ...initialVars };

  // ── Internal helpers ────────────────────────────────────────────────────────

  function setState(next: PlayerState): void {
    if (state === next) return;
    state = next;
    onStateChange?.(next);
  }

  function draw(): void {
    renderFrame(ctx2d, prepared, t, background, vars);
  }

  function tick(): void {
    if (state !== "playing") return;

    draw();
    onTimeUpdate?.(t);

    t += dt;

    if (t >= meta.duration) {
      t = meta.duration;
      draw();
      onTimeUpdate?.(t);
      setState("ended");
      rafHandle = null;
      return;
    }

    rafHandle = requestAnimationFrame(tick);
  }

  function stopRaf(): void {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  // ── Render initial frame (so canvas isn't blank before play) ───────────────
  draw();

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    play() {
      if (state === "ended") {
        t = 0;
        setState("idle");
      }
      if (!canTransition(state, "playing")) return;
      setState("playing");
      rafHandle = requestAnimationFrame(tick);
    },

    pause() {
      if (!canTransition(state, "paused")) return;
      stopRaf();
      setState("paused");
    },

    reset() {
      stopRaf();
      t = 0;
      setState("idle");
      draw();
      onTimeUpdate?.(0);
    },

    seek(newT: number) {
      t = Math.max(0, Math.min(newT, meta.duration));
      draw();
      onTimeUpdate?.(t);
      if (state === "ended" && t < meta.duration) setState("paused");
    },

    setVariables(newVars: VarValues) {
      vars = { ...newVars };
      // Re-integrate ODE systems with the new variable values so physics
      // (e.g. gravity, mass, arm lengths) responds to slider changes.
      // integrateInto updates trajectory data in the OdeRef objects in place;
      // interpolator functions already in evaluator closures pick up the new
      // data automatically on the next renderFrame call.
      prepared.reintegrate?.(vars);
      draw();
    },

    getVariables(): VarValues {
      return { ...vars };
    },

    getState() {
      return state;
    },

    getTime() {
      return t;
    },

    dispose() {
      stopRaf();
    },
  };
}
