import * as math from "mathjs";
import type { Params, Functions, VarValues } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A compiled expression ready for repeated evaluation.
 * Call .evaluate(t) or .evaluate(t, s) per frame / per sample.
 * Pass vars to inject current variable values (overrides same-named params).
 */
export interface CompiledExpr {
  evaluate(t: number, s?: number, vars?: VarValues): number;
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
  evaluate(expr: string, t: number, s?: number, vars?: VarValues): number;
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
 *   { t, s?, clamp, ...params, ...vars, A: (...args) => ..., E: (...args) => ... }
 *
 * vars (global variable values) are spread after params, so a variable with
 * the same name as a param will override it. t and s always win over both —
 * they are set last in the function registrations' local scopes.
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

  // Build a scope object for a given (t, s?, vars?) triple.
  // Fresh scope per call so t/s/vars don't bleed between samples.
  function makeScope(
    t: number,
    s?: number,
    vars: VarValues = {}
  ): Record<string, unknown> {
    const scope: Record<string, unknown> = {
      t,
      clamp,
      ...params, // object-level constants
      ...vars,   // global runtime variables (override same-named params)
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
        evaluate(t: number, s?: number, vars?: VarValues): number {
          return compiled.evaluate(makeScope(t, s, vars)) as number;
        },
      };
    },

    evaluate(expr: string, t: number, s?: number, vars?: VarValues): number {
      return math.evaluate(expr, makeScope(t, s, vars)) as number;
    },
  };
}
