# AnimSpec — Renderer Build Handoff

## What is this project?

A math-equation-driven animation spec for explainer videos. Everything is a parametric function of time. The spec is designed to be AI-generatable, declarative (data, not code), and renderer-agnostic. This document contains everything needed to build the first reference renderer.

---

## The Spec (v0.1 Draft)

The spec is a JSON file. The renderer consumes it and produces an animation.

### Top-level structure

```json
{
  "spec": "animspec/0.1",
  "meta": { ... },
  "scene": { ... }
}
```

### `meta` block

| Field               | Type   | Description                       |
| ------------------- | ------ | --------------------------------- |
| `title`             | string | Human-readable name               |
| `duration`          | number | Total animation length in seconds |
| `width`             | number | Output width in px                |
| `height`            | number | Output height in px               |
| `fps`               | number | Frames per second                 |
| `coordinate_system` | string | Always `"cartesian"` for now      |
| `origin`            | string | `"center"` or `"top-left"`        |

### `scene` block

```json
"scene": {
  "id": "root",
  "objects": [ ...array of primitives... ]
}
```

Scenes can be nested. A scene inside a scene inherits a local time `t` that runs 0→1 over its own duration. Speed scaling via a `speed` multiplier (e.g. `0.8`, `1.5`) will be supported.

---

## Primitive Types

### `parametric_path`

A path where every point is computed from equations. The spatial parameter `s` sweeps across a domain, and `x(s,t)` and `y(s,t)` define where each point lands at time `t`.

```json
{
  "id": "wave",
  "type": "parametric_path",
  "style": {
    "stroke": "#4af",
    "stroke_width": 2.5,
    "fill": "none"
  },
  "domain": {
    "s": [-500, 500],
    "samples": 800
  },
  "equations": {
    "x": "s",
    "y": "A(t) * E(s,t) * sin(k*s - omega*t)"
  },
  "params": {
    "k": 0.018,
    "omega": 6.28
  },
  "functions": {
    "A(t)": "80 * exp(-1.8 * t)",
    "E(s,t)": "clamp(omega*t - abs(k*s), 0, 1)"
  },
  "timeline": {
    "start": 0.0,
    "end": 3.0
  }
}
```

**Rendering logic:**

1. For each frame at time `t`, iterate `s` from `domain.s[0]` to `domain.s[1]` in `samples` steps
2. Evaluate `x(s,t)` and `y(s,t)` for each step
3. Draw a polyline through all resulting points

### `line`

A static or animated straight line.

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
  "timeline": {
    "start": 0.0,
    "end": 3.0
  }
}
```

Any equation value can be a constant string (`"0"`) or a time-varying expression (`"100 * sin(t)"`).

### Other planned primitives (not needed for hello world)

- `circle` — cx, cy, r as equations
- `rect` — x, y, width, height as equations
- `text` — position, content, font, size
- `group` — container for transforming multiple objects together

---

## Expression Syntax

Equations are math expression strings. The renderer must evaluate them at runtime.

### Variables available in expressions

| Variable | Meaning                                            |
| -------- | -------------------------------------------------- |
| `t`      | Current time in seconds (global or local to scene) |
| `s`      | Spatial parameter (only in `parametric_path`)      |

### Required math builtins

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

Named constants scoped to the object. Referenced by name in equations.

### `functions` block

Named sub-expressions that can take arguments. E.g. `"A(t)": "80 * exp(-1.8 * t)"`. These are inlined/evaluated when the parent equation is evaluated.

**Suggested library:** Use [mathjs](https://mathjs.org/) for expression parsing and evaluation. It handles all builtins above and supports custom function definitions.

---

## The Hello World: Dampened Wave

This is the first thing the renderer must successfully render. Use this JSON to validate end-to-end.

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
  "scene": {
    "id": "root",
    "objects": [
      {
        "id": "wave",
        "type": "parametric_path",
        "style": {
          "stroke": "#4af",
          "stroke_width": 2.5,
          "fill": "none"
        },
        "domain": {
          "s": [-500, 500],
          "samples": 800
        },
        "equations": {
          "x": "s",
          "y": "A(t) * E(s,t) * sin(k*s - omega*t)"
        },
        "params": {
          "k": 0.018,
          "omega": 6.28
        },
        "functions": {
          "A(t)": "80 * exp(-1.8 * t)",
          "E(s,t)": "clamp(omega*t - abs(k*s), 0, 1)"
        },
        "timeline": {
          "start": 0.0,
          "end": 3.0
        }
      },
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
        "timeline": {
          "start": 0.0,
          "end": 3.0
        }
      }
    ]
  }
}
```

---

## Renderer Requirements

### Stack recommendation

- **Runtime:** Browser (HTML5 Canvas or SVG)
- **Language:** TypeScript
- **Expression evaluator:** mathjs
- **Bundler:** Vite

### What the renderer must do

1. Parse the JSON spec
2. For each frame `t` from `0` to `meta.duration` at `meta.fps`:
   - For each object in `scene.objects`, check if `t` is within `timeline.start` and `timeline.end`
   - Evaluate equations using mathjs with `t`, `s`, `params`, and `functions` in scope
   - Draw the result to canvas
3. Coordinate transform: if `origin` is `"center"`, offset all x/y by `(width/2, height/2)` and flip y axis (cartesian y-up vs canvas y-down)
4. Export as video (mp4 or webm) or play back in browser

### Coordinate system note

Canvas is y-down. Cartesian is y-up. The renderer must flip: `canvas_y = height/2 - spec_y`

### Playback loop (pseudocode)

```
let t = 0
const dt = 1 / meta.fps

function frame() {
  clearCanvas()
  for each object in scene.objects:
    if t >= object.timeline.start && t <= object.timeline.end:
      renderObject(object, t)
  t += dt
  if t < meta.duration: requestAnimationFrame(frame)
}
```

---

## Open Questions (to resolve as you build)

- [ ] How are `functions` with arguments parsed by mathjs? Test this early.
- [ ] Should `samples` be adaptive (more samples where curvature is high)?
- [ ] How does scene nesting work — does the child get a local `t` from 0→1?
- [ ] What's the export format? Canvas `captureStream()` + MediaRecorder for webm is easiest.
- [ ] Should the renderer validate the spec and return helpful errors?

---

## What comes after the renderer

Once the hello world renders correctly:

1. Add 2-3 more example specs (circle, text fade, easing demo)
2. Each example will stress-test and refine the spec
3. Write the formal spec document
4. Test AI generation: give the spec doc to an LLM and prompt it to generate new animations
5. Build template library infrastructure (GitHub repo structure first)
