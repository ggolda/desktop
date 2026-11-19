# Framework micro-benchmark — results

*Run 2026-11-18, owner's laptop (24 threads, 240 Hz), untouched during the run. Raw data:
`experiments/framework-bench/results/2026-11-18-full.json`, log `results/full-run.log`.
Setup and fairness rules: `experiments/framework-bench/README.md`.*

## Setup in one paragraph
Each framework renders the same three pages with identical DOM and classes, all checked against
screenshots:
- **editor**: 30 scenes, 60 sources, 4 mixer rows with 8 meter bars, and a stats footer;
- **settings**: 150 form fields;
- **rename**: a small dialog.

Each page runs in a sandboxed Electron 43 window. Data comes from a mock core in a `utilityProcess`
over a MessagePort:
- meters update 10 times per second and stats once per second;
- **busy** adds 20 source edits per second.

Build: Vite 8 and UnoCSS (Tailwind preset), production mode. Method: 3 runs per case, 8 s settle,
15 s sample; the tables show the median. Memory is the private working set, as shown in Task
Manager. CPU is % of the whole machine.

## Results (median of 3)
| fw | editor idle: renderer MB | editor busy: renderer MB | settings MB | rename MB | editor cold open ms | editor idle renderer CPU % | editor busy renderer CPU % | JS gzip KB (3 pages) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vanilla (floor) | 21.8 | 24.2 | 20.7 | 18.1 | 175 | 0.16 | 0.22 | 3.4 |
| Solid 1.9 | 24.4 | 29.5 | 23.6 | 15.2 | 177 | 0.17 | 0.23 | **10.1** |
| Preact 11 + signals | 26.3 | 29.3 | 23.0 | 15.5 | 179 | 0.15 | 0.24 | 11.2 |
| Svelte 5 | 24.7 | 28.1 | 25.1 | 15.8 | 177 | 0.16 | 0.28 | 19.1 |
| Vue 3.6 Vapor | 24.7 | 27.5 | 25.0 | 15.7 | 180 | 0.20 | 0.28 | 25.8 |
| Vue 3.6 | 26.9 | 29.3 | 25.5 | 16.0 | 175 | 0.17 | 0.26 | 30.1 |
| React 19 | 26.7 | 31.0 | 24.3 | 16.8 | 173 | 0.17 | 0.28 | 69.5 |

Other measurements:
- **GPU process CPU** on the editor is about 0.65–0.73 % for every framework, including vanilla.
- **Static pages** (settings, rename) use about 0 % CPU for every framework.
- **Cold open** for settings and rename is 202–230 ms for all of them.
- **Whole tree** for one window is 138–209 MB. It is dominated by the GPU process (77–125 MB) and the
  main process.

## What it means
1. **The framework is not where the memory or CPU goes.** Per window, a framework costs **+2–7 MB**
   over plain DOM on a real-sized page. The spread between frameworks is about 2.5 MB idle and about
   3.5 MB busy, which is close to measurement noise. Cold open is identical within about 7 ms. The
   Electron and Chromium base (GPU and main process, about 120–170 MB) dwarfs it. Our 250 MB target
   is decided by **process count, GPU-process content, and what each window loads**, not by the
   framework.
2. **Idle CPU is dominated by repainting, not by JS.** Eight meter bars at 10 Hz cost about 0.16 %
   in the renderer and about **0.65 % in the GPU process**, the same in vanilla. Any visible
   live-updating element has a compositor cost per update. Meter design (rate, size, canvas vs DOM,
   pausing when not visible) matters more than the framework. This is a follow-up experiment.
3. **Busy updates** (20 edits/s) show the framework overhead most clearly: vanilla 0.22 %, Solid
   0.23 %, then Preact, Vue, Svelte and React at 0.24–0.28 %. It is still tiny in absolute terms.
4. **Bundle size** differs by about 7× (Solid 10 KB vs React 70 KB gzip). That matters for update
   size, and for parse time on cold start without a code cache. It made no measurable difference to
   cold open here (V8 code cache).
5. **Caveat: these are small pages.** The real main window has tens of times more components.
   Per-component memory and re-render costs grow with the app, and frameworks with fine-grained
   reactivity (Solid, Svelte 5, Vue Vapor, Preact signals) make "update only what changed" the
   default. React needs memo/compiler discipline to get there. A **scale test** (≈10× DOM, deep
   component trees) would confirm whether the gap grows.

## Recommendation (for discussion)
Measured performance alone does not pick a winner. The framework choice should rest on secondary
criteria:

| Option | For | Against |
| --- | --- | --- |
| **Svelte 5** + shadcn-svelte (Bits UI) | Fine-grained runes. The most mature shadcn port outside React. Large community. Lean memory. | Compiled output grows per component, so the bundle grows faster with the app than Solid's. A new language/tooling for the team. |
| **Solid** + Kobalte / solid-ui | Lowest framework overhead on every axis (bundle 10 KB, busy CPU ≈ vanilla). JSX is close to the existing React code. | Smaller ecosystem. The shadcn port is less mature. Solid 2.0 transition pending. |
| **React 19** (+ compiler) + shadcn/ui | The original shadcn. The biggest ecosystem. Existing React components and team knowledge carry over, so it's the cheapest migration. | 7× bundle. Coarse-grained by default: frequent live data needs care. The highest busy-CPU and memory figures, though only by a few MB/%. |

My lean: **Svelte 5** or **Solid** for performance first, both with shadcn-style headless components
and UnoCSS. Pick Solid if raw overhead and JSX continuity matter most. Pick Svelte if component
ecosystem maturity matters most. React stays a legitimate choice if migration cost outweighs a few
MB and a larger bundle. Before deciding, optionally run a scale test and a headless-component
library check (shadcn port quality per framework).

## Decision
The owner chose **Vue 3** (company stack), since performance differences are negligible. See
[ADR-0007](../decisions/0007-ui-stack-vue3.md).
