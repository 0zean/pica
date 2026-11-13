# Brand

The source artwork is [`Magpie Glass Icon.png`](../Magpie%20Glass%20Icon.png). Everything else is derived from it.

## Palette

Sampled from the logo (5×5-pixel averages, sRGB). The code lives in `app/Packages/DesignSystem/Sources/DesignSystem/Tokens/Palette.swift` as `BrandColor`.

| Token | Hex | Where in the logo |
|---|---|---|
| `ink` | `#3E4251` | the magpie's black plumage |
| `slate` | `#62859C` | wing and tail |
| `paper` | `#FBF6F2` | belly |
| `ring` | `#9AA0B0` | the open ring |
| `spark` | `#A7B6C5` | the two spark marks |
| `gradientStart` | `#C9D6EC` | periwinkle backdrop, upper left |
| `gradientEnd` | `#FFE4D2` | peach backdrop, lower right |

Views use the semantic roles in `Palette` (background, surface, text, accent, status colors), which have
light, dark, and increased-contrast values. `ContrastTests` holds text roles to WCAG AA, and to AAA under
increased contrast. The gradient pair appears only in empty states and onboarding (PLAN.md §7.3).

## Activity motif

`ActivityMark` draws the ring and sparks with the logo's geometry: the ring opens at the lower left and the
sparks sit inside it at the upper left. The sparks pulse while an agent works and hold still under Reduce
Motion; the ring becomes a progress arc when given a fraction.

## Bitmaps

`swift tools/brand/generate-assets.swift` (from the repository root) cuts the glass tile out of the logo and writes:

- `app/Packages/DesignSystem/Sources/DesignSystem/Resources/PicaMark.png`, shown by `BrandMark`.
- `app/Pica/Assets.xcassets/AppIcon.appiconset`, on Apple's 824-on-1024 icon grid.

## Gallery

`ComponentGallery` shows every token and component. Run the `PicaGallery` scheme to browse it. Its snapshot
references live in `app/Packages/DesignSystem/Tests/DesignSystemTests/__Snapshots__/macOS-<major>/`, one set
per macOS major version because system text rendering differs between releases; record with
`PICA_RECORD_SNAPSHOTS=1 swift test --package-path app/Packages/DesignSystem`. On a mismatch the rendered image
is written to the package's `.snapshot-failures/`, which CI uploads as an artifact.
