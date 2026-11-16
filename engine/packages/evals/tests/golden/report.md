# Pica eval report (C-10)

Runtime: fake. Generated 2026-11-16T09:04:31.500Z. Tier settings: reasoning `model-r`, worker `auto`. Each task ran 3 times per profile; token, credit and time figures are means over runs, with the per-run range in brackets. "Reasoning input" counts fresh and cached input tokens of reasoning-tier calls; "gated" is the mean number of cost-rule decisions that were not allow.

## Summary

| Profile | Reasoning model | Worker model | Succeeded | Reasoning input (fresh + cached) | Reasoning output | Worker input | Credits | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off | model-r | none | 15/15 | 472,500 (382,500 + 90,000) | 6,000 | 0 | 126.4500 | 22.5 s |
| balanced | model-r | model-w | 14.67/15 | 85,500 (55,500 + 30,000) | 2,250 | 360,000 | 30.5250 | 22.5 s |

## balanced against off

- Reasoning-tier input tokens: 85,500 against 472,500, -81.9% (gate: at most 5.0% more).
- Credits: 30.5250 against 126.4500, -75.9% (gate: at most 35.0% more).
- Tasks succeeded: -0.33 (gate: at most 1 fewer).
- Gate met: yes.

## Tasks

| Task | Category | off | balanced |
| --- | --- | --- | --- |
| schema-column-owner | large-file-question | 3/3 pass, 24,500 in (24,000–25,000), 0 gated | 3/3 pass, 5,000 in (4,500–5,500), 1 gated |
| settlement-log-error | large-file-question | 3/3 pass, 25,500 in (25,000–26,000), 0 gated | 3/3 pass, 5,100 in (4,600–5,600), 1 gated |
| error-code-value | large-file-question | 3/3 pass, 26,500 in (26,000–27,000), 0 gated | 3/3 pass, 5,200 in (4,700–5,700), 1 gated |
| allocation-bug | comprehension | 3/3 pass, 27,500 in (27,000–28,000), 0 gated | 3/3 pass, 5,300 in (4,800–5,800), 0 gated |
| report-total-bug | comprehension | 3/3 pass, 28,500 in (28,000–29,000), 0 gated | 3/3 pass, 5,400 in (4,900–5,900), 0 gated |
| query-filter-bug | comprehension | 3/3 pass, 29,500 in (29,000–30,000), 0 gated | 3/3 pass, 5,500 in (5,000–6,000), 0 gated |
| money-tests | test-scaffolding | 3/3 pass, 30,500 in (30,000–31,000), 0 gated | 3/3 pass, 5,600 in (5,100–6,100), 0 gated |
| slug-tests | test-scaffolding | 3/3 pass, 31,500 in (31,000–32,000), 0 gated | 3/3 pass, 5,700 in (5,200–6,200), 0 gated |
| backoff-tests | test-scaffolding | 3/3 pass, 32,500 in (32,000–33,000), 0 gated | 3/3 pass, 5,800 in (5,300–6,300), 0 gated |
| tsconfig | config-generation | 3/3 pass, 33,500 in (33,000–34,000), 0 gated | 3/3 pass, 5,900 in (5,400–6,400), 0 gated |
| prettier-config | config-generation | 3/3 pass, 34,500 in (34,000–35,000), 0 gated | 2/3 pass, 6,000 in (5,500–6,500), 0 gated |
| service-ports | config-generation | 3/3 pass, 35,500 in (35,000–36,000), 0 gated | 3/3 pass, 6,100 in (5,600–6,600), 0 gated |
| rename-fmt-cents | multi-file-edit | 3/3 pass, 36,500 in (36,000–37,000), 0 gated | 3/3 pass, 6,200 in (5,700–6,700), 0 gated |
| console-to-logger | multi-file-edit | 3/3 pass, 37,500 in (37,000–38,000), 0 gated | 3/3 pass, 6,300 in (5,800–6,800), 0 gated |
| license-headers | multi-file-edit | 3/3 pass, 38,500 in (38,000–39,000), 0 gated | 3/3 pass, 6,400 in (5,900–6,900), 0 gated |

## Failures

- balanced / prettier-config (run 2): .prettierrc.json is missing or is not a JSON object
