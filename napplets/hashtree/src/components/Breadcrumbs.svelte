<script lang="ts">
  interface Props {
    path: readonly string[];
    rootLabel: string;
    busy: boolean;
    onNavigate: (path: string[]) => void;
  }

  const { path, rootLabel, busy, onNavigate }: Props = $props();
</script>

<nav class="crumbs" aria-label="Location">
  <button
    type="button"
    class="crumb"
    disabled={path.length === 0}
    onclick={() => onNavigate([])}
    title={rootLabel}
  >
    {rootLabel}
  </button>
  {#each path as segment, index (index)}
    <span class="crumb-sep" aria-hidden="true">/</span>
    <button
      type="button"
      class="crumb"
      disabled={index === path.length - 1}
      onclick={() => onNavigate(path.slice(0, index + 1))}
    >
      {segment}
    </button>
  {/each}
  {#if busy}
    <span class="loading loading-spinner loading-xs crumb-busy" aria-label="Loading"></span>
  {/if}
</nav>
