// ─── Spec root ────────────────────────────────────────────────────────────────

export interface AnimSpec {
  spec: string; // "animspec/0.1"
  meta: Meta;
  /**
   * Global runtime variables exposed to the user as controls (sliders, etc.).
   * Variable values are injected into every object's expression scope,
   * overriding same-named entries in an object's `params` block.
   *
   * Consumers (players, editors) read `default` on load and let users
   * adjust values within [min, max] at step increments.
   */
  variables?: Variables;
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

/**
 * When an object is visible, expressed as fractions of the total duration.
 * Both values are in [0, 1]: 0 = animation start, 1 = animation end.
 *
 * Examples (3s animation):
 *   { start: 0,    end: 1   }  → visible the whole time
 *   { start: 0,    end: 0.5 }  → visible for the first 1.5s
 *   { start: 0.33, end: 0.67}  → visible from 1s to 2s
 */
export interface Timeline {
  start: number; // 0–1
  end: number;   // 0–1
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

/**
 * A single user-controllable variable.
 */
export interface VariableDef {
  /** Human-readable label for the control. Defaults to the key name. */
  label?: string;
  default: number;
  min: number;
  max: number;
  /** Slider step increment. Defaults to (max - min) / 100. */
  step?: number;
}

/**
 * Top-level variables block. Keys are the names referenced in expressions.
 */
export type Variables = Record<string, VariableDef>;

/**
 * Runtime values of variables — what gets injected into expression scope.
 * Produced by reading current slider positions.
 */
export type VarValues = Record<string, number>;

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
