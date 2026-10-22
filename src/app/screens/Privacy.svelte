<script lang="ts">
  import type { MessageKey } from '../../core/i18n';
  import Footer from '../components/Footer.svelte';
  import { deleteMyData } from '../lib/device';
  import { tr } from '../lib/i18n.svelte';
  import { unsubscribe } from '../lib/push';

  let { ondeleted }: { ondeleted: () => void } = $props();

  const sections = ['phone', 'pdok', 'meteo', 'push', 'server', 'delete'] as const;

  type DeleteState = 'idle' | 'confirm' | 'busy' | 'done' | 'error';
  let deleteState = $state<DeleteState>('idle');

  async function confirmDelete() {
    deleteState = 'busy';
    try {
      await deleteMyData(() => unsubscribe());
      deleteState = 'done';
      ondeleted();
    } catch {
      deleteState = 'error';
    }
  }
</script>

<main class="page">
  <a class="back" href="#/today">← {tr('nav.back')}</a>
  <h1 class="display">{tr('privacy.title')}</h1>
  <p class="intro">{tr('privacy.intro')}</p>
  {#each sections as s (s)}
    <section class="card" aria-labelledby="privacy-{s}">
      <h2 id="privacy-{s}">{tr(`privacy.${s}.title` as MessageKey)}</h2>
      <p>{tr(`privacy.${s}.body` as MessageKey)}</p>
      {#if s === 'delete'}
        {#if deleteState === 'done'}
          <p class="status" role="status">{tr('privacy.delete.done')}</p>
        {:else if deleteState === 'confirm' || deleteState === 'busy'}
          <p class="status" role="alert">{tr('privacy.delete.confirm')}</p>
          <div class="actions">
            <button
              type="button"
              class="btn btn-primary"
              disabled={deleteState === 'busy'}
              onclick={confirmDelete}>{tr('privacy.delete.yes')}</button
            >
            <button
              type="button"
              class="btn btn-secondary"
              disabled={deleteState === 'busy'}
              onclick={() => (deleteState = 'idle')}>{tr('privacy.delete.cancel')}</button
            >
          </div>
        {:else}
          {#if deleteState === 'error'}
            <p class="status" role="alert">{tr('privacy.delete.error')}</p>
          {/if}
          <div class="actions">
            <button type="button" class="btn btn-secondary" onclick={() => (deleteState = 'confirm')}
              >{tr('privacy.delete.button')}</button
            >
          </div>
        {/if}
      {/if}
    </section>
  {/each}
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

  .card {
    padding: 20px;
    margin-bottom: 12px;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .status {
    margin-top: 12px;
    font-weight: 500;
  }

  .actions {
    display: grid;
    gap: 12px;
    margin-top: 20px;
  }
</style>
