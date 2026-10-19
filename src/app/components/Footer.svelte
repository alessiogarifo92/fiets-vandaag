<script lang="ts">
  import { LANGS } from '../../core/validate';
  import { locale, setLang, tr } from '../lib/i18n.svelte';

  const names = { en: 'English', nl: 'Nederlands', it: 'Italiano' } as const;
</script>

<footer>
  <div class="langs" role="group" aria-label={tr('lang.label')}>
    {#each LANGS as l (l)}
      <button
        type="button"
        lang={l}
        aria-label={names[l]}
        aria-pressed={locale.lang === l}
        onclick={() => setLang(l)}>{l.toUpperCase()}</button
      >
    {/each}
  </div>
  <nav class="links">
    <a href="#/privacy">{tr('nav.privacy')}</a>
    <a href="#/about">{tr('nav.about')}</a>
  </nav>
</footer>

<style>
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .langs {
    display: flex;
    gap: 4px;
  }

  button {
    min-width: 44px;
    min-height: 44px;
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--reed);
    font: 500 13px/1 var(--font-ui);
    cursor: pointer;
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out);
  }

  button[aria-pressed='true'] {
    background: var(--card);
    border-color: var(--line-strong);
    color: var(--ink);
  }

  .links {
    display: flex;
    gap: 16px;
    font-size: 14px;
  }

  .links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>
