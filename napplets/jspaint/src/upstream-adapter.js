import { fs, storage } from '@napplet/sdk';

const RECOVERY_KEY = 'jspaint.recovery.v1';
let fsInfoPromise;

const hasDomain = (name) => Boolean(window.napplet && window.napplet[name]);

function isCancelled(error) {
  return error instanceof Error && error.message === 'cancelled';
}

async function fsLimits() {
  if (!fsInfoPromise) fsInfoPromise = fs.info().then((info) => info.limits).catch(() => null);
  return fsInfoPromise;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readAll(path) {
  const chunks = [];
  let offset = 0;
  const limits = await fsLimits();
  const length = limits?.maxReadBytes > 0 ? limits.maxReadBytes : undefined;
  while (true) {
    const result = await fs.read(path, { offset, ...(length ? { length } : {}) });
    const chunk = base64ToBytes(result.data);
    chunks.push(chunk);
    offset += result.bytesRead;
    if (result.eof || result.bytesRead === 0) break;
  }
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return bytes;
}

async function remember(blob, name) {
  if (!hasDomain('storage')) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await storage.setItem(RECOVERY_KEY, JSON.stringify({
    name,
    type: blob.type || 'application/octet-stream',
    data: bytesToBase64(bytes),
  }));
}

async function recover() {
  if (!hasDomain('storage')) return null;
  const encoded = await storage.getItem(RECOVERY_KEY);
  if (!encoded) return null;
  const value = JSON.parse(encoded);
  const bytes = base64ToBytes(value.data);
  return new File([bytes], value.name || 'recovered.png', { type: value.type || 'image/png' });
}

function extensionOf(name) {
  const match = /\.([^.]+)$/.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

function formatForName(formats, name, fallback) {
  const extension = extensionOf(name);
  return formats.find((format) => format.extensions?.includes(extension)) ||
    formats.find((format) => format.formatID === fallback) || formats[0];
}

function acceptRules(formats) {
  return formats.flatMap((format) => (format.extensions || []).map((extension) => ({
    mime: format.mimeType || format.mime || 'application/octet-stream',
    extension: `.${extension}`,
  })));
}

async function writePath(path, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const limits = await fsLimits();
  const maxWrite = limits?.maxWriteBytes > 0 ? limits.maxWriteBytes : bytes.length;
  if (bytes.length <= maxWrite) {
    await fs.write(path, bytesToBase64(bytes), { mode: 'replace' });
    return;
  }
  await fs.write(path, bytesToBase64(bytes.subarray(0, maxWrite)), { mode: 'replace' });
  for (let offset = maxWrite; offset < bytes.length; offset += maxWrite) {
    await fs.write(path, bytesToBase64(bytes.subarray(offset, offset + maxWrite)), { mode: 'append' });
  }
}

window.systemHooks = {
  ...(window.systemHooks || {}),

  async showSaveFileDialog(options) {
    const fallbackName = options.defaultFileName || 'untitled.png';
    try {
      if (!hasDomain('fs')) throw new Error('NAP-FS is unavailable');
      const picked = await fs.pickSaveFile({
        suggestedName: fallbackName,
        description: options.dialogTitle || 'Save image',
        permissions: ['write', 'create'],
        accept: acceptRules(options.formats),
      });
      const entry = picked.entries[0];
      if (!entry) return;
      const format = formatForName(options.formats, entry.name, options.defaultFileFormatID);
      const blob = await options.getBlob(format?.formatID);
      await writePath(entry.path, blob);
      await remember(blob, entry.name).catch(() => undefined);
      options.savedCallbackUnreliable?.({
        newFileName: entry.name,
        newFileFormatID: format?.formatID,
        newFileHandle: { path: entry.path, name: entry.name },
        newBlob: blob,
      });
    } catch (error) {
      // Like Notepad's picker, dismissal is a decision rather than a failed
      // save. Do not replace it with an unexpected recovery-store write.
      if (isCancelled(error)) return;
      const format = formatForName(options.formats, fallbackName, options.defaultFileFormatID);
      const blob = await options.getBlob(format?.formatID);
      await remember(blob, fallbackName);
      options.savedCallbackUnreliable?.({
        newFileName: fallbackName,
        newFileFormatID: format?.formatID,
        newFileHandle: null,
        newBlob: blob,
      });
      console.warn('JS Paint saved a recovery copy with NAP-STORAGE.', error);
    }
  },

  async showOpenFileDialog({ formats }) {
    try {
      if (!hasDomain('fs')) throw new Error('NAP-FS is unavailable');
      const picked = await fs.pickFile({
        description: 'Open image',
        permissions: ['read'],
        accept: acceptRules(formats),
      });
      const entry = picked.entries[0];
      if (!entry) throw new Error('No file selected');
      const bytes = await readAll(entry.path);
      const format = formatForName(formats, entry.name);
      const file = new File([bytes], entry.name, { type: format?.mimeType || format?.mime || 'application/octet-stream' });
      return { file, fileHandle: { path: entry.path, name: entry.name } };
    } catch (error) {
      // NAP-FS models picker cancellation as the `cancelled` error code. Keep
      // it distinct from an unavailable/failed filesystem, which is what
      // activates recovery loading.
      if (isCancelled(error)) throw error;
      const file = await recover();
      if (file) {
        console.warn('JS Paint restored its NAP-STORAGE recovery copy.', error);
        return { file };
      }
      throw error;
    }
  },

  async writeBlobToHandle(handle, blob) {
    try {
      if (!handle?.path || !hasDomain('fs')) throw new Error('NAP-FS handle is unavailable');
      await writePath(handle.path, blob);
      await remember(blob, handle.name || 'untitled.png').catch(() => undefined);
      return true;
    } catch (error) {
      await remember(blob, handle?.name || 'untitled.png');
      console.warn('JS Paint saved a recovery copy with NAP-STORAGE.', error);
      return true;
    }
  },

  async readBlobFromHandle(handle) {
    if (handle?.path && hasDomain('fs')) {
      const bytes = await readAll(handle.path);
      return new File([bytes], handle.name || 'image', { type: 'application/octet-stream' });
    }
    return recover();
  },
};
