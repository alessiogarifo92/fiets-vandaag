# Architecture (phase 3, confirmed 2026-10-15)

The `architect` agent proposed this design and the `critic` agent red-teamed it. The user confirmed the simplified v1. Constraints come from `docs/decisions.md`: Workers Free only, nothing ever billed, at most 3 cron triggers, Svelte 5 PWA, D1, Open-Meteo, PDOK, EN/NL/IT, no login.

v1 audience: at most ~50 invited commuters in the Netherlands. Every simplification below is sized for that audience; the "Deferred" section lists what returns when the cap is raised.

## 1. Layout
One Vite project with `@cloudflare/vite-plugin` builds both the SPA and the Worker.

- **`src/core/`**: pure TypeScript. A per-folder tsconfig `lib` keeps DOM and Workers types out of it.
  - `geo.ts`: bearing, rounding to a cell of about 1 km, midpoint.
  - `wind.ts`: head-, cross- and tailwind components.
  - `rain.ts`: rain aggregated over the commute window.
  - `score.ts`: 1-10 score, a `bike|pt|shift` verdict and reason codes.
  - `schedule.ts`: the next run time in Europe/Amsterdam, DST-aware.
  - `validate.ts`: hand-written request validators shared by app and Worker.
  - `i18n/{en,nl,it}.ts`: a typed key catalog. Core returns reason codes; the app and the push localize them from the same catalog.
- **`src/app/`**: Svelte 5 screens and `sw.ts`.
- **`src/worker/`**: `index.ts` (fetch and scheduled handlers), `api/`, `cron/{drain,weather,push,cleanup}.ts`, `db.ts`, `auth.ts`, `errors.ts`.
- **`migrations/`**: D1 schema.

## 2. Identity without login
- **Joining:** an **invite code** is required to join. It travels as a secret inside the invite link or QR code and is a Worker secret. A global cap, `MAX_DEVICES` (default 50), answers 503 `capacity` when full.
- **Registration:** `POST /api/devices` returns `{deviceId, secret}`. Only `sha256(secret)` is stored. Calls carry `Authorization: Bearer id.secret`, checked with `timingSafeEqual`. The client keeps both values in IndexedDB.
- **Abuse protection:**
  - Push endpoints must be on a host allowlist: fcm.googleapis.com, *.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com. This also stops the cron from posting to arbitrary URLs.
  - Request bodies are limited to 2 KB.
  - The welcome push is a UX check only, not an abuse barrier.
- **Endpoint refresh:** every time the app opens, the client re-sends the push endpoint if it has changed.
- **Push responses:**
  - 404/410 deletes the device.
  - 429/5xx is retried once inside the same run, then marked failed for the day.
  - After 3 failures of any other 4xx, the device is deleted.

## 3. D1 schema
- **`devices`**: `id`, `secret_hash`, `lang` (en/nl/it), `push_endpoint` (UNIQUE), `p256dh`, `auth`, `push_failures`, `created_at`, `last_seen_at`, `last_push_ok_at`.
- **`routes`**:
  - Keys: `id`, `device_id`, `slot` (1 or 2), UNIQUE(`device_id`, `slot`).
  - Location: `cell` (the route midpoint rounded to about 1 km) and `bearing_deg`. **Start and end points are never sent to the server.**
  - Timing: `window_start_min` and `window_end_min` (at most 180 minutes apart), a `weekdays` bitmask, `notify_min` (04:00-12:00 in 5-minute steps, or NULL), `next_run_at`, `lease_until`, `updated_at`.
  - A partial index on `next_run_at`.
- **`deliveries`**: primary key (`route_id`, `local_date`). `status` is one of `claimed`, `retry`, `sent`, `skipped_late`, `no_data`, `failed`; there is also `attempts` and `http_status`.
- **`weather_cache`**: `cell` (PK), `fetched_at`, `payload`.
- **`opens`**: (`device_id`, `local_date`, `source` of `app` or `notification`), kept 30 days. This is the instrument for the kill criterion.
- **Timezone:** hardcoded to Europe/Amsterdam. There is no `tz` column in v1.

**Privacy:** this is pseudonymous personal data under the GDPR. The push endpoint is a persistent identifier, and the cell, bearing, window and weekdays together can point to a person.
- **Retention:**
  - Deleting from Settings removes everything for the device at once.
  - A device with no app contact and no successful push for 60 days is deleted.
  - Deliveries are kept 14 days, the weather cache 48 hours, `opens` 30 days.
  - D1 Time Travel keeps deleted rows for 7 days; the privacy page says so.
- **Third parties:** PDOK receives the typed address text. Open-Meteo receives the rounded cell and the user's IP, because the client calls it directly. Workers Logs must not log IPs, endpoints or coordinates. Workers Logs' automatic invocation logs do record the client IP and the `cf` city coordinates of every request (checked 2026-10-22, ticket 4), so they are off (`observability.logs.invocation_logs: false`).

## 4. Cron: one trigger, `* 2-11 * * *` (UTC)
The UTC hours 02-11 cover 04:00-12:00 in Amsterdam under both CET and CEST. The account then uses 3 of its 5 Free triggers.

Overlapping runs must be assumed, and the lease covers them.

Each run:
1. **Claim.** Take at most `BATCH_SIZE` due routes, a fixed environment value: **4**, measured in ticket 3 (`docs/decisions.md`, "Ticket 3"). One `batch()` does `UPDATE routes SET lease_until … RETURNING`.
2. **Deliveries.** Upsert into `deliveries`. A route proceeds only when its row is new, or is in status `retry` with `attempts < 3`. When a route does not proceed, its `next_run_at` is still advanced to the next weekday, so it never takes a batch slot again.
3. **Lateness check.** A route more than 15 minutes past `notify_min`, or past the start of its commute window, gets `skipped_late` and no push.
4. **Weather.** Read the cache. Cells older than 50 minutes are fetched in **one** multi-location Open-Meteo request with `AbortSignal.timeout`. The variables, `models=` and cell coordinates match exactly what the app requests. If Open-Meteo fails:
   - while `attempts < 3` and the next try still fits before the lateness cutoff, set `retry` with `next_run_at = now + 4 min`;
   - otherwise send a short "no weather data today" push and mark `no_data`.
5. **Send.** For each push:
   - compute and encrypt it inside its own try/catch, so one malformed subscription cannot kill the batch;
   - compute the VAPID headers once per push-service origin per run, and reuse them;
   - use `pad: false` or a small fixed padding;
   - set **TTL** to the seconds until the commute window starts (at least 300), `urgency: high`, and `topic: route-<slot>`.
6. **Write back.** One `batch()` writes status and `http_status`, sets `next_run_at` to the next weekday, and removes devices that returned 410.

Budget per run: at most 1 + `BATCH_SIZE` external subrequests and at most about 6 D1 calls. Both Free caps are 50.

**Cleanup:** when nothing is due, the run executes one bounded retention delete (`LIMIT 50` per table), at most once an hour, keyed on the latest cleanup time stored in `weather_cache` under the special cell `_meta`.

**Throughput:** `BATCH_SIZE` is 4 and `MAX_DEVICES` stays 50 (measured in ticket 3). One run a minute sends 4 pushes, so 50 routes due at 07:00 all get their push within 13 minutes. If Workers Logs ever show `exceededCpu`, `BATCH_SIZE` drops to 2 through the env var (25 minutes for 50 routes, so `MAX_DEVICES` would then need lowering to 30).

**CPU kills** are read from Workers Logs (`exceededCpu`). They are not inferred from stale rows. Since ticket 4 the invocation logs are off (§3), so ticket 5 confirms where `exceededCpu` still shows: in a console log of its own, or in GraphQL `workersInvocationsAdaptive` (status and CPU time, used in ticket 3).

## 5. API (same origin, `/api/*`, `run_worker_first` for `/api/*` only)
- `POST /api/devices {invite, lang, push:{endpoint, keys:{p256dh, auth}}}` returns 201 `{deviceId, secret}`.
- `GET|PATCH|DELETE /api/devices/me`
- `PUT|DELETE /api/routes/:slot {cell, bearing, window:{start, end}, weekdays:[1..7], notifyAt|null}`
- `POST /api/opens {date, source}`
- `GET /api/health`

The VAPID public key is built into the app. The VAPID private key, the invite code and `MAX_DEVICES` are set with `wrangler secret put` or as environment variables. **Rotating the VAPID key invalidates every subscription.** Errors use the shape `{error:{code, message, fields?}}`.

**Weather in the app:** the PWA calls Open-Meteo directly with the rounded cell, so no Worker quota is spent. The push payload carries the computed verdict and its forecast time, and the service worker stores it.
- Opened from a notification, the app shows the pushed verdict with its time.
- If the live verdict differs, it shows "updated at HH:MM".

## 6. PWA
- `/sw.js` has scope `/` and is served with `no-cache`.
- Every push calls `showNotification`, because iOS revokes push for silent messages.
- A notification click opens a deep link and logs an open with `source=notification`.
- The app shell is precached, and the last result is kept in IndexedDB.
- **iOS:**
  - Onboarding starts with the install-to-Home-Screen step, because the installed PWA's storage is separate from Safari's.
  - The push toggle appears only in standalone mode, and permission is asked only on a tap.
- **Attribution:** "Weather data: Open-Meteo.com (CC BY 4.0)" is linked under every recommendation and on the About page.
- **Push library:** `@block65/webcrypto-web-push` pinned to `^2.0.0`, because 1.x uses `aesgcm`, which Apple rejects.

## 7. Testing
- **Unit tests (core, Vitest on Node):**
  - Bearings N/E/S/W, and the wrap from 350° to 10°.
  - The signs of the wind components at ±90° and 180°.
  - The off-by-one in the preceding-hour precipitation value.
  - The score is monotone in headwind.
  - `nextRun` across 2026-03-29 and 2026-10-25, and the weekday mask.
  - Cell rounding, validators, i18n completeness.
- **Integration tests** (`@cloudflare/vitest-plugin`, local D1, mocked fetch):
  - auth and invite;
  - the `MAX_DEVICES` cap;
  - two overlapping drains send exactly one push;
  - the retry path reaches `no_data`;
  - a conflicting route still advances `next_run_at`;
  - 410 cleanup;
  - `skipped_late`;
  - one malformed subscription does not stop the batch;
  - TTL, urgency and topic headers;
  - bounded cleanup.
- **End-to-end (Playwright):** onboarding, the Today screen with mocked Open-Meteo, switching language, offline mode.
- **Real devices:** iOS 16.4+ install, permission, delivery and deep link; Android Chrome push.

## 8. Rollout (tickets, after the phase 3.5 design gate)
0. **Setup:**
   - scaffold, wrangler config (SPA assets, `run_worker_first: ["/api/*"]`, D1 binding);
   - lint, typecheck, Vitest projects, GitHub Actions;
   - `workers.dev` deploy with a preview URL;
   - `/api/health`;
   - VAPID key generation and documentation of the secrets.
1. **Core engine and Today screen:**
   - PDOK search, a route stored only on the device, a live Open-Meteo call with the rounded cell;
   - EN/NL/IT and the attribution;
   - **the privacy page**, because data goes to PDOK and Open-Meteo from this ticket on.
2. **Installable PWA:** manifest, service worker, offline last result, the iOS install-first onboarding.
3. **CPU spike (half a day):** deploy a cron that sends N pushes to your own subscriptions, read CPU per run from Workers Logs, and set `BATCH_SIZE` and the final `MAX_DEVICES`.
4. **Device and route API:** D1 schema, auth, invite and cap, delete-my-data, the welcome push, the `opens` endpoint.
5. **Cron drain:** everything in section 4.
6. **Notification follow-up:** deep link, stored payload with "updated" diff, endpoint resync, open logging from the notification.

## Deferred (back when `MAX_DEVICES` is raised past ~50)
- Admission control per 5-minute step with 409 alternatives.
- Adaptive batch size.
- Idle-minute weather prefetch.
- A stale-cache tier.
- The Rate Limiting binding.
- A per-device timezone.
- KNMI fallback: not feasible in a Free Worker, because HARMONIE ships as GRIB/HDF5 files.

## Unverified
- CPU per run with two push-service origins (FCM + Apple) in the same batch: ticket 3 measured FCM only.
- Whether D1 writes still in flight at a CPU kill are committed.
- Open-Meteo: whether multi-location requests count per location, and whether shared Cloudflare egress IPs get throttled. (CORS verified on 2026-10-19 in ticket 1: `Access-Control-Allow-Origin: *`.)
- PDOK rate limit. (CORS verified on 2026-10-19 in ticket 1: `Access-Control-Allow-Origin: *`.)
- Whether cron invocations count toward the 100k-per-day request quota.
- iOS notification `tag` replacement.
- Apple push rate limits.
