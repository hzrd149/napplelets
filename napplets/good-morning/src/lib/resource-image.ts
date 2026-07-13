import { resourceBytesAsObjectURL } from '@napplet/sdk';

type ActionReturn<Parameter> = {
  update?(parameter: Parameter): void;
  destroy?(): void;
};

interface ResourceMediaBatchOptions {
  source: string | null | undefined;
  chunkSize?: number;
}

type ResourceMediaBatchParameter = string | null | undefined | ResourceMediaBatchOptions;

/**
 * Handle shape returned by resourceBytesAsObjectURL. The SDK's published type
 * lists only { url, revoke }, but the shim attaches a non-enumerable `ready`
 * promise (documented as a "shim-specific extension" in the d.ts docstring) that
 * resolves with the object URL once the shell-side fetch completes. The `url`
 * field is "" until that resolves — so awaiting `ready` is the only way to
 * actually get bytes onto the element. Without this, the handle resolves
 * synchronously with an empty url and the media never loads.
 */
interface ResourceObjectUrlHandle {
  url: string;
  revoke(): void;
  ready?: Promise<string>;
}

/** Element types that expose a settable `src` attribute. */
type MediaElement = HTMLImageElement | HTMLVideoElement;

const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function normalizeSource(source: string | null | undefined): string | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldUseResourceNap(source: string): boolean {
  if (!ABSOLUTE_SCHEME_RE.test(source)) return false;
  try {
    const protocol = new URL(source).protocol.toLowerCase();
    return protocol !== 'data:' && protocol !== 'blob:';
  } catch {
    return true;
  }
}

function readSource(parameter: ResourceMediaBatchParameter): string | null {
  if (typeof parameter === 'object' && parameter !== null && 'source' in parameter) {
    return normalizeSource(parameter.source);
  }
  return normalizeSource(parameter);
}

/**
 * Shared Svelte action body for routing external media bytes through NAP-RESOURCE.
 * Works for any element with a settable `src` attribute (<img>, <video>).
 */
function createResourceMediaAction(
  node: MediaElement,
  parameter: ResourceMediaBatchParameter,
): ActionReturn<ResourceMediaBatchParameter> {
  let currentSource: string | null = null;
  let objectUrl: string | null = null;
  let token = 0;

  function clearObjectUrl(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function setResolvedSource(source: string | null): void {
    if (source) node.src = source;
    else node.removeAttribute('src');
  }

  function setParameter(nextParameter: ResourceMediaBatchParameter): void {
    const nextSource = readSource(nextParameter);
    if (nextSource === currentSource) return;
    currentSource = nextSource;
    token++;
    clearObjectUrl();

    if (!nextSource) {
      setResolvedSource(null);
      return;
    }
    if (!shouldUseResourceNap(nextSource)) {
      setResolvedSource(nextSource);
      return;
    }

    // External bytes flow ONLY through NAP-RESOURCE. Do not set src to the raw
    // URL — the sandboxed iframe has no network access, so a raw https:// src
    // would either fail or bypass the shell's resource policy. Leave src unset
    // until the shell-resolved object URL is ready; on failure, leave it unset.
    setResolvedSource(null);
    const requestToken = token;
    // resourceBytesAsObjectURL returns synchronously with url:"" and a hidden
    // `ready` promise that resolves once the shell fetch completes. Await
    // `ready` — awaiting the handle itself resolves immediately with url:"".
    const handle = resourceBytesAsObjectURL(nextSource) as ResourceObjectUrlHandle;
    void handle.ready
      ?.then((resolvedUrl) => {
        if (requestToken !== token) {
          handle.revoke();
          return;
        }
        clearObjectUrl();
        objectUrl = resolvedUrl;
        setResolvedSource(resolvedUrl);
      })
      .catch(() => {
        if (requestToken === token) setResolvedSource(null);
      });
  }

  setParameter(parameter);

  return {
    update: setParameter,
    destroy() {
      token++;
      clearObjectUrl();
      node.removeAttribute('src');
    },
  };
}

/** Svelte action: route an <img>'s external src through NAP-RESOURCE. */
export function resourceImageBatch(
  node: HTMLImageElement,
  parameter: ResourceMediaBatchParameter,
): ActionReturn<ResourceMediaBatchParameter> {
  return createResourceMediaAction(node, parameter);
}

/** Svelte action: route a <video>'s external src through NAP-RESOURCE. */
export function resourceVideoBatch(
  node: HTMLVideoElement,
  parameter: ResourceMediaBatchParameter,
): ActionReturn<ResourceMediaBatchParameter> {
  return createResourceMediaAction(node, parameter);
}
