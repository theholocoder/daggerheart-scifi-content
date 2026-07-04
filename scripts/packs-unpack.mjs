import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { extractPack } from "@foundryvtt/foundryvtt-cli";

import {
  getPacksFromManifest,
  isClassicLevelPackDir,
  listFilesRecursive,
  newestMtimeMs,
  readManifest,
} from "./packs-utils.mjs";

const root = process.cwd();
const stateDir = path.join(root, "packs-src", ".state");
mkdirSync(stateDir, { recursive: true });

const manifest = readManifest();
const packs = getPacksFromManifest(manifest);

function safeName(s) {
  if (!s) return "";
  // Match fvtt-cli getSafeFilename behavior for stability.
  return String(s).replace(/[^a-zA-Z0-9А-я]/g, "_");
}

for (const p of packs) {
  const distPackDir = path.join(root, "dist", p.path);
  if (!isClassicLevelPackDir(distPackDir)) {
    throw new Error(
      `[packs:unpack] Missing or invalid LevelDB pack at ${distPackDir}. If you are on a fresh clone, run pnpm packs:pack first.`
    );
  }

  const srcPackDir = distPackDir;
  const destDir = path.join(root, "packs-src", p.name);

  const tmpDir = path.join(root, ".tmp", "packs", p.name);

  const seenPaths = new Set();
  const seenFolderNamesByParent = new Map();

  console.log(`[packs:unpack] ${p.name} (${p.path}) -> ${path.relative(root, destDir)}`);

  mkdirSync(destDir, { recursive: true });

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(path.dirname(tmpDir), { recursive: true });
  cpSync(srcPackDir, tmpDir, { recursive: true });
  // If Foundry is running, the source pack may be locked. Remove the lock in the copy.
  rmSync(path.join(tmpDir, "LOCK"), { force: true });

  try {
    await extractPack(tmpDir, destDir, {
      log: true,
      clean: true,
      folders: true,
      omitVolatile: true,
      jsonOptions: { space: 2 },
      transformFolderName: async (doc) => {
        const parent = doc?.folder ?? "__root__";
        const name = safeName(doc?.name);
        if (!name) {
          throw new Error(
            `[packs:unpack] Folder has no name; cannot create stable path without id. Folder id=${doc?._id ?? "(unknown)"}`
          );
        }

        let set = seenFolderNamesByParent.get(parent);
        if (!set) {
          set = new Set();
          seenFolderNamesByParent.set(parent, set);
        }

        if (set.has(name)) {
          throw new Error(
            `[packs:unpack] Folder name collision under same parent: '${name}'. Rename one folder in Foundry to make names unique.`
          );
        }
        set.add(name);
        return name;
      },
      transformName: async (doc, context) => {
        // Let fvtt-cli handle folder metadata filenames (_Folder.json).
        if (typeof doc?._key === "string" && doc._key.startsWith("!folders")) return;

        const folder = context?.folder ? String(context.folder) : "";
        const name = safeName(doc?.name);
        if (!name) {
          throw new Error(
            `[packs:unpack] Document has no name; cannot create stable filename without id. key=${doc?._key ?? "(unknown)"} id=${doc?._id ?? "(unknown)"}`
          );
        }

        const rel = path.join(folder, `${name}.json`);
        if (seenPaths.has(rel)) {
          throw new Error(
            `[packs:unpack] Document filename collision: '${rel}'. Rename one of the colliding entries in Foundry to make names unique.`
          );
        }
        seenPaths.add(rel);
        return rel;
      },
    });
  } catch (err) {
    console.error(`[packs:unpack] Failed for ${p.name} from ${srcPackDir}`);
    throw err;
  }

  rmSync(tmpDir, { recursive: true, force: true });

  // Update local stamp for safe packing.
  const files = listFilesRecursive(distPackDir);
  const stamp = {
    pack: p.name,
    distPath: p.path,
    distNewestMtimeMs: files.length ? newestMtimeMs(files) : 0,
    updatedAt: Date.now(),
  };
  writeFileSync(path.join(stateDir, `${p.name}.json`), JSON.stringify(stamp, null, 2));
}
