import type {
  AnimSpec,
  Meta,
  SceneObject,
  ParametricPath,
  Line,
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
  meta: Meta
): [number, number] {
  if (meta.origin === "center") {
    return [meta.width / 2 + specX, meta.height / 2 - specY];
  }
  return [specX, specY];
}

// ─── Timeline check ───────────────────────────────────────────────────────────

/**
 * Return true if t falls within [timeline.start, timeline.end] (inclusive).
 */
export function isActive(timeline: Timeline, t: number): boolean {
  return t >= timeline.start && t <= timeline.end;
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

export type PreparedObject = PreparedParametricPath | PreparedLine;

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

  throw new Error(`Unknown object type: ${(obj as SceneObject).type}`);
}

export function prepareScene(spec: AnimSpec): PreparedScene {
  return {
    meta: spec.meta,
    objects: spec.scene.objects.map(prepareObject),
  };
}

// ─── Per-object sample generation (pure, testable) ───────────────────────────

/**
 * Generate canvas-space points for a parametric path at time t.
 * Returns an array of [canvasX, canvasY] tuples.
 *
 * Exposed separately so tests can verify point values without
 * needing a real canvas context.
 */
export function generateSamples(
  prepared: PreparedParametricPath,
  meta: Meta,
  t: number,
  vars: VarValues = {}
): Array<[number, number]> {
  const { source, compiledX, compiledY } = prepared;
  const [sMin, sMax] = source.domain.s;
  const n = source.domain.samples;
  const step = (sMax - sMin) / (n - 1);
  const points: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const s = sMin + i * step;
    const sx = compiledX.evaluate(t, s, vars);
    const sy = compiledY.evaluate(t, s, vars);
    points.push(toCanvas(sx, sy, meta));
  }

  return points;
}

// ─── Draw calls ──────────────────────────────────────────────────────────────

function applyStyle(
  ctx: CanvasRenderingContext2D,
  style: SceneObject["style"]
): void {
  ctx.strokeStyle = style.stroke ?? "white";
  ctx.lineWidth = style.stroke_width ?? 1;
  ctx.fillStyle = style.fill ?? "none";
}

function drawParametricPath(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedParametricPath,
  meta: Meta,
  t: number,
  vars: VarValues
): void {
  const points = generateSamples(prepared, meta, t, vars);
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
  t: number,
  vars: VarValues
): void {
  const sx1 = prepared.compiledX1.evaluate(t, undefined, vars);
  const sy1 = prepared.compiledY1.evaluate(t, undefined, vars);
  const sx2 = prepared.compiledX2.evaluate(t, undefined, vars);
  const sy2 = prepared.compiledY2.evaluate(t, undefined, vars);

  const [cx1, cy1] = toCanvas(sx1, sy1, meta);
  const [cx2, cy2] = toCanvas(sx2, sy2, meta);

  applyStyle(ctx, prepared.source.style);
  ctx.beginPath();
  ctx.moveTo(cx1, cy1);
  ctx.lineTo(cx2, cy2);
  ctx.stroke();
}

// ─── Frame render (called once per animation frame) ──────────────────────────

/**
 * Clear the canvas and draw all active objects for the given time t.
 * vars contains the current runtime values of all spec variables.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  prepared: PreparedScene,
  t: number,
  background = "#0a0a0f",
  vars: VarValues = {}
): void {
  const { meta, objects } = prepared;

  // Clear
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, meta.width, meta.height);

  for (const obj of objects) {
    if (!isActive(obj.source.timeline, t)) continue;

    if (obj.kind === "parametric_path") {
      drawParametricPath(ctx, obj, meta, t, vars);
    } else if (obj.kind === "line") {
      drawLine(ctx, obj, meta, t, vars);
    }
  }
}
