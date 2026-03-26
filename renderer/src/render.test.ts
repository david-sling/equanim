/**
 * Tests for render.ts
 * Run with: npx tsx src/render.test.ts
 *
 * Strategy:
 *   - toCanvas and isActive are pure functions — fully tested
 *   - computeLocalT is a pure function — fully tested
 *   - generateSamples is pure (canvas-free) — tested with known wave values
 *   - renderFrame uses a mock canvas context that records calls
 */

import {
  toCanvas,
  isActive,
  computeLocalT,
  computeLocalD,
  generateSamples,
  prepareScene,
  renderFrame,
} from "./render.js";
import type {
  Equanim,
  Meta,
  ParametricPath,
  SceneNode,
  Timeline,
} from "./types.js";
import type {
  PreparedScene,
  PreparedParametricPath,
  PreparedCircle,
} from "./render.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertClose(
  label: string,
  actual: number,
  expected: number,
  tol = 0.01,
) {
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
    console.log(`  ✓ ${label} (${actual.toFixed(3)} in [${lo}, ${hi}])`);
    passed++;
  } else {
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
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(v: number) {
      lineWidth = v;
    },

    fillRect(...args: unknown[]) {
      calls.push({ method: "fillRect", args });
    },
    beginPath() {
      calls.push({ method: "beginPath", args: [] });
    },
    moveTo(...args: unknown[]) {
      calls.push({ method: "moveTo", args });
    },
    lineTo(...args: unknown[]) {
      calls.push({ method: "lineTo", args });
    },
    stroke() {
      calls.push({ method: "stroke", args: [] });
    },
    fill() {
      calls.push({ method: "fill", args: [] });
    },
    arc(...args: unknown[]) {
      calls.push({ method: "arc", args });
    },

    _calls: calls,
    _countMethod(name: string) {
      return calls.filter((c) => c.method === name).length;
    },
    _clearCalls() {
      calls.length = 0;
    },
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

// Wave spec uses t (local 0→1) so that timeline start/end directly controls
// the wave's speed and behaviour — shrinking the window speeds up the animation.
const waveSpec: Equanim = {
  spec: "equanim/0.1",
  meta: centerMeta,
  variables: {
    amplitude: { label: "Amplitude", default: 80, min: 10, max: 200, step: 1 },
    decay: { label: "Decay rate", default: 1.8, min: 0.1, max: 6, step: 0.05 },
    k: {
      label: "Wave number",
      default: 0.018,
      min: 0.005,
      max: 0.08,
      step: 0.001,
    },
    omega: {
      label: "Angular frequency",
      default: 6.28,
      min: 1,
      max: 20,
      step: 0.1,
    },
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
  assertClose(
    "spec y=-100 is below canvas center (canvas_y > 300)",
    cyDown,
    400,
  );

  // x maps directly
  const [cxRight] = toCanvas(200, 0, centerMeta);
  assertClose("spec x=+200 → canvas x=700", cxRight, 700);

  const [cxLeft] = toCanvas(-200, 0, centerMeta);
  assertClose("spec x=-200 → canvas x=300", cxLeft, 300);

  // Extreme corners
  const [cxEdge, cyEdge] = toCanvas(500, 300, centerMeta);
  assertClose(
    "spec (500,300) → canvas (1000,0) — top-right corner",
    cxEdge,
    1000,
  );
  assertClose(
    "spec (500,300) → canvas (1000,0) — top-right corner y",
    cyEdge,
    0,
  );

  const [cxBL, cyBL] = toCanvas(-500, -300, centerMeta);
  assertClose(
    "spec (-500,-300) → canvas (0,600) — bottom-left corner",
    cxBL,
    0,
  );
  assertClose(
    "spec (-500,-300) → canvas (0,600) — bottom-left corner y",
    cyBL,
    600,
  );
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

  assert("tNorm at start is active", isActive(tl, 0.2), true);
  assert("tNorm at end is active", isActive(tl, 0.8), true);
  assert("tNorm in the middle is active", isActive(tl, 0.5), true);
  assert("tNorm before start is inactive", isActive(tl, 0.19), false);
  assert("tNorm after end is inactive", isActive(tl, 0.81), false);
  assert(
    "tNorm=0 with start=0 is active",
    isActive({ start: 0, end: 1 }, 0),
    true,
  );
  assert(
    "tNorm=1 with end=1 is active",
    isActive({ start: 0, end: 1 }, 1),
    true,
  );

  // Zero-duration objects (flash on a single frame)
  assert(
    "zero-duration: exact hit",
    isActive({ start: 0.5, end: 0.5 }, 0.5),
    true,
  );
  assert(
    "zero-duration: clear miss",
    isActive({ start: 0.5, end: 0.5 }, 0.499),
    false,
  );
}

console.log("\n--- isActive: float safety ---");
{
  // Simulate common float drift: t accumulated by dt = 1/fps/duration
  // 60fps, 3s → tNorm increments by 1/180 ≈ 0.005555...
  // After 180 increments the value is rarely exactly 1.0
  const almostOne = 1 - 1e-10;
  assert(
    "tNorm=1-1e-10 still hits end=1.0 (epsilon saves it)",
    isActive({ start: 0, end: 1 }, almostOne),
    true,
  );

  const almostZero = 0 + 1e-10;
  assert(
    "tNorm=0+1e-10 still hits start=0.0",
    isActive({ start: 0, end: 1 }, almostZero),
    true,
  );

  // But a value a full frame away (>> epsilon) should correctly miss
  const clearlyBefore = 0.5 - 0.001;
  assert(
    "tNorm clearly before start is inactive",
    isActive({ start: 0.5, end: 1 }, clearlyBefore),
    false,
  );

  // Epsilon does not swallow legitimate gaps between adjacent objects
  // Object A ends at 0.5, object B starts at 0.5 — no overlap desired
  const midPoint = 0.5;
  assert(
    "tNorm=0.5 active in [0, 0.5]",
    isActive({ start: 0, end: 0.5 }, midPoint),
    true,
  );
  assert(
    "tNorm=0.5 active in [0.5, 1]",
    isActive({ start: 0.5, end: 1 }, midPoint),
    true,
  );
  // A value just past the boundary (more than eps away) should miss
  const justPast = 0.5 + 1e-6;
  assert(
    "tNorm=0.5+1e-6 misses [0, 0.5]",
    isActive({ start: 0, end: 0.5 }, justPast),
    false,
  );
}

// ─── computeLocalT ────────────────────────────────────────────────────────────

console.log("\n--- computeLocalT: basic ---");
{
  const duration = 4.0;

  // Full-span object: start=0 end=1 on a 4s animation
  // t_local = T / 4
  const full = { start: 0, end: 1 };
  assertClose("full span: T=0 → t=0", computeLocalT(0, full, duration), 0);
  assertClose("full span: T=2 → t=0.5", computeLocalT(2, full, duration), 0.5);
  assertClose("full span: T=4 → t=1", computeLocalT(4, full, duration), 1);

  // Half-span object: start=0.5 end=1 (seconds 2–4 on a 4s animation)
  // tStart=2, tEnd=4: t_local = (T-2)/(4-2)
  const half = { start: 0.5, end: 1 };
  assertClose(
    "half span: T=2 → t=0 (object enters)",
    computeLocalT(2, half, duration),
    0,
  );
  assertClose(
    "half span: T=3 → t=0.5 (halfway)",
    computeLocalT(3, half, duration),
    0.5,
  );
  assertClose(
    "half span: T=4 → t=1 (object exits)",
    computeLocalT(4, half, duration),
    1,
  );

  // Middle quarter: start=0.25 end=0.75 (seconds 1–3 on a 4s animation)
  const mid = { start: 0.25, end: 0.75 };
  assertClose("mid quarter: T=1 → t=0", computeLocalT(1, mid, duration), 0);
  assertClose("mid quarter: T=2 → t=0.5", computeLocalT(2, mid, duration), 0.5);
  assertClose("mid quarter: T=3 → t=1", computeLocalT(3, mid, duration), 1);

  // Out-of-window values are clamped
  assertClose(
    "clamped below: T < tStart → t=0",
    computeLocalT(-1, full, duration),
    0,
  );
  assertClose(
    "clamped above: T > tEnd  → t=1",
    computeLocalT(99, full, duration),
    1,
  );
}

console.log("\n--- computeLocalT: zero-duration objects ---");
{
  // start===end → always return 0 (not NaN)
  assertClose(
    "zero-duration: returns 0 not NaN",
    computeLocalT(2, { start: 0.5, end: 0.5 }, 4),
    0,
  );
  assertClose(
    "zero-duration at start: T=0 → 0",
    computeLocalT(0, { start: 0, end: 0 }, 4),
    0,
  );
}

// ─── computeLocalD ────────────────────────────────────────────────────────────

console.log("\n--- computeLocalD: basic ---");
{
  const duration = 4.0;

  // Full-span object: (1 - 0) * 4 = 4s
  assertClose(
    "full span: d = 4s",
    computeLocalD({ start: 0, end: 1 }, duration),
    4,
  );

  // Half-span object: (1 - 0.5) * 4 = 2s
  assertClose(
    "half span (0.5–1): d = 2s",
    computeLocalD({ start: 0.5, end: 1 }, duration),
    2,
  );

  // Quarter span: (0.75 - 0.25) * 4 = 2s
  assertClose(
    "quarter span (0.25–0.75): d = 2s",
    computeLocalD({ start: 0.25, end: 0.75 }, duration),
    2,
  );

  // First third: (0.33 - 0) * 3 ≈ 0.99s
  assertClose(
    "first third on 3s animation",
    computeLocalD({ start: 0, end: 1 / 3 }, 3),
    1,
    0.01,
  );

  // Zero-duration object: d = 0
  assertClose(
    "zero-duration: d = 0",
    computeLocalD({ start: 0.5, end: 0.5 }, duration),
    0,
  );

  // d is independent of T (it's a constant per object)
  const tl = { start: 0.25, end: 0.75 };
  assertClose(
    "d is same at T=0 and T=2 (it's constant)",
    computeLocalD(tl, duration),
    2,
  );
}

console.log("\n--- computeLocalD: t * d = seconds elapsed ---");
{
  // For an object spanning seconds 1–3 on a 4s animation (start=0.25, end=0.75, d=2):
  //   at T=1 (t=0): t*d = 0*2 = 0s elapsed since object started ✓
  //   at T=2 (t=0.5): t*d = 0.5*2 = 1s elapsed ✓
  //   at T=3 (t=1): t*d = 1*2 = 2s elapsed ✓
  const tl = { start: 0.25, end: 0.75 };
  const dur = 4.0;
  const d = computeLocalD(tl, dur);

  assertClose("T=1 → t=0, t*d=0s", computeLocalT(1, tl, dur) * d, 0);
  assertClose("T=2 → t=0.5, t*d=1s", computeLocalT(2, tl, dur) * d, 1);
  assertClose("T=3 → t=1, t*d=2s", computeLocalT(3, tl, dur) * d, 2);
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
  const [fx] = samples[0]!;
  assertClose(
    "first sample canvas_x = 0 (s=-500 → spec_x=-500 → 500+(-500))",
    fx,
    0,
  );

  // Last sample: s=500, x=500, canvas_x=1000
  const [lx] = samples[799]!;
  assertClose(
    "last sample canvas_x = 1000 (s=500 → spec_x=500 → 500+500)",
    lx,
    1000,
  );

  // Middle sample: s=0, canvas_x=500
  const [mx] = samples[399]!; // ~middle
  assertClose("middle sample canvas_x ≈ 500 (s≈0)", mx, 500, 2);
}

console.log("\n--- generateSamples: y values at key time points ---");
{
  // Wave spans {start:0, end:1} on a 3s animation → t_local = T / 3.
  // Tests are written in terms of the local t value they target;
  // T = t_local * duration (3) is passed to generateSamples.

  const prepared = prepareScene(waveSpec);
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;

  // t=0 (T=0): E=0 everywhere → y=0 → canvas_y = height/2 = 300
  const samplesT0 = generateSamples(wavePrepared, centerMeta, 0, waveVars);
  const allAtBaseline = samplesT0.every(([, cy]) => Math.abs(cy - 300) < 0.001);
  assert(
    "at t=0, all y values are at baseline (wave entry)",
    allAtBaseline,
    true,
  );

  // t=0.5 (T=1.5), s≈0: sin(-omega*0.5) = sin(-pi) ≈ 0 → center near baseline
  const samplesT15 = generateSamples(wavePrepared, centerMeta, 1.5, waveVars);
  const centerSample = samplesT15[399]!;
  assertRange(
    "at t=0.5 (T=1.5), s≈0, canvas_y ≈ baseline (sin(-pi)≈0)",
    centerSample[1],
    295,
    305,
  );

  // t=0.25 (T=0.75), s=0: A=80*exp(-0.45)≈50.5, E=1, sin(-pi/2)=-1 → y≈-50.5 → canvas_y≈350.5
  const samplesT025 = generateSamples(wavePrepared, centerMeta, 0.75, waveVars); // T = 0.25*3
  const centerT025 = samplesT025[399]!;
  const A025 = 80 * Math.exp(-1.8 * 0.25);
  const expectedSpecY = A025 * 1 * Math.sin(-6.28 * 0.25);
  const expectedCanvasY = 300 - expectedSpecY;
  assertClose(
    "at t=0.25 (T=0.75), s≈0, canvas_y matches A(t)*sin(-pi/2)",
    centerT025[1],
    expectedCanvasY,
    0.5,
  );

  // t=1/3 (T=1.0), s=500: E=clamp(6.28*(1/3) - 9, 0,1) = clamp(-6.91,0,1) = 0 → silent
  const samplesT10 = generateSamples(wavePrepared, centerMeta, 1.0, waveVars);
  const rightEdge = samplesT10[799]!;
  assertRange(
    "at t≈0.33 (T=1.0), s=500 wavefront not reached → canvas_y ≈ 300",
    rightEdge[1],
    299,
    301,
  );

  const leftEdge = samplesT10[0]!;
  assertRange(
    "at t≈0.33 (T=1.0), s=-500 also silent → canvas_y ≈ 300",
    leftEdge[1],
    299,
    301,
  );
}

// ─── generateSamples: local t is computed correctly ───────────────────────────

console.log("\n--- generateSamples: local t computation ---");
{
  // Build a spec with an object that uses local t directly (opacity = t fade)
  // to verify that t is correctly computed as (T - tStart) / (tEnd - tStart).
  const fadeSpec: Equanim = {
    spec: "equanim/0.1",
    meta: { ...centerMeta, duration: 4.0 },
    scene: {
      id: "root",
      objects: [
        {
          id: "fade",
          type: "parametric_path",
          style: { stroke: "#fff", stroke_width: 1, fill: "none" },
          // x = t*100 (local 0→1 → tracks position across left half of canvas)
          // y = 0 (static)
          domain: { s: [0, 1], samples: 2 }, // only need 2 samples
          equations: { x: "t * 100", y: "0" },
          // Object spans seconds 1–3 on a 4s animation: start=0.25, end=0.75
          timeline: { start: 0.25, end: 0.75 },
        },
      ],
    },
  };
  const fadeMeta = fadeSpec.meta;
  const fadePrepared = prepareScene(fadeSpec);
  const fadePath = fadePrepared.objects[0] as PreparedParametricPath;

  // At T=1 (object enters): t_local = (1 - 1) / (3 - 1) = 0 → x = 0 → canvas_x = 500
  const atEntry = generateSamples(fadePath, fadeMeta, 1.0);
  assertClose(
    "fade entry (T=1, t=0): x = 0 → canvas_x = 500",
    atEntry[0]![0],
    500,
    0.5,
  );

  // At T=2 (midpoint): t_local = (2 - 1) / (3 - 1) = 0.5 → x = 50 → canvas_x = 550
  const atMid = generateSamples(fadePath, fadeMeta, 2.0);
  assertClose(
    "fade mid (T=2, t=0.5): x = 50 → canvas_x = 550",
    atMid[0]![0],
    550,
    0.5,
  );

  // At T=3 (object exits): t_local = (3 - 1) / (3 - 1) = 1 → x = 100 → canvas_x = 600
  const atExit = generateSamples(fadePath, fadeMeta, 3.0);
  assertClose(
    "fade exit (T=3, t=1): x = 100 → canvas_x = 600",
    atExit[0]![0],
    600,
    0.5,
  );
}

// ─── generateSamples: root_t and d injected correctly ─────────────────────────

console.log("\n--- generateSamples: root_t injection ---");
{
  // root_t = T / meta.duration (global 0→1 regardless of object's window).
  // Build a spec where x = root_t * 1000 (sweeps full canvas width as the
  // animation progresses). The object has a narrow window (middle half only)
  // but root_t should still reflect global progress, not local.
  const rootTSpec: Equanim = {
    spec: "equanim/0.1",
    meta: { ...centerMeta, duration: 4.0 },
    scene: {
      id: "root",
      objects: [
        {
          id: "globaltrace",
          type: "parametric_path",
          style: { stroke: "#fff", stroke_width: 1, fill: "none" },
          domain: { s: [0, 1], samples: 2 },
          // x = root_t * 1000 → canvas_x = 500 + root_t*1000 - 500 = root_t*1000
          equations: { x: "root_t * 1000 - 500", y: "0" },
          // Object spans seconds 1–3 on a 4s animation (start=0.25, end=0.75)
          timeline: { start: 0.25, end: 0.75 },
        },
      ],
    },
  };
  const rtMeta = rootTSpec.meta;
  const rtPrep = prepareScene(rootTSpec);
  const rtPath = rtPrep.objects[0] as PreparedParametricPath;

  // At T=1 (root_t=0.25): x = 0.25*1000 - 500 = -250 → canvas_x = 500 + (-250) = 250
  const atT1 = generateSamples(rtPath, rtMeta, 1.0);
  assertClose("root_t=0.25 (T=1/4): canvas_x = 250", atT1[0]![0], 250, 0.5);

  // At T=2 (root_t=0.5): x = 0.5*1000 - 500 = 0 → canvas_x = 500
  const atT2 = generateSamples(rtPath, rtMeta, 2.0);
  assertClose("root_t=0.5 (T=2/4): canvas_x = 500", atT2[0]![0], 500, 0.5);

  // At T=3 (root_t=0.75): x = 0.75*1000 - 500 = 250 → canvas_x = 750
  const atT3 = generateSamples(rtPath, rtMeta, 3.0);
  assertClose("root_t=0.75 (T=3/4): canvas_x = 750", atT3[0]![0], 750, 0.5);
}

console.log("\n--- generateSamples: d injection ---");
{
  // d = (timeline.end - timeline.start) * duration.
  // x = d * 10 exposes it as position; y = 0.
  // Object spans seconds 1–3 on a 4s animation → d = 2.
  // x = d * 10 = 20 → spec_x=20 → canvas_x = 500 + 20 = 520
  const dSpec: Equanim = {
    spec: "equanim/0.1",
    meta: { ...centerMeta, duration: 4.0 },
    scene: {
      id: "root",
      objects: [
        {
          id: "dtrace",
          type: "parametric_path",
          style: { stroke: "#fff", stroke_width: 1, fill: "none" },
          domain: { s: [0, 1], samples: 2 },
          equations: { x: "d * 10", y: "0" },
          timeline: { start: 0.25, end: 0.75 }, // d = 2s
        },
      ],
    },
  };
  const dMeta = dSpec.meta;
  const dPrep = prepareScene(dSpec);
  const dPath = dPrep.objects[0] as PreparedParametricPath;

  // d=2 is constant regardless of T, so x=20 → canvas_x=520 at any active T
  const atEntry = generateSamples(dPath, dMeta, 1.5);
  assertClose(
    "d=2 at T=1.5: canvas_x = 520 (d*10=20 → spec_x=20)",
    atEntry[0]![0],
    520,
    0.5,
  );

  const atMid = generateSamples(dPath, dMeta, 2.0);
  assertClose(
    "d=2 at T=2: canvas_x still 520 (d is constant)",
    atMid[0]![0],
    520,
    0.5,
  );

  // root_d: x = root_d * 5 on a 4s animation → x = 20 → canvas_x = 520
  const rootDSpec: Equanim = {
    ...dSpec,
    scene: {
      id: "root",
      objects: [
        {
          ...(dSpec.scene.objects[0]! as ParametricPath),
          id: "rdtrace",
          equations: { x: "root_d * 5", y: "0" }, // root_d=4 → x=20 → canvas_x=520
          timeline: { start: 0.25, end: 0.75 },
        },
      ],
    },
  };
  const rdPrep = prepareScene(rootDSpec);
  const rdPath = rdPrep.objects[0] as PreparedParametricPath;
  const atRd = generateSamples(rdPath, dMeta, 2.0);
  assertClose("root_d=4 → root_d*5=20 → canvas_x=520", atRd[0]![0], 520, 0.5);
}

// ─── renderFrame: mock canvas call verification ───────────────────────────────

console.log("\n--- renderFrame: draw call structure ---");
{
  const prepared = prepareScene(waveSpec);
  const ctx = makeMockCtx();

  // Render at T=1.0 (both objects active)
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    1.0,
    "#0a0a0f",
    waveVars,
  );

  // Should have cleared with a fillRect
  assert(
    "renderFrame calls fillRect (clear)",
    ctx._countMethod("fillRect") >= 1,
    true,
  );

  // Should have called beginPath for each object
  // wave (parametric_path) = 1 beginPath
  // baseline (line) = 1 beginPath
  assert(
    "renderFrame calls beginPath twice (one per object)",
    ctx._countMethod("beginPath"),
    2,
  );

  // parametric_path: 1 moveTo + 799 lineTo = 800 total points
  assert("wave has 1 moveTo", ctx._countMethod("moveTo"), 2); // 1 for wave + 1 for baseline
  assert(
    "wave has 799 lineTo (800 samples - 1 moveTo)",
    ctx._countMethod("lineTo"),
    800,
  ); // 799 for wave + 1 for baseline

  // Both objects should call stroke
  assert("renderFrame calls stroke twice", ctx._countMethod("stroke"), 2);
}

console.log("\n--- renderFrame: timeline filtering ---");
{
  // Build a spec where the wave only runs from T=1 to T=2
  // Wave active from 1s–2s on a 3s animation → normalised 1/3–2/3
  const timedSpec: Equanim = {
    ...waveSpec,
    scene: {
      id: "root",
      objects: [
        {
          ...waveSpec.scene.objects[0]!,
          timeline: { start: 1 / 3, end: 2 / 3 },
        } as SceneNode,
        {
          ...waveSpec.scene.objects[1]!,
          timeline: { start: 0.0, end: 1.0 },
        } as SceneNode,
      ],
    },
  };

  const prepared = prepareScene(timedSpec);
  const ctx = makeMockCtx();

  // At T=0.5: only baseline should render
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    0.5,
    "#0a0a0f",
    waveVars,
  );
  assert(
    "at T=0.5 (wave inactive): only 1 beginPath (baseline)",
    ctx._countMethod("beginPath"),
    1,
  );
  assert("at T=0.5: only 1 stroke (baseline)", ctx._countMethod("stroke"), 1);

  ctx._clearCalls();

  // At T=1.5: both should render
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    1.5,
    "#0a0a0f",
    waveVars,
  );
  assert(
    "at T=1.5 (both active): 2 beginPaths",
    ctx._countMethod("beginPath"),
    2,
  );
  assert("at T=1.5: 2 strokes", ctx._countMethod("stroke"), 2);

  ctx._clearCalls();

  // At T=2.5: only baseline should render
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    2.5,
    "#0a0a0f",
    waveVars,
  );
  assert(
    "at T=2.5 (wave inactive again): 1 beginPath",
    ctx._countMethod("beginPath"),
    1,
  );
  assert("at T=2.5: 1 stroke", ctx._countMethod("stroke"), 1);
}

console.log("\n--- renderFrame: style application ---");
{
  const prepared = prepareScene(waveSpec);
  const ctx = makeMockCtx();

  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    1.0,
    "#0a0a0f",
    waveVars,
  );

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
  assert(
    "first object is parametric_path",
    prepared.objects[0]!.kind,
    "parametric_path",
  );
  assert("second object is line", prepared.objects[1]!.kind, "line");
  assert("meta is preserved", prepared.meta.width, 1000);

  // Compiled expressions exist
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;
  assert(
    "compiledX exists",
    typeof wavePrepared.compiledX.evaluate,
    "function",
  );
  assert(
    "compiledY exists",
    typeof wavePrepared.compiledY.evaluate,
    "function",
  );
}

// ─── generateSamples: variable override changes output ────────────────────────

console.log("\n--- generateSamples: variable effects ---");
{
  const prepared = prepareScene(waveSpec);
  const wavePrepared = prepared.objects[0] as PreparedParametricPath;

  // amplitude=0 → all y values should be at baseline (canvas_y=300)
  const zeroAmpVars = { ...waveVars, amplitude: 0 };
  // t=0.25 → T=0.75 for this full-span wave
  const samplesZeroAmp = generateSamples(
    wavePrepared,
    centerMeta,
    0.75,
    zeroAmpVars,
  );
  const allAtZero = samplesZeroAmp.every(
    ([, cy]) => Math.abs(cy - 300) < 0.001,
  );
  assert("amplitude=0: all canvas_y at baseline", allAtZero, true);

  // amplitude=200 → displacement at t=0.25 (T=0.75), s=0 should be 2.5× default
  const highAmpVars = { ...waveVars, amplitude: 200 };
  const defaultCenter = generateSamples(
    wavePrepared,
    centerMeta,
    0.75,
    waveVars,
  )[399]!;
  const highAmpCenter = generateSamples(
    wavePrepared,
    centerMeta,
    0.75,
    highAmpVars,
  )[399]!;
  const defaultDisp = Math.abs(defaultCenter[1] - 300);
  const highDisp = Math.abs(highAmpCenter[1] - 300);
  assertClose(
    "amplitude=200 gives 2.5× displacement",
    highDisp / defaultDisp,
    2.5,
    0.05,
  );

  // omega=12.56 (2× default) → wavefront reaches s=300 twice as fast
  // At t=1/6 (T=0.5): default omega: E(300,t=1/6)=clamp(6.28*(1/6)-5.4,0,1)=clamp(-4.35,0,1)=0
  //                   2× omega:      E(300,t=1/6)=clamp(12.56*(1/6)-5.4,0,1)=clamp(-3.31,0,1)=0
  // Use t=0.5 (T=1.5): default: E=clamp(6.28*0.5-5.4,0,1)=clamp(-2.26,0,1)=0
  //                    2× omega: E=clamp(12.56*0.5-5.4,0,1)=clamp(0.88,0,1)=0.88 ← active!
  const doubleOmega = { ...waveVars, omega: 12.56 };
  // At T=1.5 (t=0.5), s=300 with default omega: wavefront hasn't arrived → y=0 → canvas_y=300
  const defaultS300 = generateSamples(wavePrepared, centerMeta, 1.5, waveVars);
  // s=300 is at index (300+500)/1000*(800-1) ≈ 639
  const idx300 = Math.round(((300 + 500) / 1000) * 799);
  assertRange(
    "default omega: s=300 silent at t=0.5 (T=1.5, canvas_y≈300)",
    defaultS300[idx300]![1],
    299,
    301,
  );

  const doubleS300 = generateSamples(
    wavePrepared,
    centerMeta,
    1.5,
    doubleOmega,
  );
  // With 2× omega wavefront reaches s=300 at t=0.5 — canvas_y should deviate from 300
  const deviation = Math.abs(doubleS300[idx300]![1] - 300);
  assert(
    "double omega: s=300 is active at t=0.5 (non-zero displacement)",
    deviation > 1,
    true,
  );
}

// ─── circle: prepareScene ─────────────────────────────────────────────────────

console.log("\n--- circle: prepareScene ---");
{
  const circleSpec: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta,
    scene: {
      id: "root",
      objects: [
        {
          id: "ball",
          type: "circle",
          style: { fill: "#ff6644", stroke: "#ff9977", stroke_width: 2 },
          equations: { cx: "100", cy: "50", r: "30" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };

  const prepared = prepareScene(circleSpec);
  assert("prepared has 1 object", prepared.objects.length, 1);
  assert("kind is circle", prepared.objects[0]!.kind, "circle");

  const cp = prepared.objects[0] as PreparedCircle;
  assert("compiledCx exists", typeof cp.compiledCx.evaluate, "function");
  assert("compiledCy exists", typeof cp.compiledCy.evaluate, "function");
  assert("compiledR exists", typeof cp.compiledR.evaluate, "function");
}

// ─── circle: coordinate transform ─────────────────────────────────────────────

console.log("\n--- circle: coordinate transform ---");
{
  // Circle at spec (100, 50), canvas 1000×600, origin=center:
  //   canvasCx = 500 + 100 = 600
  //   canvasCy = 300 - 50  = 250   (y-flip)
  //   r = 30 (unchanged — it's a magnitude, not a coordinate)
  const circleSpec: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta,
    scene: {
      id: "root",
      objects: [
        {
          id: "ball",
          type: "circle",
          style: { fill: "#ff6644", stroke: "none", stroke_width: 0 },
          equations: { cx: "100", cy: "50", r: "30" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };

  const prepared = prepareScene(circleSpec);
  const ctx = makeMockCtx();

  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    1.0,
    "#000",
  );

  const arcCall = ctx._calls.find((c) => c.method === "arc");
  assert("arc was called", arcCall !== undefined, true);
  assertClose("arc cx (canvas x)", arcCall!.args[0] as number, 600);
  assertClose("arc cy (canvas y, y-flipped)", arcCall!.args[1] as number, 250);
  assertClose("arc r (unchanged)", arcCall!.args[2] as number, 30);
}

// ─── circle: fill and stroke ───────────────────────────────────────────────────

console.log("\n--- circle: fill and stroke ---");
{
  // fill !== "none" → both fill() and stroke() should be called
  const filledSpec: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta,
    scene: {
      id: "root",
      objects: [
        {
          id: "ball",
          type: "circle",
          style: { fill: "#ff6644", stroke: "#fff", stroke_width: 2 },
          equations: { cx: "0", cy: "0", r: "20" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };
  const prepared = prepareScene(filledSpec);
  const ctx = makeMockCtx();
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    0.5,
    "#000",
  );
  assert("filled circle calls fill()", ctx._countMethod("fill"), 1);
  assert("filled circle calls stroke()", ctx._countMethod("stroke"), 1);

  // fill = "none" → only stroke
  ctx._clearCalls();
  const strokeOnlySpec: Equanim = {
    ...filledSpec,
    scene: {
      id: "root",
      objects: [
        {
          ...(filledSpec.scene
            .objects[0]! as (typeof filledSpec.scene.objects)[0] & {
            type: "circle";
          }),
          style: { fill: "none", stroke: "#fff", stroke_width: 1 },
        },
      ],
    },
  };
  const preparedSO = prepareScene(strokeOnlySpec);
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    preparedSO,
    0.5,
    "#000",
  );
  assert("stroke-only circle: fill() not called", ctx._countMethod("fill"), 0);
  assert("stroke-only circle: stroke() called", ctx._countMethod("stroke"), 1);
}

// ─── circle: timeline filtering ───────────────────────────────────────────────

console.log("\n--- circle: timeline filtering ---");
{
  // Circle active only from T=1 to T=2 on a 3s animation
  const timedCircle: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta, // duration=3
    scene: {
      id: "root",
      objects: [
        {
          id: "ball",
          type: "circle",
          style: { fill: "#ff6644", stroke: "none", stroke_width: 0 },
          equations: { cx: "0", cy: "0", r: "20" },
          timeline: { start: 1 / 3, end: 2 / 3 }, // T=1 to T=2
        },
      ],
    },
  };
  const prepared = prepareScene(timedCircle);
  const ctx = makeMockCtx();

  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    0.5,
    "#000",
  );
  assert("circle inactive at T=0.5: no arc", ctx._countMethod("arc"), 0);

  ctx._clearCalls();
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    1.5,
    "#000",
  );
  assert("circle active at T=1.5: arc called", ctx._countMethod("arc"), 1);

  ctx._clearCalls();
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    2.5,
    "#000",
  );
  assert("circle inactive at T=2.5: no arc", ctx._countMethod("arc"), 0);
}

// ─── circle: r uses abs (negative radius is safe) ─────────────────────────────

console.log("\n--- circle: r is abs'd ---");
{
  const negRSpec: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta,
    scene: {
      id: "root",
      objects: [
        {
          id: "ball",
          type: "circle",
          style: { fill: "#ff0", stroke: "none", stroke_width: 0 },
          equations: { cx: "0", cy: "0", r: "-25" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };
  const prepared = prepareScene(negRSpec);
  const ctx = makeMockCtx();
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    0.5,
    "#000",
  );
  const arcCall = ctx._calls.find((c) => c.method === "arc");
  assertClose(
    "negative r expression → abs(r) = 25",
    arcCall!.args[2] as number,
    25,
  );
}

// ─── ode_system: prepareScene filters it out of rendered objects ───────────────

console.log("\n--- ode_system: node is non-renderable ---");
{
  const odeSpec: Equanim = {
    spec: "equanim/0.1",
    meta: centerMeta,
    variables: { k: { label: "k", default: 1, min: 0.1, max: 10, step: 0.1 } },
    scene: {
      id: "root",
      objects: [
        {
          id: "sys",
          type: "ode_system",
          state: { x: 1, v: 0 },
          derivatives: { x: "v", v: "-k * x" },
          step: 0.001,
        },
        {
          id: "dot",
          type: "circle",
          style: { fill: "#ff0", stroke: "none", stroke_width: 0 },
          equations: { cx: "sys_x(t * d) * 100", cy: "0", r: "8" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };

  const vars = { k: 1 };
  const prepared = prepareScene(odeSpec, vars);

  // ode_system must not appear in rendered objects
  assert("ode_system not in prepared.objects", prepared.objects.length, 1);
  assert("remaining object is circle", prepared.objects[0]!.kind, "circle");

  // reintegrate callback is present
  assert(
    "reintegrate callback exists",
    typeof prepared.reintegrate,
    "function",
  );
}

// ─── ode_system: injected interpolator resolves in expressions ────────────────

console.log("\n--- ode_system: injected interpolator in expressions ---");
{
  // SHO: x(0)=1, v(0)=0, dx/dt=v, dv/dt=-k*x
  // Exact solution with k=1: x(t) = cos(t)
  // At t=π/2 seconds, x = cos(π/2) = 0 → canvas_x = 0*100 + 500 = 500
  // At t=0, x = cos(0) = 1 → canvas_x = 1*100 + 500 = 600
  const odeSpec: Equanim = {
    spec: "equanim/0.1",
    meta: { ...centerMeta, duration: 4 },
    variables: { k: { label: "k", default: 1, min: 0.1, max: 10, step: 0.1 } },
    scene: {
      id: "root",
      objects: [
        {
          id: "sys",
          type: "ode_system",
          state: { x: 1, v: 0 },
          derivatives: { x: "v", v: "-k * x" },
          step: 0.001,
        },
        {
          id: "dot",
          type: "circle",
          style: { fill: "#ff0", stroke: "none", stroke_width: 0 },
          // cx = sys_x(t*d)*100 — oscillates between -100 and +100 in spec space
          equations: { cx: "sys_x(t * d) * 100", cy: "0", r: "8" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };

  const prepared = prepareScene(odeSpec, { k: 1 });
  const ctx = makeMockCtx();

  // T=0: x=cos(0)=1 → cx_spec=100 → canvas_x = 600
  renderFrame(ctx as unknown as CanvasRenderingContext2D, prepared, 0, "#000");
  const arcAt0 = ctx._calls.find((c) => c.method === "arc");
  assertClose(
    "at T=0: sys_x(0)=1 → cx_canvas=600",
    arcAt0!.args[0] as number,
    600,
    1,
  );

  // T=π/2: x=cos(π/2)≈0 → cx_spec=0 → canvas_x = 500
  ctx._calls.length = 0;
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    Math.PI / 2,
    "#000",
  );
  const arcAtHalfPi = ctx._calls.find((c) => c.method === "arc");
  assertClose(
    "at T=π/2: sys_x(π/2)≈0 → cx_canvas≈500",
    arcAtHalfPi!.args[0] as number,
    500,
    2,
  );

  // T=π: x=cos(π)=-1 → cx_spec=-100 → canvas_x = 400
  ctx._calls.length = 0;
  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    prepared,
    Math.PI,
    "#000",
  );
  const arcAtPi = ctx._calls.find((c) => c.method === "arc");
  assertClose(
    "at T=π: sys_x(π)≈-1 → cx_canvas≈400",
    arcAtPi!.args[0] as number,
    400,
    2,
  );
}

// ─── ode_system: missing vars causes integration failure (regression) ──────────
//
// This is the regression test for the bug where prepareScene() was called
// before defaultVarValues() in main.ts, passing vars={} to the ODE integrator.
// With vars={}, references to spec variables (like `k`) are undefined in the
// derivative scope, causing mathjs to produce null and throw
// "Signature not found (signature: unaryMinus(null))".
//
// The correct fix — initialising vars from defaults before calling prepareScene —
// is exercised by every other ode_system test above. This test locks in the
// failure mode explicitly so it can never silently regress.

console.log(
  "\n--- ode_system: vars={} with variable-dependent derivatives throws ---",
);
{
  const odeSpec: Equanim = {
    spec: "equanim/0.1",
    meta: { ...centerMeta, duration: 4 },
    variables: { k: { label: "k", default: 1, min: 0.1, max: 10, step: 0.1 } },
    scene: {
      id: "root",
      objects: [
        {
          id: "sys",
          type: "ode_system",
          state: { x: 1, v: 0 },
          // `k` comes from spec variables — will be undefined if vars={}
          derivatives: { x: "v", v: "-k * x" },
          step: 0.001,
        },
        {
          id: "dot",
          type: "circle",
          style: { fill: "#ff0", stroke: "none", stroke_width: 0 },
          equations: { cx: "sys_x(t * d) * 100", cy: "0", r: "8" },
          timeline: { start: 0, end: 1 },
        },
      ],
    },
  };

  let threw = false;
  try {
    prepareScene(odeSpec); // intentionally omitting vars — should throw
  } catch {
    threw = true;
  }
  assert(
    "prepareScene without vars throws for variable-dependent ODE",
    threw,
    true,
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
