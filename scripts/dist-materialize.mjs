import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");

mkdirSync(distDir, { recursive: true });

function materializeDir(name) {
  const src = path.join(root, name);
  const dest = path.join(distDir, name);

  if (!existsSync(src)) return;

  if (existsSync(dest)) {
    const st = lstatSync(dest);
    if (st.isSymbolicLink()) {
      rmSync(dest, { force: true });
    }
  }

  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

materializeDir("artwork");
materializeDir("lang");
