# easyNote

An intelligent whiteboard and note-taking app for the browser, inspired by the iPad's Notes and Math Notes. Write and draw with a mouse, trackpad, finger or stylus, and easyNote:

- **Snaps shapes, keeping a human touch.** Draw a circle, ellipse, rectangle, triangle, polygon or line and pause at the end of the stroke: it snaps to a clean shape but keeps a hint of your wobble and pen pressure. Large shapes snap automatically when you lift the pen.
- **Tidies your handwriting (Smart Script).** After you pause, each line is straightened, letters are sat on a common baseline, sizes and spacing are evened out and jitter is smoothed. It's still your own ink, not a font.
- **Solves handwritten math in your handwriting.** In **Math** mode, write `12 × 3 =` and the answer appears after the `=` in your own writing. It learns how you write each digit.
  - Variables: write `a = 5` and later lines can use `a` (`3a + 1 =` → `16`).
  - Powers (write the exponent raised, like `x²`, or use `^`), brackets, `÷ / × *`, decimals, `!`, `%`, `π`, `√`, `sin cos tan log ln sqrt abs exp`.
  - Graphs: write `y = 2x + 1` or `f(x) = x^2` and tap **Graph** to open a floating, draggable, resizable graph window with pan/zoom, a live trace readout and sliders for any variables the function uses.
- **Infinite canvas** with pan and zoom (scroll / trackpad pinch / two-finger touch), lasso select (move, duplicate, recolor, tidy, delete), eraser, highlighter, colors and pen sizes, and full undo/redo.
- **Notes are saved automatically** in your browser (multiple notes in the sidebar), and you can **export PNG or PDF**.
- **Light and dark mode**, phone, tablet and desktop layouts.

Everything runs **offline in the browser** with no build step and no dependencies. Math is read by a small neural network trained on real handwriting (MNIST) plus synthetic symbols, running directly in the page (~85 KB of weights, ~1.5 ms per character). Optionally, you can add your own Anthropic API key in **Settings** to have math lines read by Claude for higher accuracy on messy handwriting (see [Privacy](#privacy)).

## Run it

Any static file server works. With Node 18+:

```sh
npm start            # http://localhost:5173
```

Or open it on GitHub Pages: the included workflow (`.github/workflows/pages.yml`) publishes the app when you push to `main`. Enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## How to use

| Action | How |
| --- | --- |
| Snap a shape | Draw it and keep the pen still for about half a second before lifting |
| Undo / redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` (or the toolbar arrows) |
| Pan | Scroll, two-finger drag, middle/right mouse drag, hold `Space` and drag, or the hand tool |
| Zoom | `Ctrl/Cmd` + scroll, trackpad/touch pinch, `Ctrl/Cmd +` / `-`, `Ctrl/Cmd+0` to fit |
| Tools | `P` pen, `H` highlighter, `E` eraser, `L` lasso, `M` toggles Notes/Math |
| Selection | Lasso strokes, drag to move, then Duplicate / Tidy / Delete, or pick a color to recolor |
| Graph | Tap the **Graph** chip next to a `y = …` line, or the graph button in the toolbar |

With a stylus, fingers pan and zoom while the pen draws (simple palm rejection).

Settings (**⋯ → Settings**) let you toggle Smart Script, automatic shape correction, a "show recognized text" debugging overlay, the paper style, and Claude recognition.

## How it works

| File | Role |
| --- | --- |
| `js/app.js` | App controller: canvas input, tools, history, rendering, scheduling the smart passes |
| `js/shapes.js` | Fits lines, polylines, circles/ellipses (PCA) and polygons (corner detection + least-squares sides), then blends the ideal shape with a smoothed share of your original wobble |
| `js/classifier.js`, `js/raster.js` | Math character recognizer: strokes are rendered MNIST-style to 28×28 and read by a small CNN (2 conv + 2 dense layers, int8 weights in `models/`). It has a "not a character" class used to split joined-up digits |
| `js/recognizer.js` | `$P` point-cloud recognizer for letters (Smart Script in Notes mode) |
| `js/glyphs.js` | Stroke templates for digits, operators and letters (also used to write answers when it hasn't seen your digits yet) |
| `js/ink.js` | Groups strokes into lines and characters, levels slanted lines, splits joined-up digits by recognition, rules for `= - . ÷ ( ) /`, function names and superscripts |
| `js/beautify.js` | Smart Script: deskew, baseline, size and spacing normalisation, smoothing |
| `js/mathparse.js` | Tokenizer, parser and evaluator with implicit multiplication, functions, variables |
| `js/handwriting.js` | Writes answers using your own digit samples, with natural variation |
| `js/graph.js` | Floating graph window |
| `js/claude.js` | Optional Claude vision transcription (uses the official SDK, vendored in `vendor/`) |
| `js/storage.js`, `js/export.js` | localStorage persistence; PNG and a dependency-free PDF writer |

## Retraining the handwriting model

```sh
python -m venv venv && venv/bin/pip install "jax[cpu]" optax numpy pillow
node scripts/train/gen-synth.mjs data 5000 1500        # synthetic symbols, rendered like the app does
curl -o data/mnist.npz https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz
venv/bin/python scripts/train/train.py data             # ~6 min on a laptop CPU → models/
```

Current model: 98.4% on the MNIST test set (writers it never saw). `tests/real-handwriting.test.js` checks it against strokes traced from a real user's screenshot.

## Tests

```sh
npm test             # unit tests (node:test): math, shapes, recognition, Smart Script, export
npm run test:e2e     # browser tests with Playwright/Chromium: drawing, snapping, math, graph, undo, export…
```

The end-to-end tests need Playwright (`npm i --no-save playwright && npx playwright install chromium`). They draw synthetic handwriting with the mouse and check the app's behaviour, including the Claude path against a stubbed API.

## Privacy

Your notes never leave your browser. If you turn on Claude recognition, an image of each math line containing `=` is sent to the Anthropic API using **your** API key. The key is stored in this browser's localStorage and sent only to `api.anthropic.com`. Because the key lives in the page, only use it on a device you trust. The default model is `claude-opus-5-5`; you can change it in Settings.

## Limitations

- Offline recognition handles digits, operators and the variables `x y a b c n` best, including digits written joined-up. Very unusual shapes can still be misread (for example an `8` with an open top can read as `9`). Turn on **Show recognized text** in Settings to see what was read, or Claude recognition for messier writing.
- Fractions written as a stacked bar, and radicals spanning an expression, are not parsed offline. Write `(a+b)/c` and `sqrt(…)` instead, or use Claude recognition.
- Notes are stored per browser. Export PNG/PDF to keep copies.

## License

MIT. See [LICENSE](LICENSE). The bundled Anthropic SDK in `vendor/` is MIT-licensed by Anthropic, PBC.
