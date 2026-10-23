# Decisions

One entry per confirmed decision, newest phase last. Tickets cite these entries instead of re-deriving them.

## Phase 1 — Idea (confirmed 2026-10-15)

**Decisions confirmed by the user:**

- **Shape:** an installable PWA plus a Cloudflare Worker on a cron trigger. Every morning the Worker computes the recommendation and sends a web push. The Notion brief promised both "no backend" and a 07:00 push, which contradict each other: a closed PWA cannot wake itself to fetch fresh weather.
  - What lives on the server: the push subscription, the route (bearing plus approximate coordinates) and the notification time. Nothing else.
  - Platforms: Android and iOS. On iOS, web push only works once the PWA is installed to the Home Screen (iOS 16.4+), so onboarding has to guide iOS users through installing it.
- **Route input:** a start point and an end point give a single bearing. A real cycling route weighted per segment is a later upgrade.
- **Languages:** English, Dutch and Italian from v1.
- **Validation:** runs in parallel with phases 2-3. The user checks a hand-computed recommendation against their real commute for a week, possibly with 2-3 cycling friends.

**Starting brief** (from the Notion research, 2026-08-17; the decisions above override it where they differ):

- **Problem:** in the Netherlands, wind matters as much as rain for a bike commute: a 25-30 km/h headwind can double the effort. Buienradar and Buienalarm show raw weather but do not turn wind + rain into a decision for a specific route.
- **Users:** bike and e-bike commuters in Amsterdam, then other Dutch cities (Utrecht, Rotterdam, The Hague). Other European cycling cities could come later.
- **Core loop:** every morning, one glance (or one notification) answers: bike, public transport, or leave earlier or later.
- **MVP scope (candidate):** 1-2 saved routes; hourly wind and rain for the commute window; headwind, tailwind or crosswind computed against the route's bearing; a text recommendation plus a 1-10 "bike day" score; an optional morning notification.
- **Out of v1:** multi-stop routing, calendar integration, gamification, community features, forecasts beyond 24 h.
- **Data:** Open-Meteo is the primary source (no key needed; free for non-commercial use). KNMI Open Data is the fallback.
- **Kill criterion:** after 2 weeks with 10-20 real users, if fewer than 20% open the app in the morning for 5 days in a row, stop or rethink the algorithm.

## Phase 2 — Tools & cost (confirmed 2026-10-15)

Researched 2026-10-15 by the `researcher` agent. The official sites were blocked by the egress proxy, so most facts come from the official docs' GitHub sources. The Cloudflare subrequest and CPU limits were spot-checked in cloudflare-docs.

| Need | Choice | License / ToS | Cost |
|---|---|---|---|
| Frontend | Svelte 5 + Vite, installable PWA (Android + iOS) | MIT | €0 |
| Hosting | Cloudflare Workers static assets: one project for the PWA and the Worker | Free plan | €0 |
| Morning push | Worker cron trigger + `@block65/webcrypto-web-push` (VAPID, RFC 8291, runs on Workers) | MIT | €0 |
| Storage | Cloudflare D1: subscriptions, routes, notification times | Free plan: 5M rows read/day, 100k written/day, 5 GB | €0 |
| Weather | Open-Meteo forecast API, cached per ~1 km cell per hour; KNMI Data Platform (HARMONIE-AROME) as fallback | Open-Meteo: free for non-commercial use only; CC BY 4.0, link required next to displayed data. KNMI: CC BY 4.0, personal key | €0 |
| Address input | PDOK Locatieserver (`suggest` + `lookup`). No map in v1 | Open and free | €0 |

**Decisions:**
- **Cloudflare plan:** stay on Workers Free and move to Workers Paid ($5/month, overage auto-billed) only when the logs show limit errors or users go past ~40. Free allows 50 external subrequests and 10 ms of CPU per cron run, so the cron processes users in batches from the start.
- **Map:** none in v1. The address search plus a static preview of the direction replace it, which removes the tile dependency and its attribution.
- **Pro tier:** out of v1. v1 has no subscriptions and no ads, so it stays non-commercial under Open-Meteo's terms. A paid tier would need Open-Meteo's commercial plan (about $29/month; the live price is unverified), so roughly $34/month in total with Workers Paid.

**Zero-billing rule (user requirement, 2026-10-15): nothing may ever be billed.**
- Use only features of the Workers Free plan. No Workers Paid. No Queues, R2 or any other binding that can bill.
- When the free limits are hit, the app degrades (pushes are skipped or delayed) instead of upgrading the plan.
- This replaces "move to Paid at ~40 users" above. Moving to Paid now needs an explicit new decision from the user.
- The Cloudflare account already uses 2 of its 5 Free cron triggers for other projects (`daily-smile`, `projectamsterdam`). Fiets Vandaag may use at most 3 of them.

**Cost estimates:** about €0/month at 20 users and at 200 users (with batching). About $5/month at 5,000 users, still non-commercial. A domain name is extra if one is wanted.

**Rejected:**
- Nominatim: its public instance bans autocomplete.
- tile.openstreetmap.org: access can be withdrawn at any time.
- Buienradar feed: mobile and commercial use need Buienradar's permission.
- `web-push` (npm): Node-only, last release 2024.
- Workers KV: limited to 1,000 writes per day, and scanning every subscription needs paginated list calls.

**Still unverified:**
- Apple web-push rate limits.
- PDOK licence text and rate limit.
- Open-Meteo's live commercial price.
- Whether Cloudflare's Free plan asks for a card.

## Phase 3 — Architecture (confirmed 2026-10-15)

The full design is in `docs/architecture.md`. The `architect` agent proposed it and the `critic` agent red-teamed it; the verdict was "accept with changes", and all 7 required fixes were applied. Choices confirmed by the user:

- **Simplified v1.** Up to ~50 invited users (`MAX_DEVICES` plus an invite code), and the timezone is fixed to Europe/Amsterdam. Admission control, the adaptive batch, prefetch and the rate limit are deferred until the cap is raised.
- **KNMI fallback removed from v1.** This amends phase 2: HARMONIE ships as GRIB/HDF5 files, which cannot be parsed in a Free Worker. When Open-Meteo is down, the cron retries; if that fails, users get a "no weather data" push.
- **Server data amends phase 1** ("nothing else"). The server stores:
  - device: language and push subscription;
  - route: midpoint cell (~1 km) and bearing, but never the start and end points;
  - schedule: commute window, weekdays and notify time;
  - delivery log for 14 days, and the pseudonymous `opens` log for 30 days.

  This is pseudonymous personal data under the GDPR. A privacy page ships with ticket 1.
- **Kill-criterion instrumentation.** The `opens(device, date, source)` log, kept for 30 days.
- **Origin.** Free `workers.dev`, no custom domain, in line with the zero-billing rule. Moving to a real domain later means testers reinstall the app and re-enable notifications.

## Phase 3.5 — Design UI/UX (chosen 2026-10-15)

**Chosen: B · Polder.** The user delegated the choice. It carries the verdict pill from A and the best-moment row from C, and its colors were darkened to pass WCAG AA. The tokens and screen rules are in the root `DESIGN.md`, which every UI ticket references.


Three directions are drawn on the same three screens (route setup, Today, hour by hour). Each comes with its palette, type and motion tokens, and the user picks one. Canvas: https://claude.ai/artifact/QzS6XDFiEtAgiLFvLxR866

- **A · Signaal:** dark, the verdict on a road sign, a compass and 3 tiles.
- **B · Polder:** light, a sentence plus a commute-window timeline.
- **C · Fietsbel:** playful, a 1-10 score dial, chunky cards.

## Ticket 3 — CPU spike (measured 2026-10-22)

Measured on a throwaway Workers Free Worker, since deleted. 20 cron runs sent N pushes each to the owner's Android subscription (FCM, every push 201), using `@block65/webcrypto-web-push` 2.0.0, `pad: false`, and one VAPID header per origin per run. CPU comes from Cloudflare analytics. Full report: issue #4.

| N pushes | median CPU | max CPU | runs > 10 ms (of 4) |
|---|---|---|---|
| 0 | 1.7 ms | 1.9 ms | 0 |
| 1 | 6.4 ms | 8.2 ms | 0 |
| 2 | 5.4 ms | 9.0 ms | 0 |
| 4 | 6.3 ms | 7.2 ms | 0 |
| 8 | 10.1 ms | 17.0 ms | 2 |

- **`BATCH_SIZE` = 4, `MAX_DEVICES` = 50.** This keeps the 15-minute delivery target of architecture §4.
- **Cost shape.** The first push of a run costs about 4-6 ms (VAPID signing plus the first key agreement); each further push adds under 1 ms.
- **CPU limit.** There were no `exceededCpu` events in 22 runs, even at 17 ms, and one outlier of 16 ms on the first cron run. The design still budgets for the documented 10 ms limit and does not rely on that leniency.
- **If CPU kills appear:** lower `BATCH_SIZE` to 2 through the env var. Never upgrade the plan.
- **Platform note.** A newly added cron trigger took about 10 minutes before its first invocation.
- **Still unverified:** Apple (no iOS subscription was measured), and a batch that mixes two push-service origins. Ticket 5 logs CPU per run during its first real mornings.

## Ticket 5 — Cron drain (2026-10-23)

- **One cron trigger, `* 2-11 * * *` UTC,** in `wrangler.jsonc`. Before this ticket the account had 2 (`daily-smile`, `projectamsterdam`) and fiets-vandaag none, so it now uses 3 of its 5 Free triggers, and fiets-vandaag uses 1 of the 3 it may have. Only the deployed Worker runs it, never a preview version.
- **`ride_min` on the server.** The push must say what the Today screen says, and the recommendation depends on the ride time, which the server did not have. The app now sends `rideMin` with the route (a 5-minute estimate, never the start or end point); migration 0002 adds a nullable column. The privacy page lists it.
- **Where CPU kills show:** GraphQL `workersInvocationsAdaptive`, `status: exceededResources` (architecture §4, "CPU kills"). The `drain` log line per run gives the number of pushes for each minute.
- **Push padding:** `pad: false`; the VAPID header is signed once per push-service origin per run.
- **Still to measure on the first real mornings:** CPU per run with Apple and FCM in one batch (architecture "Unverified"). If a run shows `exceededResources`, set `BATCH_SIZE` to 2.
