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

// ─── Integration ──────────────────────────────────────────────────────────────

/**
 * Run RK4 integration and write results into an existing OdeRef.
 *
 * Always allocates fresh Float64Arrays so interpolators that read
 * `ref.trajectories[v]` dynamically pick up the new data.
 *
 * The derivative expressions are compiled here on each call (cheap — four
 * math.compile calls), so this function is self-contained and re-callable
 * whenever variable values change.
 *
 * Scope available inside derivative expressions:
 *   - all current state variable values (e.g. th1, w1, th2, w2)
 *   - params from the OdeSystem's own params block
 *   - vars (runtime spec variables, e.g. g, m1, m2, L1, L2)
 */
export function integrateInto(
  system: OdeSystem,
  duration: number,
  vars: VarValues,
  ref: OdeRef,
): void {
  const step = system.step ?? 0.001;
  const params: Params = system.params ?? {};
  const stateVarNames = Object.keys(system.state);
  const nSteps = Math.ceil(duration / step) + 1;

  // Allocate fresh trajectory arrays
  ref.step = step;
  ref.nSteps = nSteps;
  ref.duration = duration;
  ref.trajectories = {};
  for (const v of stateVarNames) {
    ref.trajectories[v] = new Float64Array(nSteps);
  }

  // Compile derivative expressions once per integration run
  const compiledDerivs = Object.entries(system.derivatives).map(
    ([varName, expr]) => ({ varName, compiled: math.compile(expr) }),
  );

  // Evaluate all derivatives at a given state
  function evalDerivs(s: Record<string, number>): Record<string, number> {
    const scope: Record<string, unknown> = { ...params, ...vars, ...s };
    const result: Record<string, number> = {};
    for (const { varName, compiled } of compiledDerivs) {
      result[varName] = compiled.evaluate(scope) as number;
    }
    return result;
  }

  // Initial state
  const state: Record<string, number> = { ...system.state };
  for (const v of stateVarNames) {
    ref.trajectories[v]![0] = state[v]!;
  }

  // RK4 loop
  for (let i = 1; i < nSteps; i++) {
    const h = Math.min(step, duration - (i - 1) * step);
    if (h <= 0) break;

    const k1 = evalDerivs(state);

    const s2: Record<string, number> = {};
    for (const v of stateVarNames) s2[v] = state[v]! + 0.5 * h * k1[v]!;
    const k2 = evalDerivs(s2);

    const s3: Record<string, number> = {};
    for (const v of stateVarNames) s3[v] = state[v]! + 0.5 * h * k2[v]!;
    const k3 = evalDerivs(s3);

    const s4: Record<string, number> = {};
    for (const v of stateVarNames) s4[v] = state[v]! + h * k3[v]!;
    const k4 = evalDerivs(s4);

    for (const v of stateVarNames) {
      state[v] =
        state[v]! + (h / 6) * (k1[v]! + 2 * k2[v]! + 2 * k3[v]! + k4[v]!);
      ref.trajectories[v]![i] = state[v]!;
    }
  }
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
 * @param system      - The OdeSystem spec node (derivatives, params, step)
 * @param tStart      - Absolute time in seconds to branch from
 * @param startState  - State variable values at tStart (e.g. sampled from existing trajectory)
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
  const params: Params = system.params ?? {};
  const stateVarNames = Object.keys(system.state);

  // Compile derivative expressions
  const compiledDerivs = Object.entries(system.derivatives).map(
    ([varName, expr]) => ({ varName, compiled: math.compile(expr) }),
  );

  function evalDerivs(s: Record<string, number>): Record<string, number> {
    const scope: Record<string, unknown> = { ...params, ...vars, ...s };
    const result: Record<string, number> = {};
    for (const { varName, compiled } of compiledDerivs) {
      result[varName] = compiled.evaluate(scope) as number;
    }
    return result;
  }

  // Write start state at the branch point
  const state: Record<string, number> = { ...startState };
  for (const v of stateVarNames) {
    ref.trajectories[v]![clampedIdx] = state[v]!;
  }

  // RK4 forward from clampedIdx
  for (let i = clampedIdx + 1; i < ref.nSteps; i++) {
    const h = Math.min(step, duration - (i - 1) * step);
    if (h <= 0) break;

    const k1 = evalDerivs(state);

    const s2: Record<string, number> = {};
    for (const v of stateVarNames) s2[v] = state[v]! + 0.5 * h * k1[v]!;
    const k2 = evalDerivs(s2);

    const s3: Record<string, number> = {};
    for (const v of stateVarNames) s3[v] = state[v]! + 0.5 * h * k2[v]!;
    const k3 = evalDerivs(s3);

    const s4: Record<string, number> = {};
    for (const v of stateVarNames) s4[v] = state[v]! + h * k3[v]!;
    const k4 = evalDerivs(s4);

    for (const v of stateVarNames) {
      state[v] =
        state[v]! + (h / 6) * (k1[v]! + 2 * k2[v]! + 2 * k3[v]! + k4[v]!);
      ref.trajectories[v]![i] = state[v]!;
    }
  }
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
  // Allocate placeholder arrays before integrateInto replaces them
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
