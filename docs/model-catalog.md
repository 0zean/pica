# Model catalog, tiers and credits (C-01)

Module: `engine/packages/core/src/models/`, exported from `@pica/core`. Pure: it reads models only through the `AgentRuntime` port (`listModels`, implemented by the E-09 Copilot adapter) and takes the clock as a function.

## Catalog cache

`createModelCatalog({ runtime, priceTable, now, maxAgeMs, retryAfterMs, onWarning })` returns `get()`, `refresh()` and `current()`.

- `get()` serves the cached snapshot until it is `maxAgeMs` old, then calls `models.list` again. Concurrent callers share one in-flight call.
- When a refresh fails and a snapshot exists, the snapshot is kept and returned, and `onWarning` receives `{ code: "models.refresh_failed", message, at }`. That shape is the protocol's `engine.warning` notification, so the server forwards it unchanged. No retry happens until `retryAfterMs` has passed.
- When the first fetch fails there is nothing to keep, so `get()` returns `models.unavailable` with the runtime's error code in `runtimeCode`.
- Models are sorted by id.

## Tiers

`resolveTier(tier, setting, models, policy)` and `resolveTiers(settings, models, policy)`. `setting` is `routing.tiers.<tier>` from config: `"auto"` or a model id. `policy` is a `ManagedModelPolicy` (`allow?`, `deny?` model id lists); H-01 compiles the managed policy file into it. Deny wins over allow.

| Setting | Outcome | `reason` |
|---|---|---|
| A listed, allowed model | That model | `configured` |
| A model that is not listed | The `auto` pick | `fallback_missing` |
| A model managed policy blocks | The `auto` pick | `fallback_blocked` |
| `auto` | The `auto` pick | `auto` |
| Any, with no allowed priced model | `null`; the runtime default applies | `unresolved` |

The `auto` rule keeps model ids out of code (D-09): among allowed models with known prices, `reasoning` takes the highest input + output rate and `worker` the lowest; ties go to the smaller id. A configured model needs no price; `auto` ignores unpriced models because it cannot rank them.

## Credits

`computeCredits(usage, prices)` returns `{ input, cachedInput, output, total }`. Prices are credits per million tokens (1 credit = $0.01, PLAN.md §2.1). `inputTokens` excludes cached input, which is priced separately (the E-09 assumption in [copilot-replay.md](copilot-replay.md), settled by S-03).

The arithmetic is exact: prices are held as integer micro-credits per million tokens and products are summed as `bigint`, so each figure is rounded to a double once, from its exact decimal value, and `total` is rounded from the exact sum. Rates with more than six decimal places are rounded to six.

## Price table provenance

Runtime prices (`models.list` `billing.tokenPrices`) always win. `fallbackPriceTable` in `fallback-prices.data.ts` only fills in models that the runtime lists without prices, and a catalog model priced from it has `priceSource: "table"` so the UI can label its credits as an estimate.

**The table's values are unverified.** No `models.list` response has been recorded yet (S-01 has not run). The values are the model providers' public API list prices for input, cached input, and output, converted at 1 credit = $0.01, on the assumption from PLAN.md §2.1 that Copilot bills each model "at its listed rates". They are not taken from GitHub's billing pages, and the model ids are the Copilot-style ids expected from `models.list`, also unconfirmed.

| Model id | Input | Cached input | Output |
|---|---|---|---|
| `gpt-5` | 125 | 12.5 | 1000 |
| `gpt-5-mini` | 25 | 2.5 | 200 |
| `gpt-4.1` | 200 | 50 | 800 |
| `claude-sonnet-4.5` | 300 | 30 | 1500 |
| `claude-haiku-4.5` | 100 | 10 | 500 |

When S-01 saves `docs/spikes/S-01-models.json`: replace these entries with any model the recorded list leaves unpriced (or empty the table if every model is priced), set `provenance: "recorded"`, and update this section.

## Known gaps

- `RuntimeModel` carries no Copilot policy state, so a model the organization disables in Copilot settings still appears in the catalog. The adapter refuses to start a session on it (`runtime.model_unavailable`). Exposing the state on the port would let `ModelInfo.allowedByPolicy` reflect it too.
