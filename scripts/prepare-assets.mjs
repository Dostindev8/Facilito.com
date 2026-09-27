// Generates web brand assets from the official logo tile and the landscape background.
// Usage: node scripts/prepare-assets.mjs <logo.jpg> <background.jpg>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('package.json'));
const sharp = require('sharp');

const [logoPath, bgPath] = process.argv.slice(2);
if (!logoPath || !bgPath) {
  console.error('Usage: node scripts/prepare-assets.mjs <logo.jpg> <background.jpg>');
  process.exit(1);
}

const outDir = path.resolve('apps/web/public/brand');
mkdirSync(outDir, { recursive: true });

// Crop the hand + check mark from the 1024x1024 tile and key out the near-white backdrop.
const crop = { left: 330, top: 170, width: 380, height: 420 };
const { data, info } = await sharp(logoPath)
  .extract(crop)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const min = Math.min(r, g, b);
  const sat = Math.max(r, g, b) - min;
  // Backdrop is white/pale mint: very bright and low saturation.
  if (min > 200 && sat < 40) {
    const fade = Math.max(0, Math.min(1, (255 - min) / 55));
    data[i + 3] = Math.round(255 * fade * (sat / 40));
  }
}

const mark = sharp(data, { raw: info }).trim({ threshold: 1 });
await mark.clone().resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, 'facilito-mark.png'));
await sharp(logoPath).resize(512, 512).png().toFile(path.join(outDir, 'facilito-icon.png'));
await sharp(logoPath).resize(64, 64).png().toFile(path.resolve('apps/web/src/app/icon.png'));

await sharp(bgPath).resize(1920, 1080, { fit: 'cover' }).webp({ quality: 72 }).toFile(path.join(outDir, 'hills-bg.webp'));
await sharp(bgPath).resize(960, 540, { fit: 'cover' }).webp({ quality: 65 }).toFile(path.join(outDir, 'hills-bg-sm.webp'));

console.log('Brand assets written to', outDir);
