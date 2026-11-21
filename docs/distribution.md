# Distribution (H-06)

Pica ships as an ad-hoc signed (`codesign -s -`), hardened-runtime app attached to GitHub Releases (D-17). It is not
notarized, so it is installed without quarantine: `install.sh` is the primary route, and clearing the quarantine with
`xattr` before the first launch is the fallback (S-05). Installed copies update themselves with Sparkle, whose
EdDSA signatures do not depend on Apple signing. Developer ID signing and notarization are an optional step of the
same workflow. It runs only when its secrets exist, and needs no design change.

Everything lives in `tools/release/`. The checks in [Verification](#verification) are H-06's checks in
`tools/verify/units.json`.

## What a release holds

| Asset | What it is |
|---|---|
| `Pica-<version>.zip` | `Pica.app`, zipped with `ditto -c -k --keepParent`. About 105 MB, arm64 only. |
| `SHA256SUMS` | `shasum -a 256` of the zip, `install.sh` and `appcast.xml` |
| `install.sh` | The install script (below) |
| `appcast.xml` | Sparkle's feed, with one item for this release. Present only when the Sparkle key is configured. |

The bundle, in the layout A-01 runs (`docs/app-shell.md`):

```
Pica.app/Contents/
  MacOS/Pica                      the app (Xcode, Release, arm64)
  Frameworks/Sparkle.framework    Sparkle 2.10.1, without its XPC services (Pica is not sandboxed, D-12)
  Helpers/node                    the nodejs.org Node the build ran with (.nvmrc), re-signed
  Resources/engine/picad.mjs      the engine, bundled by esbuild into one file, stamped with the release version
  Resources/engine/builtin/       the built-in agents the engine reads next to itself
  Resources/copilot/              @github/copilot-sdk-darwin-arm64, layout unchanged (S-05)
```

`Info.plist` is stamped by `package.sh`:

- `CFBundleShortVersionString` and `CFBundleVersion` are both the release version, `x.y.z`.
- `SUFeedURL` is `https://github.com/0zean/pica/releases/latest/download/appcast.xml`.
- `SUPublicEDKey` is the Sparkle public key, when one is configured.
- `SUEnableAutomaticChecks` is `true`.

The engine's `engine.hello` reports the same version: `engine/tools/bundle` replaces
`packages/server/src/version.ts`, which is `0.0.0` in source builds. A Node that links libraries outside the base
system, such as Homebrew's, is refused, because it would not run on another Mac.

## Signing

`tools/release/sign.sh` signs inside out. It uses `--options runtime`, and `--timestamp=none` for ad-hoc signing
(`--timestamp` for a Developer ID):

1. It signs every Mach-O file, deepest path first. There are 14: the app, Sparkle's `Autoupdate` and `Updater`, Node,
   and the Copilot package's binaries.
2. It signs every nested `.app`, `.framework` and `.xpc` bundle, deepest first.
3. It signs the app.

| Binary | Entitlements | Why |
|---|---|---|
| `Helpers/node` | `allow-jit` | V8's JIT under the hardened runtime (S-05) |
| `MacOS/Pica` | `disable-library-validation`, ad-hoc only | It loads `Sparkle.framework`. Library validation admits only libraries with the process's Team ID, and an ad-hoc signature has none, so without it dyld refuses the framework ("different Team IDs"). |
| `copilot-runtime` | `disable-library-validation`, ad-hoc only | It `dlopen`s `runtime.node`, for the same reason (S-05) |
| everything else | none | |

With a Developer ID, everything carries one Team ID, so neither `disable-library-validation` is needed or used.

`verify_app` is the check: `codesign --verify --deep --strict` on the app, and on each Mach-O file with the hardened
runtime flag. Each Mach-O file is checked as well, because code under `Resources/` is sealed as a resource and
`--deep` does not descend into it.

## Install

```sh
curl -fsSL https://github.com/0zean/pica/releases/latest/download/install.sh | sh
```

`install.sh [--version x.y.z] [--from <folder>] [--dest <folder>]` uses only base-system tools. It runs these steps:

1. Downloads `SHA256SUMS` and the zip it lists, with `curl`, HTTPS only. `curl` sets no `com.apple.quarantine`.
2. Checks the SHA-256 and refuses on a mismatch.
3. Unzips with `ditto`. It runs `codesign --verify --deep --strict` on the app, and `--strict` on `Helpers/node` and
   `copilot-runtime`.
4. Installs into `/Applications`, or `~/Applications` when `/Applications` is not writable. It refuses while Pica is
   running from the destination.

Each failure ends with "Nothing was installed."

- `--version` picks a release; the default is the latest published one.
- `--from` installs from a folder that holds `SHA256SUMS` and the zip: a local build's `dist/`, or a draft release's
  assets.

**Fallback (browser download).** Unzip the download and move `Pica.app` to `/Applications`. Then, before opening it:

```sh
xattr -dr com.apple.quarantine /Applications/Pica.app
```

If macOS has already said "Pica" Not Opened, Gatekeeper's verdict is cached for that copy. Delete it, unzip again and
clear the quarantine before the first launch (S-05).

**Keychain prompt after updates.** An ad-hoc designated requirement is the code hash, so it changes with every
release. On the first read after an update, macOS asks once per Keychain item ("Pica wants to use your confidential
information…"). Choose Always Allow. A Developer ID removes this (§11.1).

## Updates (Sparkle)

`app/Packages/Updates` wraps Sparkle 2.10.1, pinned exactly. `AppUpdater` starts `SPUStandardUpdaterController` only
when `Info.plist` has both `SUFeedURL` and `SUPublicEDKey`. "Check for Updates…" in the Pica menu appears only then.
Debug builds and releases built without a key never check.

- **Feed.** `SUFeedURL` points at `releases/latest/download/appcast.xml`, which GitHub serves from the latest
  *published* release. Drafts are never offered. Each release's `appcast.xml` has a single item: the version,
  `minimumSystemVersion` from the bundle, and the enclosure URL
  `https://github.com/0zean/pica/releases/download/v<version>/Pica-<version>.zip` with its `sparkle:edSignature` and
  `length`.
- **Signature.** `appcast.sh` signs the zip with Sparkle's `sign_update`, reading `SPARKLE_PRIVATE_ED_KEY` on stdin.
  Sparkle refuses an update whose EdDSA signature does not match the running app's `SUPublicEDKey` ("EdDSA signature
  does not match"). The installed app is then left as it was.
- **Install.** Sparkle downloads in-process, verifies, and replaces the bundle, then relaunches Pica. Pica sends
  SIGTERM to the engine it started (A-01), so the new app starts the new engine. An engine started by the CLI keeps
  running; if its protocol major differs, the app shows A-01's blocking mismatch panel. Sparkle's download carries no
  quarantine, and its installer releases any quarantine before the swap. The update check asserts that the updated
  bundle has none.
- **Keys.** Sparkle accepts an update that changes either the EdDSA key or the Apple signing identity, never both at
  once. So keep the EdDSA key when Developer ID signing starts, and do not change both in one release.

## The release workflow

`.github/workflows/release.yml` runs on `workflow_dispatch` with a `version` input (`x.y.z`), on `macos-26`:

1. Sets up pnpm, Node (`.nvmrc`; this Node becomes `Helpers/node`) and the Metal Toolchain.
2. If the Developer ID secrets exist, imports the certificate into a temporary keychain and sets
   `PICA_SIGN_IDENTITY`. Otherwise it logs "signing ad-hoc" and goes on.
3. If the notary secrets also exist, writes the API key for `notarize.sh`.
4. Runs `tools/release/build.sh --version <version> --out dist`. This step is the same as `make release`:
   - `xcodebuild` Release, arm64, unsigned.
   - `package.sh`.
   - `notarize.sh` (`notarytool submit --wait`, `stapler staple`, re-zip), when a Developer ID and the notary key
     exist.
   - `appcast.sh`, when the Sparkle key exists.
   - Copies `install.sh` and writes `SHA256SUMS`.
5. Runs `shasum -c SHA256SUMS` and `check-bundle.sh` on the zip: it unzips it, runs `verify_app`, checks that the
   versions match, and starts the bundled engine for `engine.hello`.
6. Creates a **draft** release `v<version>` targeting the commit, or replaces the assets of an existing draft. It
   refuses to touch a published release.

The workflow never publishes and never creates a tag. A draft has no tag until it is published. Publishing is the
owner's step:

```sh
gh release edit v<version> --repo 0zean/pica --draft=false
```

Publishing creates the tag and makes the release "latest", and with it the target of `install.sh` and of the
appcast.

## Secrets (owner setup)

Without any of them, the workflow produces an ad-hoc build that cannot update itself.

### Sparkle EdDSA key (needed for updates)

Do this once, on the owner's Mac. The tools come with Sparkle's Swift package, so build the `Updates` package first:

```sh
swift build --package-path app/Packages/Updates
bin=app/Packages/Updates/.build/artifacts/sparkle/Sparkle/bin
"$bin/generate_keys" --account pica                       # stores the private key in the login Keychain, prints the public key
"$bin/generate_keys" --account pica -x pica-sparkle.key   # exports the private key (base64) to a file
gh secret set SPARKLE_PRIVATE_ED_KEY --repo 0zean/pica < pica-sparkle.key
gh variable set SPARKLE_PUBLIC_ED_KEY --repo 0zean/pica --body "$("$bin/generate_keys" --account pica -p)"
rm -P pica-sparkle.key
```

| Name | Kind | Value |
|---|---|---|
| `SPARKLE_PRIVATE_ED_KEY` | secret | The exported private key (base64) |
| `SPARKLE_PUBLIC_ED_KEY` | variable | The public key, written into `SUPublicEDKey` |

Keep the Keychain item, which is also the backup. If the private key is lost, installed copies can no longer be
updated, and every user has to run `install.sh` again with a build that has a new key. Copies installed from a build
made without a key never check for updates. Reinstall them once with `install.sh` after the first release that has a
key.

### Developer ID and notarization (optional, later)

| Secret | Value |
|---|---|
| `DEVELOPER_ID_P12` | Base64 of the "Developer ID Application" certificate and key, exported as .p12 (`base64 -i cert.p12`) |
| `DEVELOPER_ID_P12_PASSWORD` | The .p12's password |
| `APPLE_NOTARY_KEY` | Contents of an App Store Connect API key (`AuthKey_….p8`) |
| `APPLE_NOTARY_KEY_ID` | That key's ID |
| `APPLE_NOTARY_ISSUER` | The issuer ID |

With these set:

- The build is signed with `--timestamp` and without `disable-library-validation`, then notarized and stapled.
- A browser download opens normally, and `install.sh` and the `xattr` step become optional.
- Keychain designated requirements become stable across releases.

Test the first Developer ID release as an update from an ad-hoc one, with the same EdDSA key (S-05).

## Local builds

Needs Xcode with the Metal Toolchain, pnpm, and a nodejs.org Node 22.13 or later (nvm's builds qualify):

```sh
make release VERSION=0.1.0                 # writes dist/: Pica-0.1.0.zip, install.sh, SHA256SUMS
sh dist/install.sh --from dist             # installs dist's zip into /Applications
```

`build.sh` reads the same optional environment as the workflow: `SPARKLE_PUBLIC_ED_KEY` and
`SPARKLE_PRIVATE_ED_KEY`, `PICA_SIGN_IDENTITY`, and `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER` and
`APPLE_NOTARY_KEY_PATH`. To install a draft release, whose assets are not public:

```sh
gh release download v0.1.0 --repo 0zean/pica --dir ~/Downloads/pica-v0.1.0
sh ~/Downloads/pica-v0.1.0/install.sh --from ~/Downloads/pica-v0.1.0
```

`gh` sets no quarantine either.

## Verification

| Check | Command | What it does |
|---|---|---|
| Draft release | `tools/release/check-release.sh [x.y.z]` | Downloads the newest draft release's assets with `gh`, then checks `SHA256SUMS` and runs `check-bundle.sh` on the zip |
| Update N → N+1 | `tools/release/check-update.sh update` | Packages 0.1.0 and 0.1.1 with a throwaway key and installs 0.1.0 with `install.sh`. It then serves an appcast for 0.1.1 on 127.0.0.1, and Sparkle updates the installed app. The bundle must then be 0.1.1, pass `--deep --strict`, carry no quarantine, and its engine must answer `engine.hello` with 0.1.1. |
| Bad signature | `tools/release/check-update.sh bad-signature` | Same setup, but the appcast's `edSignature` is made with a different key. Sparkle must refuse the update for its EdDSA signature, and 0.1.0 must stay installed with the same code hash. |

Notes on the update checks:

- They drive Sparkle's own `SPUUpdater`, with the same download, EdDSA and code-signature validation and the same
  installer, from `tools/release/update-check`. That is a small command-line host with a non-interactive user
  driver, like Sparkle's `sparkle-cli`. It points the updater at the installed bundle and overrides the feed URL.
- The builds use the bundle identifier `dev.pica.Pica.update-test`, so Sparkle's defaults and caches never touch the
  real app's. They are removed afterwards.
- The host is copied out of the checkout before it runs. Sparkle's installer launch calls `AuthorizationCreate`,
  which fails with -60008 for a client under `~/Documents`, because authd cannot read it (TCC).
- Sparkle refuses `file://` feeds, so the appcast is served over HTTP on 127.0.0.1.
- The checks need Xcode (they build Release once, into `app/.derived/release`) and take about 30 s after that.
