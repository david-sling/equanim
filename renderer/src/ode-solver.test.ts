/**
 * Tests for the ODE solver (RK4 integration + linear interpolation).
 * Run with: npx tsx src/ode-solver.test.ts
 *
 * Ground truth: simple harmonic oscillator (SHO)
 *   dx/dt = v
 *   dv/dt = -x
 *   Initial: x(0)=1, v(0)=0
 *   Exact solution: x(t) = cos(t), v(t) = -sin(t)
 *
 * With step=0.001, RK4 error at t=10s is O(h^4) ~ 1e-12, well within 1e-4.
 */

import { createOdeRef, integrateInto, integrateFromInto, makeInterpolator } from "./ode-solver.js";
import type { OdeSystem } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: number, expected: number, tol = 1e-4) {
  const ok = Math.abs(actual - expected) < tol;
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed++;
  }
}

function assertRange(label: string, actual: number, lo: number, hi: number) {
  const ok = actual >= lo && actual <= hi;
  if (ok) {
    console.log(`  ✓ ${label} (${actual.toFixed(6)} in [${lo}, ${hi}])`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected range: [${lo}, ${hi}]`);
    console.error(`    actual: ${actual}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sho: OdeSystem = {
  id: "sho",
  type: "ode_system",
  state: { x: 1, v: 0 },
  derivatives: { x: "v", v: "-x" },
  step: 0.001,
};

const DURATION = 10; // seconds

// ─── createOdeRef + makeInterpolator ─────────────────────────────────────────

console.log("\n--- createOdeRef: initial conditions ---");

const ref = createOdeRef(sho, DURATION);

assert("x(0) = 1",   makeInterpolator(ref, "x")(0),  1.0);
assert("v(0) = 0",   makeInterpolator(ref, "v")(0),  0.0);

// ─── RK4 accuracy against exact SHO solution ─────────────────────────────────

console.log("\n--- RK4 accuracy vs exact SHO solution ---");

const xFn = makeInterpolator(ref, "x");
const vFn = makeInterpolator(ref, "v");

// cos(π/2) = 0, -sin(π/2) = -1
assert("x(π/2) ≈ cos(π/2) = 0",        xFn(Math.PI / 2),  0,          1e-3);
assert("v(π/2) ≈ -sin(π/2) = -1",       vFn(Math.PI / 2),  -1,         1e-3);

// cos(π) = -1, -sin(π) = 0
assert("x(π) ≈ cos(π) = -1",            xFn(Math.PI),      -1,         1e-3);
assert("v(π) ≈ -sin(π) = 0",            vFn(Math.PI),       0,         1e-3);

// cos(2π) = 1, -sin(2π) = 0 (one full period)
assert("x(2π) ≈ cos(2π) = 1 (period)",  xFn(2 * Math.PI),   1,         1e-3);
assert("v(2π) ≈ -sin(2π) = 0 (period)", vFn(2 * Math.PI),   0,         1e-3);

// t = 5s
assert(`x(5) ≈ cos(5) = ${Math.cos(5).toFixed(4)}`, xFn(5), Math.cos(5), 1e-3);
assert(`v(5) ≈ -sin(5) = ${(-Math.sin(5)).toFixed(4)}`, vFn(5), -Math.sin(5), 1e-3);

// t = 10s
assert(`x(10) ≈ cos(10) = ${Math.cos(10).toFixed(4)}`, xFn(10), Math.cos(10), 1e-3);

// ─── Interpolation within a step ─────────────────────────────────────────────

console.log("\n--- Linear interpolation between steps ---");

// At t=0, x=cos(0)=1; at t=step, x=cos(0.001)≈0.9999995.
// At t=0.0005 (midpoint), interpolator should be between them.
const mid = xFn(0.0005);
assertRange("x(0.0005) between x(0) and x(0.001)",
  mid, Math.cos(0.001), Math.cos(0));

// ─── Clamp at boundaries ─────────────────────────────────────────────────────

console.log("\n--- Boundary clamping ---");

// t < 0 clamps to t=0
assert("x(-1) clamps to x(0) = 1",     xFn(-1),        1.0,      1e-6);

// t > duration clamps to t=DURATION
const xAtEnd = xFn(DURATION);
assert("x(>duration) clamps to last value",
  xFn(DURATION + 100), xAtEnd, 1e-6);

// ─── integrateInto: re-integration with different params ─────────────────────

console.log("\n--- integrateInto: re-integration updates trajectories ---");

// Re-integrate a scaled oscillator: dv/dt = -k*x, with k=4 (ω=2)
// Exact: x(t) = cos(2t). We inject k via vars.
const scaled: OdeSystem = {
  id: "scaled",
  type: "ode_system",
  state: { x: 1, v: 0 },
  derivatives: { x: "v", v: "-k * x" },
  step: 0.001,
};

const scaledRef = createOdeRef(scaled, DURATION, { k: 1 }); // ω=1 first
const scaledX = makeInterpolator(scaledRef, "x");

// With k=1: x(π/2) ≈ 0
assert("scaled k=1: x(π/2) ≈ 0", scaledX(Math.PI / 2), 0, 1e-3);

// Re-integrate with k=4 (ω=2): x(t) = cos(2t), x(π/2) = cos(π) = -1
integrateInto(scaled, DURATION, { k: 4 }, scaledRef);

assert("after reintegrate k=4: x(π/2) ≈ cos(π) = -1", scaledX(Math.PI / 2), -1, 1e-3);
assert("after reintegrate k=4: x(π/4) ≈ cos(π/2) = 0", scaledX(Math.PI / 4), 0,  1e-3);

// ─── Events: zero-crossing detection ─────────────────────────────────────────
//
// System: ball falling under gravity, bouncing off a floor at y = 0.
//   dy/dt  = vy
//   dvy/dt = -10   (g = 10 for clean math)
//   Event:  condition = "y", direction = "falling"
//   Mutation: vy → -e * vy
//   Initial:  y = 10, vy = 0
//
// Exact solution (perfect bounce, e = 1):
//   Falls from y=10; hits floor at t₁ = sqrt(2) ≈ 1.4142 s
//   Bounces back with vy = sqrt(20) ≈ 4.4721; returns to y=10 at t = 2√2 ≈ 2.8284 s
//   Period = 2√2 s; y(n × 2√2) = 10 for all n.

console.log("\n--- events: perfect bounce (e=1) preserves energy ---");

const t1 = Math.sqrt(2);       // first floor contact
const period = 2 * Math.sqrt(2); // full bounce period

const bouncingBall: OdeSystem = {
  id: "ball",
  type: "ode_system",
  state: { y: 10, vy: 0 },
  derivatives: { y: "vy", vy: "-10" },
  params: { e: 1.0 },
  events: [
    { condition: "y", direction: "falling", mutations: { vy: "-e * vy" } },
  ],
  step: 0.001,
};

const ballRef = createOdeRef(bouncingBall, 10);
const ballY  = makeInterpolator(ballRef, "y");
const ballVy = makeInterpolator(ballRef, "vy");

// Before first bounce: parabolic descent y = 10 - 5t²
assert("free-fall at t=1: y ≈ 5",      ballY(1),        5,         0.05);
// After bounce, ball returns to original height
assert("y(2√2) ≈ 10 (first return)",   ballY(period),   10,        0.05);
assert("y(4√2) ≈ 10 (second return)",  ballY(2*period), 10,        0.1);
// Velocity is positive (going up) just after the first bounce
// vy just before floor: -g*t₁ = -10√2 ≈ -14.14; after e=1 bounce: +14.14
assertRange("vy just after t₁ is positive (going up)", ballVy(t1 + 0.01), 10, 20);

console.log("\n--- events: inelastic bounce (e=0.75) loses energy each bounce ---");

// e=0.75 → each bounce amplitude = e² × previous = 0.5625 × previous.
// After 1st bounce: peak ≈ 10 × 0.75² = 5.625
// vy at floor = -10√2 ≈ -14.14; after bounce: +0.75×14.14 ≈ +10.61
// Time from floor to peak: 10.61/10 = 1.061s → peak at t ≈ 1.414 + 1.061 = 2.475s

const inelasticBall: OdeSystem = {
  ...bouncingBall,
  params: { e: 0.75 },
};

const inRef = createOdeRef(inelasticBall, 10);
const inY   = makeInterpolator(inRef, "y");

assertRange("y near 1st bounce peak (t≈2.47): [5.0, 6.2]", inY(2.47),  5.0, 6.2);
assertRange("y at t=1.98 (rising after bounce): [3, 6]",    inY(1.98),  3.0, 6.0);

console.log("\n--- events: direction filter — 'rising' does NOT fire on descent ---");

// With direction="rising", event fires on upward crossing only.
// Ball starts at y=10, falls — hits y=0 going DOWNWARD (falling crossing).
// Since direction="rising" is not triggered on the way down, ball passes through y=0.
const risingOnly: OdeSystem = {
  ...bouncingBall,
  params: { e: 1.0 },
  events: [
    { condition: "y", direction: "rising", mutations: { vy: "-vy" } },
  ],
};

const risingRef = createOdeRef(risingOnly, 10);
const risingY   = makeInterpolator(risingRef, "y");

// Ball should NOT bounce — falls through floor, y goes negative
assert("direction=rising: y(2) is negative (no bounce)", risingY(2), -10, 2);

console.log("\n--- events: 'either' fires on rising crossings (unlike 'falling') ---");

// System: y starts at -5, vy=+20, g=10 (no floor). Condition "y", mutation vy → -vy.
//
// Exact crossings of y=0:
//   y(t) = -5 + 20t - 5t²  →  roots at t = (20 ± √300) / 10
//   t_rise ≈ 0.268s (going UP),  t_fall ≈ 3.732s (going DOWN)
//
// direction="either":  event fires at t≈0.268 (rising). vy inverts (~17.32 → -17.32).
//   Ball immediately falls back down — y(4) is very negative.
//
// direction="falling": event fires at t≈3.732 (falling only). vy inverts (~-17.32 → +17.32).
//   Ball bounces up — y(4) is positive.
//
// This proves "either" fires on the RISING crossing that "falling" ignores.

const risingUpBall: OdeSystem = {
  id: "up",
  type: "ode_system",
  state: { y: -5, vy: 20 },
  derivatives: { y: "vy", vy: "-10" },
  events: [{ condition: "y", direction: "either", mutations: { vy: "-vy" } }],
  step: 0.001,
};

const risingUpRef  = createOdeRef(risingUpBall, 10);
const risingUpY    = makeInterpolator(risingUpRef, "y");

// "either" fires on the way up → vy inverts to negative → ball dives down
assertRange("direction=either: y(4) is negative (fired on rising crossing)",
  risingUpY(4), -200, -50);

const fallingOnlyBall: OdeSystem = {
  ...risingUpBall,
  events: [{ condition: "y", direction: "falling", mutations: { vy: "-vy" } }],
};

const fallingOnlyRef = createOdeRef(fallingOnlyBall, 10);
const fallingOnlyY   = makeInterpolator(fallingOnlyRef, "y");

// "falling" does NOT fire on the way up → ball rises freely, bounces at t≈3.73 → y(4) > 0
assertRange("direction=falling: y(4) is positive (did NOT fire on rising crossing)",
  fallingOnlyY(4), 1, 30);

console.log("\n--- events: simultaneous mutation (velocity swap) ---");

// Two-variable mutation: vx1 and vx2 swap (equal-mass 1D elastic collision).
// Condition: x2 - x1 - gap (gap closes to zero).
// At t=0: x1=0 vx1=1, x2=5 vx2=0. They meet when x1=x2, i.e. after 5s.
// After collision: vx1=0, vx2=1.
const collision: OdeSystem = {
  id: "col",
  type: "ode_system",
  state: { x1: 0, vx1: 1, x2: 5, vx2: 0 },
  derivatives: { x1: "vx1", vx1: "0", x2: "vx2", vx2: "0" },
  events: [
    {
      condition: "x2 - x1",
      direction: "falling",
      mutations: {
        vx1: "vx2",
        vx2: "vx1",
      },
    },
  ],
  step: 0.001,
};

const colRef = createOdeRef(collision, 10);
const colX1  = makeInterpolator(colRef, "x1");
const colX2  = makeInterpolator(colRef, "x2");
const colVx1 = makeInterpolator(colRef, "vx1");
const colVx2 = makeInterpolator(colRef, "vx2");

// Before collision (t=2): x1=2 moving right, x2=5 stationary
assert("before collision: x1(2) ≈ 2",  colX1(2), 2,   0.01);
assert("before collision: x2(2) ≈ 5",  colX2(2), 5,   0.01);
assert("before collision: vx1(2) ≈ 1", colVx1(2), 1,  0.01);
assert("before collision: vx2(2) ≈ 0", colVx2(2), 0,  0.01);

// After collision (t=7): x1 is stationary at ~5, x2 is moving right
assert("after collision: vx1(7) ≈ 0",  colVx1(7), 0,  0.01);
assert("after collision: vx2(7) ≈ 1",  colVx2(7), 1,  0.01);
// x2 should have moved 2 units after collision (5s × 1 unit/s = 5 total, 2 post)
assert("after collision: x2(7) ≈ 7",   colX2(7),  7,  0.05);

// ─── integrateFromInto ────────────────────────────────────────────────────────
//
// Scenario: scaled SHO starting with k=1 (ω=1), x(t)=cos(t).
// At tStart=π: state is x=cos(π)=-1, v=-sin(π)≈0.
// We then switch to k=4 (ω=2) from that state.
// With x(0)=-1, v(0)=0 and ω=2: x(τ) = -cos(2τ) where τ = t - π.
//
//   τ = π/4  → t = π+π/4  → x = -cos(π/2) =  0
//   τ = π/2  → t = π+π/2  → x = -cos(π)   =  1
//   τ = π    → t = 2π     → x = -cos(2π)  = -1

console.log("\n--- integrateFromInto: partial re-integration ---");

const fwdSystem: OdeSystem = {
  id: "fwd",
  type: "ode_system",
  state: { x: 1, v: 0 },
  derivatives: { x: "v", v: "-k * x" },
  step: 0.001,
};

const fwdRef = createOdeRef(fwdSystem, DURATION, { k: 1 });
const fwdX = makeInterpolator(fwdRef, "x");
const fwdV = makeInterpolator(fwdRef, "v");

// Verify baseline k=1 trajectory is correct before branching
assert("fwd baseline: x(π/2) ≈ 0",  fwdX(Math.PI / 2),  0,          1e-3);
assert("fwd baseline: x(π)   ≈ -1", fwdX(Math.PI),      -1,         1e-3);

// Branch at tStart = π: sample state from existing trajectory
const tBranch = Math.PI;
const branchIdx = Math.round(tBranch / fwdRef.step);
const startState = {
  x: fwdRef.trajectories["x"]![branchIdx]!,
  v: fwdRef.trajectories["v"]![branchIdx]!,
};

// Re-integrate forward from π with k=4
integrateFromInto(fwdSystem, tBranch, startState, DURATION, { k: 4 }, fwdRef);

// History before tStart must be preserved unchanged (k=1 trajectory)
assert("history preserved: x(π/2) still ≈ 0",  fwdX(Math.PI / 2), 0,  1e-3);
assert("history preserved: x(0)   still =  1",  fwdX(0),           1,  1e-4);

// Continuity at the branch point
assert("continuous at branch: x(π) = -1",        fwdX(Math.PI),    -1, 1e-3);

// Future follows new k=4 dynamics: x(τ) = -cos(2τ), τ = t - π
assert("future k=4: x(π + π/4) ≈ 0",  fwdX(Math.PI + Math.PI / 4),  0,  1e-3);
assert("future k=4: x(π + π/2) ≈ 1",  fwdX(Math.PI + Math.PI / 2),  1,  1e-3);
assert("future k=4: x(2π)      ≈ -1", fwdX(2 * Math.PI),            -1,  1e-3);

// tStart ≤ 0 falls back to full re-integration from initial conditions
console.log("\n--- integrateFromInto: tStart=0 falls back to full reintegration ---");

const fallbackRef = createOdeRef(fwdSystem, DURATION, { k: 1 });
const fallbackX = makeInterpolator(fallbackRef, "x");
integrateFromInto(fwdSystem, 0, { x: 1, v: 0 }, DURATION, { k: 4 }, fallbackRef);

// Full k=4 trajectory: x(t) = cos(2t), x(π/4) = 0, x(π/2) = -1
assert("fallback full reintegrate: x(π/4) ≈ 0",  fallbackX(Math.PI / 4), 0,  1e-3);
assert("fallback full reintegrate: x(π/2) ≈ -1", fallbackX(Math.PI / 2), -1, 1e-3);

// ─── Unknown state var returns 0 ──────────────────────────────────────────────

console.log("\n--- Unknown state variable ---");

const missing = makeInterpolator(ref, "nonexistent");
assert("interpolator for missing var returns 0", missing(5), 0, 1e-9);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
