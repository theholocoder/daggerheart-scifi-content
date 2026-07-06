import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

const MODULE_ID = "daggerheart-scifi-content";

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function ensureSymlink(linkPath, target) {
  if (!existsSync(linkPath)) {
    symlinkSync(target, linkPath, "dir");
    return;
  }

  const st = lstatSync(linkPath);
  if (!st.isSymbolicLink()) {
    throw new Error(`Expected symlink at ${linkPath}`);
  }

  const current = readlinkSync(linkPath);
  if (current !== target) {
    unlinkSync(linkPath);
    symlinkSync(target, linkPath, "dir");
  }
}

function ensureRealDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    return;
  }

  const st = lstatSync(dirPath);
  if (st.isSymbolicLink()) {
    unlinkSync(dirPath);
    mkdirSync(dirPath, { recursive: true });
    return;
  }
}

const root = process.cwd();

ensureDir(path.join(root, "dist"));
// packs are generated into dist/; never symlink them.
ensureRealDir(path.join(root, "dist", "packs"));
// artwork can be symlinked locally; CI should materialize before zipping.
ensureSymlink(path.join(root, "dist", "artwork"), path.join(root, "artwork"));
ensureSymlink(
  path.join(root, "dist", "date-stellaire.json"),
  path.join(root, "date-stellaire.json"),
);

// For local dev, keep dist/module.json in sync with src/module.json so Foundry sees manifest changes without a rebuild.
try {
  const srcManifest = path.join(root, "src", "module.json");
  const distManifest = path.join(root, "dist", "module.json");
  const srcMtime = statSync(srcManifest).mtimeMs;
  const distMtime = existsSync(distManifest)
    ? statSync(distManifest).mtimeMs
    : 0;
  if (srcMtime > distMtime) copyFileSync(srcManifest, distManifest);
} catch {
  // ignore
}

const publicModuleDir = path.join(root, "public", "modules", MODULE_ID);
ensureDir(publicModuleDir);
ensureSymlink(path.join(publicModuleDir, "packs"), "../../../dist/packs");
ensureSymlink(path.join(publicModuleDir, "artwork"), "../../../artwork");

// Copy language files to dist/ so Foundry can find them.
const srcLangDir = path.join(root, "lang");
const distLangDir = path.join(root, "dist", "lang");
if (existsSync(srcLangDir)) {
  ensureDir(distLangDir);
  for (const file of readdirSync(srcLangDir)) {
    if (file.endsWith(".json")) {
      copyFileSync(path.join(srcLangDir, file), path.join(distLangDir, file));
    }
  }
}

// Symlink lang in public/ to dist/lang so Vite dev server serves it.
ensureSymlink(path.join(publicModuleDir, "lang"), "../../../lang");
