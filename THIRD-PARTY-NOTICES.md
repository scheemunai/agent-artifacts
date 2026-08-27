# Third-party notices

Agent Artifacts is distributed under the MIT License. This file records third-party components that are bundled with, generated into, or highlighted by the Docker/runtime distribution. It is not a replacement for the license files included inside package distributions in `node_modules`.

## Runtime npm packages with MPL-2.0 terms

The production dependency set includes unmodified npm packages licensed under the Mozilla Public License 2.0 (MPL-2.0). The MPL applies to those package files. If Agent Artifacts modifies MPL-covered files, those modifications must remain available under MPL-2.0.

- `@resvg/resvg-js@2.6.2` — MPL-2.0 — used for Open Graph image rendering/rasterization.
- `@resvg/resvg-js-* @2.6.2` platform packages — MPL-2.0 — optional/native platform packages for `@resvg/resvg-js`, including the Linux package used in the Docker image.
- `satori@0.33.4` — MPL-2.0 — used for rendering Open Graph image SVG content.

The npm packages include their own license metadata/files. The MPL-2.0 text is available from Mozilla at <https://www.mozilla.org/MPL/2.0/>.

## Runtime npm package with dual MPL/Apache terms

- `dompurify@3.4.14` is a transitive runtime dependency via `isomorphic-dompurify`. Its package metadata declares `(MPL-2.0 OR Apache-2.0)`. Agent Artifacts uses it as an unmodified package and elects the Apache-2.0 option for distribution compatibility where an election is needed.

## Bundled Inter font subset

Agent Artifacts bundles a subset of Inter in:

- `src/ui/assets/fonts/inter-latin-regular.ttf`
- `src/ui/assets/fonts/inter-latin-semibold.ttf`
- `src/ui/assets/fonts/OFL.txt`

Copyright notice from `OFL.txt`:

> Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)

The Inter font files are licensed under the SIL Open Font License, Version 1.1. The full OFL text is included at `src/ui/assets/fonts/OFL.txt` and should stay adjacent to redistributed font files.

## Bundled Source Sans 3 font subset

Agent Artifacts bundles a latin subset of Source Sans 3 in:

- `src/ui/assets/fonts/source-sans-3-latin-var.woff2`
- `public/assets/fonts/source-sans-3-latin-var.woff2`
- `src/ui/assets/fonts/source-sans-3-latin-regular.ttf`
- `src/ui/assets/fonts/source-sans-3-latin-semibold.ttf`
- `src/ui/assets/fonts/source-sans-3-OFL.md`

The two `.ttf` files are static weight instances (400 and 600) derived from the bundled
variable `.woff2` subset, because the Open Graph renderer (satori) cannot consume woff2.
Derivation is documented in `src/ui/assets/fonts/README.md`.

Copyright notice from `source-sans-3-OFL.md`:

> Copyright 2010-2024 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.

The Source Sans 3 font file is licensed under the SIL Open Font License, Version 1.1. The full OFL text is included at `src/ui/assets/fonts/source-sans-3-OFL.md`.

## Generated Tailwind CSS

`public/assets/app-*.css` is generated from first-party source CSS at `src/ui/assets/app.css` by `pnpm run build:css` / `scripts/hash-css.mjs`. The generated file includes Tailwind CSS's banner:

> tailwindcss v4.3.3 | MIT License | https://tailwindcss.com

## Checked-in public runtime assets

The following checked-in `public/assets` files are first-party Agent Artifacts runtime assets and are covered by this repository's MIT License unless a file header states otherwise:

- `public/assets/dashboard-m4.js`
- `public/assets/og-fallback.png` — rendered by the first-party Open Graph pipeline (`src/lib/og.ts`)
- `public/assets/ui-foundation-9ff54f825be4.js`
- `public/assets/viewer-0f4f9f6c8a7e.js`
- `public/assets/viewer-4fd0df5f2b2a.css`
- `public/assets/.gitkeep`

These files should be treated as first-party source/runtime code. If any future generated asset embeds third-party code, add that component and license here before release.
