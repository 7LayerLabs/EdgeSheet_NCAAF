#!/usr/bin/env bash
# EdgeSheet deploy for agentbox (Ubuntu, PM2). Run ON the box, from anywhere:
#
#   /opt/edgesheet/deploy/agentbox-deploy.sh
#
# Env knobs:
#   APP_DIR=/opt/edgesheet          where the code lives
#   REPO_URL=<git url>              set it and the script git-pulls; unset means the code was rsynced here already
#   BRANCH=main                     branch to pull
#   SKIP_INGEST=1                   skip the CFBD ingest steps (rosters unchanged, just a code change)
#   PUBLIC_BASE_URL=...             defaults to http://100.68.230.36:3000 and is written into .env.local
#
# Never deletes anything under data/. See deploy/agentbox.md for the data that must persist.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/edgesheet}"
BRANCH="${BRANCH:-main}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://100.68.230.36:3000}"
ENV_FILE="$APP_DIR/.env.local"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "node is not installed (see deploy/agentbox.md step 1)"
command -v pm2 >/dev/null || die "pm2 is not installed: npm i -g pm2"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "node 20.9+ required, found $(node -v)"

# ---------------------------------------------------------------- code
if [ -n "${REPO_URL:-}" ]; then
  if [ -d "$APP_DIR/.git" ]; then
    say "git pull $BRANCH in $APP_DIR"
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR" checkout --quiet "$BRANCH"
    git -C "$APP_DIR" pull --ff-only --quiet origin "$BRANCH"
  else
    say "git clone $REPO_URL into $APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
else
  [ -f "$APP_DIR/package.json" ] || die "$APP_DIR/package.json not found. rsync the web/ folder here first (deploy/agentbox.md step 2) or set REPO_URL."
  say "using the code already in $APP_DIR (rsync mode)"
fi
cd "$APP_DIR"

# ---------------------------------------------------------------- env
[ -f "$ENV_FILE" ] || die ".env.local is missing. scp it from the PC (deploy/agentbox.md step 3)."
for key in CFBD_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  grep -q "^$key=." "$ENV_FILE" || printf 'deploy: warning, %s is not set in .env.local\n' "$key" >&2
done
if grep -q '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
  sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$PUBLIC_BASE_URL#" "$ENV_FILE"
else
  printf '\nPUBLIC_BASE_URL=%s\n' "$PUBLIC_BASE_URL" >> "$ENV_FILE"
fi
say "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"

# ---------------------------------------------------------------- data dirs (create, never delete)
for d in data/archive data/odds data/ai data/snapshots data/sheets data/generated data/cache; do
  mkdir -p "$APP_DIR/$d"
done

# ---------------------------------------------------------------- deps
say "npm ci"
npm ci --no-audit --no-fund

# ---------------------------------------------------------------- ingest (CFBD, sequential, rate-limited; minutes)
if [ "${SKIP_INGEST:-0}" = "1" ]; then
  say "SKIP_INGEST=1, keeping the existing data/generated"
  [ -f data/generated/meta.json ] || die "SKIP_INGEST=1 but data/generated/meta.json does not exist. Run without SKIP_INGEST once."
else
  say "npm run ingest (rosters, stats, drafts)"
  npm run ingest
  say "npm run ingest:plays (play-by-play situations)"
  npm run ingest:plays || printf 'deploy: ingest:plays failed, the site works without situations; continuing\n' >&2
fi

# ---------------------------------------------------------------- build
# npx next build, not npm run build: the prebuild hook would run ingest a second time.
say "next build"
npx next build

# ---------------------------------------------------------------- pm2
# start_or_restart: restart if the name exists, else start with the given args.
pm2_up() {
  local name="$1"; shift
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 restart "$name" --update-env >/dev/null
    printf '   restarted %s\n' "$name"
  else
    pm2 start "$@" --name "$name" --time >/dev/null
    printf '   started %s\n' "$name"
  fi
}

say "pm2 processes"
pm2_up scout          node_modules/next/dist/bin/next -- start -p 3000
pm2_up scout-telegram scripts/telegram-bot.mjs
pm2_up scout-odds     scripts/odds-snapshot.mjs --cron "0 */4 * * 3,4,5,6" --no-autorestart
pm2_up scout-prewarm  scripts/prewarm.mjs --cron "*/10 * * * *" --no-autorestart -- --scheduled
pm2_up scout-health   scripts/healthcheck.mjs --cron "*/15 * * * *" --no-autorestart -- --notify
pm2 save >/dev/null

# ---------------------------------------------------------------- smoke
say "waiting for the site"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:3000/"; then break; fi
  sleep 2
  [ "$i" -eq 30 ] && die "site did not answer on :3000 after 60s. pm2 logs scout --err"
done
say "healthcheck"
node scripts/healthcheck.mjs || die "healthcheck failed, see above"

say "prewarm (first pass, so the first phone visit is warm)"
node scripts/prewarm.mjs || true

say "deployed. Site: $PUBLIC_BASE_URL"
printf '\nReminder: only ONE Telegram poller per bot token. If scout-telegram is still running on the Windows PC, stop it there now:\n   pm2 stop scout-telegram\nSame for scout-odds (one credit budget).\n'
pm2 ls
