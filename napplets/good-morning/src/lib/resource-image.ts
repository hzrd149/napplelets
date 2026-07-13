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

function browserFallback(source: string): string | null {
  try {
    const protocol = new URL(source).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' ? source : null;
  } catch {
    return null;
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

    const fallback = browserFallback(nextSource);
    setResolvedSource(fallback);
    const requestToken = token;
    void Promise.resolve(resourceBytesAsObjectURL(nextSource))
      .then((handle) => {
        if (requestToken !== token) {
          handle.revoke();
          return;
        }
        clearObjectUrl();
        objectUrl = handle.url;
        setResolvedSource(handle.url);
      })
      .catch(() => {
        if (requestToken === token) setResolvedSource(fallback);
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
