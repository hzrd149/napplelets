import { resourceBytesAsObjectURL } from '@napplet/sdk';

type ActionReturn<Parameter> = {
  update?(parameter: Parameter): void;
  destroy?(): void;
};

interface ResourceImageBatchOptions {
  source: string | null | undefined;
  chunkSize?: number;
}

type ResourceImageBatchParameter = string | null | undefined | ResourceImageBatchOptions;

/**
 * Handle shape returned by resourceBytesAsObjectURL. The SDK's published type
 * lists only { url, revoke }, but the shim attaches a non-enumerable `ready`
 * promise (documented as a "shim-specific extension" in the d.ts docstring) that
 * resolves with the object URL once the shell-side fetch completes. The `url`
 * field is "" until that resolves — so awaiting `ready` is the only way to
 * actually get bytes onto the <img>. Without this, the handle resolves
 * synchronously with an empty url and the image never loads.
 */
interface ResourceObjectUrlHandle {
  url: string;
  revoke(): void;
  ready?: Promise<string>;
}

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

function readSource(parameter: ResourceImageBatchParameter): string | null {
  if (typeof parameter === 'object' && parameter !== null && 'source' in parameter) {
    return normalizeSource(parameter.source);
  }
  return normalizeSource(parameter);
}

export function resourceImageBatch(
  node: HTMLImageElement,
  parameter: ResourceImageBatchParameter,
): ActionReturn<ResourceImageBatchParameter> {
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

  function setParameter(nextParameter: ResourceImageBatchParameter): void {
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

    // External bytes flow ONLY through NAP-RESOURCE. Do not set <img src> to
    // the raw URL — the sandboxed iframe has no network access, so a raw
    // https:// src would either fail or bypass the shell's resource policy.
    // Leave the src unset until the shell-resolved object URL is ready; on
    // failure, leave it unset so the caller's fallback UI (initials/alt) shows.
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
