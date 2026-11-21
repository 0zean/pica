## Install

In Terminal:

```sh
curl -fsSL https://github.com/0zean/pica/releases/latest/download/install.sh | sh
```

The script downloads the zip with `curl`, checks it against `SHA256SUMS`, verifies its signature, and installs
`Pica.app` into `/Applications` (or `~/Applications`). This build is ad-hoc signed and not notarized, so do not open a
copy downloaded in a browser before running `xattr -dr com.apple.quarantine /path/to/Pica.app`; if macOS already said
"Pica" Not Opened, delete that copy and install again. Installed copies update themselves through Sparkle.

After an update, macOS may ask once for each Keychain item Pica uses ("Pica wants to use your confidential
information"); choose Always Allow. See [docs/distribution.md](https://github.com/0zean/pica/blob/main/docs/distribution.md).
