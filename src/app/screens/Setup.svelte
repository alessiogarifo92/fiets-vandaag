<script lang="ts">
  import { untrack } from 'svelte';
  import { routeGeometry } from '../../core/route';
  import { formatMinutes, parseMinutes } from '../../core/time';
  import {
    validateLocalRoute,
    MAX_ROUTE_KM,
    MIN_ROUTE_KM,
    type LocalRoute,
    type Place,
  } from '../../core/validate';
  import AddressField from '../components/AddressField.svelte';
  import Footer from '../components/Footer.svelte';
  import { tr } from '../lib/i18n.svelte';

  let { initial, onsave }: { initial: LocalRoute | null; onsave: (route: LocalRoute) => void } = $props();

  // The form edits a copy; nothing is stored until "save".
  const seed = untrack(() => $state.snapshot(initial));
  let step = $state(1);
  let from: Place | null = $state(seed?.from ?? null);
  let to: Place | null = $state(seed?.to ?? null);
  let startText = $state(formatMinutes(seed?.window.start ?? 450));
  let endText = $state(formatMinutes(seed?.window.end ?? 540));

  const short = (p: Place | null) => p?.label.split(',')[0] ?? '…';
  const geometry = $derived(from && to ? routeGeometry({ from, to }) : null);

  const toError = $derived.by(() => {
    if (!geometry) return null;
    if (geometry.km < MIN_ROUTE_KM) return tr('setup.error.tooClose');
    if (geometry.km > MAX_ROUTE_KM) return tr('setup.error.tooFar');
    return null;
  });

  const windowError = $derived.by(() => {
    const start = parseMinutes(startText);
    const end = parseMinutes(endText);
    const route = { from, to, window: { start, end } };
    const result = validateLocalRoute(route);
    if (!result.ok)
      return Object.keys(result.fields).some((k) => k.startsWith('window')) ? tr('setup.error.window') : null;
    if (geometry && end! - start! < geometry.rideMin)
      return tr('setup.error.rideTooLong', { min: geometry.rideMin });
    return null;
  });

  function save() {
    const result = validateLocalRoute({
      from,
      to,
      window: { start: parseMinutes(startText), end: parseMinutes(endText) },
    });
    if (result.ok && !windowError) onsave(result.value);
  }
</script>

<main class="page">
  <div
    class="progress"
    role="progressbar"
    aria-valuemin={1}
    aria-valuemax={3}
    aria-valuenow={step}
    aria-label={tr('setup.progress', { step })}
  >
    {#each [1, 2, 3] as n (n)}
      <span class:done={n <= step}></span>
    {/each}
  </div>
  <p class="meta">{tr('setup.progress', { step })}</p>

  <h1 class="display">
    {tr('setup.heading.from')} <em class:empty={!from}>{short(from)}</em>
    {#if step >= 2}
      {tr('setup.heading.to')} <em class:empty={!to}>{short(to)}</em>{/if}{#if step >= 3},
      {tr('setup.heading.between')} <em>{startText}</em>
      {tr('setup.heading.and')} <em>{endText}</em>.{/if}
  </h1>

  <section class="card form">
    {#if step === 1}
      <AddressField id="from" label={tr('setup.from.label')} value={from} onpick={(p) => (from = p)} />
    {:else if step === 2}
      <AddressField id="to" label={tr('setup.to.label')} value={to} onpick={(p) => (to = p)} />
      {#if toError}
        <p class="error" role="alert">{toError}</p>
      {:else if geometry}
        <p class="meta">{tr('setup.ride', { min: geometry.rideMin })}</p>
      {/if}
    {:else}
      <div class="times">
        <label>
          <span>{tr('setup.window.start')}</span>
          <input type="time" step="300" bind:value={startText} required />
        </label>
        <label>
          <span>{tr('setup.window.end')}</span>
          <input type="time" step="300" bind:value={endText} required />
        </label>
      </div>
      {#if windowError}
        <p class="error" role="alert">{windowError}</p>
      {:else if geometry}
        <p class="meta">{tr('setup.ride', { min: geometry.rideMin })}</p>
      {/if}
    {/if}
  </section>

  <div class="actions">
    {#if step < 3}
      <button
        type="button"
        class="btn btn-primary"
        disabled={step === 1 ? !from : !to || !!toError}
        onclick={() => (step += 1)}>{tr('setup.next')}</button
      >
    {:else}
      <button type="button" class="btn btn-primary" disabled={!!windowError} onclick={save}
        >{tr('setup.save')}</button
      >
    {/if}
    {#if step > 1}
      <button type="button" class="btn btn-secondary" onclick={() => (step -= 1)}>{tr('setup.back')}</button>
    {/if}
  </div>

  <p class="privacy">
    {tr('setup.privacy')} <a href="#/privacy">{tr('setup.privacy.link')}</a>
  </p>

  <Footer />
</main>

<style>
  .progress {
    display: flex;
    gap: 8px;
  }

  .progress span {
    flex: 1;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--line-strong);
    transition: background-color var(--dur-state) var(--ease-out);
  }

  .progress span.done {
    background: var(--ink);
  }

  .meta {
    margin: 12px 0 20px;
  }

  h1 em {
    /* The serif italic leans past its box; keep it off the next word. */
    padding-right: 0.08em;
    color: var(--polder);
  }

  h1 em.empty {
    color: var(--reed);
  }

  .form {
    margin-top: 32px;
    padding: 20px;
  }

  .form .meta {
    margin: 4px 0 0;
  }

  .times {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .times label span {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  .times input {
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-input);
    background: var(--card);
    color: var(--ink);
    font: 400 16px/1.2 var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .error {
    margin: 12px 0 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
  }

  .actions {
    display: grid;
    gap: 12px;
    margin-top: 20px;
  }

  .privacy {
    margin: 20px 0 0;
    font-size: 13px;
    color: var(--reed);
  }
</style>
