# Decisions

One entry per confirmed decision, newest phase last. Tickets cite these entries instead of re-deriving them.

## Phase 1 — Idea (in progress)

**Starting brief** (from the Notion research, 2026-08-17; not yet confirmed by the user):

- **Problem:** in the Netherlands, wind matters as much as rain for a bike commute: a 25-30 km/h headwind can double the effort. Buienradar and Buienalarm show raw weather but do not turn wind + rain into a decision for a specific route.
- **Users:** bike and e-bike commuters in Amsterdam, then other Dutch cities (Utrecht, Rotterdam, The Hague). Other European cycling cities could come later.
- **Core loop:** every morning, one glance (or one notification) answers: bike, public transport, or leave earlier or later.
- **MVP scope (candidate):** 1-2 saved routes; hourly wind and rain for the commute window; headwind, tailwind or crosswind computed against the route's bearing; a text recommendation plus a 1-10 "bike day" score; an optional morning notification.
- **Out of v1:** multi-stop routing, calendar integration, gamification, community features, forecasts beyond 24 h.
- **Data:** Open-Meteo is the primary source (no key needed; free for non-commercial use). KNMI Open Data is the fallback.
- **Kill criterion:** after 2 weeks with 10-20 real users, if fewer than 20% open the app in the morning for 5 days in a row, stop or rethink the algorithm.

Open phase-1 decisions: see the phase-1 gate in the session that created this file. The answers are recorded here once confirmed.
