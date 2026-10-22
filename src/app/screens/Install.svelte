<script lang="ts">
  import Footer from '../components/Footer.svelte';
  import { tr } from '../lib/i18n.svelte';
  import { iosVersion } from '../lib/platform';

  let { onskip }: { onskip: () => void } = $props();

  const v = iosVersion(navigator.userAgent);
  const tooOld = !!v && (v[0] < 16 || (v[0] === 16 && v[1] < 4));
</script>

<main class="page">
  <p class="meta">{tr('install.meta')}</p>
  <h1 class="display">{tr('install.title')}</h1>
  <p class="why">{tr('install.why')}</p>

  <ol class="card steps">
    <li>
      <!-- Share: a box with an arrow out of its top, as in Safari's bar. -->
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path
          d="M12 15V3M8 7l4-4 4 4M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"
        /></svg
      >
      <span>{tr('install.step.share')}</span>
    </li>
    <li>
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></svg
      >
      <span>{tr('install.step.add')}</span>
    </li>
    <li>
      <svg viewBox="0 0 32 32" aria-hidden="true" style="stroke-width: 2.4"
        ><circle cx="8" cy="21" r="6" /><circle cx="24" cy="21" r="6" /><path
          d="M8 21l5-10h7l4 10M13 11l3 10h-8M18 7h4"
        /></svg
      >
      <span>{tr('install.step.open')}</span>
    </li>
  </ol>

  {#if tooOld}
    <p class="meta note">{tr('install.oldIos')}</p>
  {/if}

  <div class="actions">
    <button type="button" class="btn btn-secondary" onclick={onskip}>{tr('install.skip')}</button>
  </div>

  <Footer />
</main>

<style>
  .meta {
    margin: 0 0 12px;
    font-size: 13px;
  }

  .why {
    margin: 20px 0 0;
  }

  .steps {
    margin: 32px 0 0;
    padding: 8px 20px;
    list-style: none;
    counter-reset: step;
  }

  .steps li {
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: 12px;
    align-items: center;
    min-height: 56px;
    padding: 12px 0;
  }

  .steps li + li {
    border-top: 1px solid var(--line);
  }

  .steps svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: var(--polder);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .note {
    margin: 12px 0 0;
  }

  .actions {
    margin-top: 20px;
  }
</style>
