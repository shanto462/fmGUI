#!/bin/zsh
# Runs every check: TypeScript, unit tests, Vite build, Rust build + tests.
# Usage: scripts/verify.sh            (fast checks)
#        FM_INTEGRATION=1 scripts/verify.sh   (also tests against the real fm)
set -e
cd "$(dirname "$0")/.."
export PATH="$(brew --prefix rustup 2>/dev/null)/bin:$PATH"

echo "==> TypeScript"
npx tsc --noEmit
echo "==> Unit tests (vitest)"
npx vitest run
echo "==> Vite build"
npx vite build --logLevel warn
echo "==> Rust build + tests"
(cd src-tauri && cargo build --quiet && cargo test --quiet)
echo "==> All checks passed"
