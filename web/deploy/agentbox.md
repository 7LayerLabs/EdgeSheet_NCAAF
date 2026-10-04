# Deploying EdgeSheet to agentbox

agentbox is Derek's always-on Ubuntu box on Tailscale: `root@100.68.230.36`. PM2 is already installed there. These steps have not been run yet; this is the plan, written so the first run is boring.

The site runs as `next start` on port 3000 under PM2, with three side processes (Telegram bot, odds snapshots, prewarm) and one watchdog (healthcheck). Nothing here needs a public domain. Phone access is through Tailscale at `http://100.68.230.36:3000`.

## 0. Before you touch the box

- The Telegram bot long-polls `getUpdates`. Telegram allows ONE poller per bot token. The moment `scout-telegram` starts on agentbox, stop the one on the Windows PC (`pm2 stop scout-telegram` there), or both will fight and drop messages. Sending messages (healthcheck alerts, the "Send to Telegram" buttons) is fine from anywhere; only polling conflicts.
- Odds API credits are shared across machines too. Run `scout-odds` in one place.
- `.env.local` never goes through git. Copy it by hand (step 3).

## 1. One-time box setup

```bash
ssh root@100.68.230.36

# Node 22 LTS (Next 16 needs 20.9+; 22 is what the Windows box runs)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs rsync git
node -v && npm -v && pm2 -v

# Headless Chrome. src/lib/render.ts shells out to a real browser binary (no puppeteer) to render
# the Saturday sheet PNG that Telegram sends as a photo. It looks in /usr/bin/google-chrome and
# /usr/bin/chromium, or wherever CHROME_PATH points.
apt-get install -y chromium || snap install chromium
ls -l /usr/bin/chromium /usr/bin/chromium-browser 2>/dev/null
# If the binary ended up somewhere else (snap puts it at /snap/bin/chromium), add to .env.local:
#   CHROME_PATH=/snap/bin/chromium

mkdir -p /opt/edgesheet
```

Timezone: PM2 cron strings run in the box's local time. Set the box to Eastern so the schedules below mean what they say.

```bash
timedatectl set-timezone America/New_York
pm2 update
```

## 2. Get the code there

Two options. Pick one and stick with it.

**rsync from the Windows PC (no git remote needed).** Run from PowerShell or Git Bash on the PC. Excludes build output, node_modules, and data that must persist on the box.

```bash
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .env.local \
  --exclude 'data/archive' --exclude 'data/odds' --exclude 'data/ai' --exclude 'data/snapshots' --exclude 'data/sheets' \
  --exclude 'data/declarations.json' --exclude 'data/grades.json' --exclude 'data/follows.json' \
  --exclude 'data/telegram-state.json' --exclude 'data/healthcheck-state.json' --exclude 'data/prewarm-last.json' \
  "/c/Users/derek/OneDrive/Desktop/ASTRA_TESTING/college-game-scout/web/" root@100.68.230.36:/opt/edgesheet/
```

**git pull on the box.** Only if the repo has a remote. Then `deploy/agentbox-deploy.sh` does `git pull` for you when `REPO_URL` is set.

## 3. Secrets

```bash
scp "/c/Users/derek/OneDrive/Desktop/ASTRA_TESTING/college-game-scout/web/.env.local" root@100.68.230.36:/opt/edgesheet/.env.local
ssh root@100.68.230.36 "cd /opt/edgesheet && sed -i 's#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://100.68.230.36:3000#' .env.local; grep -q PUBLIC_BASE_URL .env.local || echo PUBLIC_BASE_URL=http://100.68.230.36:3000 >> .env.local"
```

`PUBLIC_BASE_URL` is what Telegram links point at. On agentbox it must be the Tailscale address, not localhost, or the links in your phone open nothing.

Keys the box needs in `.env.local`: `CFBD_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ODDS_API_KEY`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `PUBLIC_BASE_URL`.

## 4. First deploy

```bash
ssh root@100.68.230.36
cd /opt/edgesheet
chmod +x deploy/agentbox-deploy.sh
./deploy/agentbox-deploy.sh
```

The script, in order: pull or verify the code, `npm ci`, check `.env.local`, `npm run ingest` (CFBD rosters and stats, several minutes, rate-limited), `npm run ingest:plays`, then `npx next build` directly (not `npm run build`, whose `prebuild` hook would run ingest a second time), then PM2 start or restart for every process, then `pm2 save`.

Then, on the Windows PC: `pm2 stop scout-telegram` and `pm2 stop scout-odds` (one poller, one credit budget).

## 5. PM2 process list on the box

| Name | Command | Schedule |
| --- | --- | --- |
| `scout` | `next start -p 3000` | always on |
| `scout-telegram` | `node scripts/telegram-bot.mjs` | always on (long poll, internal schedule) |
| `scout-odds` | `node scripts/odds-snapshot.mjs` | cron `0 */4 * * 3,4,5,6` (every 4h Wed to Sat) |
| `scout-prewarm` | `node scripts/prewarm.mjs --scheduled` | cron `*/10 * * * *`; the script runs every tick Sat 9 AM to 1 AM ET and only on :00/:30 otherwise |
| `scout-health` | `node scripts/healthcheck.mjs --notify` | cron `*/15 * * * *`; Telegram message only on failure, at most hourly, plus one on recovery |

The exact commands (also in the deploy script):

```bash
cd /opt/edgesheet
pm2 start node_modules/next/dist/bin/next --name scout --time -- start -p 3000
pm2 start scripts/telegram-bot.mjs --name scout-telegram --time
pm2 start scripts/odds-snapshot.mjs --name scout-odds --time --cron "0 */4 * * 3,4,5,6" --no-autorestart
pm2 start scripts/prewarm.mjs --name scout-prewarm --time --cron "*/10 * * * *" --no-autorestart -- --scheduled
pm2 start scripts/healthcheck.mjs --name scout-health --time --cron "*/15 * * * *" --no-autorestart -- --notify
pm2 save
pm2 startup systemd -u root --hp /root   # once; paste the command it prints
```

## 6. Data that must persist

Everything under `data/` except `data/generated` and `data/cache` is the product's memory. Never let a deploy delete it. The rsync line above excludes these paths; the deploy script refuses to run `rm -rf` on any of them.

| Path | What it is | Lose it and |
| --- | --- | --- |
| `data/archive/<season>/` | every locked pregame call and its postgame grade | the Record page and Ledger reset to zero |
| `data/odds/<season>/` | line snapshots, closing lines, props | CLV columns go blank |
| `data/declarations.json` | declared / returning decisions | draft forecast loses them |
| `data/grades.json` | graded calls written by the Telegram and web flows | same as archive loss for those |
| `data/follows.json` | followed teams and players | kickoff reminders and radar alerts stop |
| `data/ai/` | written reports and usage log | reports re-cost money to regenerate |
| `data/snapshots/<date>/` | weekly radar and forecast snapshots from `scripts/snapshot.mjs`; the "who moved" memory | movement arrows and sparklines go blank |
| `data/sheets/` | rendered Saturday sheet PNGs | re-rendered on demand, cheap to lose |
| `data/telegram-state.json` | update cursor and sent-reminder ledger | duplicate reminders on restart |

`data/generated/` (ingest output) and `data/cache/` are rebuilt by `npm run ingest`; safe to delete.

Back them up with one line from the PC whenever you like:

```bash
rsync -az root@100.68.230.36:/opt/edgesheet/data/ "/c/Users/derek/OneDrive/Desktop/ASTRA_TESTING/edgesheet-data-backup/"
```

## 7. Every later deploy

From the PC: rsync (step 2), then `ssh root@100.68.230.36 /opt/edgesheet/deploy/agentbox-deploy.sh`. Takes a few minutes, mostly ingest and build. The site stays up on the old build until `pm2 restart scout` at the very end.

Skip the slow ingest when nothing changed in rosters: `SKIP_INGEST=1 ./deploy/agentbox-deploy.sh`.

## 8. Checking on it

```bash
pm2 ls
pm2 logs scout --lines 50
pm2 logs scout-health --lines 20
node scripts/healthcheck.mjs            # from the box, prints every check
curl -s http://100.68.230.36:3000/api/notify   # Telegram readiness as the server sees it
```

If `scout-health` starts messaging you: `pm2 logs scout --err --lines 100` first, then `pm2 restart scout`. If CFBD is returning 429s, wait; the slate memo keeps the last good build in memory for the lifetime of the process.

## Known gaps

- No HTTPS and no auth. Tailscale is the perimeter. Do not port-forward 3000.
- `prebuild` runs ingest on every `npm run build`. The deploy script works around it; a cleaner fix is to drop the `prebuild` hook and let the deploy script own ingest.
- Headless Chrome on the box is untested until the first deploy. If a chart route fails, `npx playwright install chromium` is the usual fix.
