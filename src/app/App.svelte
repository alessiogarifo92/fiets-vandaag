<script lang="ts">
  import { isLang, validateLocalRoute, type LocalRoute } from '../core/validate';
  import { locale } from './lib/i18n.svelte';
  import { install } from './lib/install.svelte';
  import { go, nav } from './lib/router.svelte';
  import { load, save } from './lib/store';
  import About from './screens/About.svelte';
  import Install from './screens/Install.svelte';
  import Hours from './screens/Hours.svelte';
  import Privacy from './screens/Privacy.svelte';
  import Setup from './screens/Setup.svelte';
  import Today from './screens/Today.svelte';

  let ready = $state(false);
  let route: LocalRoute | null = $state(null);

  // iOS in the browser: onboarding starts with "Add to Home Screen", because the installed app has its own
  // storage and is the only place web push works (docs/architecture.md §6).
  let installFirst = $state(false);

  $effect(() => {
    void Promise.all([load('lang'), load('route'), load('installSkipped')]).then(
      ([lang, stored, skipped]) => {
        if (isLang(lang)) locale.lang = lang;
        const checked = validateLocalRoute(stored);
        route = checked.ok ? checked.value : null;
        installFirst = install.platform === 'ios' && !install.standalone && !route && skipped !== true;
        if (!nav.route || (!route && (nav.route === 'today' || nav.route === 'hours')))
          go(route ? 'today' : installFirst ? 'install' : 'setup');
        else if (nav.route === 'setup' && installFirst) go('install');
        ready = true;
      },
    );
  });

  function skipInstall() {
    installFirst = false;
    void save('installSkipped', true).catch(() => {});
    go('setup');
  }

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
  {#if nav.route === 'install' && installFirst}
    <Install onskip={skipInstall} />
  {:else if nav.route === 'privacy'}
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
