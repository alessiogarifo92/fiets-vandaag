// Builds src/app/sw.ts into /sw.js for the client bundle and injects the list of built files, so the
// service worker can precache the app shell. The list's hash versions the cache: any change to a built
// or public file gives the next deploy a new cache, and the old one is dropped on activation.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

const PLACEHOLDER = /(["'`])__FIETS_PRECACHE__\1/;

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relative(dir, join(d.parentPath, d.name)).split('\\').join('/'));
  } catch {
    return [];
  }
}

export function serviceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'fiets-service-worker',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: resolve('src/app/sw.ts'), fileName: 'sw.js' });
    },
    generateBundle(_options, bundle) {
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') this.error('sw.js was not built');
      const hash = createHash('sha256');
      const publicFiles = listFiles(publicDir);
      for (const f of publicFiles) hash.update(f).update(readFileSync(join(publicDir, f)));
      const built = Object.values(bundle).filter((f) => f.fileName !== 'sw.js');
      for (const f of built) hash.update(f.fileName).update(f.type === 'chunk' ? f.code : f.source);
      const files = [...publicFiles, ...built.map((f) => f.fileName)].sort();
      const json = JSON.stringify({ version: hash.digest('hex').slice(0, 12), files });
      if (!PLACEHOLDER.test(sw.code)) this.error('precache placeholder missing from sw.js');
      sw.code = sw.code.replace(PLACEHOLDER, () => JSON.stringify(json));
    },
  };
}
