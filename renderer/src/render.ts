import type {
  Equanim,
  Meta,
  SceneObject,
  ParametricPath,
  Line,
  Circle,
  Timeline,
  VarValues,
} from "./types.js";
import { buildEvaluator, type CompiledExpr } from "./evaluator.js";

// ─── Coordinate transform ─────────────────────────────────────────────────────

/**
 * Convert a spec-space point to canvas-space.
 *
 * Spec cartesian:  origin at center (or top-left), y-up
 * Canvas:          origin at top-left, y-down
 *
 * For origin="center":
 *   canvas_x = width/2  + spec_x
 *   canvas_y = height/2 - spec_y   (y-flip)
 *
 * For origin="top-left":
 *   canvas_x = spec_x
 *   canvas_y = spec_y              (no flip)
 */
export function toCanvas(
  specX: number,
  specY: number,
  meta: Meta,
): [number, number] {
  if (meta.origin === "center") {
    return [meta.width / 2 + specX, meta.height / 2 - specY];
  }
  return [specX, specY];
}

// ─── Timeline check ───────────────────────────────────────────────────────────

/**
 * Return true if the normalised position tNorm (0–1) falls within the
 * object's timeline window (also 0–1).
 *
 * EPS absorbs IEEE-754 drift so that the last frame of a full-duration
 * object (e.g. tNorm = 0.999999999... instead of 1.0) is never dropped.
 * It is intentionally tiny (1e-9) — far smaller than one frame duration
 * at any realistic fps — so it introduces no perceptible timing error.
 */
const TIMELINE_EPS = 1e-9;

export function isActive(timeline: Timeline, tNorm: number): boolean {
  return (
    tNorm >= timeline.start - TIMELINE_EPS &&
    tNorm <= timeline.end + TIMELINE_EPS
  );
}

// ─── Local time & duration ────────────────────────────────────────────────────

/**
 * Compute the local normalised time t (0→1) for an object at global time T.
 *
 * t = 0 when T reaches the object's start; t = 1 when T reaches its end.
 * Clamped to [0, 1] so expressions remain well-behaved even if evaluated
 * slightly outside the active window.
 *
 * Zero-duration objects (start === end) always return 0.
 */
export function computeLocalT(
  T: number,
  timeline: Timeline,
  duration: number,
): number {
  const tStart = timeline.start * duration;
  const tEnd = timeline.end * duration;
  if (tEnd <= tStart) return 0;
  return Math.max(0, Math.min(1, (T - tStart) / (tEnd - tStart)));
}

/**
 * Compute the local duration d in seconds for an object's timeline window.
 *
 * d = (timeline.end - timeline.start) * meta.duration
 *
 * This is a constant per object (independent of the current frame time T).
 * Multiply by t to convert local normalised time to local seconds: `t * d`.
 */
export function computeLocalD(timeline: Timeline, duration: number): number {
  return (timeline.end - timeline.start) * duration;
}

// ─── Prepared objects ─────────────────────────────────────────────────────────

/**
 * A ParametricPath after one-time compilation of its equations.
 * Equations are compiled here so mathjs only parses them once,
 * not once per frame.
 */
export interface PreparedParametricPath {
  kind: "parametric_path";
  source: ParametricPath;
  compiledX: CompiledExpr;
  compiledY: CompiledExpr;
}

export interface PreparedLine {
  kind: "line";
  source: Line;
  compiledX1: CompiledExpr;
  compiledY1: CompiledExpr;
  compiledX2: CompiledExpr;
  compiledY2: CompiledExpr;
}

export interface PreparedCircle {
  kind: "circle";
  source: Circle;
  compiledCx: CompiledExpr;
  compiledCy: CompiledExpr;
  compiledR: CompiledExpr;
}

export type PreparedObject = PreparedParametricPath | PreparedLine | PreparedCircle;

export interface PreparedScene {
  meta: Meta;
  objects: PreparedObject[];
}

// ─── Scene preparation (run once) ────────────────────────────────────────────

function prepareObject(obj: SceneObject): PreparedObject {
  const ev = buildEvaluator(obj.params ?? {}, obj.functions ?? {});

  if (obj.type === "parametric_path") {
    return {
      kind: "parametric_path",
      source: obj,
      compiledX: ev.compile(obj.equations.x),
      compiledY: ev.compile(obj.equations.y),
    };
  }

  if (obj.type === "line") {
    return {
      kind: "line",
      source: obj,
      compiledX1: ev.compile(obj.equations.x1),
      compiledY1: ev.compile(obj.equations.y1),
      compiledX2: ev.compile(obj.equations.x2),
      compiledY2: ev.compile(obj.equations.y2),
    };
  }

  if (obj.type === "circle") {
    return {
      kind: "circle",
      source: obj,
      compiledCx: ev.compile(obj.equations.cx),
      compiledCy: ev.compile(obj.equations.cy),
      compiledR:  ev.compile(obj.equations.r),
    };
  }

  throw new Error(`Unknown object type: ${(obj as SceneObject).type}`);
}

export function prepareScene(spec: Equanim): PreparedScene {
  return {
    meta: spec.meta,
    objects: spec.scene.objects.map(prepareObject),
  };
}

// ─── Per-object sample generation (pure, testable) ───────────────────────────

/**
 * Generate canvas-space points for a parametric path at global time T.
 * Returns an array of [canvasX, canvasY] tuples.
 *
 * Injects four time/duration variables into each expression's scope:
 *   t      — local 0→1 over this object's timeline window
 *   d      — local duration in seconds (length of this object's window)
 *   root_t — global 0→1 over the full animation
 *   root_d — total animation duration in seconds
 *
 * Exposed separately so tests can verify point values without
 * needing a real canvas context.
 */
export function generateSamples(
  prepared: PreparedParametricPath,
  meta: Meta,
  T: number,
  vars: VarValues = {},
): Array<[number, number]> {
  const { source, compiledX, compiledY } = prepared;
  const t      = computeLocalT(T, source.timeline, meta.duration);
  const d      = computeLocalD(source.timeline, meta.duration);
  const root_t = meta.duration > 0 ? T / meta.duration : 0;
  const root_d = meta.duration;

  const [sMin, sMax] = source.domain.s;
  const n = source.domain.samples;
  const step = (sMax - sMin) / (n - 1);
  const points: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const s = sMin + i * step;
    const sx = compiledX.evaluate(t, root_t, d, root_d, s, vars);
    const sy = compiledY.evaluate(t, root_t, d, root_d, s, vars);
    points.push(toCanvas(sx, sy, meta));
  }

  return points;
}

// ─── Draw calls ──────────────────────────────────────────────────────────────

function applyStyle(
  ctx: CanvasRenderingContext2D,
  style: SceneObject["style"],
): void {
  ctx.strokeStyle = style.stroke ?? "white";
  ctx.lineWidth = style.stroke_width ?? 1;
  ctx.fillStyle = style.fill ?? "none";
}

function drawParametricPath(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedParametricPath,
  meta: Meta,
  T: number,
  vars: VarValues,
): void {
  const points = generateSamples(prepared, meta, T, vars);
  if (points.length === 0) return;

  applyStyle(ctx, prepared.source.style);
  ctx.beginPath();

  const [x0, y0] = points[0]!;
  ctx.moveTo(x0, y0);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]!;
    ctx.lineTo(x, y);
  }

  if (prepared.source.style.fill && prepared.source.style.fill !== "none") {
    ctx.fill();
  }
  ctx.stroke();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedLine,
  meta: Meta,
  T: number,
  vars: VarValues,
): void {
  const t      = computeLocalT(T, prepared.source.timeline, meta.duration);
  const d      = computeLocalD(prepared.source.timeline, meta.duration);
  const root_t = meta.duration > 0 ? T / meta.duration : 0;
  const root_d = meta.duration;

  const sx1 = prepared.compiledX1.evaluate(t, root_t, d, root_d, undefined, vars);
  const sy1 = prepared.compiledY1.evaluate(t, root_t, d, root_d, undefined, vars);
  const sx2 = prepared.compiledX2.evaluate(t, root_t, d, root_d, undefined, vars);
  const sy2 = prepared.compiledY2.evaluate(t, root_t, d, root_d, undefined, vars);

  const [cx1, cy1] = toCanvas(sx1, sy1, meta);
  const [cx2, cy2] = toCanvas(sx2, sy2, meta);

  applyStyle(ctx, prepared.source.style);
  ctx.beginPath();
  ctx.moveTo(cx1, cy1);
  ctx.lineTo(cx2, cy2);
  ctx.stroke();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedCircle,
  meta: Meta,
  T: number,
  vars: VarValues,
): void {
  const t      = computeLocalT(T, prepared.source.timeline, meta.duration);
  const d      = computeLocalD(prepared.source.timeline, meta.duration);
  const root_t = meta.duration > 0 ? T / meta.duration : 0;
  const root_d = meta.duration;

  const cx = prepared.compiledCx.evaluate(t, root_t, d, root_d, undefined, vars);
  const cy = prepared.compiledCy.evaluate(t, root_t, d, root_d, undefined, vars);
  const r  = Math.abs(prepared.compiledR.evaluate(t, root_t, d, root_d, undefined, vars));

  const [canvasCx, canvasCy] = toCanvas(cx, cy, meta);

  applyStyle(ctx, prepared.source.style);
  ctx.beginPath();
  ctx.arc(canvasCx, canvasCy, r, 0, 2 * Math.PI);

  if (prepared.source.style.fill && prepared.source.style.fill !== "none") {
    ctx.fill();
  }
  ctx.stroke();
}

// ─── Frame render (called once per animation frame) ──────────────────────────

/**
 * Clear the canvas and draw all active objects for the given global time T.
 *
 * T        — absolute time in seconds (0 → meta.duration)
 * tNorm    — T / duration (0–1), used for timeline window checks only
 *
 * Per object, four variables are injected into expression scope:
 *   t      — local 0→1 over the object's own timeline window
 *   d      — local duration in seconds
 *   root_t — global 0→1 over the full animation (= tNorm)
 *   root_d — total animation duration in seconds
 *
 * vars — current runtime values of all spec variables
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedScene,
  T: number,
  background = "#0a0a0f",
  vars: VarValues = {},
): void {
  const { meta, objects } = prepared;

  // Normalise T to [0, 1] for timeline comparisons.
  const tNorm = meta.duration > 0 ? T / meta.duration : 0;

  // Clear
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, meta.width, meta.height);

  for (const obj of objects) {
    if (!isActive(obj.source.timeline, tNorm)) continue;

    if (obj.kind === "parametric_path") {
      drawParametricPath(ctx, obj, meta, T, vars);
    } else if (obj.kind === "line") {
      drawLine(ctx, obj, meta, T, vars);
    } else if (obj.kind === "circle") {
      drawCircle(ctx, obj, meta, T, vars);
    }
  }
}
