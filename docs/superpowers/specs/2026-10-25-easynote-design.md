# easyNote — Design Spec

Date: 2026-10-25 · Status: awaiting review · Repo: https://github.com/AmshuKM/easyNote

## 1. Goal

A web whiteboard and note-taking app inspired by iPad Notes and Math Notes. It must work with a mouse, a finger or a stylus on desktop, iPad and phone, in light and dark mode. It ships as a static site with no build step and deploys to GitHub Pages.

**Success criteria**
- Every feature in §3 works and is covered by the tests in §7.
- Offline recognition reads the user's **real** handwriting (§6). The accuracy on the user's samples is measured and reported.
- All tests pass, and the user has seen the running app and approved it, before anything is pushed.

**Decisions already made with the user**
- This is a **rebuild from scratch**. No code from the existing repo is reused.
- The push is **one new commit on top of the existing `main`**, with no force-push.
- The stroke data in the 3 old fixtures (`user-math-1`, `user-graph-tablet`, `user-graph-phone`) **may be used as test data** only.
- A plain cross is read **from context** (§6.5).
- Training uses **approach A**: data is generated in Node with the app's own rasterizer, and the model is trained in Python/PyTorch on CPU with int8 export.

## 2. Architecture

The app is plain ES modules served as static files. Each module has one purpose and a small interface. Pure logic (no DOM) lives in modules that `node:test` can import directly.

```
index.html, css/app.css, manifest.webmanifest
js/
  main.js                 bootstraps app, wires modules
  core/   geom.js          vectors, bbox, resampling, PCA, percentile
          stroke.js        stroke model {id, pts:[x,y,p,t], color, width, tool}
          history.js       undo/redo of document operations
          doc.js           document: strokes, answers, graph cards, mode
  canvas/ viewport.js      pan/zoom transform, infinite canvas
          input.js         Pointer Events, pen/touch/mouse, palm rejection, gestures
          render.js        variable-width ink rendering (pressure → width), highlighter
          tools.js         pen, highlighter, eraser, lasso, hand
          lasso.js         selection: move, duplicate, recolor, delete
  shapes/ fit.js           line, arrow, polyline, triangle, rect, polygon, circle, ellipse fitting
          snap.js          hold-to-snap, large-shape snap on release, hand-drawn blend
  script/ smartscript.js   Notes: deskew, baseline, size/spacing, smoothing; Math: smoothing only
  recog/  raster.js        strokes → 28×28 MNIST-style bitmap (shared with training)
          cnn.js           int8 CNN inference in plain JS
          segment.js       line grouping, slant leveling, character segmentation
          symbols.js       geometric rules: = − . ÷ and their guards
          context.js       whole-line rules (y, f, brackets, cross, + → x)
          reader.js        pipeline: strokes → tokens with confidence
  math/   parse.js         tokenizer, parser, evaluator, variables, functions
          format.js        ≤ 7 significant digits
          answer.js        writes answers in the user's own digit shapes
          glyphs.js        fallback digit strokes before any digits are learned
  graph/  plot.js          shared function plotting and framing
          cards.js         inline graph cards: layout, column stacking, phone fallback
          window.js        floating graph window: drag, resize, pan/zoom, trace, sliders
  notes/  storage.js       localStorage autosave, multiple notes
          export.js        PNG export and a dependency-free PDF writer
          settings.js      settings dialog
  ai/     claude.js        optional Claude vision via the vendored SDK
vendor/anthropic-sdk.mjs   official @anthropic-ai/sdk, bundled locally
models/cnn.json, cnn.bin   int8 weights and metadata
scripts/  serve.mjs, train/gen.mjs, train/train.py, trace/trace.mjs
tests/    *.test.js (node:test), e2e/*.spec.mjs (Playwright), fixtures/
.github/workflows/pages.yml
```

## 3. Features

### 3.1 Canvas and input
- **Infinite canvas.** Points are stored in world coordinates, and the viewport holds `{x, y, scale}`.
- **Pan.** Two-finger drag, wheel or trackpad scroll, space+drag, middle mouse button, or the hand tool.
- **Zoom.** Pinch, ctrl/⌘+wheel, or ctrl/⌘ with +, −, 0. The range is 0.1×–8×.
- **Palm rejection.** Once a `pen` pointer has been seen in the session, `touch` pointers only pan and zoom. Before that, a single touch draws and two touches pan.
- **Pen.** Pressure comes from `PointerEvent.pressure` when the device gives it. For a mouse, or a pen reporting 0.5 constantly, pressure is simulated from speed: faster means thinner, smoothed with an EMA. Ink is drawn as a filled variable-width outline built from the smoothed centreline, with round caps.
- **Highlighter** is translucent, uses a multiply blend in light mode and screen in dark, and draws under the ink.
- **Stroke eraser** removes any stroke the eraser path touches.
- **Lasso** gives a floating action bar with Move (drag), Duplicate, Recolor (palette) and Delete.
- **Undo/redo** covers every document operation: strokes, erase, lasso operations, shape snaps, Smart Script tidies, and answers.
- **Colors and sizes.** There are 8 colours, which adapt to dark mode (black ink renders white), and 3 sizes per tool.

### 3.2 Shape correction
- **Hold to snap.** If the pointer stays within 4 px for 450 ms at the end of a stroke, it snaps. Shapes with a bounding-box diagonal over 35% of the shorter viewport side snap on release.
- **Classes.** Line, arrow (a line plus a 2-segment head, in one stroke or as a following stroke), circle, ellipse, triangle, rectangle (including rotated), polygon (5–8 corners).
- **Fitting.** Lines use least squares. Circles and ellipses use algebraic fits with PCA for orientation. Polygons use corner detection on curvature plus least-squares sides. A shape is chosen only if its fit error is under its threshold; otherwise the stroke stays as drawn.
- **Human touch.** The final points are `ideal + 0.15 × smoothed(original − ideal)`, resampled to the ideal shape, and the original pressure profile is kept along the arc length.

### 3.3 Smart Script
- It runs 1.2 s after the last stroke and only on strokes that have settled. It is one undoable step.
- **Notes mode.** Group strokes into lines (§6.3), then for each line:
  - Deskew it to horizontal.
  - Fit a baseline and move each character cluster onto it.
  - Scale clusters whose height is more than ±25% from the line median toward the median (partial, 60%).
  - Even out the gaps between clusters toward the median gap (partial).
  - Smooth jitter with a Chaikin pass plus a light Gaussian.
  - Strokes keep their own shapes. No font is ever used.
- **Math mode.** Smoothing only. Characters are never moved or resized.
- Toggled in Settings.

### 3.4 Math mode
- A toolbar toggles Notes and Math. The mode applies to the note.
- **Reading.** After 700 ms idle, each line with changed strokes is re-read (§6). A line whose last token is `=` gets an answer.
- **Expressions.** Integers, decimals, `+ − × ÷ / * ^`, raised exponents (x²), brackets, implicit multiplication (`3a`, `2(x+1)`, `2sin(30)`), functions (`sin cos tan log ln sqrt`), `π`.
  - `log` is base 10.
  - Trig defaults to **degrees**, like Math Notes. There is a degrees/radians setting.
- **Variables.** `a = 5` defines `a` for lines below it on the page, ordered top to bottom. Redefining a variable updates its dependants live.
- **Output.** Answers have at most 7 significant digits and no trailing zeros. Errors such as division by zero or an undefined variable show a small "?" in ink colour instead of an answer.
- **Answer writing.**
  - Digits come from the user's own digit strokes, but only those read with confidence ≥ 0.95 and whose context agrees. Up to 5 samples per digit are kept per note, plus a global store in localStorage.
  - When no sample exists, a built-in glyph is used.
  - Answers are scaled to the median digit height of the line, use the line's pen width and colour, follow the line's slant angle, sit 0.3 em after the `=`, and get small random variation.
  - Answers are document objects, rewritten when the line changes.

### 3.5 Graphs
- A line that reads as `y = f(x)` or `f(x) = …` (also `g`, `h`) with `x` free gets a **graph card** to the right of the equation, one per equation. It updates whenever the line is re-read.
- **Stacking.** Cards for vertically adjacent equations line up in a column. They share one left edge (the right edge of the widest equation plus a margin) and the same width. Each card is vertically centred on its own equation, and the cards are pushed apart so they never overlap.
- **Phone.**
  - If the space to the right of the equation in the viewport is at least 120 px, the card shrinks to fit, between 120 and 220 px wide.
  - Otherwise it goes directly below the equation. Lines below are not moved; the card fades while overlapping ink is being written.
- **Pointer rules.**
  - The card body has `pointer-events: none`, so the canvas gets all input through it. Only the expand and close buttons accept pointer input.
  - While a stroke is being drawn, all cards fade to 15% opacity, so an equation can be continued straight through a card.
- **Expand** opens a floating window. It can be dragged by its header and resized from the corner. It supports pan/zoom inside the plot, a trace readout (x, y under the pointer, snapped to the curve), and sliders for every free variable other than x (range −10…10, step 0.1, default the defined value or 1).
- **Close** hides the card and leaves a small "Graph" chip. Tapping the chip brings the card back.
- **Framing.**
  - x runs from about −5 to 5, shifted to include the vertex or turning point and the y-intercept or x-intercept.
  - The y range comes from the curve sampled on that x range, with outliers clipped by percentile, padded by 10%, and always includes the y-intercept.
  - Axes have tick labels, and the curve is drawn in the equation's ink colour.

### 3.6 Notes, export and settings
- **Notes.** A sidebar has new, rename, delete (with confirm) and switch. Autosave goes to localStorage, debounced to 500 ms. Each note keeps its strokes, mode, viewport and answers.
- **Export.**
  - PNG: the content's bounding box at 2×, on the paper background.
  - PDF: a dependency-free writer that puts the ink in as vector paths, so it stays sharp.
- **Settings.** Smart Script on/off, shape snap on/off, angle unit, paper (blank/lined/grid/dots), theme (system/light/dark), show recognized text (debug overlay), Anthropic API key and model.

### 3.7 Claude (optional)
- When an API key is set, each changed math line is cropped to a PNG and sent to Claude vision for a transcription. A strict prompt asks for a single line in the app's token grammar.
- **Model** is `claude-opus-5-5` by default and can be changed in Settings.
- **SDK.** The official `@anthropic-ai/sdk` is bundled locally into `vendor/`, with `dangerouslyAllowBrowser`.
- **Fallback.** Any error, a timeout of 8 s, or an unparseable reply falls back silently to the offline reading. A small status dot shows which path was used.
- The key is stored only in localStorage, and Settings explains what is sent.

## 4. Data flow (Math mode)

1. pointerup leads to `doc.addStroke` and marks the line dirty.
2. After 700 ms idle, `reader.readLine(strokes)` returns tokens and confidences.
3. `context.js` rules run, then `parse.js` classifies the line: assignment, expression with `=`, equation, or text.
4. Variables are updated in top-to-bottom order.
5. Each expression with `=` gets an answer from `answer.js`, stored as a document object linked to its line.
6. Each equation creates or updates a card through `cards.js`.

Each result is keyed to a line id: the strokes' ids plus a hash of their bounding box. Changing a line re-runs steps 2–6 for that line and for lines that use its variables.

## 5. Error handling
- Recognition, parsing or plotting failures never throw into the UI. The line shows no answer, or "?" when the line ends in `=`.
- If localStorage is full or blocked, a non-blocking toast appears and the app keeps working in memory.
- Claude failures fall back offline (§3.7).
- Unsupported pressure is simulated.

## 6. Recognition

### 6.1 Rasterizer (`recog/raster.js`)
- One pure function, `rasterize(strokes) → Float32Array(784)`, shared by the app and the training generator.
- Steps:
  1. Normalise to fit a 20×20 box, keeping the aspect ratio. Thin marks such as 1 or − keep their aspect, with a minimum side.
  2. Draw anti-aliased with a stroke width proportional to the box size.
  3. Centre by centre of mass in 28×28.
  4. Apply a light blur.
- MNIST bitmaps get the same centre-of-mass and blur normalisation, so both sources match.

### 6.2 CNN (`recog/cnn.js`, `scripts/train/`)
- **Architecture:** conv 3×3×16 → ReLU → maxpool → conv 3×3×32 → ReLU → maxpool → dense 128 → ReLU → dense N. Weights are int8 with a scale per tensor, about 120 KB. Inference is plain JS, under 2 ms per character.
- **Classes:** digits 0–9, `+ − × ÷ = ( ) / . ^ √ π`, letters `a b c x y f g h s i n o t l e q r` (only those used in function names or as variables), and **reject**.
- **Training data:**
  - MNIST digits.
  - Synthetic symbols and letters drawn as strokes, then heavily distorted: affine, elastic, pressure-width variation, jitter, stroke-order and direction shuffle, partial over-tracing. They are rendered by `raster.js` in `gen.mjs`.
- **Personal styles:**
  - cursive x drawn as "ɔc" (1 or 2 strokes, with or without a loop),
  - looped y,
  - open-top 4,
  - 8 with an open top loop,
  - 7 with a crossbar,
  - 9 with a small head,
  - curly "∂-like" 2.
- **Reject class:**
  - slices of single characters (left or right 30–60%, top or bottom halves),
  - pairs of joined digits,
  - digit plus joined exponent,
  - scribbles.
- **Validation:** the MNIST test set, a held-out synthetic set, and the user fixtures. The user fixtures are **never** used for training. They are the honest test.

### 6.3 Segmentation and line grouping (`recog/segment.js`)
- **Character height** is the 85th percentile of stroke heights in a region, excluding dots and bars, rather than the median.
- **Line grouping.**
  - Strokes are clustered by vertical overlap and centre distance, relative to that height.
  - A raised exponent is a small stroke cluster whose bottom is above the line's mid-height and which sits just right of a base character. It is attached to that line as an exponent.
  - An exponent wrongly grouped with the line above is moved to the line it belongs to.
- **Levelling.** The slant is estimated by a robust fit through the bottoms of the character clusters, and the line is rotated level before it is read.
- **Characters** are clusters of horizontally overlapping strokes. Then:
  - **Split by recognition.** If a cluster is wider than 1.4× the character height, or a single stroke reads as reject, search candidate cut points (local minima of the vertical ink projection, and stroke-direction reversals). Keep the split that maximises the product of segment confidences, where no segment is reject.
  - **Merge by recognition.** Adjacent clusters merge if the union reads with higher confidence than the parts and the parts read as reject or low confidence. This handles a cursive x whose halves don't touch.

### 6.4 Symbol rules (`recog/symbols.js`)
- **=** is two near-parallel horizontal bars of similar length, stacked within one character height. A **short = bar is not a dot**: a dot needs an aspect near 1 and a tiny size.
- **÷** is a bar plus two **round** dots, one above and one below. The upper dot may sit up to 1.5 character heights above. A short stroke or bar is not a dot.
- **−** and **.** are told apart by aspect and size relative to the character height. A decimal point sits at the baseline between digits.

### 6.5 Line-context rules (`recog/context.js`)
These run over the CNN's top-3 alternatives per character, picking the best-scoring legal reading:
- `? = … x …`: the first character is `y`.
- `? ( x ) =`: the first character is `f` (or `g`/`h` when those are the top alternatives).
- An unmatched `(` or `)` that has `1` as an alternative becomes `1`.
- A `+`-looking mark directly before a raised digit becomes `x`.
- **Cross** (×-shaped). It is **multiply** when directly between two number tokens. It is the **variable x** when it follows a number and is followed by an operator, a bracket, an exponent or the end of the line, or when the line is an equation (`y = …`, `f(x) = …`).
- Function names come from letter runs: `sin cos tan log ln sqrt`.

### 6.6 Handwriting regression (`scripts/trace/`, `tests/`)
- **Tracing.** Read the image (PDF pages rasterised once into PNG fixtures) and threshold it. For each connected blob of ink, skeletonize it (Zhang–Suen), then walk the skeleton depth-first from an endpoint, preferring the straightest continuation at junctions. The width comes from a distance transform. Points are emitted in canvas coordinates as stroke fixtures.
- **Replay.**
  - Unit: through `reader.js` and `parse.js`.
  - e2e: injected as pointer events into the live app. The answers and cards that appear are checked.
- **Accuracy.** Character accuracy (edit distance) and line accuracy (exact match) against the ground truth below, reported per fixture and overall.

**Ground truth for `fixtures/user-sample-2026-10-25` (the user's PDF). Please correct anything wrong:**

| Line | Text | Expected result |
| --- | --- | --- |
| 1 | `0 1 2 3 4 5 6 7 8 9` | text (digits only) |
| 2 | `0 1 2 3 4 5 6 7 8 9` | text |
| 3 | `12 × 3 =` | 36 |
| 4 | `a = 3` (the word "then" is ignored as text) | defines a = 3 |
| 5 | `45 ÷ 5 =` | 9 |
| 6 | `5a + 1 =` | 16 |
| 7 | `7 − 2.5 =` | 4.5 |
| 8 | `2x² + x =` | ? (x undefined) |
| 9 | `7x − 1 =` (cross read as x, per §6.5) | ? (x undefined) |
| 10 | `2³ =` | 8 |
| 11 | `(6 + 4) / 2 =` | 5 |
| 12 | `200 200 200` (one stroke each; the stray top line on the 2nd and 3rd is not part of them) | text |
| 13 | `x² x² x²` (one stroke each) | text |
| 14 | `y = 3x²` | graph card |
| 15 | `f(x) = 2x + 1` | graph card |
| 16 | `y = 3x + 2` | graph card |
| 17 | `sin(30) =` | 0.5 (degrees) |
| 18 | `log(16) =` | 1.20412 |

For the old fixtures, the ground truth will be transcribed in the same way and shown to the user for confirmation.

## 7. Testing
- **Unit (`node --test`):**
  - parse/evaluate/format,
  - shape fitting for each class plus negatives,
  - rasterizer determinism,
  - CNN against reference outputs,
  - segmentation (percentile height, exponents, levelling, `=` vs dot, `÷` dots, split/merge),
  - context rules,
  - Smart Script (Notes changes geometry; Math changes only smoothness, with character bboxes within 1 px),
  - PDF writer (valid structure, parseable xref),
  - user-handwriting accuracy (with a threshold that must not regress).
- **e2e (Playwright, Chromium):**
  - draw and render,
  - hold-to-snap and release-snap,
  - math answers and variables,
  - several stacked equations giving cards that don't overlap and share the same width,
  - writing through a card,
  - expand, close and chip,
  - undo/redo, eraser, lasso,
  - persistence across reload,
  - PNG and PDF download,
  - phone viewport (375×812) card placement,
  - dark mode,
  - Claude path against a stubbed API, including fallback on error,
  - user fixtures replayed live.

## 8. Delivery
1. Build in this folder (`git init`, with the existing repo added as `origin`).
2. Run all tests and record the accuracy.
3. Show the user the running app in the browser pane.
4. **After the user approves**, fetch `origin/main`, make one commit on top of it that replaces the tree, and push. `.github/workflows/pages.yml` deploys to Pages; the Pages source must be "GitHub Actions".
5. The push needs the user's GitHub sign-in, because no credentials are stored on this machine.

## 9. Out of scope
Handwriting-to-text in Notes mode, collaboration and sync, image or PDF import, text boxes, and solving for an unknown (`2x + 1 = 7`). These are left out deliberately.
