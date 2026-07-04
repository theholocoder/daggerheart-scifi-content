import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  getPacksFromManifest,
  isClassicLevelPackDir,
  listFilesRecursive,
  newestMtimeMs,
  readManifest,
} from "./packs-utils.mjs";

const root = process.cwd();
const stateDir = path.join(root, "packs-src", ".state");

function readStamp(packName) {
  const p = path.join(stateDir, `${packName}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const manifest = readManifest();
const packs = getPacksFromManifest(manifest);

const dirty = [];
const missing = [];

for (const p of packs) {
  const packDir = path.join(root, "dist", p.path);
  if (!isClassicLevelPackDir(packDir)) {
    missing.push(p.name);
    continue;
  }

  const files = listFilesRecursive(packDir);
  const current = files.length ? newestMtimeMs(files) : 0;
  const stamp = readStamp(p.name);
  const stamped = stamp?.distNewestMtimeMs ?? 0;
  if (current > stamped) dirty.push(p.name);
}

if (missing.length) {
  console.log(`[packs:status] missing: ${missing.join(", ")}`);
}
if (dirty.length) {
  console.log(`[packs:status] changed since last unpack: ${dirty.join(", ")}`);
} else {
  console.log("[packs:status] clean");
}
