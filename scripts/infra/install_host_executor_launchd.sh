#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="${GEMINI_PROXY_LAUNCHD_LABEL:-com.three-lans.gemini-host-proxy}"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
EXECUTOR_SCRIPT="$PROJECT_ROOT/scripts/infra/gemini-host-proxy.js"
LOG_DIR="$PROJECT_ROOT/logs/launchd"
STDOUT_PATH="$LOG_DIR/gemini-host-proxy.stdout.log"
STDERR_PATH="$LOG_DIR/gemini-host-proxy.stderr.log"
GEMINI_PROXY_PORT="${GEMINI_PROXY_PORT:-13210}"
GEMINI_MAX_EXECUTION_BUDGET_MS="${GEMINI_MAX_EXECUTION_BUDGET_MS:-240000}"
GEMINI_PROXY_FORCE_KILL_MS="${GEMINI_PROXY_FORCE_KILL_MS:-1000}"
GEMINI_PROXY_MODEL="${GEMINI_PROXY_MODEL:-gemini-3-flash-preview}"

if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN="/opt/homebrew/bin/node"
fi
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then
  NODE_BIN="/usr/local/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  echo "未找到 node，可通过 NODE_BIN 指定" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

write_plist() {
  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${EXECUTOR_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${STDOUT_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH}</string>
    <key>GEMINI_PROXY_PORT</key>
    <string>${GEMINI_PROXY_PORT}</string>
    <key>GEMINI_MAX_EXECUTION_BUDGET_MS</key>
    <string>${GEMINI_MAX_EXECUTION_BUDGET_MS}</string>
    <key>GEMINI_PROXY_FORCE_KILL_MS</key>
    <string>${GEMINI_PROXY_FORCE_KILL_MS}</string>
    <key>GEMINI_PROXY_MODEL</key>
    <string>${GEMINI_PROXY_MODEL}</string>
PLIST
  if [ -n "${GEMINI_PROXY_HOME:-}" ]; then
    cat >> "$PLIST_PATH" <<PLIST
    <key>GEMINI_PROXY_HOME</key>
    <string>${GEMINI_PROXY_HOME}</string>
PLIST
  fi
  if [ -n "${GEMINI_SETTINGS_PATH:-}" ]; then
    cat >> "$PLIST_PATH" <<PLIST
    <key>GEMINI_SETTINGS_PATH</key>
    <string>${GEMINI_SETTINGS_PATH}</string>
PLIST
  fi
  cat >> "$PLIST_PATH" <<'PLIST'
  </dict>
</dict>
</plist>
PLIST
}

bootout_if_loaded() {
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
}

status_cmd() {
  echo "label: $LABEL"
  echo "plist: $PLIST_PATH"
  if [ -f "$PLIST_PATH" ]; then
    echo "plist_exists: yes"
  else
    echo "plist_exists: no"
  fi
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "launchd: loaded"
  else
    echo "launchd: not-loaded"
  fi
  if curl -fsS "http://127.0.0.1:${GEMINI_PROXY_PORT}/health" >/dev/null 2>&1; then
    echo "health: ok"
  else
    echo "health: down"
  fi
}

case "${1:-install}" in
  install)
    write_plist
    bootout_if_loaded
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    launchctl enable "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "已安装并启动: $LABEL"
    status_cmd
    ;;
  restart)
    write_plist
    bootout_if_loaded
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "已重启: $LABEL"
    status_cmd
    ;;
  uninstall)
    bootout_if_loaded
    rm -f "$PLIST_PATH"
    echo "已卸载: $LABEL"
    ;;
  status)
    status_cmd
    ;;
  print)
    write_plist
    cat "$PLIST_PATH"
    ;;
  *)
    echo "用法: $0 {install|restart|uninstall|status|print}" >&2
    exit 1
    ;;
esac
