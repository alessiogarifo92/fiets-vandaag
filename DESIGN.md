# Design — Polder (phase 3.5, chosen 2026-10-15)

The source of truth for every UI ticket. Canvas: https://claude.ai/artifact/QzS6XDFiEtAgiLFvLxR866, row "B · Polder". It holds three screens: route setup, Today and hour by hour.

## Thesis
A calm, honest morning briefing:
- **one verdict pill** you can read in a second;
- **one plain sentence** that explains it;
- **the commute window drawn as a timeline**, so the user can see *why*.

Trust in the algorithm is the product's main risk, and showing the data is how this direction answers it.

## Why Polder
Signaal (A) and Fietsbel (C) were drawn on the same screens.
- **Signaal** reads fastest but feels cold, and an all-caps verdict does not translate well into NL/IT.
- **Fietsbel's** bare 1-10 score does not tell you what to do.
- **Polder** adapts best to all three languages (it uses full sentences) and explains itself.

It borrows two pieces from the others:
- From A: the **verdict pill** at the top of Today ("Bike · leave 07:50"), for glanceability.
- From C: the **best-moment row**, highlighted in hour by hour.

## Tokens
| Token | Value | Use |
|---|---|---|
| `--mist` | `#EEF2F0` | page ground |
| `--card` | `#FFFFFF` | cards, inputs on cards |
| `--ink` | `#13201C` | text, primary button, verdict pill, best-moment row |
| `--polder` | `#1A6B5E` | wind, links, highlighted words (5.3:1 or better on every ground) |
| `--rain` | `#3A62C9` | rain bars (5.6:1 on white) |
| `--reed` | `#5A6862` | secondary text (4.9:1 or better on every ground) |
| `--window` | `#E1EEEA` | commute-window highlight |
| `--line` | `#E3E9E6` / `#CBD5D0` | dividers / inactive progress, outline buttons |

The first draft used `#6B7A74` and `#1F7A6B`. Both failed WCAG AA (4.5:1) on Mist, so they were darkened to the values above.

**Type**
- Display: **Instrument Serif** 400, for the verdict sentence and headings: 38-44 px, line-height 1.05.
- Body and UI: **Geist** 400/500/600: 16 px body, 13-14 px labels, 12 px meta. Numbers use `font-variant-numeric: tabular-nums`.
- Both are free on Google Fonts. Self-host them at build time, so the app needs no third-party font request.

**Spacing:** 8 / 12 / 20 / 32 / 48. Page padding 28 px.

**Radius:** 14 for cards and buttons, 10 for inputs, 999 for pills.

**Touch targets:** at least 44 px. Primary buttons are 50-54 px.

## Motion
- Durations are **180 ms** for state changes and **260 ms** for entrances.
- Easing is `cubic-bezier(0.23, 1, 0.32, 1)` (ease-out).
- Timeline bars grow from their baseline **once, on the first open of the day**, staggered by 20 ms per bar. Later opens show them static.
- The verdict pill and the sentence **never** animate in: they are read every morning.
- Button press: `scale(0.98)`, 120 ms. Nothing scales in from 0.
- `prefers-reduced-motion`: all motion off.

## Screen rules
- **Today:**
  - Content runs top to bottom: verdict pill, sentence, a supporting line (wind and rain in words), the timeline card (window highlighted), then the actions "Hour by hour" (primary) and "Evening ride" (secondary).
  - The attribution line sits at the bottom.
  - When the screen is opened from a notification, it shows the pushed verdict with its forecast time. If the live data differs, it adds "updated at HH:MM".
- **Hour by hour:**
  - Rows show time, a short phrase, rain % and wind km/h, and a wind arrow relative to the route.
  - Rows inside the window use `--window`. The best-moment row is inverted (`--ink`).
- **Route setup:**
  - A sentence-style heading echoes the user's input.
  - Fields sit on a white card. A privacy line with a link to the privacy page is always visible.
  - Progress shows as three bars.
- **Attribution:** "Weather data: Open-Meteo.com (CC BY 4.0)" goes under every recommendation and on About.
- **Icons:** inline stroke icons at 1.8-2 px. No emoji.
- **Copy:** EN, NL and IT. Write the verdict as a sentence with the time inside it, never as a bare score.
