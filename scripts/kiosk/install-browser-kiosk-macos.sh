#!/bin/bash

set -euo pipefail

readonly label="com.paradiso.print-cess.browser-kiosk"
readonly production_kiosk_url="https://paradiso-print-cess-web.vercel.app/kiosk?printing=auto"
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly source_launcher="${script_dir}/start-browser-kiosk-macos.sh"
readonly install_root="${HOME}/Library/Application Support/Paradiso Print-cess Kiosk"
readonly installed_launcher="${install_root}/bin/start-browser-kiosk-macos.sh"
readonly log_dir="${HOME}/Library/Logs/Paradiso Print-cess Kiosk"
readonly plist_path="${HOME}/Library/LaunchAgents/${label}.plist"
readonly service_domain="gui/$(id -u)"
readonly service_target="${service_domain}/${label}"

usage() {
  printf '%s\n' "Usage: $0 --check|--install|--start|--stop|--reset|--status|--uninstall"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' "This installer supports macOS only." >&2
  exit 69
fi

action="${1:-}"
case "$action" in
  --check)
    exec "$source_launcher" --check
    ;;
  --install)
    "$source_launcher" --check
    /bin/mkdir -p "${install_root}/bin" "$log_dir" "$(dirname "$plist_path")"
    /usr/bin/install -m 755 "$source_launcher" "$installed_launcher"
    /usr/bin/plutil -create xml1 "$plist_path"
    /usr/bin/plutil -insert Label -string "$label" "$plist_path"
    /usr/bin/plutil -insert ProgramArguments -array "$plist_path"
    /usr/bin/plutil -insert ProgramArguments.0 -string "$installed_launcher" "$plist_path"
    /usr/bin/plutil -insert EnvironmentVariables -dictionary "$plist_path"
    /usr/bin/plutil -insert EnvironmentVariables.PRINT_CESS_KIOSK_URL -string "$production_kiosk_url" "$plist_path"
    /usr/bin/plutil -insert RunAtLoad -bool true "$plist_path"
    /usr/bin/plutil -insert KeepAlive -bool true "$plist_path"
    /usr/bin/plutil -insert ProcessType -string Interactive "$plist_path"
    /usr/bin/plutil -insert LimitLoadToSessionType -string Aqua "$plist_path"
    /usr/bin/plutil -insert ThrottleInterval -integer 10 "$plist_path"
    /usr/bin/plutil -insert StandardOutPath -string "${log_dir}/kiosk.log" "$plist_path"
    /usr/bin/plutil -insert StandardErrorPath -string "${log_dir}/kiosk-error.log" "$plist_path"
    /usr/bin/plutil -lint "$plist_path"
    /bin/launchctl bootout "$service_target" >/dev/null 2>&1 || true
    /bin/launchctl enable "$service_target"
    /bin/launchctl bootstrap "$service_domain" "$plist_path"
    /bin/launchctl kickstart -k "$service_target"
    printf '%s\n' "Installed and started ${label}. It will relaunch at login and after a browser exit."
    ;;
  --start)
    if [[ ! -f "$plist_path" ]]; then
      printf '%s\n' "The kiosk is not installed. Run --install first." >&2
      exit 66
    fi
    /bin/launchctl bootout "$service_target" >/dev/null 2>&1 || true
    /bin/launchctl enable "$service_target"
    /bin/launchctl bootstrap "$service_domain" "$plist_path"
    /bin/launchctl kickstart -k "$service_target"
    ;;
  --stop)
    /bin/launchctl disable "$service_target"
    /bin/launchctl bootout "$service_target" >/dev/null 2>&1 || true
    printf '%s\n' "Stopped ${label}. The browser was terminated with it."
    ;;
  --reset)
    if [[ ! -f "$plist_path" ]]; then
      printf '%s\n' "The kiosk is not installed. Run --install first." >&2
      exit 66
    fi
    /bin/launchctl bootout "$service_target" >/dev/null 2>&1 || true
    "$source_launcher" --reset-profile
    /bin/launchctl enable "$service_target"
    /bin/launchctl bootstrap "$service_domain" "$plist_path"
    /bin/launchctl kickstart -k "$service_target"
    printf '%s\n' "Restarted ${label} with an empty browser profile."
    ;;
  --status)
    exec /bin/launchctl print "$service_target"
    ;;
  --uninstall)
    /bin/launchctl disable "$service_target"
    /bin/launchctl bootout "$service_target" >/dev/null 2>&1 || true
    /bin/rm -f "$plist_path" "$installed_launcher"
    "$source_launcher" --reset-profile
    printf '%s\n' "Removed the LaunchAgent, the launcher and the dedicated Chrome profile."
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
