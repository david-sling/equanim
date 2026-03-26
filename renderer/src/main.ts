import type { Equanim, Variables, VarValues } from "./types.js";
import { prepareScene } from "./render.js";
import { createPlayer, defaultVarValues } from "./player.js";
import type { Player, PlayerState } from "./player.js";

import dampenedWave from "../specs/dampened-wave.json";
import bouncingBall from "../specs/bouncing-ball.json";
import doublePendulum from "../specs/double-pendulum.json";

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const playBtn = document.getElementById("btn-play") as HTMLButtonElement;
const pauseBtn = document.getElementById("btn-pause") as HTMLButtonElement;
const resetBtn = document.getElementById("btn-reset") as HTMLButtonElement;
const timeDisplay = document.getElementById("time-display") as HTMLSpanElement;
const seekBar = document.getElementById("seek-bar") as HTMLInputElement;
const stateDisplay = document.getElementById(
  "state-display",
) as HTMLSpanElement;
const specInput = document.getElementById("spec-input") as HTMLTextAreaElement;
const loadBtn = document.getElementById("btn-load") as HTMLButtonElement;
const errorDisplay = document.getElementById("error-display") as HTMLDivElement;
const specSelect = document.getElementById("spec-select") as HTMLSelectElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const openFileBtn = document.getElementById(
  "btn-open-file",
) as HTMLButtonElement;
const variablesPanel = document.getElementById(
  "variables-panel",
) as HTMLDivElement;
const exportBtn = document.getElementById("btn-export") as HTMLButtonElement;

// ─── Built-in specs ───────────────────────────────────────────────────────────

const BUILT_IN_SPECS: Record<string, Equanim> = {
  "dampened-wave": dampenedWave as Equanim,
  "bouncing-ball": bouncingBall as Equanim,
  "double-pendulum": doublePendulum as Equanim,
};

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer: Player;
let currentVars: VarValues = {};
let currentSpecTitle = "equanim";
let currentFps = 60;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const defaultSpec = BUILT_IN_SPECS["double-pendulum"]!;
specInput.value = JSON.stringify(defaultSpec, null, 2);
loadSpec(defaultSpec);

// ─── Variable UI ─────────────────────────────────────────────────────────────

function buildVariableSliders(variables: Variables): void {
  variablesPanel.innerHTML = "";

  const entries = Object.entries(variables);
  if (entries.length === 0) {
    variablesPanel.style.display = "none";
    return;
  }

  variablesPanel.style.display = "flex";

  for (const [key, def] of entries) {
    const step = def.step ?? (def.max - def.min) / 100;
    const value = currentVars[key] ?? def.default;

    const row = document.createElement("div");
    row.className = "var-row";

    const label = document.createElement("label");
    label.className = "var-label";
    label.textContent = def.label ?? key;
    label.htmlFor = `var-${key}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `var-${key}`;
    slider.className = "var-slider";
    slider.min = String(def.min);
    slider.max = String(def.max);
    slider.step = String(step);
    slider.value = String(value);

    const readout = document.createElement("span");
    readout.className = "var-readout";
    readout.textContent = formatValue(value, step);

    slider.addEventListener("input", () => {
      const newVal = parseFloat(slider.value);
      readout.textContent = formatValue(newVal, step);
      currentVars = { ...currentVars, [key]: newVal };
      currentPlayer.setVariables(currentVars);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(readout);
    variablesPanel.appendChild(row);
  }
}

/** Format a number to a reasonable number of decimal places based on step size. */
function formatValue(v: number, step: number): string {
  const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return v.toFixed(decimals);
}

// ─── Spec loading ─────────────────────────────────────────────────────────────

function loadSpec(spec: Equanim): void;
function loadSpec(jsonText: string): void;
function loadSpec(input: Equanim | string): void {
  errorDisplay.textContent = "";
  errorDisplay.style.display = "none";

  let spec: Equanim;
  if (typeof input === "string") {
    try {
      spec = JSON.parse(input) as Equanim;
    } catch (e) {
      showError(`JSON parse error: ${(e as Error).message}`);
      return;
    }
  } else {
    spec = input;
  }

  try {
    currentPlayer?.dispose();

    // Initialize variable values from defaults BEFORE prepareScene so that
    // ODE systems (which integrate during prepareScene) receive the correct
    // initial values for physics variables like g, m1, m2, L1, L2.
    currentVars = defaultVarValues(spec.variables ?? {});
    const prepared = prepareScene(spec, currentVars);

    currentSpecTitle = spec.meta.title ?? "equanim";
    currentFps = spec.meta.fps ?? 60;

    canvas.width = spec.meta.width;
    canvas.height = spec.meta.height;
    seekBar.max = String(spec.meta.duration);

    buildVariableSliders(spec.variables ?? {});

    currentPlayer = createPlayer(
      canvas,
      prepared,
      { onStateChange: updateUI, onTimeUpdate: updateTime },
      currentVars,
    );

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

// ─── UI updates ──────────────────────────────────────────────────────────────

function updateUI(state: PlayerState): void {
  stateDisplay.textContent = state;
  stateDisplay.className = `state-badge state-${state}`;
  const rec = isRecording();
  playBtn.disabled  = state === "playing" || rec;
  pauseBtn.disabled = state !== "playing"  || rec;
  resetBtn.disabled = rec;
  seekBar.disabled  = rec;
  // Stop recording when the animation naturally reaches the end
  if (state === "ended" && rec) finishRecording();
}

function updateTime(t: number): void {
  timeDisplay.textContent = `${t.toFixed(2)}s`;
  if (document.activeElement !== seekBar) {
    seekBar.value = String(t);
  }
}

// ─── Transport listeners ──────────────────────────────────────────────────────

playBtn.addEventListener("click", () => currentPlayer.play());
pauseBtn.addEventListener("click", () => currentPlayer.pause());
resetBtn.addEventListener("click", () => currentPlayer.reset());

seekBar.addEventListener("input", () => {
  currentPlayer.seek(parseFloat(seekBar.value));
});

loadBtn.addEventListener("click", () => {
  loadSpec(specInput.value.trim());
});

// Built-in spec selector
specSelect.addEventListener("change", () => {
  const spec = BUILT_IN_SPECS[specSelect.value];
  if (!spec) return;
  specInput.value = JSON.stringify(spec, null, 2);
  loadSpec(spec);
});

// File picker
openFileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    specInput.value = text;
    loadSpec(text);
    // Reset the input so the same file can be re-selected if needed
    fileInput.value = "";
  };
  reader.readAsText(file);
});

// ─── Export (canvas → WebM via MediaRecorder) ────────────────────────────────

let recorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordingStart = 0;

function isRecording(): boolean {
  return recorder !== null && recorder.state !== "inactive";
}

function finishRecording(): void {
  if (!recorder || recorder.state === "inactive") return;
  recorder.stop(); // triggers recorder.onstop asynchronously
}

exportBtn.addEventListener("click", () => {
  // If already recording, cancel it
  if (isRecording()) {
    finishRecording();
    return;
  }

  // Pick best supported codec
  const mimeType =
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm";

  recordedChunks = [];
  const stream = canvas.captureStream(currentFps);
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  recorder.onstop = () => {
    // Download the recorded blob
    const blob = new Blob(recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSpecTitle.toLowerCase().replace(/\s+/g, "-")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Reset recording state
    recorder = null;
    recordedChunks = [];
    if (recordingTimer !== null) { clearInterval(recordingTimer); recordingTimer = null; }
    exportBtn.textContent = "⬛ Export";
    exportBtn.classList.remove("recording");
    updateUI(currentPlayer.getState());
  };

  // Collect data in 200ms chunks so we don't lose frames if tab is backgrounded
  recorder.start(200);

  // Reset and play the animation from the beginning
  currentPlayer.reset();
  currentPlayer.play();

  // Update button to show live elapsed time; click again to cancel
  exportBtn.classList.add("recording");
  recordingStart = Date.now();
  recordingTimer = setInterval(() => {
    const s = ((Date.now() - recordingStart) / 1000).toFixed(1);
    exportBtn.textContent = `● ${s}s  ✕`;
  }, 200);
});

// ─── Drag-and-drop JSON files onto the canvas ────────────────────────────────
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    specInput.value = text;
    loadSpec(text);
  };
  reader.readAsText(file);
});
