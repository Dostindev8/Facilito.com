/**
 * Encode Fondofacilito.mp4 into public/media loops.
 * Run from the repo root once ffmpeg is installed and the source file exists.
 * The original file must not be copied into public/.
 *
 *   node scripts/build-hero-video.mjs "C:\\path\\Fondofacilito.mp4"
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Uso: node scripts/build-hero-video.mjs <Fondofacilito.mp4>');
  process.exit(1);
}

const outDir = path.join('apps', 'web', 'public', 'media');
mkdirSync(outDir, { recursive: true });

function run(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const loopFilter = '[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0';

run(['-y', '-ss', '00:00:01', '-i', input, '-frames:v', '1', '-vf', 'scale=1920:-2', path.join(outDir, 'facilito-hero-poster.png')]);
run(['-y', '-i', input, '-an', '-filter_complex', `${loopFilter},scale=1920:-2,fps=30`, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'facilito-hero-1080-loop.mp4')]);
run(['-y', '-i', input, '-an', '-filter_complex', `${loopFilter},scale=1280:-2,fps=30`, '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, 'facilito-hero-720-loop.mp4')]);
run(['-y', '-i', path.join(outDir, 'facilito-hero-1080-loop.mp4'), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', path.join(outDir, 'facilito-hero-1080-loop.webm')]);
