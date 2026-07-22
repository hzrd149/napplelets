import { config, outbox, resource } from '@napplet/sdk';
import { installThemeClient } from '@napplelets/theme-dsui';
import { HighlightFactory } from 'applesauce-common/factories/highlight';
import { getArticleImage, getArticlePublished, getArticleSummary, getArticleTitle } from 'applesauce-common/helpers/article';
import { remarkNostrMentions } from 'applesauce-content/markdown';
import type { EventTemplate, NostrEvent } from 'nostr-tools/core';
import * as kinds from 'nostr-tools/kinds';
import * as nip19 from 'nostr-tools/nip19';
import type { AddressPointer } from 'nostr-tools/nip19';
import type { Components, UrlTransform } from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

const themeHandle = installThemeClient();
const ARTICLE_KIND = kinds.LongFormArticle;
const HIGHLIGHT_KIND = kinds.Highlights;
const remarkPlugins = [remarkGfm, remarkNostrMentions];

// `remarkNostrMentions` emits link nodes with `children: []`, and
// react-markdown's default urlTransform strips non-http(s) hrefs. Left alone,
// every `nostr:` mention in an article body renders as an invisible empty <a>.
// The napplet does not declare NAP-LINK, so mentions render as inert text.
const urlTransform: UrlTransform = (url) => (url.startsWith('nostr:') ? url : defaultNostrSafeUrl(url));

function defaultNostrSafeUrl(url: string): string {
  return /^(https?|mailto|tel):/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : '';
}

function shortenBech32(value: string): string {
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

/**
 * Article bodies embed arbitrary remote image URLs. Rendering them into a plain
 * `<img src>` makes the sandboxed frame issue its own network request, which
 * bypasses the shell's resource policy just as a direct `fetch` would. Pull the
 * bytes through NAP-RESOURCE instead, exactly like the hero image.
 */
function ResourceImage({ src, alt, node: _node, ...props }: ComponentPropsWithoutRef<'img'> & { node?: unknown }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl('');
    setFailed(false);
    if (typeof src !== 'string' || !src || !isNapDomainPresent('resource')) {
      setFailed(true);
      return;
    }

    let created = '';
    let cancelled = false;
    void (async () => {
      try {
        const blob = await resource.bytes(src);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (failed) return <span className="text-sm text-base-content/50">[image unavailable: {alt || src}]</span>;
  if (!objectUrl) return <span className="text-sm text-base-content/50">[loading image…]</span>;
  return <img {...props} src={objectUrl} alt={alt ?? ''} />;
}

const markdownComponents: Components = {
  img: ResourceImage,
  a({ children, href, node: _node, ...props }) {
    const isMention = typeof href === 'string' && href.startsWith('nostr:');
    if (isMention && (children === undefined || children === null || (Array.isArray(children) && children.length === 0))) {
      return <code className="not-prose rounded bg-base-200 px-1 py-0.5 text-[0.85em] text-primary">{shortenBech32(href.slice('nostr:'.length))}</code>;
    }
    // Article bodies are untrusted remote content: never let a link navigate
    // the sandboxed frame or reach an opener.
    return (
      <a {...props} href={isMention ? undefined : href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type PublishState = 'idle' | 'publishing' | 'published' | 'error';

interface DecodedArticle {
  naddr: string;
  address: AddressPointer;
  addressTag: string;
}

interface ConfigValues {
  naddr?: unknown;
}

interface PublishResult {
  ok?: boolean;
  error?: string;
  event?: NostrEvent;
}

function isNapDomainPresent(domain: string): boolean {
  const napplet = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
  return Boolean(napplet?.[domain]);
}

function decodeArticleNaddr(value: string): DecodedArticle {
  const naddr = value.trim().replace(/^nostr:/i, '');
  if (!naddr) throw new Error('Paste a NIP-19 naddr for a NIP-23 article.');

  const decoded = nip19.decode(naddr);
  if (decoded.type !== 'naddr') throw new Error('This reference is not an naddr.');
  if (decoded.data.kind !== ARTICLE_KIND) throw new Error('This naddr does not point to a NIP-23 article.');

  const address = decoded.data;
  return {
    naddr,
    address,
    addressTag: `${address.kind}:${address.pubkey}:${address.identifier}`,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function createArticleFilter(address: AddressPointer): { kinds: number[]; authors: string[]; '#d': string[]; limit: number } {
  return {
    kinds: [address.kind],
    authors: [address.pubkey],
    '#d': [address.identifier],
    limit: 5,
  };
}

async function loadArticle(address: AddressPointer): Promise<NostrEvent> {
  const { events } = await outbox.query([createArticleFilter(address)], {
    authors: [address.pubkey],
    relays: address.relays,
    timeoutMs: 7000,
  });
  const article = events
    .map((result) => result.event as NostrEvent)
    .filter((event) => event.kind === ARTICLE_KIND)
    .sort((a, b) => b.created_at - a.created_at)[0];

  if (!article) throw new Error('No NIP-23 article was found for that naddr.');
  return article;
}

const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'FIGCAPTION', 'DD', 'DT']);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Nearest block-level ancestor of `node` inside `root`, or null if there is none. */
function closestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * NIP-84 `context` should carry the surrounding passage the highlight was taken
 * from — in practice the containing paragraph, so a reader can render the quote
 * in situ without refetching the article. A selection can also span several
 * blocks, in which case every block it touches forms the context.
 */
function contextForRange(range: Range, root: HTMLElement): string {
  const start = closestBlock(range.startContainer, root);
  const end = closestBlock(range.endContainer, root);

  if (start && start === end) return normalizeText(start.textContent ?? '');

  const touched = Array.from(root.querySelectorAll<HTMLElement>([...BLOCK_TAGS].join(',')))
    .filter((block) => range.intersectsNode(block))
    // Drop blocks that merely contain other touched blocks (e.g. a <li> wrapping a <p>).
    .filter((block, _index, all) => !all.some((other) => other !== block && block.contains(other)));

  const joined = touched.map((block) => normalizeText(block.textContent ?? '')).filter(Boolean).join('\n\n');
  return joined || normalizeText(range.toString());
}

function templateFromDraft(draft: EventTemplate | NostrEvent): EventTemplate {
  return {
    kind: draft.kind,
    content: draft.content,
    tags: draft.tags,
    created_at: draft.created_at || Math.floor(Date.now() / 1000),
  };
}

async function createHighlightTemplate(
  selectedText: string,
  address: AddressPointer,
  article: NostrEvent,
  comment: string,
  context: string,
): Promise<EventTemplate> {
  let factory = HighlightFactory.create(selectedText, address);
  const trimmedComment = comment.trim();
  if (trimmedComment) factory = factory.comment(trimmedComment);
  // Emits the NIP-84 `context` tag. Skip it when the passage IS the whole
  // block — a context identical to the content adds bytes and tells a reader
  // nothing.
  const trimmedContext = context.trim();
  if (trimmedContext && trimmedContext !== selectedText) factory = factory.context(trimmedContext);
  factory = factory.modifyPublicTags((tags) => {
    const next = tags.some((tag) => tag[0] === 'p' && tag[1] === article.pubkey)
      ? tags
      : [...tags, ['p', article.pubkey, address.relays?.[0] ?? '', 'author']];
    return next.some((tag) => tag[0] === 'client') ? next : [...next, ['client', 'artcl-hl']];
  });

  const draft = (await factory) as EventTemplate | NostrEvent;
  return templateFromDraft(draft);
}

async function publishHighlight(template: EventTemplate): Promise<NostrEvent | null> {
  const result = (await outbox.publish(template)) as PublishResult;
  if (result?.ok === false) throw new Error(result.error ?? 'The shell rejected the highlight publish.');
  return result?.event ?? null;
}

interface ContextPreview {
  before: string;
  match: string;
  after: string;
}

interface HighlightComposerProps {
  open: boolean;
  selectedText: string;
  contextPreview: ContextPreview | null;
  comment: string;
  onCommentChange: (value: string) => void;
  articleTitle: string;
  articleAddress: string;
  publishState: PublishState;
  error: string;
  onCancel: () => void;
  onPublish: () => void;
}

/**
 * Full-surface confirmation step for a highlight. A native <dialog> gives the
 * focus trap and Esc handling for free; note that daisyUI's usual
 * `<form method="dialog">` close button is unusable here, because the napplet
 * iframe is `allow-scripts` only and the browser blocks form submission.
 */
function HighlightComposer({
  open,
  selectedText,
  contextPreview,
  comment,
  onCommentChange,
  articleTitle,
  articleAddress,
  publishState,
  error,
  onCancel,
  onPublish,
}: HighlightComposerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const publishing = publishState === 'publishing';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      commentRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-bottom sm:modal-middle"
      // Esc fires `cancel`; keep the React state the single source of truth.
      onCancel={(event) => {
        event.preventDefault();
        if (!publishing) onCancel();
      }}
      onClose={() => {
        if (open && !publishing) onCancel();
      }}
    >
      <div className="modal-box flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 border border-base-300 bg-base-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Preview highlight</p>
            <h2 className="mt-1 truncate text-xl font-black">{articleTitle || 'Untitled Article'}</h2>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Close"
            disabled={publishing}
            onClick={onCancel}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4">
            <blockquote className="rounded-box border-l-4 border-primary bg-base-200 p-4 text-base leading-relaxed">
              {selectedText}
            </blockquote>

            {contextPreview ? (
              <div className="grid gap-1">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-base-content/50">Context</p>
                <p className="whitespace-pre-line rounded-box bg-base-200 p-3 text-sm leading-relaxed text-base-content/60">
                  {contextPreview.before}
                  <mark className="rounded bg-primary/25 px-0.5 text-base-content">{contextPreview.match}</mark>
                  {contextPreview.after}
                </p>
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-bold">
              Comment <span className="font-normal text-base-content/50">optional — adds a quote-highlight comment</span>
              <textarea
                ref={commentRef}
                className="textarea textarea-bordered min-h-24 resize-y rounded-box text-sm font-normal focus:outline-primary"
                value={comment}
                disabled={publishing}
                onChange={(event) => onCommentChange(event.target.value)}
                placeholder="Why is this worth highlighting?"
              />
            </label>

            {articleAddress ? (
              <p className="break-all text-xs text-base-content/40">
                kind {HIGHLIGHT_KIND} → {articleAddress}
              </p>
            ) : null}

            {error ? (
              <p className="rounded-box bg-error/10 p-3 text-sm text-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="modal-action mt-0">
          <button className="btn btn-ghost rounded-full" disabled={publishing} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="btn btn-primary rounded-full px-6 font-black" disabled={publishing} onClick={onPublish} type="button">
            {publishing ? 'Publishing...' : 'Publish highlight'}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={() => !publishing && onCancel()} />
    </dialog>
  );
}

function App() {
  const [input, setInput] = useState('');
  const [configuredNaddr, setConfiguredNaddr] = useState('');
  const [decoded, setDecoded] = useState<DecodedArticle | null>(null);
  const [article, setArticle] = useState<NostrEvent | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [status, setStatus] = useState('Paste an article naddr or configure one in the shell.');
  const [selectedText, setSelectedText] = useState('');
  const [selectedContext, setSelectedContext] = useState('');
  const [comment, setComment] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [publishError, setPublishError] = useState('');
  const [heroUrl, setHeroUrl] = useState('');
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isNapDomainPresent('config')) return;
    let closed = false;

    let lastApplied: string | null = null;

    const applyConfig = (values: ConfigValues | null | undefined) => {
      if (closed) return;
      const naddr = typeof values?.naddr === 'string' ? values.naddr.trim() : '';
      // Only seed the field when the shell value actually changed; config
      // pushes are repeated, and blindly mirroring them wipes whatever the
      // user is mid-way through typing.
      if (naddr === lastApplied) return;
      lastApplied = naddr;
      setConfiguredNaddr(naddr);
      if (naddr) setInput(naddr);
    };

    // The config schema is manifest-declared in vite.config.ts (`configSchema`).
    // Do not also `config.registerSchema()` here: a second, divergent copy would
    // drop the manifest's minLength/maxLength/x-napplet-section annotations in
    // any host that lets a runtime registration win.
    void (async () => {
      try {
        applyConfig((await config.get()) as ConfigValues);
      } catch {
        // Manual input remains the fallback when shell config is unavailable.
      }
    })();

    let subscription: { close: () => void } | null = null;
    try {
      subscription = config.subscribe((values: unknown) => applyConfig(values as ConfigValues));
    } catch {
      subscription = null;
    }

    return () => {
      closed = true;
      subscription?.close();
    };
  }, []);

  const articleTitle = article ? getArticleTitle(article) || 'Untitled Article' : 'Article Highlights';
  const articleSummary = article ? getArticleSummary(article) : '';
  const publishedAt = article ? getArticlePublished(article) || article.created_at : 0;

  const submitNaddr = useCallback(
    async (value: string) => {
      setSelectedText('');
      setSelectedContext('');
      setComment('');
      setComposerOpen(false);
      setPublishState('idle');
      setPublishError('');
      setHeroUrl('');
      try {
        const nextDecoded = decodeArticleNaddr(value);
        setDecoded(nextDecoded);
        setArticle(null);
        setLoadState('loading');
        setStatus('Loading article through NAP-OUTBOX...');
        const loaded = await loadArticle(nextDecoded.address);
        setArticle(loaded);
        setLoadState('ready');
        setStatus('Select text in the article to create a NIP-84 highlight.');
      } catch (error) {
        setDecoded(null);
        setArticle(null);
        setLoadState('error');
        setStatus(getErrorMessage(error, 'Could not load that article.'));
      }
    },
    [],
  );

  useEffect(() => {
    if (configuredNaddr) void submitNaddr(configuredNaddr);
  }, [configuredNaddr, submitNaddr]);

  useEffect(() => {
    if (!article || !isNapDomainPresent('resource')) return;
    const image = getArticleImage(article);
    if (!image) return;

    let objectUrl = '';
    let cancelled = false;
    void (async () => {
      try {
        const blob = await resource.bytes(image);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setHeroUrl(objectUrl);
      } catch {
        setHeroUrl('');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [article]);

  const handleSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !articleRef.current) return;
    const range = selection.getRangeAt(0);
    const text = normalizeText(selection.toString());
    if (!text || !articleRef.current.contains(range.commonAncestorContainer)) return;
    setSelectedText(text.slice(0, 4000));
    setSelectedContext(contextForRange(range, articleRef.current).slice(0, 8000));
    setPublishState('idle');
  }, []);

  const openComposer = useCallback(() => {
    if (!selectedText) return;
    setPublishError('');
    setPublishState('idle');
    setComposerOpen(true);
  }, [selectedText]);

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    setPublishError('');
  }, []);

  const publishSelectedHighlight = useCallback(async () => {
    if (!decoded || !article || !selectedText || publishState === 'publishing') return;
    setPublishState('publishing');
    setPublishError('');
    setStatus('Creating NIP-84 highlight with Applesauce and asking the shell to publish...');
    try {
      const template = await createHighlightTemplate(selectedText, decoded.address, article, comment, selectedContext);
      if (template.kind !== HIGHLIGHT_KIND) throw new Error('Applesauce did not create a highlight event template.');
      const published = await publishHighlight(template);
      setPublishState('published');
      setComposerOpen(false);
      setComment('');
      setSelectedText('');
      setSelectedContext('');
      window.getSelection()?.removeAllRanges();
      setStatus(published ? `Highlight published: ${published.id.slice(0, 12)}...` : 'Highlight handed to the shell for publishing.');
    } catch (error) {
      // Keep the composer open so the draft and comment survive a failed publish.
      setPublishState('error');
      setPublishError(getErrorMessage(error, 'Could not publish the highlight.'));
      setStatus('Could not publish the highlight.');
    }
  }, [article, comment, decoded, publishState, selectedContext, selectedText]);

  const articleAddress = useMemo(() => decoded?.addressTag ?? '', [decoded]);

  // Splits the context paragraph around the highlighted passage so the sidebar
  // can show the quote in situ. Null when there is no distinct context to show.
  const contextPreview = useMemo<ContextPreview | null>(() => {
    if (!selectedContext || !selectedText || selectedContext === selectedText) return null;
    const at = selectedContext.indexOf(selectedText);
    if (at === -1) return { before: '', match: '', after: selectedContext };
    return {
      before: selectedContext.slice(0, at),
      match: selectedText,
      after: selectedContext.slice(at + selectedText.length),
    };
  }, [selectedContext, selectedText]);

  return (
    <main className="min-h-screen bg-base-100 px-3 py-3 text-base-content sm:px-5 sm:py-6">
      <section className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="card min-w-0 border border-base-300 bg-base-100 shadow-xl">
          <header className="card-body gap-4 border-b border-base-300 pb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">NIP-23 reader</p>
              <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-5xl">{articleTitle}</h1>
              {articleSummary ? <p className="mt-3 max-w-3xl text-pretty text-base text-base-content/70">{articleSummary}</p> : null}
            </div>

            {/*
              Deliberately not a <form>. The napplet iframe is `allow-scripts`
              only, so the browser blocks native form submission outright
              ("the form's frame is sandboxed and the 'allow-forms' permission
              is not set") — the submit event never fires and onSubmit never
              runs. Drive the action from the button and the Enter key instead.
            */}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" role="search">
              <label className="sr-only" htmlFor="naddr-input">Article naddr</label>
              <input
                id="naddr-input"
                className="input input-bordered min-w-0 rounded-full text-sm focus:outline-primary"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void submitNaddr(input);
                }}
                placeholder="nostr:naddr1..."
                spellCheck={false}
              />
              <button
                className="btn btn-primary rounded-full px-5 text-sm font-bold"
                disabled={loadState === 'loading'}
                onClick={() => void submitNaddr(input)}
                type="button"
              >
                {loadState === 'loading' ? 'Loading' : 'Open'}
              </button>
            </div>
            <p className="text-sm text-base-content/70" role="status">{status}</p>
          </header>

          <div className="card-body min-w-0">
          {heroUrl ? <img className="mb-6 h-64 w-full rounded-box object-cover" src={heroUrl} alt="" /> : null}

          {article ? (
            <article ref={articleRef} className="prose prose-lg max-w-none select-text prose-a:text-primary" onMouseUp={handleSelection} onKeyUp={handleSelection}>
              <p className="lead">
                By <code>{article.pubkey.slice(0, 12)}...</code>
                {publishedAt ? ` · ${new Date(publishedAt * 1000).toLocaleDateString()}` : ''}
              </p>
              <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents} urlTransform={urlTransform}>
                {article.content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="grid min-h-80 place-items-center rounded-box border border-dashed border-base-300 bg-base-200 p-8 text-center">
              <div className="max-w-md">
                <p className="text-5xl font-black text-primary">HL</p>
                <h2 className="mt-3 text-2xl font-black">Open an article naddr</h2>
                <p className="mt-2 text-base-content/70">The napplet reads the article through NAP-OUTBOX, renders Markdown with Tailwind Typography, and publishes selected passages as NIP-84 highlights.</p>
              </div>
            </div>
          )}
          </div>
        </div>

        <aside className="card min-w-0 border border-base-300 bg-base-200 shadow-xl">
          <div className="sticky top-4 grid gap-4">
          <div className="card-body gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Highlight</p>
              <h2 className="mt-1 text-2xl font-black">Selected text</h2>
            </div>
            {articleAddress ? <p className="break-all rounded-box bg-base-100 p-3 text-xs text-base-content/70">{articleAddress}</p> : null}
            <blockquote className="max-h-64 overflow-auto rounded-box border-l-4 border-primary bg-base-100 p-4 text-sm leading-relaxed">
              {selectedText || 'Select a passage in the article body to prepare a highlight.'}
            </blockquote>
            {selectedText ? <p className="text-xs text-base-content/50">Review the context and add a comment before publishing.</p> : null}
            <button
              className="btn btn-primary rounded-full px-5 text-sm font-black"
              disabled={!article || !selectedText}
              onClick={openComposer}
              type="button"
            >
              Create highlight
            </button>
          </div>
          </div>
        </aside>
      </section>

      <HighlightComposer
        open={composerOpen}
        selectedText={selectedText}
        contextPreview={contextPreview}
        comment={comment}
        onCommentChange={setComment}
        articleTitle={article ? articleTitle : ''}
        articleAddress={articleAddress}
        publishState={publishState}
        error={publishError}
        onCancel={closeComposer}
        onPublish={() => void publishSelectedHighlight()}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
createRoot(root).render(<App />);

window.addEventListener('pagehide', () => {
  themeHandle.close();
});
