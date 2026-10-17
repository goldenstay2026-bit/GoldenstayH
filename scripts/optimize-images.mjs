// Generates responsive WebP variants (400/800/1600w) for every photo in
// public/images, plus favicon / touch icon / OG image from the logo.
// Also writes src/data/image-meta.json (intrinsic sizes) so <img> tags can
// reserve space and avoid layout shift.
//
// Usage: npm run images
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public', 'images');
const outDir = path.join(dir, 'opt');
const metaFile = path.join(root, 'src', 'data', 'image-meta.json');
const WIDTHS = [400, 800, 1600];

fs.mkdirSync(outDir, { recursive: true });

const meta = {};
// The merchant payment QR is served byte-for-byte as supplied — never re-encode it.
const photos = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f) && !f.startsWith('phonepe-'));

for (const file of photos) {
  const name = file.replace(/\.jpe?g$/i, '');
  const src = path.join(dir, file);
  // .rotate() with no args applies EXIF orientation.
  const base = sharp(src).rotate();
  const { width, height } = await base.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  meta[name] = { w: width, h: height };

  for (const w of WIDTHS) {
    const out = path.join(outDir, `${name}-${w}.webp`);
    await base
      .clone()
      .resize({ width: Math.min(w, width), withoutEnlargement: true })
      .webp({ quality: w <= 400 ? 70 : 74, effort: 5 })
      .toFile(out);
  }
  console.log(`${name.padEnd(28)} ${width}x${height}`);
}

// Logo derivatives
const logo = path.join(dir, 'logo-golden-stay.png');
if (fs.existsSync(logo)) {
  await sharp(logo).resize(96, 96).webp({ quality: 85 }).toFile(path.join(outDir, 'logo-96.webp'));
  await sharp(logo).resize(96, 96).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'logo-96.png'));
  await sharp(logo).resize(32, 32).png().toFile(path.join(root, 'public', 'favicon-32.png'));
  await sharp(logo).resize(180, 180).flatten({ background: '#171717' }).png().toFile(path.join(root, 'public', 'apple-touch-icon.png'));
  await sharp(logo).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(root, 'public', 'icon-512.png'));

  // OG image: 1200x630, logo centred on ink.
  const emblem = await sharp(logo).resize(500, 500).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#171717' } })
    .composite([{ input: emblem, top: 65, left: 350 }])
    .jpeg({ quality: 85 })
    .toFile(path.join(root, 'public', 'og-image.jpg'));
  console.log('logo derivatives written');
}

fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
console.log(`\n${photos.length} photos → ${path.relative(root, outDir)}; meta → ${path.relative(root, metaFile)}`);
