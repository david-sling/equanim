import * as math from "mathjs";
import type { CollisionSystem, VarValues } from "./types.js";
import type { OdeRef } from "./ode-solver.js";

// CollisionRef is structurally identical to OdeRef — the same trajectory
// storage and the same makeInterpolator function work for both.
export type CollisionRef = OdeRef;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Evaluate a field that is either a plain number or a mathjs expression. */
function evalNum(
  val: number | string | undefined,
  fallback: number,
  vars: VarValues,
): number {
  if (val === undefined) return fallback;
  if (typeof val === "number") return val;
  return math.evaluate(val, { ...vars }) as number;
}

// ─── Solver ───────────────────────────────────────────────────────────────────

/**
 * Run the collision simulation and write results into an existing CollisionRef.
 *
 * Algorithm (per time step):
 *   1. Apply friction deceleration and integrate positions.
 *   2. Resolve ball-wall collisions (reflect velocity, correct position).
 *   3. Resolve ball-ball collisions (elastic impulse + position correction),
 *      repeated for `PASSES` iterations for stability under dense contacts.
 *   4. Record positions.
 *
 * This is an impulse-based sequential solver. It is not physically exact
 * (no continuous event detection) but is visually accurate at small step
 * sizes and handles the dense contact cascade of a pool break well.
 */
const PASSES = 4; // collision resolution passes per step (more = more stable)

export function solveCollisionsInto(
  system: CollisionSystem,
  duration: number,
  vars: VarValues,
  ref: CollisionRef,
): void {
  const dt = system.step ?? 0.002;
  const nSteps = Math.ceil(duration / dt) + 1;
  const restitution = Math.max(0, Math.min(1, evalNum(system.restitution, 0.9, vars)));
  const friction    = Math.max(0, evalNum(system.friction, 80, vars));
  const bounds      = system.bounds;

  const bodyIds = Object.keys(system.bodies);

  // Reallocate trajectory arrays
  ref.step      = dt;
  ref.nSteps    = nSteps;
  ref.duration  = duration;
  ref.trajectories = {};
  for (const id of bodyIds) {
    ref.trajectories[`${id}_x`] = new Float64Array(nSteps);
    ref.trajectories[`${id}_y`] = new Float64Array(nSteps);
  }

  // Build mutable state from initial conditions (supports expression strings)
  type BallState = { x: number; y: number; vx: number; vy: number; r: number; m: number };
  const state: Record<string, BallState> = {};
  for (const [id, ball] of Object.entries(system.bodies)) {
    state[id] = {
      x:  evalNum(ball.x,  0, vars),
      y:  evalNum(ball.y,  0, vars),
      vx: evalNum(ball.vx, 0, vars),
      vy: evalNum(ball.vy, 0, vars),
      r:  ball.r,
      m:  ball.m ?? 1,
    };
    ref.trajectories[`${id}_x`]![0] = state[id]!.x;
    ref.trajectories[`${id}_y`]![0] = state[id]!.y;
  }

  const balls      = Object.values(state);
  const ballIds    = Object.keys(state);
  const n          = balls.length;

  // ── Integration loop ────────────────────────────────────────────────────────
  for (let step = 1; step < nSteps; step++) {

    // 1. Friction + Euler position step
    for (const ball of balls) {
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (speed > 1e-6) {
        const decel = Math.min(friction * dt, speed);
        const scale = (speed - decel) / speed;
        ball.vx *= scale;
        ball.vy *= scale;
      } else {
        ball.vx = 0;
        ball.vy = 0;
      }
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
    }

    // 2. Wall collisions
    if (bounds) {
      for (const ball of balls) {
        if (ball.x - ball.r < bounds.x[0]) {
          ball.x  = bounds.x[0] + ball.r;
          ball.vx = Math.abs(ball.vx) * restitution;
        } else if (ball.x + ball.r > bounds.x[1]) {
          ball.x  = bounds.x[1] - ball.r;
          ball.vx = -Math.abs(ball.vx) * restitution;
        }
        if (ball.y - ball.r < bounds.y[0]) {
          ball.y  = bounds.y[0] + ball.r;
          ball.vy = Math.abs(ball.vy) * restitution;
        } else if (ball.y + ball.r > bounds.y[1]) {
          ball.y  = bounds.y[1] - ball.r;
          ball.vy = -Math.abs(ball.vy) * restitution;
        }
      }
    }

    // 3. Ball-ball collision resolution (multiple passes for stability)
    for (let pass = 0; pass < PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = balls[i]!;
          const b = balls[j]!;

          const dx   = b.x - a.x;
          const dy   = b.y - a.y;
          const d2   = dx * dx + dy * dy;
          const dmin = a.r + b.r;

          if (d2 >= dmin * dmin || d2 < 1e-12) continue;

          const dist = Math.sqrt(d2);
          const nx   = dx / dist;
          const ny   = dy / dist;
          const tm   = a.m + b.m;

          // Elastic impulse (only when approaching)
          const dvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (dvn > 0) {
            const impulse = (1 + restitution) * a.m * b.m / tm * dvn;
            a.vx -= impulse / a.m * nx;
            a.vy -= impulse / a.m * ny;
            b.vx += impulse / b.m * nx;
            b.vy += impulse / b.m * ny;
          }

          // Position correction — push balls apart proportional to mass ratio
          const overlap = dmin - dist;
          a.x -= nx * overlap * b.m / tm;
          a.y -= ny * overlap * b.m / tm;
          b.x += nx * overlap * a.m / tm;
          b.y += ny * overlap * a.m / tm;
        }
      }
    }

    // 4. Record
    for (let k = 0; k < n; k++) {
      const id   = ballIds[k]!;
      const ball = balls[k]!;
      ref.trajectories[`${id}_x`]![step] = ball.x;
      ref.trajectories[`${id}_y`]![step] = ball.y;
    }
  }
}

export function createCollisionRef(
  system: CollisionSystem,
  duration: number,
  vars: VarValues = {},
): CollisionRef {
  const dt     = system.step ?? 0.002;
  const nSteps = Math.ceil(duration / dt) + 1;
  const ref: CollisionRef = { trajectories: {}, step: dt, nSteps, duration };
  solveCollisionsInto(system, duration, vars, ref);
  return ref;
}
