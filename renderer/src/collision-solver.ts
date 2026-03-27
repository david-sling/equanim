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
 *   0. Update kinematic bodies from their prescribed position expressions.
 *      Their velocity is computed as Δpos/dt and used only for impulse calc.
 *   1. Apply friction deceleration and integrate dynamic bodies.
 *   2. Resolve ball-wall collisions (dynamic only).
 *   3. Resolve ball-ball collisions (elastic impulse + position correction),
 *      repeated for `PASSES` iterations for stability under dense contacts.
 *      Kinematic bodies impart impulse but don't receive it (infinite mass).
 *   4. Record positions for all bodies.
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

  // Build mutable state from initial conditions
  type BallState = {
    x: number; y: number;
    vx: number; vy: number;
    r: number; m: number;
    kinematic: boolean;
    xExpr?: string;
    yExpr?: string;
  };

  const state: Record<string, BallState> = {};
  for (const [id, ball] of Object.entries(system.bodies)) {
    const isKinematic = ball.kinematic === true;
    // For kinematic bodies x/y must be expression strings; evaluate at t=0 for initial pos
    const x0 = evalNum(ball.x, 0, { ...vars, t: 0 });
    const y0 = evalNum(ball.y, 0, { ...vars, t: 0 });
    state[id] = {
      x:  x0,
      y:  y0,
      vx: isKinematic ? 0 : evalNum(ball.vx, 0, vars),
      vy: isKinematic ? 0 : evalNum(ball.vy, 0, vars),
      r:  ball.r,
      m:  isKinematic ? Infinity : (ball.m ?? 1),
      kinematic: isKinematic,
      xExpr: isKinematic ? String(ball.x) : undefined,
      yExpr: isKinematic ? String(ball.y) : undefined,
    };
    ref.trajectories[`${id}_x`]![0] = x0;
    ref.trajectories[`${id}_y`]![0] = y0;
  }

  const balls   = Object.values(state);
  const ballIds = Object.keys(state);
  const n       = balls.length;

  // ── Delay: hold dynamic balls at rest until physics kick in ────────────────
  const delay      = system.delay ?? 0;
  const delaySteps = Math.min(nSteps - 1, Math.round(delay / dt));

  for (let step = 1; step <= delaySteps; step++) {
    const t = step * dt;
    for (let k = 0; k < n; k++) {
      const id   = ballIds[k]!;
      const ball = balls[k]!;
      // Still update kinematic bodies even during delay
      if (ball.kinematic && ball.xExpr !== undefined) {
        ball.x = evalNum(ball.xExpr, ball.x, { ...vars, t });
        ball.y = evalNum(ball.yExpr!, ball.y, { ...vars, t });
      }
      ref.trajectories[`${id}_x`]![step] = ball.x;
      ref.trajectories[`${id}_y`]![step] = ball.y;
    }
  }

  // ── Integration loop ────────────────────────────────────────────────────────
  for (let step = delaySteps + 1; step < nSteps; step++) {
    const t = step * dt;

    // 0. Update kinematic bodies from prescribed expressions
    for (const ball of balls) {
      if (!ball.kinematic || ball.xExpr === undefined) continue;
      const prevX = ball.x;
      const prevY = ball.y;
      ball.x  = evalNum(ball.xExpr, ball.x, { ...vars, t });
      ball.y  = evalNum(ball.yExpr!, ball.y, { ...vars, t });
      // Derive velocity for impulse calculations
      ball.vx = (ball.x - prevX) / dt;
      ball.vy = (ball.y - prevY) / dt;
    }

    // 1. Friction + Euler position step (dynamic only)
    for (const ball of balls) {
      if (ball.kinematic) continue;
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

    // 2. Wall collisions (dynamic only)
    if (bounds) {
      for (const ball of balls) {
        if (ball.kinematic) continue;
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

          // Two kinematic bodies never interact
          if (a.kinematic && b.kinematic) continue;

          const dx   = b.x - a.x;
          const dy   = b.y - a.y;
          const d2   = dx * dx + dy * dy;
          const dmin = a.r + b.r;

          if (d2 >= dmin * dmin || d2 < 1e-12) continue;

          const dist = Math.sqrt(d2);
          const nx   = dx / dist;  // unit normal from a → b
          const ny   = dy / dist;

          // Relative velocity along normal (positive = approaching)
          const dvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

          if (dvn > 0) {
            if (a.kinematic) {
              // a is kinematic (infinite mass): only b gets impulse
              // v_b_new = v_b + (1+e)*dvn * n  (b accelerates away from a)
              b.vx += (1 + restitution) * dvn * nx;
              b.vy += (1 + restitution) * dvn * ny;
            } else if (b.kinematic) {
              // b is kinematic (infinite mass): only a gets impulse
              // v_a_new = v_a - (1+e)*dvn * n  (a bounces back from b)
              a.vx -= (1 + restitution) * dvn * nx;
              a.vy -= (1 + restitution) * dvn * ny;
            } else {
              // Both dynamic: standard elastic impulse
              const tm      = a.m + b.m;
              const impulse = (1 + restitution) * a.m * b.m / tm * dvn;
              a.vx -= impulse / a.m * nx;
              a.vy -= impulse / a.m * ny;
              b.vx += impulse / b.m * nx;
              b.vy += impulse / b.m * ny;
            }
          }

          // Position correction — push bodies apart
          const overlap = dmin - dist;
          if (a.kinematic) {
            // Only move b
            b.x += nx * overlap;
            b.y += ny * overlap;
          } else if (b.kinematic) {
            // Only move a
            a.x -= nx * overlap;
            a.y -= ny * overlap;
          } else {
            // Both dynamic: split by mass ratio
            const tm = a.m + b.m;
            a.x -= nx * overlap * b.m / tm;
            a.y -= ny * overlap * b.m / tm;
            b.x += nx * overlap * a.m / tm;
            b.y += ny * overlap * a.m / tm;
          }
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
