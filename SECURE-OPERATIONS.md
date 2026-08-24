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

## 2) Live data is SQLite (not the Cloudflare tunnel)

The shop now stores live records in a local SQLite database:

- Database file: `%LOCALAPPDATA%\AE-DMS\shop.sqlite`
- Path pointer: `data\sqlite-path.txt`
- `data\data.json` is the last JSON snapshot used for the first migration. New work is saved in SQLite.

Keep public access always on by leaving this PC on. The always-run task starts `node app.js` at logon and restarts it if it stops:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\buboy\OneDrive\Desktop\DMS1\scripts\install-always-run.ps1"
```

Login URLs:

- This computer: `http://127.0.0.1:3000/auth/login`

Cloudflare Tunnel is turned off. Other-city internet login needs this PC to be published again (router port forward or a public host). Until then, log in on this computer.

## 3) Keep app always on (auto-restart)

Install NSSM, then create a service:

- Application: node.exe
- Startup directory: project folder
- Arguments: app.js
- Environment:
  - NODE_ENV=production
  - SESSION_SECRET=your-long-random-secret

Set service startup to Automatic and Recovery to Restart on failure.

## 4) Daily backups with retention

Manual backup:

```powershell
npm.cmd run backup:retain30
```

Schedule daily backup in Task Scheduler:

- Program/script: npm.cmd
- Arguments: run backup:retain30
- Start in: project folder
- Trigger: Daily (off-hours)

Backups older than retention days are removed automatically. A backup includes a JSON snapshot plus a `.sqlite` copy under `data\`.

## 5) Health check for monitoring

App now exposes:

- /healthz

From any machine that can reach the app URL:

- http://127.0.0.1:3000/healthz

Should return JSON status ok and `"storage":"sqlite"`.

## 6) Mandatory security checks before all-branch rollout

- Use unique strong passwords for all users.
- Restrict admin account sharing.
- Update Node.js and npm packages monthly.
- Keep Windows auto-update enabled.
- Test backup restore at least monthly.

## 7) If a branch PC cannot open the login page

- Use the URL in `data\public-url.txt` from a PC on the same network.
- Confirm this host PC is on and `http://127.0.0.1:3000/healthz` returns ok.
- For long-distance internet access, this PC must be reachable on port 3000 from the internet (router port forward) or a public host. The old Cloudflare tunnel is no longer used.
