import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { compilePack } from "@foundryvtt/foundryvtt-cli";

import {
  getPacksFromManifest,
  listFilesRecursive,
  newestMtimeMs,
  readManifest,
} from "./packs-utils.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");

const root = process.cwd();
const stateDir = path.join(root, "packs-src", ".state");
mkdirSync(stateDir, { recursive: true });

const manifest = readManifest();
const packs = getPacksFromManifest(manifest);

function readStamp(packName) {
  const p = path.join(stateDir, `${packName}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function currentPackMtime(packDir) {
  if (!existsSync(packDir)) return 0;
  const files = listFilesRecursive(packDir);
  return files.length ? newestMtimeMs(files) : 0;
}

if (!force) {
  const dirty = [];
  for (const p of packs) {
    const destPackDir = path.join(root, "dist", p.path);
    const current = currentPackMtime(destPackDir);
    if (!current) continue;

    const stamp = readStamp(p.name);
    const stamped = stamp?.distNewestMtimeMs ?? 0;
    if (current > stamped) dirty.push(p.name);
  }

  if (dirty.length) {
    console.error(
      `Refusing to pack; Foundry pack(s) changed since last unpack: ${dirty.join(", ")}. Run pnpm packs:unpack first, or pnpm packs:pack to force.`
    );
    process.exit(1);
  }
}

for (const p of packs) {
  const srcDir = path.join(root, "packs-src", p.name);
  const destPackDir = path.join(root, "dist", p.path);

  if (!existsSync(srcDir)) {
    console.warn(`Skipping ${p.name}; missing ${path.relative(root, srcDir)}`);
    continue;
  }

  rmSync(destPackDir, { recursive: true, force: true });
  mkdirSync(path.dirname(destPackDir), { recursive: true });

  await compilePack(srcDir, destPackDir, {
    log: true,
    recursive: true,
  });

  // Refresh stamp after packing.
  const files = listFilesRecursive(destPackDir);
  const stamp = {
    pack: p.name,
    distPath: p.path,
    distNewestMtimeMs: files.length ? newestMtimeMs(files) : 0,
    updatedAt: Date.now(),
  };
  writeFileSync(path.join(stateDir, `${p.name}.json`), JSON.stringify(stamp, null, 2));
}
