<script lang="ts">
  import { describe } from '../../core/i18n';
  import { routeGeometry } from '../../core/route';
  import { recommend } from '../../core/score';
  import { commuteDay, formatMinutes, localNow } from '../../core/time';
  import { hourRows } from '../../core/timeline';
  import type { LocalRoute } from '../../core/validate';
  import Attribution from '../components/Attribution.svelte';
  import Footer from '../components/Footer.svelte';
  import Timeline from '../components/Timeline.svelte';
  import { getForecast, type ForecastResult } from '../lib/forecast';
  import { locale, tr } from '../lib/i18n.svelte';
  import { go } from '../lib/router.svelte';
  import { load, save } from '../lib/store';

  let { route }: { route: LocalRoute } = $props();

  type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; forecast: ForecastResult };
  let view = $state<View>({ kind: 'loading' });
  let animate = $state(false);

  const geometry = $derived(routeGeometry(route));
  const day = $derived(commuteDay(new Date(), route.window.end));
  const rec = $derived(
    view.kind === 'ready'
      ? recommend({
          hours: view.forecast.hours,
          date: day.date,
          window: route.window,
          bearingDeg: geometry.bearingDeg,
          rideMin: geometry.rideMin,
        })
      : null,
  );
  const text = $derived(rec ? describe(rec, locale.lang) : null);
  const rows = $derived(
    view.kind === 'ready' && rec
      ? hourRows(view.forecast.hours, day.date, route.window, geometry.bearingDeg, rec.departMin)
      : [],
  );

  async function refresh() {
    view = { kind: 'loading' };
    try {
      const forecast = await getForecast(geometry.cell, geometry.cellKey);
      // DESIGN.md: the bars grow on the first open of the day only.
      const today = localNow(new Date()).date;
      animate = (await load('animatedOn')) !== today;
      if (animate) void save('animatedOn', today).catch(() => {});
      view = { kind: 'ready', forecast };
    } catch {
      view = { kind: 'error' };
    }
  }

  $effect(() => {
    void geometry.cellKey;
    void refresh();
  });
</script>

<main class="page">
  <p class="day meta">
    {day.tomorrow ? tr('today.tomorrow') : tr('today.today')} ·
    {tr('today.window', { start: formatMinutes(route.window.start), end: formatMinutes(route.window.end) })}
  </p>

  {#if view.kind === 'loading'}
    <p class="status" aria-live="polite">{tr('today.loading')}</p>
  {:else if view.kind === 'error' || !rec || !text}
    <div class="status" role="alert">
      <p>{tr('today.error')}</p>
      <button type="button" class="btn btn-secondary" onclick={refresh}>{tr('today.retry')}</button>
    </div>
  {:else}
    <span class="pill" data-verdict={rec.verdict}>{text.pill}</span>
    <h1 class="display sentence">{text.sentence}</h1>
    <p class="support">{text.support}</p>
    <p class="meta">
      {tr('today.score', { score: rec.score })} ·
      {tr('today.forecastAt', { time: formatMinutes(localNow(new Date(view.forecast.fetchedAt)).minute) })}
    </p>

    <Timeline {rows} window={route.window} {animate} />

    <div class="actions">
      <button type="button" class="btn btn-primary" onclick={() => go('hours')}>{tr('today.hours')}</button>
      <button type="button" class="btn btn-secondary" onclick={() => go('setup')}
        >{tr('nav.editRoute')}</button
      >
    </div>

    <Attribution />
  {/if}

  <Footer />
</main>

<style>
  .day {
    margin: 0 0 20px;
    font-size: 13px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 6px 14px;
    border-radius: var(--radius-pill);
    background: var(--ink);
    color: var(--card);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .pill[data-verdict='pt'] {
    background: var(--card);
    color: var(--ink);
    border: 1px solid var(--ink);
  }

  .sentence {
    margin-top: 20px;
    font-size: 42px;
  }

  .support {
    margin: 12px 0 8px;
    color: var(--ink);
  }

  .meta {
    margin: 0;
  }

  .status {
    margin: 32px 0;
  }

  .status p {
    margin: 0 0 20px;
  }

  .actions {
    display: grid;
    gap: 12px;
    margin-top: 20px;
  }
</style>
