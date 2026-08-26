import { readFileSync } from 'node:fs';

const FALLBACK_STYLESHEET = '/assets/app.css';

interface AssetManifest {
  'app.css'?: string;
}

export function stylesheetHref(): string {
  try {
    const manifest = JSON.parse(
      readFileSync('public/assets/manifest.json', 'utf8')
    ) as AssetManifest;
    return manifest['app.css'] ?? FALLBACK_STYLESHEET;
  } catch {
    return FALLBACK_STYLESHEET;
  }
}
