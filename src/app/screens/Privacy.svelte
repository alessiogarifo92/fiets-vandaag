<script lang="ts">
  import type { MessageKey } from '../../core/i18n';
  import Footer from '../components/Footer.svelte';
  import { tr } from '../lib/i18n.svelte';

  const sections = ['phone', 'pdok', 'meteo', 'push', 'server', 'delete'] as const;
</script>

<main class="page">
  <a class="back" href="#/today">← {tr('nav.back')}</a>
  <h1 class="display">{tr('privacy.title')}</h1>
  <p class="intro">{tr('privacy.intro')}</p>
  {#each sections as s (s)}
    <section class="card">
      <h2>{tr(`privacy.${s}.title` as MessageKey)}</h2>
      <p>{tr(`privacy.${s}.body` as MessageKey)}</p>
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
</style>
