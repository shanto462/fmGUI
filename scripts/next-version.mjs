#!/usr/bin/env node
// Prints the version of the next release.
//
// - The base is the version in package.json. Raise it with
//   `npm run version:set X.Y.Z` when you want a new minor or major version.
// - With no release tag yet, or when the base is newer than the newest tag,
//   the next release is the base itself.
// - Otherwise the patch number of the newest tag goes up by one
//   (v0.1.0 -> 0.1.1 -> 0.1.2 ...).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const parse = (v) => v.split(".").map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const base = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
  .split("\n")
  .map((t) => t.trim().replace(/^v/, ""))
  .filter((t) => /^\d+\.\d+\.\d+$/.test(t))
  .sort(compare);
const latest = tags.at(-1);

let next = base;
if (latest && compare(base, latest) <= 0) {
  const [major, minor, patch] = parse(latest);
  next = `${major}.${minor}.${patch + 1}`;
}
console.log(next);
