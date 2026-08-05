/**
 * Following the shell theme, as something you can turn off.
 *
 * NAP-THEME is three colours and a shell is free to pick any three. Some pick
 * a near-black background, and theme-xp does exactly what it promises with
 * them: `--surface` and `--button-face` become that background, every bevel and
 * fieldset is re-derived around it, and the result is a correct, readable,
 * theme-obeying window that no longer looks like Windows XP at all.
 *
 * That is a real tension, not a bug -- "obey the shell" and "look like Luna"
 * genuinely conflict once the shell's palette is far from XP's -- and a
 * showcase is the one place it should be possible to see both sides of it. So
 * following is a switch, and authentic Luna is what the window falls back to,
 * which is exactly the state theme-xp is designed to degrade into anyway.
 *
 * A napplet that is not a showcase does not need this. It writes
 * `installThemeClient()` once and follows the shell, full stop.
 */
import { buildXpThemeVariables, installThemeClient } from '@napplelets/theme-xp';

/**
 * Every property `installThemeClient()` writes to `<html>`.
 *
 * The mapping's key set does not depend on its input -- the same tokens come
 * out whatever three colours go in -- so a dummy triple names all of them
 * without needing a payload in hand. Deriving the list rather than restating it
 * means a token added to the theme package is cleaned up here for free.
 */
const MANAGED: readonly string[] = [
  ...Object.keys(
    buildXpThemeVariables({ background: '#000000', text: '#000000', primary: '#000000' }),
  ),
  // Written from `fonts.body.name`, and not part of the colour mapping.
  '--xp-font-body',
];

export type ThemeFollower = {
  /** Idempotent: safe to call with the state it is already in. */
  set(following: boolean): void;
  dispose(): void;
};

export function createThemeFollower(): ThemeFollower {
  let client: { close(): void } | null = null;

  /**
   * Undoes an apply. The client removes its own inline values when a payload
   * stops being usable, but nothing asks it to let go while a *good* payload is
   * still in force -- so switching off does that by hand, over the same key set
   * the client owns.
   */
  function stopFollowing(): void {
    client?.close();
    client = null;
    const style = document.documentElement.style;
    for (const name of MANAGED) style.removeProperty(name);
    // Authentic Luna is a light theme; the client sets this too.
    document.documentElement.dataset.xpTheme = 'light';
  }

  return {
    set(following) {
      if (following) {
        // Re-installing re-runs `theme.get`, so switching back on repaints from
        // the shell's current theme rather than from whatever was last seen.
        client ??= installThemeClient();
      } else {
        // Unconditional, not `if (client)`: switching off has to leave a clean
        // `<html>` whether or not this napplet is the one that dirtied it.
        stopFollowing();
      }
    },
    dispose: stopFollowing,
  };
}
