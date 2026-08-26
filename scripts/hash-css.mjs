import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Usage: node scripts/hash-css.mjs <input.css>');
  process.exit(1);
}

const outputDir = 'public/assets';
mkdirSync(outputDir, { recursive: true });

const css = readFileSync(inputPath);
const hash = createHash('sha256').update(css).digest('hex').slice(0, 12);
const fileName = `app-${hash}.css`;

for (const file of readdirSync(outputDir)) {
  if (/^app-[a-f0-9]{12}\.css$/.test(file)) {
    rmSync(join(outputDir, file));
  }
}

writeFileSync(join(outputDir, fileName), css);
writeFileSync(
  join(outputDir, 'manifest.json'),
  `${JSON.stringify({ 'app.css': `/assets/${basename(fileName)}` }, null, 2)}\n`
);
console.log(`Built ${join(outputDir, fileName)}`);
