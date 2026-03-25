import type { AnimSpec } from "./types.js";
import { prepareScene } from "./render.js";
import { createPlayer } from "./player.js";
import type { PlayerState } from "./player.js";

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const playBtn = document.getElementById("btn-play") as HTMLButtonElement;
const pauseBtn = document.getElementById("btn-pause") as HTMLButtonElement;
const resetBtn = document.getElementById("btn-reset") as HTMLButtonElement;
const timeDisplay = document.getElementById("time-display") as HTMLSpanElement;
const seekBar = document.getElementById("seek-bar") as HTMLInputElement;
const stateDisplay = document.getElementById("state-display") as HTMLSpanElement;
const specInput = document.getElementById("spec-input") as HTMLTextAreaElement;
const loadBtn = document.getElementById("btn-load") as HTMLButtonElement;
const errorDisplay = document.getElementById("error-display") as HTMLDivElement;

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer = createPlayer(
  canvas,
  prepareScene(await loadDefaultSpec()),
  { onStateChange: updateUI, onTimeUpdate: updateTime }
);

// ─── Default spec loader ──────────────────────────────────────────────────────

async function loadDefaultSpec(): Promise<AnimSpec> {
  const res = await fetch("./specs/dampened-wave.json");
  if (!res.ok) throw new Error("Failed to load default spec");
  return res.json() as Promise<AnimSpec>;
}

// ─── UI update ────────────────────────────────────────────────────────────────

function updateUI(state: PlayerState): void {
  stateDisplay.textContent = state;
  stateDisplay.className = `state-badge state-${state}`;

  playBtn.disabled = state === "playing";
  pauseBtn.disabled = state !== "playing";
  resetBtn.disabled = false;
}

function updateTime(t: number): void {
  const duration = currentPlayer ? parseFloat(seekBar.max) : 3;
  timeDisplay.textContent = `${t.toFixed(2)}s`;
  seekBar.value = String(t);
  // Don't fight the user if they're dragging
  if (document.activeElement !== seekBar) {
    seekBar.value = String(t);
  }
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

function loadSpec(jsonText: string): void {
  errorDisplay.textContent = "";
  errorDisplay.style.display = "none";

  let spec: AnimSpec;
  try {
    spec = JSON.parse(jsonText) as AnimSpec;
  } catch (e) {
    showError(`JSON parse error: ${(e as Error).message}`);
    return;
  }

  try {
    currentPlayer.dispose();
    const prepared = prepareScene(spec);
    canvas.width = spec.meta.width;
    canvas.height = spec.meta.height;
    seekBar.max = String(spec.meta.duration);

    currentPlayer = createPlayer(canvas, prepared, {
      onStateChange: updateUI,
      onTimeUpdate: updateTime,
    });

    updateUI("idle");
    updateTime(0);
  } catch (e) {
    showError(`Spec error: ${(e as Error).message}`);
  }
}

function showError(msg: string): void {
  errorDisplay.textContent = msg;
  errorDisplay.style.display = "block";
}

// ─── Event listeners ──────────────────────────────────────────────────────────

playBtn.addEventListener("click", () => currentPlayer.play());
pauseBtn.addEventListener("click", () => currentPlayer.pause());
resetBtn.addEventListener("click", () => currentPlayer.reset());

seekBar.addEventListener("input", () => {
  currentPlayer.seek(parseFloat(seekBar.value));
});

loadBtn.addEventListener("click", () => {
  loadSpec(specInput.value.trim());
});

// Allow drag-and-drop JSON files onto the canvas
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadSpec(reader.result as string);
  reader.readAsText(file);
});
