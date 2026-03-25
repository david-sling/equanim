import * as math from "mathjs";
import type { Params, Functions, VarValues } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A compiled expression ready for repeated evaluation.
 *
 * Both time values are available to every expression:
 *   T — global time in seconds (wall-clock physics time, e.g. exp(-decay * T))
 *   t — local normalised time 0→1 over the object's own timeline window
 *         (e.g. opacity = t  always fades in over the object's duration)
 *
 * s is the parametric domain variable (only meaningful for parametric_path).
 */
export interface CompiledExpr {
  evaluate(T: number, t: number, s?: number, vars?: VarValues): number;
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
  evaluate(expr: string, T: number, t: number, s?: number, vars?: VarValues): number;
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
 * @param params    - The object's `params` block (named number constants)
 * @param functions - The object's `functions` block (named sub-expressions)
 *
 * Scope layout at evaluation time:
 *   { T, t, s?, clamp, ...params, ...vars, A: (...args) => ..., E: (...args) => ... }
 *
 * T = global absolute time in seconds
 * t = local normalised time (0→1 over the object's own active window)
 * vars (global variable values) are spread after params, so a variable with
 * the same name as a param will override it.
 *
 * Function bodies are compiled once (math.compile) and re-evaluated
 * with a fresh local scope on every call. This avoids re-parsing on every
 * frame while keeping each call side-effect-free.
 */
export function buildEvaluator(
  params: Params = {},
  functions: Functions = {}
): Evaluator {
  // Pre-compile every function body exactly once.
  const compiledFunctions = Object.entries(functions).map(
    ([name, { args, body }]) => ({
      name,
      args,
      compiled: math.compile(body),
    })
  );

  // Build a scope object for a given (T, t, s?, vars?) quad.
  // Fresh scope per call so T/t/s/vars don't bleed between samples.
  function makeScope(
    T: number,
    t: number,
    s?: number,
    vars: VarValues = {}
  ): Record<string, unknown> {
    const scope: Record<string, unknown> = {
      T,
      t,
      clamp,
      ...params, // object-level constants
      ...vars,   // global runtime variables (override same-named params)
    };

    if (s !== undefined) scope["s"] = s;

    // Register each named function as a JS callable in the scope.
    // When mathjs encounters A(T) it calls scope.A(T).
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
        evaluate(T: number, t: number, s?: number, vars?: VarValues): number {
          return compiled.evaluate(makeScope(T, t, s, vars)) as number;
        },
      };
    },

    evaluate(expr: string, T: number, t: number, s?: number, vars?: VarValues): number {
      return math.evaluate(expr, makeScope(T, t, s, vars)) as number;
    },
  };
}
