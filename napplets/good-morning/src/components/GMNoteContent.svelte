<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies
  // the GM napplet's navigation wiring (open a profile / reference / link).
  import { inc as ipc, link } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '@hyprgate/utils/nub-topics';
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';
  import { createGMReferenceOpenPayload, NOTE_VIEWER_OPEN_TOPIC } from '../lib/gm-actions';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
  }

  let { content, emojiTags = [], profileLabel }: Props = $props();
  const GM_RESOURCE_BATCH_SIZE = 10;

  function openProfile(pubkey: string): void {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  // NAP-LINK: route external links through the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openLink(url: string): Promise<boolean> {
    const result = await link.open(url);
    return result.status === 'opened';
  }

  function openReference(source: string): void {
    const payload = createGMReferenceOpenPayload(source);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }
</script>

<NoteContent
  {content}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  onReferenceClick={openReference}
  onOpenLink={openLink}
  resourceBatchSize={GM_RESOURCE_BATCH_SIZE}
  videoTitle="GM video"
/>
