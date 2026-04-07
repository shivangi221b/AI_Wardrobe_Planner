import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const srcDir = path.join(root, 'static-pages');
const outDir = path.join(root, 'dist');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  fs.copyFileSync(from, to);
  // eslint-disable-next-line no-console
  console.log(`Copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

ensureDir(outDir);

const files = [
  { from: path.join(srcDir, 'privacy.html'), to: path.join(outDir, 'privacy.html') },
  { from: path.join(srcDir, 'terms.html'), to: path.join(outDir, 'terms.html') },
];

for (const f of files) {
  if (!fs.existsSync(f.from)) {
    throw new Error(`Missing static page: ${f.from}`);
  }
  copyFile(f.from, f.to);
}

