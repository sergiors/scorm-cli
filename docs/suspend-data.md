# Player state and SCORM suspend data

This describes the implementation in this repository, including questionnaire
retry history and video positions. It is not a separate format specification: the codec,
packaged manifest, parser IDs, player sanitizer, and SCORM runtime are the
behavioral sources of truth.

## Ownership and end-to-end flow

The player owns a readable semantic `PlayerState`, keyed by authored IDs and
answer values. It restores through `window.scormBridge.restoreState()`, then
validates the returned object against the current content AST with
`sanitizePlayerState`. Every real state change is sent with the current integer
package progress through `window.scormBridge.saveState(state, progress)`. The
generated runtime uses the state to recompute package progress with
`progressFor(state)` from its packaged content manifest before encoding; it does
not use the renderer-supplied progress argument. The Node
`encodeSuspendData(manifest, state, progress)` API does take an explicit progress
argument. The renderer does not serialize suspend data.

The runtime uses the packaged `content-manifest.json` dictionary to do this:

```text
Renderer: scormBridge.saveState(state, progress)
  → generated runtime: progressFor(state) from packaged content manifest
  → browser codec: encode(manifest, state, progressFor(state))
  → compact object { v, p, x, s?, d? }
  → JSON.stringify(compact object)
  → cmi.suspend_data

cmi.suspend_data → JSON parse / decodeSuspendData(current manifest)
  → semantic PlayerState with the CMI location decoded into a page/item and optional anchor
  → renderer sanitizePlayerState(current content AST)
  → player
```

Both SCORM versions use the exact same `cmi.suspend_data` field and the same
compact codec. Version-specific fields only affect location and other runtime
CMI elements:

| SCORM version | Location field             | Maximum serialized suspend-data length |
| ------------- | -------------------------- | -------------------------------------: |
| 1.2           | `cmi.core.lesson_location` |                                   4096 |
| 2004          | `cmi.location`             |                                  64000 |

The runtime checks JavaScript string `.length` on the serialized JSON. If it is
over the limit, it does **not** call `SetValue` for `cmi.suspend_data`, emits
`lms.suspend-data-too-large` when devtools logging is enabled, still attempts
the location write (if supplied) and commit, and returns `false`. It does not
truncate the payload. A suspend-data `SetValue` that throws or returns anything
other than the exact string `"true"` also makes `saveState` return `false`; the
runtime still attempts commit. Commit failure also makes the result false. The
runtime updates its in-memory `resumeState` to the normalized encode/decode
result even when the LMS write was rejected or too large. An unavailable or
uninitialized LMS API makes `saveState` return false without saving.

At startup the runtime reads the version-specific location and
`cmi.suspend_data`, decodes the latter through the current packaged manifest,
and attaches the location separately. `restoreState()` normalizes resume state
through the codec once more and reattaches that location. The renderer then
sanitizes the semantic result against the AST. An absent or malformed suspend
value decodes to `{ pages: {} }`; the CMI location remains a separate value.

## Semantic state versus compact state

The current public types in `packages/core/src/index.ts` are:

```ts
export type AnswerValue = string | string[]

export interface PlayerPageState {
  visited?: boolean
  completed?: boolean
  answers?: Record<string, AnswerValue>
  submittedQuestionnaires?: string[]
  /** Correct-question counts for completed submissions, keyed by questionnaire ID. */
  questionnaireAttempts?: Record<string, number[]>
  /** IDs of questionnaires whose submitted result is completed. */
  completedQuestionnaires?: string[]
  /** IDs of questionnaires currently active in a retry. */
  activeQuestionnaireRetries?: string[]
  /** Playback positions in semantic seconds, keyed by stable video node ID. */
  videos?: Record<string, number>
}

export interface PlayerState {
  /** Optional non-negative safe-integer shuffle seed. */
  shuffleSeed?: number
  location?: string
  /** Reading anchor within location; persisted with it in the CMI location field. */
  anchor?: string
  pages: Record<string, PlayerPageState>
}
```

Video positions belong to the Page/Item that currently owns each video. Within
that page's `PlayerPageState.videos`, positions are keyed by stable video node
ID; there is no root-level `PlayerState.videos` map.

`location` and its optional reading `anchor` are **not** in compact data. The
SCORM runtime reads and writes them together in `cmi.core.lesson_location` (1.2)
or `cmi.location` (2004), using `page-or-item-id#anchor` when an anchor is
present. The renderer decodes that value and accepts only a page/item ID that
matches the current content; legacy page-only locations remain valid.

What the compact data does and does not preserve:

- `x` stores one visited bit per manifest page/item, in manifest order. It does
  not store node IDs in this bit string.
- Optional root `s` stores `PlayerState.shuffleSeed` when it is a non-negative
  safe integer. Invalid `s` values are ignored without changing the v1 payload
  version or the contents/meaning of `d`.
- `p` stores the integer package percentage passed to the encoder, rounded and
  clamped to 0–100. The Node `encodeSuspendData` API takes this as an explicit
  argument. In the generated runtime, `progressFor(state)` derives it from the
  packaged manifest: Scroll and Slides progress counts completed pages; Tiles
  progress counts visited items. The renderer also supplies progress to
  `saveState`, but the generated runtime recomputes it from state.
- Decoding `p` reconstructs completion flags for sequential page presentations
  (Scroll and Slides) by marking the first `round(p * pageCount / 100)` manifest
  entries completed and visited. Tiles completion is not reconstructed from `p`;
  its progress uses the `x` visited bits. Therefore per-page `completed` flags
  are not independently encoded, and sequential completion is necessarily
  positional/lossy.
- `d` is a single flat map for the current v1 format. Each key is
  `<pageIndex>.<kind>.<entityIndex>` where `kind` is `a` (answer), `t` (video
  position), `q` (questionnaire attempt history), `r` (active retry marker), or
  `c` (completed questionnaire marker). Answer selections are manifest option
  indexes, video positions are integer deciseconds, and `q` values are arrays of
  correct-question counts for completed submissions, correct or not, in
  submission order. The array length is the number of consumed submissions;
  each count is bounded by the questionnaire's question count, and history
  length is bounded by authored `maxAttempts` unless it is `-1` (unlimited).
  An `r` value of `1` marks a questionnaire currently being retried and is only
  restored when its history leaves an attempt available. A `c` value of `1`
  records completion separately from submitted status; it is encoded only
  alongside a valid `q` history and restored only when that history is valid for
  the current questionnaire. `c` is a marker, not an attempt counter or score.
  A `q` history alone never implies completion. Answers do not store
  question IDs, answer strings, labels, correctness, prompts, or questionnaire
  IDs. Video positions use page-local manifest video indexes in their keys;
  semantic positions are seconds rounded to tenths (for example, `132.5`
  seconds encodes as `1325` and decodes as `132.5` seconds). Empty/unknown
  values are omitted from the map; `d` is omitted when no valid answers, video
  positions, or questionnaire histories remain. The compact codec supports only
  the current flat layout; a payload using the earlier nested
  `d[pageIndex].a`/`.t` shape is not decoded and restores no answers, attempt
  histories, retry/completion markers, or video positions (see
  [Format versions](#format-versions)).
- `submittedQuestionnaires` is not encoded. Codec decode alone restores valid
  `q` history as `questionnaireAttempts` and a valid `c` marker as
  `completedQuestionnaires`; it does not restore submission status. The renderer
  sanitizer retains valid explicit submission IDs and otherwise infers submitted
  status from a valid `q` history or completed state, unless that questionnaire
  is in `activeQuestionnaireRetries`. An active retry remains editable and is not
  submitted. If submission is known but legacy attempt history is absent, the
  sanitizer seeds one history entry from current sanitized answers. These rules
  never infer completion: only `c`/explicit
  `completedQuestionnaires` restores that state, never `q`, submission status, or
  page completion.
- `questionnaireAttempts` stores correct counts only for completed submissions,
  whether correct or not; an in-progress attempt does not append history. `activeQuestionnaireRetries`
  marks an in-progress retry separately from submitted status. Both are restored
  through current manifest questionnaire indexes and stable IDs.
- `completedQuestionnaires` stores completion by stable questionnaire ID,
  separately from submitted status. The codec restores it only from a valid `c`
  marker paired with valid `q` history; it never infers completion from history,
  submission status, or an active retry marker. Completion happens automatically
  after a perfect submission or, for a finite allowance, when the learner
  exhausts the attempt allowance;
  the learner can also complete a submitted result manually before then.
- Completion gates node completion separately from submission and node progress.
  A Scroll/Slides page cannot remain or become completed while any questionnaire
  result on it is pending. Package-completed status additionally requires every
  authored questionnaire to be completed across all presentations, including
  Tiles. This does not change the existing done-node, package-progress, or
  navigation rules: for example, a Tiles item still counts
  as visited when opened, even if that keeps package completion gated.
- There is no score field in `PlayerState` or compact suspend data. Aggregate
  questionnaire score is derived from current authored questions/options. A
  questionnaire contributes neither earned nor possible points until completed,
  regardless of saved answers or submitted history. Once completed, it contributes
  its best submitted correct-count result. The UI summary shows the latest submitted
  attempt, which can differ from the best attempt used by the aggregate.
  The parser normalizes `maxAttempts` to a required numeric value, defaulting to
  `1`; `-1` means unlimited attempts. Completion is automatic after a perfect
  submission or finite attempt exhaustion, and can be manually selected earlier.
  `contributesToScore={false}` questionnaires
  remain excluded. The separate SCORM bridge reports the aggregate through
  `setScore` and version-specific CMI score fields.

`emptyPlayerState()` in `packages/renderer-react/app/lib/player-state.ts`
returns `{ pages: {} }`. The compact empty payload depends on the manifest: for
a two-entry manifest it is exactly `{"v":1,"p":0,"x":"00"}`; with no entries
it is `{"v":1,"p":0,"x":""}`. Optional `d` is absent when empty.

## Compact format and examples

`CompactSuspendData` is declared in `packages/scorm/src/state-codec.ts`. It is
the one supported shape, the flat v1 layout:

```ts
interface CompactSuspendData {
  v: 1 // sole supported compact format version
  p: number // rounded/clamped integer package progress
  x: string // manifest-order visited bits
  s?: number // optional non-negative safe-integer shuffle seed
  d?: {
    // key: `${pageIndex}.${kind}.${entityIndex}`
    [key: string]: number | number[] // a: option indexes; t: deciseconds; q: correct counts; r/c: 1
  }
}
```

Page, question, questionnaire, and option indexes are zero-based positions in
the manifest. Question and questionnaire indexes are local to a page, and
option indexes are local to a question. The decoder maps those indexes through that page's current manifest
entry to recover semantic page/question IDs and option `value`s. A single-choice
or true-false selection is encoded as one number; a multiple-choice selection
is an array of option indexes sorted numerically. On decode, selections are
deduplicated, filtered to valid indexes, sorted, then mapped to option values.
As a result, multiple-choice values return in authored option order, not in the
learner's selection order.

### Format versions

`v` identifies the payload layout and is validated as part of decoding:

- `v: 1` is the flat layout and the only supported version. `d` keys are
  `<pageIndex>.<kind>.<entityIndex>` with exactly three segments: two canonical
  non-negative safe-integer indexes around a kind of `a`, `t`, `q`, `r`, or `c`.
- Any other `v` is unsupported: the whole payload is rejected and decoding
  returns a fresh `{ pages: {} }` state. There is no versioned decode path.

An earlier revision of the compact format reused `v: 1` but nested `d` under
`d[pageIndex] = { a, t }`. Because that nested shape is not the flat layout, its
entries are not decoded and no answers or video positions are restored. The
top-level `p` and `x` fields are unaffected and still decode normally.

The following small payloads are produced by the current Node
`encodeSuspendData` implementation (the same code used by the browser runtime).

### Empty state

For a manifest containing two pages, semantic `{ pages: {} }` and progress `0`
produce:

```json
{ "v": 1, "p": 0, "x": "00" }
```

Decoding that payload returns `{ "pages": {} }`.

### Visited state and navigation location

With the two manifest entries `page-one`, `page-two`, a semantic state with
`location: "page:next"` and only `page-two.visited === true`, encoded with
progress `0`, produces:

```json
{ "v": 1, "p": 0, "x": "01" }
```

The decoded compact state is `{ "pages": { "page-two": { "visited": true } } }`.
`page:next` is not part of that JSON: it is written separately to the
version-specific CMI location field. This is the behavior asserted by
`packages/scorm/src/__tests__/state-codec.test.ts`.

### Answers

In the codec test manifest, `page-one` question `q1` has options
`red` (index 0), `blue` (index 1), and `green` (index 2). A state with
`page-one.visited`, `page-one.completed`, and answer `q1: ["green", "red"]`,
plus `page-two` answer `q1: ["blue"]`, encoded with progress 50, produces:

```json
{ "v": 1, "p": 50, "x": "10", "d": { "0.a.0": [0, 2], "1.a.0": [1] } }
```

The first page gets `completed: true` from `p: 50` for this two-page Scroll
manifest. Decoded answers are `q1: ["red", "green"]` and `q1: ["blue"]`,
respectively. The input answer order is normalized by option index.

### Questionnaire attempts and active retry

For questionnaire index `0` on page index `0`, the history `[1, 2]` records two
submitted attempts with one and two correct answers. An active retry marker is
stored separately:

```json
{ "v": 1, "p": 0, "x": "0", "d": { "0.q.0": [1, 2], "0.r.0": 1 } }
```

The manifest maps that index to the semantic questionnaire ID and supplies its
attempt/question bounds. History length, not a separate counter, determines how
many submissions have been consumed. The `r` marker does not add to that count.
Attempt history is separate from completion: without a `c` marker, a submitted
questionnaire can remain pending and is excluded from aggregate score, including
its possible-question count. The marker is written automatically for a perfect
submission or exhausted attempts, or when the learner completes the result
manually earlier.

### Completed questionnaire

For a questionnaire whose valid attempt history is `[1, 2]`, a completion marker
is stored alongside (not instead of) that history:

```json
{ "v": 1, "p": 0, "x": "0", "d": { "0.q.0": [1, 2], "0.c.0": 1 } }
```

On decode, the current manifest resolves the questionnaire index and ID. The
codec restores `completedQuestionnaires` only if the matching `q` entry also
passes its history bounds; a `c` marker without valid history, with a value other
than `1`, or for an unknown/invalid questionnaire is ignored. The marker does
not directly encode submitted status, and `q` history without `c` never implies
completion. The renderer separately infers submitted status from valid history.
Once completed, the aggregate uses the best submitted history, while the UI
summary displays the latest submitted attempt. `maxAttempts` is normalized to a
required number with default `1`; `-1` means unlimited attempts. Completion
follows a perfect submission or finite attempt exhaustion (which occurs on the
first submission when the limit is `1`), and manual completion is available
before exhaustion.

### Video positions

With manifest video ID `video-a` at local video index `0` on `page-one` (page index `0`), semantic
`pages: { "page-one": { videos: { "video-a": 12.34 } } }` produces
`d["0.t.0"]: 123`; decoding returns
`pages: { "page-one": { videos: { "video-a": 12.3 } } }`. The codec encodes a
video by looking for its semantic ID in `state.pages[ownerPageId].videos`, and
uses the manifest's local video index in the flat key. Decode resolves page and
video indexes through the current manifest, so content at the same index owns
the saved position after reordering. Unknown/removed indexes are discarded.
Zero positions are omitted because absence means playback starts at zero. The
codec test covers negative,
non-finite, and unknown video values, and verifies fractional rounding (for
example, `0.06` seconds becomes `0.1` seconds). The implementation also enforces
safe-integer decisecond values. Video entries are omitted from the flat map when
semantic state has no valid position for a video in the manifest, including when
the manifest has no videos; `d` is still omitted if there are no valid answers
either.

### Combined state, including an intentionally omitted submission

This was generated by calling `encodeSuspendData` with a two-page manifest that
maps page `page:intro.mdx`, question option indexes 0/1/2 to `alpha`/`beta`/
`gamma`, and video ID `video:video.mdx:8:1`. Input location is
`page:video.mdx`; its semantic video position is stored in
`pages["page:video.mdx"].videos["video:video.mdx:8:1"]`, and the input also
contains a submitted questionnaire ID. The actual serialized result is:

```json
{
  "v": 1,
  "p": 50,
  "x": "11",
  "d": {
    "0.a.0": [0, 2],
    "1.t.0": 1325
  }
}
```

The decoded semantic state contains both visited pages, completion on the first
Scroll page, answer `["alpha", "gamma"]`, and video position
`pages["page:video.mdx"].videos["video:video.mdx:8:1"] === 132.5`, nested under
the video's owning page. It does not contain `location` or
`submittedQuestionnaires`; those are handled separately as described above.

## Manifest and validation boundaries

`packages/scorm/src/content-manifest.ts` defines and creates the static
content manifest shared by packaging and runtime. It includes authored question
correctness metadata as well as display labels, but no learner responses. Its exact shape is:

```ts
interface ContentManifest {
  schemaVersion: 1
  title: string
  lang: string
  presentation: 'scroll' | 'slides' | 'tiles'
  pages: Record<
    string,
    {
      id: string
      title: string
      questions: Record<
        string,
        {
          id: string
          prompt: string
          type: QuestionType
          options: Record<string, { value: string; label: string }>
          correctAnswers: string[]
        }
      >
      /** Stable page-local preorder indexes; used to validate compact attempt histories. */
      questionnaires: Record<string, { id: string; maxAttempts: number; questionCount: number }>
      videos?: Record<string, { id: string; src: string; provider: VideoProvider }>
    }
  >
}
```

In generated JSON, the outer page keys are stringified page/item indexes; nested
question, option, questionnaire, and page-local video keys are likewise
stringified indexes. Question and questionnaire collection walk nested block
content in document order. Each questionnaire entry retains its stable semantic
ID, normalized numeric `maxAttempts` (default `1`, or `-1` for unlimited), and
question count, allowing the codec to validate finite history limits and
correct-count bounds. Each question
includes the semantic values of its correct options. Each page/item may include a `videos`
record keyed by deterministic traversal-order video index (`"0"`, `"1"`, ...);
each static `{ id, src, provider }` entry retains its semantic `id`. Nesting
identifies the owner, and the manifest maps compact local indexes back to
semantic video IDs. Neither the manifest nor its video entries contain learner
playback positions. `createContentManifest` includes
the package title, language (default `en`), presentation type, page titles,
plain-text question prompt/option labels, authored `correctAnswers`, questionnaire
attempt bounds, and the static mappings. The SCORM
packager writes it as `content-manifest.json` and embeds the same manifest in
`scorm-runtime.js`.

The codec validates compact values against that packaged manifest:

- A non-object root, invalid JSON, unsupported version, invalid progress, or
  invalid visited string rejects the **whole compact payload** and returns a
  fresh `{ pages: {} }` state.
- `v` must equal `1`; `p` must be an integer from 0 through 100; and `x`
  must contain only `0` and `1`. A shorter `x` is accepted; missing trailing bits
  mean unvisited. If `x` is longer than the current manifest page count, the
  decoder skips page-indexed visited, progress, answers, attempt histories,
  retry markers, and completion markers. Video data is independently resolved through page/local-video
  indexes.
- An absent, non-object, or malformed `d` does not invalidate otherwise-valid
  progress. `d` is a flat map whose keys must be exactly
  `<pageIndex>.<kind>.<entityIndex>` with canonical non-negative safe-integer
  page/entity indexes and a kind of `a`, `t`, `q`, `r`, or `c`. Malformed keys,
  unknown pages or entities, and invalid values are ignored individually without
  affecting other entries. A `q` value must be a non-empty array of safe integer
  correct counts within the manifest's question count and attempt cap. An `r`
  value must be `1`, name a current questionnaire, and have a valid `q` history
  with at least one attempt remaining. A `c` value must be `1`, name a current
  questionnaire with valid attempt/question bounds, and have a valid non-empty
  `q` history; otherwise it is ignored. A restored `c` suppresses a conflicting
  `r` marker. Neither `q` nor `r` implies completion.
- Unknown page/question indexes and invalid or unknown option indexes are
  ignored. A selection must be a safe-integer scalar or an array; array members
  that are not non-negative safe integers are filtered, then the rest are
  deduplicated and sorted. A non-multiple-choice question uses only the first
  mapped value. Only valid decoded answers are returned.
- An absent, malformed, or non-object video value/namespace is ignored. Only
  current page/local-video indexes and non-negative safe-integer decisecond
  values are decoded; missing/removed indexes and invalid values are discarded
  without rejecting other state. A valid value is divided by ten and nested in
  `pages[ownerPageId].videos` using the semantic video ID from the manifest.
- Questionnaire history is restored only through current page-local
  questionnaire indexes and manifest IDs. Invalid, over-cap, or out-of-range
  histories are ignored. A valid history is stored as
  `questionnaireAttempts[questionnaireId]`; retry markers are restored as
  `activeQuestionnaireRetries` only when history leaves an attempt available.
  Completion is restored separately as `completedQuestionnaires` only when a
  valid `c` marker has matching valid history. `q` history alone does not
  restore completion state. The renderer sanitizer infers submitted status from
  valid history or completion, except during an active retry.
- Unknown extra root sections are ignored; there is no root-level `t` field and
  root `t` values are not decoded. The codec has no rejection rule for extra
  properties beyond the required root fields.

The renderer's `sanitizePlayerState` in
`packages/renderer-react/app/lib/player-state.ts` is a distinct second check
against the current parsed content AST. It drops unknown page/item and location
IDs; unknown questions and options; answer values whose shape does not fit the
current question type; submission IDs that do not name a questionnaire reachable
on that page; attempt histories outside the authored cap/question count; invalid
active retry IDs; and, within each `PlayerPageState.videos`, video IDs not found by
`collectVideoNodes` in that specific Page/Item or positions that are non-numeric,
non-finite, or negative. Malformed video maps and stale/malformed positions are
dropped there; surviving video values are normalized to tenths of a second.
Direct sanitizer input is not moved between pages: a position stored under the
wrong page is rejected. Multiple-choice answers must be arrays whose
every element is a current option value; valid arrays are deduplicated.
Correctness is not consulted when validating answers. For a questionnaire with
known submitted status but no recorded history, the sanitizer seeds one attempt's
correct count from the current sanitized answers. This compatibility behavior
applies only when submitted status is known; an active retry is not treated as
submitted.

The compact codec cannot detect semantic removal/reordering for its numeric
indexes. If a page, question, or option is removed and a new entry occupies its
old index, the codec resolves the old value through the **new** entry at that
index. Out-of-range indexes are ignored; in-range shifted indexes can map to a
different current page/question/option. Changed option values are likewise
resolved through current manifest values and then checked against the AST. The
format carries no content fingerprint or standalone migration table.

Video positions use a flat key `<pageIndex>.t.<videoIndex>`, where both indexes
come from the current manifest. As with page/question/option indexes, reordering
can map a saved position to a different semantic video at the same index; removed
indexes are ignored. The compact payload contains no video IDs and does not
support ID-keyed video maps. Payloads without video entries remain valid, and
video positions are omitted on encode when no valid position exists.

## Persisted ID generation and stability

The parser establishes IDs consumed by page state, answers, questionnaire
submissions, locations, and video positions:

- A `<Page src="..." />` and `<Item src="..." />` gets an ID in
  `packages/parser/src/reference.ts`: `page:<normalized-relative-source>` or
  `item:<normalized-relative-source>`. The source is resolved relative to the
  declaring MDX file and normalized relative to the package root. The ID is
  based on the referenced file path, not its declaration position.
- Questionnaires and questions are generated by `sourceNodeId` in
  `packages/parser/src/io.ts`, called from `question.ts`. Videos use the same
  helper from `media.ts`. The format is
  `<kind>:<normalized-relative-source-file>:<line>:<column>`; kinds are
  `questionnaire`, `question`, and `video`. The line includes the frontmatter
  line offset; the column is the parser node's source-start column (defaulting
  to 1 when missing). These are parser source coordinates, not array indexes.
- A Path node stores references to page IDs; it does not introduce a separate
  resume identity. Other presentational/content nodes do not get persisted IDs
  from this parser path.

The IDs are stable across package-directory locations when relative files and
source coordinates are unchanged; the parser test explicitly checks that for
questionnaires/questions. Stability is limited by the inputs: moving/renaming a
referenced Page/Item source changes its ID; moving/renaming a questionnaire,
question, or video source changes its ID; and inserting/removing text or nodes
before one on the same source can change its line or column. Reordering source
content can therefore change line/column IDs. The manifest assigns deterministic
local video indexes in traversal order; semantic IDs remain in the manifest and
`PlayerState`, not the compact payload.

The compact `d` dictionary is positional through the current manifest: its flat
`<pageIndex>.<kind>.<entityIndex>` keys reference current manifest positions.
Adding or reordering pages, questions, options, or videos can change those
numeric mappings.

## Node/browser parity, tests, and change checklist

`browserCodecSource()` in `packages/scorm/src/state-codec.ts` serializes the
source of the same self-contained `createSuspendDataCodec()` used by the Node
exports. The generated SCO and preview runtime therefore use the same encode,
decode, validation, and normalization logic. The parity tests execute that
source in a VM and compare browser encode/decode behavior with the Node exports,
including flat encoding, indexed video positions, round trips, malformed inputs,
and rejection of unsupported versions.

Relevant implementation and test paths:

- Types and progress/score derivation: `packages/core/src/index.ts`.
- Stable parser IDs and source positions: `packages/parser/src/io.ts`,
  `packages/parser/src/reference.ts`, `packages/parser/src/question.ts`, and
  `packages/parser/src/media.ts`.
- Manifest: `packages/scorm/src/content-manifest.ts`.
- Node/browser codec: `packages/scorm/src/state-codec.ts`.
- LMS runtime and limits: `packages/scorm/src/runtime.ts`.
- Renderer sanitizer and state ownership: `packages/renderer-react/app/lib/player-state.ts`,
  `packages/renderer-react/app/lib/use-player-session.ts`, and
  `packages/renderer-react/app/lib/use-scorm-bridge.ts`.
- Codec, manifest, runtime, and browser parity tests:
  `packages/scorm/src/__tests__/state-codec.test.ts`,
  `packages/scorm/src/__tests__/state-codec.integration.test.ts`,
  `packages/scorm/src/__tests__/content-manifest.test.ts`, and
  `packages/scorm/src/__tests__/runtime-events.test.ts`.
- AST sanitizer and video position tests:
  `packages/renderer-react/src/__tests__/player-state.test.ts` and
  `packages/renderer-react/src/__tests__/video.test.tsx`.
- Source ID stability and frontmatter-offset tests:
  `packages/parser/src/__tests__/package.test.ts`.

For a new persisted field, first decide whether it belongs in semantic
`PlayerState`, separate version-specific CMI, or is derived and should not be
persisted. Then update the semantic type and player ownership/update path; add
current-AST sanitization; add static manifest mapping only if the codec needs a
current-content lookup; add compact encode/decode behavior in
`createSuspendDataCodec()` (the browser source follows automatically); and
define how absent, malformed, unknown, removed, and reordered values behave.
Keep `location` in its separate CMI element and score in the separate score
bridge unless their ownership is intentionally changed. The flat layout is the
single supported v1 shape: `v: 1` and the flat `<pageIndex>.<kind>.<entityIndex>`
`d` keys are the only supported compact format. There is no version bump, no
new `v` value, and no legacy or nested decoder in scope; the decoder accepts
only `v: 1` (the flat layout) and rejects every other `v` outright. Test Node
and browser parity, encode/decode round trips, renderer sanitization, runtime
writes and limits, and parser/manifest mappings as applicable. The current code
has no standalone suspend-data migration framework.

The production SCORM runtime talks to the LMS API discovered in the SCO
window/parent chain. `scorm preview` instead supplies its preview runtime and
mock LMS API; that mock exercises the same version mapping, codec, and bridge
contract locally. The preview LMS is a test/development host, not the source of
the semantic state or a second serializer. Without an installed bridge, the
renderer remains usable, but bridge restore/save/report calls are best-effort
no-ops.
