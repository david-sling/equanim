import * as math from "mathjs";
import type { Params, Functions } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A compiled expression ready for repeated evaluation.
 * Call .evaluate(t) or .evaluate(t, s) per frame / per sample.
 */
export interface CompiledExpr {
  evaluate(t: number, s?: number): number;
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
  evaluate(expr: string, t: number, s?: number): number;
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
 * @param params  - The object's `params` block  (named number constants)
 * @param functions - The object's `functions` block (named sub-expressions)
 *
 * Design notes
 * ─────────────
 * Scope layout at evaluation time:
 *   { t, s?, ...params, clamp (global), A: (...args) => ..., E: (...args) => ... }
 *
 * Function bodies are compiled once here (math.compile) and re-evaluated
 * with a fresh local scope on every call. This avoids re-parsing on every
 * frame while keeping each call side-effect-free.
 *
 * Why not math.parser()?
 *   Parser keeps mutable state which makes it hard to share across
 *   concurrent evaluations. Plain scope objects are simpler and safer.
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

  // Build a scope object for a given (t, s?) pair.
  // The scope is created fresh each call so that t/s values
  // don't bleed between samples.
  function makeScope(t: number, s?: number): Record<string, unknown> {
    const scope: Record<string, unknown> = {
      t,
      clamp,
      ...params,
    };

    if (s !== undefined) scope["s"] = s;

    // Register each function as a JS callable in the scope.
    // When mathjs encounters A(t) in an expression it calls scope.A(t).
    // The function re-uses the outer scope (for params etc.) but
    // overrides the named argument slots.
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
        evaluate(t: number, s?: number): number {
          return compiled.evaluate(makeScope(t, s)) as number;
        },
      };
    },

    evaluate(expr: string, t: number, s?: number): number {
      return math.evaluate(expr, makeScope(t, s)) as number;
    },
  };
}
