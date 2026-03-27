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
  /** Canvas background color. Defaults to "#0a0a0f". */
  background?: string;
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
  /** Named constants available in derivative expressions. */
  params?: Params;
  /** Numerical solver. Default: "rk4". */
  solver?: "rk4";
  /** Integration step size in seconds. Smaller = more accurate. Default: 0.001. */
  step?: number;
}

/**
 * A body inside a CollisionSystem.
 * Position and velocity fields accept either a plain number or a mathjs
 * expression string that is evaluated against the current VarValues before
 * the simulation runs. This lets variables (e.g. cue_speed, angle) drive
 * initial conditions interactively.
 */
export interface CollisionBall {
  x: number | string;
  y: number | string;
  vx: number | string;
  vy: number | string;
  /** Radius in spec units (pixels). */
  r: number;
  /** Mass. Defaults to 1. */
  m?: number;
}

/**
 * A discrete-time collision simulation node.
 *
 * Unlike ode_system (which solves smooth ODEs), collision_system uses a
 * position-impulse solver at each time step: friction is applied, positions
 * are updated, then ball-ball and ball-wall collisions are resolved with
 * multiple correction passes. The result is pre-computed over the full
 * animation duration and stored as trajectory arrays.
 *
 * State variables exposed as interpolators in sibling expression scopes:
 *   `<id>_<bodyId>_x(t)` and `<id>_<bodyId>_y(t)`
 *
 * Example: system id "pool", body "cue" → pool_cue_x(t*d), pool_cue_y(t*d)
 */
export interface CollisionSystem {
  id: string;
  type: "collision_system";
  /** Table boundary in spec space. If omitted, walls are infinite. */
  bounds?: { x: [number, number]; y: [number, number] };
  /**
   * Coefficient of restitution 0–1. Can be a number or expression string.
   * Default: 0.9
   */
  restitution?: number | string;
  /**
   * Friction deceleration in spec-units/s². Can be a number or expression string.
   * Default: 80
   */
  friction?: number | string;
  /** Time step in seconds. Default: 0.002. */
  step?: number;
  /** Named bodies with initial conditions. */
  bodies: Record<string, CollisionBall>;
}

// ─── Unions ───────────────────────────────────────────────────────────────────

/** A visual primitive — the things that actually get drawn. */
export type SceneObject = ParametricPath | Line | Circle;

/** Any node that can appear in scene.objects, including non-renderable systems. */
export type SceneNode = SceneObject | OdeSystem | CollisionSystem;
