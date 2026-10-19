<script lang="ts">
  import { untrack } from 'svelte';
  import type { Suggestion } from '../../core/pdok';
  import type { Place } from '../../core/validate';
  import { lookupAddress, suggestAddresses } from '../lib/api';
  import { tr } from '../lib/i18n.svelte';

  let {
    id,
    label,
    value,
    onpick,
  }: { id: string; label: string; value: Place | null; onpick: (place: Place) => void } = $props();

  // The field owns its text after mount; `value` only seeds it.
  let query = $state(untrack(() => value?.label ?? ''));
  let items: Suggestion[] = $state([]);
  let active = $state(-1);
  let status: 'idle' | 'searching' | 'none' | 'error' = $state('idle');
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;

  function search(q: string) {
    clearTimeout(timer);
    ctrl?.abort();
    if (q.trim().length < 3) {
      items = [];
      open = false;
      status = 'idle';
      return;
    }
    timer = setTimeout(async () => {
      const mine = (ctrl = new AbortController());
      status = 'searching';
      try {
        const found = await suggestAddresses(q, mine.signal);
        if (mine.signal.aborted) return;
        items = found;
        active = -1;
        open = true;
        status = found.length ? 'idle' : 'none';
      } catch {
        if (!mine.signal.aborted) status = 'error';
      }
    }, 250);
  }

  async function pick(s: Suggestion) {
    open = false;
    query = s.label;
    status = 'searching';
    try {
      const place = await lookupAddress(s.id);
      status = 'idle';
      onpick(place);
    } catch {
      status = 'error';
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      active = (active + 1) % items.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = (active - 1 + items.length) % items.length;
      e.preventDefault();
    } else if (e.key === 'Enter' && active >= 0) {
      void pick(items[active]!);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      open = false;
    }
  }
</script>

<div class="field">
  <label for={id}>{label}</label>
  <input
    {id}
    type="text"
    role="combobox"
    autocomplete="off"
    autocapitalize="words"
    spellcheck="false"
    placeholder={tr('setup.address.placeholder')}
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={`${id}-list`}
    aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
    bind:value={query}
    oninput={() => search(query)}
    {onkeydown}
  />
  {#if open && items.length}
    <ul id={`${id}-list`} role="listbox" aria-label={label}>
      {#each items as item, i (item.id)}
        <li
          id={`${id}-opt-${i}`}
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => pick(item)}
          onkeydown={() => {}}
        >
          {item.label}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="status meta" aria-live="polite">
    {#if status === 'searching'}{tr('setup.address.searching')}
    {:else if status === 'none'}{tr('setup.address.none')}
    {:else if status === 'error'}{tr('setup.address.error')}
    {/if}
  </p>
</div>

<style>
  .field {
    position: relative;
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  input {
    width: 100%;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-input);
    background: var(--card);
    color: var(--ink);
    /* 16px keeps iOS from zooming into the field. */
    font: 400 16px/1.2 var(--font-ui);
  }

  input::placeholder {
    color: var(--reed);
  }

  ul {
    position: absolute;
    z-index: 2;
    left: 0;
    right: 0;
    margin: 4px 0 0;
    padding: 4px;
    list-style: none;
    background: var(--card);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-input);
    box-shadow: 0 8px 24px rgb(19 32 28 / 0.12);
  }

  li {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 15px;
    cursor: pointer;
  }

  li.active,
  li:hover {
    background: var(--window);
  }

  .status {
    min-height: 18px;
    margin: 6px 0 0;
  }
</style>
