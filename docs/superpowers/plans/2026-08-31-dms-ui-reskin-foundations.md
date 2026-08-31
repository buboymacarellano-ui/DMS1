# DMS UI Reskin — Foundations + Slices 0–1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a token-driven stylesheet with a per-portal gate, and migrate the Auth and Stores portals onto it without touching any other portal.

**Architecture:** `header.ejs` links exactly one stylesheet per request — the new `/css/app.css` for migrated portals, the legacy `/styles.css` for everything else. No scoping, no override layer, one cascade per page. The new sheet is plain CSS organised with `@layer`, built from a single `:root` token set.

**Tech Stack:** Express 4, EJS, plain CSS with `@layer` and custom properties. Node >= 22.5.0. No build step, no bundler, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-dms-ui-reskin-design.md`

## Global Constraints

- Visual reskin only. No route, flow, field, or business-logic changes.
- No build step, no bundler, no frontend framework, no new npm dependencies.
- Node >= 22.5.0. Target browsers: Chrome and Edge (branch PCs and kiosk terminals).
- Four breakpoints only: 480 phone, 768 tablet, 1200 desktop, 1800 wide. No others may be introduced.
- All colour, spacing, type, and radius values live in `tokens.css`. No literal values elsewhere.
- **Three documented literal exceptions**, accepted after the Task 6 review. Do
  not "fix" these in a later slice:
  1. `print.css` may use `#000000` / `#ffffff`, and print-domain units such as
     `font-size: 11pt` — see Task 8. Print is a different medium with its own
     value space: the type tokens are `rem`, sized for screens at a screen's
     viewing distance, and there is no sensible screen token for a paper point
     size. This exception covers colour and absolute print units ONLY —
     everything else in `print.css`, `--border-w` included, still comes from a
     token.
  2. `.nav-card`'s `border-top: 4px solid var(--c-accent)`. The 4px is a border
     WIDTH, not spacing. `--sp-1` is also 4px but is a spacing token; binding a
     border width to the spacing scale would change the accent bar the next time
     spacing is retuned. A dedicated token is not worth adding for one use.
  3. The status-pill dot: `width`/`height: 6px` and `border-radius: 50%`. The
     6px is a fixed decorative size with no token, and `50%` is the correct
     idiom for a circle — `--radius-pill` (999px) is a length that merely
     happens to work at this size.
  4. `min-height: 100vh` on `.auth-shell`. A viewport unit is not a design
     value; there is nothing to tokenise.
  5. `min-width: 20px` on `.approval-nav__count`. Same class as the pill dot —
     a fixed decorative minimum, not spacing.

  **Not an exception, and not a violation:** redefining a token's value inside a
  media query — `--container-max: 1760px` under `(min-width: 1800px)`, for
  instance. That is the canonical way to make a token responsive, and the
  literal belongs there. Defining every responsive variant in `tokens.css`
  instead would be worse.
- Brand colours are fixed: navy `#2f6db3`, orange `#ed7d31`. Greys, radii, elevation and typeface follow Direction A (spec §3.1), not the legacy sheet.
- Typeface is IBM Plex Sans via Google Fonts, with the Segoe UI stack as fallback. A self-hosted copy is acceptable; a different face is not.
- Stripping inline `style=` attributes from a view happens in the same commit that flips that view's portal — never earlier.
- `sed -i ''` in this plan is macOS syntax. On Linux use `sed -i`; on Windows run the loops in Git Bash or WSL. Verify with the `grep` check that follows each rename before committing.
- Shared partial styles (`header.ejs`, `footer.ejs`) change in both stylesheets in the same commit, or not at all.

## Testing Note

This project has no test suite and no linter; `CLAUDE.md` specifies verifying by running the app and hitting routes. TDD still applies, with two substitutes:

- **Gate logic is genuinely unit-testable** over HTTP — `scripts/check-skin.js` asserts which stylesheet each route serves. Tasks 3, 9, and 10 follow a real red/green cycle against it.
- **Visual output is regression-tested by screenshot** — `scripts/ui-shots.js` captures every route at four widths. Baselines are captured before any change; each slice compares against them.

Task 1 builds both, before anything else changes.

---

### Task 1: Verification harness

**Files:**
- Create: `scripts/ui-shots.js`
- Create: `scripts/check-skin.js`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run ui:shots -- <role> <outdir> <route...>` writes PNGs named `<route-slug>@<width>.png`. `npm run ui:check -- <expected> <route...>` exits non-zero if any route serves the wrong stylesheet, where `<expected>` is `legacy` or `v2`.

- [ ] **Step 1: Write the skin checker**

Create `scripts/check-skin.js`:

```js
'use strict';

// Asserts which stylesheet a route serves. Usage:
//   node scripts/check-skin.js legacy /auth/login /stores
//   node scripts/check-skin.js v2 /auth/login
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const V2_HREF = '/css/app.css';
const LEGACY_HREF = '/styles.css';

async function main() {
  const [expected, ...routes] = process.argv.slice(2);
  if (expected !== 'legacy' && expected !== 'v2') {
    console.error('Usage: check-skin.js <legacy|v2> <route...>');
    process.exit(2);
  }
  if (!routes.length) {
    console.error('No routes given.');
    process.exit(2);
  }

  let failed = 0;
  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`, { redirect: 'follow' });
    const html = await response.text();
    const hasV2 = html.includes(V2_HREF);
    const hasLegacy = html.includes(LEGACY_HREF);
    const ok = expected === 'v2' ? (hasV2 && !hasLegacy) : (hasLegacy && !hasV2);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${route}  v2=${hasV2} legacy=${hasLegacy}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`\n${failed} route(s) served the wrong stylesheet.`);
    process.exit(1);
  }
  console.log(`\nAll ${routes.length} route(s) served the ${expected} stylesheet.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Write the screenshot harness**

Create `scripts/ui-shots.js`:

```js
'use strict';

// Captures a route at all four breakpoints using headless Chrome.
// Usage: node scripts/ui-shots.js <outdir> <route...>
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const WIDTHS = [480, 768, 1200, 1800];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Chrome not found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  }
  return found;
}

function slug(route) {
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'root';
}

function main() {
  const [outDir, ...routes] = process.argv.slice(2);
  if (!outDir || !routes.length) {
    console.error('Usage: ui-shots.js <outdir> <route...>');
    process.exit(2);
  }
  const chrome = findChrome();
  fs.mkdirSync(outDir, { recursive: true });

  for (const route of routes) {
    for (const width of WIDTHS) {
      const out = path.join(outDir, `${slug(route)}@${width}.png`);
      execFileSync(chrome, [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        `--screenshot=${out}`,
        `--window-size=${width},1400`,
        `${BASE}${route}`,
      ], { stdio: 'ignore' });
      console.log(`shot  ${route}  ${width}px  ->  ${out}`);
    }
  }
  console.log(`\n${routes.length * WIDTHS.length} screenshots written to ${outDir}`);
}

main();
```

- [ ] **Step 3: Register the scripts**

In `package.json`, add to the `scripts` block:

```json
    "ui:shots": "node scripts/ui-shots.js",
    "ui:check": "node scripts/check-skin.js",
```

- [ ] **Step 4: Run the checker to verify it passes against the current app**

In one terminal:

```bash
DISABLE_LOGIN=1 BYPASS_ROLE=cashier node app.js
```

In another:

```bash
npm run ui:check -- legacy /auth/login /stores /stores/pos
```

Expected: `PASS` on all three, exit 0. Every route currently serves `/styles.css`, so `legacy` must pass. If any route reports `v2=true`, the harness is wrong — fix it before continuing.

- [ ] **Step 5: Run the checker with the wrong expectation to verify it fails**

```bash
npm run ui:check -- v2 /auth/login
```

Expected: `FAIL  /auth/login  v2=false legacy=true`, exit code 1. This proves the checker can actually detect a wrong stylesheet — a checker that always passes is worse than none.

- [ ] **Step 6: Capture baseline screenshots**

```bash
mkdir -p docs/superpowers/plans/baselines
npm run ui:shots -- docs/superpowers/plans/baselines/before \
  /auth/login /stores /stores/pos /stores/shelving /stores/cashier
```

Expected: 20 PNGs. Open two and confirm they show real pages, not error screens.

- [ ] **Step 7: Commit**

```bash
git add scripts/ui-shots.js scripts/check-skin.js package.json
git commit -m "chore: add UI screenshot and stylesheet-gate verification scripts"
```

Do not commit the baseline PNGs — they are local reference only. Add `docs/superpowers/plans/baselines/` to `.gitignore` in this commit. The directory needs no tracked placeholder: it is gitignored, and both `mkdir -p` and `fs.mkdirSync({ recursive: true })` recreate it on demand.

---

### Task 2: Foundations design canvas

**Files:**
- Create: `docs/superpowers/plans/canvas-1-foundations.dc.html` (published as an Artifact)

**Interfaces:**
- Consumes: current palette values from `public/styles.css` lines 1–28, 2269–2288, 7126–7136.
- Produces: approved hex values, type scale, and spacing scale that Task 4 transcribes into `tokens.css`. No code.

- [ ] **Step 1: Extract the current identity values**

The three competing `:root` blocks contain these. Reconcile to one of each:

| Role | Candidates in tree | Note |
| --- | --- | --- |
| Accent / navy | `--accent: #2f6db3`, `--office-accent: #2f6db3` | Already agree. Use `#2f6db3`. |
| Page background | `--bg: #c3c5c6`, `--office-bg: #c3c5c6` | Agree. `#c3c5c6`. |
| Surface / card | `--card: #ffffff`, `--office-surface: #ffffff` | Agree. `#ffffff`. |
| Soft surface | `--office-surface-soft: #f7f9fb` | Only one definition. |
| Border | `--border: #c5d0dc`, `--office-panel-border: #c5d0dc` | Agree. |
| Strong border | `--office-panel-border-strong: #9aabc0` | Only one definition. |
| Text | `--text: #111827` | Consistent across blocks. |
| Muted text | `--muted-dark: #334155`, `--office-text-muted: #334155` | Agree. |
| Orange | `--orange: #ed7d31`, `--pane-orange`, `--excel-orange` | Three names, one value. |
| Chart blue | `--cyan`/`--excel-blue`/`--pane-blue: #5b9bd5` | Three names, one value. |
| Chart gold | `--excel-gold`/`--pane-yellow: #ffc000` | Two names, one value. |
| Chart green | `--excel-green: #70ad47`, `--pane-brown: #70ad47` | Two names, one value. |
| Status green | `#d8f0e0` bg / `#0a3d22` ink / `#7eae92` line | Single definition. |
| Status red | `#f5d6d6` / `#6e1010` / `#c99a9a` | Single definition. |
| Status gray | `#e4e6e9` / `#16181c` / `#b0b4ba` | Single definition. |

The identity is more consistent than the file size suggests — the duplication is in *names*, not values. That makes this a renaming exercise, not a colour negotiation.

- [ ] **Step 2: Build the canvas**

Invoke the `design` skill. Produce one canvas with these artboards:

1. **Foundations** — the reconciled palette as swatches; type scale (page title, section title, body, small, table cell); spacing scale; button states (default, hover, disabled, primary, danger); form field states (default, focus, error, disabled); a table row set including a header row and a zebra row; status pills in green, red, and gray.
2. **Auth / login** at 480, 768, 1200 — the real five-field form: Department, Role, Employee ID, Location / Branch, Password.
3. **Cashier POS** at 480, 768, 1200 — touch targets sized for shop-floor tablet use.

Font stack stays `"Segoe UI", Calibri, Arial, Helvetica, sans-serif` — it is what the branch PCs have and what the current sheet uses.

- [ ] **Step 3: Publish and send for review**

Publish the canvas as an Artifact. Send the client the link. Explicitly ask them to confirm: the palette, the type sizes, and the POS touch targets.

- [ ] **Step 4: Client sign-off gate**

**Do not start Task 4 until the client has approved this canvas.** Tasks 1 and 3 may proceed in parallel — neither depends on design values.

Record the approved values in the canvas file itself. There is no commit for this task; the artifact is the deliverable.

---

### Task 3: The skin gate

**Files:**
- Modify: `app.js` (after line 224, in the `res.locals` middleware)
- Modify: `views/partials/header.ejs:7`

**Interfaces:**
- Consumes: `res.locals.currentPortal` (already set at `app.js:224`), `req.path`.
- Produces: `res.locals.skinV2` — boolean, true when the current request's portal has migrated. `SKIN_V2_PORTALS` — a `Set` of portal keys, and `SKIN_V2_PATH_PREFIXES` — an array of path prefixes for portal-less routes. Tasks 9 and 10 add entries to these.

This task ships with **zero portals migrated**, so it produces no visual change. That is deliberate: the gate is verified in isolation before it carries anything.

- [ ] **Step 1: Write the failing test**

Start the app, then run:

```bash
npm run ui:check -- v2 /auth/login
```

Expected: `FAIL  /auth/login  v2=false legacy=true`, exit 1. There is no `skinV2` local yet, so `header.ejs` cannot serve the new sheet. This is the red state.

- [ ] **Step 2: Add the gate to `app.js`**

Insert immediately after the `res.locals.portalLabel` line (currently `app.js:225`):

```js
  // Which portals have migrated to the v2 stylesheet. Remove an entry to roll
  // that portal back to /styles.css. See docs/superpowers/specs/2026-08-31-dms-ui-reskin-design.md
  res.locals.skinV2 = SKIN_V2_PORTALS.has(activePortal)
    || SKIN_V2_PATH_PREFIXES.some((prefix) => req.path === prefix || req.path.indexOf(`${prefix}/`) === 0);
```

And near the other module-level constants, after the `BYPASS_ROLE` block (around `app.js:129`):

```js
// v2 stylesheet rollout. Add a portal key to migrate it; remove to roll back.
const SKIN_V2_PORTALS = new Set([]);

// Routes with no portal (portalForPath returns '') that have migrated.
const SKIN_V2_PATH_PREFIXES = [];
```

- [ ] **Step 3: Switch the stylesheet link**

Replace `views/partials/header.ejs:7`:

```ejs
  <link rel="stylesheet" href="/styles.css">
```

with:

```ejs
  <% if (typeof skinV2 !== 'undefined' && skinV2) { %>
    <link rel="stylesheet" href="/css/app.css">
  <% } else { %>
    <link rel="stylesheet" href="/styles.css">
  <% } %>
```

The `typeof` guard matters: `views/auth/login.ejs` and the register views render outside the main middleware in some error paths, and an undefined local would throw.

- [ ] **Step 4: Run the test to verify nothing migrated yet**

```bash
npm run ui:check -- legacy /auth/login /stores /stores/pos
```

Expected: `PASS` on all three. With both sets empty, every route must still serve `/styles.css`. If any serves v2, the gate is inverted.

- [ ] **Step 5: Verify the gate can actually flip**

Temporarily change `SKIN_V2_PATH_PREFIXES` to `['/auth']`, restart, and run:

```bash
npm run ui:check -- v2 /auth/login
```

Expected: `PASS`. Then revert the array to `[]`, restart, and confirm `npm run ui:check -- legacy /auth/login` passes again. This proves the mechanism works before any CSS exists to break.

- [ ] **Step 6: Commit**

```bash
git add app.js views/partials/header.ejs
git commit -m "feat: add per-portal stylesheet gate, no portals migrated yet"
```

---

### Task 4: Token layer

**Files:**
- Create: `public/css/tokens.css`

**Interfaces:**
- Consumes: approved values from Task 2's canvas.
- Produces: every custom property the later sheets use. Tasks 5–8 reference these names and define no literal values of their own.

- [ ] **Step 1: Write the token sheet**

Create `public/css/tokens.css`. Values below are **Direction A as approved on the design canvas** (page "Direction A · approved", foundations artboard) — see spec §3.1. Do not take values from the legacy stylesheet:

```css
@layer tokens {
  :root {
    /* Brand — unchanged from the legacy sheet */
    --c-accent: #2f6db3;
    --c-accent-strong: #1e4e86;
    --c-accent-soft: #eff4fa;
    --c-orange: #ed7d31;
    --c-orange-soft: #fef6ee;
    --c-gold: #ffc000;
    --c-gold-soft: #fffaeb;
    --c-green: #70ad47;

    /* Surfaces — new, cool slate */
    --c-bg: #eef1f5;
    --c-surface: #ffffff;
    --c-surface-soft: #f8fafc;
    --c-border: #e2e8f0;
    --c-border-strong: #cbd5e1;
    --c-rule: #f1f5f9;

    /* Ink */
    --c-text: #0f172a;
    --c-text-muted: #64748b;
    --c-text-subtle: #94a3b8;
    --c-text-invert: #ffffff;

    /* Status — tinted pill plus state dot */
    --c-ok-bg: #ecfdf3;
    --c-ok-ink: #067647;
    --c-ok-dot: #12b76a;
    --c-bad-bg: #fef3f2;
    --c-bad-ink: #b42318;
    --c-bad-dot: #f04438;
    --c-idle-bg: #f2f4f7;
    --c-idle-ink: #475467;
    --c-idle-dot: #98a2b3;

    /* Type */
    --font-ui: "IBM Plex Sans", "Segoe UI", Calibri, Arial, Helvetica, sans-serif;
    --font-mono: "IBM Plex Mono", Consolas, monospace;
    --fs-metric: 2rem;
    --fs-page-title: 1.625rem;
    --fs-section-title: 0.9375rem;
    --fs-body: 0.875rem;
    --fs-small: 0.8125rem;
    --fs-micro: 0.6875rem;
    --lh-tight: 1.15;
    --lh-body: 1.6;
    --ls-tight: -0.01em;
    --fw-normal: 400;
    --fw-medium: 500;
    --fw-semibold: 600;
    --fw-bold: 700;

    /* Space */
    --sp-1: 4px;
    --sp-2: 8px;
    --sp-3: 12px;
    --sp-4: 16px;
    --sp-5: 24px;
    --sp-6: 32px;
    --sp-7: 48px;

    /* Shape */
    --radius-sm: 6px;
    --radius: 10px;
    --radius-pill: 999px;
    --border-w: 1px;
    --shadow-card: 0 1px 2px rgba(16, 24, 40, .04), 0 4px 12px rgba(16, 24, 40, .06);
    --shadow-raised: 0 1px 2px rgba(16, 24, 40, .04), 0 8px 24px rgba(16, 24, 40, .08);
    --focus-ring: 0 0 0 3px rgba(47, 109, 179, .16);

    /* Nav and chrome */
    --c-surface-nav: #f8fafc;
    --c-surface-nav-active: #eff4fa;
    --c-grid: #f1f5f9;
    --c-chart-blue: #5b9bd5;
    --shadow-header: 0 1px 2px rgba(16, 24, 40, .06);

    /* Status borders — used by pills and alerts */
    --c-ok-line: #a6f4c5;
    --c-bad-line: #fecdca;
    --c-idle-line: #e4e7ec;

    /* Controls */
    --control-h: 40px;
    --control-h-touch: 48px;

    /* Layout */
    --container-max: 1136px;
  }
}
```

Corners are deliberately **not** square. The legacy sheet forces `border-radius: 0` twice (lines 6888, 6202); Direction A reverses that — 6px on controls, 10px on cards, pill on status.

- [ ] **Step 2: Verify it parses**

```bash
node -e "const c=require('fs').readFileSync('public/css/tokens.css','utf8');
const o=(c.match(/{/g)||[]).length, x=(c.match(/}/g)||[]).length;
if(o!==x) throw new Error('Unbalanced braces: '+o+' open, '+x+' close');
console.log('tokens.css balanced,', (c.match(/--[a-z0-9-]+:/g)||[]).length, 'tokens');"
```

Expected: `tokens.css balanced, 72 tokens`.

- [ ] **Step 3: Commit**

```bash
git add public/css/tokens.css
git commit -m "feat: add design token layer"
```

---

### Task 5: Base layer and sheet entry point

**Files:**
- Create: `public/css/base.css`
- Create: `public/css/app.css`

**Interfaces:**
- Consumes: tokens from Task 4.
- Produces: `/css/app.css`, the single href the gate serves. Declares layer order for all later sheets.

> **Amended 2026-08-31 — Direction A.** Two corrections to the `base.css` block
> below, which was authored for the rejected square-cornered draft:
>
> - Inputs, selects and textareas take `border-radius: var(--radius-sm)` (6px),
>   **not** `var(--radius)` (10px, which is for cards and panels).
> - The focus state is a single `:focus` rule — `outline-color: transparent;
>   border-color: var(--c-accent); box-shadow: var(--focus-ring);` — and **no
>   `:focus-visible` rule at all** for form controls.
>
>   *Corrected 2026-08-31 after Task 5 review.* An earlier version of this
>   amendment asked for a `:focus-visible` outline as a keyboard fallback. That
>   was wrong: Chromium and Edge match `:focus-visible` on text-editable elements
>   for mouse clicks as well as keyboard, so both rules fire on an ordinary click
>   and the ring doubles. The `:focus` ring alone is the indicator for every input
>   modality, which is the correct behaviour for form fields.
>
> Reference artboard: `Main.dc.html` (foundations), the "Form fields" row.

- [ ] **Step 1: Write the entry point**

Create `public/css/app.css`:

```css
/* Layer order is declared once, here. A rule in a later layer always wins,
   regardless of source order or where it is imported from. This is the fix
   for the override-pass problem in the legacy sheet. */
@layer tokens, base, components, layout, overrides;

@import url("tokens.css");
@import url("base.css");
@import url("components.css");
@import url("layout.css");
@import url("print.css");
```

- [ ] **Step 2: Write the base layer**

Create `public/css/base.css`:

```css
@layer base {
  *,
  *::before,
  *::after { box-sizing: border-box; }

  html {
    background: var(--c-bg);
    min-height: 100%;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background: var(--c-bg);
    color: var(--c-text);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3, h4 {
    margin: 0 0 var(--sp-3);
    line-height: var(--lh-tight);
    font-weight: var(--fw-medium);
  }
  h1 { font-size: var(--fs-page-title); }
  h2 { font-size: var(--fs-section-title); }
  h3 { font-size: var(--fs-body); }

  p { margin: 0 0 var(--sp-3); }

  a { color: var(--c-accent); }
  a:hover { color: var(--c-accent-strong); }

  img { max-width: 100%; height: auto; }

  /* Forms */
  label {
    display: block;
    margin-bottom: var(--sp-3);
    font-size: var(--fs-small);
    font-weight: var(--fw-medium);
    color: var(--c-text);
  }

  input, select, textarea {
    display: block;
    width: 100%;
    min-height: var(--control-h);
    padding: var(--sp-2) var(--sp-3);
    border: var(--border-w) solid var(--c-border-strong);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-text);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
  }

  input:focus, select:focus, textarea:focus {
    outline: 2px solid var(--c-accent);
    outline-offset: -2px;
  }

  input:disabled, select:disabled, textarea:disabled {
    background: var(--c-surface-soft);
    color: var(--c-text-muted);
    cursor: not-allowed;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-small);
  }

  th, td {
    padding: var(--sp-2) var(--sp-3);
    border-bottom: var(--border-w) solid var(--c-grid);
    text-align: left;
    vertical-align: top;
  }

  th {
    background: var(--c-surface-nav);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }

  tbody tr:nth-child(even) { background: var(--c-surface-soft); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

- [ ] **Step 3: Create the remaining sheets as empty layers so `app.css` resolves**

```bash
printf '@layer components {\n}\n' > public/css/components.css
printf '@layer layout {\n}\n' > public/css/layout.css
printf '@media print {\n}\n' > public/css/print.css
```

Tasks 6, 7, and 8 fill these. Without them the `@import` chain 404s and the page renders unstyled.

- [ ] **Step 4: Verify the sheet loads**

Start the app, temporarily set `SKIN_V2_PATH_PREFIXES = ['/auth']` in `app.js`, restart, and open `http://127.0.0.1:3000/auth/login` in Chrome. Open DevTools → Network and confirm all five CSS files return 200. The page will look unfinished — components do not exist yet. That is expected.

Revert `SKIN_V2_PATH_PREFIXES` to `[]` before committing.

- [ ] **Step 5: Commit**

```bash
git add public/css/app.css public/css/base.css public/css/components.css public/css/layout.css public/css/print.css
git commit -m "feat: add base layer and v2 stylesheet entry point"
```

---

### Task 6: Shared component layer

**Files:**
- Modify: `public/css/components.css`

**Interfaces:**
- Consumes: tokens from Task 4, base from Task 5.
- Produces: the semantic class names Tasks 9 and 10 rename views onto: `.shell`, `.page-title`, `.page-title__suffix`, `.panel`, `.panel__header`, `.kpi-card`, `.kpi-card__label`, `.kpi-card__value`, `.card-grid`, `.card-grid--4`, `.nav-card`, `.nav-card--blue`, `.nav-card--orange`, `.nav-card--yellow`, `.nav-card__icon`, `.nav-card__body`, `.home-card`, `.home-group`, `.home-group__title`, `.summary-card`, `.summary-grid`, `.btn`, `.btn--primary`, `.btn--danger`, `.alert`, `.alert--error`, `.alert--success`, `.note`, `.list`, `.table-scroll`,
`.pill`, `.pill--ok`, `.pill--bad`.

*Corrected 2026-08-31 after Task 6 review.* The list originally named 30 classes
and omitted the three pill classes, even though this task's own amendment
specifies their styling and every Till column on the approved Stores artboard
shows one. Thirty-three classes. `.pill` alone is the idle state; `--ok` and
`--bad` are the modifiers.

> **Amended 2026-08-31 — Direction A.** The CSS below was authored for the
> rejected square-cornered draft. Keep its structure and class names; apply
> these value changes throughout, matching the approved foundations artboard:
> `border-radius: var(--radius-sm)` on buttons and inputs and
> `var(--radius)` on cards and panels (never `0`); `box-shadow: var(--shadow-card)`
> on every card, panel, KPI and nav card; status pills become
> `border-radius: var(--radius-pill)` with a 6px state dot before the label;
> `.kpi-card__value` uses `--fs-metric`; the accent left-border on `.kpi-card`
> is dropped in favour of elevation.
>
> Buttons specifically, from the foundations artboard's "Buttons" row:
> `.btn` is `background: var(--c-surface)` with `border: var(--border-w) solid
> var(--c-border-strong)`; `.btn--primary` is `background: var(--c-accent)` with
> `border: 0` and `--c-text-invert` ink, hovering to `--c-accent-strong`;
> `.btn--danger` is `--c-bad-bg` on `--c-bad-line` with `--c-bad-ink`. Disabled is
> `opacity: .5`, not `.55`.
>
> Status pills carry a 6px round dot before the label, coloured `--c-ok-dot`,
> `--c-bad-dot` or `--c-idle-dot`, with the pill background from the matching
> `-bg` token and text from the matching `-ink` token.
>
> Reference artboards: `Main.dc.html` (foundations) and `Stores1200.dc.html`.

These 33 classes are the measured shared layer: 96 of the tree's 553 classes cross portal boundaries, and these cover every one used by five or more portals. Building them now means slices 2–6 inherit them rather than rediscovering them.

**Legacy → semantic rename map.** Tasks 9 and 10 apply this to views; later slices reuse it.

| Legacy class | Semantic replacement |
| --- | --- |
| `dashboard-shell`, `admin-shell`, `sa-shell` | `shell` |
| `dashboard-title`, `admin-title`, `sa-title`, `role-dashboard-title` | `page-title` |
| `role-dashboard-title__suffix` | `page-title__suffix` |
| `dashboard-card` | `panel` |
| `dashboard-card__header`, `admin-panel-header`, `gm-panel-header` | `panel__header` |
| `gm-panel` | `panel` |
| `gm-kpi-card` / `-label` / `-value` | `kpi-card` / `kpi-card__label` / `kpi-card__value` |
| `sa-grid`, `sa-grid--4` | `card-grid`, `card-grid--4` |
| `sa-home-card` | `home-card` |
| `sa-home-group`, `sa-home-group__title` | `home-group`, `home-group__title` |
| `workorder-nav-card` + `__icon` `__body` `--blue` `--orange` `--yellow` | `nav-card` + same suffixes |
| `admin-summary-card`, `admin-summary-grid` | `summary-card`, `summary-grid` |
| `dashboard-button` | `btn` |
| `dashboard-note` | `note` |
| `error` | `alert alert--error` |
| `success` | `alert alert--success` |
| `btn`, `list`, `table-scroll`, `form` | unchanged — already semantic |
| `btn-fullscreen` | `btn` — drop the modifier; the v2 `.btn` IS this button |
| `btn-secondary` | `btn` — the v2 default already reads as secondary |
| `global-error-message` | `alert alert--error` — same as `error` |

**Added 2026-08-31 after the Task 7 shared-partial audit.** These three appear in
`views/partials/header.ejs` and `views/partials/footer.ejs`, which every view in
the app renders, so they are renamed as part of slice 0 (Task 9) rather than
waiting for a portal that happens to use them.

- [ ] **Step 1: Write the component layer**

Replace `public/css/components.css` with:

```css
@layer components {
  /* Shell and titles */
  .shell {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .page-title {
    margin: 0 0 var(--sp-4);
    font-size: var(--fs-page-title);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
    color: var(--c-text);
  }

  .page-title__suffix {
    color: var(--c-text-muted);
    font-weight: var(--fw-normal);
  }

  .note {
    margin: 0 0 var(--sp-4);
    color: var(--c-text-muted);
    font-size: var(--fs-small);
  }

  /* Panel */
  .panel {
    background: var(--c-surface);
    border: var(--border-w) solid var(--c-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    padding: var(--sp-4);
  }

  .panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    margin: calc(var(--sp-4) * -1) calc(var(--sp-4) * -1) var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
    background: var(--c-surface-nav);
    border-bottom: var(--border-w) solid var(--c-border);
    font-size: var(--fs-section-title);
    font-weight: var(--fw-medium);
  }

  /* KPI card */
  .kpi-card {
    background: var(--c-surface);
    border: var(--border-w) solid var(--c-border);
    border-left: 4px solid var(--c-accent);
    border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-4);
  }

  .kpi-card__label {
    display: block;
    font-size: var(--fs-small);
    color: var(--c-text-muted);
  }

  .kpi-card__value {
    display: block;
    font-size: var(--fs-page-title);
    font-weight: var(--fw-bold);
    line-height: var(--lh-tight);
    color: var(--c-text);
  }

  /* Grids */
  .card-grid {
    display: grid;
    gap: var(--sp-4);
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .card-grid--4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

  .summary-grid {
    display: grid;
    gap: var(--sp-3);
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .summary-card {
    background: var(--c-surface-soft);
    border: var(--border-w) solid var(--c-border);
    border-radius: var(--radius);
    padding: var(--sp-3);
    font-size: var(--fs-small);
  }

  /* Nav cards */
  .nav-card {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: var(--control-h-touch);
    padding: var(--sp-3) var(--sp-4);
    background: var(--c-surface);
    border: var(--border-w) solid var(--c-border);
    border-top: 4px solid var(--c-accent);
    border-radius: var(--radius);
    color: var(--c-text);
    text-decoration: none;
    box-shadow: var(--shadow-card);
  }

  .nav-card:hover {
    background: var(--c-surface-nav-active);
    color: var(--c-text);
  }

  .nav-card--blue { border-top-color: var(--c-chart-blue); }
  .nav-card--orange { border-top-color: var(--c-orange); }
  .nav-card--yellow { border-top-color: var(--c-gold); }

  .nav-card__icon { flex: 0 0 auto; font-size: var(--fs-section-title); }
  .nav-card__body { flex: 1 1 auto; min-width: 0; }

  .home-group { margin-bottom: var(--sp-5); }

  .home-group__title {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-section-title);
    font-weight: var(--fw-medium);
    color: var(--c-text);
  }

  .home-card {
    display: block;
    padding: var(--sp-4);
    background: var(--c-surface);
    border: var(--border-w) solid var(--c-border);
    border-radius: var(--radius);
    color: var(--c-text);
    text-decoration: none;
    box-shadow: var(--shadow-card);
  }

  .home-card:hover {
    background: var(--c-surface-nav-active);
    color: var(--c-text);
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: var(--control-h);
    padding: var(--sp-2) var(--sp-4);
    border: var(--border-w) solid var(--c-border-strong);
    border-radius: var(--radius);
    background: var(--c-surface-nav);
    color: var(--c-text);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
    text-decoration: none;
    cursor: pointer;
  }

  .btn:hover { background: var(--c-surface-nav-active); }

  .btn:disabled,
  .btn[aria-disabled="true"] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn--primary {
    background: var(--c-accent);
    border-color: var(--c-accent-strong);
    color: var(--c-text-invert);
  }

  .btn--primary:hover { background: var(--c-accent-strong); color: var(--c-text-invert); }

  .btn--danger {
    background: var(--c-bad-bg);
    border-color: var(--c-bad-line);
    color: var(--c-bad-ink);
  }

  /* Alerts */
  .alert {
    margin: 0 0 var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
    border: var(--border-w) solid transparent;
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }

  .alert--error {
    background: var(--c-bad-bg);
    border-color: var(--c-bad-line);
    color: var(--c-bad-ink);
  }

  .alert--success {
    background: var(--c-ok-bg);
    border-color: var(--c-ok-line);
    color: var(--c-ok-ink);
  }

  /* Status pills */
  .pill {
    display: inline-block;
    padding: var(--sp-1) var(--sp-3);
    border: var(--border-w) solid var(--c-idle-line);
    border-radius: var(--radius);
    background: var(--c-idle-bg);
    color: var(--c-idle-ink);
    font-size: var(--fs-micro);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }

  .pill--ok { background: var(--c-ok-bg); border-color: var(--c-ok-line); color: var(--c-ok-ink); }
  .pill--bad { background: var(--c-bad-bg); border-color: var(--c-bad-line); color: var(--c-bad-ink); }

  /* Lists */
  .list {
    margin: 0;
    padding-left: var(--sp-5);
  }

  .list li { margin-bottom: var(--sp-2); }

  /* Table wrapper — the only thing allowed to scroll horizontally */
  .table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border: var(--border-w) solid var(--c-border);
    background: var(--c-surface);
  }
}
```

- [ ] **Step 2: Verify braces balance**

```bash
node -e "const c=require('fs').readFileSync('public/css/components.css','utf8');
const o=(c.match(/{/g)||[]).length, x=(c.match(/}/g)||[]).length;
if(o!==x) throw new Error('Unbalanced: '+o+'/'+x); console.log('components.css balanced');"
```

Expected: `components.css balanced`.

- [ ] **Step 3: Verify no literal colours leaked in**

```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' public/css/components.css | grep -v 'var(' || echo "PASS: no literal colours"
```

Expected: `PASS: no literal colours`. Every colour must come from a token. If this prints lines, move those values into `tokens.css` first.

- [ ] **Step 4: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add shared component layer with semantic class names"
```

---

### Task 7: Layout layer and breakpoints

**Files:**
- Modify: `public/css/layout.css`

**Interfaces:**
- Consumes: tokens from Task 4, components from Task 6.
- Produces: `.site-header`, `.site-header__actions`, `.container`, `.site-footer`, and the four breakpoints. These style the shared partials, so they must visually match what `styles.css` produces for `header.ejs` and `footer.ejs`.

> **Amended 2026-08-31 — Direction A.** As Task 6: the header is white with a
> soft shadow rather than a hard border, nav links are pill-shaped with an
> `--c-accent-soft` active state rather than an underline, and the brand mark is
> a 30px rounded navy tile carrying "AE".
>
> Specifically, replacing the values in the block below:
>
> - `.site-header` — `border-bottom` uses `--c-border`, not `--c-border-strong`,
>   and carries `box-shadow: var(--shadow-header)`.
> - `.site-header nav a` — `border-radius: var(--radius-sm)` with NO
>   `border-bottom`. Hover fills `background: var(--c-surface-nav)`;
>   `.nav-link--active` is `background: var(--c-accent-soft)` with
>   `color: var(--c-accent)` and `font-weight: var(--fw-semibold)`. Delete every
>   `border-bottom` rule on nav links — the underline is gone.
> - `.header-user-badge` — no chip. Plain `color: var(--c-text-muted)` at
>   `--fs-small`, no background and no border.
> - `.auth-card` — `border-radius: var(--radius)` and `box-shadow:
>   var(--shadow-raised)`, the raised variant rather than `--shadow-card`, since
>   it floats on the page rather than sitting in a grid.
> - The brand mark is a new element: a `--sp-6`-square tile,
>   `border-radius: var(--radius-sm)`, `background: var(--c-accent)`,
>   `color: var(--c-text-invert)`, centred, holding the letters "AE". Add it as
>   `.brand-mark`; it is the one class this task adds beyond the block below.
>
> Reference artboards: `Stores1200.dc.html` for the header, `Login1200.dc.html`
> for the auth card.

- [ ] **Step 1: Write the layout layer**

Replace `public/css/layout.css` with:

```css
@layer layout {
  .site-header {
    position: sticky;
    top: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-4);
    background: var(--c-surface);
    border-bottom: var(--border-w) solid var(--c-border-strong);
    box-shadow: var(--shadow-header);
  }

  .site-header h1 { margin: 0; }

  .brand-heading {
    display: inline-flex;
    align-items: center;
    color: var(--c-text);
    text-decoration: none;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: var(--lh-tight);
  }

  .brand-text__name {
    font-size: var(--fs-section-title);
    font-weight: var(--fw-bold);
  }

  .brand-text__entity {
    font-size: var(--fs-micro);
    color: var(--c-text-muted);
    letter-spacing: 0.08em;
  }

  .site-header nav {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }

  .site-header nav a {
    padding: var(--sp-2) var(--sp-3);
    color: var(--c-text);
    text-decoration: none;
    border-bottom: 2px solid transparent;
  }

  .site-header nav a:hover { border-bottom-color: var(--c-accent); }
  .nav-link--active { border-bottom-color: var(--c-accent); font-weight: var(--fw-medium); }

  .site-header__actions,
  .site-header__session-btns {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .header-logout-form { margin: 0; }

  .header-user-badge {
    padding: var(--sp-1) var(--sp-3);
    background: var(--c-surface-nav);
    border: var(--border-w) solid var(--c-border);
    font-size: var(--fs-small);
    white-space: nowrap;
  }

  .approval-nav--pending { color: var(--c-orange); font-weight: var(--fw-bold); }

  .approval-nav__count {
    display: inline-block;
    min-width: 20px;
    padding: 0 var(--sp-1);
    background: var(--c-orange);
    color: var(--c-text-invert);
    font-size: var(--fs-micro);
    text-align: center;
  }

  .container {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--sp-5) var(--sp-4);
  }

  .site-footer {
    padding: var(--sp-4);
    color: var(--c-text-muted);
    font-size: var(--fs-small);
    text-align: center;
  }

  /* The full-screen layout class set by initFullscreenToggle in footer.ejs */
  body.app-fullscreen .site-footer { display: none; }
  body.app-fullscreen .container { max-width: none; padding: var(--sp-3) var(--sp-4); }

  /* Auth */
  .auth-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--sp-4);
  }

  .auth-card {
    width: 100%;
    max-width: 420px;
    padding: var(--sp-6);
    background: var(--c-surface);
    border: var(--border-w) solid var(--c-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
  }

  .auth-brand { text-align: center; margin-bottom: var(--sp-5); }
  .auth-subtitle { color: var(--c-text-muted); font-size: var(--fs-small); text-align: center; }
  .auth-hint { margin-top: var(--sp-4); font-size: var(--fs-small); color: var(--c-text-muted); }
  .auth-form button[type="submit"] { width: 100%; margin-top: var(--sp-2); }

  /* Breakpoints — these four only. Do not introduce a fifth. */
  @media (max-width: 1799px) {
    :root { --container-max: 1400px; }
  }

  @media (max-width: 1199px) {
    .site-header { padding: var(--sp-2) var(--sp-3); }
    .container { padding: var(--sp-4) var(--sp-3); }
  }

  @media (max-width: 767px) {
    :root {
      --control-h: var(--control-h-touch);
      --fs-page-title: 1.5rem;
    }
    .site-header { gap: var(--sp-2); }
    .site-header nav { width: 100%; overflow-x: auto; }
    .card-grid,
    .card-grid--4,
    .summary-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 479px) {
    .container { padding: var(--sp-3) var(--sp-2); }
    .header-user-badge { display: none; }
    .auth-card { padding: var(--sp-4); border: none; box-shadow: none; }
  }

  @media (min-width: 1800px) {
    :root {
      --container-max: 1760px;
      --fs-body: 1.125rem;
      --fs-page-title: 2.25rem;
    }
  }
}
```

- [ ] **Step 2: Verify only the four approved breakpoints exist**

```bash
grep -oE '@media[^{]*' public/css/layout.css | sed 's/  */ /g' | sort -u
```

Expected exactly these five, and nothing else:

```
@media (max-width: 1199px)
@media (max-width: 1799px)
@media (max-width: 479px)
@media (max-width: 767px)
@media (min-width: 1800px)
```

Five queries express the four breakpoints — 479 phone, 767 tablet, 1199 desktop,
and the 1799/1800 pair bounding wide. Any other number violates the global
constraint; remove it.

*Corrected 2026-08-31 after Task 7.* The original check grepped bare
`max-width:` / `min-width:` strings, which also match ordinary CSS property
values — `.auth-card { max-width: 420px }` and
`.approval-nav__count { min-width: 20px }` both showed up as phantom
breakpoints. Match on `@media` instead.

- [ ] **Step 3: Commit**

```bash
git add public/css/layout.css
git commit -m "feat: add layout layer with four breakpoints"
```

---

### Task 8: Print layer

**Files:**
- Modify: `public/css/print.css`
- Read for reference: `public/styles.css:660`, `:1933`, `:5982`

**Interfaces:**
- Consumes: tokens from Task 4.
- Produces: print rules for the v2 sheet. Nothing else depends on this.

Print matters here — technician job sheets and BIR invoices are printed daily. Losing print styling in the migration would be a live operational regression, not a cosmetic one.

> **Documented exception to the tokens-only constraint.** `print.css` may use
> literal `#000000` and `#ffffff`. This is deliberate, not an oversight. The
> screen tokens are screen values: `--c-text` is `#0f172a`, a near-black chosen
> for on-screen contrast, and `--c-surface` means "card surface", not "paper".
> Print needs true black ink on unprinted white. Binding print output to screen
> tokens would couple them wrongly — a later screen-palette change would silently
> alter what comes out of the branch printers. Every OTHER value in `print.css`
> still comes from a token.
>
> **Amended 2026-08-31 — Direction A.** Card and panel corner radii are left
> alone in print; rounded corners reproduce correctly on paper and forcing them
> square would diverge from the approved design for no benefit.

- [ ] **Step 1: Read the three legacy print blocks**

```bash
sed -n '660,700p' public/styles.css
sed -n '1933,1975p' public/styles.css
sed -n '5982,6030p' public/styles.css
```

Note every selector they hide or restyle. The v2 print layer must cover the same ground for the Auth and Stores views; later slices extend it.

- [ ] **Step 2: Write the print layer**

Replace `public/css/print.css` with:

```css
@media print {
  /* Chrome drops backgrounds when printing unless asked. Status colours
     carry meaning on printed job sheets, so force them. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  html, body {
    background: #ffffff;
    color: #000000;
    font-size: 11pt;
  }

  .site-header,
  .site-footer,
  .btn,
  .header-logout-form,
  .approval-nav,
  .app-back-arrow { display: none !important; }

  .container {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  .panel,
  .kpi-card,
  .home-card,
  .nav-card {
    border: 1px solid #000000;
    box-shadow: none;
    break-inside: avoid;
  }

  .table-scroll {
    overflow: visible;
    border: none;
  }

  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }

  a[href]::after { content: ""; }
}
```

`print.css` is deliberately outside the `@layer` block: print rules must beat screen rules unconditionally, and an unlayered rule always outranks a layered one.

*Corrected 2026-08-31 after Task 8.* This block originally hid `.back-chip`, a
class that exists nowhere in the codebase. The real class rendered by
`views/partials/back-button.ejs` is `app-back-arrow` (with
`app-back-arrow--under-logo` and `app-back-arrow__icon`), which the legacy sheet
hides at `styles.css:660`. Left uncorrected, the back arrow would have printed on
every page of every printed document.

**Print coverage for later slices — do not lose this.** The legacy sheet has
three `@media print` blocks, and only the first is shared chrome:

| Legacy block | Targets | Owning slice |
| --- | --- | --- |
| `styles.css:660` | `.site-header`, `.site-footer`, `.app-back-arrow`, `.container`, plus `.customer-invoice*` | shared chrome here; `.customer-invoice*` is `views/workorders/billing.ejs` — **slice 5** |
| `styles.css:1933` | `.stm-print-shell`, `.stm-print-table`, `.stm-*` toolbars | **slice 5** |
| `styles.css:5982` | `.pm-approve-print__sheet`, `.pm-print-actions`, `.pm-*` | **slice 6** |

This task covers the shared chrome only. It cannot cover the rest: those classes
belong to views that have not migrated, still load the legacy sheet, and so keep
their legacy print rules for now. **Slices 5 and 6 must port their print rules as
part of their own migration.** `.customer-invoice` is the BIR sales invoice —
losing its print styling would be a compliance problem, not a cosmetic one.

- [ ] **Step 3: Verify print rendering**

With `SKIN_V2_PATH_PREFIXES = ['/auth']` set temporarily, open `/auth/login` in Chrome, press `Cmd+P` / `Ctrl+P`, and confirm in the preview that the header and buttons are hidden and text is black on white. Revert the array before committing.

- [ ] **Step 4: Commit**

```bash
git add public/css/print.css
git commit -m "feat: add print layer to v2 stylesheet"
```

---

### Task 9: Slice 0 — migrate Auth

**Files:**
- Modify: `app.js` (`SKIN_V2_PATH_PREFIXES`)
- Modify: `views/auth/login.ejs`, `register.ejs`, `register-admin.ejs`, `register-finance-manager.ejs`, `register-gm.ejs`, `register-hr.ejs`, `register-parts-manager.ejs`, `register-stm.ejs`, `register-technician.ejs`, `share-login.ejs`

**Interfaces:**
- Consumes: the gate from Task 3, components from Task 6, layout from Task 7.
- Produces: `/auth/*` served by `/css/app.css`. No later task depends on this.

10 views, **0 inline `style=` attributes** — the cheapest possible first migration.

**Discovered during Task 3 — this task's original assumption was wrong.** The auth views do NOT include `views/partials/header.ejs`. All 10 render their own `<head>` block with a hardcoded `<link rel="stylesheet" href="/styles.css">`. Flipping the gate alone therefore moves nothing here: the path-prefix entry only affects views that render through the shared partial.

Task 3 already patched `views/auth/login.ejs` with the same conditional (it was needed to verify the gate at all). The **9 remaining auth views still hardcode the legacy sheet** and must each receive the identical conditional as part of this task:

`register.ejs:7`, `register-admin.ejs:7`, `register-finance-manager.ejs:7`, `register-gm.ejs:7`, `register-hr.ejs:7`, `register-parts-manager.ejs:7`, `register-stm.ejs:7`, `register-technician.ejs:7`, `share-login.ejs:17`

Two other views render independent `<head>` blocks — `views/parts/report.ejs` and `views/reports/generate.ejs` — but both style themselves entirely with an inline `<style>` block and link no external sheet, so the gate does not apply to them. Slices 6 and 7 must handle them as self-contained pages, not via the gate.

- [ ] **Step 1: Write the failing test**

```bash
npm run ui:check -- v2 /auth/login /auth/register /auth/share-login
```

Expected: `FAIL` on all three, exit 1. `SKIN_V2_PATH_PREFIXES` is still empty.

- [ ] **Step 2: Rename the legacy classes in the auth views**

Only two classes in `views/auth/` need the semantic map from Task 6 — `error` and `success`:

```bash
cd /Users/nickr/Documents/projects/DMS1
sed -i '' 's/class="error"/class="alert alert--error"/g; s/class="success"/class="alert alert--success"/g' views/auth/*.ejs
grep -rn 'class="error"\|class="success"' views/auth/ || echo "PASS: no legacy alert classes left"
```

Expected: `PASS: no legacy alert classes left`.

The `auth-*` classes (`auth-shell`, `auth-card`, `auth-brand`, `auth-subtitle`, `auth-hint`, `auth-form`) are already semantic and already defined in Task 7. Leave them.

- [ ] **Step 2b: Add the stylesheet conditional to the 9 remaining auth views**

Each of these renders its own `<head>`. Replace the hardcoded link in every one with the same conditional `header.ejs` uses:

```ejs
  <% if (typeof skinV2 !== 'undefined' && skinV2) { %>
    <link rel="stylesheet" href="/css/app.css">
  <% } else { %>
    <link rel="stylesheet" href="/styles.css">
  <% } %>
```

Files and their current link lines: `register.ejs:7`, `register-admin.ejs:7`, `register-finance-manager.ejs:7`, `register-gm.ejs:7`, `register-hr.ejs:7`, `register-parts-manager.ejs:7`, `register-stm.ejs:7`, `register-technician.ejs:7`, `share-login.ejs:17` (note: this one uses a self-closing `/>` form).

`login.ejs` already has it from Task 3 — leave it alone.

Verify none remain:

```bash
grep -rn 'href="/styles.css"' views/auth/ || echo "PASS: no hardcoded legacy links left in views/auth"
```

Expected: `PASS: no hardcoded legacy links left in views/auth`.

- [ ] **Step 3: Flip the gate**

In `app.js`, change:

```js
const SKIN_V2_PATH_PREFIXES = [];
```

to:

```js
const SKIN_V2_PATH_PREFIXES = ['/auth'];
```

- [ ] **Step 4: Run the test to verify it passes**

Restart the app, then:

```bash
npm run ui:check -- v2 /auth/login /auth/register /auth/register-gm /auth/register-hr \
  /auth/register-admin /auth/register-stm /auth/register-parts-manager \
  /auth/register-finance-manager /auth/register-technician /auth/share-login
npm run ui:check -- legacy /stores /stores/pos
```

Expected: first command `PASS` on all 10 — every auth view, not just the three the original plan checked, because each has its own `<head>`. Second command all `PASS`: Stores is untouched. If the second fails, the gate is matching too broadly.

- [ ] **Step 5: Screenshot and compare**

```bash
npm run ui:shots -- docs/superpowers/plans/baselines/after-slice0 \
  /auth/login /auth/register /auth/share-login
```

Open the 480px and 1200px shots beside `baselines/before/auth-login@480.png` and `@1200.png`. Confirm: all five login fields present and labelled, submit button reachable without horizontal scroll at 480, no text unreadable, error styling visible (trigger one by submitting an empty form).

- [ ] **Step 6: Manual check on a real machine**

Open `/auth/login` on an actual branch PC at its native resolution. Confirm the form is usable and the brand reads correctly.

- [ ] **Step 7: Commit**

```bash
git add app.js views/auth/
git commit -m "feat: migrate auth portal to v2 stylesheet"
```

---

### Task 10: Slice 1 — migrate Stores

**Files:**
- Modify: `app.js` (`SKIN_V2_PORTALS`)
- Modify: `views/stores/index.ejs`, `pos.ejs`, `shelving.ejs`, `cashier.ejs` (exact filenames per `ls views/stores/`)

**Interfaces:**
- Consumes: the gate from Task 3, components from Task 6, layout from Task 7.
- Produces: the Stores portal served by `/css/app.css`. Proves the portal-keyed branch of the gate, which slices 2–6 all rely on.

4 views, **0 inline `style=` attributes**. But these views borrow classes from three other portals, so this task exercises most of the shared component layer.

**Till status needs a pill wrapper.** `views/stores/index.ejs:90` currently renders
the status as bare text: `<td><%= (row.till && row.till.status) || 'closed' %></td>`.
The approved design shows a status pill. Wrap it:

```ejs
<td><span class="pill <%= (row.till && row.till.status) === 'open' ? 'pill--ok' : ((row.till && row.till.status) === 'variance' ? 'pill--bad' : '') %>"><%= (row.till && row.till.status) || 'closed' %></span></td>
```

This is a presentational wrapper only — same value, same source, no flow or data
change. It is the one markup addition in this slice beyond class renames.

For later slices: the legacy `fte-pill` / `fte-pill--<tone>` classes used across
`views/gm/` and `views/partials/fte-branch-section.ejs` map onto `.pill` /
`.pill--ok` / `.pill--bad`. That rename belongs to slices 2 and 5, not here.

- [ ] **Step 1: Write the failing test**

```bash
npm run ui:check -- v2 /stores /stores/pos /stores/shelving /stores/cashier
```

Expected: `FAIL` on all four, exit 1.

- [ ] **Step 2: Apply the semantic rename**

The Stores views use these legacy classes: `admin-shell`, `admin-summary-card`, `admin-summary-grid`, `admin-title`, `dashboard-button`, `dashboard-note`, `dashboard-shell`, `dashboard-title`, `gm-kpi-card`, `gm-kpi-label`, `gm-kpi-value`, `list`, `role-dashboard-title`, `role-dashboard-title__suffix`, `sa-grid`, `sa-grid--4`, `sa-home-card`, `sa-home-group`, `sa-home-group__title`, `sa-shell`, `sa-title`, `table-scroll`, `workorder-nav-card` and its modifiers.

Apply the Task 6 map. Order matters — rename the longest names first so prefixes do not corrupt suffixes:

```bash
cd /Users/nickr/Documents/projects/DMS1
for f in views/stores/*.ejs; do
  sed -i '' \
    -e 's/\brole-dashboard-title__suffix\b/page-title__suffix/g' \
    -e 's/\brole-dashboard-title\b/page-title/g' \
    -e 's/\bworkorder-nav-card__icon\b/nav-card__icon/g' \
    -e 's/\bworkorder-nav-card__body\b/nav-card__body/g' \
    -e 's/\bworkorder-nav-card--blue\b/nav-card--blue/g' \
    -e 's/\bworkorder-nav-card--orange\b/nav-card--orange/g' \
    -e 's/\bworkorder-nav-card--yellow\b/nav-card--yellow/g' \
    -e 's/\bworkorder-nav-card\b/nav-card/g' \
    -e 's/\badmin-summary-card\b/summary-card/g' \
    -e 's/\badmin-summary-grid\b/summary-grid/g' \
    -e 's/\bsa-home-group__title\b/home-group__title/g' \
    -e 's/\bsa-home-group\b/home-group/g' \
    -e 's/\bsa-home-card\b/home-card/g' \
    -e 's/\bsa-grid--4\b/card-grid--4/g' \
    -e 's/\bsa-grid\b/card-grid/g' \
    -e 's/\bgm-kpi-label\b/kpi-card__label/g' \
    -e 's/\bgm-kpi-value\b/kpi-card__value/g' \
    -e 's/\bgm-kpi-card\b/kpi-card/g' \
    -e 's/\bdashboard-button\b/btn/g' \
    -e 's/\bdashboard-note\b/note/g' \
    -e 's/\bdashboard-shell\b/shell/g' \
    -e 's/\badmin-shell\b/shell/g' \
    -e 's/\bsa-shell\b/shell/g' \
    -e 's/\bdashboard-title\b/page-title/g' \
    -e 's/\badmin-title\b/page-title/g' \
    -e 's/\bsa-title\b/page-title/g' \
    "$f"
done
```

- [ ] **Step 3: Verify no legacy classes remain**

```bash
grep -rnE '\b(admin-shell|admin-title|admin-summary-(card|grid)|sa-(shell|title|grid|home-card|home-group)|gm-kpi-[a-z]+|dashboard-(shell|title|note|button)|role-dashboard-title|workorder-nav-card)' views/stores/ \
  || echo "PASS: no legacy classes left in views/stores"
```

Expected: `PASS: no legacy classes left in views/stores`.

- [ ] **Step 4: Confirm the rename did not leak into other portals**

```bash
git diff --name-only
```

Expected: only `views/stores/*.ejs`. If any other view appears, the loop matched too widely — revert and rerun scoped to `views/stores/`.

- [ ] **Step 5: Flip the gate**

In `app.js`, change:

```js
const SKIN_V2_PORTALS = new Set([]);
```

to:

```js
const SKIN_V2_PORTALS = new Set([portals.PORTAL_STORES]);
```

- [ ] **Step 6: Run the test to verify it passes**

Restart with a Stores role, since these routes are behind `requirePortalAccess`:

```bash
DISABLE_LOGIN=1 BYPASS_ROLE=cashier node app.js
```

Then:

```bash
npm run ui:check -- v2 /stores /stores/pos /stores/shelving /stores/cashier
npm run ui:check -- v2 /auth/login
```

Expected: all `PASS`. Then confirm nothing else moved:

```bash
DISABLE_LOGIN=1 BYPASS_ROLE=general_manager node app.js
npm run ui:check -- legacy /gm /approvals
```

Expected: `PASS`. GM and the portal-less pages must still be on the legacy sheet.

- [ ] **Step 7: Screenshot and compare**

```bash
DISABLE_LOGIN=1 BYPASS_ROLE=cashier node app.js
npm run ui:shots -- docs/superpowers/plans/baselines/after-slice1 \
  /stores /stores/pos /stores/shelving /stores/cashier
```

Compare against `baselines/before/`. Confirm at 768px (the shop-floor tablet width) that POS buttons are at least 48px tall, no table overflows the viewport, and the KPI cards read clearly.

- [ ] **Step 8: Manual check and client acceptance**

Open the POS on a real tablet. Have the cashier try one sale end to end. Then send the client the deployed URL — not the mockup — for acceptance on both Auth and Stores.

- [ ] **Step 9: Commit**

```bash
git add app.js views/stores/
git commit -m "feat: migrate stores portal to v2 stylesheet"
```

---

## Done when

- `/auth/*` and all `/stores/*` routes serve `/css/app.css`; every other route still serves `/styles.css`, verified by `npm run ui:check`.
- `public/styles.css` is unmodified — 8,178 lines, untouched.
- Screenshots at all four widths reviewed against baselines for all 14 migrated views.
- Client has accepted Auth and Stores on the deployed URL.
- Rollback verified: removing `portals.PORTAL_STORES` from `SKIN_V2_PORTALS` returns Stores to the legacy sheet with no other change.

## Next plan

Slices 2–6 get their own plans, written after this one ships and after each slice's design canvas is approved. The shared component layer built in Task 6 carries forward; later plans extend `components.css` rather than replacing it.

Slice 2 (GM, 5 views, 18 inline styles) is the first to require inline-style stripping, and is where the strip-and-flip-together constraint gets its first real test.
