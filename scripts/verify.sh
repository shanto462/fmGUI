#!/bin/zsh
# Runs the same checks as CI (.github/workflows/ci.yml): TypeScript, ESLint,
# Prettier, Vitest, Vite build, rustfmt, Clippy and the Rust tests.
#
# Usage:
#   scripts/verify.sh                     every CI check
#   FM_INTEGRATION=1 scripts/verify.sh    also the tests against the real fm
#                                         (needs macOS 27, the model and the license)
set -euo pipefail
cd "${0:A:h}/.."

# Homebrew's rustup is keg-only, so its cargo is not on PATH by default.
if command -v brew >/dev/null 2>&1; then
  rustup_bin="$(brew --prefix rustup 2>/dev/null)/bin"
  if [[ -x "$rustup_bin/cargo" ]]; then
    export PATH="$rustup_bin:$PATH"
  fi
fi
if ! command -v cargo >/dev/null 2>&1 && [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo was not found. Install Rust with rustup (https://rustup.rs) and try again." >&2
  exit 1
fi
if [[ ! -d node_modules ]]; then
  echo "node_modules is missing. Run npm install first." >&2
  exit 1
fi

step() { print -r -- "==> $1"; }

step "TypeScript"
npm run --silent typecheck

step "ESLint"
npx eslint .

step "Prettier"
npx prettier --check . --log-level warn

step "Unit tests (Vitest)"
npm test --silent

step "Vite build"
npx vite build --logLevel warn

cd src-tauri

step "rustfmt"
cargo fmt --check

step "Clippy"
cargo clippy --quiet --all-targets -- -D warnings

if [[ "${FM_INTEGRATION:-}" == "1" ]]; then
  step "Rust tests, with the integration tests against the real fm"
else
  step "Rust tests (set FM_INTEGRATION=1 to also test against the real fm)"
fi
cargo test --quiet

step "All checks passed in ${SECONDS}s"
