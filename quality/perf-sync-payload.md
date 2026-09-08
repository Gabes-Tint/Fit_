# Sync payload size

Written by `bun run perf:sync-payload`; the run’s timestamp is in
`reports/perf/sync-payload.json` rather than here, so this file only changes
when a number does.

One `PUT /api/state` carries the whole state document; `sync.svelte.ts` sends
`storedDocument(state)` in full on every change. These are the bytes it carries.

`Sent per byte changed` is the PUT body divided by what one more logged entry adds:
the amplification a diff would remove.

| Scale                                 | Log entries | Workouts |  Document |  PUT body |     gzip |  brotli | gzip share | One more entry | Sent per byte changed |
| ------------------------------------- | ----------: | -------: | --------: | --------: | -------: | ------: | ---------: | -------------: | --------------------: |
| empty device                          |           0 |        0 |    0.2 KB |    0.3 KB |   0.2 KB |  0.2 KB |      75.4% |            0 B |                     — |
| new account, no journal               |           0 |        0 |    3.7 KB |    3.7 KB |   0.9 KB |  0.9 KB |      25.3% |          410 B |                    9× |
| demo seed (21 d + 11 d, two profiles) |         204 |        0 |   85.0 KB |   85.1 KB |   5.5 KB |  4.5 KB |       6.5% |          398 B |                  219× |
| 30 days, food only                    |         224 |        0 |   92.5 KB |   92.5 KB |   5.8 KB |  4.3 KB |       6.3% |          381 B |                  249× |
| 30 days, food + training              |         224 |       14 |  108.6 KB |  108.7 KB |   6.5 KB |  4.9 KB |       6.0% |          381 B |                  292× |
| 365 days, food only                   |        2718 |        0 | 1081.0 KB | 1081.1 KB |  38.4 KB | 18.5 KB |       3.5% |          398 B |                 2781× |
| 365 days, food + training             |        2718 |      157 | 1262.8 KB | 1262.8 KB |  43.6 KB | 21.7 KB |       3.5% |          398 B |                 3249× |
| 1095 days, food + training            |        8152 |      471 | 3780.1 KB | 3780.2 KB | 122.5 KB | 59.5 KB |       3.2% |          398 B |                 9726× |

Server ceiling: 4194304 bytes (`MAX_STATE_BODY_BYTES`, `src/lib/server/state/endpoints.ts`).
A year of food and training is 1262.8 KB per push, and reaches that ceiling after about 1183 days.
Largest row measured: 1095 days, food + training, 3780.2 KB, 92.3% of the ceiling.
