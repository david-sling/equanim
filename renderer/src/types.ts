// ─── Spec root ────────────────────────────────────────────────────────────────

export interface AnimSpec {
  spec: string; // "animspec/0.1"
  meta: Meta;
  scene: Scene;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export interface Meta {
  title: string;
  duration: number; // seconds
  width: number; // px
  height: number; // px
  fps: number;
  coordinate_system: "cartesian";
  origin: "center" | "top-left";
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export interface Scene {
  id: string;
  objects: SceneObject[];
}

// ─── Shared fields ────────────────────────────────────────────────────────────

export interface Timeline {
  start: number;
  end: number;
}

export interface Style {
  stroke?: string;
  stroke_width?: number;
  fill?: string;
}

/**
 * A named sub-expression that accepts typed arguments.
 *
 * Changed from the original "A(t)": "expr" key encoding.
 * That format required parsing the key with regex and made it
 * impossible to distinguish a function from a constant at a glance.
 *
 * New format:
 *   "A": { "args": ["t"], "body": "80 * exp(-1.8 * t)" }
 */
export interface FunctionDef {
  args: string[];
  body: string;
}

/**
 * Named constants scoped to an object. Values are numbers.
 * Referenced by name in equations and function bodies.
 */
export type Params = Record<string, number>;

/**
 * Map of function name → definition.
 */
export type Functions = Record<string, FunctionDef>;

// ─── Primitives ───────────────────────────────────────────────────────────────

export interface ParametricPath {
  id: string;
  type: "parametric_path";
  style: Style;
  domain: {
    s: [number, number]; // [min, max]
    samples: number;
  };
  equations: {
    x: string;
    y: string;
  };
  params?: Params;
  functions?: Functions;
  timeline: Timeline;
}

export interface Line {
  id: string;
  type: "line";
  style: Style;
  equations: {
    x1: string;
    y1: string;
    x2: string;
    y2: string;
  };
  params?: Params;
  functions?: Functions;
  timeline: Timeline;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type SceneObject = ParametricPath | Line;
