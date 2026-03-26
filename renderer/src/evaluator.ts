import * as math from "mathjs";
import type { Params, Functions, VarValues } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A compiled expression ready for repeated evaluation.
 *
 * Four time/duration variables are always available in every expression:
 *
 *   t      — local normalised time 0→1 over the object's own timeline window
 *               (e.g. `opacity = t` always fades in over the object's duration)
 *   d      — local duration in seconds (length of the object's own window)
 *               Multiply to get local seconds: `t * d`
 *   root_t — global normalised time 0→1 over the full animation
 *               (e.g. sync a pulse to the whole animation: `sin(root_t * 2 * pi)`)
 *   root_d — total animation duration in seconds
 *               Multiply to get global seconds: `root_t * root_d`
 *
 * s is the parametric domain variable (only meaningful for parametric_path).
 *
 * Naming rule: object and group IDs must be valid identifiers (letters,
 * digits, underscores; no hyphens; cannot start with a digit) so they can
 * serve as namespace prefixes — e.g. a future group "intro" would expose
 * intro_t and intro_d to its children.
 */
export interface CompiledExpr {
  evaluate(
    t: number,
    root_t: number,
    d: number,
    root_d: number,
    s?: number,
    vars?: VarValues,
  ): number;
}

/**
 * The evaluator for one scene object.
 * Built once from the object's params + functions blocks,
 * then used to compile each equation string.
 */
export interface Evaluator {
  /**
   * Pre-compile an equation string.
   * Parsing happens once here; only .evaluate() is called per frame.
   */
  compile(expr: string): CompiledExpr;

  /**
   * One-shot evaluate — useful for constants / debugging.
   */
  evaluate(
    expr: string,
    t: number,
    root_t: number,
    d: number,
    root_d: number,
    s?: number,
    vars?: VarValues,
  ): number;
}

// ─── Built-in extensions ──────────────────────────────────────────────────────

/**
 * mathjs v13 removed math.import in favour of math.create().
 * Simpler fix: inject clamp directly into every scope object.
 * It's a tiny function — no meaningful overhead.
 */
const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Build an Evaluator for a single scene object.
 *
 * @param params       - The object's `params` block (named number constants)
 * @param functions    - The object's `functions` block (named sub-expressions)
 * @param injectedFns  - Extra callable functions injected into scope at
 *                       expression-evaluation time. Used to expose ODE
 *                       trajectory interpolators (e.g. phys_th1, phys_th2)
 *                       produced by ode_system nodes. The functions close over
 *                       mutable OdeRef objects, so they automatically reflect
 *                       re-integrated trajectories without rebuilding evaluators.
 *
 * Scope layout at evaluation time:
 *   { t, d, root_t, root_d, s?, clamp, ...params, ...vars,
 *     ...injectedFns, A: (...args) => ... }
 *
 * t      = local normalised time (0→1 over the object's own active window)
 * d      = local duration in seconds
 * root_t = global normalised time (0→1 over the full animation)
 * root_d = total animation duration in seconds
 *
 * vars (global variable values) are spread after params, so a variable with
 * the same name as a param will override it. injectedFns are spread after
 * vars, so ODE interpolators can't be accidentally overridden by sliders.
 *
 * Function bodies are compiled once (math.compile) and re-evaluated
 * with a fresh local scope on every call. This avoids re-parsing on every
 * frame while keeping each call side-effect-free.
 */
export function buildEvaluator(
  params: Params = {},
  functions: Functions = {},
  injectedFns: Record<string, (...args: number[]) => number> = {},
): Evaluator {
  // Pre-compile every function body exactly once.
  const compiledFunctions = Object.entries(functions).map(
    ([name, { args, body }]) => ({
      name,
      args,
      compiled: math.compile(body),
    })
  );

  // Build a scope object for a given (t, root_t, d, root_d, s?, vars?) set.
  // Fresh scope per call so values don't bleed between samples.
  function makeScope(
    t: number,
    root_t: number,
    d: number,
    root_d: number,
    s?: number,
    vars: VarValues = {}
  ): Record<string, unknown> {
    const scope: Record<string, unknown> = {
      t,
      d,
      root_t,
      root_d,
      clamp,
      ...params,      // object-level constants
      ...vars,        // global runtime variables (override same-named params)
      ...injectedFns, // ODE interpolators and other externally-provided fns
    };

    if (s !== undefined) scope["s"] = s;

    // Register each named function as a JS callable in the scope.
    // When mathjs encounters A(t) it calls scope.A(t).
    // The function closes over the outer scope for params/vars,
    // then overrides the named argument slots.
    for (const { name, args, compiled } of compiledFunctions) {
      scope[name] = (...argVals: number[]): number => {
        const localScope: Record<string, unknown> = { ...scope };
        for (let i = 0; i < args.length; i++) {
          localScope[args[i] as string] = argVals[i];
        }
        return compiled.evaluate(localScope) as number;
      };
    }

    return scope;
  }

  return {
    compile(expr: string): CompiledExpr {
      const compiled = math.compile(expr);
      return {
        evaluate(
          t: number,
          root_t: number,
          d: number,
          root_d: number,
          s?: number,
          vars?: VarValues,
        ): number {
          return compiled.evaluate(makeScope(t, root_t, d, root_d, s, vars)) as number;
        },
      };
    },

    evaluate(
      expr: string,
      t: number,
      root_t: number,
      d: number,
      root_d: number,
      s?: number,
      vars?: VarValues,
    ): number {
      return math.evaluate(expr, makeScope(t, root_t, d, root_d, s, vars)) as number;
    },
  };
}
