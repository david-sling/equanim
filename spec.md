# AnimSpec v0.1

A declarative, JSON-based animation specification. Every visual property is a math expression evaluated at time `t`. Specs are designed to be AI-generatable, renderer-agnostic, and human-readable.

---

## Top-level structure

```json
{
  "spec": "animspec/0.1",
  "meta": { ... },
  "variables": { ... },
  "scene": { ... }
}
```

---

## `meta` block

| Field               | Type   | Description                       |
| ------------------- | ------ | --------------------------------- |
| `title`             | string | Human-readable name               |
| `duration`          | number | Total animation length in seconds |
| `width`             | number | Output width in px                |
| `height`            | number | Output height in px               |
| `fps`               | number | Frames per second                 |
| `coordinate_system` | string | Always `"cartesian"` for now      |
| `origin`            | string | `"center"` or `"top-left"`        |

---

## `variables` block

Optional. Defines named values that are exposed to the user as runtime controls (sliders, inputs, etc.). Variable values are injected into every object's expression scope, overriding same-named entries in a `params` block.

```json
"variables": {
  "amplitude": { "label": "Amplitude",  "default": 80,  "min": 10, "max": 200, "step": 1 },
  "decay":     { "label": "Decay rate", "default": 1.8, "min": 0.1, "max": 6,  "step": 0.05 }
}
```

| Field     | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `label`   | string | no       | Human-readable control label. Defaults to key name.  |
| `default` | number | yes      | Initial value                                        |
| `min`     | number | yes      | Slider minimum                                       |
| `max`     | number | yes      | Slider maximum                                       |
| `step`    | number | no       | Slider step. Defaults to `(max - min) / 100`         |

Variables are intentionally format-agnostic — a consumer can render them as sliders, number inputs, dropdowns, or anything else.

---

## `scene` block

```json
"scene": {
  "id": "root",
  "objects": [ ...array of primitives... ]
}
```

Scenes can be nested. A child scene inherits a local `t` that runs 0→1 over its own duration. Speed scaling via a `speed` multiplier (e.g. `0.8`, `1.5`) is planned.

---

## Primitive types

### Shared fields

All primitives share these fields:

| Field      | Type   | Description                                      |
| ---------- | ------ | ------------------------------------------------ |
| `id`       | string | Unique identifier within the scene               |
| `type`     | string | Primitive type name                              |
| `style`    | object | Visual style (see below)                         |
| `params`   | object | Named number constants scoped to this object     |
| `functions`| object | Named sub-expressions (see below)                |
| `timeline` | object | `{ "start": number, "end": number }` — fractions of total duration, both in [0, 1] |

**Timeline** values are normalised fractions of `meta.duration`, not absolute seconds. This keeps specs portable across different durations and makes relative timing relationships obvious at a glance.

| Value | Meaning |
| ----- | ------- |
| `0`   | Animation start |
| `1`   | Animation end   |
| `0.5` | Halfway point   |

Examples for a 4-second animation:
- `{ "start": 0, "end": 1 }` → visible the whole time (0–4s)
- `{ "start": 0, "end": 0.5 }` → first half only (0–2s)
- `{ "start": 0.25, "end": 0.75 }` → middle half (1–3s)

**Style fields:**

| Field          | Type   | Description          |
| -------------- | ------ | -------------------- |
| `stroke`       | string | CSS color string     |
| `stroke_width` | number | Line width in px     |
| `fill`         | string | CSS color or `"none"`|

---

### `parametric_path`

A path where every point is computed from equations. The spatial parameter `s` sweeps across a domain and `x(s,t)` / `y(s,t)` define where each point lands at time `t`.

```json
{
  "id": "wave",
  "type": "parametric_path",
  "style": {
    "stroke": "#44aaff",
    "stroke_width": 2.5,
    "fill": "none"
  },
  "domain": {
    "s": [-500, 500],
    "samples": 800
  },
  "equations": {
    "x": "s",
    "y": "A(t) * E(s, t) * sin(k * s - omega * t)"
  },
  "functions": {
    "A": { "args": ["t"], "body": "amplitude * exp(-decay * t)" },
    "E": { "args": ["s", "t"], "body": "clamp(omega * t - abs(k * s), 0, 1)" }
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

**Rendering logic:**
1. For each frame at time `t`, iterate `s` from `domain.s[0]` to `domain.s[1]` in `samples` steps
2. Evaluate `x(s,t)` and `y(s,t)` for each step
3. Draw a polyline through all resulting points

---

### `line`

A static or animated straight line defined by two endpoints.

```json
{
  "id": "baseline",
  "type": "line",
  "style": {
    "stroke": "#ffffff22",
    "stroke_width": 1
  },
  "equations": {
    "x1": "-500",
    "y1": "0",
    "x2": "500",
    "y2": "0"
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

Any equation value can be a constant (`"0"`) or a time-varying expression (`"100 * sin(t)"`).

---

### Planned primitives

- `circle` — `cx`, `cy`, `r` as equations
- `rect` — `x`, `y`, `width`, `height` as equations
- `text` — position, content, font, size
- `group` — container for transforming multiple objects together

---

## Expression syntax

Equations are math expression strings evaluated at runtime using [mathjs](https://mathjs.org/).

### Variables in scope

| Name       | Available in         | Description                                      |
| ---------- | -------------------- | ------------------------------------------------ |
| `t`        | all equations        | Current time in seconds                          |
| `s`        | `parametric_path`    | Spatial parameter swept across `domain.s`        |
| *(params)* | all equations        | Keys from the object's `params` block            |
| *(vars)*   | all equations        | Keys from the spec's `variables` block (override params) |

### Math builtins

| Function             | Description                 |
| -------------------- | --------------------------- |
| `sin(x)`             | Sine                        |
| `cos(x)`             | Cosine                      |
| `exp(x)`             | e^x                         |
| `abs(x)`             | Absolute value              |
| `clamp(x, min, max)` | Clamp x between min and max |
| `sqrt(x)`            | Square root                 |
| `pow(x, n)`          | x to the power n            |
| `pi`                 | 3.14159...                  |

### `params` block

Named number constants scoped to the object. Good for fixed values that don't need to be user-controllable.

```json
"params": { "k": 0.018, "omega": 6.28 }
```

### `functions` block

Named sub-expressions that accept arguments. Evaluated inline when the parent equation references them.

```json
"functions": {
  "A": { "args": ["t"],      "body": "amplitude * exp(-decay * t)" },
  "E": { "args": ["s", "t"], "body": "clamp(omega * t - abs(k * s), 0, 1)" }
}
```

Each function definition has:
- `args` — ordered list of argument names (referenced positionally in call sites)
- `body` — expression string; has access to all scope variables plus the named args

> **Note on format:** Earlier drafts encoded the signature in the key (`"A(t)": "expr"`). This was dropped because it required regex-parsing keys and was ambiguous. The current `{ args, body }` format is explicit and unambiguous.

---

## Coordinate system

Spec space is Cartesian (y-up). Canvas space is y-down. Renderers must transform:

```
canvas_x = width/2  + spec_x      (for origin="center")
canvas_y = height/2 - spec_y      (y-flip)
```

For `origin="top-left"`, no transform is applied.

---

## Hello world: Dampened Wave

The canonical validation spec. Live file: [`renderer/specs/dampened-wave.json`](renderer/specs/dampened-wave.json).

```json
{
  "spec": "animspec/0.1",
  "meta": {
    "title": "Dampened Wave Propagation",
    "duration": 3.0,
    "width": 1000,
    "height": 600,
    "fps": 60,
    "coordinate_system": "cartesian",
    "origin": "center"
  },
  "variables": {
    "amplitude": { "label": "Amplitude",        "default": 80,   "min": 10,   "max": 200,  "step": 1    },
    "decay":     { "label": "Decay rate",        "default": 1.8,  "min": 0.1,  "max": 6,    "step": 0.05 },
    "k":         { "label": "Wave number",       "default": 0.018,"min": 0.005,"max": 0.08, "step": 0.001 },
    "omega":     { "label": "Angular frequency", "default": 6.28, "min": 1,    "max": 20,   "step": 0.1  }
  },
  "scene": {
    "id": "root",
    "objects": [
      {
        "id": "wave",
        "type": "parametric_path",
        "style": { "stroke": "#44aaff", "stroke_width": 2.5, "fill": "none" },
        "domain": { "s": [-500, 500], "samples": 800 },
        "equations": {
          "x": "s",
          "y": "A(t) * E(s, t) * sin(k * s - omega * t)"
        },
        "functions": {
          "A": { "args": ["t"],      "body": "amplitude * exp(-decay * t)" },
          "E": { "args": ["s", "t"], "body": "clamp(omega * t - abs(k * s), 0, 1)" }
        },
        "timeline": { "start": 0.0, "end": 1.0 }
      },
      {
        "id": "baseline",
        "type": "line",
        "style": { "stroke": "#ffffff22", "stroke_width": 1 },
        "equations": { "x1": "-500", "y1": "0", "x2": "500", "y2": "0" },
        "timeline": { "start": 0.0, "end": 1.0 }
      }
    ]
  }
}
```

---

## Open questions

- [ ] Scene nesting: does a child scene get local `t` from 0→1 over its duration, or raw seconds?
- [ ] Should `samples` be adaptive (more samples where curvature is high)?
- [ ] Export format: `captureStream()` + `MediaRecorder` for WebM is the path of least resistance
- [ ] Spec validation: should the renderer return structured errors on malformed specs?
- [ ] `functions` referencing other `functions` (recursive / mutually recursive) — currently undefined behaviour
