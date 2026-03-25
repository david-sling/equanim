import type { Equanim, Variables, VarValues } from "./types.js";
import { prepareScene } from "./render.js";
import { createPlayer, defaultVarValues } from "./player.js";
import type { Player, PlayerState } from "./player.js";

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
const variablesPanel = document.getElementById(
  "variables-panel",
) as HTMLDivElement;

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer: Player;
let currentVars: VarValues = {};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const defaultSpec = await fetch("./specs/dampened-wave.json").then(
  (r) => r.json() as Promise<Equanim>,
);
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
    const prepared = prepareScene(spec);

    canvas.width = spec.meta.width;
    canvas.height = spec.meta.height;
    seekBar.max = String(spec.meta.duration);

    // Initialize variable values from spec defaults
    currentVars = defaultVarValues(spec.variables ?? {});
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
  playBtn.disabled = state === "playing";
  pauseBtn.disabled = state !== "playing";
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

// Drag-and-drop JSON files onto the canvas
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
