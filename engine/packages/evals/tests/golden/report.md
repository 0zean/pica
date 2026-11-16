# Pica eval report (C-10)

Runtime: fake. Generated 2026-11-16T09:01:13.500Z. "Reasoning input" counts fresh and cached input tokens of reasoning-tier calls; "gated" counts cost-rule decisions that were not allow.

## Summary

| Profile | Reasoning model | Worker model | Succeeded | Reasoning input (fresh + cached) | Reasoning output | Worker input | Credits | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off | model-r | none | 12/12 | 354,000 (282,000 + 72,000) | 4,800 | 0 | 93.9600 | 18.0 s |
| balanced | model-r | model-w | 11/12 | 60,600 (36,600 + 24,000) | 1,800 | 270,000 | 21.6300 | 18.0 s |

## balanced against off

- Reasoning-tier input tokens: 60,600 against 354,000, 82.9% fewer (target: at least 60.0% fewer).
- Tasks succeeded: -1 (target: at most 1 fewer).
- Target met: yes.

## Tasks

| Task | Category | off | balanced |
| --- | --- | --- | --- |
| schema-column-owner | large-file-question | pass, 24,000 in, 0 gated | pass, 4,500 in, 1 gated |
| settlement-log-error | large-file-question | pass, 25,000 in, 0 gated | pass, 4,600 in, 1 gated |
| error-code-value | large-file-question | pass, 26,000 in, 0 gated | pass, 4,700 in, 1 gated |
| money-tests | test-scaffolding | pass, 27,000 in, 0 gated | pass, 4,800 in, 0 gated |
| slug-tests | test-scaffolding | pass, 28,000 in, 0 gated | pass, 4,900 in, 0 gated |
| backoff-tests | test-scaffolding | pass, 29,000 in, 0 gated | pass, 5,000 in, 0 gated |
| tsconfig | config-generation | pass, 30,000 in, 0 gated | pass, 5,100 in, 0 gated |
| prettier-config | config-generation | pass, 31,000 in, 0 gated | FAIL, 5,200 in, 0 gated |
| service-ports | config-generation | pass, 32,000 in, 0 gated | pass, 5,300 in, 0 gated |
| rename-fmt-cents | multi-file-edit | pass, 33,000 in, 0 gated | pass, 5,400 in, 0 gated |
| console-to-logger | multi-file-edit | pass, 34,000 in, 0 gated | pass, 5,500 in, 0 gated |
| license-headers | multi-file-edit | pass, 35,000 in, 0 gated | pass, 5,600 in, 0 gated |

## Failures

- balanced / prettier-config: .prettierrc.json is missing or is not a JSON object
