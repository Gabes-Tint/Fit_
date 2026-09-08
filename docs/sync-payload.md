# Sync payload size

Issue [#130](https://github.com/gabepsilva/Fit_/issues/130), first lead: _the state document sync
sends the whole blob; measure size per push and whether a diff or compression is worth it._

This is the measurement, not a change to sync. Nothing in `src/lib/state/` or
`src/lib/server/state/` was touched.

Reproduce with:

```sh
bun run perf:sync-payload            # prints the table, writes reports/perf/sync-payload.{json,md}
bun run perf:sync-payload -- --baseline   # also rewrites quality/perf-sync-payload.md
```

The committed numbers are in [`quality/perf-sync-payload.md`](../quality/perf-sync-payload.md).
They are deterministic: the same tree measures the same bytes on any machine, on any day.

## What was measured, and out of what

`sync.svelte.ts` sends `JSON.stringify({ version, format, body: storedDocument(state) })` — the
whole document, every time. The instrument builds that exact envelope.

The documents come out of fixtures already in the tree, so the food, the macros, the micros and
the loads are the application's rather than this instrument's invention:

- `src/lib/domain/demo-seed.ts` — `buildAlexProfile()` (21 days, 134 entries) and
  `buildJordanProfile()` (11 days), which is what "Use sample data" installs.
- `src/lib/domain/exercise-catalog.ts` — `ROUTINE_TEMPLATES[0]`, the three-day rotation
  onboarding offers, through `routinesFromTemplate` and `workoutFromRoutine`.
- `src/lib/domain/week-plan.ts` — `buildWeekPlan`, the seven days of planned meals onboarding
  generates.

The demo seed is 21 days, and the question is what a month and a year look like, so its own day
cycle is repeated out to 30, 365 and 1095 days. Dates are anchored and ids numbered in order —
`demo-seed.ts` reads the clock and `Math.random`, and a compressed size taken off that would
differ run to run. That normalization changes nothing in the uncompressed columns; every id is
the same length either way.

## 1. How large is a push

| Scale                      | Log entries |  PUT body |     gzip | Sent per byte changed |
| -------------------------- | ----------: | --------: | -------: | --------------------: |
| new account, no journal    |           0 |    3.7 KB |   0.9 KB |                    9× |
| demo seed (21 d + 11 d)    |         204 |   85.1 KB |   5.5 KB |                  219× |
| 30 days, food + training   |         224 |  108.7 KB |   6.5 KB |                  292× |
| 365 days, food + training  |        2718 | 1262.8 KB |  43.6 KB |                 3249× |
| 1095 days, food + training |        8152 | 3780.2 KB | 122.5 KB |                 9726× |

The full table, with the document size, brotli and the food-only rows, is in the committed
baseline.

A logged entry is about 400 bytes because `LogItem` carries thirteen `Micros` fields, a
`Provenance`, a serving label and a gram weight alongside the four macros. Roughly **1.24 MB per
logged year** for someone who eats and trains, **1.08 MB** for someone who only eats.

## 2. How often, and how much of it changed

One `PUT` per `persist()`. `TendStore.write()` is the single funnel for a stored document, and
it calls the `onWrite` listener `sync.svelte.ts` installs; `changed()` marks the record dirty and
schedules an exchange. Nearly every store method calls `persist()` directly — `addLogItems`,
`updateLog`, `patchActive`, `togglePantry`, and so on — so a logged meal, an edited serving and a
toggled pantry item are one push each. Only the steppers go through `persistSoon()`, which shares
one write across a 200 ms window.

Bursts coalesce, but only against the round trip. `schedule()` keeps one exchange in flight per
household and everything raised meanwhile waits on it, then one further push carries the lot —
`sync.svelte.spec.ts`, "coalesces a burst into one request in flight and one queued". So the
push rate is bounded by latency, not by a timer: on a fast connection three quick changes are
close to three pushes, on a slow one they are two.

What changed is one entry: **398 bytes out of 1,262.8 KB after a year — 0.03%.** The right-hand
column is that ratio inverted: at a year the phone sends **3,249 bytes for every byte that
actually changed**, and at three years 9,726.

## 3. What compression would buy

Checked rather than assumed:

- **The origin does not compress dynamic responses.** `vite.config.ts` uses `adapter()` from
  `@sveltejs/adapter-node` with default options. Its only use of gzip and brotli is
  `sirv`'s `gzip: PRECOMPRESS, brotli: PRECOMPRESS` in `files/handler.js`, which serves
  precompressed **static files** from `build/client`. A `/api/state` response goes out
  uncompressed.
- **Cloudflare compresses responses.** `curl -H 'Accept-Encoding: gzip, br, zstd'
https://fit.psilva.org/` came back `content-encoding: zstd`, and a 404 came back
  `content-encoding: gzip`. So the pull is already compressed edge-to-client, for free, and
  nothing needs building for it.
- **Nothing compresses the push.** Browsers do not compress request bodies, Cloudflare does not
  compress them either, and the endpoint would not accept one if they did: `readStateBody`
  requires `content-type: application/json`, and `readJsonText` calls `request.text()`, which
  performs no content decoding. Sending `content-encoding: gzip` today produces `invalid-body`.

So compression is already doing its work in the direction that costs nothing, and doing none at
all in the direction that carries 1.24 MB a year. gzip level 6 takes a year-scale push from
1,262.8 KB to **43.6 KB — 29× smaller**; brotli quality 5 takes it to 21.7 KB, 58×. The document
is highly repetitive JSON, which is why the ratio improves with size rather than degrading.

## 4. Does it pay yet

**Not today, and there is a date.**

At the scale real accounts are at — the demo seed, or a first month — a push is 85 to 109 KB.
That is one photo. It is sent a few times an hour while somebody is logging, over a connection
that is idle the rest of the day, and no measurement here says a person notices it.

What the numbers do say:

- **A diff is the bigger win but the harder change.** 3,249× amplification is the largest ratio
  in this note, and it is also the one that cannot be had without deciding how two devices merge
  — which is the question `sync.svelte.ts` deliberately does not answer today (rule 2: "It never
  merges and never overwrites; merging is a later story"). A diff format is a merge design.
- **Compression is the cheaper win and buys 29×** for a request header and a decode step, with
  no change to what a document means or who wins a conflict. It needs the server to accept
  `content-encoding: gzip` on `PUT /api/state` and the client to send it — a design change, and
  Gabriel's call, not something to slip into a perf note.
- **The threshold is `MAX_STATE_BODY_BYTES`.** `src/lib/server/state/endpoints.ts` refuses a body
  over 4 MB. At the measured 1.24 MB a year, an account that logs food and training reaches that
  after about **1,183 days — three years and three months.** The 1095-day row is already at
  92.3% of it. Compressing the push moves that wall out by roughly 29×; a diff removes it for
  ordinary edits but not for the first push from a device that has never synced.

The honest summary: the blob is not too big for anyone using the app today, it is too big for
somebody using it in 2029, and the cheapest thing that changes that is compressing the request
body.

## Reported, not fixed

Two things this measurement turned up. Neither is changed here — the sync client is where a
store-wide data-loss defect lived twice this month (#247, #253, #262), and a measurement pass is
not where its behaviour changes.

1. **Passing the ceiling ends syncing permanently, and not quietly enough to be safe.** A body
   over 4 MB is refused with `invalid-body`. The client's `writeRemote` sees a non-409 answer
   carrying no `version`, reads it as `'refused'`, and sets `dirty = true` and
   `status = 'error'`. Every later push fails the same way. Nothing is lost from the device, and
   the status does say `error` — but the account never syncs again and nothing explains why. The
   document only grows, so this is not a transient state anybody recovers from.
2. **`readJsonText` compares a character count to a byte ceiling.** `raw.length > max` counts
   UTF-16 code units against `MAX_STATE_BODY_BYTES`. For a document of food names with accents
   or non-Latin scripts the byte length exceeds the character length, so a body slightly over
   4 MB passes the second check. The `content-length` check before it is in bytes and catches an
   honest client; this is the belt to that pair of braces, and it is measuring the wrong thing.

## A smaller lead, measured in passing

`JSON.stringify` of the whole document costs 0.36 ms at 30 days, 3.29 ms at a year and 10.46 ms
at three years, under Bun on a desktop. It runs on every `persist()` — once for `localStorage`,
and again for the push body — plus a `$state.snapshot` deep clone. A mid-range phone is several
times slower than that. Not a problem at today's scale; worth knowing it is linear in the same
number everything else here is.
