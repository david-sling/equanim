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

// ─── Dampened wave (updated spec: k/omega/amplitude/decay come from variables) ─
//
// The spec no longer has a params block on the wave object — all four values
// are global variables. We simulate this by passing them as vars at eval time.
//
// Wave functions use t (local 0→1) so the animation is timeline-portable:
// shrinking or shifting the object's timeline window changes the playback
// speed rather than just toggling visibility.

const waveVars = { amplitude: 80, decay: 1.8, k: 0.018, omega: 6.28 };

const functions = {
  A: { args: ["t"], body: "amplitude * exp(-decay * t)" },
  E: { args: ["s", "t"], body: "clamp(omega * t - abs(k * s), 0, 1)" },
};

// No params — everything comes through vars
const ev = buildEvaluator({}, functions);

// ─── Test: T and t in scope ───────────────────────────────────────────────────

console.log("\n--- T and t in scope ---");
// T = global seconds, t = local normalised 0→1
assert("T=1 resolves to 1", ev.evaluate("T", 1, 0), 1);
assert("T=2.5 resolves to 2.5", ev.evaluate("T", 2.5, 0), 2.5);
assert("t=0.5 resolves to 0.5", ev.evaluate("t", 0, 0.5), 0.5);
assert("t=1 resolves to 1", ev.evaluate("t", 0, 1), 1);
// Both available simultaneously
assert("T and t are independent: T=3, t=0.25", ev.evaluate("T + t", 3, 0.25), 3.25);
// t does not change when T changes and vice versa
assert("T=0 t=1: t expression = 1", ev.evaluate("t", 0, 1), 1);
assert("T=5 t=0: T expression = 5", ev.evaluate("T", 5, 0), 5);

// ─── Test: basic constant expressions ─────────────────────────────────────────

console.log("\n--- Constants & vars ---");
assert("k from vars resolves to 0.018", ev.evaluate("k", 0, 0, undefined, waveVars), 0.018);
assert("omega from vars resolves to 6.28", ev.evaluate("omega", 0, 0, undefined, waveVars), 6.28);
assert("amplitude from vars resolves to 80", ev.evaluate("amplitude", 0, 0, undefined, waveVars), 80);
assert("s at s=42", ev.evaluate("s", 0, 0, 42, waveVars), 42);

// ─── Test: math builtins ──────────────────────────────────────────────────────

console.log("\n--- Math builtins ---");
assert("sin(0) = 0", ev.evaluate("sin(0)", 0, 0), 0);
assert("exp(0) = 1", ev.evaluate("exp(0)", 0, 0), 1);
assert("abs(-5) = 5", ev.evaluate("abs(-5)", 0, 0), 5);
assert("clamp(2, 0, 1) = 1", ev.evaluate("clamp(2, 0, 1)", 0, 0), 1);
assert("clamp(-1, 0, 1) = 0", ev.evaluate("clamp(-1, 0, 1)", 0, 0), 0);
assert("clamp(0.5, 0, 1) = 0.5", ev.evaluate("clamp(0.5, 0, 1)", 0, 0), 0.5);
// builtins work even without vars
assert("pi resolves", ev.evaluate("pi", 0, 0), Math.PI, 1e-6);

// ─── Test: named functions (using t = local normalised time) ─────────────────

console.log("\n--- Named functions (with vars, t = local 0→1) ---");

// A(t) = amplitude * exp(-decay * t)
// A(t=0) = 80 * exp(0) = 80  — full amplitude at entry
assert("A(t=0) = 80", ev.evaluate("A(t)", 0, 0, undefined, waveVars), 80);
// A(t=1) = 80 * exp(-1.8) ≈ 13.07  — decayed to ~16% at exit
assert("A(t=1) ≈ 13.07", ev.evaluate("A(t)", 0, 1, undefined, waveVars), 80 * Math.exp(-1.8), 1e-3);
// A(t=1) for a large decay — should be very small
assertRange("A(t=1) with decay=6 is near 0", ev.evaluate("A(t)", 0, 1, undefined, { ...waveVars, decay: 6 }), 0, 0.5);

// E(s, t) = clamp(omega*t - abs(k*s), 0, 1)
// At t=0, s=0: omega*0 - 0 = 0 → clamp(0,0,1) = 0
assert("E(0,t=0) = 0", ev.evaluate("E(s, t)", 0, 0, 0, waveVars), 0);
// At t=1, s=0: omega*1 - 0 = 6.28 → clamp(6.28,0,1) = 1
assert("E(0,t=1) = 1", ev.evaluate("E(s, t)", 0, 1, 0, waveVars), 1);
// At t=1, s=500: omega*1 - abs(k*500) = 6.28 - 9 = -2.72 → clamp(-2.72,0,1) = 0
assert("E(500,t=1) = 0 (wavefront not reached)", ev.evaluate("E(s, t)", 0, 1, 500, waveVars), 0);

// ─── Test: full wave equation y = A(t) * E(s,t) * sin(k*s - omega*t) ──────────

console.log("\n--- Wave equation ---");
const yExpr = "A(t) * E(s, t) * sin(k * s - omega * t)";
const compiledY = ev.compile(yExpr);

// At t=0, E=0 everywhere → y=0
assert("y(s=0, t=0) = 0", compiledY.evaluate(0, 0, 0, waveVars), 0);
assert("y(s=100, t=0) = 0", compiledY.evaluate(0, 0, 100, waveVars), 0);

// At t=2/3, s=0: sin(-4.19) ≈ sin(-4π/3) — bounded
const yAtT23s0 = compiledY.evaluate(0, 2/3, 0, waveVars);
assertRange("y(s=0, t=2/3) is bounded", yAtT23s0, -80, 80);

// At t=1/2, s=0: sin(-omega/2) = sin(-pi) ≈ 0
const yAtHalfs0 = compiledY.evaluate(0, 0.5, 0, waveVars);
assertRange("y(s=0, t=0.5) near 0 (sin at pi)", yAtHalfs0, -1, 1);

// Peak check: at t=0.25, s=0: A=80*exp(-0.45)≈50.5, E=1, sin(-pi/2)=-1
const t025 = 0.25;
const A025 = 80 * Math.exp(-1.8 * t025);
const expectedPeak = A025 * 1 * Math.sin(-6.28 * t025);
assert(
  "y(s=0, t=0.25) matches manual calculation",
  compiledY.evaluate(0, t025, 0, waveVars),
  expectedPeak,
  0.01
);

// ─── Test: pre-compiled vs one-shot gives same result ─────────────────────────

console.log("\n--- Compiled vs one-shot consistency ---");
for (const t of [0, 0.25, 0.5, 0.75, 1.0]) {
  for (const s of [-200, 0, 200]) {
    const oneShot = ev.evaluate(yExpr, 0, t, s, waveVars);
    const compiled = compiledY.evaluate(0, t, s, waveVars);
    assert(`compile==oneshot at t=${t} s=${s}`, compiled, oneShot, 1e-10);
  }
}

// ─── Test: t (local) is independent of T (global) ─────────────────────────────

console.log("\n--- Local t is independent of global T ---");

// An expression that uses only t: a simple fade (opacity = t)
const fadeEv = buildEvaluator({}, {});
const compiledFade = fadeEv.compile("t");

// t=0: opacity=0, regardless of T
assert("fade at t=0 (T=0): t=0", compiledFade.evaluate(0, 0, undefined), 0);
assert("fade at t=0 (T=2): t=0 (T has no effect)", compiledFade.evaluate(2, 0, undefined), 0);

// t=0.5: half-way through the object's own window
assert("fade at t=0.5: t=0.5", compiledFade.evaluate(99, 0.5, undefined), 0.5);
assert("fade at t=1.0: fully opaque", compiledFade.evaluate(0, 1.0, undefined), 1.0);

// An expression that uses only T: pure physics
const compiledPhysics = fadeEv.compile("T * T");
assert("physics T^2 at T=3: 9", compiledPhysics.evaluate(3, 0.99, undefined), 9);
assert("physics T^2 at T=2: 4", compiledPhysics.evaluate(2, 0.0, undefined), 4);

// ─── Test: variable injection & override ─────────────────────────────────────

console.log("\n--- Variable injection ---");

// amplitude=0 → y=0 everywhere regardless of t/s
const zeroAmp = { ...waveVars, amplitude: 0 };
assertRange("amplitude=0 kills the wave at t=0.5", compiledY.evaluate(0, 0.5, 0, zeroAmp), -0.001, 0.001);

// amplitude=200 → peak is 2.5× the default (200/80)
const highAmp = { ...waveVars, amplitude: 200 };
const defaultPeak = compiledY.evaluate(0, t025, 0, waveVars);
const highPeak = compiledY.evaluate(0, t025, 0, highAmp);
assert(
  "amplitude=200 scales peak by 2.5×",
  Math.round((highPeak / defaultPeak) * 10) / 10,
  2.5,
  0.05
);

// decay=0.1 (slow decay): A(t=1) should be much larger than default
const slowDecay = { ...waveVars, decay: 0.1 };
const defaultA1 = ev.evaluate("A(t)", 0, 1, undefined, waveVars);
const slowA1 = ev.evaluate("A(t)", 0, 1, undefined, slowDecay);
assert("slow decay (0.1) has larger A(t=1) than default (1.8)", Number(slowA1 > defaultA1), 1);

// k changes wavefront speed: higher k → wavefront reaches s=300 sooner
// E(300, t) = clamp(omega*t - abs(k*300), 0, 1)
// Default k=0.018: E(300,t=1) = clamp(6.28 - 5.4, 0, 1) = clamp(0.88, 0, 1) = 0.88
//   (wavefront arrived but hasn't fully saturated yet — E reaches 1 at t≈1.02)
// High k=0.05:    E(300,t=1) = clamp(6.28 - 15, 0, 1) = 0  (wavefront not there yet)
const highK = { ...waveVars, k: 0.05 };
const eDefault = ev.evaluate("E(s, t)", 0, 1.0, 300, waveVars);
const eHighK   = ev.evaluate("E(s, t)", 0, 1.0, 300, highK);
assert("default k: E(300,t=1) = 0.88 (partial arrival)", eDefault, 0.88, 1e-6);
assert("high k=0.05: E(300,t=1) = 0 (wavefront not reached)", eHighK, 0);

// vars override same-named entry in params block
const evWithParam = buildEvaluator({ myConst: 10 }, {});
assert("param gives 10", evWithParam.evaluate("myConst", 0, 0), 10);
assert("var overrides param", evWithParam.evaluate("myConst", 0, 0, undefined, { myConst: 99 }), 99);

// defaultVarValues helper
console.log("\n--- defaultVarValues ---");
import { defaultVarValues } from "./player.js";
const dv = defaultVarValues({
  x: { default: 1, min: 0, max: 10 },
  y: { default: 5.5, min: 0, max: 10 },
});
assert("defaultVarValues: x=1", dv["x"]!, 1);
assert("defaultVarValues: y=5.5", dv["y"]!, 5.5);
assert("defaultVarValues: key count", Object.keys(dv).length, 2);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
