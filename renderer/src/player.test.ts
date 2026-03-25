/**
 * Tests for player.ts
 * Run with: npx tsx src/player.test.ts
 *
 * Strategy:
 *   - canTransition / state machine: pure logic, fully tested
 *   - createPlayer: tested via a mock canvas + fake RAF
 *     (we control tick() manually by stubbing requestAnimationFrame)
 */

import { canTransition, TRANSITIONS, createPlayer, defaultVarValues } from "./player.js";
import type { PlayerState } from "./player.js";
import { prepareScene } from "./render.js";
import type { AnimSpec, Variables } from "./types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertType(label: string, actual: unknown, expected: string) {
  const ok = typeof actual === expected;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else {
    console.error(`  ✗ ${label}: expected typeof ${expected}, got ${typeof actual}`);
    failed++;
  }
}

// ─── Mock RAF environment ─────────────────────────────────────────────────────

/**
 * Replaces requestAnimationFrame / cancelAnimationFrame with a
 * synchronous queue we can drain manually.
 *
 * This lets us simulate N frames without any real browser timing.
 */
function installMockRaf() {
  const queue: Map<number, FrameRequestCallback> = new Map();
  let nextHandle = 1;

  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const handle = nextHandle++;
    queue.set(handle, cb);
    return handle;
  };

  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = (handle: number): void => {
    queue.delete(handle);
  };

  return {
    /**
     * Run exactly one queued frame (the oldest one).
     * Returns true if a frame was available, false if queue was empty.
     */
    tick(): boolean {
      const [handle, cb] = [...queue.entries()][0] ?? [];
      if (handle === undefined || cb === undefined) return false;
      queue.delete(handle);
      cb(performance.now());
      return true;
    },

    /** Drain all queued frames up to maxFrames (safety cap). */
    tickAll(maxFrames = 10000): number {
      let count = 0;
      while (this.tick() && count < maxFrames) count++;
      return count;
    },

    pendingCount(): number {
      return queue.size;
    },
  };
}

// ─── Mock canvas ──────────────────────────────────────────────────────────────

function makeMockCanvas() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect(..._: unknown[]) { calls.push("fillRect"); },
    beginPath() { calls.push("beginPath"); },
    moveTo(..._: unknown[]) { calls.push("moveTo"); },
    lineTo(..._: unknown[]) { calls.push("lineTo"); },
    stroke() { calls.push("stroke"); },
    fill() { calls.push("fill"); },
  };
  return {
    canvas: {
      getContext: (_: string) => ctx,
      width: 1000,
      height: 600,
    } as unknown as HTMLCanvasElement,
    ctx,
    calls,
  };
}

// ─── Minimal spec fixture ─────────────────────────────────────────────────────

const minimalSpec: AnimSpec = {
  spec: "animspec/0.1",
  meta: {
    title: "Test",
    duration: 1.0,   // 1 second
    width: 100,
    height: 100,
    fps: 10,         // 10 fps → dt=0.1, 10 frames total
    coordinate_system: "cartesian",
    origin: "center",
  },
  scene: {
    id: "root",
    objects: [
      {
        id: "baseline",
        type: "line",
        style: { stroke: "#fff", stroke_width: 1 },
        equations: { x1: "-50", y1: "0", x2: "50", y2: "0" },
        timeline: { start: 0.0, end: 1.0 },
      },
    ],
  },
};

const prepared = prepareScene(minimalSpec);

// ─── State machine tests ──────────────────────────────────────────────────────

console.log("\n--- canTransition: valid transitions ---");
{
  const valid: Array<[PlayerState, PlayerState]> = [
    ["idle", "playing"],
    ["playing", "paused"],
    ["playing", "ended"],
    ["paused", "playing"],
    ["paused", "idle"],
    ["ended", "idle"],
  ];
  for (const [from, to] of valid) {
    assert(`${from} → ${to}`, canTransition(from, to), true);
  }
}

console.log("\n--- canTransition: invalid transitions ---");
{
  const invalid: Array<[PlayerState, PlayerState]> = [
    ["idle", "paused"],
    ["idle", "ended"],
    ["idle", "idle"],
    ["playing", "idle"],
    ["playing", "playing"],
    ["paused", "ended"],
    ["paused", "paused"],
    ["ended", "playing"],
    ["ended", "paused"],
    ["ended", "ended"],
  ];
  for (const [from, to] of invalid) {
    assert(`${from} → ${to} is blocked`, canTransition(from, to), false);
  }
}

console.log("\n--- TRANSITIONS: all states are covered ---");
{
  const allStates: PlayerState[] = ["idle", "playing", "paused", "ended"];
  for (const s of allStates) {
    assert(`${s} has transition table entry`, s in TRANSITIONS, true);
    assertType(`${s} transitions is array`, TRANSITIONS[s], "object");
  }
}

// ─── createPlayer integration tests ──────────────────────────────────────────

console.log("\n--- createPlayer: initial state ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared);

  assert("initial state is idle", player.getState(), "idle");
  assert("initial time is 0", player.getTime(), 0);
  assert("no pending RAF frames at creation", raf.pendingCount(), 0);

  player.dispose();
}

console.log("\n--- createPlayer: play advances time ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();

  const times: number[] = [];
  const player = createPlayer(canvas, prepared, {
    onTimeUpdate: (t) => times.push(t),
  });

  player.play();
  assert("state is playing after play()", player.getState(), "playing");
  assert("RAF queued after play()", raf.pendingCount(), 1);

  // Tick 5 frames: dt=0.1 → t goes 0, 0.1, 0.2, 0.3, 0.4, 0.5
  raf.tick(); // renders t=0, queues next
  raf.tick();
  raf.tick();
  raf.tick();
  raf.tick();

  assert("after 5 ticks, state still playing", player.getState(), "playing");
  // time should be around 0.5 (started at 0, each tick advances by dt=0.1)
  const approxTime = Math.round(player.getTime() * 10) / 10;
  assert("after 5 ticks, time ≈ 0.5", approxTime, 0.5);

  player.dispose();
}

console.log("\n--- createPlayer: play to end → ended state ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();

  const states: PlayerState[] = [];
  const player = createPlayer(canvas, prepared, {
    onStateChange: (s) => states.push(s),
  });

  player.play();
  // Drain all frames — at 10fps for 1s = 10 frames
  const frameCount = raf.tickAll(50);

  assert("all frames drained", raf.pendingCount(), 0);
  assert("state is ended after full playback", player.getState(), "ended");
  assert("transitioned to playing", states.includes("playing"), true);
  assert("transitioned to ended", states.includes("ended"), true);
  // Should have run roughly 10 frames
  const reasonable = frameCount >= 8 && frameCount <= 15;
  assert(`ran ~10 frames (got ${frameCount})`, reasonable, true);

  player.dispose();
}

console.log("\n--- createPlayer: pause stops advancement ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared);

  player.play();
  raf.tick();
  raf.tick();
  raf.tick();

  const timeAtPause = player.getTime();
  player.pause();
  assert("state is paused", player.getState(), "paused");
  assert("no RAF pending after pause", raf.pendingCount(), 0);

  // Drain any remaining (there shouldn't be any)
  raf.tickAll();
  assert("time did not advance after pause", player.getTime(), timeAtPause);

  player.dispose();
}

console.log("\n--- createPlayer: pause then resume ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared);

  player.play();
  raf.tick();
  raf.tick();

  const timeAtPause = player.getTime();
  player.pause();

  // Resume
  player.play();
  assert("state is playing again after resume", player.getState(), "playing");
  raf.tick();
  raf.tick();

  assert("time advanced after resume", player.getTime() > timeAtPause, true);

  player.dispose();
}

console.log("\n--- createPlayer: reset ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();

  const states: PlayerState[] = [];
  const player = createPlayer(canvas, prepared, {
    onStateChange: (s) => states.push(s),
  });

  player.play();
  raf.tick();
  raf.tick();
  raf.tick();

  player.reset();
  assert("state is idle after reset", player.getState(), "idle");
  assert("time is 0 after reset", player.getTime(), 0);
  assert("no RAF pending after reset", raf.pendingCount(), 0);

  player.dispose();
}

console.log("\n--- createPlayer: seek ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();

  const times: number[] = [];
  const player = createPlayer(canvas, prepared, {
    onTimeUpdate: (t) => times.push(Math.round(t * 100) / 100),
  });

  // Seek while idle
  player.seek(0.5);
  assert("time is 0.5 after seek", Math.round(player.getTime() * 10) / 10, 0.5);

  // Seek clamps to [0, duration]
  player.seek(-1);
  assert("seek(-1) clamps to 0", player.getTime(), 0);

  player.seek(999);
  assert("seek(999) clamps to duration", player.getTime(), 1.0);

  // Seek into ended state moves to paused
  raf.tickAll(); // run to end
  player.play();
  raf.tickAll();
  assert("reached ended state", player.getState(), "ended");
  player.seek(0.3);
  assert("seek from ended moves to paused", player.getState(), "paused");

  player.dispose();
}

console.log("\n--- createPlayer: replay after ended ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared);

  player.play();
  raf.tickAll();
  assert("ended", player.getState(), "ended");

  // Play again from ended should restart
  player.play();
  assert("state is playing again", player.getState(), "playing");
  assert("time reset to 0", player.getTime(), 0);

  player.dispose();
}

console.log("\n--- createPlayer: invalid transitions are no-ops ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared);

  // pause() while idle → no-op
  player.pause();
  assert("pause while idle → still idle", player.getState(), "idle");
  assert("no RAF scheduled", raf.pendingCount(), 0);

  // play twice → only one RAF handle
  player.play();
  player.play(); // second play while already playing → no-op
  assert("double play → still playing", player.getState(), "playing");
  assert("only 1 RAF handle (not 2)", raf.pendingCount(), 1);

  player.dispose();
}

console.log("\n--- createPlayer: onStateChange fires correctly ---");
{
  const raf = installMockRaf();
  const { canvas } = makeMockCanvas();

  const log: PlayerState[] = [];
  const player = createPlayer(canvas, prepared, {
    onStateChange: (s) => log.push(s),
  });

  player.play();       // → playing
  player.pause();      // → paused
  player.play();       // → playing
  player.reset();      // → idle
  player.play();       // → playing
  raf.tickAll();       // → ended

  assert("state changes: playing", log[0], "playing");
  assert("state changes: paused", log[1], "paused");
  assert("state changes: playing", log[2], "playing");
  assert("state changes: idle (reset)", log[3], "idle");
  assert("state changes: playing", log[4], "playing");
  assert("state changes: ended", log[5], "ended");

  player.dispose();
}

// ─── defaultVarValues ────────────────────────────────────────────────────────

console.log("\n--- defaultVarValues ---");
{
  const vars: Variables = {
    speed:  { default: 1.5, min: 0, max: 5 },
    scale:  { default: 100, min: 10, max: 200, step: 10 },
    phase:  { default: 0,   min: -3.14, max: 3.14, step: 0.01 },
  };
  const dv = defaultVarValues(vars);
  assert("speed default = 1.5",  dv["speed"]!,  1.5);
  assert("scale default = 100",  dv["scale"]!,  100);
  assert("phase default = 0",    dv["phase"]!,  0);
  assert("empty variables → empty object", Object.keys(defaultVarValues({})).length, 0);
}

// ─── createPlayer: setVariables / getVariables ───────────────────────────────

console.log("\n--- createPlayer: setVariables ---");
{
  installMockRaf();
  const { canvas } = makeMockCanvas();
  const player = createPlayer(canvas, prepared, {}, { x: 1, y: 2 });

  // getVariables returns a copy of initial vars
  const vars = player.getVariables();
  assert("getVariables: x=1",  vars["x"]!, 1);
  assert("getVariables: y=2",  vars["y"]!, 2);

  // setVariables replaces the values
  player.setVariables({ x: 99, y: 0, z: 42 });
  const updated = player.getVariables();
  assert("after setVariables: x=99", updated["x"]!, 99);
  assert("after setVariables: z=42", updated["z"]!, 42);

  // getVariables returns a defensive copy — mutating it doesn't affect player
  updated["x"] = 0;
  assert("getVariables copy is independent", player.getVariables()["x"]!, 99);

  // setVariables while playing doesn't crash and re-renders
  player.play();
  player.setVariables({ x: 7 });
  assert("setVariables while playing: state still playing", player.getState(), "playing");
  assert("setVariables while playing: vars updated", player.getVariables()["x"]!, 7);

  player.dispose();
}

console.log("\n--- createPlayer: initialVars from spec defaults ---");
{
  installMockRaf();
  const { canvas } = makeMockCanvas();

  const specWithVars: AnimSpec = {
    ...minimalSpec,
    variables: {
      speed: { default: 2.5, min: 0, max: 10 },
      color: { default: 128, min: 0, max: 255 },
    },
  };

  const prepared2 = prepareScene(specWithVars);
  const initVars = defaultVarValues(specWithVars.variables ?? {});
  const player = createPlayer(canvas, prepared2, {}, initVars);

  const vars = player.getVariables();
  assert("spec default: speed=2.5", vars["speed"]!, 2.5);
  assert("spec default: color=128", vars["color"]!, 128);

  player.dispose();
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
