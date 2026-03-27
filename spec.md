# Equanim v0.1

A declarative, JSON-based animation specification. Every visual property is a math expression evaluated at runtime. Four time/duration variables are always available in every expression: `t` (local 0→1), `d` (local seconds), `root_t` (global 0→1), and `root_d` (total seconds). Specs are designed to be AI-generatable, renderer-agnostic, and human-readable.

![Double Pendulum](renderer/assets/double-pendulum.gif)

---

## Top-level structure

```json
{
  "spec": "equanim/0.1",
  "meta": { ... },
  "variables": { ... },
  "scene": { ... }
}
```

---

## `meta` block

| Field               | Type   | Required | Description                                          |
| ------------------- | ------ | -------- | ---------------------------------------------------- |
| `title`             | string | yes      | Human-readable name                                  |
| `duration`          | number | yes      | Total animation length in seconds                    |
| `width`             | number | yes      | Output width in px                                   |
| `height`            | number | yes      | Output height in px                                  |
| `fps`               | number | yes      | Frames per second                                    |
| `coordinate_system` | string | yes      | Always `"cartesian"` for now                         |
| `origin`            | string | yes      | `"center"` or `"top-left"`                           |
| `background`        | string | no       | CSS color for the canvas background. Default `"#0a0a0f"` |

---

## `variables` block

Optional. Defines named values that are exposed to the user as runtime controls (sliders, inputs, etc.). Variable values are injected into every object's expression scope, overriding same-named entries in a `params` block.

```json
"variables": {
  "amplitude": { "label": "Amplitude",  "default": 80,  "min": 10, "max": 200, "step": 1 },
  "decay":     { "label": "Decay rate", "default": 1.8, "min": 0.1, "max": 6,  "step": 0.05 }
}
```

| Field     | Type   | Required | Description                                         |
| --------- | ------ | -------- | --------------------------------------------------- |
| `label`   | string | no       | Human-readable control label. Defaults to key name. |
| `default` | number | yes      | Initial value                                       |
| `min`     | number | yes      | Slider minimum                                      |
| `max`     | number | yes      | Slider maximum                                      |
| `step`    | number | no       | Slider step. Defaults to `(max - min) / 100`        |

Variables are intentionally format-agnostic — a consumer can render them as sliders, number inputs, dropdowns, or anything else.

---

## `scene` block

```json
"scene": {
  "id": "root",
  "objects": [ ...array of primitives... ]
}
```

Scenes can be nested. Speed scaling via a `speed` multiplier (e.g. `0.8`, `1.5`) is planned.

---

## Primitive types

### Shared fields

All primitives share these fields:

| Field       | Type   | Description                                                                        |
| ----------- | ------ | ---------------------------------------------------------------------------------- |
| `id`        | string | Unique identifier within the scene                                                 |
| `type`      | string | Primitive type name                                                                |
| `style`     | object | Visual style (see below)                                                           |
| `params`    | object | Named number constants scoped to this object                                       |
| `functions` | object | Named sub-expressions (see below)                                                  |
| `timeline`  | object | `{ "start": number, "end": number }` — fractions of total duration, both in [0, 1] |

**Timeline** values are normalised fractions of `meta.duration`, not absolute seconds. This keeps specs portable across different durations and makes relative timing relationships obvious at a glance.

| Value | Meaning         |
| ----- | --------------- |
| `0`   | Animation start |
| `1`   | Animation end   |
| `0.5` | Halfway point   |

Examples for a 4-second animation:

- `{ "start": 0, "end": 1 }` → visible the whole time (0–4s)
- `{ "start": 0, "end": 0.5 }` → first half only (0–2s)
- `{ "start": 0.25, "end": 0.75 }` → middle half (1–3s)

**Style fields:**

| Field          | Type   | Description           |
| -------------- | ------ | --------------------- |
| `stroke`       | string | CSS color string      |
| `stroke_width` | number | Line width in px      |
| `fill`         | string | CSS color or `"none"` |

---

### `parametric_path`

A path where every point is computed from equations. The spatial parameter `s` sweeps across a domain and `x(s,t,...)` / `y(s,t,...)` define where each point lands at a given time.

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

1. For each frame at global time `T`, iterate `s` from `domain.s[0]` to `domain.s[1]` in `samples` steps
2. Evaluate `x(s, t, ...)` and `y(s, t, ...)` for each step (all four time/duration variables are in scope)
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

Any equation value can be a constant (`"0"`) or a time-varying expression (`"100 * sin(t * pi)"` for a portable single-cycle sweep, `"100 * sin(root_t * 2 * pi)"` to sync to the full animation).

---

### `circle`

A filled or stroked circle defined by its centre and radius as equations.

```json
{
  "id": "ball",
  "type": "circle",
  "style": {
    "fill": "#ff6644",
    "stroke": "#ff9977",
    "stroke_width": 2
  },
  "equations": {
    "cx": "0",
    "cy": "-190 + radius + B(t * d)",
    "r": "radius"
  },
  "functions": {
    "p": { "args": ["ts"], "body": "(ts / sqrt(2 * h0 / g)) % 1" },
    "H": { "args": ["ts"], "body": "h0 * exp(-decay * ts)" },
    "B": { "args": ["ts"], "body": "H(ts) * 4 * p(ts) * (1 - p(ts))" }
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

`cx` and `cy` are in spec space and go through the standard coordinate transform. `r` is a scalar magnitude in spec units — it is not y-flipped. Negative values are treated as their absolute value.

---

### Planned primitives

- `rect` — `x`, `y`, `width`, `height` as equations
- `text` — position, content, font, size
- `group` — container for transforming multiple objects together

---

## Physics systems

Physics systems are non-renderable scene nodes that pre-compute trajectories before playback. Their state variables are exposed as callable interpolators in every sibling object's expression scope. All interpolators take **absolute seconds** as their argument (e.g. `t * d`).

### `ode_system`

Integrates a system of first-order ordinary differential equations (RK4). Good for smooth, continuous dynamics: pendulums, springs, orbital mechanics.

```json
{
  "id": "phys",
  "type": "ode_system",
  "state": { "th1": 2.0, "w1": 0.0, "th2": 2.5, "w2": 0.0 },
  "derivatives": {
    "th1": "w1",
    "w1":  "(-g*(2*m1+m2)*sin(th1) - ...) / (L1*(...))",
    "th2": "w2",
    "w2":  "(2*sin(th1-th2)*(...)) / (L2*(...))"
  },
  "solver": "rk4",
  "step": 0.005
}
```

| Field         | Type   | Description                                                    |
| ------------- | ------ | -------------------------------------------------------------- |
| `state`       | object | Initial values for each state variable                         |
| `derivatives` | object | One mathjs expression per state variable; its time derivative  |
| `solver`      | string | Integration method. Currently only `"rk4"` is supported        |
| `step`        | number | Integration step in seconds. Smaller = more accurate           |

**Exposed interpolators** (callable in sibling expressions):

`<id>_<var>(t_seconds)` — e.g. `phys_th1(t * d)`, `phys_w2(t * d)`

---

### `collision_system`

Simulates rigid-body collisions using a discrete-time impulse solver. Each step applies friction, integrates positions (Euler), resolves wall bounces, then resolves ball-ball contacts with multiple correction passes. Good for billiards, particle systems, and anything with hard contact cascades.

```json
{
  "id": "pool",
  "type": "collision_system",
  "bounds": { "x": [-360, 360], "y": [-165, 165] },
  "restitution": 0.85,
  "friction": 60,
  "step": 0.001,
  "delay": 0.5,
  "bodies": {
    "cue": { "x": -230, "y": 0, "vx": 0, "vy": 0, "r": 10, "m": 1 },
    "b1":  { "x":  120, "y": 0, "vx": 0, "vy": 0, "r": 10 }
  }
}
```

| Field         | Type          | Required | Description                                                       |
| ------------- | ------------- | -------- | ----------------------------------------------------------------- |
| `bounds`      | object        | no       | `{ "x": [min, max], "y": [min, max] }` — wall boundaries         |
| `restitution` | number/string | no       | Coefficient of restitution (0 = perfectly inelastic, 1 = elastic). Accepts a variable name. Default `0.9` |
| `friction`    | number/string | no       | Deceleration in px/s². Accepts a variable name. Default `80`     |
| `step`        | number        | no       | Simulation step in seconds. Default `0.002`                       |
| `delay`       | number        | no       | Seconds to hold all dynamic bodies at rest before physics begin. Default `0` |
| `bodies`      | object        | yes      | Named body definitions (see below)                               |

**Exposed interpolators** (callable in sibling expressions):

`<id>_<bodyId>_x(t_seconds)` and `<id>_<bodyId>_y(t_seconds)` — e.g. `pool_cue_x(t * d)`, `pool_b1_y(t * d)`

#### Body definition

Each body in `bodies` is a `CollisionBall`:

| Field       | Type          | Required | Description                                                       |
| ----------- | ------------- | -------- | ----------------------------------------------------------------- |
| `kinematic` | boolean       | no       | If `true`, the body follows a prescribed path (see below). Default: dynamic. |
| `x`         | number/string | yes      | Initial x position (dynamic) or x expression in `t` seconds (kinematic) |
| `y`         | number/string | yes      | Initial y position (dynamic) or y expression in `t` seconds (kinematic) |
| `vx`        | number/string | no       | Initial x velocity. Accepts a variable expression. Dynamic only. |
| `vy`        | number/string | no       | Initial y velocity. Accepts a variable expression. Dynamic only. |
| `r`         | number        | yes      | Radius in spec units                                              |
| `m`         | number        | no       | Mass. Default `1`. Ignored for kinematic bodies.                  |

**Kinematic bodies** (`kinematic: true`) follow a prescribed path — `x` and `y` are mathjs expression strings evaluated at each time step with `t` in **seconds** in scope (along with all spec `variables`). A kinematic body imparts elastic impulses to dynamic bodies on contact but is never pushed back — it behaves as though it has infinite mass. Position is never corrected; the path expression is authoritative.

This is the right model for a cue stick, a scripted paddle, or any animated surface that should drive physics without being driven by it.

```json
{
  "id": "stick_tip",
  "kinematic": true,
  "x": "-230 + cos(angle * pi / 180) * (min(cue_speed / (1 + restitution) * t, 80) - 60)",
  "y": "4   + sin(angle * pi / 180) * (min(cue_speed / (1 + restitution) * t, 80) - 60)",
  "r": 5
}
```

Note: `vx`/`vy`/`m` are unused for kinematic bodies. Velocity is derived from the position delta each step and used only for impulse calculations.

---

## Expression syntax

Equations are math expression strings evaluated at runtime using [mathjs](https://mathjs.org/).

### Variables in scope

Four time/duration variables are always available. They come in two pairs — local (relative to the object's own window) and global (relative to the full animation):

| Name     | Value range | Description                                               |
| -------- | ----------- | --------------------------------------------------------- |
| `t`      | 0 → 1       | Local normalised time over the object's own timeline window. `t=0` when the object enters; `t=1` when it exits. Default choice for portable animations. |
| `d`      | seconds     | Local duration — length of the object's own window in seconds. Multiply to convert: `t * d` = local seconds elapsed since the object started. |
| `root_t` | 0 → 1       | Global normalised time over the full animation (`T / meta.duration`). Use to sync effects across objects regardless of their individual windows. |
| `root_d` | seconds     | Total animation duration in seconds (`meta.duration`). Multiply to convert: `root_t * root_d` = global seconds elapsed. |

**When to use each:**

- `t` — default. Fade, ease, sweep — anything that should complete within the object's own window.
- `d` — when you need real seconds locally (e.g. a decay rate in units of per-second: `exp(-k * t * d)`).
- `root_t` — when multiple objects need to stay in sync with the whole animation regardless of their individual windows.
- `root_d` — when combining with `root_t` to express global durations, or for expressions that scale with total animation length.

**Future group scoping:** When groups are introduced, each group will expose its own `<group_id>_t` and `<group_id>_d` to its children, following the same pattern. Object and group IDs must therefore be valid identifiers: letters, digits, and underscores only; no hyphens; cannot start with a digit.

| Name       | Available in                    | Description                                              |
| ---------- | ------------------------------- | -------------------------------------------------------- |
| `t`        | all equations                   | Local normalised time 0→1 over this object's window      |
| `d`        | all equations                   | Local duration in seconds                                |
| `root_t`   | all equations                   | Global normalised time 0→1 over the full animation       |
| `root_d`   | all equations                   | Total animation duration in seconds                      |
| `s`        | `parametric_path`               | Spatial parameter swept across `domain.s`                |
| `t`        | kinematic body `x`/`y` exprs   | **Seconds elapsed** (not normalised). Kinematic paths live outside any object timeline, so absolute time is the natural unit. |
| _(params)_ | all equations                   | Keys from the object's `params` block                    |
| _(vars)_   | all equations + kinematic exprs | Keys from the spec's `variables` block (override params) |

### Math builtins

| Function             | Description                 |
| -------------------- | --------------------------- |
| `sin(x)`             | Sine                        |
| `cos(x)`             | Cosine                      |
| `tan(x)`             | Tangent                     |
| `exp(x)`             | e^x                         |
| `log(x)`             | Natural logarithm           |
| `abs(x)`             | Absolute value              |
| `sqrt(x)`            | Square root                 |
| `pow(x, n)`          | x to the power n            |
| `min(a, b)`          | Smaller of two values       |
| `max(a, b)`          | Larger of two values        |
| `clamp(x, lo, hi)`   | Clamp x between lo and hi   |
| `floor(x)`           | Round down to integer       |
| `ceil(x)`            | Round up to integer         |
| `pi`                 | 3.14159...                  |
| `e`                  | 2.71828...                  |

The full mathjs function set is available. The table above lists the most commonly used subset.

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

## Hello world: Double Pendulum

The canonical example. Real Lagrangian physics in a JSON file — no code, just ODEs and expressions. Live file: [`renderer/specs/double-pendulum.json`](renderer/specs/double-pendulum.json).

The `ode_system` node integrates the equations of motion (RK4, step=0.005s) before playback. Each state variable is exposed as a callable interpolator — `phys_th1(t*d)`, `phys_th2(t*d)` — available in every sibling object's expression scope.

```json
{
  "spec": "equanim/0.1",
  "meta": {
    "title": "Double Pendulum",
    "duration": 30.0,
    "width": 600,
    "height": 600,
    "fps": 60,
    "coordinate_system": "cartesian",
    "origin": "center"
  },
  "variables": {
    "L1":  { "label": "Arm 1 length (m)", "default": 2.5, "min": 0.5, "max": 5.0,  "step": 0.1 },
    "L2":  { "label": "Arm 2 length (m)", "default": 1.8, "min": 0.3, "max": 4.0,  "step": 0.1 },
    "m1":  { "label": "Bob 1 mass (kg)",  "default": 2.0, "min": 0.5, "max": 5.0,  "step": 0.1 },
    "m2":  { "label": "Bob 2 mass (kg)",  "default": 1.0, "min": 0.5, "max": 5.0,  "step": 0.1 },
    "g":   { "label": "Gravity (m/s²)",   "default": 9.8, "min": 1.0, "max": 30.0, "step": 0.1 },
    "ppm": { "label": "Pixels per metre", "default": 55,  "min": 20,  "max": 120,  "step": 5   }
  },
  "scene": {
    "id": "root",
    "objects": [
      {
        "id": "phys",
        "type": "ode_system",
        "state": { "th1": 2.0, "w1": 0.0, "th2": 2.5, "w2": 0.0 },
        "derivatives": {
          "th1": "w1",
          "w1":  "(-g*(2*m1+m2)*sin(th1) - m2*g*sin(th1-2*th2) - 2*sin(th1-th2)*m2*(w2^2*L2 + w1^2*L1*cos(th1-th2))) / (L1*(2*m1+m2 - m2*cos(2*(th1-th2))))",
          "th2": "w2",
          "w2":  "(2*sin(th1-th2)*(w1^2*L1*(m1+m2) + g*(m1+m2)*cos(th1) + w2^2*L2*m2*cos(th1-th2))) / (L2*(2*m1+m2 - m2*cos(2*(th1-th2))))"
        },
        "solver": "rk4",
        "step": 0.005
      },
      {
        "id": "trace",
        "type": "parametric_path",
        "style": { "stroke": "#44aaff55", "stroke_width": 1.5, "fill": "none" },
        "domain": { "s": [0, 1], "samples": 1500 },
        "params": { "y_off": 110 },
        "equations": {
          "x": "L1*ppm*sin(phys_th1(clamp(s,0,root_t)*root_d)) + L2*ppm*sin(phys_th2(clamp(s,0,root_t)*root_d))",
          "y": "y_off - L1*ppm*cos(phys_th1(clamp(s,0,root_t)*root_d)) - L2*ppm*cos(phys_th2(clamp(s,0,root_t)*root_d))"
        },
        "timeline": { "start": 0.0, "end": 1.0 }
      },
      {
        "id": "arm1",
        "type": "line",
        "style": { "stroke": "#9999bb", "stroke_width": 2.5 },
        "params": { "y_off": 110 },
        "equations": {
          "x1": "0", "y1": "y_off",
          "x2": "L1*ppm*sin(phys_th1(t*d))",
          "y2": "y_off - L1*ppm*cos(phys_th1(t*d))"
        },
        "timeline": { "start": 0.0, "end": 1.0 }
      },
      {
        "id": "arm2",
        "type": "line",
        "style": { "stroke": "#9999bb", "stroke_width": 2.5 },
        "params": { "y_off": 110 },
        "equations": {
          "x1": "L1*ppm*sin(phys_th1(t*d))",
          "y1": "y_off - L1*ppm*cos(phys_th1(t*d))",
          "x2": "L1*ppm*sin(phys_th1(t*d)) + L2*ppm*sin(phys_th2(t*d))",
          "y2": "y_off - L1*ppm*cos(phys_th1(t*d)) - L2*ppm*cos(phys_th2(t*d))"
        },
        "timeline": { "start": 0.0, "end": 1.0 }
      },
      {
        "id": "bob2",
        "type": "circle",
        "style": { "fill": "#ff7744", "stroke": "#ff994455", "stroke_width": 2 },
        "params": { "y_off": 110 },
        "equations": {
          "cx": "L1*ppm*sin(phys_th1(t*d)) + L2*ppm*sin(phys_th2(t*d))",
          "cy": "y_off - L1*ppm*cos(phys_th1(t*d)) - L2*ppm*cos(phys_th2(t*d))",
          "r":  "12"
        },
        "timeline": { "start": 0.0, "end": 1.0 }
      }
    ]
  }
}
```

---

## Open questions

- [ ] Scene nesting: does a child scene's `t` run over its own duration, or the parent's?
- [ ] Should `samples` be adaptive (more samples where curvature is high)?
- [ ] Export format: `captureStream()` + `MediaRecorder` for WebM is the path of least resistance
- [ ] Spec validation: should the renderer return structured errors on malformed specs?
- [ ] `functions` referencing other `functions` (recursive / mutually recursive) — currently undefined behaviour
