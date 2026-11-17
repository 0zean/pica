# Pica eval report (C-10)

Runtime: copilot. Generated 2026-11-17T05:58:43.262Z. Tier settings: reasoning `gpt-5.6-luna`, worker `auto`. **Stopped early: the credit limit of 6 was passed after 2 sessions (6.22 credits), during console-to-logger.** Each task ran once per profile; token, credit and time figures are means over runs, with the per-run range in brackets. "Reasoning input" counts fresh and cached input tokens of reasoning-tier calls; "gated" is the mean number of cost-rule decisions that were not allow.

## Summary

| Profile | Reasoning model | Worker model | Succeeded | Reasoning input (fresh + cached) | Reasoning output | Worker input | Credits | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| balanced | gpt-5.6-luna | claude-haiku-5.5 | 2/2 | 529,588 (56,868 + 472,720) | 22,292 | 87,708 | 6.2236 | 240.7 s |

## Tasks

| Task | Category | balanced |
| --- | --- | --- |
| rename-fmt-cents | multi-file-edit | 1/1 pass, 407,342 in, 25 gated |
| console-to-logger | multi-file-edit | 1/1 pass, 122,246 in, 0 gated |

## Failures

None.
