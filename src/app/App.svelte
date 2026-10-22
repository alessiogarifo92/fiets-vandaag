<script lang="ts">
  import { isLang, validateLocalRoute, type LocalRoute } from '../core/validate';
  import { locale } from './lib/i18n.svelte';
  import { go, nav } from './lib/router.svelte';
  import { load, save } from './lib/store';
  import About from './screens/About.svelte';
  import Hours from './screens/Hours.svelte';
  import Privacy from './screens/Privacy.svelte';
  import Setup from './screens/Setup.svelte';
  import Today from './screens/Today.svelte';

  let ready = $state(false);
  let route: LocalRoute | null = $state(null);

  $effect(() => {
    void Promise.all([load('lang'), load('route')]).then(([lang, stored]) => {
      if (isLang(lang)) locale.lang = lang;
      const checked = validateLocalRoute(stored);
      route = checked.ok ? checked.value : null;
      if (!nav.route || (!route && (nav.route === 'today' || nav.route === 'hours')))
        go(route ? 'today' : 'setup');
      ready = true;
    });
  });

  $effect(() => {
    document.documentElement.lang = locale.lang;
  });

  async function onsave(next: LocalRoute) {
    route = next;
    await save('route', next).catch(() => {});
    go('today');
  }
</script>

{#if ready}
  {#if nav.route === 'privacy'}
    <Privacy />
  {:else if nav.route === 'about'}
    <About />
  {:else if nav.route === 'hours' && route}
    <Hours {route} />
  {:else if nav.route === 'today' && route}
    {#key route}
      <Today {route} />
    {/key}
  {:else}
    <Setup initial={route} {onsave} />
  {/if}
{/if}
