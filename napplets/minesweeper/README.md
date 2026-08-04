# Minesweeper

A compact Windows XP-style Minesweeper napplet. It includes the classic Beginner,
Intermediate, and Expert boards, first-click safety, flags, number chording, a mine
counter, timer, and live win/loss feedback.

The implementation is inspired by [Benaou/xp-minesweeper](https://github.com/Benaou/xp-minesweeper)
and is original TypeScript/CSS; it does not include that project's sprite sheet.

## Shell boundaries

- `config` exposes `windowFrame`, defaulting to `true`. Turn it off when the host
  shell already provides a frame.
- The bundled Windows XP theme deliberately does not consume NAP-THEME, keeping
  the classic Luna colors unchanged by the host palette.
- Completed games remain private until the user selects **Publish Result**. The
  shell signs and publishes regular kind `1989` events through NAP-OUTBOX.
- The Friends view reads kind `1989` events for the signed-in user and their
  one-hop follows through NAP-IDENTITY and NAP-OUTBOX. NAP-COMMON provides
  optional display names; direct relay and network access are not used.
- Results are self-reported final-board snapshots, not anti-cheat proofs. The
  experimental wire contract is documented in `NIP.md` beside this README.

## Controls

- Click/tap: reveal a square.
- Right-click: place or remove a flag.
- Double-click or middle-click a revealed number: chord its neighbors when the
  matching number of flags has been placed.
- Face button: restart the current difficulty.

## Verify

```bash
pnpm --filter minesweeper verify
pnpm --filter minesweeper test:conformance
```
