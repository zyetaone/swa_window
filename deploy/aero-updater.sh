#!/usr/bin/env bash
# =============================================================================
# Zyeta Aero — OTA Updater
#
# Pulls CI-blessed code from git, installs dependencies, rebuilds, restarts
# services, and VERIFIES the app came back — rolling back to the previous
# commit on any failure (install, build, or post-restart health probe).
# Runs as a systemd timer (daily) or on-demand.
#
# Deploy gate: tracks the `release` branch by default, which CI fast-forwards
# ONLY after check + tests + build pass on main (.github/workflows/ci.yml).
# A red commit on main never reaches the fleet.
#
# Usage:
#   sudo bash aero-updater.sh              # Full update
#   sudo bash aero-updater.sh --check      # Check only, no restart
# =============================================================================

set -euo pipefail

# git refuses to run without HOME ("fatal: $HOME not set") and systemd units
# get a near-empty environment. The unit sets this too; kept here so a manual
# `sudo bash aero-updater.sh` and any future caller are equally safe.
export HOME="${HOME:-/root}"

# Source device config FIRST — it supplies AERO_INSTALL_DIR / AERO_PORT /
# AERO_BUN_BIN / AERO_BRANCH, so the layout is discovered, not hardcoded.
# This is what lets ONE updater serve both provisioning schemes.
if [[ -r /etc/aero/config.env ]]; then
    # `set -a` so every key is EXPORTED, not merely set in this shell. The
    # rebuild below is a child process, and Vite inlines VITE_* at compile
    # time — without the export, VITE_TILE_SERVER_URL never reaches it and
    # every on-device rebuild silently dropped the packaged tile cache,
    # sending a kiosk that has 2.7 GB of local tiles back to streaming from
    # the public internet.
    # Exporting the whole file is safe: Vite only inlines VITE_*-prefixed
    # names into the client bundle, so AERO_ADMIN_TOKEN / AERO_FLEET_TOKEN /
    # CESIUM_ION_TOKEN stay out of it (the Ion token is deliberately
    # unprefixed and served at runtime instead).
    set -a
    # shellcheck disable=SC1091
    source /etc/aero/config.env
    set +a
fi

INSTALL_DIR="${AERO_INSTALL_DIR:-/opt/zyeta-aero}"
LOG_FILE="/var/log/aero-updater.log"
BRANCH="${AERO_BRANCH:-release}"
BUN_BIN="${AERO_BUN_BIN:-/home/kiosk/.bun/bin/bun}"
APP_PORT="${AERO_PORT:-${PORT:-5173}}"
PROBE_URL="http://localhost:${APP_PORT}/api/status"

# The repo lives either directly at INSTALL_DIR (deploy/pi scheme) or under
# an /app subdir (provision-pi scheme). Detect by where .git actually is.
if [[ -d "${INSTALL_DIR}/.git" ]]; then
    REPO_DIR="${INSTALL_DIR}"
else
    REPO_DIR="${INSTALL_DIR}/app"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then CHECK_ONLY=true; fi

log "=== Aero Updater starting (branch: ${BRANCH}) ==="

# ─── 1. Check for updates ────────────────────────────────────────────────

if [[ ! -d "${REPO_DIR}/.git" ]]; then
    log "No git repo at ${REPO_DIR} — skipping"
    exit 0
fi

cd "${REPO_DIR}"

if [[ ! -x "${BUN_BIN}" ]]; then
    log "ERROR: Bun runtime not found at ${BUN_BIN}"
    exit 1
fi

# The timer runs this as root but the repo is owned by the kiosk user; modern
# git refuses operations on other-owned repos ("dubious ownership") without
# this. Idempotent — only added once.
git config --global --get-all safe.directory 2>/dev/null | command grep -qxF "${REPO_DIR}" \
    || git config --global --add safe.directory "${REPO_DIR}"

# Explicit refspec: fielded Pis were provisioned with single-branch shallow
# clones whose default fetch refspec only covers their original branch — a
# plain `git fetch origin release` would never materialise the remote ref.
git fetch origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}" --quiet 2>&1 | tee -a "${LOG_FILE}" || {
    log "WARN: git fetch failed (no network, or '${BRANCH}' not published yet?) — skipping update"
    exit 0
}

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/${BRANCH}")

if [[ "${LOCAL}" == "${REMOTE}" ]]; then
    log "Already up to date (${LOCAL:0:8})"
    exit 0
fi

log "Update available: ${LOCAL:0:8} → ${REMOTE:0:8}"

if [[ "${CHECK_ONLY}" == true ]]; then
    log "Check-only mode — not applying"
    exit 0
fi

# ─── Helpers ─────────────────────────────────────────────────────────────

restart_services() {
    systemctl restart aero-app.service 2>/dev/null || true
    systemctl restart aero-kiosk.service 2>/dev/null || true
}

# Probe the app's own status endpoint. curl -f treats server.ts's
# "no build found" 503 as failure, so a half-written build/ can't pass.
# 12 × 5s = up to 60s for Bun + SvelteKit handler to come up.
probe_health() {
    local i
    for ((i = 1; i <= 12; i++)); do
        if curl -fsS --max-time 3 "${PROBE_URL}" >/dev/null 2>&1; then
            return 0
        fi
        sleep 5
    done
    return 1
}

# Full rollback: previous commit + reinstall + rebuild + restart + verify.
# Wired to EVERY failure class (install, build, post-restart probe) — the
# old build-only rollback let a builds-fine-crashes-at-runtime commit ship,
# and a double install failure left HEAD updated with a stale build
# ("already up to date" on the next run while broken).
rollback() {
    log "ERROR: $1 — rolling back to ${LOCAL:0:8}"
    git reset --hard "${LOCAL}" 2>&1 | tee -a "${LOG_FILE}"
    "${BUN_BIN}" install --frozen-lockfile 2>&1 | tee -a "${LOG_FILE}" || true
    "${BUN_BIN}" run build 2>&1 | tee -a "${LOG_FILE}" \
        || log "WARN: rollback build failed — previous build/ still on disk"
    restart_services
    if probe_health; then
        log "Rollback verified — serving ${LOCAL:0:8}"
    else
        log "CRITICAL: health probe failed even after rollback — operator attention needed"
    fi
    exit 1
}

# ─── 2. Pull changes ─────────────────────────────────────────────────────

log "Pulling changes..."
git reset --hard "origin/${BRANCH}" 2>&1 | tee -a "${LOG_FILE}"
log "Updated to $(git rev-parse --short HEAD): $(git log -1 --format='%s')"

# ─── 3. Install dependencies ─────────────────────────────────────────────

log "Installing dependencies..."
"${BUN_BIN}" install --frozen-lockfile 2>&1 | tee -a "${LOG_FILE}" || {
    log "WARN: bun install failed — trying without frozen lockfile"
    "${BUN_BIN}" install 2>&1 | tee -a "${LOG_FILE}" || rollback "bun install failed"
}

# ─── 4. Build ────────────────────────────────────────────────────────────

if [[ -f "package.json" ]] && command grep -q '"build"' package.json; then
    log "Building app..."
    "${BUN_BIN}" run build 2>&1 | tee -a "${LOG_FILE}" || rollback "build failed"
fi

# ─── 4b. Reinstall deploy config when it changed ─────────────────────────
# Until this existed the CD pipeline shipped CODE but not CONFIGURATION: a
# release could change deploy/pi/aero-kiosk.service, land on every Pi, and
# change nothing — because /etc/systemd/system/ is only ever written by
# install.sh. That is exactly how the ANGLE→EGL fix (7.5x framerate) reached
# the fleet and left it running the old flags at 2 fps.
#
# Scoped to --units-only on purpose: units + helper scripts + cron, never apt,
# never the build, never config.env (would clobber hand-set tokens), never the
# cmdline.txt / config.txt rewrites. Runs BEFORE restart_services so the restart
# picks up the new unit definitions rather than needing a second pass.
#
# Non-fatal: a failure here leaves the previous units in place and the new code
# still starts. That is degraded, not broken — and far better than rolling back
# a good build because a cron file could not be written.
INSTALLER="${REPO_DIR}/deploy/pi/install.sh"
if ! git diff --quiet "${LOCAL}" "${REMOTE}" -- deploy/ 2>/dev/null; then
    if [[ -f "${INSTALLER}" ]]; then
        log "deploy/ changed in this release — reinstalling units + cron"
        bash "${INSTALLER}" --units-only 2>&1 | tee -a "${LOG_FILE}" \
            || log "WARN: unit reinstall failed — keeping previous units"
    fi
else
    log "deploy/ unchanged — units left as-is"
fi

# ─── 5. Restart + verify ─────────────────────────────────────────────────

log "Restarting services..."
restart_services

log "Probing ${PROBE_URL} ..."
probe_health || rollback "health probe failed after restart"

log "=== Update complete — serving $(git rev-parse --short HEAD) ==="

# ─── 6. Self-refresh the installed copy ──────────────────────────────────
# provision-pi.sh installs a COPY of this script outside the repo; a git
# pull updates the repo copy but the timer keeps running the stale one.
# After a verified-green update, sync the installed copy.

INSTALLED_COPY="${INSTALL_DIR}/aero-updater.sh"
REPO_COPY="${REPO_DIR}/deploy/aero-updater.sh"
if [[ -f "${REPO_COPY}" && -f "${INSTALLED_COPY}" ]] \
    && ! cmp -s "${REPO_COPY}" "${INSTALLED_COPY}"; then
    install -m 755 "${REPO_COPY}" "${INSTALLED_COPY}"
    log "Self-refreshed installed updater copy from repo"
fi
