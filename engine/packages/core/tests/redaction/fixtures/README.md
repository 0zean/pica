# Redaction fixtures

Every token, key and password here is fake: made up for these tests, often with `FAKE`/`fake` in the value, or AWS's published example key. None grants access to anything.

- `token-corpus.json` — `redact`: text containing secrets in their usual context, with the secrets that must not survive; `preserve`: text that must come out unchanged.
- `session.pica.ndjson`, `engine.log`, `session-files/billing.ts.txt` — a recorded session whose events quote the file and echo corpus secrets, used by the diagnostics bundle test.
