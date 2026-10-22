<script lang="ts">
  import { tr } from '../lib/i18n.svelte';
</script>

<!-- Open-Meteo CC BY 4.0: a link next to every displayed recommendation (docs/decisions.md, phase 2). -->
<p class="attribution meta">
  {tr('attribution.prefix')}
  <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com (CC BY 4.0)</a>
</p>

<style>
  .attribution {
    margin: 20px 0 0;
  }
</style>
