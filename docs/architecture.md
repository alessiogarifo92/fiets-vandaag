# Architecture (DRAFT, phase 3, not yet confirmed by the user)

Proposed by the `architect` agent on 2026-10-15 and revised for the zero-billing rule and the budget of at most 3 cron triggers (see `docs/decisions.md`).

## 1. Layout
A single Vite project with `@cloudflare/vite-plugin` builds both the SPA and the Worker.

- **`src/core/`**: pure TypeScript.
  - `geo.ts`: bearing, rounding to a ~1 km cell, midpoint.
  - `wind.ts`: head-, cross- and tailwind components.
  - `rain.ts`: rain aggregated over the commute window.
  - `score.ts`: a 1-10 score, a `bike|pt|shift` verdict and reason codes.
  - `schedule.ts`: computes the next run time with `Intl`, aware of DST.
  - `validate.ts`: request shapes shared by app and Worker.
  - `i18n/{en,nl,it}.ts`.
- **`src/app/`**: Svelte 5 screens and `sw.ts`.
- **`src/worker/`**: `index.ts` (fetch and scheduled handlers), `api/`, `cron/{drain,weather,push,cleanup}.ts`, `db.ts`, `auth.ts`, `errors.ts`.
- **`migrations/`**.

Each folder has its own tsconfig `lib` setting, which keeps `core` free of DOM and Workers types. Core returns reason codes, and both app and push localize them from the same catalog.

## 2. Identity without login
- **Registration:** `POST /api/devices` returns `{deviceId, secret}`. Only `sha256(secret)` is stored. Requests carry `Authorization: Bearer id.secret`, checked with `timingSafeEqual`. The client keeps both values in IndexedDB.
- **Push errors:**
  - A 404/410 from the push service deletes the device.
  - A 429/5xx is retried once, then skipped.
  - Any other 4xx counts as a failure; after 3 failures the device is deleted.
- **Endpoint refresh:** on app open, the client re-sends the push endpoint if it has changed.
- **Abuse protection:**
  - Push endpoints must be on an allowlist (fcm, mozilla, apple, windows).
  - Request bodies are limited to 2 KB.
  - A welcome push is sent synchronously; if the push service rejects it, the API answers 422.
  - A Rate Limiting binding allows 5 requests per IP per 60 s. Its availability on the Free plan is unverified.
  - A global `MAX_DEVICES` cap answers 503 when reached.

## 3. D1 schema
- **`devices`**: `id`, `secret_hash`, `lang`, `tz`, `push_endpoint` (UNIQUE), `p256dh`, `auth`, `push_failures`, `created_at`, `last_seen_at`, `last_push_ok_at`.
- **`routes`**:
  - Keys: `id`, `device_id`, `slot` (1 or 2), UNIQUE(`device_id`, `slot`).
  - Location: start and end coordinates as integers ×100 (~1 km); `cell`; `bearing_deg`.
  - Timing: `window_start_min` / `window_end_min` (at most 180 min); a `weekdays` bitmask; `notify_min` (04:00-12:00 in 5-minute steps, or NULL); `next_run_at`; `lease_until`; `updated_at`.
  - Partial index on `next_run_at`.
- **`deliveries`**: primary key (`route_id`, `local_date`). Status is one of `claimed`, `sent`, `skipped_late`, `failed`. This table is the idempotency key.
- **`weather_cache`**: `cell` (PK), `fetched_at`, `payload`.
- **`meta`**: key/value pairs, holding `effective_batch` and `last_cleanup_at`.

**Data minimization:**
- The client computes the bearing from the exact points, then sends coordinates rounded to ~1 km.
- Address text stays on the device. IP addresses are not stored.

**Retention:**
- Deleting from Settings removes everything at once.
- Devices inactive for 60 days are deleted.
- Deliveries are kept for 14 days, cached weather for 48 h.
- D1 Time Travel keeps deleted data for 7 days. The privacy page must say so.

## 4. Cron: one trigger, `* * * * *`
The account will then use 3 of its 5 Free triggers.

Each run is **either** a drain **or** an idle run, never both.

**Drain:**
1. Claim up to `effective_batch` due routes in one `batch()` (UPDATE with a lease, then RETURNING).
2. `INSERT deliveries ... ON CONFLICT DO NOTHING RETURNING`, so each route gets at most one push.
3. Read the weather cache. Cells older than 50 minutes are fetched in **one** multi-location Open-Meteo request.
4. Compute, encrypt and send N pushes (`tag` = route-date).
5. One `batch()` stores `next_run_at` and the status, and removes devices that returned 410.

Budget per run: at most 1 + N external subrequests and about 5 D1 calls.

**Idle:** prefetch weather for cells due within 60 minutes, or run a bounded cleanup (`LIMIT 50` per table, at most once an hour).

**Overload degrades, with no billing:**
- **Admission control:**
  - Each 5-minute notify step holds at most `SLOT_CAP = BATCH_SIZE × 5` routes. That is about 20 per step if one push costs about 1 ms of CPU.
  - A full step returns 409 `slot_full` with the nearest free times.
  - `MAX_DEVICES` caps the total number of users.
- **Lateness cutoff:** a route more than 15 minutes late, or past the start of its commute window, gets `skipped_late` and no push. The user can still open the app.
- **Adaptive batch:** a delivery row still `claimed` after 5 minutes means the run was killed, most likely for exceeding CPU. The next run halves `effective_batch`, down to 1. A day with no kills raises it by 1.

**Open-Meteo down:** retry at +5 minutes, up to 3 times. Then use cached weather up to 6 h old, labelled with its time. Otherwise send a "no weather data" push.

**KNMI fallback dropped from v1:** HARMONIE data comes only as GRIB/HDF5 files, which cannot be parsed in a Free Worker.

## 5. API (same origin, `/api/*`)
- `POST /api/devices`
- `GET|PATCH|DELETE /api/devices/me`
- `PUT|DELETE /api/routes/:slot`
- `GET /api/health`

The VAPID public key is fixed at build time. Validation is hand-written in `core/validate.ts`. Errors use the shape `{error:{code,message,fields?}}`.

**Weather in the app:** the PWA calls Open-Meteo directly, which works because Open-Meteo allows CORS. The quota is then spread across each user's own IP. The push payload carries the computed result, and the service worker stores it so the app shows exactly what was pushed.

## 6. PWA
- `/sw.js` has scope `/` and is served with `no-cache`.
- Every push calls `showNotification`, because iOS revokes push for silent messages.
- A notification click opens a deep link.
- The app shell is precached, and the last result is kept in IndexedDB.
- **iOS:**
  - Outside standalone mode, the app shows an install guide.
  - The push toggle appears only in standalone mode, and permission is asked only on a tap.
- **i18n:** a typed key catalog with `Intl`. A test checks that every key exists in all languages.
- **Attribution:** "Weather data: Open-Meteo.com (CC BY 4.0)" appears under every recommendation.
- **Library:** use `@block65/webcrypto-web-push` pinned to `^2.0.0`, because 1.x uses `aesgcm` and Apple rejects it.

## 7. Testing
- **Unit tests (core):**
  - Bearing wrap-around, e.g. a 350° route with wind from 10°.
  - The signs of the wind components.
  - The off-by-one in the preceding-hour precipitation value.
  - The score is monotone in headwind.
  - DST changes on 2026-03-29 and 2026-10-25.
  - The weekday mask.
  - The validators.
  - i18n completeness.
- **Integration tests** (`@cloudflare/vitest-plugin`, local D1, mocked fetch):
  - auth;
  - overlapping drains send exactly one push;
  - 410 cleanup and 429 retry;
  - the outage fallback;
  - a full step returns 409;
  - `skipped_late`;
  - adaptive batch;
  - idle cleanup.
- **End-to-end (Playwright):** onboarding, the Today screen, switching language, offline mode.
- **Real devices:** iOS 16.4+ and Android Chrome.

## 8. Rollout (tickets)
0. **Setup:** scaffold, wrangler config (SPA assets with `run_worker_first` for `/api/*`, D1 binding), lint, typecheck, Vitest, GitHub Actions, preview URL, `/api/health`.
1. **Core engine and Today screen:** PDOK search, a route stored only on the device, live Open-Meteo data, EN/NL/IT, attribution. It needs no backend, so it can be used in the validation week.
2. **Installable PWA:** manifest, service worker, offline mode, iOS install guide.
3. **Device and route API:** D1 schema, auth, rate limit, slot capacity with 409 alternatives, delete-my-data, welcome push.
4. **Cron drain:** single trigger, claim, weather cache, push, 410 cleanup, DST-aware next run, `meta` table, `skipped_late`, adaptive batch, a CPU measurement to set `BATCH_SIZE`.
5. **Notification follow-up:** deep link, stored payload, endpoint resync.
6. **Resilience and privacy:** outage fallback, prefetch, idle cleanup, privacy page.

## Open questions for the user
1. Drop KNMI from v1 in favour of retry, then stale cache, then a "no data" push?
2. To measure the kill criterion, store a pseudonymous "opened on date" row per device and keep it for 30 days?
3. Custom domain (about €10 a year) or `workers.dev`? The origin is hard to change later: moving it loses installs, push subscriptions and local data.
4. Accept these Free-plan limits: notify times in 5-minute steps with a cap per step, pushes skipped when more than 15 minutes late, and a global user cap?

## Unverified
- The CPU cost of one push, which sets `BATCH_SIZE` and `SLOT_CAP`.
- Whether the Worker clock stays frozen during pure CPU work.
- Whether D1 writes made before a CPU kill stay committed.
- Whether the `CF-Worker` header on workers.dev is per-subdomain, which matters for the Open-Meteo quota slot.
- Whether PDOK allows CORS.
- Whether the Rate Limiting binding is available on the Free plan.
- Apple's push rate limits.
