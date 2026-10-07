import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Base path. GitHub Pages serves a project site at /<repo>/, so the deploy
 * workflow sets BASE_PATH=/<repo>/. Local dev and preview default to "/".
 */
const base = process.env.BASE_PATH ?? '/';

/** Emit sw.js with the list of built files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'liftlab-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `./${f}`)];
      for (const f of ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) files.push(`./${f}`);
      const hash = createHash('sha256').update(JSON.stringify(Object.keys(bundle).sort())).digest('hex').slice(0, 12);
      const src = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace('__BUILD_HASH__', hash)
        .replace('__APP_FILES__', JSON.stringify(Array.from(new Set(files))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base,
  plugins: [serviceWorker()],
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'] },
});
