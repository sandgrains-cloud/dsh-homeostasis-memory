# dsh-homeostasis-memory

[中文](README-CN.md)

## Overview

A memory plugin for the DeepSeek Harness. It splits memory into five layers, with exactly one writer per layer, so a single fact never exists in two places fighting over the same ground. The layering follows hermes-style memory systems and local storage is handed to mnemon. The part that gets the attention is hot memory: a score decides what stays in `MEMORY.md`, so the file never needs manual pruning.

| Layer | File |
|---|---|
| Persona | `$DSH_HOME/SOUL.md` |
| User profile | `$DSH_HOME/memory/USER.md` |
| Hot memory | `$DSH_HOME/memory/MEMORY.md` |
| Skills | `$DSH_HOME/skills/<name>/SKILL.md` |
| Memory spaces | `$DSH_HOME/memory/spaces/` |

The plugin combines the strengths of two memory systems, and hot memory is where the work went. A scoring mechanism does the job: when a session's task ends, the main model runs a review. Besides summarising the session, amending skills and creating memories, the review also scores the hot memories this session actually used — used ones gain a point, every other one loses a point. Hot memories that fall to 0 points or below move into a memory space, which keeps hot memory clean and tidy.

Recall from memory spaces can be switched off at any time. With recall off, `memory_recall` and `memory_related` inject nothing, so old history cannot pollute the context. Switch it back on when you need it.

`SOUL.md`, `USER.md` and `MEMORY.md` are plain text in a common format, so they import directly from other memory projects; if you already use mnemon, its existing memory spaces plug straight in.

## Hot-memory scores

`MEMORY.md` entries carry a score. The file keeps it as a `[N] ` prefix, but the
prefix is stripped from the model snapshot, the tool arguments, and the settings
page, so the score never becomes part of an entry's text.

- A new entry, from any writer, starts at **5 points**.
- `MEMORY.md` has **no character limit**; its lifecycle is score-driven.
- The standard closing review re-scores every entry: the ones the main model lists
  as used gain one point, all others lose one. An entry at or below **0** is
  **archived into a long-term memory space first, and leaves `MEMORY.md` only after
  the archive confirms it**.
- When archiving fails (backend missing, receipt mismatch, timeout) nothing is
  written to `MEMORY.md`: every entry keeps its score and the receipt carries
  `error` and `retained`.
- An entry the archive refuses (empty, or longer than `longTerm.entryMaxChars`,
  8000 by default) is neither archived nor deleted: it stays where it is with the
  score it just earned, still at or below zero, so the next archive run retries it.
  The log records `too-long`.
- `USER.md` has no scores and keeps its character budget. Idle and synchronous
  reviews never score.
- Editing content (in the page, in the review, or through the `memory` tool) never
  changes a score.

`USER.md` keeps the plain `§`-separated format. A score-less `MEMORY.md` entry
written by an older version reads as 5 points, so no migration step is needed.

## Long-term memory

Dead entries are archived into a memory space: a named, independently switchable
store of durable evidence. The design follows dsh-mnemon (memory spaces, the
`strict-v1` recall grading, and write-then-commit archiving), but it neither depends
on nor touches any dsh-mnemon data.

- The backend is the plugin's own `vendor/mnemon/mnemon.exe` (Mnemon 0.2.8,
  Apache-2.0), so installing the plugin is all it takes.
- The data root is always `$DSH_HOME/memory/spaces`; a configured directory inside
  dsh-mnemon's `~/.mnemon` is refused and the default is used instead.
- Recall grading: below `0.25` is dropped, below `0.6` counts as medium (at most 4),
  the rest is high (all kept), unscored at most 2, and one query admits at most 6.
- Per turn: one initial recall, one materially different refinement, one graph
  traversal. a repeated query replays the evidence already admitted instead of
  querying the backend again.

| Operation | Command | Notes |
|---|---|---|
| Archive | temporary draft JSON → `mnemon import --no-diff` | every receipt (`action`, `id`, `content`) is checked before `MEMORY.md` changes |
| Recall | `mnemon --readonly recall <q> --limit n` | at most two queries per turn |
| Traversal | `mnemon --readonly related <id> --depth n [--edge t]` | the id must come from this turn's recall; one traversal per turn |
| Browse | `mnemon --readonly recall "" --basic` | the page's space contents |
| Search | `mnemon --readonly search <q>` | keyword search in the page |

## Tools

| Tool | Actions | Notes |
|---|---|---|
| `memory` | `add` / `patch` / `remove` / atomic `operations` | Two stores; `§`-separated entries; a new `MEMORY.md` entry starts at 5 points; only `USER.md` has a character budget |
| `soul` | `read` / `append` / `patch` / `remove` | Every write needs approval and an `expected_revision` |
| `skill_manage` | `read` / `create` / `patch` / `write_file` / `remove_file` | No delete, flat layout, read-before-write enforced |
| `session_grep` | literal search | Same `cwd` only, current session excluded, newest sessions first |
| `review_memory` | `used_memory` list | Standard strategy only: score and archive `MEMORY.md`, then ask for a closing review after the current turn |
| `memory_recall` | `query` / `limit` / `spaceIds` | Recalls long-term memory; absent while recall is off |
| `memory_related` | `id` / `spaceId` / `depth` / `edge` | Graph traversal; the id must come from this turn's recall, once per turn; absent while recall is off |

Every failure returns an actionable code: `invalid`, `too-large`, `scan-blocked`,
`approval-denied`, `revision-conflict`, `not-found`, `ambiguous`, `over-budget`,
`read-before-write`, `unavailable-in-review`, `io-error`, `cli-missing`,
`cli-timeout`, `cli-failed`, `invalid-json`, `output-too-large`, `space-missing`,
`space-create-failed`, `registry-invalid`, `archive-rejected`, `not-admitted`,
`budget-exhausted`, `too-long`, `data-dir-conflict`.

## Settings page

The plugin contributes one page to **Settings → Memory**. It has seven tabs:

| Tab | Shows | Can change |
|---|---|---|
| Status | persona bytes and revision, both stores' counts, `MEMORY.md` average score, skill count, last review | — |
| AI persona | the whole `SOUL.md` with a live byte counter | edit the full text, with a second confirmation |
| Memory | `USER.md` with a usage bar, and `MEMORY.md` as a score-sorted entry list with an editable score per row | add, edit, and delete single entries; edit a `MEMORY.md` score directly |
| Skills | name, description, size, supporting-file count, modified time | — (creating stays with `skill_manage`) |
| Review | strategy, model, both switches, passive rule, output budget, log path, newest 3 records | model, master switch, passive switch |
| Long-term | backend path and version, data directory, archive target, each space's entry count and category split, a space's contents and graph neighbors, the archive log | recall switch, space activation, create a space, archive now |
| Approval | approval policy of live sessions | `ask` / `never` for live sessions |

Switching recall off withdraws `memory_recall` / `memory_related`, the per-turn
reminder, and the protocol paragraph together, so the model cannot see that
long-term memory exists. Archiving is unaffected.

`MEMORY.md` rows are displayed highest score first, ties in file order. That sort is
display-only: neither the file nor the model snapshot is reordered, and saving a
score re-sorts the list without touching any entry's text. The score input sits
between **Edit** and **Delete** and saves on blur or Enter.

Review behaviour is the one part the page can change. The row configuration is the
default; once the page saves, `$DSH_HOME/memory/review-settings.json` wins, so no
YAML edit or profile reload is needed and the change applies to the next review.
Delete that file to fall back to the YAML values.

Two strategies, chosen by the review model:

- **standard** — the review model follows the main model. The plugin forks the
  whole conversation into a one-shot child, so the child inherits exactly the
  context the main model had. It runs on two triggers:
  - the `review_memory` tool, called when the user closes the session (or asks
    for a summary/review). The call first scores `MEMORY.md` from the
    `used_memory` list and deletes entries at or below zero, then defers the
    review to the end of that turn so it sees the closing message too;
  - the passive rule: at least `review.intervalTurns` user turns since the last
    review and at least `review.idleMinutes` minutes idle. This path does not
    score. The page's passive switch controls this rule only.
  A new user message aborts a running review: the user's task always wins.
- **sync** — a different model is pinned. One persistent review agent per main
  session receives the main conversation one completed turn at a time, with the
  main model's reasoning removed and nothing truncated. It keeps its own history
  and compacts it on its own, so no single request carries the whole session.
  It does not score entries. There is no closing review and no idle trigger; the
  page switch turns this strategy on or off.

The page has two switches: the master `Enable the memory review` switch turns every
review off; `Enable the passive review` appears only while the review model follows
the main model and controls the idle rule alone. The log section shows the newest
three records, including the scoring summary of a closing review. The log file
itself keeps only the newest `review.logMaxEntries` records (5 by default); an
oversized log left by an older version is trimmed when the plugin activates.

The model picker offers `same as main model` (standard) or one pinned model from the
registered `llm` routes (synchronous review). A pinned route equal to the session's
current route still counts as the standard strategy.

Memory is edited entry by entry, not as one document, because `§` is the
structural unit: the Host addresses entries, the agent's `memory` tool patches
and removes by unique entry substring, and the score is stored separately from the
entry text. A free-text box can silently delete a separator and merge two facts
into one entry, so the entry list never rebuilds the separators itself — the Host
renders them from the entry array on every write.

The persona has no such structure, so it stays whole-text.

Data reaches the page from the Host endpoint `GET /dsh-homeostasis-memory/api/state`; writes
post to `/dsh-homeostasis-memory/api/persona` and `/memory/{add,replace,remove,score}`. Those
handlers call the same modules the tools use, so scanning, the `USER.md` budget,
locking, and atomic writes behave identically. The one deliberate difference: a
write from this page skips `ctx.approval`, because the click and the page's
confirmation step *are* the human approval, and an approval request cannot be
opened outside a turn.

A `USER.md` that was hand-edited with no separators (one entry over the whole
budget) blocks every write, this page included, until the file is repaired by
hand; the page shows the reason and the backup path. `MEMORY.md` has no budget,
so it has no such drift guard.

The page language follows, in order: the 中文 / EN switch in its header (remembered
in `localStorage`), then `ui.locale`, then the app locale, then `document.lang`,
then the browser language.

The route is registered through `ctx.inject(['webServer'], …)` instead of reading
the context directly: a plugin row can activate before the row that mounts
`webServer`, and reading it eagerly leaves the page with a permanent 404 on a cold
start. The prompt-section and tool registrations wait for their services for the
same reason.

After installing or editing the package, refresh the page once so the browser
loads the new client module. If the page still does not appear, restart the
desktop app — a replaced package needs a fresh module generation.

## Data layout

```
$DSH_HOME/
├─ SOUL.md                  persona (seeded from assets/default-SOUL.md on first run)
├─ memory/
│  ├─ USER.md               who the user is; §-separated plain text, 1375-character budget
│  ├─ MEMORY.md             §-separated entries, each `[score] text`, no character limit
│  ├─ review-log.jsonl      one line per review pass or delivery; newest 5 kept
│  ├─ review-state.json     synchronous reviewers: session, last delivered seq, route
│  ├─ long-term-settings.json   page-owned long-term settings
│  ├─ cold-archive-log.jsonl    archive journal; newest 3 kept
│  └─ spaces/                   memory-space root (the Mnemon --data-dir)
│     └─ data/
│        ├─ .dsh-homeostasis-memory-bodies.json   space registry
│        └─ cold-archive/mnemon.db    the cold-archive space
└─ skills/
   └─ <name>/SKILL.md       + references/ templates/ scripts/ assets/
```

All writes are temporary-file-plus-rename with a per-file in-process lock. A
hand-edited `USER.md` whose single entry exceeds the whole budget is backed up to
`<file>.bak.<timestamp>` and then refused instead of overwritten.

## Configuration

`cordis.patch.yml` in this package carries the defaults. To change them, add an
override to the profile's own `cordis.patch.yml` — note that a patch **replaces**
the whole `config` object, so restate every field you want to keep:

```yaml
- id: memory
  config:
    review:
      enabled: false
    hotMemory:
      userLimitChars: 2000
      writeApproval: false
```

| Field | Default | Meaning |
|---|---|---|
| `persona.path` | `$DSH_HOME/SOUL.md` | persona file |
| `persona.maxBytes` | 4096 | hard byte ceiling, never truncated |
| `persona.requireApproval` | true | approval for every persona write |
| `persona.seedScaffold` | true | write the scaffold when the file is absent |
| `hotMemory.userLimitChars` | 1375 | `USER.md` ceiling (Unicode code points) |
| `hotMemory.writeApproval` | false | inline approval for foreground writes |
| `skills.root` | `$DSH_HOME/skills` | skill root |
| `skills.descriptionMaxChars` | 200 | description ceiling |
| `skills.bodyMaxChars` | 10000 | per-file ceiling |
| `skills.dedupeThreshold` | 0.5 | description-similarity warning |
| `sessionGrep.maxSessions` | 40 | recent sessions scanned |
| `sessionGrep.maxHits` | 10 | matches returned |
| `sessionGrep.snippetChars` | 400 | excerpt length |
| `sessionGrep.timeoutMs` | 3000 | scan budget |
| `review.enabled` | true | master switch for every review |
| `review.passive` | true | passive idle rule (standard strategy only) |
| `review.intervalTurns` | 10 | passive rule: user turns since the last review |
| `review.idleMinutes` | 5 | passive rule: idle minutes before it runs |
| `review.maxPerSession` | 50 | standard-strategy cap per session |
| `review.maxInputChars` | 60000 | standard-strategy input warning threshold |
| `review.maxTokens` | 8192 | review output budget |
| `review.logPath` | `$DSH_HOME/memory/review-log.jsonl` | review journal |
| `review.logMaxEntries` | 5 | newest records kept in the review journal |
| `review.statePath` | `$DSH_HOME/memory/review-state.json` | synchronous reviewer bookkeeping |
| `review.model.mode` | inherit | `inherit` = standard strategy; `fixed` = synchronous review |
| `review.model.provider` / `.model` | — | used when mode is `fixed` |
| `protocol.enabled` | true | register `memory:protocol` |
| `longTerm.enabled` | true | master switch; false drops an entry at zero, as before |
| `longTerm.recall` | true | recall switch (page-owned); false withdraws both tools and their prompt lines |
| `longTerm.targetSpace` | `cold-archive` | archive destination |
| `longTerm.createTargetSpace` | true | create the destination when it does not exist |
| `longTerm.cliPath` | empty | empty = the bundled `vendor/mnemon`, then PATH |
| `longTerm.dataDir` | empty | empty = `$DSH_HOME/memory/spaces`; a directory inside `~/.mnemon` is refused |
| `longTerm.timeoutMs` | 15000 | one backend call's timeout |
| `longTerm.entryMaxChars` | 8000 | longest entry the archive accepts |
| `longTerm.logMaxEntries` | 3 | archive-journal records kept, in the file and on the page |
| `longTerm.recallQuality.limit` | 6 | most results one query admits |
| `longTerm.recallQuality.lowScoreThreshold` | 0.25 | below this a result is dropped |
| `longTerm.recallQuality.highScoreThreshold` | 0.6 | at or above this it is high relevance |
| `longTerm.recallQuality.candidateMultiplier` | 3 | candidate expansion factor (capped at 50) |
| `longTerm.recallQuality.maxMediumResults` | 4 | medium-relevance rows admitted at most |
| `longTerm.recallQuality.maxUnknownResults` | 2 | unscored rows admitted at most |
| `ui.locale` | `auto` | page language: `auto`, `zh`, or `en` |

Configuration changes take effect on profile reload; there is no hot reload.
Unknown fields are ignored: the plugin normalizes its config in code rather than
declaring a schema, so a typo is silent. The long-term recall switch and archive
target are the exception: the page writes them to `long-term-settings.json` and they
apply immediately.

## Known limitations

These are deliberate or measured, not oversights.

- **Single process.** The per-file lock is in-process only; two DSH processes
  sharing one `$DSH_HOME` are unsupported (PRD FR-8).
- **Shell writes bypass the guard.** `write` and `edit` are refused on
  `SOUL.md`, `USER.md`, and `MEMORY.md`, but a shell redirect is not intercepted.
- **Skills are not guarded.** Only persona and hot memory have a `write`/`edit`
  guard, per PRD FR-1.4.
- **Long-term memory needs its bundled backend.** `vendor/mnemon/mnemon.exe` is a
  win32-x64 binary; on another platform, point `longTerm.cliPath` at a Mnemon build
  for it. Without a backend, archiving fails and entries stay in `MEMORY.md`; every
  other feature keeps working.
- **Long-term memory is isolated from dsh-mnemon.** The two keep separate data
  roots and neither reads or writes the other; a `longTerm.dataDir` inside
  dsh-mnemon's root is refused.
- **The review child inherits the parent's toolset.** The Harness exposes no
  `toolFilter` on a subagent start, so both strategies narrow the review session
  by a scoped `tools.restrict` plus per-tool caller checks. The restriction is
  keyed on the `memory-review-` session-id prefix, so it survives a plugin reload.
- **The review child has no long-term tools.** `memory_recall` and `memory_related`
  refuse a review session outright; a review maintains `MEMORY.md` and skills only.
- **Session sort is by creation time.** `SessionHeader` has no updated-at field.
- **Delegated sessions are skipped** by `session_grep` so fork children do not
  duplicate their parent's history in the results.
- **Review token usage is not recorded.** The subagent result carries no usage
  object, so those fields stay absent rather than fabricated.
- **A standard review is cancelled by the next user message.** That is deliberate:
  the review is maintenance and must never delay the user's task.
- **Synchronous review sends no reasoning.** The main model's thinking is dropped
  from the turn it hands over; only user text, assistant text, tool calls, and
  tool results are delivered.
- **Synchronous review starts from the turn it was enabled in.** Switching from a
  fixed model to `inherit` and back starts a new reviewer; the old one is disposed.

## License

MIT. See [LICENSE](LICENSE).

The bundled `vendor/mnemon/mnemon.exe` is Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
