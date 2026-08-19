/**
 * The end-of-run panel: ACCESS DENIED, ACCESS GRANTED, or "no target".
 *
 * The centrepiece is the diff. A single "matched 3 / 64" number is abstract;
 * two npubs stacked with their agreeing characters picked out shows, at a
 * glance, that the guess is noise. That is the joke landing.
 *
 * The granted branch is real code on a real path -- the miner can genuinely
 * report a match -- it is simply never reached, because the search space is
 * 2^256. It is written as if it could happen because that is the only honest
 * way to write it.
 */

import { gsap } from 'gsap';
import { describeDiff, diffNpub, type DiffCell } from '../lib/diff.js';
import { formatPrefix } from '../lib/format.js';
import { toNpub, toNsec } from '../lib/keys.js';
import type { Phase } from '../lib/machine.js';
import type { Candidate } from '../lib/miner.js';

export interface ResultRefs {
  panel: HTMLElement;
  title: HTMLElement;
  note: HTMLElement;
  targetRow: HTMLElement;
  targetChars: HTMLElement;
  guessChars: HTMLElement;
  summary: HTMLElement;
  nsecRow: HTMLElement;
  nsec: HTMLElement;
}

const NOTES: Record<string, string> = {
  denied:
    'Not even close. That is the entire point: there are more possible keys than atoms in the observable universe, and you just tried a few thousand of them.',
  granted:
    'This did not happen. If you are somehow reading this, the key below is shown once and was never stored, published, or given to a signer.',
  'no-target':
    'No public key was connected, so there was nothing to compare against. Connect an identity in the shell and the guesses will at least have a target to miss.',
};

/** Render one npub as per-character spans, matching positions picked out. */
function paint(host: HTMLElement, prefix: string, cells: DiffCell[]): void {
  const fragment = document.createDocumentFragment();

  if (prefix.length > 0) {
    const shared = document.createElement('span');
    shared.className = 'pre';
    shared.textContent = prefix;
    fragment.append(shared);
  }

  for (const cell of cells) {
    const span = document.createElement('span');
    span.className = cell.hit ? 'hit' : 'miss';
    span.textContent = cell.char;
    fragment.append(span);
  }

  host.replaceChildren(fragment);
}

/** No target to compare against: show the guess plainly, claim nothing. */
function paintPlain(host: HTMLElement, npub: string): void {
  const span = document.createElement('span');
  span.className = 'miss';
  span.textContent = npub;
  host.replaceChildren(span);
}

export function showResult(
  refs: ResultRefs,
  phase: Phase,
  best: Candidate | null,
  target: string | null,
  reducedMotion: boolean,
): void {
  const title =
    phase === 'granted' ? 'ACCESS GRANTED' : phase === 'no-target' ? 'NO TARGET' : 'ACCESS DENIED';

  refs.title.textContent = title;
  refs.note.textContent = NOTES[phase] ?? '';

  const guessNpub = best === null ? '' : toNpub(best.pubkey);
  const targetNpub = target === null ? null : toNpub(target);

  if (targetNpub === null || guessNpub === '') {
    refs.targetRow.hidden = true;
    paintPlain(refs.guessChars, guessNpub === '' ? '--' : guessNpub);
    refs.summary.textContent = 'no target to compare against';
  } else {
    const diff = diffNpub(guessNpub, targetNpub);
    refs.targetRow.hidden = false;
    paint(refs.targetChars, diff.prefix, diff.target);
    paint(refs.guessChars, diff.prefix, diff.guess);
    refs.summary.textContent = `${describeDiff(diff)} · longest hex prefix ${formatPrefix(
      best?.matchedPrefix ?? 0,
    )}`;
  }

  // The secret key is only ever rendered on an actual match, and even then it
  // goes no further than this text node.
  const granted = phase === 'granted' && best !== null;
  refs.nsecRow.hidden = !granted;
  refs.nsec.textContent = granted ? toNsec(best.secret) : '';

  refs.panel.hidden = false;

  if (reducedMotion) {
    gsap.set(refs.panel, { opacity: 1 });
    return;
  }

  gsap.fromTo(
    refs.panel,
    { opacity: 0 },
    { opacity: 1, duration: 0.25, ease: 'power1.out', overwrite: 'auto' },
  );
  gsap.fromTo(
    refs.title,
    { scale: 0.86, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)', overwrite: 'auto' },
  );
  // The agreeing characters arrive after the verdict, so the eye reads the
  // headline first and then finds the handful of accidental hits.
  gsap.fromTo(
    refs.guessChars.querySelectorAll('.hit'),
    { opacity: 0.35 },
    { opacity: 1, duration: 0.3, stagger: 0.04, delay: 0.35, ease: 'none', overwrite: 'auto' },
  );
}

export function hideResult(refs: ResultRefs): void {
  gsap.killTweensOf([refs.panel, refs.title]);
  refs.panel.hidden = true;
  refs.nsec.textContent = '';
  refs.nsecRow.hidden = true;
}
