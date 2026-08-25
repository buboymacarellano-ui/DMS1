# Secure and Stable Operations Guide (Multi-Branch)

## 1) Run the app in production mode

Use Windows environment variables (recommended):

```powershell
setx NODE_ENV production
setx SESSION_SECRET "REPLACE_WITH_A_LONG_RANDOM_SECRET_32_PLUS_CHARS"
```

Open a new terminal, then run:

```powershell
npm.cmd install
npm.cmd run start:prod
```

## 2) Live database that survives refresh and restart

Shop records are stored in SQLite. A JSON snapshot is written beside it on every save.

- Local database: `%LOCALAPPDATA%\AE-DMS\shop.sqlite`
- Local JSON snapshot: `%LOCALAPPDATA%\AE-DMS\data-snapshot.json`
- Cloud database (Render disk): `/data/shop.sqlite`
- Cloud JSON snapshot: `/data/data-snapshot.json`
- Git `data/data.json` is a **first-boot seed only**. It is never used to overwrite an existing database.

Page refresh, app restart, and redeploy keep the same records as long as the SQLite file stays on that persistent disk.

## 3) Cloud deploy (recommended): Render + GitHub + persistent disk

This is the standalone always-on setup for city-wide login:

1. Push this repo to GitHub (`buboymacarellano-ui/DMS1`).
2. Open [https://dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
3. New → Blueprint, select the `DMS1` repo (`render.yaml`).
4. Use the **Starter** plan so the service does not sleep.
5. Render creates HTTPS, a 2 GB disk at `/data`, and `SESSION_SECRET`.

After the first boot, `/data/shop.sqlite` is the live database. Later deploys do not wipe it.

Local login on this PC:

- `http://127.0.0.1:3000/auth/login`

## 4) Keep app always on (auto-restart)

Install NSSM, then create a service:

- Application: node.exe
- Startup directory: project folder
- Arguments: app.js
- Environment:
  - NODE_ENV=production
  - SESSION_SECRET=your-long-random-secret

Set service startup to Automatic and Recovery to Restart on failure.

## 5) Daily backups with retention

Manual backup:

```powershell
npm.cmd run backup:retain30
```

Schedule daily backup in Task Scheduler:

- Program/script: npm.cmd
- Arguments: run backup:retain30
- Start in: project folder
- Trigger: Daily (off-hours)

Backups older than retention days are removed automatically.

## 6) Health check for monitoring

App now exposes:

- /healthz

Should return JSON `status: ok`, `storage: sqlite`, and `persistent: true`.

## 7) Mandatory security checks before all-branch rollout

- Use unique strong passwords for all users.
- Restrict admin account sharing.
- Keep the GitHub repo private (it contains operational JSON).
- Update Node.js and npm packages monthly.
- Keep Windows auto-update enabled.
- Test backup restore at least monthly.

## 8) If a branch PC cannot open the login page

- Use the Render HTTPS URL after cloud deploy.
- On this PC, confirm `http://127.0.0.1:3000/healthz` returns ok.
