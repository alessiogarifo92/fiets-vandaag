<script lang="ts">
  import { tr } from '../lib/i18n.svelte';
  import { mode, promptInstall } from '../lib/install.svelte';
</script>

<!-- Chrome, Edge and Samsung Internet only: iOS gets the Install screen, and an installed app sees nothing. -->
{#if mode() === 'prompt'}
  <section class="card install">
    <div>
      <h2>{tr('install.prompt.title')}</h2>
      <p>{tr('install.prompt.body')}</p>
    </div>
    <button type="button" class="btn btn-primary" onclick={() => void promptInstall()}
      >{tr('install.prompt.button')}</button
    >
  </section>
{/if}

<style>
  .install {
    display: grid;
    gap: 12px;
    margin-top: 20px;
    padding: 20px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 4px 0 0;
    font-size: 14px;
    color: var(--reed);
  }
</style>
