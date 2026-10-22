<script lang="ts">
  import type { MessageKey } from '../../core/i18n';
  import { formatMinutes } from '../../core/time';
  import type { CommuteWindow } from '../../core/validate';
  import { ApiError, defaultNotifyAt, NOTIFY_TIMES, syncRoute } from '../lib/device';
  import { locale, tr } from '../lib/i18n.svelte';
  import { currentPushEnv, pushAvailability } from '../lib/platform';
  import { disablePush, enablePush, readPushState, type PushState } from '../lib/push';
  import { load, remove, save } from '../lib/store';

  let { window }: { window: CommuteWindow } = $props();

  // On iOS the toggle exists only in the installed app; the browser gets the Install screen instead.
  const available = pushAvailability(currentPushEnv()) === 'available';

  let pushState = $state<PushState>('off');
  let busy = $state(false);
  let error = $state<MessageKey | null>(null);
  // The invite field shows until the device holds a code (from the invite link or typed here).
  let storedInvite = $state<string | null>(null);
  let invite = $state('');
  let notifyAt = $state<number | null>(null);
  const time = $derived(notifyAt ?? defaultNotifyAt(window));

  $effect(() => {
    if (!available) return;
    void Promise.all([readPushState(), load('invite'), load('notifyAt')]).then(([s, inv, at]) => {
      pushState = s;
      storedInvite = inv ?? null;
      notifyAt = at ?? null;
    });
  });

  function messageFor(err: unknown): MessageKey {
    if (err instanceof ApiError) {
      if (err.code === 'invite_missing') return 'notify.invite.missing';
      if (err.code === 'invite_invalid') return 'notify.invite.invalid';
      if (err.code === 'capacity') return 'notify.capacity';
    }
    return 'notify.error';
  }

  // Permission is asked here, from the tap, never on load.
  async function toggle() {
    busy = true;
    error = null;
    try {
      if (pushState === 'on') {
        pushState = await disablePush();
      } else {
        pushState = await enablePush({ invite: storedInvite ?? invite, lang: locale.lang });
        if (pushState === 'on') storedInvite = await load('invite').then((v) => v ?? null);
      }
    } catch (err) {
      error = messageFor(err);
      if (err instanceof ApiError && err.code === 'invite_invalid') {
        storedInvite = null;
        await remove('invite').catch(() => {});
      }
    } finally {
      busy = false;
    }
  }

  async function changeTime(event: Event) {
    notifyAt = Number((event.currentTarget as HTMLSelectElement).value);
    await save('notifyAt', notifyAt).catch(() => {});
    await syncRoute().catch(() => {});
  }
</script>

{#if available}
  <section class="card notify">
    <div class="row">
      <div>
        <h2 id="notify-title">{tr('notify.title')}</h2>
        <p>{tr('notify.body')}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={pushState === 'on'}
        aria-labelledby="notify-title"
        disabled={busy || pushState === 'denied'}
        onclick={toggle}
      >
        <span></span>
      </button>
    </div>
    {#if pushState !== 'on' && pushState !== 'denied' && !storedInvite}
      <label class="field">
        <span>{tr('notify.invite.label')}</span>
        <input
          type="text"
          bind:value={invite}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="128"
          aria-describedby="invite-hint"
        />
        <small id="invite-hint">{tr('notify.invite.hint')}</small>
      </label>
    {/if}
    {#if pushState === 'on'}
      <label class="field">
        <span>{tr('notify.time.label')}</span>
        <select value={time} onchange={changeTime} aria-describedby="notify-days">
          {#each NOTIFY_TIMES as m (m)}
            <option value={m}>{formatMinutes(m)}</option>
          {/each}
        </select>
        <small id="notify-days">{tr('notify.time.days')}</small>
      </label>
    {/if}
    {#if pushState === 'denied'}
      <p class="status" role="status">{tr('notify.denied')}</p>
    {:else if error}
      <p class="status" role="alert">{tr(error)}</p>
    {:else if pushState === 'on'}
      <p class="status" role="status">{tr('notify.on')}</p>
    {/if}
  </section>
{/if}

<style>
  .notify {
    margin-top: 20px;
    padding: 20px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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

  .status {
    margin-top: 12px;
    color: var(--ink);
  }

  .field {
    display: block;
    margin-top: 20px;
  }

  .field span {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  .field input,
  .field select {
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-input);
    background: var(--card);
    color: var(--ink);
    font: 400 16px/1.2 var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .field small {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: var(--reed);
  }

  /* 44 px tall hit area around a 28 px track. */
  button {
    flex: none;
    display: inline-flex;
    align-items: center;
    width: 56px;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  button span {
    position: relative;
    width: 52px;
    height: 30px;
    border-radius: var(--radius-pill);
    background: var(--line-strong);
    transition: background-color var(--dur-state) var(--ease-out);
  }

  button span::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--card);
    transition: transform var(--dur-state) var(--ease-out);
  }

  button[aria-checked='true'] span {
    background: var(--polder);
  }

  button[aria-checked='true'] span::after {
    transform: translateX(22px);
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
