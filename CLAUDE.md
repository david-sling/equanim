# Equanim

## What is this project?

A math-equation-driven animation spec. Everything is a parametric function of time. The spec is designed to be AI-generatable, declarative (data, not code), and renderer-agnostic.

**The spec lives in [`spec.md`](spec.md).** That document is the source of truth for the JSON format, primitive types, expression syntax, coordinate system, and the hello world example.

---

## Renderer

Located in `renderer/`. Built with TypeScript + Vite + mathjs.

### Running

```bash
cd renderer
npm install
npx vite          # dev server
```

### Architecture

| File               | Responsibility                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `src/types.ts`     | TypeScript interfaces mirroring the spec schema                                                    |
| `src/evaluator.ts` | mathjs expression compiler; builds per-object evaluators from `params` + `functions` + `variables` |
| `src/render.ts`    | Coordinate transform, scene preparation, per-frame draw logic                                      |
| `src/player.ts`    | `requestAnimationFrame` loop, play/pause/reset state machine                                       |
| `src/main.ts`      | Entry point; wires canvas, transport controls, variable sliders                                    |
| `specs/`           | Example spec JSON files                                                                            |

### Tests

Each core module has a companion test file. Run individually with `npx tsx`:

```bash
npx tsx src/evaluator.test.ts
npx tsx src/render.test.ts
npx tsx src/player.test.ts
```

179 assertions total, all passing.

### Coordinate system

Canvas is y-down. Spec is y-up (cartesian). Renderer flips:

```
canvas_x = width/2  + spec_x
canvas_y = height/2 - spec_y
```

---

## What comes next

1. Add 2–3 more example specs (circle, text fade, easing demo)
2. Each example stress-tests and refines the spec
3. Promote `spec.md` to a formal versioned document
4. Test AI generation: give `spec.md` to an LLM, prompt it to generate new animations
5. Build template library infrastructure
