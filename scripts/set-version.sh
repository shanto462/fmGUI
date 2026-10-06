#!/usr/bin/env bash
# Sets the app version in every place that has one:
# package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
#
#   scripts/set-version.sh 0.2.0      (or: npm run version:set 0.2.0)
#
# Use it for a new minor or major version. Patch releases are counted up by the
# release workflow on its own (see scripts/next-version.mjs).
set -euo pipefail
version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/set-version.sh X.Y.Z (for example 0.2.0)" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
# First "version" key only, so the file keeps its formatting.
perl -0pi -e 's/"version":\s*"[^"]+"/"version": "'"$version"'"/' src-tauri/tauri.conf.json
# The version line of the [package] table.
perl -0pi -e 's/(\[package\][^\[]*?\nversion = ")[^"]+(")/${1}'"$version"'${2}/' src-tauri/Cargo.toml

echo "Version set to $version in package.json, tauri.conf.json and Cargo.toml."
