<script lang="ts">
  import type { HourRow } from '../../core/timeline';
  import { formatMinutes } from '../../core/time';
  import { tr } from '../lib/i18n.svelte';

  let {
    rows,
    window,
    animate,
  }: { rows: HourRow[]; window: { start: number; end: number }; animate: boolean } = $props();

  // Headwind of 40 km/h fills the bar; tailwind shows as an empty bar.
  const windHeight = (head: number) => Math.min(100, (Math.max(0, head) / 40) * 100);
</script>

<section class="card timeline" aria-label={tr('timeline.title')}>
  <div class="head">
    <span class="title">{tr('timeline.title')}</span>
    <span class="meta">{formatMinutes(window.start)}–{formatMinutes(window.end)}</span>
  </div>
  <div
    class="cols"
    role="img"
    aria-label={tr('timeline.label', {
      start: formatMinutes(rows[0]?.minute ?? window.start),
      end: formatMinutes((rows.at(-1)?.minute ?? window.end) + 60),
    })}
  >
    {#each rows as row, i (row.minute)}
      <div class="col" class:in={row.inWindow}>
        <div class="bars">
          <span
            class="bar rain"
            class:grow={animate}
            style:height={`${Math.max(3, row.precipProb)}%`}
            style:animation-delay={`${i * 2 * 20}ms`}
          ></span>
          <span
            class="bar wind"
            class:grow={animate}
            style:height={`${Math.max(3, windHeight(row.head))}%`}
            style:animation-delay={`${(i * 2 + 1) * 20}ms`}
          ></span>
        </div>
        <span class="hour meta">{formatMinutes(row.minute)}</span>
      </div>
    {/each}
  </div>
  <div class="legend meta" aria-hidden="true">
    <span><i class="dot rain"></i>{tr('timeline.rain')}</span>
    <span><i class="dot wind"></i>{tr('timeline.wind')}</span>
  </div>
</section>

<style>
  .timeline {
    margin-top: 32px;
    padding: 20px;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .title {
    font-size: 14px;
    font-weight: 500;
  }

  .cols {
    display: flex;
    gap: 4px;
  }

  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-radius: 10px;
  }

  .col.in {
    background: var(--window);
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 88px;
  }

  .bar {
    width: 8px;
    border-radius: 4px 4px 2px 2px;
    transform-origin: bottom;
  }

  .bar.rain {
    background: var(--rain);
  }

  .bar.wind {
    background: var(--polder);
  }

  .grow {
    animation: grow var(--dur-enter) var(--ease-out) both;
  }

  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }

  .legend {
    display: flex;
    gap: 16px;
    margin-top: 12px;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 2px;
  }

  .dot.rain {
    background: var(--rain);
  }

  .dot.wind {
    background: var(--polder);
  }
</style>
