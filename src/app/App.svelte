<script lang="ts">
  import { isHealthResponse, type HealthResponse } from '../core/api';

  type Status = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'down' };

  let status: Status = $state({ kind: 'loading' });

  $effect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        status = isHealthResponse(body) ? { kind: 'ok', health: body } : { kind: 'down' };
      })
      .catch(() => {
        status = { kind: 'down' };
      });
  });
</script>

<main>
  <span class="pill">Fiets Vandaag</span>
  <h1>Bike or train today? <em>Soon</em> you'll know before breakfast.</h1>
  <p class="lede">This is the empty skeleton. The morning recommendation arrives with the next tickets.</p>

  <section class="card" aria-live="polite">
    <span class="label">API</span>
    {#if status.kind === 'loading'}
      <span class="value">checking…</span>
    {:else if status.kind === 'ok'}
      <span class="value ok">online · <code>{status.health.version}</code></span>
    {:else}
      <span class="value down">unreachable</span>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 48px 28px calc(48px + env(safe-area-inset-bottom));
  }

  .pill {
    display: inline-block;
    padding: 6px 14px;
    border-radius: var(--radius-pill);
    background: var(--ink);
    color: var(--card);
    font-size: 13px;
    font-weight: 600;
  }

  h1 {
    margin: 20px 0 12px;
    font: 400 40px/1.05 var(--font-display);
  }

  h1 em {
    color: var(--polder);
  }

  .lede {
    margin: 0 0 32px;
    color: var(--reed);
  }

  .card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 54px;
    padding: 12px 20px;
    border-radius: var(--radius-card);
    background: var(--card);
    border: 1px solid var(--line);
  }

  .label {
    font-size: 13px;
    color: var(--reed);
  }

  .value {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .ok {
    color: var(--polder);
  }

  .down {
    color: var(--ink);
    font-weight: 600;
  }
</style>
