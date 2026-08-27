import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sourceDir = 'src/ui/assets/fonts';
const outputDir = 'public/assets/fonts';
const webFonts = ['source-sans-3-latin-var.woff2'];

mkdirSync(outputDir, { recursive: true });

for (const file of webFonts) {
  copyFileSync(join(sourceDir, file), join(outputDir, file));
}
