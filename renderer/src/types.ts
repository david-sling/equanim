// ─── Spec root ────────────────────────────────────────────────────────────────

export interface Equanim {
  spec: string; // "equanim/0.1"
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
  objects: SceneNode[];
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
  end: number; // 0–1
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

export interface Circle {
  id: string;
  type: "circle";
  style: Style;
  equations: {
    cx: string; // center x in spec space
    cy: string; // center y in spec space
    r: string;  // radius in spec units
  };
  params?: Params;
  functions?: Functions;
  timeline: Timeline;
}

/**
 * A single event that fires when a condition crosses zero during ODE integration.
 *
 * The solver monitors `condition` for sign changes after each RK4 step.
 * When one is detected in the specified direction, the solver bisects to find
 * the crossing time, then evaluates each entry in `mutations` and writes the
 * results back into the state — all from the pre-mutation state, so swaps
 * (e.g. elastic collision velocity exchange) are computed correctly.
 *
 * Mutation expressions have access to: current state variables, the system's
 * `params`, and the spec's global `variables`.
 */
export interface EventDef {
  /** Expression monitored for zero-crossings. Positive → negative is "falling". */
  condition: string;
  /** Which crossing direction triggers the event. */
  direction: "rising" | "falling" | "either";
  /** State variable mutations applied simultaneously at the event point. */
  mutations: Record<string, string>;
}

/**
 * A non-renderable physics simulation node.
 *
 * The renderer integrates the system numerically (RK4) before playback,
 * producing a trajectory for each state variable. These are exposed as
 * callable interpolation functions in every other object's expression scope
 * using the naming convention `<id>_<stateVar>(t_seconds)`.
 *
 * Example: an OdeSystem with id "phys" and state var "th1" exposes
 * `phys_th1(t)` to all sibling objects.
 *
 * Derivative expressions are evaluated in a scope containing:
 *   - all current state variable values (e.g. th1, w1, th2, w2)
 *   - the object's own `params`
 *   - the spec's global `variables` (runtime values)
 */
export interface OdeSystem {
  id: string;
  type: "ode_system";
  /** Initial conditions: state variable name → initial value. */
  state: Record<string, number>;
  /** Derivative expressions: variable name → expression for d(var)/dt. */
  derivatives: Record<string, string>;
  /** Named constants available in derivative and event expressions. */
  params?: Params;
  /**
   * Zero-crossing events. Each event fires when its condition changes sign
   * in the specified direction, applying state mutations at that instant.
   */
  events?: EventDef[];
  /** Numerical solver. Default: "rk4". */
  solver?: "rk4";
  /** Integration step size in seconds. Smaller = more accurate. Default: 0.001. */
  step?: number;
}

// ─── Unions ───────────────────────────────────────────────────────────────────

/** A visual primitive — the things that actually get drawn. */
export type SceneObject = ParametricPath | Line | Circle;

/** Any node that can appear in scene.objects, including non-renderable systems. */
export type SceneNode = SceneObject | OdeSystem;
