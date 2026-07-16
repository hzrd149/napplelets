<script lang="ts">
  import type { CapabilityReport } from '../lib/nap-capabilities';

  interface Props {
    report: CapabilityReport;
    /**
     * 'screen' — a full-surface diagnostic shown when an ESSENTIAL NAP is gone
     * (the inbox cannot mount). 'banner' — a compact, dismissible strip shown
     * above a working inbox when only OPTIONAL NAPs are gone.
     */
    variant?: 'screen' | 'banner';
  }

  let { report, variant = 'screen' }: Props = $props();

  let dismissed = $state(false);

  const essential = $derived(report.missingEssential);
  const degraded = $derived(report.missingDegraded);
  const degradedLabels = $derived(degraded.map((nap) => nap.label).join(', '));
</script>

{#if variant === 'banner'}
  {#if !dismissed}
    <div
      class="alert alert-warning rounded-none border-x-0 border-t-0 py-2 text-xs font-mono flex-shrink-0"
      role="status"
      data-gm-nap-banner
      data-gm-missing-degraded={degraded.length}
    >
      <span class="font-semibold flex-shrink-0">⚠ limited runtime</span>
      <span class="truncate">
        {degradedLabels} unavailable — {degraded.length === 1
          ? 'that feature is'
          : 'those features are'}
        degraded.
      </span>
      <div class="flex-1"></div>
      <button
        type="button"
        class="btn btn-xs btn-ghost flex-shrink-0"
        onclick={() => (dismissed = true)}
        aria-label="Dismiss runtime warning"
      >
        dismiss
      </button>
    </div>
  {/if}
{:else}
  <div
    class="gm-nap-screen h-full w-full overflow-y-auto bg-base-100 text-base-content font-mono"
    role="alert"
    data-gm-nap-screen
    data-gm-missing-essential={essential.length}
  >
    <div class="max-w-lg mx-auto px-5 py-8">
      <div class="text-error text-sm font-semibold mb-1">⛔ Runtime missing NAP APIs</div>
      <h1 class="text-lg font-semibold mb-2">dsui-gm-proto can't start here</h1>
      <p class="text-base-content/70 text-sm leading-relaxed mb-2">
        This napplet needs host capabilities (NAPs) that the current runtime does not expose. It's a
        debugging napplet, so instead of failing silently it lists exactly what's missing.
      </p>

      <div class="text-base-content/60 text-xs uppercase tracking-wide mt-4 mb-2">
        Required — missing
      </div>
      <ul class="flex flex-col gap-2">
        {#each essential as nap (nap.domain)}
          <li
            class="card card-border border-error/40 bg-error/5"
            data-gm-missing-nap={nap.domain}
            data-gm-nap-severity="essential"
          >
            <div class="card-body p-3">
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-error badge-outline badge-xs uppercase tracking-wide">
                  required
                </span>
                <code class="text-sm text-base-content font-semibold">{nap.label}</code>
              </div>
              <p class="text-base-content/70 text-xs leading-relaxed">{nap.purpose}</p>
            </div>
          </li>
        {/each}
      </ul>

      {#if degraded.length > 0}
        <details class="mt-4" data-gm-degraded-details>
          <summary class="text-base-content/60 text-xs cursor-pointer hover:text-base-content">
            {degraded.length} optional NAP{degraded.length === 1 ? '' : 's'} also unavailable
          </summary>
          <ul class="flex flex-col gap-2 mt-2">
            {#each degraded as nap (nap.domain)}
              <li
                class="card card-border border-base-300"
                data-gm-missing-nap={nap.domain}
                data-gm-nap-severity="degraded"
              >
                <div class="card-body p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="badge badge-warning badge-outline badge-xs uppercase tracking-wide"
                    >
                      optional
                    </span>
                    <code class="text-sm text-base-content font-semibold">{nap.label}</code>
                  </div>
                  <p class="text-base-content/70 text-xs leading-relaxed">{nap.purpose}</p>
                </div>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
  </div>
{/if}
