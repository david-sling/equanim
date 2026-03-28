# Equanim v0.1

A declarative, JSON-based animation specification. Every visual property is a math expression string evaluated at runtime. The spec is designed to be AI-generatable, renderer-agnostic, and human-readable.

![Double Pendulum](renderer/assets/double-pendulum.gif)

---

## Top-level structure

```json
{
  "spec": "equanim/0.1",
  "meta": { ... },
  "variables": { ... },
  "systems": [ ... ],
  "scene": { ... }
}
```

| Field       | Required | Description                                                   |
| ----------- | -------- | ------------------------------------------------------------- |
| `spec`      | yes      | Always `"equanim/0.1"`                                        |
| `meta`      | yes      | Canvas dimensions, fps, duration, coordinate system           |
| `variables` | no       | User-controllable runtime parameters (sliders)                |
| `systems`   | no       | Physics simulation systems. Processed before rendering.       |
| `scene`     | yes      | Visual objects to draw                                        |

---

## `meta` block

```json
"meta": {
  "title": "My Animation",
  "duration": 10.0,
  "width": 800,
  "height": 600,
  "fps": 60,
  "coordinate_system": "cartesian",
  "origin": "center"
}
```

| Field               | Type   | Description                                     |
| ------------------- | ------ | ----------------------------------------------- |
| `title`             | string | Human-readable name                             |
| `duration`          | number | Total animation length in seconds               |
| `width`             | number | Output width in pixels                          |
| `height`            | number | Output height in pixels                         |
| `fps`               | number | Frames per second                               |
| `coordinate_system` | string | Always `"cartesian"`                            |
| `origin`            | string | `"center"` (default) or `"top-left"`            |

With `origin: "center"`, (0, 0) is the canvas centre. With `origin: "top-left"`, (0, 0) is the top-left corner (no coordinate flip).

---

## `variables` block

Optional. Named numbers exposed as runtime controls. Variable values are available in every expression scope, overriding same-named entries in a `params` block.

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
| `min`     | number | yes      | Minimum value                                        |
| `max`     | number | yes      | Maximum value                                        |
| `step`    | number | no       | Increment. Defaults to `(max - min) / 100`           |

---

## `systems` block

Optional. Defines physics simulation systems integrated numerically before playback begins. Systems are non-renderable — they produce trajectory data, not pixels.

Each system's state variables are exposed as callable interpolation functions in every scene object's expression scope, using the naming convention `<id>_<var>(t_seconds)`.

**The argument to the interpolator is always in seconds.** Use `phys_y(t * d)` or `phys_y(root_t * root_d)`, never `phys_y(t)`.

### `ode_system`

Integrates a system of first-order ODEs over the full animation duration.

```json
"systems": [
  {
    "id": "phys",
    "type": "ode_system",
    "state": { "y": 180.0, "vy": 0.0 },
    "params": { "g": 980.0 },
    "derivatives": {
      "y":  "vy",
      "vy": "-g"
    },
    "events": [
      {
        "condition": "y - floor_y",
        "direction": "falling",
        "mutations": { "vy": "-e * vy" }
      }
    ],
    "solver": "rk4",
    "step": 0.001
  }
]
```

| Field         | Required | Description                                                              |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `id`          | yes      | Identifier. State vars exposed as `<id>_<var>(seconds)` in scene scope. |
| `type`        | yes      | Always `"ode_system"`                                                    |
| `state`       | yes      | Initial conditions: `{ varName: initialValue }`                          |
| `derivatives` | yes      | RHS expressions: `{ varName: "expression for d(var)/dt" }`              |
| `params`      | no       | Named number constants scoped to this system                             |
| `events`      | no       | Zero-crossing event triggers (see below)                                 |
| `solver`      | no       | Numerical method. Default and only current option: `"rk4"`              |
| `step`        | no       | Integration timestep in seconds. Smaller = more accurate. Default: `0.001` |

Derivative expressions have access to: all current state variable values, the system's `params`, and all spec `variables`.

### Events

Zero-crossing events fire when a `condition` expression changes sign during integration. At the crossing instant, `mutations` are applied simultaneously — all evaluated from the pre-mutation state. This makes velocity swaps in elastic collisions work correctly.

```json
"events": [
  {
    "condition": "y - floor_y",
    "direction": "falling",
    "mutations": { "vy": "-e * vy" }
  }
]
```

| Field       | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `condition` | Expression evaluated at each step. Event fires when it crosses zero.     |
| `direction` | `"rising"` (negative → positive), `"falling"` (positive → negative), or `"either"` |
| `mutations` | State assignments applied at the crossing: `{ varName: "expression" }`  |

Mutation expressions have access to the same scope as derivatives. At most one event fires per integration step. Multiple events are checked in order; the first matching one wins.

Multiple systems are allowed. Each runs independently; systems cannot reference each other's state.

---

## `scene` block

```json
"scene": {
  "id": "root",
  "objects": [ ...array of visual primitives... ]
}
```

`id` is conventionally `"root"` for the top-level scene. Objects are drawn in array order (later objects appear on top).

---

## Primitive types

### Shared fields

All primitives share:

| Field       | Type   | Required | Description                                                              |
| ----------- | ------ | -------- | ------------------------------------------------------------------------ |
| `id`        | string | yes      | Unique identifier within the spec                                        |
| `type`      | string | yes      | Primitive type: `"circle"`, `"line"`, `"parametric_path"`               |
| `style`     | object | no       | Visual style (stroke, fill, stroke_width)                                |
| `params`    | object | no       | Named number constants scoped to this object                             |
| `functions` | object | no       | Named sub-expressions callable from equations                            |
| `equations` | object | yes      | Math expression strings defining the primitive's geometry each frame     |
| `timeline`  | object | no       | Visibility window. Default: `{ "start": 0, "end": 1 }`                  |

**All equation values must be strings**, even constants. Write `"cx": "0"`, not `"cx": 0`.

**Style fields:**

| Field          | Type   | Description            |
| -------------- | ------ | ---------------------- |
| `stroke`       | string | CSS color string       |
| `stroke_width` | number | Line width in pixels   |
| `fill`         | string | CSS color or `"none"`  |

**Timeline:** Fractions of `meta.duration`. Both values are in [0, 1].

| Value | Meaning         |
| ----- | --------------- |
| `0`   | Animation start |
| `1`   | Animation end   |
| `0.5` | Halfway point   |

Examples for a 4-second animation:
- `{ "start": 0, "end": 1 }` → visible the whole time (0–4s)
- `{ "start": 0, "end": 0.5 }` → first half only (0–2s)
- `{ "start": 0.25, "end": 0.75 }` → middle half (1–3s)

When `timeline` is `{ "start": 0, "end": 1 }`, `t` equals `root_t` and `d` equals `root_d`.

---

### `circle`

Required equation keys: `cx`, `cy`, `r`

```json
{
  "id": "ball",
  "type": "circle",
  "style": { "fill": "#ff6644", "stroke": "#ff9977", "stroke_width": 2 },
  "equations": {
    "cx": "0",
    "cy": "amplitude * sin(2 * pi * t)",
    "r":  "20"
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

`cx` and `cy` are in spec coordinates and go through the coordinate transform. `r` is a scalar radius in spec units — not y-flipped.

---

### `line`

Required equation keys: `x1`, `y1`, `x2`, `y2`

```json
{
  "id": "baseline",
  "type": "line",
  "style": { "stroke": "#ffffff44", "stroke_width": 1 },
  "equations": {
    "x1": "-400",
    "y1": "0",
    "x2": "400",
    "y2": "0"
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

Any equation can be a constant string (`"0"`) or a time-varying expression.

---

### `parametric_path`

Required equation keys: `x`, `y`. Required extra field: `domain`.

A curve where each point is computed by sweeping the spatial parameter `s` across a range.

```json
{
  "id": "wave",
  "type": "parametric_path",
  "style": { "stroke": "#44aaff", "stroke_width": 2.5, "fill": "none" },
  "domain": { "s": [-400, 400], "samples": 800 },
  "params": { "k": 0.02, "omega": 4.0 },
  "equations": {
    "x": "s",
    "y": "amplitude * sin(k * s - omega * t * d)"
  },
  "timeline": { "start": 0.0, "end": 1.0 }
}
```

| Field     | Description                                                  |
| --------- | ------------------------------------------------------------ |
| `domain.s`| `[min, max]` — range of values `s` is swept across           |
| `samples` | Number of points computed and connected into a polyline      |

`s` is available only in `parametric_path` equations. At each frame, `s` steps linearly from `domain.s[0]` to `domain.s[1]` in `samples` steps, and the resulting (x, y) points are connected into a polyline.

**Progressive reveal pattern:** To draw a path that traces out over time (revealing history as the animation plays), use `s` as normalised time in [0, 1] and clamp it to the current playback position:

```json
"domain": { "s": [0, 1], "samples": 1000 },
"equations": {
  "x": "some_x_fn(clamp(s, 0, root_t) * root_d)",
  "y": "some_y_fn(clamp(s, 0, root_t) * root_d)"
}
```

This works because `s` sweeps [0, 1] while `root_t` is the current playback fraction — so points beyond the current time are clamped to the last known position, effectively hiding future trajectory.

---

### Planned primitives

- `rect` — `x`, `y`, `width`, `height` as equations
- `text` — position, content, font, size
- `group` — container for transforming multiple objects together

---

## Expression syntax

All equation values, function bodies, derivative expressions, event conditions, and mutation expressions are **math expression strings** evaluated by [mathjs](https://mathjs.org/).

### ID and name rules

Object `id` values, system `id` values, `params` keys, `variables` keys, and `functions` keys must all be valid identifiers: letters, digits, and underscores only; no hyphens; cannot start with a digit. This is because they are injected into expression scope as named variables.

### Variables in scope (scene objects)

| Name              | Value range | Description                                                   |
| ----------------- | ----------- | ------------------------------------------------------------- |
| `t`               | 0 → 1       | Normalised time over this object's own timeline window        |
| `d`               | seconds     | Duration of this object's timeline window in seconds          |
| `root_t`          | 0 → 1       | Normalised time over the full animation                       |
| `root_d`          | seconds     | Total animation duration (`meta.duration`)                    |
| `s`               | varies      | Spatial parameter — `parametric_path` only                    |
| _(params keys)_   | number      | Constants from this object's `params` block                   |
| _(variables keys)_| number      | Spec-level variables (override same-named params)             |
| `<id>_<var>(...)`  | function   | ODE interpolator — callable with a time in **seconds**        |

`t * d` = local seconds elapsed since the object's window started.
`root_t * root_d` = global seconds elapsed.

**Calling ODE interpolators:** Always pass seconds. Use `phys_y(t * d)` or `phys_y(root_t * root_d)`. Writing `phys_y(t)` is a common mistake — `t` is 0→1, not seconds.

### Math builtins

| Function / Constant  | Description                          |
| -------------------- | ------------------------------------ |
| `sin(x)`             | Sine (radians)                       |
| `cos(x)`             | Cosine (radians)                     |
| `tan(x)`             | Tangent (radians)                    |
| `asin(x)`            | Arcsine                              |
| `acos(x)`            | Arccosine                            |
| `atan(x)`            | Arctangent                           |
| `atan2(y, x)`        | Two-argument arctangent              |
| `exp(x)`             | e^x                                  |
| `log(x)`             | Natural logarithm                    |
| `log(x, base)`       | Logarithm with specified base        |
| `sqrt(x)`            | Square root                          |
| `abs(x)`             | Absolute value                       |
| `pow(x, n)`          | x to the power n (also: `x^n`)       |
| `floor(x)`           | Round down to integer                |
| `ceil(x)`            | Round up to integer                  |
| `round(x)`           | Round to nearest integer             |
| `mod(x, y)`          | Modulo (also: `x % y`)               |
| `min(a, b)`          | Minimum of two values                |
| `max(a, b)`          | Maximum of two values                |
| `clamp(x, lo, hi)`   | Clamp x to [lo, hi]                  |
| `sign(x)`            | −1, 0, or 1                          |
| `pi`                 | 3.14159…                             |
| `e`                  | 2.71828…                             |

### `params` block

Named number constants scoped to the object (or system). Good for fixed values that keep equations readable.

```json
"params": { "k": 0.018, "omega": 6.28, "radius": 20 }
```

### `functions` block

Named sub-expressions with arguments. Callable from any equation on the same object.

```json
"functions": {
  "A": { "args": ["ts"], "body": "amplitude * exp(-decay * ts)" },
  "envelope": { "args": ["s", "ts"], "body": "clamp(omega * ts - abs(k * s), 0, 1)" }
}
```

| Field  | Description                                                              |
| ------ | ------------------------------------------------------------------------ |
| `args` | Ordered argument names                                                   |
| `body` | Expression string. Has access to all scope variables plus the named args |

Functions are local to the object. They cannot be shared across objects.

---

## Coordinate system

Spec space is Cartesian (y-up). Renderers transform to canvas space (y-down):

```
canvas_x = width/2  + spec_x      (for origin="center")
canvas_y = height/2 - spec_y      (y-flip)
```

For `origin="top-left"`, no transform is applied — spec coordinates map directly to canvas coordinates.

A canvas of 800×600 with `origin="center"` has spec space ranging from x: −400 to 400, y: −300 to 300, with (0, 0) at center.

---

## Hello world: Double Pendulum

Real Lagrangian physics in a JSON file — no code, just ODEs and expressions. Live file: [`renderer/specs/double-pendulum.json`](renderer/specs/double-pendulum.json).

The physics lives in `systems`. The `ode_system` integrates the equations of motion (RK4, step=0.005s) over the full duration before playback. Each state variable — `th1`, `w1`, `th2`, `w2` — becomes a callable interpolator (`phys_th1(seconds)`, etc.) available in every scene object.

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
  "systems": [
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
    }
  ],
  "scene": {
    "id": "root",
    "objects": [
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
          "x1": "0",
          "y1": "y_off",
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
        "id": "bob1",
        "type": "circle",
        "style": { "fill": "#aaaacc", "stroke": "#ffffff33", "stroke_width": 1 },
        "params": { "y_off": 110 },
        "equations": {
          "cx": "L1*ppm*sin(phys_th1(t*d))",
          "cy": "y_off - L1*ppm*cos(phys_th1(t*d))",
          "r":  "10"
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
- [ ] `functions` referencing other `functions` — currently undefined behaviour
