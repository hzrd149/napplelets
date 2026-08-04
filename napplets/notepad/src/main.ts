/**
 * Notepad — a Windows XP text editor over NAP-FS.
 *
 * The shell owns the filesystem: this napplet only ever sees virtual absolute
 * paths, coarse metadata, and advisory change events. Nothing here may infer
 * anything about the host filesystem.
 *
 * Structure: runtime surface, then the two modals (message box and file
 * browser), then the menu machinery, then the document actions, then wiring.
 */

import {
  config,
  fs,
  incOn,
  storageGetItem,
  storageSetItem,
  type FsDirectoryEntry,
  type FsInfo,
  type FsMetadata,
  type Subscription,
} from '@napplet/sdk';
import {
  document as documentIcon,
  error32,
  folder,
  help,
  notepad32,
  up,
} from '@napplelets/theme-xp/icons';

import './styles.css';
import { describeFsError, isCancelled, isConflict } from './lib/fs-errors';
import {
  ARCHETYPE,
  CONVENTIONS,
  isProblem,
  parseOpenIntent,
  type ParsedIntent,
} from './lib/intent';
import {
  basename,
  formatBytes,
  formatDate,
  isTextFileName,
  joinPath,
  parentPath,
  sortEntries,
  validateFileName,
} from './lib/paths';
import {
  DEFAULT_SESSION,
  SESSION_KEY,
  parseSession,
  serializeSession,
  type Session,
} from './lib/session';
import {
  DEFAULT_EOL,
  MAX_OPEN_BYTES,
  base64ToBytes,
  buildLineIndex,
  bytesToBase64,
  concatBytes,
  decodeText,
  encodeText,
  findNext,
  indexOfLine,
  lineColFromIndex,
  replaceAll,
  type Eol,
} from './lib/text';

/* ── Runtime surface ─────────────────────────────────────────────────────
 * Every domain is feature-checked. A shell may hand us fewer domains than the
 * manifest asks for, and the editor still has to work as a text box.
 */
const shell = (globalThis as { napplet?: Record<string, unknown> }).napplet;
const has = (domain: string): boolean => Boolean(shell?.[domain]);

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const ui = {
  window: el<HTMLDivElement>('mainWindow'),
  title: el<HTMLDivElement>('windowTitle'),
  editor: el<HTMLTextAreaElement>('editor'),
  menuBar: el<HTMLDivElement>('menuBar'),
  menuWordWrap: el<HTMLLIElement>('menuWordWrap'),
  menuGoTo: el<HTMLLIElement>('menuGoTo'),
  statusState: el<HTMLParagraphElement>('statusState'),
  statusPos: el<HTMLParagraphElement>('statusPos'),
  statusSize: el<HTMLParagraphElement>('statusSize'),
  closeButton: el<HTMLButtonElement>('closeButton'),

  modalLayer: el<HTMLDivElement>('modalLayer'),
  dialog: el<HTMLDivElement>('dialog'),
  dialogTitle: el<HTMLDivElement>('dialogTitle'),
  dialogIcon: el<HTMLDivElement>('dialogIcon'),
  dialogMessage: el<HTMLParagraphElement>('dialogMessage'),
  dialogFields: el<HTMLDivElement>('dialogFields'),
  dialogNote: el<HTMLParagraphElement>('dialogNote'),
  dialogButtons: el<HTMLDivElement>('dialogButtons'),
  dialogClose: el<HTMLButtonElement>('dialogClose'),

  fileLayer: el<HTMLDivElement>('fileLayer'),
  fileDialog: el<HTMLDivElement>('fileDialog'),
  fileDialogTitle: el<HTMLDivElement>('fileDialogTitle'),
  fileDialogClose: el<HTMLButtonElement>('fileDialogClose'),
  fileLookIn: el<HTMLSelectElement>('fileLookIn'),
  fileUp: el<HTMLButtonElement>('fileUp'),
  fileUpIcon: el<HTMLSpanElement>('fileUpIcon'),
  fileList: el<HTMLUListElement>('fileList'),
  fileNote: el<HTMLParagraphElement>('fileNote'),
  fileNameInput: el<HTMLInputElement>('fileNameInput'),
  fileTypeSelect: el<HTMLSelectElement>('fileTypeSelect'),
  fileBrowse: el<HTMLButtonElement>('fileBrowse'),
  fileAccept: el<HTMLButtonElement>('fileAccept'),
  fileCancel: el<HTMLButtonElement>('fileCancel'),
};

/** The open document. `path === null` is an untitled buffer. */
const doc = {
  path: null as string | null,
  eol: DEFAULT_EOL as Eol,
  bom: false,
  dirty: false,
  /** Opaque write precondition from the last stat. Drives conflict detection. */
  revision: undefined as string | undefined,
  size: undefined as number | undefined,
  modifiedAt: undefined as number | undefined,
  /** Set when a watch event showed the file changed underneath us. */
  staleOnDisk: false,
};

const state = {
  wordWrap: true,
  lastDir: null as string | null,
  /** Set when the buffer was too large for storage, so the status bar can say so. */
  sessionTooLarge: false,
  busy: false,
};

let info: FsInfo | null = null;
let lineOffsets: number[] = [0];

/**
 * Whether a document operation (new/open/save/reload) is running.
 *
 * Saves are not atomic: a buffer larger than `maxWriteBytes` is written as a
 * truncating first chunk followed by appends, so a second save starting
 * mid-flight would interleave its truncate with the first one's appends and
 * leave a mangled file. Guards the user-facing entry points; the internal
 * nested calls (conflict retry, save-before-discard) run inside the lock.
 */
let documentOperationInFlight = false;

/* ── Status bar and title ────────────────────────────────────────────── */

function documentName(): string {
  return doc.path ? basename(doc.path) : 'Untitled';
}

function renderStatus(): void {
  ui.title.textContent = `${doc.dirty ? '*' : ''}${documentName()} - Notepad`;

  ui.statusState.textContent = state.busy
    ? 'Working…'
    : doc.staleOnDisk
      ? 'Changed on disk'
      : state.sessionTooLarge
        ? 'Too large to keep across reloads'
        : doc.dirty
          ? 'Modified'
          : doc.path
            ? 'Saved'
            : 'Ready';

  // XP only offered a caret readout with word wrap off, because with wrapping
  // on the column number stops matching what you see.
  if (state.wordWrap) {
    ui.statusPos.textContent = '';
  } else {
    const { line, col } = lineColFromIndex(ui.editor.selectionStart, lineOffsets);
    ui.statusPos.textContent = `Ln ${line}, Col ${col}`;
  }

  ui.statusSize.textContent = formatBytes(new TextEncoder().encode(ui.editor.value).length);
}

function reindex(): void {
  lineOffsets = buildLineIndex(ui.editor.value);
}

function setBusy(value: boolean): void {
  state.busy = value;
  renderStatus();
}

/* ── Message box ─────────────────────────────────────────────────────── */

type DialogField = {
  name: string;
  label: string;
  type: 'text' | 'checkbox';
  value?: string | boolean;
};
type DialogButton = { label: string; value: string; primary?: boolean; keepOpen?: boolean };
type DialogValues = Record<string, string | boolean>;
type DialogOptions = {
  title: string;
  message?: string;
  icon?: 'error' | 'help' | 'notepad';
  fields?: DialogField[];
  buttons?: DialogButton[];
  /** Invoked for `keepOpen` buttons, which act without dismissing the dialog. */
  onAction?: (action: string, values: DialogValues) => void | Promise<void>;
};

const ICONS = { error: error32, help, notepad: notepad32 } as const;

/** Windows that dim while a message box is up. */
function backdrops(): HTMLElement[] {
  return ui.fileLayer.hidden ? [ui.window] : [ui.window, ui.fileDialog];
}

/**
 * Dismisses whatever message box is currently up, resolving it as cancelled.
 *
 * The modal is a singleton: a second `showDialog()` reuses the same DOM, so
 * without this the dialog underneath would be silently overwritten and its
 * promise left unresolved forever. Callers that want to say something while a
 * dialog is open should use `setDialogNote()` instead of nesting.
 */
let closeActiveDialog: (() => void) | null = null;

/** Whether a message box is currently up. */
const dialogIsOpen = (): boolean => closeActiveDialog !== null;

/** Feedback inside the open dialog, for buttons that do not dismiss it. */
function setDialogNote(message: string): void {
  ui.dialogNote.textContent = message;
  ui.dialogNote.hidden = !message;
}

/**
 * One message box at a time, resolved by whichever button the user picks.
 *
 * The window beneath goes `.is-inactive`, which is what XP does and what makes
 * the theme's inactive title bar earn its place. When the file dialog is open
 * it dims too, so the stack reads correctly.
 */
function showDialog(
  options: DialogOptions,
): Promise<{ action: string; values: DialogValues } | null> {
  const buttons = options.buttons ?? [{ label: 'OK', value: 'ok', primary: true }];

  // Safety net. Nesting is a bug (see `setDialogNote`), but leaving the outer
  // promise pending forever would be a worse one.
  closeActiveDialog?.();

  ui.dialogTitle.textContent = options.title;
  setDialogNote('');
  ui.dialogMessage.textContent = options.message ?? '';
  ui.dialogMessage.hidden = !options.message;
  ui.dialogIcon.style.backgroundImage = options.icon ? `url(${ICONS[options.icon]})` : '';
  ui.dialogIcon.hidden = !options.icon;

  const inputs = new Map<string, HTMLInputElement>();
  ui.dialogFields.replaceChildren();
  ui.dialogFields.hidden = !options.fields?.length;
  for (const field of options.fields ?? []) {
    const row = document.createElement('div');
    // Checkbox rows put the label after the input, so they opt out of the
    // fixed label column that keeps stacked text fields aligned.
    row.className = field.type === 'checkbox' ? 'field-row is-check' : 'field-row';
    const input = document.createElement('input');
    input.type = field.type;
    input.id = `dialogField-${field.name}`;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = field.label;

    if (field.type === 'checkbox') {
      input.checked = field.value === true;
      row.append(input, label);
    } else {
      input.value = typeof field.value === 'string' ? field.value : '';
      input.autocomplete = 'off';
      row.append(label, input);
    }
    inputs.set(field.name, input);
    ui.dialogFields.append(row);
  }

  const readValues = (): DialogValues => {
    const values: DialogValues = {};
    for (const [name, input] of inputs) {
      values[name] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return values;
  };

  ui.dialogButtons.replaceChildren();
  ui.modalLayer.hidden = false;
  for (const node of backdrops()) node.classList.add('is-inactive');

  return new Promise((resolve) => {
    const finish = (action: string | null): void => {
      const values = readValues();
      closeActiveDialog = null;
      ui.modalLayer.hidden = true;
      setDialogNote('');
      for (const node of backdrops()) node.classList.remove('is-inactive');
      ui.dialogClose.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(action === null ? null : { action, values });
      // Focus goes back to whichever surface is still up.
      if (ui.fileLayer.hidden) ui.editor.focus();
      else ui.fileNameInput.focus();
    };

    const activate = (button: DialogButton): void => {
      if (button.keepOpen) void options.onAction?.(button.value, readValues());
      else finish(button.value);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(null);
        return;
      }
      // No <form> in a napplet, so Enter is wired by hand -- and must not fire
      // mid-composition on an IME.
      if (event.key === 'Enter' && !event.isComposing) {
        const target = event.target as HTMLElement | null;
        if (target instanceof HTMLInputElement && target.type === 'checkbox') return;
        const primary = buttons.find((button) => button.primary);
        if (!primary) return;
        event.preventDefault();
        event.stopPropagation();
        activate(primary);
      }
    };

    for (const button of buttons) {
      const node = document.createElement('button');
      node.type = 'button';
      node.textContent = button.label;
      if (button.primary) node.classList.add('focused');
      node.addEventListener('click', () => activate(button));
      ui.dialogButtons.append(node);
    }

    ui.dialogClose.onclick = () => finish(null);
    closeActiveDialog = () => finish(null);
    // Capture phase: this dialog owns Escape while it is up, not the menu bar.
    document.addEventListener('keydown', onKey, true);

    const firstText = [...inputs.values()].find((input) => input.type === 'text');
    if (firstText) {
      firstText.focus();
      firstText.select();
    } else {
      ui.dialogButtons.querySelector('button')?.focus();
    }
  });
}

const alertDialog = (
  title: string,
  message: string,
  icon: DialogOptions['icon'] = 'error',
): Promise<unknown> => showDialog({ title, message, icon });

/* ── File dialog ─────────────────────────────────────────────────────── */

type FileDialogMode = 'open' | 'save';

let fileDialogState = {
  dir: null as string | null,
  entries: [] as FsDirectoryEntry[],
  selected: null as FsDirectoryEntry | null,
};

/**
 * The Open / Save As browser.
 *
 * It lists the roots NAP-FS advertises. `Browse…` hands off to the runtime's
 * own picker, which is the only way to reach anything outside those roots --
 * and the only route at all on a shell that advertises none.
 */
function showFileDialog(mode: FileDialogMode, suggestedName: string): Promise<string | null> {
  fileDialogState = { dir: null, entries: [], selected: null };

  ui.fileDialogTitle.textContent = mode === 'open' ? 'Open' : 'Save As';
  ui.fileAccept.textContent = mode === 'open' ? 'Open' : 'Save';
  ui.fileNameInput.value = mode === 'save' ? suggestedName : '';
  ui.fileNote.hidden = true;
  ui.fileList.replaceChildren();
  ui.fileLayer.hidden = false;
  ui.window.classList.add('is-inactive');

  return new Promise((resolve) => {
    const finish = (path: string | null): void => {
      ui.fileLayer.hidden = true;
      ui.window.classList.remove('is-inactive');
      ui.fileDialogClose.onclick = null;
      ui.fileCancel.onclick = null;
      ui.fileAccept.onclick = null;
      ui.fileBrowse.onclick = null;
      ui.fileUp.onclick = null;
      ui.fileLookIn.onchange = null;
      ui.fileTypeSelect.onchange = null;
      ui.fileNameInput.onkeydown = null;
      ui.fileList.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      ui.editor.focus();
      resolve(path);
    };

    const onKey = (event: KeyboardEvent): void => {
      // Only when no message box is stacked on top of us.
      if (!ui.modalLayer.hidden) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(null);
      }
    };

    const accept = async (): Promise<void> => {
      const typed = ui.fileNameInput.value.trim();
      const selected = fileDialogState.selected;

      // A selected directory means "go there", not "open it".
      if (!typed && selected?.kind === 'directory') {
        await navigate(selected.path);
        return;
      }
      if (!typed && selected) {
        finish(selected.path);
        return;
      }
      if (!typed) {
        await alertDialog('Notepad', 'Choose a file, or type a file name.', 'notepad');
        return;
      }

      const problem = validateFileName(typed);
      if (problem) {
        await alertDialog('Notepad', problem, 'notepad');
        return;
      }
      if (!fileDialogState.dir) {
        await alertDialog('Notepad', 'Choose a folder first, or use Browse.', 'notepad');
        return;
      }

      const target = joinPath(fileDialogState.dir, typed);
      const existing = fileDialogState.entries.find((entry) => entry.name === typed);

      if (mode === 'open') {
        if (existing?.kind === 'directory') {
          await navigate(existing.path);
          return;
        }
        finish(target);
        return;
      }

      if (existing?.kind === 'directory') {
        await alertDialog('Notepad', 'A folder with that name already exists.');
        return;
      }
      if (existing) {
        const answer = await showDialog({
          title: 'Save As',
          message: `${typed} already exists.\nDo you want to replace it?`,
          icon: 'help',
          buttons: [
            { label: 'Yes', value: 'yes', primary: true },
            { label: 'No', value: 'no' },
          ],
        });
        if (answer?.action !== 'yes') return;
      }
      finish(target);
    };

    const browse = async (): Promise<void> => {
      try {
        const result =
          mode === 'open'
            ? await fs.pickFile({
                permissions: ['read'],
                accept: [{ mime: 'text/plain' }, { extension: '.txt' }],
                description: 'Choose a text file to open',
              })
            : await fs.pickSaveFile({
                permissions: ['write', 'create'],
                suggestedName: ui.fileNameInput.value.trim() || suggestedName,
                description: 'Choose where to save',
              });
        const picked = result.entries[0];
        if (picked) finish(picked.path);
      } catch (error) {
        // Cancelling the runtime picker returns you to this dialog, silently.
        if (isCancelled(error)) return;
        await alertDialog('Notepad', describeFsError(error));
      }
    };

    ui.fileDialogClose.onclick = () => finish(null);
    ui.fileCancel.onclick = () => finish(null);
    ui.fileAccept.onclick = () => void accept();
    ui.fileBrowse.onclick = () => void browse();
    ui.fileUp.onclick = () => {
      if (fileDialogState.dir) void navigate(parentPath(fileDialogState.dir));
    };
    ui.fileLookIn.onchange = () => void navigate(ui.fileLookIn.value);
    ui.fileTypeSelect.onchange = () => renderFileList();
    ui.fileNameInput.onkeydown = (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void accept();
    };
    ui.fileList.onclick = (event) => {
      const li = (event.target as HTMLElement).closest('li');
      if (!(li instanceof HTMLElement)) return;
      const index = Number(li.dataset.index);
      const entry = fileDialogState.entries[index];
      if (!entry) return;
      for (const other of ui.fileList.children) other.setAttribute('aria-selected', 'false');
      li.setAttribute('aria-selected', 'true');
      fileDialogState.selected = entry;
      // A directory is a destination, not a file name.
      ui.fileNameInput.value = entry.kind === 'directory' ? '' : entry.name;
      if (event.detail > 1) {
        if (entry.kind === 'directory') void navigate(entry.path);
        else void accept();
      }
    };
    document.addEventListener('keydown', onKey, true);

    void openInitialDirectory();
  });
}

async function openInitialDirectory(): Promise<void> {
  if (!info) {
    try {
      info = await fs.info();
    } catch (error) {
      renderLookIn();
      showFileNote(describeFsError(error));
      return;
    }
  }
  renderLookIn();
  const start = state.lastDir ?? info.roots[0]?.path ?? null;
  if (start) await navigate(start);
  else showFileNote('This shell advertises no folders. Use Browse to choose a file directly.');
}

function renderLookIn(): void {
  const options: { path: string; label: string }[] = (info?.roots ?? []).map((root) => ({
    path: root.path,
    label: root.name || root.path,
  }));
  const current = fileDialogState.dir;
  if (current && !options.some((option) => option.path === current)) {
    options.push({ path: current, label: current });
  }
  ui.fileLookIn.replaceChildren();
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.path;
    node.textContent = option.label;
    ui.fileLookIn.append(node);
  }
  if (current) ui.fileLookIn.value = current;
  ui.fileLookIn.disabled = options.length === 0;
  ui.fileUp.disabled = !current || current === '/';
}

function showFileNote(message: string): void {
  ui.fileList.replaceChildren();
  ui.fileNote.textContent = message;
  ui.fileNote.hidden = false;
}

async function navigate(path: string): Promise<void> {
  fileDialogState.selected = null;
  try {
    fileDialogState.entries = sortEntries(await fs.list(path));
    fileDialogState.dir = path;
    state.lastDir = path;
    renderLookIn();
    renderFileList();
  } catch (error) {
    fileDialogState.entries = [];
    renderLookIn();
    showFileNote(describeFsError(error));
  }
}

function renderFileList(): void {
  const textOnly = ui.fileTypeSelect.value === 'text';
  ui.fileList.replaceChildren();

  let shown = 0;
  for (const [index, entry] of fileDialogState.entries.entries()) {
    if (entry.kind !== 'directory' && textOnly && !isTextFileName(entry.name)) continue;
    shown += 1;

    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.index = String(index);

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.style.backgroundImage = `url(${entry.kind === 'directory' ? folder : documentIcon})`;

    const name = document.createElement('span');
    name.className = 'file-entry-name';
    name.textContent = entry.name;

    const size = document.createElement('span');
    size.className = 'file-entry-size';
    size.textContent = entry.kind === 'directory' ? '' : formatBytes(entry.size);

    const when = document.createElement('span');
    when.className = 'file-entry-when';
    when.textContent = formatDate(entry.modifiedAt);

    li.append(icon, name, size, when);
    ui.fileList.append(li);
  }

  if (shown === 0) {
    showFileNote(textOnly ? 'No text documents in this folder.' : 'This folder is empty.');
    return;
  }
  ui.fileNote.hidden = true;
}

/* ── Menus ───────────────────────────────────────────────────────────── */

let openMenu: HTMLUListElement | null = null;

function closeMenu(): void {
  if (openMenu) openMenu.hidden = true;
  openMenu = null;
  for (const button of ui.menuBar.querySelectorAll('button'))
    button.setAttribute('aria-expanded', 'false');
}

function toggleMenu(button: HTMLButtonElement): void {
  const menu = document.getElementById(`menu-${button.dataset.menu}`) as HTMLUListElement | null;
  if (!menu) return;
  const wasOpen = openMenu === menu;
  closeMenu();
  if (wasOpen) return;

  // Go To measures columns, which only means something without wrapping.
  ui.menuGoTo.setAttribute('aria-disabled', String(state.wordWrap));

  const rect = button.getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom}px`;
  // A host frame can be narrow enough that the menu would hang off the edge.
  const overflowX = rect.left + menu.offsetWidth - document.documentElement.clientWidth;
  if (overflowX > 0) menu.style.left = `${Math.max(0, rect.left - overflowX)}px`;

  button.setAttribute('aria-expanded', 'true');
  openMenu = menu;
}

/* ── Document state ──────────────────────────────────────────────────── */

/**
 * Shows or hides the XP title bar and frame (NAP-CONFIG `windowFrame`).
 *
 * The close button lives in the title bar, so hiding it takes New away with it.
 * That is the right trade: a shell drawing its own chrome owns closing the
 * pane, and Ctrl+N and File ▸ New both still work.
 */
function setWindowFrame(on: boolean): void {
  ui.window.classList.toggle('xp-frameless', !on);
}

function setWordWrap(on: boolean): void {
  state.wordWrap = on;
  ui.editor.dataset.wrap = on ? 'on' : 'off';
  ui.menuWordWrap.setAttribute('aria-checked', String(on));
  renderStatus();
}

function markDirty(): void {
  doc.dirty = true;
  reindex();
  renderStatus();
  scheduleSessionSave();
}

function loadIntoEditor(text: string, meta: { eol: Eol; bom: boolean }): void {
  ui.editor.value = text;
  doc.eol = meta.eol;
  doc.bom = meta.bom;
  doc.dirty = false;
  doc.staleOnDisk = false;
  reindex();
  renderStatus();
}

/* ── Session persistence ─────────────────────────────────────────────── */

let sessionTimer: ReturnType<typeof setTimeout> | undefined;

function currentSession(): Session {
  return {
    path: doc.path,
    text: ui.editor.value,
    dirty: doc.dirty,
    eol: doc.eol,
    bom: doc.bom,
    wordWrap: state.wordWrap,
    lastDir: state.lastDir,
    // Carried so a restored buffer keeps the revision it was based on.
    revision: doc.revision ?? null,
    size: doc.size ?? null,
    modifiedAt: doc.modifiedAt ?? null,
  };
}

async function saveSession(): Promise<void> {
  if (!has('storage')) return;
  const { raw, textDropped } = serializeSession(currentSession());
  state.sessionTooLarge = textDropped;
  try {
    await storageSetItem(SESSION_KEY, raw);
  } catch {
    // Storage is a convenience here; the filesystem holds the document.
  }
  renderStatus();
}

function scheduleSessionSave(): void {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => void saveSession(), 1000);
}

/* ── Reading and writing ─────────────────────────────────────────────── */

async function refreshMetadata(): Promise<void> {
  if (!doc.path) return;
  try {
    const metadata: FsMetadata = await fs.stat(doc.path);
    doc.revision = metadata.revision;
    doc.size = metadata.size;
    doc.modifiedAt = metadata.modifiedAt;
  } catch {
    // A stat failure only costs us conflict detection, not the document.
  }
}

/** Reads a whole file, chunked to whatever the runtime allows per call. */
async function readWholeFile(path: string): Promise<Uint8Array | null> {
  const maxRead = info?.limits.maxReadBytes ?? 0;
  if (maxRead <= 0) {
    await alertDialog('Notepad', 'This shell does not allow reading file contents.');
    return null;
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const result = await fs.read(path, { offset, length: maxRead });
    chunks.push(base64ToBytes(result.data));
    offset += result.bytesRead;

    if (offset > MAX_OPEN_BYTES) {
      await alertDialog(
        'Notepad',
        `${basename(path)} is too large for Notepad.\nOpen it in another application.`,
      );
      return null;
    }
    // A runtime reporting neither EOF nor progress would otherwise spin forever.
    if (result.eof || result.bytesRead === 0) break;
  }
  return concatBytes(chunks);
}

async function openPath(path: string): Promise<boolean> {
  setBusy(true);
  try {
    const metadata = await fs.stat(path);
    if (metadata.kind === 'directory') {
      await alertDialog('Notepad', 'That is a folder, not a file.');
      return false;
    }
    if (metadata.size !== undefined && metadata.size > MAX_OPEN_BYTES) {
      await alertDialog(
        'Notepad',
        `${basename(path)} is too large for Notepad.\nOpen it in another application.`,
      );
      return false;
    }

    const bytes = await readWholeFile(path);
    if (!bytes) return false;

    const decoded = decodeText(bytes);
    if (!decoded) {
      await alertDialog(
        'Notepad',
        `${basename(path)} is not a UTF-8 text file.\nOpening it here would corrupt it.`,
      );
      return false;
    }

    doc.path = path;
    doc.revision = metadata.revision;
    doc.size = metadata.size;
    doc.modifiedAt = metadata.modifiedAt;
    loadIntoEditor(decoded.text, decoded);
    state.lastDir = parentPath(path);
    await startWatch();
    void saveSession();
    return true;
  } catch (error) {
    await alertDialog('Notepad', describeFsError(error));
    return false;
  } finally {
    setBusy(false);
  }
}

/** Writes the buffer, chunked when it exceeds a single permitted write. */
async function writeAll(path: string, bytes: Uint8Array, ifRevision?: string): Promise<void> {
  const maxWrite = info?.limits.maxWriteBytes ?? 0;
  if (maxWrite <= 0 || bytes.length <= maxWrite) {
    await fs.write(path, bytesToBase64(bytes), { mode: 'replace', ifRevision });
    return;
  }

  // The first chunk replaces (and so truncates); the rest append. If an append
  // fails the file is left short, which the caller reports rather than hides.
  await fs.write(path, bytesToBase64(bytes.subarray(0, maxWrite)), { mode: 'replace', ifRevision });
  for (let offset = maxWrite; offset < bytes.length; offset += maxWrite) {
    try {
      await fs.write(path, bytesToBase64(bytes.subarray(offset, offset + maxWrite)), {
        mode: 'append',
      });
    } catch (error) {
      throw new Error(
        `${describeFsError(error)}\nThe file on disk is now incomplete — save it again, or save to a new file.`,
      );
    }
  }
}

/** Returns true when the bytes reached the filesystem. */
async function saveToPath(path: string, options: { force?: boolean } = {}): Promise<boolean> {
  setBusy(true);
  try {
    const bytes = encodeText(ui.editor.value, { eol: doc.eol, bom: doc.bom });
    // `ifRevision` is what turns "someone else changed this" from a silent
    // overwrite into a question. Forcing deliberately drops the precondition,
    // and so does saving somewhere the revision does not describe.
    const guard = options.force || path !== doc.path ? undefined : doc.revision;
    await writeAll(path, bytes, guard);

    doc.path = path;
    doc.dirty = false;
    doc.staleOnDisk = false;
    state.lastDir = parentPath(path);
    await refreshMetadata();
    await startWatch();
    renderStatus();
    void saveSession();
    return true;
  } catch (error) {
    if (isConflict(error)) return await resolveConflict(path);
    await alertDialog('Notepad', describeFsError(error));
    return false;
  } finally {
    setBusy(false);
  }
}

async function resolveConflict(path: string): Promise<boolean> {
  const answer = await showDialog({
    title: 'Notepad',
    message: `${basename(path)} has changed on disk since you opened it.\n\nSaving now would discard those changes.`,
    icon: 'help',
    buttons: [
      { label: 'Overwrite', value: 'overwrite' },
      { label: 'Reload', value: 'reload' },
      { label: 'Cancel', value: 'cancel', primary: true },
    ],
  });
  if (answer?.action === 'overwrite') return await saveToPath(path, { force: true });
  if (answer?.action === 'reload') await openPath(path);
  return false;
}

async function save(): Promise<boolean> {
  if (!has('fs')) {
    await alertDialog('Notepad', 'This shell did not grant filesystem access.');
    return false;
  }
  if (!doc.path) return await saveAs();
  return await saveToPath(doc.path);
}

async function saveAs(): Promise<boolean> {
  if (!has('fs')) {
    await alertDialog('Notepad', 'This shell did not grant filesystem access.');
    return false;
  }
  const name = documentName();
  const path = await showFileDialog('save', name.includes('.') ? name : `${name}.txt`);
  if (!path) return false;
  return await saveToPath(path);
}

/**
 * The XP prompt, and the reason nothing destructive happens without it.
 * Returns false when the user backed out.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!doc.dirty) return true;
  const answer = await showDialog({
    title: 'Notepad',
    message: `The text in the ${documentName()} file has changed.\n\nDo you want to save the changes?`,
    icon: 'help',
    buttons: [
      { label: 'Yes', value: 'yes', primary: true },
      { label: 'No', value: 'no' },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (!answer || answer.action === 'cancel') return false;
  if (answer.action === 'no') return true;
  return await save();
}

async function reloadFromDisk(): Promise<void> {
  if (!doc.path) return;
  if (!(await confirmDiscard())) return;
  await openPath(doc.path);
}

/* ── Watching for outside changes ────────────────────────────────────── */

let watchId: string | null = null;
let changeSubscription: Subscription | null = null;
let configSubscription: Subscription | null = null;
let staleTimer: ReturnType<typeof setTimeout> | undefined;

async function stopWatch(): Promise<void> {
  const id = watchId;
  watchId = null;
  if (id) await fs.unwatch(id).catch(() => undefined);
}

async function startWatch(): Promise<void> {
  await stopWatch();
  if (!doc.path || !has('fs')) return;
  try {
    watchId = await fs.watch(doc.path);
  } catch {
    // Some runtimes only watch directories. Falling back keeps the feature;
    // giving up entirely would only cost the notification, so both are survivable.
    try {
      watchId = await fs.watch(parentPath(doc.path));
    } catch {
      watchId = null;
    }
  }
}

/**
 * Change events are advisory -- coalesced, duplicated, reordered or dropped --
 * so they are only a hint to go and re-check the metadata.
 */
function onFsChanged(): void {
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => void checkForOutsideChange(), 180);
}

async function checkForOutsideChange(): Promise<void> {
  if (!doc.path) return;
  // Never cut in on work already in progress: reloading mid-save would race the
  // write, and opening a message box over an open dialog would destroy it.
  // Boot calls this directly, so the guard lives here rather than in onFsChanged.
  if (documentOperationInFlight || dialogIsOpen()) {
    onFsChanged();
    return;
  }
  try {
    const metadata = await fs.stat(doc.path);
    // Prefer the revision token; fall back to size/mtime when the runtime
    // discloses no revision at all.
    const changed =
      metadata.revision !== undefined || doc.revision !== undefined
        ? metadata.revision !== doc.revision
        : metadata.size !== doc.size || metadata.modifiedAt !== doc.modifiedAt;
    if (!changed) return;

    doc.staleOnDisk = true;
    renderStatus();

    // Nothing to lose: reload silently rather than nagging.
    if (!doc.dirty) {
      await openPath(doc.path);
      return;
    }
    const answer = await showDialog({
      title: 'Notepad',
      message: `${basename(doc.path)} has changed on disk.\n\nReload it and lose your unsaved changes?`,
      icon: 'help',
      buttons: [
        { label: 'Reload', value: 'reload' },
        { label: 'Keep editing', value: 'keep', primary: true },
      ],
    });
    if (answer?.action === 'reload') await openPath(doc.path);
  } catch {
    // The file may simply be gone; the next save reports that properly.
  }
}

/* ── Editing helpers ─────────────────────────────────────────────────── */

/**
 * All programmatic edits go through `execCommand`.
 *
 * It is deprecated, but it is the only way to change a textarea's contents and
 * still leave the browser's native undo stack intact. Assigning to `.value`
 * silently destroys undo history, which in a text editor is a real loss.
 */
function insertText(value: string): void {
  ui.editor.focus();
  if (!document.execCommand('insertText', false, value)) {
    const { selectionStart, selectionEnd, value: text } = ui.editor;
    ui.editor.value = text.slice(0, selectionStart) + value + text.slice(selectionEnd);
    ui.editor.selectionStart = ui.editor.selectionEnd = selectionStart + value.length;
  }
  markDirty();
}

function selectRange(start: number, end: number): void {
  ui.editor.focus();
  ui.editor.setSelectionRange(start, end);
  renderStatus();
}

const lastSearch = { needle: '', replacement: '', matchCase: false, backwards: false };

function runFind(needle: string, matchCase: boolean, backwards: boolean): boolean {
  const from = backwards ? ui.editor.selectionStart : ui.editor.selectionEnd;
  const at = findNext(ui.editor.value, needle, from, { matchCase, backwards, wrap: true });
  if (at === -1) return false;
  selectRange(at, at + needle.length);
  return true;
}

const cannotFind = (needle: string): string => `Cannot find "${needle}"`;

async function findAgain(): Promise<void> {
  if (!lastSearch.needle) {
    await openFindDialog();
    return;
  }
  if (!runFind(lastSearch.needle, lastSearch.matchCase, lastSearch.backwards)) {
    // No dialog is open on this path (F3 / Edit ▸ Find Next), so a message box
    // is the right surface.
    await alertDialog('Notepad', cannotFind(lastSearch.needle), 'notepad');
  }
}

async function openFindDialog(): Promise<void> {
  await showDialog({
    title: 'Find',
    fields: [
      { name: 'needle', label: 'Find what:', type: 'text', value: lastSearch.needle },
      { name: 'matchCase', label: 'Match case', type: 'checkbox', value: lastSearch.matchCase },
      { name: 'backwards', label: 'Search up', type: 'checkbox', value: lastSearch.backwards },
    ],
    buttons: [
      { label: 'Find Next', value: 'find', primary: true, keepOpen: true },
      { label: 'Cancel', value: 'cancel' },
    ],
    onAction: async (_action, values) => {
      const needle = String(values.needle ?? '');
      lastSearch.needle = needle;
      lastSearch.matchCase = values.matchCase === true;
      lastSearch.backwards = values.backwards === true;
      if (!needle) return;
      setDialogNote(
        runFind(needle, lastSearch.matchCase, lastSearch.backwards) ? '' : cannotFind(needle),
      );
    },
  });
}

async function openReplaceDialog(): Promise<void> {
  await showDialog({
    title: 'Replace',
    fields: [
      { name: 'needle', label: 'Find what:', type: 'text', value: lastSearch.needle },
      { name: 'replacement', label: 'Replace with:', type: 'text', value: lastSearch.replacement },
      { name: 'matchCase', label: 'Match case', type: 'checkbox', value: lastSearch.matchCase },
    ],
    buttons: [
      { label: 'Find Next', value: 'find', primary: true, keepOpen: true },
      { label: 'Replace', value: 'replace', keepOpen: true },
      { label: 'Replace All', value: 'replaceAll', keepOpen: true },
      { label: 'Cancel', value: 'cancel' },
    ],
    onAction: async (action, values) => {
      const needle = String(values.needle ?? '');
      const replacement = String(values.replacement ?? '');
      const matchCase = values.matchCase === true;
      lastSearch.needle = needle;
      lastSearch.replacement = replacement;
      lastSearch.matchCase = matchCase;
      lastSearch.backwards = false;
      if (!needle) return;

      if (action === 'find') {
        setDialogNote(runFind(needle, matchCase, false) ? '' : cannotFind(needle));
        return;
      }

      if (action === 'replace') {
        // Replace the selection when it is already a match, then advance --
        // which is what XP's Replace button did.
        const selected = ui.editor.value.slice(ui.editor.selectionStart, ui.editor.selectionEnd);
        const matched = matchCase
          ? selected === needle
          : selected.toLowerCase() === needle.toLowerCase();
        if (matched) insertText(replacement);
        const advanced = runFind(needle, matchCase, false);
        setDialogNote(advanced || matched ? '' : cannotFind(needle));
        return;
      }

      const result = replaceAll(ui.editor.value, needle, replacement, { matchCase });
      if (!result.count) {
        setDialogNote(cannotFind(needle));
        return;
      }
      // Select-all then insert, so the whole rewrite is a single undo step.
      ui.editor.select();
      insertText(result.text);
      selectRange(0, 0);
      setDialogNote(`Replaced ${result.count} occurrence${result.count === 1 ? '' : 's'}.`);
    },
  });
}

async function openGoToDialog(): Promise<void> {
  const { line } = lineColFromIndex(ui.editor.selectionStart, lineOffsets);
  const answer = await showDialog({
    title: 'Go To Line',
    fields: [{ name: 'line', label: 'Line number:', type: 'text', value: String(line) }],
    buttons: [
      { label: 'Go To', value: 'go', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (answer?.action !== 'go') return;

  const requested = Number(String(answer.values.line ?? '').trim());
  if (!Number.isFinite(requested) || requested < 1 || requested > lineOffsets.length) {
    await alertDialog('Notepad', 'The line number is beyond the total number of lines.');
    return;
  }
  const start = indexOfLine(requested, lineOffsets);
  selectRange(start, start);
}

/* ── Actions ─────────────────────────────────────────────────────────── */

async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await stopWatch();
  doc.path = null;
  doc.revision = undefined;
  doc.size = undefined;
  doc.modifiedAt = undefined;
  loadIntoEditor('', { eol: DEFAULT_EOL, bom: false });
  void saveSession();
}

async function openDocument(): Promise<void> {
  if (!has('fs')) {
    await alertDialog('Notepad', 'This shell did not grant filesystem access.');
    return;
  }
  if (!(await confirmDiscard())) return;
  const path = await showFileDialog('open', '');
  if (!path) return;
  await openPath(path);
}

const actions: Record<string, () => void | Promise<void>> = {
  new: newDocument,
  open: openDocument,
  save: async () => {
    await save();
  },
  saveAs: async () => {
    await saveAs();
  },
  reload: async () => {
    if (!doc.path) {
      await alertDialog('Notepad', 'This document has never been saved.', 'notepad');
      return;
    }
    await reloadFromDisk();
  },

  undo: () => {
    ui.editor.focus();
    document.execCommand('undo');
    markDirty();
  },
  cut: () => {
    ui.editor.focus();
    document.execCommand('cut');
    markDirty();
  },
  copy: () => {
    ui.editor.focus();
    document.execCommand('copy');
  },
  paste: async () => {
    ui.editor.focus();
    // An opaque-origin sandbox cannot read the clipboard: `execCommand('paste')`
    // is a no-op in every current browser and `navigator.clipboard.readText()`
    // rejects without a same-origin permission. Say so rather than doing nothing.
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        insertText(text);
        return;
      }
    } catch {
      // Fall through to the hint below.
    }
    await alertDialog('Notepad', 'Press Ctrl+V to paste into the editor.', 'notepad');
  },
  delete: () => {
    ui.editor.focus();
    document.execCommand('delete');
    markDirty();
  },

  find: openFindDialog,
  findNext: findAgain,
  replace: openReplaceDialog,
  goTo: async () => {
    if (state.wordWrap) return;
    await openGoToDialog();
  },
  selectAll: () => {
    ui.editor.focus();
    ui.editor.select();
    renderStatus();
  },
  timestamp: () => {
    const now = new Date();
    insertText(`${now.toLocaleTimeString()} ${now.toLocaleDateString()}`);
  },

  wordWrap: () => {
    setWordWrap(!state.wordWrap);
    void saveSession();
  },

  about: async () => {
    const roots = info?.roots.length ?? 0;
    await alertDialog(
      'About Notepad',
      [
        'Notepad — a NIP-5D napplet.',
        '',
        `Filesystem: ${has('fs') ? `${roots} folder${roots === 1 ? '' : 's'} available` : 'not granted'}`,
        `Session storage: ${has('storage') ? 'granted' : 'not granted'}`,
        `Opens files for other napplets: ${has('inc') ? `yes, as "${ARCHETYPE}"` : 'not granted'}`,
      ].join('\n'),
      'notepad',
    );
  },
};

/* ── Opening on request from another napplet ─────────────────────────────
 * NAP-INTENT, handler side. The manifest declares the `text-editor` archetype
 * on the `napplet:text-editor/open` convention; the shell resolves this napplet
 * from that tag and then delivers the caller's payload as a NAP-INC event on
 * the convention topic. There is no reply channel back to the caller -- the
 * shell already told it whether *dispatch* succeeded -- so everything that can
 * go wrong from here on is reported to the person looking at the editor.
 */

let intentSubscriptions: Subscription[] = [];
let pendingIntent: ParsedIntent | null = null;
let intentRetryTimer: ReturnType<typeof setTimeout> | undefined;
/** Intents are queued until the session has been restored (see `boot`). */
let bootComplete = false;

function queueIntent(parsed: ParsedIntent): void {
  // Only the most recent request survives. A burst from one caller means the
  // last one is what the user is meant to end up looking at, and replaying the
  // earlier ones would flash through files nobody asked to see -- each with its
  // own unsaved-changes prompt.
  pendingIntent = parsed;
  drainIntent();
}

function drainIntent(): void {
  clearTimeout(intentRetryTimer);
  const parsed = pendingIntent;
  if (!parsed || !bootComplete) return;

  // Never cut in on work already in progress. A message box is a singleton that
  // dismisses whatever is already up, so an intent arriving while the user is
  // typing in Find would destroy that dialog; and opening a document under a
  // save in flight would race its writes. Both resolve on their own, so wait
  // for them rather than dropping what the caller asked for.
  if (documentOperationInFlight || dialogIsOpen() || !ui.fileLayer.hidden) {
    intentRetryTimer = setTimeout(drainIntent, 200);
    return;
  }

  pendingIntent = null;
  void withDocumentLock(() => applyIntent(parsed));
}

/** Puts the caret where the caller asked, and the editor in front of the user. */
function goToIntentLine(line: number | undefined): void {
  if (line === undefined) {
    ui.editor.focus();
    return;
  }
  // `indexOfLine` clamps, so a line past the end lands on the last one. That is
  // not worth a message box: the file opened, which is what was asked for.
  const start = indexOfLine(line, lineOffsets);
  selectRange(start, start);
  // `setSelectionRange` moves the caret but does not reliably scroll a textarea
  // to it. Re-focusing does, and is a no-op when the caret is already in view.
  ui.editor.blur();
  ui.editor.focus();
}

async function applyIntent(parsed: ParsedIntent): Promise<void> {
  if (isProblem(parsed)) {
    await alertDialog('Notepad', parsed.problem);
    return;
  }
  if (!has('fs')) {
    await alertDialog(
      'Notepad',
      'Another napplet asked Notepad to open a file, but this shell did not grant filesystem access.',
    );
    return;
  }

  // Already editing exactly this file: do not re-read it, and above all do not
  // ask about unsaved changes. The caller wants the user looking at this
  // document and they already are, so discarding their buffer to re-read the
  // same path would lose work in exchange for nothing.
  if (parsed.path === doc.path) {
    goToIntentLine(parsed.line);
    return;
  }

  if (!(await confirmDiscard())) return;
  if (await openPath(parsed.path)) goToIntentLine(parsed.line);
}

/** Actions that touch the document and must not overlap each other. */
const EXCLUSIVE_ACTIONS = new Set(['new', 'open', 'save', 'saveAs', 'reload']);

/**
 * The single entry point for menu items and shortcuts.
 *
 * Document actions take a lock, so hammering Ctrl+S cannot start a second save
 * over the first. Everything else (find, clipboard, word wrap) runs freely --
 * gating those behind the same lock would let an open Find dialog block saving.
 */
async function runAction(name: string): Promise<void> {
  const action = actions[name];
  if (!action) return;
  if (!EXCLUSIVE_ACTIONS.has(name)) {
    await action();
    return;
  }
  await withDocumentLock(action);
}

/**
 * Runs a document operation exclusively, dropping it if one is already running.
 *
 * Dropping is right for a user action -- a second Ctrl+S is the same save --
 * but not for an inbound intent, which is why `drainIntent` waits for the lock
 * instead of racing it, and why releasing the lock gives it a chance to run.
 */
async function withDocumentLock(operation: () => void | Promise<void>): Promise<void> {
  if (documentOperationInFlight) return;
  documentOperationInFlight = true;
  try {
    await operation();
  } finally {
    documentOperationInFlight = false;
    drainIntent();
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

ui.editor.addEventListener('input', markDirty);

for (const event of ['keyup', 'click', 'select'] as const) {
  ui.editor.addEventListener(event, () => {
    if (!state.wordWrap) renderStatus();
  });
}

ui.menuBar.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button');
  if (button) toggleMenu(button as HTMLButtonElement);
});

for (const menu of document.querySelectorAll<HTMLUListElement>('.xp-menu')) {
  menu.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('li');
    if (!(item instanceof HTMLElement)) return;
    if (item.getAttribute('aria-disabled') === 'true') return;
    const action = item.dataset.action;
    if (!action) return;
    closeMenu();
    void runAction(action);
  });
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.xp-menu') && !target.closest('.xp-menu-bar')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  // A modal owns the keyboard while it is up.
  if (!ui.modalLayer.hidden || !ui.fileLayer.hidden) return;
  if (event.key === 'Escape') closeMenu();

  if (event.key === 'F3') {
    event.preventDefault();
    void findAgain();
    return;
  }
  if (event.key === 'F5') {
    event.preventDefault();
    void runAction('timestamp');
    return;
  }

  // Local shortcuts only. NAP-KEYS is not requested, so anything the shell wants
  // to keep for itself, it keeps.
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();

  if (key === 's') {
    event.preventDefault();
    void runAction(event.shiftKey ? 'saveAs' : 'save');
    return;
  }

  const shortcuts: Record<string, string> = {
    n: 'new',
    o: 'open',
    f: 'find',
    h: 'replace',
    g: 'goTo',
  };
  const action = shortcuts[key];
  if (!action) return;
  if (action === 'goTo' && state.wordWrap) return;
  event.preventDefault();
  void runAction(action);
});

ui.closeButton.addEventListener('click', () => void runAction('new'));

window.addEventListener('beforeunload', () => {
  clearTimeout(sessionTimer);
  clearTimeout(staleTimer);
  clearTimeout(intentRetryTimer);
  void stopWatch();
  changeSubscription?.close();
  for (const subscription of intentSubscriptions) subscription.close();
  configSubscription?.close();
});

/* ── Boot ────────────────────────────────────────────────────────────── */

async function restoreSession(): Promise<Session> {
  if (!has('storage')) return DEFAULT_SESSION;
  try {
    return parseSession(await storageGetItem(SESSION_KEY)) ?? DEFAULT_SESSION;
  } catch {
    return DEFAULT_SESSION;
  }
}

async function boot(): Promise<void> {
  ui.fileUpIcon.style.backgroundImage = `url(${up})`;

  // Subscribed first, so an intent that opens this napplet cold is not missed
  // while the session is still being read back. `drainIntent` holds anything
  // that arrives until `bootComplete` below, rather than letting it race the
  // restore and be overwritten by the file the session remembers.
  if (has('inc')) {
    try {
      // One subscription per declared convention -- `open` and `edit` mean the
      // same thing here, so they share a handler.
      intentSubscriptions = CONVENTIONS.map((convention) =>
        incOn(convention, (event) => queueIntent(parseOpenIntent(event.payload))),
      );
    } catch {
      // A shell that cannot route intents simply never sends one; every other
      // way of opening a file still works.
    }
  }

  // The shell is the sole writer, and pushes a snapshot immediately on
  // subscribe, so there is no separate `get()` -- and a later change from the
  // settings UI arrives on the same subscription.
  if (has('config')) {
    try {
      configSubscription = config.subscribe((values) => {
        // A shell that dropped the property, or sent something that is not a
        // boolean, gets the framed default rather than a guess.
        setWindowFrame(values.windowFrame !== false);
      });
    } catch {
      // Without config the frame simply stays on, which is the default anyway.
    }
  }

  const session = await restoreSession();
  setWordWrap(session.wordWrap);
  state.lastDir = session.lastDir;
  doc.path = session.path;
  doc.eol = session.eol;
  doc.bom = session.bom;

  if (has('fs')) {
    try {
      info = await fs.info();
      changeSubscription = fs.onChanged((change) => {
        if (change.watchId === watchId) onFsChanged();
      });
    } catch {
      // Every fs action re-reports this properly at the point of use.
    }
  }

  if (session.dirty && session.text !== null) {
    // Unsaved work wins over what is on disk -- re-reading would destroy it.
    loadIntoEditor(session.text, session);
    doc.dirty = true;

    // Restore the file state this buffer was *based on*, not the file's current
    // state. Re-stat'ing here would adopt whatever revision the file has now,
    // so a file something else edited while the napplet was closed would sail
    // past the `ifRevision` guard on the next save and be overwritten silently.
    doc.revision = session.revision ?? undefined;
    doc.size = session.size ?? undefined;
    doc.modifiedAt = session.modifiedAt ?? undefined;

    await startWatch();
    // Now compare against disk: if it moved on while we were away, this is
    // exactly the conflict the user needs to be told about.
    await checkForOutsideChange();
  } else if (session.path && has('fs')) {
    const opened = await openPath(session.path);
    if (!opened) doc.path = null;
  }

  reindex();
  renderStatus();
  ui.editor.focus();

  // The editor is now in a state an inbound open can safely replace.
  bootComplete = true;
  drainIntent();
}

void boot();
