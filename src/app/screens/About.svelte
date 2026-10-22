<script lang="ts">
  import Attribution from '../components/Attribution.svelte';
  import Footer from '../components/Footer.svelte';
  import { tr } from '../lib/i18n.svelte';
</script>

<main class="page">
  <a class="back" href="#/today">← {tr('nav.back')}</a>
  <h1 class="display">{tr('about.title')}</h1>
  <p class="body">{tr('about.body')}</p>
  <p class="meta">{tr('about.version', { version: __APP_VERSION__ })}</p>
  <Attribution />
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

  .body {
    margin: 12px 0 20px;
  }
</style>
