import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MODULE_MANIFEST_PATH = path.join(process.cwd(), "src", "module.json");

export function readManifest() {
  const raw = readFileSync(MODULE_MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

export function getPacksFromManifest(manifest) {
  const packs = Array.isArray(manifest.packs) ? manifest.packs : [];
  return packs
    .map((p) => ({
      name: p?.name,
      path: p?.path,
      type: p?.type,
    }))
    .filter((p) => typeof p.name === "string" && typeof p.path === "string" && typeof p.type === "string");
}

export function listFilesRecursive(dirPath) {
  const out = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function isClassicLevelPackDir(dirPath) {
  if (!existsSync(dirPath)) return false;
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return false;
  }
  if (!entries.includes("CURRENT")) return false;
  if (!entries.some((n) => n.startsWith("MANIFEST-"))) return false;
  return true;
}

export function newestMtimeMs(filePaths) {
  let newest = 0;
  for (const p of filePaths) {
    const st = statSync(p);
    newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}
