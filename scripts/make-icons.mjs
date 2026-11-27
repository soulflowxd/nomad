// Renders assets/icon.svg to the PNG sizes Chrome uses. Run: bun run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const outDir = new URL('../public/icon/', import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`${size}.png`, outDir), png);
  console.log(`icon/${size}.png`);
}
