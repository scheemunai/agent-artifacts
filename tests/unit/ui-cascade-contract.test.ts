import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Fresh Air foundation is authored as one stylesheet, so several of its worst defects are not
 * visible in any single declaration — they are cascade and geometry accidents that only show up
 * once you resolve a rule the way a browser does. These tests resolve them.
 */
const appCss = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));

/** Comments in this sheet quote the declarations they explain, so they must not be parsed. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const ROOT_FONT_SIZE = 16;

function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body of the first `selector { … }` rule. Selectors in this sheet never nest braces. */
function ruleBlock(css: string, selector: string): string {
  const match = new RegExp(`(?:^|[};])\\s*${escapeSelector(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(
    css
  );
  if (!match?.[1]) {
    throw new Error(`no rule found for selector ${selector}`);
  }
  return match[1];
}

function declaration(block: string, property: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${escapeSelector(property)}\\s*:\\s*([^;]+);`, 'm')
    .exec(block)?.[1]
    ?.trim();
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') {
      depth += 1;
    }
    if (character === ')') {
      depth -= 1;
    }
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Splits a grid track list on top-level whitespace: `minmax(0, 80vw) 1fr` is two tracks. */
function splitTracks(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value.trim()) {
    if (character === '(') {
      depth += 1;
    }
    if (character === ')') {
      depth -= 1;
    }
    if (/\s/.test(character) && depth === 0) {
      if (current) {
        tracks.push(current);
      }
      current = '';
      continue;
    }
    current += character;
  }
  if (current) {
    tracks.push(current);
  }
  return tracks;
}

const themeVariables = new Map<string, string>(
  Array.from(
    (/@theme\s*\{([\s\S]*?)\n\}/.exec(appCss)?.[1] ?? '').matchAll(
      /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
    ),
    (match) => [match[1] as string, (match[2] as string).trim()]
  )
);

function resolveVars(value: string): string {
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_match, name: string) => {
    const resolved = themeVariables.get(name);
    if (resolved === undefined) {
      throw new Error(`unknown theme variable ${name}`);
    }
    return resolveVars(resolved);
  });
}

/** Resolves the widest value a CSS length expression can take at a given viewport width. */
function maxLength(expression: string, viewportWidth: number): number {
  const value = resolveVars(expression).trim();

  const call = /^([a-z-]+)\((.*)\)$/is.exec(value);
  if (call?.[1] && call[2] !== undefined) {
    const args = splitTopLevel(call[2]).map((argument) => maxLength(argument, viewportWidth));
    const name = call[1].toLowerCase();
    if (name === 'min') {
      return Math.min(...args);
    }
    if (name === 'max' || name === 'minmax') {
      // `minmax(a, b)` grows to its max track; `max()` to its largest argument.
      return Math.max(...args);
    }
    throw new Error(`unsupported length function in "${expression}"`);
  }

  if (value.endsWith('vw')) {
    return (Number.parseFloat(value) / 100) * viewportWidth;
  }
  if (value.endsWith('rem')) {
    return Number.parseFloat(value) * ROOT_FONT_SIZE;
  }
  if (value.endsWith('px')) {
    return Number.parseFloat(value);
  }
  if (value === '0') {
    return 0;
  }
  if (value === '1fr' || value === 'auto') {
    return Number.POSITIVE_INFINITY;
  }
  throw new Error(`unsupported length "${expression}"`);
}

describe('overlay geometry', () => {
  it('re-centres modal dialogs that the Tailwind preflight un-centres', () => {
    // Preflight emits `*,::backdrop{margin:0}`, which overrides the UA sheet's `dialog{margin:auto}`.
    // Without an explicit re-declaration every showModal() dialog paints at the viewport's 0,0.
    const dialog = ruleBlock(appCss, '.aa-dialog');

    expect(declaration(dialog, 'margin')).toBe('auto');
  });

  it('keeps the drawer scrim covering every pixel the panel does not', () => {
    const drawer = ruleBlock(appCss, '.aa-drawer');
    const panel = ruleBlock(appCss, '.aa-drawer__panel');

    const tracks = splitTracks(resolveVars(declaration(drawer, 'grid-template-columns') ?? ''));
    expect(tracks).toHaveLength(2);

    const panelMaxWidth = maxLength(declaration(panel, 'max-width') ?? '', 0);
    const panelTrack = tracks[0] as string;

    // `role="dialog" aria-modal="true"` is a lie for every pixel of page that is left undimmed and
    // still clickable, so the panel's grid track must never be wider than the panel it paints.
    for (const viewportWidth of [375, 480, 768, 1024, 1440, 1920]) {
      expect(
        maxLength(panelTrack, viewportWidth),
        `panel track at ${viewportWidth}px`
      ).toBeLessThanOrEqual(panelMaxWidth);
    }
  });
});
