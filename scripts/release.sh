#!/bin/zsh
# Builds a release of fmGUI: runs every check (scripts/verify.sh), builds the
# app with `npm run app:build`, and prints where the .app and .dmg are.
#
# Usage:
#   scripts/release.sh
#   FM_INTEGRATION=1 scripts/release.sh   also run the tests against the real fm first
set -euo pipefail
cd "${0:A:h}/.."

scripts/verify.sh

# Same cargo lookup as verify.sh (it ran in its own process).
if command -v brew >/dev/null 2>&1; then
  rustup_bin="$(brew --prefix rustup 2>/dev/null)/bin"
  if [[ -x "$rustup_bin/cargo" ]]; then
    export PATH="$rustup_bin:$PATH"
  fi
fi
if ! command -v cargo >/dev/null 2>&1 && [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

version="$(node -p 'require("./package.json").version')"
print -r -- "==> Building fmGUI $version (npm run app:build)"
npm run app:build

bundle="src-tauri/target/release/bundle"
app="$bundle/macos/fmGUI.app"
dmgs=("$bundle"/dmg/*.dmg(N))

if [[ ! -d "$app" ]]; then
  echo "The build finished, but $app was not found." >&2
  exit 1
fi

print
print -r -- "==> Release build of fmGUI $version is ready"
print -r -- "App: $PWD/$app"
if (( ${#dmgs} )); then
  for dmg in "${dmgs[@]}"; do
    print -r -- "DMG: $PWD/$dmg"
    print -r -- "     SHA-256 $(shasum -a 256 "$dmg" | cut -d' ' -f1)"
  done
else
  print -r -- "DMG: none found in $bundle/dmg"
fi
print
print -r -- "The app is not notarized. People who download it must allow it once (see README, Install)."
