/**
 * Tests for render.ts
 * Run with: npx tsx src/render.test.ts
 *
 * Strategy:
 *   - toCanvas and isActive are pure functions — fully tested
 *   - generateSamples is pure (canvas-free) — tested with known wave values
 *   - renderFrame uses a mock canvas context that records calls
 */

import { toCanvas, isActive, generateSamples, prepareScene, renderFrame } from "./render.js";
import type { AnimSpec, Meta } from "./types.js";
import type { PreparedScene, PreparedParametricPath } from "./render.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertClose(label: string, actual: number, expected: number, tol = 0.01) {
  const ok = Math.abs(actual - expected) < tol;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed++;
  }
}

function assertRange(label: string, actual: number, lo: number, hi: number) {
  const ok = actual >= lo && actual <= hi;
  if (ok) { console.log(`  ✓ ${label} (${actual.toFixed(3)} in [${lo}, ${hi}])`); passed++; }
  else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected [${lo}, ${hi}], got ${actual}`);
    failed++;
  }
}

// ─── Mock canvas context ──────────────────────────────────────────────────────

interface DrawCall {
  method: string;
  args: unknown[];
}

function makeMockCtx() {
  const calls: DrawCall[] = [];
  let fillStyle = "";
  let strokeStyle = "";
  let lineWidth = 0;

  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v: string) { strokeStyle = v; },
    get lineWidth() { return lineWidth; },
    set lineWidth(v: number) { lineWidth = v; },

    fillRect(...args: unknown[]) { calls.push({ method: "fillRect", args }); },
    beginPath() { calls.push({ method: "beginPath", args: [] }); },
    moveTo(...args: unknown[]) { calls.push({ method: "moveTo", args }); },
    lineTo(...args: unknown[]) { calls.push({ method: "lineTo", args }); },
    stroke() { calls.push({ method: "stroke", args: [] }); },
    fill() { calls.push({ method: "fill", args: [] }); },

    _calls: calls,
    _countMethod(name: string) { return calls.filter(c => c.method === name).length; },
    _clearCalls() { calls.length = 0; },
  };

  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const centerMeta: Meta = {
  title: "Test",
  duration: 3,
  width: 1000,
  height: 600,
  fps: 60,
  coordinate_system: "cartesian",
  origin: "center",
};

const topLeftMeta: Meta = { ...centerMeta, origin: "top-left" };

// Default variable values matching the dampened-wave spec
const waveVars = { amplitude: 80, decay: 1.8, k: 0.018, omega: 6.28 };

const waveSpec: AnimSpec = {
  spec: "animspec/0.1",
  meta: centerMeta,
  variables: {
    amplitude: { label: "Amplitude",        default: 80,   min: 10,  max: 200, step: 1 },
    decay:     { label: "Decay rate",        default: 1.8,  min: 0.1, max: 6,   step: 0.05 },
    k:         { label: "Wave number",       default: 0.018,min: 0.005,max: 0.08,step: 0.001 },
    omega:     { label: "Angular frequency", default: 6.28, min: 1,   max: 20,  step: 0.1 },
  },
  scene: {
    id: "root",
    objects: [
      {
        id: "wave",
        type: "parametric_path",
        style: { stroke: "#44aaff", stroke_width: 2.5, fill: "none" },
        domain: { s: [-500, 500], samples: 800 },
        equations: { x: "s", y: "A(t) * E(s, t) * sin(k * s - omega * t)" },
        // No params block — k, omega, amplitude, decay all come through vars
        functions: {
          A: { args: ["t"], body: "amplitude * exp(-decay * t)" },
          E: { args: ["s", "t"], body: "clamp(omega * t - abs(k * s), 0, 1)" },
        },
        timeline: { start: 0.0, end: 1.0 },
      },
      {
        id: "baseline",
        type: "line",
        style: { stroke: "#ffffff22", stroke_width: 1 },
        equations: { x1: "-500", y1: "0", x2: "500", y2: "0" },
        timeline: { start: 0.0, end: 1.0 },
      },
    ],
  },
};

// ─── toCanvas ─────────────────────────────────────────────────────────────────

console.log("\n--- toCanvas: origin=center ---");
{
  // Center of spec space → center of canvas
  const [cx, cy] = toCanvas(0, 0, centerMeta);
  assertClose("spec (0,0) → canvas center X", cx, 500);
  assertClose("spec (0,0) → canvas center Y", cy, 300);

  // y-up in spec → y-down on canvas
  const [, cyUp] = toCanvas(0, 100, centerMeta);
  assertClose("spec y=+100 is above canvas center (canvas_y < 300)", cyUp, 200);

  const [, cyDown] = toCanvas(0, -100, centerMeta);
  assertClose("spec y=-100 is below canvas center (canvas_y > 300)", cyDown, 400);

  // x maps directly
  const [cxRight] = toCanvas(200, 0, centerMeta);
  assertClose("spec x=+200 → canvas x=700", cxRight, 700);

  const [cxLeft] = toCanvas(-200, 0, centerMeta);
  assertClose("spec x=-200 → canvas x=300", cxLeft, 300);

  // Extreme corners
  const [cxEdge, cyEdge] = toCanvas(500, 300, centerMeta);
  assertClose("spec (500,300) → canvas (1000,0) — top-right corner", cxEdge, 1000);
  assertClose("spec (500,300) → canvas (1000,0) — top-right corner y", cyEdge, 0);

  const [cxBL, cyBL] = toCanvas(-500, -300, centerMeta);
  assertClose("spec (-500,-300) → canvas (0,600) — bottom-left corner", cxBL, 0);
  assertClose("spec (-500,-300) → canvas (0,600) — bottom-left corner y", cyBL, 600);
}

console.log("\n--- toCanvas: origin=top-left ---");
{
  const [cx, cy] = toCanvas(0, 0, topLeftMeta);
  assertClose("top-left: spec (0,0) → canvas (0,0)", cx, 0);
  assertClose("top-left: spec (0,0) → canvas (0,0) y", cy, 0);

  const [cx2, cy2] = toCanvas(100, 200, topLeftMeta);
  assertClose("top-left: spec (100,200) → canvas (100,200)", cx2, 100);
  assertClose("top-left: spec (100,200) → canvas (100,200) y", cy2, 200);

  // No y-flip for top-left
  const [, cyPos] = toCanvas(0, 50, topLeftMeta);
  const [, cyNeg] = toCanvas(0, -50, topLeftMeta);
  assert("top-left: no y-flip (y=50 → 50, not 550)", cyPos, 50);
  assert("top-left: no y-flip (y=-50 → -50, not 650)", cyNeg, -50);
}

// ─── isActive ─────────────────────────────────────────────────────────────────

console.log("\n--- isActive: basic ---");
{
  const tl = { start: 0.2, end: 0.8 };

  assert("tNorm at start is active",       isActive(tl, 0.2),  true);
  assert("tNorm at end is active",         isActive(tl, 0.8),  true);
  assert("tNorm in the middle is active",  isActive(tl, 0.5),  true);
  assert("tNorm before start is inactive", isActive(tl, 0.19), false);
  assert("tNorm after end is inactive",    isActive(tl, 0.81), false);
  assert("tNorm=0 with start=0 is active", isActive({ start: 0, end: 1 }, 0), true);
  assert("tNorm=1 with end=1 is active",   isActive({ start: 0, end: 1 }, 1), true);

  // Zero-duration objects (flash on a single frame)
  assert("zero-duration: exact hit",  isActive({ start: 0.5, end: 0.5 }, 0.5),   true);
  assert("zero-duration: clear miss", isActive({ start: 0.5, end: 0.5 }, 0.499), false);
}

console.log("\n--- isActive: float safety ---");
{
  // Simulate common float drift: t accumulated by dt = 1/fps/duration
  // 60fps, 3s → tNorm increments by 1/180 ≈ 0.005555...
  // After 180 increments the value is rarely exactly 1.0
  const almostOne = 1 - 1e-10;
  assert("tNorm=1-1e-10 still hits end=1.0 (epsilon saves it)",
    isActive({ start: 0, end: 1 }, almostOne), true);

  const almostZero = 0 + 1e-10;
  assert("tNorm=0+1e-10 still hits start=0.0",
    isActive({ start: 0, end: 1 }, almostZero), true);

  // But a value a full frame away (>> epsilon) should correctly miss
  const clearlyBefore = 0.5 - 0.001;
  assert("tNorm clearly before start is inactive",
    isActive({ start: 0.5, end: 1 }, clearlyBefore), false);

  // Epsilon does not swallow legitimate gaps between adjacent objects
  // Object A ends at 0.5, object B starts at 0.5 — no overlap desired
  const midPoint = 0.5;
  assert("tNorm=0.5 active in [0, 0.5]",     isActive({ start: 0, end: 0.5 }, midPoint), true);
  assert("tNorm=0.5 active in [0.5, 1]",     isActive({ start: 0.5, end: 1 }, midPoint), true);
  // A value just past the boundary (more than eps away) should miss
  const justPast = 0.5 + 1e-6;
  assert("tNorm=0.5+1e-6 misses [0, 0.5]",   isActive({ start: 0, end: 0.5 }, justPast), false);
}

// ─── generateSamples ──────────────────────────────────────────────────────────

console.log("\n--- generateSamples: sample count and domain coverage ---");
{
  const prepared = prepareScene(waveSpec);
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;

  // Correct number of samples
  const samples = generateSamples(wavePrepared, centerMeta, 1.0, waveVars);
  assert("generates exactly 800 samples", samples.length, 800);

  // First sample: s=-500, x=-500, canvas_x=0
  const [fx, ] = samples[0]!;
  assertClose("first sample canvas_x = 0 (s=-500 → spec_x=-500 → 500+(-500))", fx, 0);

  // Last sample: s=500, x=500, canvas_x=1000
  const [lx, ] = samples[799]!;
  assertClose("last sample canvas_x = 1000 (s=500 → spec_x=500 → 500+500)", lx, 1000);

  // Middle sample: s=0, canvas_x=500
  const [mx, ] = samples[399]!; // ~middle
  assertClose("middle sample canvas_x ≈ 500 (s≈0)", mx, 500, 2);
}

console.log("\n--- generateSamples: y values at key time points ---");
{
  const prepared = prepareScene(waveSpec);
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;

  // At t=0: E=0 everywhere → y=0 everywhere → canvas_y = height/2 = 300
  const samplesT0 = generateSamples(wavePrepared, centerMeta, 0, waveVars);
  const allAtBaseline = samplesT0.every(([, cy]) => Math.abs(cy - 300) < 0.001);
  assert("at t=0, all y values are at baseline (wave hasn't started)", allAtBaseline, true);

  // At t=1.5, s≈0: sin(-3pi) ≈ 0, so center stays near baseline
  const samplesT15 = generateSamples(wavePrepared, centerMeta, 1.5, waveVars);
  const centerSample = samplesT15[399]!;
  assertRange("at t=1.5 s≈0, canvas_y ≈ baseline (sin(-3pi)≈0)", centerSample[1], 295, 305);

  // At t=0.25, s=0: A=80*exp(-0.45)≈50.5, E=1, sin(-pi/2)=-1 → y≈-50.5 → canvas_y≈350.5
  const samplesT025 = generateSamples(wavePrepared, centerMeta, 0.25, waveVars);
  const centerT025 = samplesT025[399]!;
  const A025 = 80 * Math.exp(-1.8 * 0.25);
  const expectedSpecY = A025 * 1 * Math.sin(-6.28 * 0.25);
  const expectedCanvasY = 300 - expectedSpecY;
  assertClose("at t=0.25 s≈0, canvas_y matches A(t)*sin(-pi/2)", centerT025[1], expectedCanvasY, 0.5);

  // Wavefront: t=1.0, s=500 → E=clamp(6.28-9,0,1)=0 → silent
  const samplesT10 = generateSamples(wavePrepared, centerMeta, 1.0, waveVars);
  const rightEdge = samplesT10[799]!;
  assertRange("at t=1.0, s=500 wavefront not reached → canvas_y ≈ 300", rightEdge[1], 299, 301);

  const leftEdge = samplesT10[0]!;
  assertRange("at t=1.0, s=-500 also silent → canvas_y ≈ 300", leftEdge[1], 299, 301);
}

// ─── renderFrame: mock canvas call verification ───────────────────────────────

console.log("\n--- renderFrame: draw call structure ---");
{
  const prepared = prepareScene(waveSpec);
  const ctx = makeMockCtx();

  // Render at t=1.0 (both objects active)
  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 1.0, "#0a0a0f", waveVars);

  // Should have cleared with a fillRect
  assert("renderFrame calls fillRect (clear)", ctx._countMethod("fillRect") >= 1, true);

  // Should have called beginPath for each object
  // wave (parametric_path) = 1 beginPath
  // baseline (line) = 1 beginPath
  assert("renderFrame calls beginPath twice (one per object)", ctx._countMethod("beginPath"), 2);

  // parametric_path: 1 moveTo + 799 lineTo = 800 total points
  assert("wave has 1 moveTo", ctx._countMethod("moveTo"), 2); // 1 for wave + 1 for baseline
  assert("wave has 799 lineTo (800 samples - 1 moveTo)", ctx._countMethod("lineTo"), 800); // 799 for wave + 1 for baseline

  // Both objects should call stroke
  assert("renderFrame calls stroke twice", ctx._countMethod("stroke"), 2);
}

console.log("\n--- renderFrame: timeline filtering ---");
{
  // Build a spec where the wave only runs from t=1 to t=2
  // Wave active from 1s–2s on a 3s animation → normalised 1/3–2/3
  const timedSpec: AnimSpec = {
    ...waveSpec,
    scene: {
      id: "root",
      objects: [
        { ...waveSpec.scene.objects[0]!, timeline: { start: 1 / 3, end: 2 / 3 } },
        { ...waveSpec.scene.objects[1]!, timeline: { start: 0.0,   end: 1.0   } },
      ],
    },
  };

  const prepared = prepareScene(timedSpec);
  const ctx = makeMockCtx();

  // At t=0.5: only baseline should render
  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 0.5, "#0a0a0f", waveVars);
  assert("at t=0.5 (wave inactive): only 1 beginPath (baseline)", ctx._countMethod("beginPath"), 1);
  assert("at t=0.5: only 1 stroke (baseline)", ctx._countMethod("stroke"), 1);

  ctx._clearCalls();

  // At t=1.5: both should render
  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 1.5, "#0a0a0f", waveVars);
  assert("at t=1.5 (both active): 2 beginPaths", ctx._countMethod("beginPath"), 2);
  assert("at t=1.5: 2 strokes", ctx._countMethod("stroke"), 2);

  ctx._clearCalls();

  // At t=2.5: only baseline should render
  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 2.5, "#0a0a0f", waveVars);
  assert("at t=2.5 (wave inactive again): 1 beginPath", ctx._countMethod("beginPath"), 1);
  assert("at t=2.5: 1 stroke", ctx._countMethod("stroke"), 1);
}

console.log("\n--- renderFrame: style application ---");
{
  const prepared = prepareScene(waveSpec);
  const ctx = makeMockCtx();

  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 1.0, "#0a0a0f", waveVars);

  // After render, strokeStyle should be the last object's stroke color
  // (baseline is last, stroke="#ffffff22")
  assert("last strokeStyle is baseline color", ctx.strokeStyle, "#ffffff22");
  assert("last lineWidth is baseline width", ctx.lineWidth, 1);
}

// ─── prepareScene: structure validation ───────────────────────────────────────

console.log("\n--- prepareScene ---");
{
  const prepared = prepareScene(waveSpec);

  assert("prepared has 2 objects", prepared.objects.length, 2);
  assert("first object is parametric_path", prepared.objects[0]!.kind, "parametric_path");
  assert("second object is line", prepared.objects[1]!.kind, "line");
  assert("meta is preserved", prepared.meta.width, 1000);

  // Compiled expressions exist
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;
  assert("compiledX exists", typeof wavePrepared.compiledX.evaluate, "function");
  assert("compiledY exists", typeof wavePrepared.compiledY.evaluate, "function");
}

// ─── generateSamples: variable override changes output ────────────────────────

console.log("\n--- generateSamples: variable effects ---");
{
  const prepared = prepareScene(waveSpec);
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;

  // amplitude=0 → all y values should be at baseline (canvas_y=300)
  const zeroAmpVars = { ...waveVars, amplitude: 0 };
  const samplesZeroAmp = generateSamples(wavePrepared, centerMeta, 0.25, zeroAmpVars);
  const allAtZero = samplesZeroAmp.every(([, cy]) => Math.abs(cy - 300) < 0.001);
  assert("amplitude=0: all canvas_y at baseline", allAtZero, true);

  // amplitude=200 → displacement at t=0.25 s=0 should be 2.5× default
  const highAmpVars = { ...waveVars, amplitude: 200 };
  const defaultCenter = generateSamples(wavePrepared, centerMeta, 0.25, waveVars)[399]!;
  const highAmpCenter = generateSamples(wavePrepared, centerMeta, 0.25, highAmpVars)[399]!;
  const defaultDisp = Math.abs(defaultCenter[1] - 300);
  const highDisp = Math.abs(highAmpCenter[1] - 300);
  assertClose("amplitude=200 gives 2.5× displacement", highDisp / defaultDisp, 2.5, 0.05);

  // omega=12.56 (2× default) → wavefront reaches s=300 twice as fast
  // At t=0.5: default omega: E(300,0.5)=clamp(6.28*0.5 - 5.4,0,1)=clamp(-2.26,0,1)=0
  //           2× omega:      E(300,0.5)=clamp(12.56*0.5 - 5.4,0,1)=clamp(0.88,0,1)=0.88
  // So with double omega, s=300 is partially active at t=0.5
  const doubleOmega = { ...waveVars, omega: 12.56 };
  // At t=0.5, s=300 with default omega: wavefront hasn't arrived → y=0 → canvas_y=300
  const defaultS300 = generateSamples(wavePrepared, centerMeta, 0.5, waveVars);
  // s=300 is at index (300+500)/1000*(800-1) ≈ 639
  const idx300 = Math.round((300 + 500) / 1000 * 799);
  assertRange("default omega: s=300 silent at t=0.5 (canvas_y≈300)", defaultS300[idx300]![1], 299, 301);

  const doubleS300 = generateSamples(wavePrepared, centerMeta, 0.5, doubleOmega);
  // With 2× omega wavefront reaches s=300 — canvas_y should deviate from 300
  const deviation = Math.abs(doubleS300[idx300]![1] - 300);
  assert("double omega: s=300 is active at t=0.5 (non-zero displacement)", deviation > 1, true);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
