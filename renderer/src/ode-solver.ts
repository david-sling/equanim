import * as math from "mathjs";
import type { OdeSystem, Params, VarValues } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Mutable container for a solved ODE trajectory.
 *
 * Stored by reference so interpolator functions (which close over it) can read
 * updated data after re-integration without needing to be re-created. Calling
 * `integrateInto` replaces `trajectories` with a fresh Float64Array per state
 * variable; the interpolators pick up the new arrays on the next call.
 */
export interface OdeRef {
  trajectories: Record<string, Float64Array>;
  step: number;
  nSteps: number;
  duration: number;
}

// ─── Internal compiled types ──────────────────────────────────────────────────

interface CompiledDeriv {
  varName: string;
  fn: math.EvalFunction;
}

interface CompiledMutation {
  varName: string;
  fn: math.EvalFunction;
}

interface CompiledEvent {
  condition: math.EvalFunction;
  direction: "rising" | "falling" | "either";
  mutations: CompiledMutation[];
}

interface CompiledSystem {
  derivs: CompiledDeriv[];
  events: CompiledEvent[];
  /** Merged params + vars — injected into every expression scope. */
  baseScope: Record<string, unknown>;
  stateVarNames: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compile all derivative and event expressions for a system once.
 * The result is passed to `runRK4Loop` for the actual integration.
 */
function compileSystem(system: OdeSystem, vars: VarValues): CompiledSystem {
  const params: Params = system.params ?? {};
  const baseScope: Record<string, unknown> = { ...params, ...vars };
  const stateVarNames = Object.keys(system.state);

  const derivs: CompiledDeriv[] = Object.entries(system.derivatives).map(
    ([varName, expr]) => ({ varName, fn: math.compile(expr) }),
  );

  const events: CompiledEvent[] = (system.events ?? []).map((evt) => ({
    condition: math.compile(evt.condition),
    direction: evt.direction,
    mutations: Object.entries(evt.mutations).map(([varName, expr]) => ({
      varName,
      fn: math.compile(expr),
    })),
  }));

  return { derivs, events, baseScope, stateVarNames };
}

/** Evaluate all derivative expressions at the given state. */
function evalDerivs(
  compiled: CompiledSystem,
  state: Record<string, number>,
): Record<string, number> {
  const scope = { ...compiled.baseScope, ...state };
  const result: Record<string, number> = {};
  for (const { varName, fn } of compiled.derivs) {
    result[varName] = fn.evaluate(scope) as number;
  }
  return result;
}

/** Advance state by one RK4 step of size h. Returns a new state object. */
function rk4Step(
  compiled: CompiledSystem,
  state: Record<string, number>,
  h: number,
): Record<string, number> {
  const { stateVarNames } = compiled;

  const k1 = evalDerivs(compiled, state);

  const s2: Record<string, number> = {};
  for (const v of stateVarNames) s2[v] = state[v]! + 0.5 * h * (k1[v] ?? 0);
  const k2 = evalDerivs(compiled, s2);

  const s3: Record<string, number> = {};
  for (const v of stateVarNames) s3[v] = state[v]! + 0.5 * h * (k2[v] ?? 0);
  const k3 = evalDerivs(compiled, s3);

  const s4: Record<string, number> = {};
  for (const v of stateVarNames) s4[v] = state[v]! + h * (k3[v] ?? 0);
  const k4 = evalDerivs(compiled, s4);

  const next: Record<string, number> = {};
  for (const v of stateVarNames) {
    next[v] =
      state[v]! +
      (h / 6) *
        ((k1[v] ?? 0) + 2 * (k2[v] ?? 0) + 2 * (k3[v] ?? 0) + (k4[v] ?? 0));
  }
  return next;
}

/** Evaluate a compiled event condition expression. */
function evalCondition(
  condition: math.EvalFunction,
  baseScope: Record<string, unknown>,
  state: Record<string, number>,
): number {
  return condition.evaluate({ ...baseScope, ...state }) as number;
}

/**
 * Apply all mutations simultaneously from the pre-mutation state.
 * All new values are computed first, then written back — this ensures
 * swaps (e.g. elastic velocity exchange) evaluate correctly.
 */
function applyMutations(
  mutations: CompiledMutation[],
  baseScope: Record<string, unknown>,
  state: Record<string, number>,
): void {
  const scope = { ...baseScope, ...state };
  const newValues: Record<string, number> = {};
  for (const { varName, fn } of mutations) {
    newValues[varName] = fn.evaluate(scope) as number;
  }
  Object.assign(state, newValues);
}

/** Return true if the condition crossed zero in the specified direction. */
function eventFires(
  direction: "rising" | "falling" | "either",
  before: number,
  after: number,
): boolean {
  if (direction === "falling") return before > 0 && after <= 0;
  if (direction === "rising") return before < 0 && after >= 0;
  return (before > 0 && after <= 0) || (before < 0 && after >= 0);
}

/**
 * Core RK4 integration loop with event detection.
 *
 * Writes trajectory data into `ref` starting from index `startIdx + 1`.
 * On each step, scans all compiled events for zero-crossings. When one is
 * found, the crossing time is located via linear interpolation, the solver
 * integrates to that point, applies the mutations, then continues to the
 * end of the step. At most one event fires per step.
 */
function runRK4Loop(
  compiled: CompiledSystem,
  state: Record<string, number>,
  startIdx: number,
  ref: OdeRef,
  duration: number,
): void {
  const { events, stateVarNames, baseScope } = compiled;
  const { step, nSteps } = ref;

  for (let i = startIdx + 1; i < nSteps; i++) {
    const h = Math.min(step, duration - (i - 1) * step);
    if (h <= 0) break;

    // Snapshot state and condition signs before the step
    const stateBefore = { ...state };
    const condsBefore = events.map((evt) =>
      evalCondition(evt.condition, baseScope, state),
    );

    // Full RK4 step
    const stateAfter = rk4Step(compiled, state, h);

    // Check for zero-crossings
    let fired = false;
    for (let ei = 0; ei < events.length; ei++) {
      const evt = events[ei]!;
      const condBefore = condsBefore[ei]!;
      const condAfter = evalCondition(evt.condition, baseScope, stateAfter);

      if (eventFires(evt.direction, condBefore, condAfter)) {
        // Linear interpolation: fraction of h at which the crossing occurs
        const denom = condBefore - condAfter;
        const frac = denom !== 0 ? Math.max(0, Math.min(1, condBefore / denom)) : 0.5;
        const hEvent = frac * h;
        const hRemain = h - hEvent;

        // Integrate from stateBefore to the event point
        const stateEvent = hEvent > 0
          ? rk4Step(compiled, stateBefore, hEvent)
          : { ...stateBefore };

        // Apply all mutations simultaneously from the event state
        applyMutations(evt.mutations, baseScope, stateEvent);

        // Continue from the event point to the end of the step
        Object.assign(
          state,
          hRemain > 0 ? rk4Step(compiled, stateEvent, hRemain) : stateEvent,
        );

        fired = true;
        break; // at most one event per step
      }
    }

    if (!fired) {
      Object.assign(state, stateAfter);
    }

    // Store final state at index i
    for (const v of stateVarNames) {
      ref.trajectories[v]![i] = state[v]!;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run RK4 integration and write results into an existing OdeRef.
 *
 * Always allocates fresh Float64Arrays so interpolators that read
 * `ref.trajectories[v]` dynamically pick up the new data.
 *
 * Scope available inside derivative, event condition, and mutation expressions:
 *   - all current state variable values
 *   - params from the OdeSystem's own params block
 *   - vars (runtime spec variables)
 */
export function integrateInto(
  system: OdeSystem,
  duration: number,
  vars: VarValues,
  ref: OdeRef,
): void {
  const step = system.step ?? 0.001;
  const stateVarNames = Object.keys(system.state);
  const nSteps = Math.ceil(duration / step) + 1;

  ref.step = step;
  ref.nSteps = nSteps;
  ref.duration = duration;
  ref.trajectories = {};
  for (const v of stateVarNames) {
    ref.trajectories[v] = new Float64Array(nSteps);
  }

  const compiled = compileSystem(system, vars);
  const state: Record<string, number> = { ...system.state };

  // Write initial conditions at index 0
  for (const v of stateVarNames) {
    ref.trajectories[v]![0] = state[v]!;
  }

  runRK4Loop(compiled, state, 0, ref, duration);
}

/**
 * Re-integrate an ODE system forward from a mid-trajectory point.
 *
 * Leaves trajectory data before `tStart` untouched. Finds the nearest grid
 * index at or after `tStart`, writes `startState` there, then runs RK4 from
 * that index to the end of the trajectory using the new variable values.
 *
 * Use this to implement "live" variable changes: instead of replaying the
 * whole simulation from t=0, continue from the current playback position
 * with the updated physics parameters.
 *
 * Falls back to a full `integrateInto` when tStart ≤ 0.
 *
 * @param system      - The OdeSystem spec node
 * @param tStart      - Absolute time in seconds to branch from
 * @param startState  - State variable values at tStart
 * @param duration    - Total animation duration in seconds
 * @param vars        - New runtime variable values to use from tStart onward
 * @param ref         - Mutable trajectory ref; updated in place from tStart onward
 */
export function integrateFromInto(
  system: OdeSystem,
  tStart: number,
  startState: Record<string, number>,
  duration: number,
  vars: VarValues,
  ref: OdeRef,
): void {
  const step = ref.step;
  const startIdx = Math.round(tStart / step);

  if (startIdx <= 0) {
    integrateInto(system, duration, vars, ref);
    return;
  }

  const clampedIdx = Math.min(startIdx, ref.nSteps - 1);
  const compiled = compileSystem(system, vars);
  const state: Record<string, number> = { ...startState };

  // Write start state at the branch point
  for (const v of Object.keys(system.state)) {
    ref.trajectories[v]![clampedIdx] = state[v]!;
  }

  runRK4Loop(compiled, state, clampedIdx, ref, duration);
}

/**
 * Allocate an OdeRef and run the initial integration.
 *
 * The ref is mutable — pass it to `integrateInto` to update in place
 * when variable values change.
 */
export function createOdeRef(
  system: OdeSystem,
  duration: number,
  vars: VarValues = {},
): OdeRef {
  const step = system.step ?? 0.001;
  const nSteps = Math.ceil(duration / step) + 1;

  const ref: OdeRef = {
    trajectories: {},
    step,
    nSteps,
    duration,
  };
  for (const v of Object.keys(system.state)) {
    ref.trajectories[v] = new Float64Array(nSteps);
  }

  integrateInto(system, duration, vars, ref);
  return ref;
}

// ─── Interpolation ────────────────────────────────────────────────────────────

/**
 * Create a linear interpolation function that reads from a mutable OdeRef.
 *
 * The returned function closes over `ref` (not over the arrays inside it),
 * so it automatically picks up updated trajectories after re-integration
 * without needing to be re-created.
 *
 * @param ref       - The OdeRef produced by createOdeRef
 * @param stateVar  - Which state variable to interpolate (e.g. "th1")
 * @returns         A function (tSeconds) → value
 */
export function makeInterpolator(
  ref: OdeRef,
  stateVar: string,
): (tSec: number) => number {
  return (tSec: number): number => {
    const traj = ref.trajectories[stateVar];
    if (!traj) return 0;

    const tc = Math.max(0, Math.min(ref.duration, tSec));
    const rawIdx = tc / ref.step;
    const i0 = Math.floor(rawIdx);
    const i1 = Math.min(i0 + 1, ref.nSteps - 1);
    const frac = rawIdx - i0;

    return (traj[i0] ?? 0) + frac * ((traj[i1] ?? 0) - (traj[i0] ?? 0));
  };
}
