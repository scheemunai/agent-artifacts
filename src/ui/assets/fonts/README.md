# Bundled fonts

Every font here is loaded from disk. Nothing in this directory is fetched over the network at
render time or at page load. Licensing is recorded in `THIRD-PARTY-NOTICES.md`.

| File | Used by | Notes |
| --- | --- | --- |
| `source-sans-3-latin-var.woff2` | Browser `@font-face` in `src/ui/assets/app.css` | Latin subset, variable `wght` 200-900. Copied to `public/assets/fonts/` by `scripts/copy-font-assets.mjs`. |
| `source-sans-3-latin-regular.ttf` | Open Graph renderer (`src/lib/og.ts`) | Static `wght` 400 instance of the woff2 above. |
| `source-sans-3-latin-semibold.ttf` | Open Graph renderer (`src/lib/og.ts`) | Static `wght` 600 instance of the woff2 above. |
| `source-sans-3-OFL.md` | Licence text | SIL OFL 1.1 for all Source Sans 3 files. |

Source Sans 3 is the only bundled family. The retired Inter files (`inter-latin-*.ttf`, `OFL.txt`)
were deleted with the Fresh Air repaint of the OG card; nothing in the repository referenced them.

## Why the OG renderer needs `.ttf`

satori parses font binaries directly and does not support woff2 compression, so the browser's
variable woff2 cannot be reused for Open Graph cards. The two static TTFs are instanced from that
same woff2 subset, which keeps the unfurl and the product pages on identical glyph outlines.

## Regenerating the static instances

Requires `fonttools` and `brotli`.

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

variable = TTFont('src/ui/assets/fonts/source-sans-3-latin-var.woff2')
variable.flavor = None
variable.save('/tmp/ss3-var.ttf')

for weight, style, label in ((400, 'Regular', 'regular'), (600, 'SemiBold', 'semibold')):
    font = TTFont('/tmp/ss3-var.ttf')
    instancer.instantiateVariableFont(font, {'wght': weight}, updateFontNames=False, inplace=True)
    font['OS/2'].usWeightClass = weight
    full = 'Source Sans 3' if style == 'Regular' else f'Source Sans 3 {style}'
    postscript = f"SourceSans3-{style}"
    records = {1: full, 2: 'Regular', 3: f'3.052;ADBO;{postscript};ADOBE', 4: full, 6: postscript}
    if style != 'Regular':
        records[16] = 'Source Sans 3'
        records[17] = style
    for name_id, value in records.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
        font['name'].setName(value, name_id, 1, 0, 0)
    if style == 'Regular':
        font['name'].removeNames(16)
        font['name'].removeNames(17)
    font.save(f'src/ui/assets/fonts/source-sans-3-latin-{label}.ttf')
```

The name records are set explicitly because the variable subset's default instance is ExtraLight,
so `updateFontNames=True` would stamp "Source Sans 3 ExtraLight" onto both static weights.

## Glyph coverage

The latin subset covers ASCII, Latin-1 Supplement and the curly quotes, dashes, bullet and ellipsis
that `isSupportedOgCodePoint` in `src/lib/og.ts` allows. It does **not** contain U+25C6 BLACK
DIAMOND, which is why the OG card draws the product mark as vector paths rather than as a glyph.
Any change to the subset must keep that allow-list and this file in step.
