import { resource } from '@napplet/sdk';
import { isNapDomainPresent } from './runtime-domain';

type ActionReturn<Parameter> = {
  update?(parameter: Parameter): void;
  destroy?(): void;
};

interface ResourceMediaBatchOptions {
  source: string | null | undefined;
  chunkSize?: number;
}

type ResourceMediaBatchParameter = string | null | undefined | ResourceMediaBatchOptions;

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
  let requestController: AbortController | null = null;
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
    requestController?.abort();
    requestController = null;
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
    if (!isNapDomainPresent('resource')) return;

    const requestToken = token;
    const controller = new AbortController();
    requestController = controller;
    let bytesPromise: Promise<Blob>;
    try {
      bytesPromise = resource.bytes(nextSource, { signal: controller.signal });
    } catch {
      requestController = null;
      return;
    }
    void bytesPromise
      .then((blob) => {
        if (requestToken !== token || controller.signal.aborted) return;
        const resolvedUrl = URL.createObjectURL(blob);
        if (requestToken !== token || controller.signal.aborted) {
          URL.revokeObjectURL(resolvedUrl);
          return;
        }
        clearObjectUrl();
        objectUrl = resolvedUrl;
        setResolvedSource(resolvedUrl);
      })
      .catch(() => {
        if (requestToken === token) setResolvedSource(null);
      })
      .finally(() => {
        if (requestController === controller) requestController = null;
      });
  }

  setParameter(parameter);

  return {
    update: setParameter,
    destroy() {
      token++;
      requestController?.abort();
      requestController = null;
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
