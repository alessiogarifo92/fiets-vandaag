import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { serviceWorker } from './tools/sw-plugin.ts';

export function appVersion(): string {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  let sha = process.env.GITHUB_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      sha = 'dev';
    }
  }
  return `${version}+${sha.trim().slice(0, 7)}`;
}

export default defineConfig({
  plugins: [svelte(), cloudflare(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
});
