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
