# mac2jb app icon

These are the original mac2jb icon PNG representations, extracted unchanged
from `mac2jb.app/Contents/Resources/mac2jb.icns` in the official release:

https://github.com/cpypwn/mac2jb/releases/download/v0.4.3/mac2jb-v0.4.3-macos-arm64.zip

The release archive was downloaded over verified HTTPS. Its SHA-256 at
extraction was:

`a46b7c2037e9bb29d5cb78702f5dc11a4314cae7ed245636a2427f4522a9a161`

The icon's original source is `gui/KeyboardMark.swift` and
`scripts/make-app-icon.swift` in https://github.com/cpypwn/mac2jb.
The reference checkout inspected for those files was commit
`79a03577fb61061aa603e9583a0e6eebad9cac2b`.

| File | ICNS representation | Dimensions | SHA-256 |
| --- | --- | --- | --- |
| `icon0.png` | `ic10` | 1024 × 1024 | `2fafb82fedd02609670b9b7f207ef66ebacafb01b01176325b3076a5abfb02a2` |
| `payload-icon.png` | `ic07` | 128 × 128 | `994906559f31a4fac36b8e15a69a8e3a0a3f00978a7aefc501aa6abccc18fd48` |

The files retain the original transparent inset, dark rounded square, and
mint face. They were not resized, cropped, recolored, or regenerated.
The smaller original representation is 2,659 bytes, suitable for Payload
Manager's maximum 12,288-character PNG data URI.

mac2jb's MIT license is preserved in `mac2jb-LICENSE.txt`.
`scripts/extract-mac2jb-icon.py` can reproduce the extraction from the
exact release ZIP above; network access is not needed by the normal build.
