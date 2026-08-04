# Kind 1989: Minesweeper game results

## Summary

Minesweeper game results are regular Nostr events of kind `1989`. Each event is
an independently feedable completed game, not replaceable application data.
The number commemorates the year Minesweeper is commonly credited as being
invented. It was unassigned in the public Nostr event-kind registry when this
experimental schema was selected in August 2026.

## Event

`content` is an optional, user-authored plain-text message. Clients must not
interpret it as JSON or derive game state from it.

All machine-readable game data is carried by tags:

```json
{
  "kind": 1989,
  "content": "That last corner got me!",
  "tags": [
    ["result", "lost"],
    ["difficulty", "beginner"],
    ["duration", "42"],
    ["width", "9"],
    ["height", "9"],
    ["mine_count", "10"],
    ["mines", "0,1,2,3,4,5,6,7,8,9"],
    ["revealed", "0,10,11"],
    ["flags", "1"],
    ["exploded", "0"],
    ["alt", "Minesweeper game result"]
  ]
}
```

## Tag definitions

- `result`: exactly `won` or `lost`.
- `difficulty`: exactly `beginner`, `intermediate`, or `expert`.
- `duration`: elapsed whole seconds as a non-negative base-10 integer.
- `width`, `height`, `mine_count`: preset board dimensions and mine count as
  non-negative base-10 integers.
- `mines`, `revealed`, `flags`: comma-separated, unique, zero-based cell indexes
  in row-major order. An empty value represents an empty list.
- `exploded`: the exploded mine's zero-based index for a loss, or an empty value
  for a win.
- `alt`: exactly `Minesweeper game result`.

Each named tag must appear exactly once. The supported presets are 9×9 with 10
mines, 16×16 with 40 mines, and 30×16 with 99 mines. Readers should reject
unknown dimensions, duplicate or out-of-range indexes, a mine count mismatch,
an exploded cell that is not a mine, or a result inconsistent with `exploded`.

## Trust model

Results are self-reported final-board snapshots. This schema does not claim
proof of fair play or provide anti-cheat guarantees. Coordinate upstream kind
registration before treating kind `1989` as stable across applications.
