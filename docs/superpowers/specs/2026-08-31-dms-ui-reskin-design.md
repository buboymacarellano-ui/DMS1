# DMS UI Reskin — Design

**Date:** 2026-08-31
**Status:** Approved design, not yet planned
**Scope:** Visual reskin only. No route, flow, or field changes.

---

## 1. Problem

`public/styles.css` is 8,178 lines built as roughly twenty successive global override passes, each appended over time and each fighting the last:

| Line | Pass |
| --- | --- |
| 2268 | Light office theme — simple white cards, Excel chart colors |
| 3942 | Navy analytics layout + leftover dark surfaces |
| 6202 | Global light office skin: square corners, Excel-style charts |
| 6888 | Straight corners on cards and buttons globally |
| 7422, 7518, 7823 | Three separate type-size and contrast passes |

Consequences measured in the current tree:

- **Three competing `:root` blocks** at lines 1, 2269, and 7126, declaring 125 custom properties between them. Changing a token does not reliably change anything.
- **38 media queries across 11 ad-hoc breakpoints** — 640, 650, 700, 760, 800, 860, 900, 980, 1100, 1400. Phone and tablet behavior is accidental, not designed.
- **388 inline `style=` attributes** across 87 views, plus **6 inline `<style>` blocks**, that punch through any stylesheet.

The system is used on desktop and kiosk PCs, shop-floor tablets, phones, and wall-mounted dashboards, so responsive behavior is a requirement rather than a refinement.

A related symptom was already fixed: a duplicate fullscreen implementation in `header.ejs` fought the original in `footer.ejs` (commit `fac31a5`). The CSS has the same disease at larger scale.

## 2. Goals

- One token set, defined once, that actually controls the interface.
- Consistent type scale, spacing, and component styling across all six portals.
- Deliberate responsive behavior at four breakpoints, phone through TV dashboard.
- Retain A&E's brand colours — navy `#2f6db3` and orange `#ed7d31`. Greys, corner radii, elevation and typeface are replaced (see §3.1).
- Ship incrementally, with per-portal rollback, on a system seven branches depend on daily.

## 3. Non-goals

- No changes to routes, screens, flows, or fields.
- No new brand colours. The navy and orange are fixed; the neutral palette is not (see §3.1).
- No frontend framework, no build step, no bundler. The project has none and gains none here.
- No unrelated refactoring of `app.js` or the route layer.

### 3.1 Amendment — 2026-08-31: Direction A adopted

The original scope was "clean it up, keep identity." On review of the first
draft the client judged it plain and dated. Three directions were mocked and
**Direction A, Refined corporate, was chosen.** That revises the non-goal above:
the brand colours stay, the rest of the visual language does not.

| | Before | Direction A |
| --- | --- | --- |
| Typeface | Segoe UI stack | IBM Plex Sans, Segoe UI fallback |
| Corner radius | 0 — square | 6px controls, 10px cards, 999px status |
| Elevation | none, or a hard 1px border | two-layer soft shadow |
| Page background | `#c3c5c6` warm grey | `#eef1f5` cool slate |
| Body text | `#111827` | `#0f172a` |
| Muted text | `#334155` | `#64748b` |
| Border | `#c5d0dc` | `#e2e8f0` |
| Status colours | flat pastel fills | tinted pill with a state dot |
| KPI figures | inherited body size | 32px with a trend chip |
| Accent navy | `#2f6db3` | `#2f6db3` — unchanged |
| Orange | `#ed7d31` | `#ed7d31` — unchanged |

Approved values are on the foundations artboard of the design canvas, page
"Direction A · approved". Task 4 transcribes from there, not from §4 of this
document or from the legacy stylesheet.

Two consequences for the plan:

- The `--radius: 0` decision recorded in Task 4 is void. The legacy sheet
  squares corners twice (lines 6888, 6202); Direction A reverses that
  deliberately.
- The reconciliation table in Task 2 Step 1 described the *legacy* palette. It
  remains accurate as a record of what was there, but it is no longer the
  source for `tokens.css`.

## 4. Architecture

### 4.1 Full swap per portal

`views/partials/header.ejs` selects exactly one stylesheet per request, based on whether the current portal has migrated:

```ejs
<% if (skinV2) { %>
  <link rel="stylesheet" href="/css/app.css">
<% } else { %>
  <link rel="stylesheet" href="/styles.css">
<% } %>
```

A page loads the new sheet or the old one, never both. No scoping selectors, no cascade mixing, no override layer. This is the core decision: the disease is competing cascades, so the design admits only one cascade per page.

`skinV2` derives from `res.locals.currentPortal`, already computed at `app.js:224`, checked against a `SKIN_V2_PORTALS` set. Rollback for one portal is removing one string from that set.

### 4.2 File layout

No build step, so plain CSS files linked in order:

```
public/css/
  tokens.css       One :root. Colors, type scale, spacing, radii. The only place values live.
  base.css         Reset, typography, form controls, tables.
  components.css   Buttons, cards, chips, modals, status pills, nav.
  layout.css       Header, container, grids, breakpoints.
  print.css        Technician sheets, invoices, receipts.
  app.css          @import of the above, in order.
```

### 4.3 Cascade layers

`app.css` declares once, at the top:

```css
@layer tokens, base, components, layout, overrides;
```

This is the structural fix for the override-pass problem. A later rule can no longer beat an earlier one merely by being later in the file. Chrome and Edge both support `@layer`, which covers the branch PCs and the kiosk terminals.

### 4.4 Breakpoints

Four, replacing the current eleven, named as tokens so a twelfth does not get invented:

| Name | Width | Target |
| --- | --- | --- |
| `phone` | 480 | Staff checking approvals on the go |
| `tablet` | 768 | Shop-floor technicians |
| `desktop` | 1200 | Branch counter and kiosk PCs |
| `wide` | 1800 | GM/STM wall dashboards |

### 4.5 Known cost

`header.ejs` and `footer.ejs` are shared by both skins, so their styles must exist in both sheets for the duration of the migration. This duplication is the price of per-portal rollback. It ends when the last portal flips and `styles.css` is deleted.

## 5. Migration order

Ordered by risk. Counts are from the current tree.

| # | Slice | Views | Inline `style=` | Rationale |
| --- | --- | --- | --- | --- |
| 0 | Auth (`/auth`) | 10 | 0 | No portal gate, zero inline styles, first screen every user sees. Proves the token set. |
| 1 | Stores | 4 | 0 | Smallest portal — proves the gate itself. Cashier POS validates touch targets. |
| 2 | GM | 5 | 18 | Client's own screen; early buy-in. Dashboard and TV sizing. |
| 3 | HR (`hr`, `employees`) | 7 | 40 | First real inline strip. `employees/index.ejs` has 30 plus a `<style>` block. |
| 4 | Finance Office (`admin`, `finance`) | 6 | 71 | Dense tables, transaction previews. |
| 5 | Service | 23 | 67 | Largest by view count: work orders, technician, STM, customers, vehicles, pricing, `gm/fte`. |
| 6 | Parts (`parts`, `parts-manager`, `branch-parts`, `parts-portal`) | 19 | 183 | Worst density. Last, once components are proven. |

Slice totals: 87 views, 388 inline `style=` attributes — the whole tree, nothing unaccounted for. `gm/fte.ejs` sits in slice 5 rather than slice 2 because `portalForPath()` maps `/gm/fte` to the Service portal, not GM.
| 7 | Portal-less + cleanup | 13 | 9 | `approvals`, `transactions`, `helper`, `reports`, `partials`, `views/index.ejs`. Delete `styles.css`. |

Two zero-inline-style slices first means the opening migrations test the architecture and nothing else.

**Slice 7 exists because these pages cannot be gated per portal.** `portalForPath()` deliberately returns `''` for `/approvals`, `/transactions`, and `/helper`; `/reports` is absent from `PATH_PORTALS`; and `views/index.ejs` is the shared landing page. They stay on the old skin until every portal has flipped.

### 5.1 Inline style handling

**Stripping inline styles must happen in the same commit as that portal's skin flip.** Never as a separate global cleanup pass. An inline `style` attribute is frequently the only thing making a view render correctly under the old sheet; removing it ahead of the flip breaks a live page for a branch.

The 388 attributes sort into three buckets:

- **Layout one-offs** — width, display, grid. Become component or utility classes.
- **Status colors** — become tokens and status classes.
- **Print-only** — `workorders/technician_print.ejs` holds 20 that belong in `print.css`.

The 6 `<style>` blocks (`parts/report.ejs`, `workorder-transactions/index.ejs`, `footer.ejs`, `reports/generate.ejs`, `technician/index.ejs`, `employees/index.ejs`) fold into the new sheet during their slice. `footer.ejs` is shared, so it lands in slice 0 and is maintained in both sheets until slice 7.

## 6. Design loop

Claude Design produces a pan/zoom canvas of `.dc.html` artboards, published as a private Artifact. The client clicks through screens and reacts there, on pictures, rather than on a live system.

**Mock two slices ahead, never the whole system.** Designing all artboards up front guarantees rework, because shipping slices 0 and 1 will invalidate assumptions in the later ones.

- **Canvas 1 — Foundations + slices 0–1.** A foundations artboard making the token set visible: type scale, palette, button states, form fields, a table row, status pills. Then `auth/login` and Cashier POS, each at phone, tablet, and desktop.
- **Canvas 2 onward** — seeded from the CSS that actually shipped, covering the next two slices.

Seeding each canvas from shipped code is what keeps mockups honest and prevents the design drifting from the implementation.

Six archetypes cover every layout pattern in the app, so no more than six screens ever need mocking:

| Archetype | Reference screen | Pattern it defines |
| --- | --- | --- |
| Auth | `auth/login` | Forms, brand, cascading selects |
| Dashboard | `gm/index` | Stat cards, charts, TV sizing |
| Dense list | `workorders/index` | Tables, filters, status colors, phone collapse |
| Long form | `workorders/edit` | Field groups, validation, save bar |
| Workspace | `parts-manager/workspace` | Table plus actions, modal, approvals |
| Touch-first | `technician/index` | Tablet targets, shop-floor use |

**Artboards are a source, not code.** `.dc.html` does not become EJS. Approved values are read off it and hand-written into `tokens.css`. Copying artboard markup into views would reproduce the original problem.

Because the direction is "keep identity," the foundations artboard begins by extracting the navy, golden-orange, and office-blue already present, and choosing one of each instead of the three currently competing across the `:root` blocks.

## 7. Verification

The project has no test suite and no linter; `CLAUDE.md` specifies verifying by running the app and hitting routes. Verification is therefore mechanical and per-slice.

The dev bypass makes it automatable. `app.js:128` reads `BYPASS_ROLE`, and `DISABLE_LOGIN=1` injects a session user, so a script can reach every route in a slice as the correct role with no login flow:

```bash
DISABLE_LOGIN=1 BYPASS_ROLE=cashier node app.js
```

**Definition of done for each slice:**

1. Route inventory taken from the relevant `routes/*.js`.
2. Before and after screenshots at all four breakpoints, via headless Chrome (`chrome --headless --screenshot --window-size=`). No new dependencies; works on macOS and Windows.
3. Comparison against the approved artboard — not pixel-matching, but confirming nothing collapsed, no text is unreadable, no table overflowed.
4. Print output checked where the slice includes printable documents.
5. One real branch PC at real resolution, before the flip.
6. Client acceptance on the deployed URL, not on the mockup.

**Carry-overs.** The existing sheet contains 3 `@media print` blocks and a `prefers-reduced-motion` rule. Print matters here — technician sheets and BIR invoices — so print styles are part of each slice's definition of done.

**Rollback.** Remove the portal from `SKIN_V2_PORTALS` and redeploy. Minutes, affecting one portal.

**Deploy cadence.** One slice per push to `main`; Render redeploys automatically. Eight pushes across the project, each independently revertable.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Migration stalls half-finished, leaving portals visually inconsistent | Slice order front-loads the two cheapest portals so momentum is established early. Treat slice 7 as mandatory, not optional. |
| Header/footer duplication drifts between the two sheets | Shared partial styles change in both sheets in the same commit, or not at all. |
| A branch rejects the new look mid-rollout | Per-portal gate means rollback affects only that portal. |
| Inline-style strip breaks a live page | Strip and flip ship in the same commit; screenshots taken before and after. |
| Client keeps revising the design after implementation starts | Sign-off happens on the canvas per slice, before that slice's CSS is written. |

## 9. Open questions

None blocking. Two to settle during slice 0:

- Whether `tokens.css` keeps the existing custom-property names for continuity, or renames to a consistent scheme. Leaning toward renaming, since the current names span three conflicting definitions.
- Whether utility classes are introduced for the layout one-off bucket, or every case becomes a component class. Decide once slice 3 exposes the real variety.
