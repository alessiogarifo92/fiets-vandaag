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

## Phase 2 — Tools & cost (in progress)
