<script lang="ts">
  import { hourPhrase } from '../../core/i18n';
  import { routeGeometry } from '../../core/route';
  import { recommend } from '../../core/score';
  import { commuteDay, formatMinutes } from '../../core/time';
  import { hourRows, type HourRow } from '../../core/timeline';
  import type { LocalRoute } from '../../core/validate';
  import Attribution from '../components/Attribution.svelte';
  import Footer from '../components/Footer.svelte';
  import WindArrow from '../components/WindArrow.svelte';
  import { getForecast } from '../lib/forecast';
  import { locale, tr } from '../lib/i18n.svelte';

  let { route }: { route: LocalRoute } = $props();

  let rows: HourRow[] | null = $state(null);
  let failed = $state(false);
  const geometry = $derived(routeGeometry(route));

  $effect(() => {
    const g = geometry;
    const day = commuteDay(new Date(), route.window, g.rideMin);
    getForecast(g.cell, g.cellKey)
      .then(({ hours }) => {
        const rec = recommend({
          hours,
          date: day.date,
          window: route.window,
          bearingDeg: g.bearingDeg,
          rideMin: g.rideMin,
          notBeforeMin: day.notBeforeMin,
        });
        rows = hourRows(hours, day.date, route.window, g.bearingDeg, rec?.departMin ?? null);
      })
      .catch(() => (failed = true));
  });
</script>

<main class="page">
  <a class="back" href="#/today">← {tr('nav.back')}</a>
  <h1 class="display">{tr('hours.title')}</h1>
  <p class="intro">{tr('hours.intro')}</p>

  {#if failed}
    <p role="alert">{tr('today.error')}</p>
  {:else if rows}
    <ol class="rows">
      {#each rows as row (row.minute)}
        <li class:in={row.inWindow} class:best={row.best}>
          <span class="time">{formatMinutes(row.minute)}</span>
          <span class="phrase">
            {#if row.best}<strong class="tag">{tr('hours.best')}</strong>{/if}
            {hourPhrase(locale.lang, row.hour, geometry.bearingDeg)}
          </span>
          <span class="num" title={tr('hours.rain')}>{Math.round(row.precipProb)}%</span>
          <span class="num" title={tr('hours.wind')}>{Math.round(row.windSpeed)} km/h</span>
          <WindArrow
            deg={row.arrowDeg}
            label={tr('hours.arrow', { deg: Math.round(row.arrowDeg) })}
            inverted={row.best}
          />
        </li>
      {/each}
    </ol>
    <Attribution />
  {:else}
    <p aria-live="polite">{tr('today.loading')}</p>
  {/if}

  <Footer />
</main>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-bottom: 12px;
    font-size: 14px;
  }

  .intro {
    margin: 12px 0 20px;
    color: var(--reed);
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }

  li {
    display: grid;
    grid-template-columns: 48px 1fr auto auto 20px;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px 12px;
    border-radius: var(--radius-input);
    background: var(--card);
    font-size: 14px;
  }

  li.in {
    background: var(--window);
  }

  li.best {
    background: var(--ink);
    color: var(--card);
  }

  .time,
  .num {
    font-variant-numeric: tabular-nums;
  }

  .time {
    font-weight: 600;
  }

  .num {
    text-align: right;
  }

  .tag {
    display: block;
    font-size: 12px;
    font-weight: 600;
  }
</style>
