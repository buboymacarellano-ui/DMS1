# SDD ledger — plan: docs/superpowers/plans/2026-08-31-dms-ui-reskin-foundations.md

Spec: docs/superpowers/specs/2026-08-31-dms-ui-reskin-design.md (read, reachable)
Branch: feat/ui-reskin-foundations (created from main @ fac31a5)

## Pre-flight scan

### Shared file / interface pairs

| Tasks | Shared | Produces vs consumes | Finding |
| --- | --- | --- | --- |
| T3 ↔ T9 | `app.js` | T3 creates `SKIN_V2_PATH_PREFIXES = []`; T9 sets it to `['/auth']` | Clean — T3 ships empty by design |
| T3 ↔ T10 | `app.js` | T3 creates `SKIN_V2_PORTALS = new Set([])`; T10 adds `portals.PORTAL_STORES` | Clean — different constant, no overlap with T9 |
| T3 ↔ T9/T10 | `header.ejs` | T3 adds the `skinV2` conditional; T9/T10 do not touch it | Clean |
| T4 → T5,T6,T7,T8 | token names | 51 defined, 49 used, **0 used-but-undefined** (verified mechanically) | Clean |
| T5 ↔ T6 | `components.css` | T5 creates empty `@layer components {}`; T6 replaces contents | Clean |
| T5 ↔ T7 | `layout.css` | T5 creates empty `@layer layout {}`; T7 replaces contents | Clean |
| T5 ↔ T8 | `print.css` | T5 creates empty `@media print {}`; T8 replaces contents | Clean |
| T1 → T3,T9,T10 | `npm run ui:check` | T1 produces the script; T3/T9/T10 consume it as red/green gate | Clean — name consistent across all four |
| T1 → T9,T10 | `npm run ui:shots` | T1 produces; T9/T10 consume for comparison | Clean |
| T2 → T4 | approved design values | T2 gates T4; T4 transcribes | **Hard gate — T4..T10 blocked until client approves** |
| T6 → T9,T10 | rename map | T6 defines 30 semantic classes; T9/T10 sed views onto them | Clean — every sed target exists in T6 |

### Per-task self-consistency

| Task | Own text agrees with itself? |
| --- | --- |
| T1 | Yes — builds checker, then tests it both pass and fail directions (steps 4,5) |
| T2 | Yes — no code, ends at sign-off gate |
| T3 | Yes — red (step 1) before green (step 4); flip-test then revert (step 5) |
| T4 | Yes — 51 tokens, verified against the step-2 assertion |
| T5 | Yes — creates the three empty layer files its own `@import` chain needs (step 3) |
| T6 | Yes — no-literal-colour check (step 3) matches the tokens-only constraint |
| T7 | Yes — breakpoint grep (step 2) matches the four-breakpoint constraint |
| T8 | Yes — unlayered by design, stated and justified |
| T9 | Yes — 9 of 10 auth views contain `class="error"`/`"success"` (verified); `share-login.ejs` has neither, sed is a no-op there |
| T10 | Yes — sed ordered longest-name-first so prefixes cannot corrupt suffixes |

### Rulings from the scan

Ruling: use a feature branch, not a git worktree — the EnterWorktree tool's contract restricts it to user-requested worktrees, and the user did not ask. Cost if wrong: work sits on a branch instead of an isolated checkout; trivially fixed with `git worktree add` later.

Ruling: keep `--c-green` and `--sp-7` though no Task 6/7/8 rule consumes them — they are part of the identity palette and spacing scale the spec's §Task 2 reconciliation defines, and slices 2+ charts need `--c-green`. Cost if wrong: two dead tokens a later reviewer removes in one line.

Ruling: execute only Tasks 1 and 3 in this session. T2 is a client sign-off gate and T4..T10 consume its output; dispatching them now would produce invented design values. Cost if wrong: none — the gate is real and stated in the plan.

## Progress

Task 1: implementer DONE (commit abb423a, base fac31a5). Step 4 legacy check PASS exit 0 on 3 routes; Step 5 v2 check FAIL exit 1 as required; 20 baseline screenshots captured. Chrome found at /Applications/Google Chrome.app.
Task 1: implementer concern (observation, not a defect) — two stray pre-existing processes on port 3000 (bare `node app.js` + leftover `nodemon`) predated the task, were not bypass-authenticated, and produced a false-looking Step 4 pass plus a rate-limit-error screenshot batch. Implementer detected via EADDRINUSE, killed them, redid Steps 4-6. Port 3000 confirmed clear afterward by controller.
Task 1: review dispatched (sonnet) over fac31a5..abb423a, 4 files / +105 -1.
Task 1: review — SPEC ✅ (one Important gap: `.gitkeep` deliverable not committed), QUALITY Approved. Reviewer independently traced check-skin.js pass/fail logic via truth table and confirmed genuine bidirectional discrimination, including correct FAIL when neither href is present (dead route cannot silently pass). ui-shots.js WIDTHS = [480,768,1200,1800] match the four project breakpoints exactly.
Task 1: Ruling: the `.gitkeep` finding is a plan defect, not an implementation defect — the brief mandated creating a placeholder inside a directory the same step gitignores, with no `!.gitkeep` negation, so it could never be tracked; `docs/` is untracked wholesale by user instruction besides. Struck the deliverable from the plan and documented why. No fix round dispatched. Cost if wrong: none — an empty placeholder in a gitignored directory has no function.
Task 1: complete (commits fac31a5..abb423a, review clean after ruling)
Task 3: implementer DONE_WITH_CONCERNS (commit 988947c, base abb423a). 3 files, +20/-2. Step1 red FAIL as expected; Step4 all-legacy PASS x3; Step5 flip to v2 PASS then revert to legacy PASS. Both collections verified empty in committed state.
Task 3: implementer concern — `views/auth/login.ejs` renders its own `<head>` and never includes header.ejs, so it patched login.ejs (not in the brief's file list) to make Step 5 verifiable.
Task 3: controller verified the concern and found it broader — 13 views render independent `<head>` blocks: all 10 auth views plus views/parts/report.ejs and views/reports/generate.ejs. The latter two link no external stylesheet (inline `<style>` only), so the gate does not apply to them. 9 auth views still hardcode /styles.css.
Task 3: Ruling: accept the out-of-scope login.ejs patch — without it the brief's own Step 5 could not be verified, and it is structurally identical to the header.ejs conditional. Cost if wrong: one extra file in a commit that is otherwise inert.
Task 3: Ruling: amend plan Task 9 rather than expand Task 3 — Task 9 (slice 0, Auth) assumed flipping the path prefix would move all 10 auth views; it would have moved only login.ejs and silently left 9 register views on the legacy sheet. Added Step 2b listing all 9 files and widened Step 4's verification from 3 routes to all 10. Also recorded that parts/report.ejs and reports/generate.ejs need slice 6/7 handling as self-contained pages. Cost if wrong: none — the amendment is additive and the alternative was a slice that silently half-migrated.
Task 3: review — SPEC ✅, QUALITY Approved. No Critical, no Important, no Minor. Reviewer independently verified: prefix boundary correct (`/auth` does not match `/authorize`; indexOf('/auth/') === -1), exact-match branch covers bare `/auth`, `Set.has('')` safe when activePortal is '', middleware at app.js:206 runs before the /auth mount at :256 so skinV2 is always populated, and both empty collections make skinV2 structurally false on every request. login.ejs conditional byte-identical to header.ejs.
Task 3: reviewer flagged the same register-view gap as a forward-looking risk for Tasks 9/10 — already closed by the controller's Task 9 plan amendment above.
Task 3: controller independent verification — started server, ran ui:check: all 5 routes (3 auth + 2 stores) PASS legacy, and the deliberately-wrong v2 expectation still prints FAIL. Zero user-visible change confirmed.
Task 3: complete (commits abb423a..988947c, review clean)

## Session end — plan NOT complete

Executed: Tasks 1, 3 of 10. Remaining: 2 (client gate), 4, 5, 6, 7, 8, 9, 10.
Blocked on: Task 2 foundations design canvas + client sign-off. Tasks 4-10 consume its approved values.
Branch feat/ui-reskin-foundations, 2 commits ahead of main (fac31a5..988947c). NOT pushed.
Workspace retained — plan incomplete, no final whole-branch review run (that is for when all tasks are done).

## Task 2 — design canvas

Task 2: canvas built and published — https://claude.ai/code/artifact/ef1de903-3eab-48b9-83e6-18b9da2a302a
Task 2: first draft rejected by user as "plain and dated". Also reported a real defect: Employee ID and Password rendered as blocks at the wrong width. Cause was unclosed `<input>` void tags styled by a helmet stylesheet class; the renderer did not treat them as self-closing. Fixed by self-closing every void element and moving all five controls to one inline rule with box-sizing: border-box.
Task 2: three directions mocked (A refined corporate, B dense operations console, C warm and roomy) on the same Stores dashboard. Five-page flowing print artboard added as a client handout with plain-language descriptions, honest trade-offs and a comparison table.
Task 2: Ruling: user selected Direction A. This revises spec §3's "No new visual identity or palette" non-goal — brand navy #2f6db3 and orange #ed7d31 are retained, but greys, radii, elevation and typeface all change. Recorded as spec §3.1 with a before/after table. Cost if wrong: the token layer and Tasks 6-7 value guidance would need redoing; no shipped code depends on it yet.
Task 2: Ruling: the selection came from the user, not their client. The plan's Task 2 Step 4 specified client sign-off. Treating the user's decision as sufficient to unblock Task 4, since they own the relationship and asked to move forward; the handout remains on canvas page 2 for the client conversation. Cost if wrong: if the client later rejects A, Task 4's tokens.css is one file to rewrite and no portal has flipped.
Task 2: plan amended — tokens.css block replaced with Direction A values (67 tokens, verified 0 used-but-undefined across all task code blocks); the `--radius: 0` instruction voided; Tasks 6 and 7 given explicit amendment notes because their CSS was authored for the rejected square-cornered draft and would otherwise rebuild it.
Task 2: complete (design canvas published; no commits — canvas working files live untracked under docs/superpowers/plans/canvas-1/)
Next: Task 4 (tokens.css) is now unblocked. Tasks 5-8 follow; Tasks 9-10 close the slice.

## Task 4 — token layer

Task 4: implementer DONE (commit b254a1e, base 988947c). public/css/tokens.css, 92 lines, 67 tokens — matches the amended expectation. Diff touches that one file only; verified by controller with git diff --name-only.
Task 4: controller pre-empted the same defect class in Task 5 while the implementer ran — base.css gave inputs `var(--radius)` (10px, the card radius) and a hard `outline: 2px solid` focus ring, both from the rejected square-cornered draft. Amendment added: inputs take --radius-sm, focus takes --focus-ring. Three tasks (5, 6, 7) now carry Direction A amendment notes.
Task 4: review dispatched (sonnet) over 988947c..b254a1e.
Task 4: review — SPEC ✅, QUALITY Approved. No Critical, Important or Minor findings. Reviewer diffed the brief's CSS block against the committed file byte-for-byte (reported IDENTICAL), re-ran the token count independently (67, braces balanced), confirmed no `border-radius: 0` anywhere, and confirmed the commit is the file's first and only version so nothing was clobbered.
Task 4: reviewer noted five deliberate value aliases (#ffffff, #f8fafc, #f1f5f9, #eff4fa, 48px each held by two tokens) and verified each pairing exists in the brief — design-canvas aliases, not transcription errors. No action.
Task 4: complete (commits 988947c..b254a1e, review clean)
Next: Task 5 (base.css + app.css entry point). Brief already extracted and amended for Direction A. BASE will be b254a1e.

## Tasks 5-8 — stylesheet build

Task 8: Ruling (pre-flight, before dispatch): print.css may use literal #000000/#ffffff despite the tokens-only global constraint. Screen tokens are screen values — --c-text is #0f172a (near-black for screen contrast) and --c-surface means "card surface", not "paper". Print needs true black on unprinted white, and binding print to screen tokens would mean a later palette change silently alters branch printer output. Documented as an explicit exception in the plan so the requirement itself changes rather than the reviewer being told to ignore it. Cost if wrong: three literal values in one print-only file.
Task 8: Ruling: print keeps Direction A's card radii rather than forcing square. Rounded corners reproduce fine on paper; squaring them would diverge from the approved design for no benefit. Cost if wrong: cosmetic, one line.
Task 5: implementer DONE (commit e85f15c, base b254a1e). 5 files, +121. app.css entry with @layer order; base.css 105 lines; components/layout/print created as 2-line empty stubs.
Task 5: controller verified independently — app.js absent from the diff, both gate collections still empty in the committed state, stubs genuinely empty, and the only non-var literal in base.css is `outline-offset: -2px` on the :focus-visible fallback (not a colour).
Task 5: amendment applied correctly — inputs take var(--radius-sm); :focus sets outline-color transparent + border-color accent + box-shadow var(--focus-ring); :focus-visible keeps a 2px outline for keyboard users. That is exactly the shape the amendment described.
Task 5: implementer used curl rather than a GUI browser for the 200-status evidence (none available in its environment). Flagged to the reviewer to judge as evidence rather than accepted silently.
Task 5: review dispatched (sonnet) over b254a1e..e85f15c.
Task 5: review — SPEC ❌ (1 Important: doubled focus ring), QUALITY Needs work. Layer order valid (@layer statement legally precedes @import), print.css correctly unlayered so it outranks every layered rule, radius correct, token discipline clean (every var() verified against tokens.css), gate untouched, stubs empty. Reviewer also corrected the controller's framing on the @import chain: the five URLs are siblings in one file so they fetch in parallel — 2 render-blocking round trips, not 5 serial — and judged curl adequate evidence for a pure HTTP fact.
Task 5: Ruling: the finding is valid AND the defect originates in the controller's own plan amendment, not the implementer's work. The amendment instructed a `:focus-visible` outline fallback on the false premise that it matches keyboard input only; Chromium and Edge match it on text-editable elements for mouse clicks too, so both rules fire and the ring doubles. Plan amendment rewritten to specify a single `:focus` rule and no `:focus-visible` for form controls. Fix round 1 dispatched to the original implementer. Cost if wrong: a focus ring that is visible on click as well as keyboard — the correct behaviour for text fields either way.
Task 5: fix round 1/5 (1 addressed, 0 open — :focus-visible rule deleted; commits e85f15c..170e73c, pure 5-line deletion in base.css, no other file touched). Scoped re-review dispatched (haiku).
Task 5: re-review — finding ADDRESSED (:focus-visible gone, :focus keeps all three declarations including outline-color: transparent, focus stays visible for keyboard). New breakage: none. Pure deletion, :disabled rule undisturbed.
Task 5: complete (commits b254a1e..170e73c, review clean after 1 fix round)

Task 6: amendment tightened before dispatch — added exact button values (.btn on --c-surface with --c-border-strong; .btn--primary accent, border 0, hover --c-accent-strong; .btn--danger bad-bg/line/ink; disabled opacity .5) and the status-pill dot spec, both read off the foundations artboard. The stale block would otherwise have produced near-white --c-surface-nav buttons and dotless pills.
Task 6: implementer DONE (commit 5a32f13, base 170e73c). 30 classes, braces balanced, no literal colours. Flagged rather than guessed: the amendment specifies status-pill styling but `.pill` is absent from the required-30 Interfaces list, and the outer instructions forbade inventing classes. Correct escalation.
Task 6: Ruling: the implementer is right and the plan is wrong. The Interfaces list omitted `.pill`/`.pill--ok`/`.pill--bad` although this task's own amendment styles them and every Till column on the approved Stores artboard shows one. Verified in the tree: views/stores/index.ejs:90 renders till status as bare text, and legacy `fte-pill` classes already exist across views/gm/ and views/partials/fte-branch-section.ejs — so a pill IS part of the shared layer. Interfaces list corrected to 33 classes. Cost if wrong: three unused rules in one CSS file.
Task 6: Ruling: Task 10 gains one presentational markup addition — wrapping the till-status cell in a pill span. Same value, same source, no flow or data change, and Task 10 already edits that file for class renames. Recorded in the plan with the exact EJS. Cost if wrong: one line to revert in one view.
Task 6: fix round 1/5 (1 addressed, 0 open — three pill classes added with ::before dot; commits 5a32f13..54f5e2b). 33 classes, no literal colours. Full task review dispatched (sonnet) over the whole 170e73c..54f5e2b range, not just the fix.
Task 6: review — SPEC ✅, QUALITY Approved. All 33 classes present, exactly spelled, no extras, no missing. Amendment fully complied with (radii per token, --shadow-card on all five card types, --fs-metric on kpi value, accent left-border dropped, buttons exactly as specified, disabled opacity .5). Pills correct: .pill is a real idle state and the dot is a ::before so view markup stays a plain span.
Task 6: controller resolved the reviewer's ⚠️ (it did not re-execute the verification scripts) by running them directly — components.css balanced at 43 brace pairs, no literal colours, and 33 unique classes enumerated and matched one-for-one against the required list.
Task 6: Ruling: keep `.nav-card { border-top: 4px solid }` as a literal despite --sp-1 also being 4px. That is a border WIDTH, not spacing; binding it to the spacing scale would move the accent bar the next time spacing is retuned. Reviewer graded it Important-borderline; declining, with the reasoning recorded. Cost if wrong: one 4px literal in one rule.
Task 6: Ruling: keep `border-radius: 50%` on the pill dot. 50% is the correct idiom for a circle and resolution-independent; --radius-pill (999px) is a length that happens to work at 6px. Cost if wrong: one line.
Task 6: all three literal exceptions (print black/white, nav-card border width, pill dot) now documented in the plan's Global Constraints so a later slice does not "fix" them.
Task 6: complete (commits 170e73c..54f5e2b, review clean after 1 fix round)

Task 7: implementer DONE (commit 2104572, base 54f5e2b). layout.css only. Exactly 5 media queries for the 4 breakpoints; no literal colours; the single remaining border-bottom is on .site-header per the amendment (nav underlines gone); .brand-mark defined.
Task 7: implementer surfaced a plan defect — the Step 2 breakpoint grep matched bare `max-width:` strings, so ordinary CSS property values (.auth-card max-width 420px, .approval-nav__count min-width 20px) registered as phantom breakpoints. It proved this by running the same grep against the plan's own literal block and getting identical noise. Check rewritten to match on `@media`. Cost of the old check: a reviewer could have failed a correct file, or passed a file with a real fifth breakpoint hidden in the noise.
Task 7: implementer disclosed one judgement call — .brand-mark font-size/weight unspecified in the amendment, chose --fs-small/--fw-bold. Passed to the reviewer to judge rather than accepted silently.
Task 7: review dispatched (sonnet) over 54f5e2b..2104572, with the two live partials named as required reading so selector-to-markup fidelity is actually checked.
Task 7: review — SPEC ❌ (1 Critical, 1 Important), QUALITY Needs work. Selector-to-markup fidelity otherwise excellent; app-fullscreen preserved; breakpoint cascade coherent and the 48px touch promise correctly delivered here for both tablet and phone; brand-mark judgement call accepted.
Task 7: Critical CONFIRMED by controller — `.site-header nav a` has specificity (0,1,2) and `.nav-link--active` only (0,1,0), so the active link's `color: var(--c-accent)` never applies and the hover rule (0,2,2) also overrides the active background. The amendment's core visual requirement silently does not take effect. Real defect, invisible from reading the declaration block.
Task 7: Important found by controller beyond the reviewer's ⚠️ — `site-header__left`, `site-header__logo-wrap`, `site-header--gm` and `site-header--gm-clean` appear in the live header.ejs (lines 86-125) and are styled 15 times in legacy styles.css but ZERO times in layout.css. Any portal flipped to v2 would lose those header containers' layout entirely. Plan's "Produces" list omitted them.
Task 7: Ruling: three literals get real tokens — z-index 1000 -> --z-header, letter-spacing 0.08em -> --ls-wide, auth card 420px -> --auth-card-max. tokens.css goes 67 -> 70; plan's expected count updated. Cost if wrong: three tokens nothing else uses.
Task 7: Ruling: `100vh` and `min-width: 20px` accepted as documented exceptions 4 and 5 — a viewport unit is not a design value, and the 20px badge minimum is the same class of fixed decorative size as the pill dot.
Task 7: Ruling: AGAINST the reviewer on responsive token redefinition. Overriding `--container-max`, `--fs-body` etc. inside a media query is the canonical way to make a token responsive; the literal belongs there. Declaring every responsive variant in tokens.css would be worse. Documented in the plan so it is not re-raised. Cost if wrong: none — the alternative is strictly more complex.
Task 7: fix round 1/5 (3 addressed pending re-review, 0 open; commits 2104572..082d612, layout.css + tokens.css, +53/-4). Controller verified: both nav-link--active occurrences now qualified as `.site-header nav a.nav-link--active`, no !important; 7 references to the previously-unstyled header containers; tokens at 70 with --z-header/--ls-wide/--auth-card-max present; the three bare literals gone; still exactly 5 media queries.
Task 7: scoped re-review dispatched (sonnet), told to compute specificities itself rather than trust the selector text, and to check the new header-container rules against the real nesting in header.ejs.
Task 7: re-review — A (Critical, active nav colour) ADDRESSED with a genuine specificity win, verified by the reviewer computing all four selectors: base (0,1,2), hover (0,2,2), active (0,2,2), active:hover (0,3,2). No !important, no reliance on source order. B (unstyled header containers) ADDRESSED, structural mechanics preserved and no legacy colours carried across. C (three tokens) ADDRESSED, 70 tokens, all referenced, no bare literals left. New breakage: none.
Task 7: re-reviewer's out-of-scope note (`.site-header__left--gm-stack` still unstyled) investigated rather than deferred — it is load-bearing (flips the GM header's left block from row to column) and led the controller to audit the whole shared-partial surface instead of fixing one class.
Task 7: AUDIT — enumerated all 27 classes used in header.ejs + footer.ejs against layout.css + components.css + base.css. 16 covered, 11 gaps. Two kinds: (a) classes needing a RENAME in views, already or now in the rename map — `error`, `btn-fullscreen`, `btn-secondary`, `global-error-message`; (b) classes needing real v2 rules with no semantic equivalent — the `delete-password-dialog` family (25+5+1 legacy rules, a <dialog> modal footer.ejs renders on EVERY page as the delete-confirmation gate), `portal-watermark`, `site-header__left--gm-stack`, `header-user-badge--gm-lead`, and the base `approval-nav`.
Task 7: Ruling: category (a) goes to Task 9 via the rename map, extended today with the three that were missing. Category (b) becomes Task 7 fix round 2 — it is page chrome and belongs in the layout layer. Cost if wrong: the dialog rules could arguably have gone to Task 6 as a component; putting them in layout avoids reopening a completed task for the same surface.
Task 7: fix round 2/5 (5 classes styled; commits 082d612..3cdd001, layout.css +90, tokens.css +2). Controller re-ran the shared-partial audit: gaps down from 11 to 4, and those 4 are exactly the rename-map classes Task 9 owns (error, btn-fullscreen, btn-secondary, global-error-message). Structural surface now complete.
Task 7: implementer added --c-backdrop (rgba(15,23,42,.5)) and --portal-watermark-inset (210px), 70 -> 72 tokens; plan's expected count updated. Passed to the re-reviewer to judge whether a single-use 210px layout constant earns a token rather than accepting it silently.
Task 7: scoped re-review of round 2 dispatched (sonnet), told to check the dialog rules against the real <dialog> structure in footer.ejs including ::backdrop, and to confirm round 1 still holds.
Task 7: round 2 re-review — ADDRESSED. All five verified against real markup: dialog works with native showModal() centering (no position/margin override) and ::backdrop handled; --gm-stack wins on source order over .site-header__left, both at (0,1,0); --gm-lead adds only width properties so round 1's no-chip treatment holds; portal-watermark's absolute positioning resolves against the sticky header and its z-index layering mirrors legacy; .approval-nav base adds only disjoint properties so it composes with .site-header nav a rather than fighting it. New breakage: none. Round 1 confirmed still holding.
Task 7: minor (deferred): --portal-watermark-inset (210px) is over-tokenised — a single-use position value, not on the --sp-* scale, not a colour/radius/shadow so never required to be a token. Controller agrees with the reviewer. Minor, so not entering the fix loop; flagged for the final whole-branch review to triage. Cost: one surplus token.
Task 7: complete (commits 54f5e2b..3cdd001, review clean after 2 fix rounds)

Task 8: implementer DONE (commit 887bb3a, base 3cdd001). print.css only, unlayered confirmed (0 @layer occurrences).
Task 8: Important found by controller — the print sheet hides `.back-chip`, a class that exists NOWHERE in the codebase. The real class from views/partials/back-button.ejs is `app-back-arrow`; legacy hides `.app-back-chip, .app-back-arrow` at styles.css:660. Under v2 the back arrow would print on every page of every printed document. Defect originates in the controller's plan block, which invented the class name.
Task 8: controller scrutinised the implementer's "legacy coverage parity" claim and found it overstated but harmless. The three legacy print blocks split by owner: :660 is shared chrome plus `.customer-invoice*` (views/workorders/billing.ejs, slice 5), :1933 is `.stm-*` (slice 5), :5982 is `.pm-*` (slice 6). Parity for slices 5/6 is impossible now — those classes belong to unmigrated views that still load the legacy sheet and keep its print rules. Recorded in the plan as a slice 5/6 obligation, with a note that .customer-invoice is the BIR sales invoice and losing its print styling is a compliance problem.
Task 8: fix round 1/5 (1 addressed, 0 open — .back-chip replaced with .app-back-arrow; commits 887bb3a..88cffda, one-word change in print.css). Report corrected to claim shared-chrome coverage only rather than full legacy parity.
Task 8: full task review dispatched (sonnet) over the whole 3cdd001..88cffda range, with all three shared partials named as required reading so invented-selector defects of the .back-chip kind get caught rather than assumed absent.
Task 8: review — SPEC ✅, QUALITY Needs work (1 Important, 2 Minor). No Critical. Reviewer confirmed the unlayered structure by reading app.css's import clauses rather than grepping, verified .app-back-arrow is load-bearing (back-button.ejs renders standalone in <body> on all 10 auth views, outside .site-header, so it is the ONLY thing stopping the arrow printing there), and found no further invented selectors.
Task 8: Ruling: the Important finding is valid — `border: 1px solid` should be `var(--border-w)`. Verified: --border-w exists at tokens.css:70 and is used 14 times across base/layout/components. Entering fix round 1. (Reviewer said "twice"; it occurs once. Does not change the finding.)
Task 8: Ruling: fix the #kpi-warn-overlay Minor in the same round despite Minors normally being deferred — it is a one-line hide, the div is real (footer.ejs:229) and position:fixed, and batching it costs nothing versus a separate round later. Cost if wrong: one surplus rule.
Task 8: Ruling: `font-size: 11pt` stays. Extended the documented print exception to cover print-domain absolute units alongside black and white — print is a different medium and the type tokens are screen rem. Declined to add a single-use --fs-print-body token, consistent with the --portal-watermark-inset judgement. Cost if wrong: one literal in one print-only file.
Task 8: verification debt recorded — no GUI browser here, so pagination, thead repetition across page breaks, and whether print-color-adjust actually forces backgrounds in Chrome remain unverified. This can only be closed with a real print preview once a portal flips.
Task 8: round 2 re-review — A (border-w token) ADDRESSED, B (toast hidden) ADDRESSED. Reviewer specifically confirmed the mixed class/ID selector list is valid CSS and no previously-hidden selector was dropped — an invalid selector anywhere in a list drops the ENTIRE rule, which would have silently un-hidden header, footer, buttons and back arrow on every printed page. New breakage: none.
Task 8: complete (commits 3cdd001..bac34d8, review clean after 2 fix rounds)

## Batch 5-8 complete
Stylesheet built: 822 lines across app/tokens/base/components/layout/print. Gate still empty in the committed state — every route still serves legacy /styles.css, zero user-visible change.
Remaining: Tasks 9 (Auth) and 10 (Stores). These are the first that change what anyone sees.

# ============ HANDOFF — new session starts here ============

STATE: Tasks 1, 3, 2, 4, 5, 6, 7, 8 complete. Tasks 9 and 10 remain.
BRANCH: feat/ui-reskin-foundations, 13 commits ahead of main (fac31a5..bac34d8). NOT pushed.
GATE: SKIN_V2_PORTALS and SKIN_V2_PATH_PREFIXES both EMPTY at app.js:132/135. Every route still serves legacy /styles.css. Zero user-visible change so far — verified by `npm run ui:check -- legacy <routes>`.

WHAT EXISTS:
  public/css/{app,tokens,base,components,layout,print}.css — 822 lines, nothing imports it into a page yet
  scripts/check-skin.js  -> npm run ui:check -- <legacy|v2> <route...>
  scripts/ui-shots.js    -> npm run ui:shots -- <outdir> <route...>
  docs/superpowers/plans/baselines/before/ — 20 pre-change screenshots (gitignored)

TO RESUME:
  1. Read docs/superpowers/plans/2026-08-31-dms-ui-reskin-foundations.md, Tasks 9 and 10.
  2. Read spec §3.1 — Direction A was adopted mid-project and revises the original non-goals.
  3. Invoke superpowers:subagent-driven-development. It will find this ledger and resume at Task 9.

TASKS 9 AND 10 ARE THE FIRST THAT CHANGE WHAT USERS SEE. Watch for:
  - Task 9 amendment: all 10 auth views render their own <head>; login.ejs is already gated, the other 9 hardcode /styles.css and each needs the conditional. Verify all 10 routes, not 3.
  - Task 10: wrap the till-status cell in a pill span (exact EJS is in the plan). One presentational markup addition beyond class renames.
  - Rename map now includes btn-fullscreen, btn-secondary, global-error-message — added after the shared-partial audit. Four such classes remain unstyled in v2 BY DESIGN; they are renamed in views, not styled.
  - Strip-and-flip must ship in the SAME commit. Slices 0 and 1 have 0 inline styles so this is not exercised until slice 2, but the constraint stands.

OPEN VERIFICATION DEBT (cannot close without a GUI browser):
  - Print: pagination, thead repetition across page breaks, whether print-color-adjust forces backgrounds in Chrome. Close with a real print preview once a portal flips.
  - Every CSS file so far has been reviewed as SOURCE only. Nothing has been rendered in a browser. Task 9's screenshot step is the first real visual check.

DEFERRED MINORS for the final whole-branch review:
  - --portal-watermark-inset (210px) is over-tokenised; single-use position value.

LATER SLICES — do not lose:
  - Slices 5 and 6 must port their own print rules. styles.css:1933 (.stm-*) and :5982 (.pm-*), plus .customer-invoice* inside :660 (views/workorders/billing.ejs). .customer-invoice is the BIR sales invoice — losing its print styling is a compliance problem.
  - legacy fte-pill / fte-pill--<tone> maps onto .pill / .pill--ok / .pill--bad in slices 2 and 5.
