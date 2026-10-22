<script lang="ts">
  let { deg, label, inverted = false }: { deg: number; label: string; inverted?: boolean } = $props();
</script>

<!-- Up is the direction of travel; the arrow shows where the wind blows to. -->
<svg class:inverted viewBox="0 0 24 24" width="20" height="20" role="img" aria-label={label}>
  <g transform={`rotate(${deg} 12 12)`}>
    <path
      d="M12 19V5M6.5 10.5 12 5l5.5 5.5"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </g>
</svg>

<style>
  svg {
    flex: none;
    stroke: var(--polder);
  }

  .inverted {
    stroke: var(--card);
  }
</style>
