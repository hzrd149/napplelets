import '@napplelets/theme-dsui/styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import {
  fs,
  type FsDirectoryEntry,
  type FsInfo,
  type FsMetadata,
  type FsRoot,
  type Subscription,
} from '@napplet/sdk';
import {
  ArrowUp,
  ChevronRight,
  File,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Pencil,
  RefreshCw,
  Trash2,
  createElement as createLucideElement,
  type IconNode,
} from 'lucide';
import './styles.css';
import {
  IMAGE_PREVIEW_BYTES,
  TEXT_PREVIEW_BYTES,
  base64ToBytes,
  formatBytes,
  formatDate,
  isDescendantPath,
  joinPath,
  parentPath,
  previewKind,
  sortEntries,
  validateEntryName,
} from './fs-utils';

type NameAction = 'folder' | 'file' | 'rename';
type StatusKind = 'idle' | 'busy' | 'ok' | 'error';

const themeHandle = installThemeClient();
const elements = {
  back: required<HTMLButtonElement>('#backButton'),
  breadcrumbs: required<HTMLElement>('#breadcrumbs'),
  refresh: required<HTMLButtonElement>('#refreshButton'),
  newFolder: required<HTMLButtonElement>('#newFolderButton'),
  newFile: required<HTMLButtonElement>('#newFileButton'),
  selectionLabel: required<HTMLOutputElement>('#selectionLabel'),
  rename: required<HTMLButtonElement>('#renameButton'),
  move: required<HTMLButtonElement>('#moveButton'),
  delete: required<HTMLButtonElement>('#deleteButton'),
  entries: required<HTMLElement>('#entries'),
  empty: required<HTMLElement>('#emptyState'),
  preview: required<HTMLElement>('#preview'),
  status: required<HTMLOutputElement>('#status'),
  nameDialog: required<HTMLDialogElement>('#nameDialog'),
  nameTitle: required<HTMLElement>('#nameDialogTitle'),
  nameLabel: required<HTMLElement>('#nameDialogLabel'),
  nameInput: required<HTMLInputElement>('#nameInput'),
  nameError: required<HTMLElement>('#nameError'),
  nameCancel: required<HTMLButtonElement>('#nameCancel'),
  nameConfirm: required<HTMLButtonElement>('#nameConfirm'),
  moveDialog: required<HTMLDialogElement>('#moveDialog'),
  moveBreadcrumbs: required<HTMLElement>('#moveBreadcrumbs'),
  moveEntries: required<HTMLElement>('#moveEntries'),
  moveError: required<HTMLElement>('#moveError'),
  moveCancel: required<HTMLButtonElement>('#moveCancel'),
  moveConfirm: required<HTMLButtonElement>('#moveConfirm'),
  deleteDialog: required<HTMLDialogElement>('#deleteDialog'),
  deleteCancel: required<HTMLButtonElement>('#deleteCancel'),
  deleteConfirm: required<HTMLButtonElement>('#deleteConfirm'),
  deleteMessage: required<HTMLElement>('#deleteMessage'),
};

let info: FsInfo | null = null;
let currentRoot: FsRoot | null = null;
let currentPath: string | null = null;
let currentEntries: FsDirectoryEntry[] = [];
let selected = new Set<string>();
let busy = false;
let loadSequence = 0;
let previewSequence = 0;
let previewUrl: string | null = null;
let watchId: string | null = null;
let changeSubscription: Subscription | null = null;
let refreshTimer = 0;
let nameAction: NameAction = 'folder';
let movePath: string | null = null;

const DEBUG_PREFIX = '[file-browser]';

function debug(event: string, details?: unknown): void {
  if (details === undefined) console.log(DEBUG_PREFIX, event);
  else console.log(DEBUG_PREFIX, event, details);
}

function debugError(event: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(DEBUG_PREFIX, event, {
    ...details,
    error,
    message: errorMessage(error),
  });
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function icon(node: IconNode, className = 'icon'): SVGElement {
  return createLucideElement(node, {
    class: className,
    width: 16,
    height: 16,
    'aria-hidden': 'true',
  });
}

function installStaticIcons(): void {
  elements.back.replaceChildren(icon(ArrowUp));
  elements.refresh.replaceChildren(icon(RefreshCw));
  elements.newFolder.prepend(icon(FolderPlus));
  elements.newFile.prepend(icon(FilePlus2));
  elements.rename.replaceChildren(icon(Pencil));
  elements.move.replaceChildren(icon(FolderInput));
  elements.delete.replaceChildren(icon(Trash2));
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    'permission-denied': 'Permission denied by the filesystem.',
    'policy-denied': 'The shell policy denied this operation.',
    'not-found': 'That item no longer exists.',
    'already-exists': 'An item with that name already exists.',
    conflict: 'The item changed before the operation completed.',
    'too-large': 'The file is too large for this operation.',
    unsupported: 'This operation is not supported by the filesystem.',
    'quota-exceeded': 'The filesystem quota was exceeded.',
    cancelled: 'The operation was cancelled.',
    'io-error': 'The filesystem could not complete the operation.',
  };
  return labels[code] ?? code;
}

function setStatus(kind: StatusKind, message: string): void {
  elements.status.dataset.kind = kind;
  elements.status.textContent = message;
}

function showDialog(dialog: HTMLDialogElement, label: string): boolean {
  debug('dialog:open', { id: dialog.id, alreadyOpen: dialog.open });
  try {
    if (!dialog.open) dialog.showModal();
    debug('dialog:opened', { id: dialog.id, open: dialog.open });
    return true;
  } catch (error) {
    debugError('dialog:open-failed', error, { id: dialog.id });
    setStatus('error', `${label}: ${errorMessage(error)}`);
    return false;
  }
}

function setBusy(value: boolean): void {
  busy = value;
  document.documentElement.toggleAttribute('data-busy', value);
  updateActions();
}

function rootForPath(path: string): FsRoot | null {
  const roots = info?.roots ?? [];
  return roots
    .filter((root) => path === root.path || isDescendantPath(root.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

function updateActions(): void {
  const count = selected.size;
  elements.selectionLabel.textContent = count === 0 ? '' : `${count} selected`;
  elements.back.disabled = busy || !currentPath;
  elements.refresh.disabled = busy || !currentPath;
  // Discovery permissions are advisory, not authorization tokens. Keep the
  // actions available in a directory and surface the runtime's actual result.
  elements.newFolder.disabled = busy || !currentPath;
  elements.newFile.disabled = busy || !currentPath;
  elements.rename.disabled = busy || count !== 1;
  elements.move.disabled = busy || count === 0;
  elements.delete.disabled = busy || count === 0;
}

function revokePreview(): void {
  previewSequence += 1;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function makeButton(label: string, onClick: () => void, className = 'btn btn-ghost btn-sm', iconNode?: IconNode): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (iconNode) button.prepend(icon(iconNode));
  button.addEventListener('click', onClick);
  return button;
}

function renderBreadcrumbs(target: HTMLElement, path: string | null, navigate: (path: string | null) => void): void {
  target.replaceChildren();
  target.append(makeButton('Roots', () => navigate(null), 'crumb', HardDrive));
  if (!path) return;
  const root = rootForPath(path);
  if (!root) return;
  target.append(icon(ChevronRight, 'crumb-separator'));
  target.append(makeButton(root.name, () => navigate(root.path), 'crumb'));
  const relative = path.slice(root.path.length).split('/').filter(Boolean);
  let cursor = root.path;
  relative.forEach((part) => {
    cursor = joinPath(cursor, part);
    const destination = cursor;
    target.append(icon(ChevronRight, 'crumb-separator'));
    target.append(makeButton(part, () => navigate(destination), 'crumb'));
  });
}

function renderRoots(): void {
  currentEntries = [];
  selected.clear();
  revokePreview();
  elements.preview.innerHTML = '<p class="muted">Choose a visible root to begin.</p>';
  elements.entries.replaceChildren();
  for (const root of info?.roots ?? []) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'root-row';
    const name = document.createElement('strong');
    name.textContent = root.name;
    row.append(icon(HardDrive, 'entry-icon'), name);
    row.addEventListener('click', () => void navigate(root.path));
    elements.entries.append(row);
  }
  elements.empty.hidden = Boolean(info?.roots.length);
  elements.empty.textContent = 'No filesystem roots are visible to this napplet.';
  renderBreadcrumbs(elements.breadcrumbs, null, (path) => void navigate(path));
  updateActions();
}

function createEntryRow(entry: FsDirectoryEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.role = 'listitem';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'checkbox checkbox-sm';
  checkbox.checked = selected.has(entry.path);
  checkbox.setAttribute('aria-label', `Select ${entry.name}`);
  checkbox.addEventListener('change', () => {
    checkbox.checked ? selected.add(entry.path) : selected.delete(entry.path);
    updateActions();
  });
  const name = makeButton(entry.name, () => {
    if (entry.kind === 'directory') void navigate(entry.path);
    else void showPreview(entry);
  }, 'entry-name', entry.kind === 'directory' ? Folder : previewKind(entry.name).kind === 'image' ? FileImage : previewKind(entry.name).kind === 'text' ? FileText : File);
  const size = document.createElement('span');
  size.className = 'entry-meta size';
  size.textContent = entry.kind === 'directory' ? '—' : formatBytes(entry.size);
  const modified = document.createElement('span');
  modified.className = 'entry-meta modified';
  modified.textContent = formatDate(entry.modifiedAt);
  row.append(checkbox, name, size, modified);
  return row;
}

function renderEntries(): void {
  elements.entries.replaceChildren(...currentEntries.map(createEntryRow));
  elements.empty.hidden = currentEntries.length > 0;
  elements.empty.textContent = 'This folder is empty.';
  renderBreadcrumbs(elements.breadcrumbs, currentPath, (path) => void navigate(path));
  updateActions();
}

async function stopWatch(): Promise<void> {
  const id = watchId;
  watchId = null;
  if (id) await fs.unwatch(id).catch(() => undefined);
}

async function startWatch(path: string): Promise<void> {
  await stopWatch();
  if (!currentRoot?.permissions.includes('watch') || info?.limits.maxWatchCount === 0) return;
  try {
    watchId = await fs.watch(path);
  } catch {
    watchId = null;
  }
}

async function navigate(path: string | null): Promise<void> {
  const sequence = ++loadSequence;
  revokePreview();
  selected.clear();
  if (!path) {
    await stopWatch();
    currentPath = null;
    currentRoot = null;
    renderRoots();
    setStatus('idle', 'Choose a root');
    return;
  }
  currentRoot = rootForPath(path);
  currentPath = path;
  setStatus('busy', 'Loading…');
  updateActions();
  try {
    const entries = await fs.list(path);
    if (sequence !== loadSequence) return;
    currentEntries = sortEntries(entries);
    renderEntries();
    setStatus('ok', '');
    await startWatch(path);
  } catch (error) {
    if (sequence !== loadSequence) return;
    currentEntries = [];
    renderEntries();
    elements.empty.hidden = false;
    elements.empty.textContent = errorMessage(error);
    setStatus('error', errorMessage(error));
  }
}

async function refresh(): Promise<void> {
  if (currentPath) await navigate(currentPath);
  else renderRoots();
}

async function showPreview(entry: FsDirectoryEntry): Promise<void> {
  revokePreview();
  const sequence = previewSequence;
  elements.preview.innerHTML = '<p class="muted">Loading preview…</p>';
  try {
    const metadata = await fs.stat(entry.path);
    if (sequence !== previewSequence) return;
    await renderPreview(entry, metadata, sequence);
  } catch (error) {
    if (sequence === previewSequence) renderMetadata(entry, null, errorMessage(error));
  }
}

function metadataFragment(entry: FsDirectoryEntry, metadata: FsMetadata | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const heading = document.createElement('h2');
  heading.textContent = entry.name;
  const list = document.createElement('dl');
  list.className = 'metadata';
  const rows: Array<[string, string]> = [
    ['Type', metadata?.kind ?? entry.kind],
    ['Size', formatBytes(metadata?.size ?? entry.size)],
    ['Modified', formatDate(metadata?.modifiedAt ?? entry.modifiedAt)],
    ['Created', formatDate(metadata?.createdAt)],
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value;
    list.append(dt, dd);
  }
  fragment.append(heading, list);
  return fragment;
}

function renderMetadata(entry: FsDirectoryEntry, metadata: FsMetadata | null, note?: string): void {
  elements.preview.replaceChildren(metadataFragment(entry, metadata));
  if (note) {
    const paragraph = document.createElement('p');
    paragraph.className = 'muted'; paragraph.textContent = note;
    elements.preview.append(paragraph);
  }
}

async function renderPreview(entry: FsDirectoryEntry, metadata: FsMetadata, sequence: number): Promise<void> {
  const kind = previewKind(entry.name);
  const maxRead = info?.limits.maxReadBytes ?? 0;
  if (kind.kind === 'none') {
    renderMetadata(entry, metadata, 'No preview');
    return;
  }
  const cap = kind.kind === 'text' ? TEXT_PREVIEW_BYTES : IMAGE_PREVIEW_BYTES;
  if (kind.kind === 'image' && metadata.size !== undefined && metadata.size > Math.min(cap, maxRead)) {
    renderMetadata(entry, metadata, 'Image exceeds the safe preview limit.');
    return;
  }
  const length = Math.min(cap, maxRead);
  if (length <= 0) {
    renderMetadata(entry, metadata, 'The runtime does not allow preview reads.');
    return;
  }
  const result = await fs.read(entry.path, { offset: 0, length });
  if (sequence !== previewSequence) return;
  const bytes = base64ToBytes(result.data);
  elements.preview.replaceChildren(metadataFragment(entry, metadata));
  if (kind.kind === 'text') {
    const pre = document.createElement('pre');
    pre.className = 'text-preview';
    pre.dataset.nappletSelect = 'text';
    pre.textContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    elements.preview.append(pre);
    if (!result.eof) {
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Preview truncated at 256 KiB.';
      elements.preview.append(note);
    }
  } else if (!result.eof) {
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'The complete image exceeds the safe preview limit.';
    elements.preview.append(note);
  } else {
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: kind.mime }));
    const image = document.createElement('img'); image.className = 'image-preview'; image.alt = `Preview of ${entry.name}`; image.src = previewUrl;
    elements.preview.append(image);
  }
}

function selectedEntries(): FsDirectoryEntry[] {
  return currentEntries.filter((entry) => selected.has(entry.path));
}

function openNameDialog(action: NameAction): void {
  debug('create-dialog:requested', {
    action,
    currentPath,
    root: currentRoot?.name ?? null,
    advertisedPermissions: currentRoot?.permissions ?? [],
  });
  nameAction = action;
  const current = action === 'rename' ? selectedEntries()[0]?.name ?? '' : action === 'file' ? 'untitled.txt' : '';
  elements.nameTitle.textContent = action === 'folder' ? 'New folder' : action === 'file' ? 'New text file' : 'Rename item';
  elements.nameLabel.textContent = action === 'rename' ? 'New name' : 'Name';
  elements.nameConfirm.textContent = action === 'rename' ? 'Rename' : 'Create';
  elements.nameInput.value = current;
  elements.nameError.textContent = '';
  if (!showDialog(elements.nameDialog, 'Could not open form')) return;
  elements.nameInput.focus();
  elements.nameInput.select();
}

async function submitName(): Promise<void> {
  if (!currentPath) {
    debugError('create-dialog:no-current-path', new Error('No directory is selected'), { action: nameAction });
    setStatus('error', 'Choose a folder before creating an item.');
    return;
  }
  const name = elements.nameInput.value;
  const validation = validateEntryName(name);
  if (validation) {
    debug('create-dialog:invalid-name', { action: nameAction, name, validation });
    elements.nameError.textContent = validation;
    return;
  }
  setBusy(true);
  const destination = joinPath(currentPath, name);
  debug('fs:mutation:start', {
    action: nameAction,
    source: nameAction === 'rename' ? selectedEntries()[0]?.path ?? null : null,
    destination,
    root: currentRoot?.name ?? null,
    advertisedPermissions: currentRoot?.permissions ?? [],
  });
  try {
    if (nameAction === 'folder') await fs.mkdir(destination);
    else if (nameAction === 'file') await fs.write(destination, '', { mode: 'replace', ifAbsent: true });
    else {
      const entry = selectedEntries()[0];
      if (!entry) return;
      await fs.move(entry.path, destination);
    }
    debug('fs:mutation:success', { action: nameAction, destination });
    elements.nameDialog.close();
    setStatus('ok', nameAction === 'rename' ? 'Item renamed' : 'Item created');
    await refresh();
  } catch (error) {
    const message = errorMessage(error);
    debugError('fs:mutation:failed', error, { action: nameAction, destination });
    elements.nameError.textContent = message;
    setStatus('error', message);
  } finally { setBusy(false); }
}

function renderMoveRoots(): void {
  elements.moveEntries.replaceChildren();
  for (const root of info?.roots ?? []) {
    const button = makeButton(root.name, () => void loadMoveDirectory(root.path), 'move-row', HardDrive);
    elements.moveEntries.append(button);
  }
  renderBreadcrumbs(elements.moveBreadcrumbs, null, (path) => path ? void loadMoveDirectory(path) : renderMoveRoots());
  elements.moveConfirm.disabled = true;
}

async function loadMoveDirectory(path: string): Promise<void> {
  movePath = path;
  elements.moveError.textContent = '';
  elements.moveEntries.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const entries = sortEntries(await fs.list(path)).filter((entry) => entry.kind === 'directory');
    elements.moveEntries.replaceChildren(...entries.map((entry) => makeButton(entry.name, () => void loadMoveDirectory(entry.path), 'move-row', FolderOpen)));
    if (entries.length === 0) elements.moveEntries.innerHTML = '<p class="muted">No subfolders.</p>';
    renderBreadcrumbs(elements.moveBreadcrumbs, path, (destination) => destination ? void loadMoveDirectory(destination) : renderMoveRoots());
    elements.moveConfirm.disabled = false;
  } catch (error) { elements.moveError.textContent = errorMessage(error); }
}

async function moveSelected(): Promise<void> {
  if (!movePath) return;
  const entries = selectedEntries();
  const failures: string[] = [];
  setBusy(true);
  for (const entry of entries) {
    if (entry.path === movePath || (entry.kind === 'directory' && isDescendantPath(entry.path, movePath))) {
      failures.push(`${entry.name}: cannot move into itself`); continue;
    }
    const destination = joinPath(movePath, entry.name);
    if (destination === entry.path) { failures.push(`${entry.name}: already here`); continue; }
    try { await fs.move(entry.path, destination); selected.delete(entry.path); }
    catch (error) { failures.push(`${entry.name}: ${errorMessage(error)}`); }
  }
  const failedPaths = new Set(entries.filter((entry) => failures.some((failure) => failure.startsWith(`${entry.name}:`))).map((entry) => entry.path));
  elements.moveDialog.close();
  setBusy(false);
  await refresh();
  selected = new Set(currentEntries.filter((entry) => failedPaths.has(entry.path)).map((entry) => entry.path));
  renderEntries();
  setStatus(failures.length ? 'error' : 'ok', failures.length ? `${entries.length - failures.length} moved · ${failures.join('; ')}` : `${entries.length} moved`);
}

async function deleteSelected(): Promise<void> {
  const entries = selectedEntries();
  const failures: string[] = [];
  setBusy(true);
  for (const entry of entries) {
    try { await fs.remove(entry.path, entry.kind === 'directory'); selected.delete(entry.path); }
    catch (error) { failures.push(`${entry.name}: ${errorMessage(error)}`); }
  }
  const failedPaths = new Set(entries.filter((entry) => failures.some((failure) => failure.startsWith(`${entry.name}:`))).map((entry) => entry.path));
  elements.deleteDialog.close();
  setBusy(false);
  await refresh();
  selected = new Set(currentEntries.filter((entry) => failedPaths.has(entry.path)).map((entry) => entry.path));
  renderEntries();
  setStatus(failures.length ? 'error' : 'ok', failures.length ? `${entries.length - failures.length} deleted · ${failures.join('; ')}` : `${entries.length} deleted`);
}

function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 180);
}

elements.back.addEventListener('click', () => {
  if (!currentPath || !currentRoot) return;
  void navigate(currentPath === currentRoot.path ? null : parentPath(currentPath));
});
elements.refresh.addEventListener('click', () => void refresh());
elements.newFolder.addEventListener('click', () => openNameDialog('folder'));
elements.newFile.addEventListener('click', () => openNameDialog('file'));
elements.rename.addEventListener('click', () => openNameDialog('rename'));
elements.move.addEventListener('click', () => { movePath = null; elements.moveError.textContent = ''; renderMoveRoots(); showDialog(elements.moveDialog, 'Could not open move dialog'); });
elements.delete.addEventListener('click', () => {
  const entries = selectedEntries();
  elements.deleteMessage.textContent = `Delete ${entries.length} selected item${entries.length === 1 ? '' : 's'}: ${entries.slice(0, 4).map((entry) => entry.name).join(', ')}${entries.length > 4 ? '…' : ''}`;
  showDialog(elements.deleteDialog, 'Could not open delete dialog');
});
function submitNameFromDialog(): void {
  debug('create-dialog:confirm', { action: nameAction });
  void submitName();
}

elements.nameConfirm.addEventListener('click', submitNameFromDialog);
elements.nameInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  submitNameFromDialog();
});
elements.nameCancel.addEventListener('click', () => { debug('create-dialog:cancel', { action: nameAction }); elements.nameDialog.close(); });
elements.moveConfirm.addEventListener('click', () => void moveSelected());
elements.moveCancel.addEventListener('click', () => elements.moveDialog.close());
elements.deleteConfirm.addEventListener('click', () => void deleteSelected());
elements.deleteCancel.addEventListener('click', () => elements.deleteDialog.close());

window.addEventListener('beforeunload', () => {
  window.clearTimeout(refreshTimer);
  void stopWatch();
  changeSubscription?.close();
  themeHandle.close();
  revokePreview();
});

async function initialize(): Promise<void> {
  debug('initialize:start');
  setBusy(true);
  try {
    info = await fs.info();
    debug('initialize:fs-info', {
      roots: info.roots.map((root) => ({ name: root.name, path: root.path, permissions: root.permissions })),
      limits: info.limits,
    });
    changeSubscription = fs.onChanged((change) => { if (change.watchId === watchId) scheduleRefresh(); });
    renderRoots();
    setStatus('idle', 'Choose a root');
  } catch (error) {
    debugError('initialize:failed', error);
    elements.entries.replaceChildren();
    elements.empty.hidden = false;
    elements.empty.textContent = `Filesystem unavailable: ${errorMessage(error)}`;
    setStatus('error', 'Filesystem unavailable');
  } finally { setBusy(false); }
}

installStaticIcons();
void initialize();
