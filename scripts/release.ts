#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { $ } from "bun";

const MAJOR = 0;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
  },
  allowPositionals: false,
});

const dryRun = values["dry-run"] === true;
const force = values.force === true;

await $`git fetch --tags --quiet origin`.quiet().nothrow();

const branch = (await $`git symbolic-ref --short HEAD`.quiet().nothrow()).stdout.toString().trim();
if (branch !== "main" && !force) {
  console.error(`Refusing to release from branch "${branch}". Pass --force to override.`);
  process.exit(1);
}

const status = (await $`git status --porcelain`.quiet()).stdout.toString().trim();
if (status && !force) {
  console.error("Working tree has uncommitted changes. Commit/stash first or pass --force.");
  process.exit(1);
}

const yyww = isoWeekStamp();
const build = await nextBuild(yyww);
const tag = `v${MAJOR}.${yyww}.${build}`;
const sha = (await $`git rev-parse --short HEAD`.quiet()).stdout.toString().trim();

console.log("Release plan:");
console.log(`  tag    : ${tag}`);
console.log(`  commit : ${sha}`);
console.log(`  branch : ${branch}`);

if (dryRun) {
  console.log("(dry-run; no actions taken)");
  process.exit(0);
}

await $`git tag ${tag} HEAD`;
await $`git push origin ${tag}`;
console.log(`Pushed tag ${tag}.`);

function isoWeekStamp(date: Date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = target.getTime();
  const isoYear = target.getUTCFullYear();
  target.setUTCMonth(0, 4);
  const jan4DayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - jan4DayNum);
  const week = 1 + Math.round((firstThursday - target.getTime()) / 604800000);
  return `${String(isoYear % 100).padStart(2, "0")}${String(week).padStart(2, "0")}`;
}

async function nextBuild(prefix: string): Promise<number> {
  const out = (await $`git tag --list ${`v${MAJOR}.${prefix}.*`} --sort=-v:refname`.quiet()).stdout.toString();
  const first = out.split("\n").find(Boolean);
  if (!first) return 1;
  const match = first.match(/\.(\d+)$/);
  if (!match) return 1;
  return Number(match[1]) + 1;
}
