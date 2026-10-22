# Fiets Vandaag

Morning "bike or public transport today?" recommendation for cycling commuters in Dutch cities. An installable Svelte 5 PWA plus a Cloudflare Worker on the **Workers Free** plan. Decisions: `docs/decisions.md`; architecture: `docs/architecture.md`; design: `DESIGN.md`.

## Run locally

Node 22+.

```bash
npm ci
cp .dev.vars.example .dev.vars   # local secrets, never committed
npm run dev                      # app + Worker (local D1) on http://localhost:5173, API at /api/health
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the Worker running in workerd (`@cloudflare/vite-plugin`) |
| `npm run build` | Builds the SPA (`dist/client`) and the Worker (`dist/fiets_vandaag`) |
| `npm run preview` | Build, then serve the production build locally |
| `npm run lint` | ESLint + Prettier check (`npm run format` fixes formatting) |
| `npm run typecheck` | `tsc -b` over the per-folder tsconfigs + `svelte-check` |
| `npm test` / `npm run test:coverage` | Vitest: project `core` and `app` (storage, API calls, cache, token contrast) on Node, project `worker` in workerd (`@cloudflare/vitest-plugin`) |
| `npm run test:e2e` | Playwright on the production build (`vite preview` on port 5173), PDOK and Open-Meteo mocked; includes an axe colour-contrast check per screen |
| `npm run cf-typegen` | Regenerates `src/worker/worker-configuration.d.ts` after a `wrangler.jsonc` change |

Layout: `src/core` is pure TypeScript (its tsconfig has no DOM or Workers types), `src/app` is the Svelte PWA, `src/worker` the Worker, `migrations/` the D1 schema.

## Installable PWA

- `public/manifest.webmanifest` (id/scope `/`, standalone) with icons in `public/icons/` (192, 512, maskable 512, `apple-touch-icon` 180).
- `src/app/sw.ts` is built to `/sw.js` by `tools/sw-plugin.ts`, which injects the list of built files: the app shell is precached, page loads are network first with the cached shell offline, built files are cache first. The cache name is a hash of the build, so each deploy replaces it; the page reloads once when a new worker takes over. `/api/*`, PDOK and Open-Meteo are never intercepted.
- `public/_headers` serves `/sw.js` and the manifest with `Cache-Control: no-cache`.
- iOS in the browser starts onboarding with the "Add to Home Screen" steps (`#/install`), because the installed app has its own storage and is the only place web push works. The notification toggle appears only where push works (on iOS: installed, 16.4+) and asks permission only on a tap; the subscription stays on the device until the device API (ticket 4).
- Playwright checks installability through Chrome's `Page.getInstallabilityErrors` (the check Lighthouse's PWA audit used) and offline mode; installing, standalone mode and push delivery need a real Android phone and iPhone.

## Deploy

Origin: `https://fiets-vandaag.alessiogarifo92.workers.dev` (Workers Free, no custom domain).

GitHub Actions (`.github/workflows/ci.yml`):
- every push and PR: lint, typecheck, unit tests with coverage (summary in the job, HTML report as the `coverage` artifact), build, Playwright end-to-end tests (report as the `playwright-report` artifact on failure);
- every PR from this repo: `wrangler versions upload --preview-alias pr-<n>`, so the PR gets `https://pr-<n>-fiets-vandaag.alessiogarifo92.workers.dev` without touching production (the URL is in the job summary);
- push to `main`: D1 migrations, `wrangler deploy`, then a smoke test that `/api/health` reports the new commit.

The preview and deploy jobs need the repository secret `CLOUDFLARE_API_TOKEN` and skip themselves without it. Token permissions (account `02a4c350badad3fae1cee187b3a0f738` only): **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read**. Previews share the production D1 database.

Manual deploy, if CI is unavailable:

```bash
cd /path/to/fiets-vandaag && npm ci && npm run build && npx wrangler d1 migrations apply fiets-vandaag --remote && npx wrangler deploy
```

**Cost rule: Workers Free only, nothing is ever billed.** No Workers Paid, no Queues, R2 or other billable binding. When a Free limit is hit the app degrades (skips or delays pushes), it never upgrades. The account already has 2 cron triggers from other projects; this project may add at most 3 (v1 plans one, in ticket 5).

## Configuration and secrets

Public values live in `wrangler.jsonc` `vars`. Secrets are set once per Worker with `npx wrangler secret put <NAME>` (locally in `.dev.vars`).

| Name | Kind | Purpose |
|---|---|---|
| `VAPID_PUBLIC_KEY` | var (committed) | Public half of the web-push VAPID key pair (P-256, base64url, uncompressed point). Built into the app for `pushManager.subscribe`. |
| `VAPID_SUBJECT` | var (committed) | VAPID `sub` claim: the app's https origin. |
| `VAPID_PRIVATE_KEY` | **secret** | Private half (base64url `d` of the P-256 key). Signs the VAPID JWT for every push. |
| `INVITE_CODE` | **secret** | Code inside the invite link/QR; `POST /api/devices` rejects registrations without it (ticket 4). |
| `MAX_DEVICES` | var (default `50`) | Global device cap; registration answers 503 `capacity` when full. Can be overridden as a secret/var in the dashboard without a code change. |

**Rotating the VAPID key pair invalidates every push subscription.** Every device has to subscribe again (re-enable notifications in the app). Only rotate if the private key leaks. To rotate: generate a new P-256 pair, update `VAPID_PUBLIC_KEY` in `wrangler.jsonc`, `wrangler secret put VAPID_PRIVATE_KEY`, deploy, and tell testers to re-enable notifications.

Generate a pair:

```bash
node -e 'const s=crypto.subtle;s.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]).then(async k=>console.log("public ",Buffer.from(await s.exportKey("raw",k.publicKey)).toString("base64url"),"\nprivate",(await s.exportKey("jwk",k.privateKey)).d))'
```

## Third parties called from the browser

- **PDOK Locatieserver** (`api.pdok.nl`, `suggest` + `lookup`): receives the typed address text.
- **Open-Meteo** (`api.open-meteo.com`, model `knmi_seamless`): receives the route midpoint rounded to a ~1 km cell (`src/core/geo.ts`).

Both answer `Access-Control-Allow-Origin: *` (checked from a GitHub runner on 2026-10-19), so no proxy is needed. The privacy page (`#/privacy`) lists what each one receives.

## Weather data

Weather data: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
