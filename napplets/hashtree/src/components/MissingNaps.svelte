<script lang="ts">
  import type { CapabilityReport } from '../lib/nap.js';

  interface Props {
    report: CapabilityReport;
    limitsWarning: string | null;
  }

  const { report, limitsWarning }: Props = $props();

  let dismissed = $state(false);
  const degraded = $derived(report.missingDegraded);
</script>

{#if report.missingEssential.length > 0}
  <div class="alert alert-error nap-alert" role="alert">
    <div class="nap-alert-body">
      <p class="font-semibold">This shell cannot run the hashtree browser.</p>
      <ul>
        {#each report.missingEssential as requirement (requirement.domain)}
          <li><span class="font-mono">{requirement.label}</span> — {requirement.purpose}</li>
        {/each}
      </ul>
    </div>
  </div>
{:else if limitsWarning !== null}
  <div class="alert alert-warning nap-alert" role="status">
    <p>{limitsWarning}</p>
  </div>
{:else if degraded.length > 0 && !dismissed}
  <div class="alert nap-alert" role="status">
    <div class="nap-alert-body">
      <p>
        Running with {degraded.length} optional shell feature{degraded.length === 1 ? '' : 's'}
        unavailable.
      </p>
      <ul>
        {#each degraded as requirement (requirement.domain)}
          <li><span class="font-mono">{requirement.label}</span> — {requirement.purpose}</li>
        {/each}
      </ul>
    </div>
    <button type="button" class="btn btn-ghost btn-xs" onclick={() => (dismissed = true)}>
      Dismiss
    </button>
  </div>
{/if}
