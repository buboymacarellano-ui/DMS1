# A&E Auto Service DMS — Technical Reference

Developer and IT documentation. For end-user instructions, see [README.md](README.md).

Shop management system for a multi-branch auto repair operation in Cebu. Server-rendered Express 4 + EJS, backed by SQLite. No build step, no frontend framework.

Requires Node >= 22.5.0.

## Quick start

```bash
npm install
npm run dev            # nodemon app.js on http://127.0.0.1:3000
```

Login page: `http://127.0.0.1:3000/auth/login`
Health check: `http://127.0.0.1:3000/healthz` — returns `status: ok`, `storage: sqlite`, `persistent: true`.

### Other run modes

```bash
npm start              # node app.js (port 3000)
npm run start:admin    # same app, PORT 3001
npm run start:gm       # same app, PORT 3002
```

`app-admin.js` and `app-gm.js` are 3-line wrappers that set a port and `require('./app')`. They are not separate applications.

### Production

`npm run start:prod` uses Windows `set` syntax. On macOS/Linux run:

```bash
NODE_ENV=production node app.js
```

Set `SESSION_SECRET` to a long random value in production. See `.env.example` for the full environment variable list.

## Storage

`data/store.js` is the single data access layer. Everything is documents in named collections (`users`, `work_orders`, `parts_inventory`, `approval_requests`, …). `lib/sqlite-engine.js` backs it with Node's built-in `node:sqlite` and writes a JSON snapshot beside the database on every save.

| Environment | Database | Snapshot |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\AE-DMS\shop.sqlite` | `%LOCALAPPDATA%\AE-DMS\data-snapshot.json` |
| macOS / Linux | `data/AE-DMS/shop.sqlite` | `data/AE-DMS/data-snapshot.json` |
| Render (cloud) | `/data/shop.sqlite` | `/data/data-snapshot.json` |

Override the path with `DMS_SQLITE_PATH`.

**`data/data.json` is a first-boot seed only.** It never overwrites an existing database. Page refresh, app restart, and redeploy all keep the same records as long as the SQLite file stays on its persistent disk.

## Access control

`lib/portals.js` is the authority for who can do what, on a role → department → portal → grants model. Six portals: `service`, `parts`, `stores`, `hr`, `gm`, `fo`. Roughly 20 roles, each mapped to a grant set per portal.

Adding a role or a permission means editing `lib/portals.js` — not adding checks inside routes.

Two independent login bypasses exist and should not be confused:

- `DISABLE_LOGIN=1` environment variable — dev-only, injects a fake session user with `BYPASS_ROLE`.
- Store setting `auth_settings.login_disabled` — runtime "open login" toggle, cached in `lib/login-auth.js`.

## Full screen and kiosk mode

There are two separate mechanisms. They are often confused, and mixing them causes bugs.

### 1. In-app Full Screen button

Implemented once, in `views/partials/footer.ejs` (`initFullscreenToggle`). The button markup lives in `views/partials/header.ejs` as `#fullscreen-toggle`.

Behavior:

- Toggles on click only. Calls `requestFullscreen()` / `exitFullscreen()`.
- Persists the preference in `localStorage` under `ae_app_full_mode`.
- Applies the `app-fullscreen` body class, which hides the footer and widens the container (see `public/styles.css`). This layout still applies when the browser blocks native fullscreen.

**Do not add a second fullscreen script.** A duplicate implementation previously lived in `header.ejs` and was removed. It registered global `click` / `touchstart` / `keydown` listeners that forced fullscreen on any first interaction, ignored the stored preference, and raced the footer's `exitFullscreen()` so the user could not leave fullscreen. If fullscreen behaves oddly, check for a second handler on `#fullscreen-toggle` before changing the footer script.

### 2. Kiosk mode (browser launch flags)

A browser **cannot** enter fullscreen on page load without a user gesture. This is a browser security rule and no application code can work around it. Always-on fullscreen — for example a GM terminal at a branch — comes from launching the browser with kiosk flags, not from the app.

Windows shortcut Target field:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://dms1-4l6e.onrender.com/auth/login
```

macOS:

```bash
open -na "Google Chrome" --args --kiosk --app=https://dms1-4l6e.onrender.com/auth/login
```

Softer variant that keeps normal browser chrome available:

```bash
open -na "Google Chrome" --args --start-fullscreen --app=https://dms1-4l6e.onrender.com/auth/login
```

Against a local server:

```bash
npm run dev
open -na "Google Chrome" --args --kiosk --app=http://127.0.0.1:3000/auth/login
```

Kiosk mode hides tabs and the address bar; quit with `Cmd+Q` (macOS) or `Alt+F4` (Windows).

If a kiosk terminal stops opening fullscreen after a deployment change, the usual cause is a shortcut still pointing at the old URL — update the shortcut, do not add fullscreen code to the app.

## Layout

- `routes/` — one thin router per domain.
- `lib/` — domain logic: parts inventory controller, finance ledger, work-order status, comeback metrics, PDF and receipt builders, document numbering.
- `views/` — EJS templates, one subdirectory per portal or domain, shared partials in `views/partials/`.
- `scripts/` — data migration, import, seeding, simulation, and backup scripts. Most accept `--dry-run`; see `package.json` for the full list.
- `data/` — the store layer and the first-boot seed.
- `app.js` — roughly 3000 lines. Middleware order matters; see CLAUDE.md for the request pipeline.

## Domain conventions

- **Branches** (`lib/branches.js`): seven operational branches — Carx2, Carmen, CebuCity, Lapux2, Bogo, Toledo, ITPark. `CebuCity` is the flagship. Older names still appear in imported data, so always run values through `canonicalizeBranchName()`. `Proposed Location` is the pipeline / pre-operational branch.
- **Document numbers** are generated by the dedicated `lib/parts-*-number.js` modules, which scan existing rows for the maximum sequence (for example `PTN-YYYYMMDD-000001`). Use them rather than hand-rolling IDs.
- **Work order hold statuses** (`lib/work-order-status.js`): `waiting-parts`, `break`, `on-other-priority`.
- **Approvals**: cross-portal requests land in the `approval_requests` collection and surface at `/approvals` for any role holding the `approval` or `request` grant.

## Common data scripts

```bash
npm run migrate:sqlite                 # JSON -> SQLite
npm run import:transactions            # add --replace to wipe first
npm run flow:branch-parts-10pct        # request -> PM approve -> receive simulation
npm run seed:wo-txdb-1000              # seed 1000 work-order transactions
npm run provision:employee-logins
npm run backup                         # honors BACKUP_RETENTION_DAYS
```

## Deploy

`render.yaml` defines a Docker web service with a 2 GB persistent disk at `/data`, a `/healthz` health check, and an auto-generated `SESSION_SECRET`. Use the Starter plan or above so the service does not sleep.

`SECURE-OPERATIONS.md` covers the Windows always-on service (NSSM), scheduled backups, and the pre-rollout security checklist.

## Testing

There is no test suite and no linter. Verify changes by running the app and exercising the affected routes.
