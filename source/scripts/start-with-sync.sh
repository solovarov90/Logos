#!/bin/bash
# Remove set -e to prevent crash on git failure
# set -e 

# Configure git
# Default values if env vars are missing
GIT_EMAIL=${GIT_USER_EMAIL:-"bot@technomage.ai"}
GIT_NAME=${GIT_USER_NAME:-"Eidos Bot"}
REPO_URL=${NOTES_REPO_URL:-""}
REPO_DIR="/app/data/MarketingVault"

echo "INFO: Initializing OpenClaw with Sync..."
echo "INFO: REPO_URL is set to: ${REPO_URL:0:15}..."

if [ -z "$REPO_URL" ]; then
  echo "WARN: NOTES_REPO_URL is not set. Sync will be disabled."
else
  # Configure identity
  git config --global user.email "$GIT_EMAIL"
  git config --global user.name "$GIT_NAME"
  git config --global credential.helper store

  # Configure auth token
  if [ -n "$GH_TOKEN" ]; then
    echo "INFO: Configuring GH_TOKEN usage..."
    git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
  else
    echo "WARN: GH_TOKEN is missing. Private repos will fail."
  fi

  # Clone or pull
  mkdir -p /app/data

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "INFO: Cloning MarketingVault repo to $REPO_DIR..."
    git clone "$REPO_URL" "$REPO_DIR" || echo "ERROR: Git clone failed! Continuing without notes."
  else
    echo "INFO: Repo exists, attempting pull..."
    cd "$REPO_DIR" || echo "ERROR: Cannot access dir"
    git remote set-url origin "$REPO_URL"
    git pull || echo "ERROR: Git pull failed! Continuing."
    cd /app
  fi
fi

# Post-processing: Identity & Script setup
if [ -d "$REPO_DIR" ]; then
  # Copy AGENTS.md to the vault so the agent uses it
  if [ -f "/app/workspace/AGENTS.md" ]; then
    echo "INFO: Copying AGENTS.md to $REPO_DIR..."
    cp "/app/workspace/AGENTS.md" "$REPO_DIR/AGENTS.md"
  fi

  # Auto-configure Identity if missing to skip onboarding
  if [ ! -f "$REPO_DIR/IDENTITY.md" ]; then
    echo "INFO: Creating IDENTITY.md (Marketing Expert)..."
    echo -e "# Marketing AI 🧠\n\nI am the **Marketing Expert**.\nI help create AI texts that sound alive and follow the optimal marketing structures." > "$REPO_DIR/IDENTITY.md"
  fi
  if [ ! -f "$REPO_DIR/USER.md" ]; then
    echo "INFO: Creating USER.md (Creator)..."
    echo -e "# Petr Solovarov 🧙‍♂️\n\nUser: Petr Solovarov\nRole: Creator, Expert Marketer" > "$REPO_DIR/USER.md"
  fi
fi

# Background sync loop (non-blocking)
(
  echo "INFO: Starting background sync loop..."
  while true; do
    sleep 60
    if [ -d "$REPO_DIR/.git" ]; then
      echo "INFO: Background Syncing..."
      cd "$REPO_DIR" || continue
      git pull --no-edit || echo "WARN: Background pull failed"
      if [[ -n $(git status --porcelain) ]]; then
        echo "INFO: Pushing changes..."
        git add .
        git commit -m "Auto-sync: Update from Bot"
        git push || echo "ERROR: Push failed"
      fi
      cd /app
    fi
  done
) &

# Start the OpenClaw bot
echo "INFO: === STARTING OPENCLAW GATEWAY ==="
PORT=${PORT:-18789}
export HOST=0.0.0.0
export OPENCLAW_STATE_DIR="/app/data/state"
mkdir -p "$OPENCLAW_STATE_DIR"

# Patch config.json5 to force settings
node -e "
const fs = require('fs');
const p = '$OPENCLAW_STATE_DIR/config.json5';
let cfg = {};
if (fs.existsSync(p)) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    cfg = JSON.parse(raw.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''));
  } catch (e) { cfg = {}; }
}
const merge = (obj, patch) => {
  for (const key in patch) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      if (!obj[key]) obj[key] = {};
      merge(obj[key], patch[key]);
    } else { obj[key] = patch[key]; }
  }
};
merge(cfg, {
  gateway: { controlUi: { dangerouslyDisableDeviceAuth: true } },
  plugins: { entries: { telegram: { enabled: true } } },
  channels: { telegram: { dmPolicy: 'open', allowFrom: ['*'] } },
  agents: {
    list: [{
      workspace: '/app/data/MarketingVault',
      model: 'google/gemini-1.5-flash',
      identity: { name: 'Marketing Expert', emoji: '🧠' }
    }],
    defaults: { model: { primary: 'google/gemini-1.5-flash' } }
  },
  tools: {
    media: { audio: { enabled: true, scope: { default: 'allow' } } }
  }
});
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
"

# Launch Gateway
exec node --max-old-space-size=768 openclaw.mjs gateway --allow-unconfigured --port "$PORT" --bind lan
