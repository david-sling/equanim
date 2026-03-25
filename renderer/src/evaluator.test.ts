/**
 * Smoke test for the evaluator.
 * Run with: npx tsx src/evaluator.test.ts
 *
 * Tests the dampened wave spec expressions at a few key time points
 * and validates that the evaluator produces expected values.
 */

import { buildEvaluator } from "./evaluator.js";

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
    console.log(`  ✓ ${label} (${actual.toFixed(4)} in [${lo}, ${hi}])`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected range: [${lo}, ${hi}]`);
    console.error(`    actual: ${actual}`);
    failed++;
  }
}

// ─── Dampened wave params (from spec) ─────────────────────────────────────────

const params = { k: 0.018, omega: 6.28 };

const functions = {
  A: { args: ["t"], body: "80 * exp(-1.8 * t)" },
  E: { args: ["s", "t"], body: "clamp(omega * t - abs(k * s), 0, 1)" },
};

const ev = buildEvaluator(params, functions);

// ─── Test: basic constant expressions ─────────────────────────────────────────

console.log("\n--- Constants & params ---");
assert("k resolves to 0.018", ev.evaluate("k", 0), 0.018);
assert("omega resolves to 6.28", ev.evaluate("omega", 0), 6.28);
assert("t=1 is 1", ev.evaluate("t", 1), 1);
assert("s at s=42", ev.evaluate("s", 0, 42), 42);

// ─── Test: math builtins ──────────────────────────────────────────────────────

console.log("\n--- Math builtins ---");
assert("sin(0) = 0", ev.evaluate("sin(0)", 0), 0);
assert("exp(0) = 1", ev.evaluate("exp(0)", 0), 1);
assert("abs(-5) = 5", ev.evaluate("abs(-5)", 0), 5);
assert("clamp(2, 0, 1) = 1", ev.evaluate("clamp(2, 0, 1)", 0), 1);
assert("clamp(-1, 0, 1) = 0", ev.evaluate("clamp(-1, 0, 1)", 0), 0);
assert("clamp(0.5, 0, 1) = 0.5", ev.evaluate("clamp(0.5, 0, 1)", 0), 0.5);

// ─── Test: named functions ────────────────────────────────────────────────────

console.log("\n--- Named functions ---");

// A(t) = 80 * exp(-1.8 * t)
// A(0) = 80 * exp(0) = 80
assert("A(0) = 80", ev.evaluate("A(t)", 0), 80);
// A(1) = 80 * exp(-1.8) ≈ 13.07
assert("A(1) ≈ 13.07", ev.evaluate("A(t)", 1), 80 * Math.exp(-1.8), 1e-3);
// A(3) should be very small
assertRange("A(3) is near 0", ev.evaluate("A(t)", 3), 0, 2);

// E(s, t) = clamp(omega*t - abs(k*s), 0, 1)
// At t=0, s=0: omega*0 - 0 = 0 → clamp(0,0,1) = 0
assert("E(0,0) = 0", ev.evaluate("E(s, t)", 0, 0), 0);
// At t=1, s=0: omega*1 - 0 = 6.28 → clamp(6.28,0,1) = 1
assert("E(0,1) = 1", ev.evaluate("E(s, t)", 1, 0), 1);
// At t=1, s=500: omega*1 - abs(k*500) = 6.28 - 9 = -2.72 → clamp(-2.72,0,1) = 0
assert("E(500,1) = 0 (wavefront not reached)", ev.evaluate("E(s, t)", 1, 500), 0);

// ─── Test: full wave equation y = A(t) * E(s,t) * sin(k*s - omega*t) ─────────

console.log("\n--- Wave equation ---");
const yExpr = "A(t) * E(s, t) * sin(k * s - omega * t)";
const compiledY = ev.compile(yExpr);

// At t=0, E=0 everywhere → y=0
assert("y(s=0, t=0) = 0", compiledY.evaluate(0, 0), 0);
assert("y(s=100, t=0) = 0", compiledY.evaluate(0, 100), 0);

// At t=2, s=0: A(2)=80*exp(-3.6)≈2.21, E=1, sin(-12.56)=sin(0)≈0
// sin(-omega*t) = sin(-6.28*2) = sin(-12.56) ≈ sin(-4*pi) ≈ 0
const yAt2s0 = compiledY.evaluate(2, 0);
assertRange("y(s=0, t=2) is bounded", yAt2s0, -5, 5);

// At t=1, s=0: A≈13.07, E=1, sin(-6.28)≈0
// sin(-6.28) ≈ sin(-2*pi) ≈ 0
const yAt1s0 = compiledY.evaluate(1, 0);
assertRange("y(s=0, t=1) near 0 (sin at 2pi)", yAt1s0, -1, 1);

// Peak check: at t=0.25, s=0: A=80*exp(-0.45)≈50.5, E=clamp(1.57,0,1)=1
// sin(-6.28*0.25) = sin(-pi/2) = -1
const t025 = 0.25;
const A025 = 80 * Math.exp(-1.8 * t025);
const expectedPeak = A025 * 1 * Math.sin(-6.28 * t025);
assert(
  "y(s=0, t=0.25) matches manual calculation",
  compiledY.evaluate(t025, 0),
  expectedPeak,
  0.01
);

// ─── Test: pre-compiled vs one-shot gives same result ─────────────────────────

console.log("\n--- Compiled vs one-shot consistency ---");
for (const t of [0, 0.5, 1.0, 1.5, 2.0]) {
  for (const s of [-200, 0, 200]) {
    const oneShot = ev.evaluate(yExpr, t, s);
    const compiled = compiledY.evaluate(t, s);
    assert(
      `compile==oneshot at t=${t} s=${s}`,
      compiled,
      oneShot,
      1e-10
    );
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
