import '@napplelets/theme-dsui/styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import { identity, outbox, upload, type UploadResult, type UploadStatus } from '@napplet/sdk';
import './styles.css';
import { inspectCbz } from './lib/cbz';
import {
  CBZ_MIME_TYPE,
  COMIC_INFO_FIELDS,
  getFirstValue,
  missingRequiredFields,
  setFieldValue,
  type ComicInfoField,
  type ComicMetadata,
  type ParsedCbz,
  type UploadAsset,
} from './lib/comic';
import { buildAddress, buildComicEvent, buildDefaultContent } from './lib/event';
import { sha256Hex } from './lib/hash';

const themeHandle = installThemeClient();

interface AppState {
  file: File | null;
  fileBuffer: ArrayBuffer | null;
  parsed: ParsedCbz | null;
  metadata: ComicMetadata;
  content: string;
  coverObjectUrl: string | null;
  identityPubkey: string;
  busy: boolean;
  publishedEventId: string | null;
  step: number;
}

const state: AppState = {
  file: null,
  fileBuffer: null,
  parsed: null,
  metadata: {},
  content: '',
  coverObjectUrl: null,
  identityPubkey: '',
  busy: false,
  publishedEventId: null,
  step: 0,
};

const STEP_LABELS = ['Select', 'Required fields', 'Optional details', 'Cover', 'Publish'] as const;
const LAST_STEP = STEP_LABELS.length - 1;

const elements = {
  fileInput: requireElement<HTMLInputElement>('#fileInput'),
  dropZone: requireElement<HTMLElement>('#dropZone'),
  fileMeta: requireElement<HTMLElement>('#fileMeta'),
  coverPreview: requireElement<HTMLImageElement>('#coverPreview'),
  coverCaption: requireElement<HTMLElement>('#coverCaption'),
  form: requireElement<HTMLFormElement>('#metadataForm'),
  contentText: requireElement<HTMLTextAreaElement>('#contentText'),
  identityStatus: requireElement<HTMLOutputElement>('#identityStatus'),
  derivedSummary: requireElement<HTMLElement>('#derivedSummary'),
  publishButton: requireElement<HTMLButtonElement>('#publishButton'),
  statusLog: requireElement<HTMLOutputElement>('#statusLog'),
  stepLabel: requireElement<HTMLElement>('#stepLabel'),
  backButton: requireElement<HTMLButtonElement>('#backButton'),
  nextButton: requireElement<HTMLButtonElement>('#nextButton'),
  steps: [...document.querySelectorAll<HTMLElement>('.flow-step')],
  dots: [...document.querySelectorAll<HTMLElement>('[data-dot]')],
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

function setStatus(message: string): void {
  elements.statusLog.textContent = message;
}

function getFieldInput(field: ComicInfoField): HTMLInputElement | HTMLSelectElement | null {
  return document.getElementById(field) as HTMLInputElement | HTMLSelectElement | null;
}

function metadataFromForm(): ComicMetadata {
  const metadata: ComicMetadata = {};
  for (const field of COMIC_INFO_FIELDS) {
    const input = getFieldInput(field);
    if (!input) continue;
    setFieldValue(metadata, field, input.value);
  }
  return metadata;
}

function populateForm(metadata: ComicMetadata): void {
  for (const field of COMIC_INFO_FIELDS) {
    const input = getFieldInput(field);
    if (!input) continue;
    input.value = metadata[field]?.join(', ') ?? '';
  }
  elements.contentText.value = buildDefaultContent(metadata);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateDerivedSummary(): void {
  state.metadata = metadataFromForm();
  state.content = elements.contentText.value;
  const missing = missingRequiredFields(state.metadata);
  if (!state.file) elements.derivedSummary.textContent = 'Choose a CBZ to begin.';
  else if (!state.identityPubkey) elements.derivedSummary.textContent = 'Connect an identity to publish.';
  else if (missing.length > 0) elements.derivedSummary.textContent = `Required: ${missing.join(', ')}`;
  else elements.derivedSummary.textContent = `${getFirstValue(state.metadata, 'Series')} #${getFirstValue(state.metadata, 'Number')} is ready.`;
  elements.publishButton.disabled = state.busy || !state.file || !state.parsed || !state.identityPubkey || missing.length > 0;
  elements.publishButton.textContent = state.busy ? 'Publishing...' : 'Publish';
  updateStepUi();
}

function canLeaveStep(step: number): boolean {
  if (step === 0) return Boolean(state.file && state.parsed);
  if (step === 1) return missingRequiredFields(metadataFromForm()).length === 0;
  return true;
}

function setStep(step: number): void {
  state.step = Math.max(0, Math.min(LAST_STEP, step));
  updateStepUi();
}

function updateStepUi(): void {
  elements.stepLabel.textContent = STEP_LABELS[state.step];
  for (const step of elements.steps) step.hidden = Number(step.dataset.step) !== state.step;
  for (const dot of elements.dots) dot.classList.toggle('active', Number(dot.dataset.dot) <= state.step);
  elements.backButton.disabled = state.busy || state.step === 0;
  elements.nextButton.hidden = state.step === LAST_STEP;
  elements.nextButton.disabled = state.busy || !canLeaveStep(state.step);
}

function setCoverPreview(blob: Blob, caption: string): void {
  if (state.coverObjectUrl) URL.revokeObjectURL(state.coverObjectUrl);
  state.coverObjectUrl = URL.createObjectURL(blob);
  elements.coverPreview.src = state.coverObjectUrl;
  elements.coverPreview.hidden = false;
  elements.coverCaption.textContent = caption;
}

async function handleFile(file: File): Promise<void> {
  state.busy = true;
  updateDerivedSummary();
  setStatus('Reading CBZ...');

  try {
    const buffer = await file.arrayBuffer();
    const parsed = inspectCbz(buffer);
    state.file = file;
    state.fileBuffer = buffer;
    state.parsed = parsed;
    state.metadata = parsed.metadata;
    state.publishedEventId = null;
    populateForm(parsed.metadata);
    setCoverPreview(parsed.cover, 'Cover ready');
    elements.fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    setStatus(parsed.comicInfoFound ? 'Metadata found. Confirm the required fields.' : 'Add the required fields to continue.');
    setStep(1);
  } catch (error) {
    state.file = null;
    state.fileBuffer = null;
    state.parsed = null;
    setStatus(error instanceof Error ? error.message : 'Could not parse the selected CBZ.');
  } finally {
    state.busy = false;
    updateDerivedSummary();
  }
}

function readFileFromInput(): void {
  const file = elements.fileInput.files?.[0];
  if (file) void handleFile(file);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUploadComplete(result: UploadResult, label: string): Promise<UploadResult> {
  if (result.status === 'complete') return result;
  if (!result.ok || result.status === 'failed' || result.status === 'cancelled') return result;
  setStatus(`${label} upload started...`);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status: UploadStatus = await upload.status(result.uploadId);
    if (status.bytesTotal && status.bytesSent !== undefined) {
      setStatus(`${label} upload ${Math.round((status.bytesSent / status.bytesTotal) * 100)}%...`);
    }
    if (status.status === 'complete' || status.status === 'failed' || status.status === 'cancelled') return status;
    await wait(1000);
  }

  return { ...result, ok: false, status: 'failed', error: `${label} upload timed out.`, uploadId: result.uploadId, rail: result.rail };
}

async function createThumbnailBlob(cover: Blob): Promise<Blob> {
  const image = await loadImage(cover);
  const maxWidth = 512;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create thumbnail canvas.');
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode thumbnail.'));
    }, 'image/jpeg', 0.86);
  });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the cover image.'));
    };
    image.src = url;
  });
}

function requireCompleteUpload(result: UploadResult, label: string): UploadResult & { url: string } {
  if (!result.ok || result.status !== 'complete' || !result.url) {
    throw new Error(result.error || `${label} upload failed.`);
  }
  return result as UploadResult & { url: string };
}

async function uploadThumbnail(metadata: ComicMetadata, cover: Blob): Promise<UploadAsset & { sha256: string }> {
  setStatus('Generating thumbnail...');
  const thumbnail = await createThumbnailBlob(cover);
  const localHash = await sha256Hex(thumbnail);
  setStatus('Uploading thumbnail...');
  const initial = await upload.upload({
    data: thumbnail,
    filename: `${buildAddress(metadata)}-thumb.jpg`,
    mimeType: 'image/jpeg',
    caption: `Cover thumbnail for ${getFirstValue(metadata, 'Series')} #${getFirstValue(metadata, 'Number')}`,
  });
  const complete = requireCompleteUpload(await waitForUploadComplete(initial, 'Thumbnail'), 'Thumbnail');
  return { url: complete.url, sha256: complete.sha256 ?? localHash, size: complete.size, mimeType: complete.mimeType };
}

async function uploadCbz(file: File, fileBuffer: ArrayBuffer, metadata: ComicMetadata): Promise<UploadAsset & { sha256: string; size: number }> {
  const localHash = await sha256Hex(fileBuffer);
  setStatus('Uploading CBZ archive...');
  const initial = await upload.upload({
    data: file,
    filename: file.name,
    mimeType: CBZ_MIME_TYPE,
    noTransform: true,
    caption: `${getFirstValue(metadata, 'Series')} #${getFirstValue(metadata, 'Number')}`,
  });
  const complete = requireCompleteUpload(await waitForUploadComplete(initial, 'CBZ'), 'CBZ');
  return {
    url: complete.url,
    sha256: complete.sha256 ?? localHash,
    size: complete.size ?? file.size,
    mimeType: complete.mimeType,
    fallbackUrls: complete.fallbackUrls,
  };
}

async function publishComic(): Promise<void> {
  state.metadata = metadataFromForm();
  state.content = elements.contentText.value;
  const missing = missingRequiredFields(state.metadata);
  if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(', ')}`);
  if (!state.file || !state.fileBuffer || !state.parsed) throw new Error('Select a valid CBZ first.');
  if (!state.identityPubkey) throw new Error('Connect an identity in the shell before publishing.');

  state.busy = true;
  updateDerivedSummary();
  try {
    const thumbnail = await uploadThumbnail(state.metadata, state.parsed.cover);
    const cbz = await uploadCbz(state.file, state.fileBuffer, state.metadata);
    const event = buildComicEvent({ metadata: state.metadata, content: state.content, cbz, thumbnail });
    setStatus('Publishing comic event...');
    const result = await outbox.publish(event);
    if (!result.ok || !result.eventId) throw new Error(result.error ?? 'Publish failed.');
    state.publishedEventId = result.eventId;
    setStatus('Published.');
  } finally {
    state.busy = false;
    updateDerivedSummary();
  }
}

async function initializeIdentity(): Promise<void> {
  try {
    const pubkey = await identity.getPublicKey();
    state.identityPubkey = pubkey;
    elements.identityStatus.textContent = pubkey ? 'Identity connected' : 'No identity';
    identity.onChanged((nextPubkey) => {
      state.identityPubkey = nextPubkey;
      elements.identityStatus.textContent = nextPubkey ? 'Identity connected' : 'No identity';
      updateDerivedSummary();
    });
  } catch (error) {
    elements.identityStatus.textContent = 'Identity unavailable';
    setStatus(error instanceof Error ? error.message : 'Identity unavailable.');
  } finally {
    updateDerivedSummary();
  }
}

elements.fileInput.addEventListener('change', readFileFromInput);
elements.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.dropZone.classList.add('dragging');
});
elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove('dragging');
  const file = event.dataTransfer?.files[0];
  if (file) void handleFile(file);
});
elements.form.addEventListener('input', () => {
  state.metadata = metadataFromForm();
  if (!elements.contentText.value.trim()) elements.contentText.value = buildDefaultContent(state.metadata);
  updateDerivedSummary();
});
elements.contentText.addEventListener('input', updateDerivedSummary);
elements.backButton.addEventListener('click', () => setStep(state.step - 1));
elements.nextButton.addEventListener('click', () => {
  if (!canLeaveStep(state.step)) {
    const missing = missingRequiredFields(metadataFromForm());
    setStatus(missing.length > 0 ? `Add ${missing.join(', ')} to continue.` : 'Choose a CBZ to continue.');
    return;
  }
  setStep(state.step + 1);
});
elements.publishButton.addEventListener('click', () => {
  publishComic().catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Publish failed.'));
});

window.addEventListener('beforeunload', () => {
  if (state.coverObjectUrl) URL.revokeObjectURL(state.coverObjectUrl);
  themeHandle.close();
});

void initializeIdentity();
