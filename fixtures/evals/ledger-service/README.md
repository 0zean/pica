# ledger-service

A small double-entry ledger used by the Pica eval suite (C-10). Plain ES modules, no dependencies.

- `src/money.mjs`: integer-cent arithmetic and formatting.
- `src/invoice.mjs`, `src/statement.mjs`: rendering built on `money.mjs`.
- `db/schema.sql`: the full database schema.
- `logs/settlement.log`: one night's settlement run.
- `src/generated/error-codes.mjs`: every error code the service can return.

Run the tests with `npm test` (`node --test`).
