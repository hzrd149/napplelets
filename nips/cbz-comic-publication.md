# NIP-XX

## CBZ Comic Publication

`draft` `optional`

This NIP defines an addressable event for publishing metadata about an existing
comic book publication distributed as a CBZ file. The event is intended to let
clients upload, discover, browse, favorite, and read CBZ comics using relay
indexable metadata while keeping the comic archive itself outside the event.

The event describes one comic publication as one CBZ file. It is not a general
comic work record, a page manifest, or a replacement for file metadata events.

## Event kind

This NIP uses addressable event kind `35641`.

```json
{
  "kind": 35641,
  "content": "Batman #1 (2016)\nI Am Gotham, Part One\n\nPublished by DC Comics. Written by Tom King and pencilled by David Finch.",
  "tags": [
    ["d", "cbz:dc-comics:batman:2016:1:en"],

    ["url", "https://cdn.example.com/batman-2016-001.cbz"],
    ["m", "application/vnd.comicbook+zip"],
    ["x", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["size", "73400320"],
    ["thumb", "https://cdn.example.com/batman-2016-001-thumb.jpg", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],

    ["c", "publisher:dc-comics"],
    ["c", "series:batman"],
    ["c", "volume:2016"],
    ["c", "number:1"],
    ["c", "language:en"],
    ["c", "year:2016"],
    ["c", "month:6"],
    ["c", "genre:superhero"],
    ["c", "writer:tom-king"],
    ["c", "penciller:david-finch"],
    ["c", "manga:no"],
    ["c", "black-and-white:no"],
    ["c", "issue:dc-comics|batman|2016|1|en"],

    ["Publisher", "DC Comics"],
    ["Series", "Batman"],
    ["Number", "1"],
    ["Volume", "2016"],
    ["Count", "85"],
    ["Title", "I Am Gotham, Part One"],
    ["LanguageISO", "en"],
    ["Year", "2016"],
    ["Month", "6"],
    ["Day", "15"],
    ["PageCount", "28"],
    ["Genre", "Superhero", "Action"],
    ["Writer", "Tom King"],
    ["Penciller", "David Finch"],
    ["Inker", "Matt Banning"],
    ["Colorist", "Jordie Bellaire"],
    ["Letterer", "John Workman"],
    ["CoverArtist", "David Finch"],
    ["Editor", "Mark Doyle"],
    ["Manga", "No"],
    ["BlackAndWhite", "No"],
    ["AgeRating", "Teen"],
    ["StoryArc", "I Am Gotham"],
    ["Character", "Batman", "Gotham Girl"],

    ["alt", "Batman #1, 2016, DC Comics"]
  ]
}
```

## Address

The `d` tag identifies the comic publication metadata record under the author's
pubkey. It MUST be derived from normalized metadata, not from the CBZ file hash.

The `d` value SHOULD use this form:

```text
cbz:<publisher>:<series>:<volume>:<number>:<language>
```

Each segment after `cbz:` MUST use the normalization algorithm defined in this
NIP. Unknown segments SHOULD be left empty while preserving separators.

Examples:

```json
["d", "cbz:dc-comics:batman:2016:1:en"]
["d", "cbz::batman::1:en"]
```

The CBZ file hash MUST NOT be used as the `d` tag. It MUST be published in an
`x` tag instead. This lets the author replace metadata or point to a corrected
CBZ for the same publication address.

## Content

The `content` field SHOULD contain a human-readable description of the comic
publication. It MAY include the series, issue number, title, publisher, creator
credits, and summary.

Clients MUST NOT parse `content` to recover structured metadata. Structured
metadata MUST be read from tags.

## File tags

The event MUST include these file tags:

- `url`: URL where the CBZ file can be downloaded.
- `m`: MIME type. The preferred value is `application/vnd.comicbook+zip`.
- `x`: lowercase hex SHA-256 hash of the CBZ file bytes.

The event SHOULD include these file tags when known:

- `size`: CBZ file size in bytes.
- `thumb`: cover thumbnail URL, with optional lowercase hex SHA-256 hash as the
  third element.
- `image`: larger cover preview URL, with optional lowercase hex SHA-256 hash as
  the third element.
- `fallback`: alternate URL where the same CBZ file can be downloaded.
- `summary`: short human-readable summary or excerpt.
- `alt`: accessible description of the publication or cover.

`application/x-cbz` MAY be used for compatibility if the preferred MIME type is
not available. `application/zip` SHOULD be avoided unless the uploader cannot
identify the file as a comic book archive.

## Indexable comic metadata

The `c` tag is reserved for normalized, relay-indexable comic metadata.

The second element of each `c` tag MUST have this form:

```text
<field>:<normalized-value>
```

The `c` tag MUST NOT be used for display values. Display metadata belongs in the
ComicInfo-style tags defined below.

Clients SHOULD include `c` tags for every known field that they expect users to
filter by. Clients MAY include multiple `c` tags with the same field for
multi-value fields such as `genre` or creator roles.

Events MUST include `c` tags for `series` and `number`. Events SHOULD include
`c` tags for `publisher`, `volume`, and `language` when known because those
fields are used to construct the recommended address. Unknown address segments
SHOULD be omitted from `c` tags rather than published as placeholder values.

### Recommended `c` fields

- `publisher`
- `series`
- `number`
- `volume`
- `count`
- `language`
- `year`
- `month`
- `page-count`
- `genre`
- `manga`
- `black-and-white`
- `writer`
- `penciller`
- `inker`
- `colorist`
- `letterer`
- `cover-artist`
- `editor`

Clients SHOULD also include a composite issue tag:

```text
issue:<publisher>|<series>|<volume>|<number>|<language>
```

The composite issue tag is useful for exact lookups and for relays that do not
support AND filters.

Examples:

```json
["c", "publisher:dc-comics"]
["c", "series:batman"]
["c", "number:1"]
["c", "volume:2016"]
["c", "language:en"]
["c", "genre:superhero"]
["c", "writer:tom-king"]
["c", "issue:dc-comics|batman|2016|1|en"]
```

## NIP-91 queries

Clients and libraries that support NIP-91 SHOULD query exact metadata
intersections with `&c` and SHOULD also include the same values in `#c` for
compatibility with relays that do not support NIP-91.

Example query for one publication:

```json
{
  "kinds": [35641],
  "&c": [
    "publisher:dc-comics",
    "series:batman",
    "volume:2016",
    "number:1",
    "language:en"
  ],
  "#c": [
    "publisher:dc-comics",
    "series:batman",
    "volume:2016",
    "number:1",
    "language:en"
  ]
}
```

Clients SHOULD locally post-filter results according to the `&c` values. This is
required for compatibility with relays that ignore NIP-91 and return the broader
OR result from `#c`.

## ComicInfo-style metadata tags

Common ComicInfo.xml fields SHOULD be represented as non-indexable key/value
array tags whose names stay as close as possible to ComicInfo field names. These
tags are for display, interchange, and reconstructing a ComicInfo-like record.
Clients MUST NOT assume relays index these tags.

All tag values MUST be strings. Numeric and boolean-like ComicInfo values MUST be
encoded as their string representation. The first element is the ComicInfo-style
field name and every later element is a value for that field.

When a ComicInfo field contains multiple values, clients SHOULD publish one tag
with multiple values after applying the field's conventional splitting rules. For
example, a ComicInfo `Genre` value of `Superhero, Action` SHOULD become:

```json
["Genre", "Superhero", "Action"]
```

Clients SHOULD NOT publish placeholder values such as `Unknown Publisher` for
missing metadata. Missing values SHOULD be omitted.

### Strongly recommended fields

- `Series`
- `Number`
- `Title`
- `Publisher`
- `Volume`
- `Count`
- `LanguageISO`
- `Year`
- `Month`
- `Day`
- `PageCount`
- `Genre`
- `Manga`
- `BlackAndWhite`

### Creator fields

- `Writer`
- `Penciller`
- `Inker`
- `Colorist`
- `Letterer`
- `CoverArtist`
- `Editor`

### Additional common fields

- `SeriesGroup`
- `AlternateSeries`
- `AlternateNumber`
- `AlternateCount`
- `StoryArc`
- `StoryArcNumber`
- `AgeRating`
- `Format`
- `Imprint`
- `Character`
- `Team`
- `Location`
- `Web`

Long free-text fields such as `Summary` and `Notes` SHOULD NOT be copied into
ComicInfo-style tags by default. The event `content` and the optional `summary`
tag are preferred for human-readable prose.

## Normalization

The normalization algorithm is used for `d` tag segments, `c` tag values, and
the composite `issue` value.

For text-like fields such as `Series`, `Publisher`, `Genre`, and creator names,
clients SHOULD normalize values as follows:

1. Normalize Unicode to NFKC.
2. Trim leading and trailing whitespace.
3. Collapse internal whitespace to one ASCII space.
4. Apply Unicode case folding.
5. Replace `&` with `and`.
6. Remove apostrophes.
7. Replace all runs of characters that are not letters or numbers with `-`.
8. Collapse repeated `-` characters.
9. Trim leading and trailing `-` characters.

Examples:

```text
DC Comics -> dc-comics
Tom King -> tom-king
Batman / Superman -> batman-superman
The Amazing Spider-Man -> the-amazing-spider-man
```

For issue numbers, clients SHOULD normalize values as follows:

1. Normalize Unicode to NFKC.
2. Trim leading and trailing whitespace.
3. Apply Unicode case folding.
4. If the value is purely decimal digits, remove leading zeroes while preserving
   `0` as `0`.
5. Replace all runs of characters that are not letters or numbers with `-`.
6. Collapse repeated `-` characters.
7. Trim leading and trailing `-` characters.

Examples:

```text
001 -> 1
1.BEY -> 1-bey
0.5 -> 0-5
```

For `LanguageISO`, clients SHOULD lowercase the language code and SHOULD prefer
BCP 47 compatible language tags when available.

For boolean-like fields, `c` values MUST use normalized values:

- `yes`
- `no`
- `unknown`
- `yes-and-right-to-left`

## Page metadata

This event SHOULD NOT include a page manifest, page file names, page dimensions,
per-page hashes, or embedded image data. Clients that need page-level metadata
SHOULD download and inspect the CBZ file.

## Uploader behavior

Uploaders SHOULD:

1. Verify the file is a CBZ archive.
2. Read ComicInfo.xml when present.
3. Compute the SHA-256 hash of the CBZ bytes.
4. Upload the CBZ bytes to one or more file hosts.
5. Generate and upload a cover thumbnail when practical.
6. Publish required file tags, normalized `c` tags, and ComicInfo-style display
   tags.
7. Generate human-readable `content` from ComicInfo fields unless the user
   provides custom prose.

Uploaders MAY publish events for CBZ files without ComicInfo.xml if enough
metadata is supplied by the user to construct the `d` tag and required `c` tags.

## Browser and reader behavior

Browser clients SHOULD use `c` tags for relay queries and ComicInfo-style tags
for display. They SHOULD use NIP-91 `&c` filters when available and SHOULD
post-filter results locally.

Reader clients SHOULD download the CBZ only when the user chooses to read,
verify, or inspect page-level data. Reader clients SHOULD verify the downloaded
bytes against the `x` hash when practical.

Clients that favorite, bookmark, annotate, or track reading progress SHOULD
reference this event with an `a` tag:

```json
["a", "35641:<pubkey>:cbz:dc-comics:batman:2016:1:en"]
```
