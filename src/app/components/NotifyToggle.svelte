<script lang="ts">
  import { tr } from '../lib/i18n.svelte';
  import { currentPushEnv, pushAvailability } from '../lib/platform';
  import { disablePush, enablePush, readPushState, type PushState } from '../lib/push';

  // On iOS the toggle exists only in the installed app; the browser gets the Install screen instead.
  const available = pushAvailability(currentPushEnv()) === 'available';

  let pushState = $state<PushState>('off');
  let busy = $state(false);
  let failed = $state(false);

  $effect(() => {
    if (available) void readPushState().then((s) => (pushState = s));
  });

  // Permission is asked here, from the tap, never on load.
  async function toggle() {
    busy = true;
    failed = false;
    try {
      pushState = pushState === 'on' ? await disablePush() : await enablePush();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
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
    {#if pushState === 'denied'}
      <p class="status" role="status">{tr('notify.denied')}</p>
    {:else if failed}
      <p class="status" role="alert">{tr('notify.error')}</p>
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
