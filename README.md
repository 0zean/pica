# Pica

A native macOS app for running coding agents on enterprise codebases through GitHub Copilot. The design, work units, and their checks are in [PLAN.md](PLAN.md).

## Prerequisites

- Node 22 (`.nvmrc`) and pnpm (`npm install -g pnpm`; the version is pinned in `engine/package.json`)
- Xcode 16 or later, with its license accepted (`sudo xcodebuild -license accept`)

## Verify

```
make verify
```

Runs lint, type checks, and tests for the engine, then builds the Swift packages and the app.
