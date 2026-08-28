/**
 * A small, deliberately honest CSS cascade resolver for the design-system contract tests.
 *
 * Several of the foundation's worst defects are invisible in any single declaration: a rule that
 * looks correct loses a specificity tie, or an inherited property reaches a descendant nobody
 * intended it to reach. Asserting on literal strings cannot catch those, and a literal-string
 * assertion also goes stale the moment the fix is refactored. So these helpers resolve the way a
 * browser does — matching, specificity, source order, media queries, inheritance — over the real
 * stylesheets.
 *
 * Scope is bounded on purpose: class/element/attribute selectors, descendant and child
 * combinators, `:not()`, `:where()`, and `@media (min-width|max-width: …)`. That is the whole
 * vocabulary `app.css` and the viewer stylesheet use. Anything outside it throws rather than
 * silently returning a wrong answer.
 *
 * ── IT RESOLVES THE STYLESHEET, NOT THE DOCUMENT ───────────────────────────────────────────────
 *
 * This is the limit that has actually cost us, so it is stated where the tool lives rather than
 * left to be rediscovered. These helpers answer "which declaration wins for a hypothetical element
 * at a hypothetical viewport". They cannot see:
 *
 *   · runtime state — `hidden`, `data-state="closed"`, anything script toggles;
 *   · whether an element is in the document at that moment, or in it at all;
 *   · and therefore anything of the form "how many of X does a reader see right now".
 *
 * So a resolved result can BOUND a guarantee — "no more than one copy is ever styled visible" —
 * and can never CONFIRM one that depends on interaction state. Both are useful; they are not the
 * same claim, and the gap between them is invisible in a green suite.
 *
 * How it cost us, in one case, so the shape is recognisable: the NavShell account slot was
 * documented as "exactly one live at any width". Both sides of the 760px breakpoint resolved
 * cleanly and agreed, and two people read that as the whole claim. It was false — at 375 AT REST
 * the count is ZERO, because the header copy is stood down AND the drawer is closed, and a closed
 * drawer is not a CSS fact. An end-to-end test opened the drawer and counted, which is cruder than
 * anything in this file and the only thing that could have found it. The guarantee is now "at most
 * one live, and exactly one way to reach it".
 *
 * RULE OF THUMB: if the claim contains "sees", "at rest", "how many", or names a state a user or a
 * script puts the page into, this file cannot settle it. Reach for an end-to-end test, and treat a
 * green result here as the absence of a contradiction rather than as proof.
 */

export interface StyleRule {
  selector: string;
  block: string;
  media: string | null;
  order: number;
}

/** One element in a hypothetical DOM path, ancestor first. */
export interface ElementSpec {
  tag?: string;
  classes?: string[];
  attributes?: Record<string, string>;
}

export const ROOT_FONT_SIZE = 16;

/** Comments quote the declarations they explain, so they must never be parsed as CSS. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Splits on top-level commas: `:where(h1, h2)` is one selector, not two. */
export function splitTopLevel(value: string, separator = ','): string[] {
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
    if (character === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Flattens a stylesheet into ordered rules. `@layer` and `@supports` are transparent (Tailwind
 * emits everything into one cascade layer here); `@media` is carried on each rule; `@theme`,
 * `@font-face` and `@keyframes` are skipped.
 */
export function parseStylesheet(css: string, startOrder = 0): StyleRule[] {
  const rules: StyleRule[] = [];
  const counter = { value: startOrder };
  collectRules(stripComments(css), null, rules, counter);
  return rules;
}

/**
 * The order a second stylesheet should start at, so its rules sit after the first one's.
 *
 * Use this instead of arithmetic on the array. `rules.length` is the tempting version and it is
 * wrong, because ORDERS ARE NOT DENSE: `collectRules` increments once per selector and once more
 * per rule block, so a sheet of N rules ends well above order N. Seeding the next sheet at
 * `rules.length` therefore hands it orders the first sheet has already used, and the two interleave
 * — which does not throw, does not look wrong, and quietly decides source-order ties the wrong way.
 * A tie is exactly when order matters, so the failure only appears in the case the offset exists
 * for.
 *
 * `.at(-1).order + 1` happens to be right today and encodes an assumption the caller should not
 * have to hold: that the array is sorted ascending and non-empty. This takes the maximum, so it
 * stays correct for a filtered, concatenated or re-sorted set.
 *
 *   const appRules = parseStylesheet(appCss);
 *   const all = [...appRules, ...parseStylesheet(viewerCss, nextOrder(appRules))];
 */
export function nextOrder(rules: StyleRule[]): number {
  return rules.reduce((highest, rule) => Math.max(highest, rule.order), -1) + 1;
}

function collectRules(
  css: string,
  media: string | null,
  out: StyleRule[],
  counter: { value: number }
): void {
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open === -1) {
      return;
    }

    const prelude = css
      .slice(index, open)
      .replace(/^[\s;]+/, '')
      .trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') {
        depth += 1;
      } else if (css[cursor] === '}') {
        depth -= 1;
      }
      cursor += 1;
    }
    const body = css.slice(open + 1, cursor - 1);

    if (prelude.startsWith('@')) {
      if (/^@media\b/.test(prelude)) {
        collectRules(body, prelude.replace(/^@media\s*/, '').trim(), out, counter);
      } else if (/^@(?:layer|supports)\b/.test(prelude)) {
        collectRules(body, media, out, counter);
      }
      // @theme / @font-face / @keyframes contribute no matchable rules.
    } else {
      for (const selector of splitTopLevel(prelude)) {
        out.push({ selector, block: body, media, order: counter.value });
        counter.value += 1;
      }
      counter.value += 1;
    }

    index = cursor;
  }
}

/** Theme variables, so `var(--width-aa-shell)` resolves to a real length. */
export function themeVariables(css: string): Map<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(stripComments(css))?.[1] ?? '';
  return new Map(
    Array.from(block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi), (match) => [
      match[1] as string,
      (match[2] as string).trim(),
    ])
  );
}

export function resolveVars(value: string, variables: Map<string, string>): string {
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_match, name: string) => {
    const resolved = variables.get(name);
    if (resolved === undefined) {
      throw new Error(`unknown theme variable ${name}`);
    }
    return resolveVars(resolved, variables);
  });
}

/** The widest value a length expression can take at a given viewport width. */
export function maxLength(expression: string, viewportWidth: number): number {
  const value = expression.trim();

  const call = /^([a-z-]+)\((.*)\)$/is.exec(value);
  if (call?.[1] && call[2] !== undefined) {
    const args = splitTopLevel(call[2]).map((argument) => maxLength(argument, viewportWidth));
    const name = call[1].toLowerCase();
    if (name === 'min') {
      return Math.min(...args);
    }
    if (name === 'max' || name === 'minmax' || name === 'clamp') {
      return Math.max(...args);
    }
    if (name === 'calc') {
      return evaluateCalc(call[2] as string, viewportWidth);
    }
    throw new Error(`unsupported length function in "${expression}"`);
  }

  if (value.endsWith('vw')) {
    return (Number.parseFloat(value) / 100) * viewportWidth;
  }
  if (value.endsWith('rem') || value.endsWith('em')) {
    return Number.parseFloat(value) * ROOT_FONT_SIZE;
  }
  if (value.endsWith('ch')) {
    // Source Sans 3's `0` advance is roughly half its em at the sizes this sheet uses. Only ever
    // compared against other measures, never asserted as an exact pixel count.
    return Number.parseFloat(value) * ROOT_FONT_SIZE * 0.5;
  }
  if (value.endsWith('px')) {
    return Number.parseFloat(value);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number.parseFloat(value);
  }
  if (value === '1fr' || value === 'auto' || value === 'none') {
    return Number.POSITIVE_INFINITY;
  }
  throw new Error(`unsupported length "${expression}"`);
}

function evaluateCalc(expression: string, viewportWidth: number): number {
  const terms = expression.split(/\s+(?=[+-]\s)/);
  let total = 0;
  for (const [index, term] of terms.entries()) {
    const trimmed = term.trim();
    const signed = /^([+-])\s+(.*)$/s.exec(trimmed);
    if (index === 0) {
      total = maxLength(trimmed, viewportWidth);
      continue;
    }
    if (!signed?.[2]) {
      throw new Error(`unsupported calc term "${term}"`);
    }
    const operand = maxLength(signed[2], viewportWidth);
    total += signed[1] === '-' ? -operand : operand;
  }
  return total;
}

export function mediaApplies(media: string | null, viewportWidth: number): boolean {
  if (!media) {
    return true;
  }
  if (/prefers-reduced-motion|print|hover|pointer/i.test(media)) {
    return false;
  }
  return splitTopLevel(media)
    .map((query) => query.trim())
    .some((query) =>
      Array.from(query.matchAll(/\((min|max)-width:\s*([^)]+)\)/gi)).every((match) => {
        const bound = maxLength((match[2] as string).trim(), viewportWidth);
        return match[1] === 'min' ? viewportWidth >= bound : viewportWidth <= bound;
      })
    );
}

/** `[ids, classes, elements]` — enough for the vocabulary these sheets use. */
export function specificity(selector: string): [number, number, number] {
  const withoutWhere = selector.replace(/:where\([^)]*\)/gi, ' ');
  const flattened = withoutWhere.replace(/:not\(([^)]*)\)/gi, ' $1 ');
  const ids = (flattened.match(/#[\w-]+/g) ?? []).length;
  const classes = (flattened.match(/\.[\w-]+|\[[^\]]+\]|:{1}(?!:)[a-z-]+(?:\([^)]*\))?/gi) ?? [])
    .length;
  const elements = (flattened.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return [ids, classes, elements];
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] as number;
    const right = b[index] as number;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function matchesCompound(compound: string, element: ElementSpec): boolean {
  let rest = compound.trim();
  if (!rest) {
    return false;
  }

  // A stateful selector (`:hover`, `:disabled`, `[data-aa-state="hover"]`) describes a state the
  // resting element is not in, so it must not win the resting cascade.
  const stateful = /:(?:hover|focus|focus-visible|active|disabled|checked|target)\b/i.test(rest);
  if (stateful) {
    return false;
  }

  const notGroups: string[] = [];
  rest = rest.replace(/:not\(([^)]*)\)/gi, (_match, inner: string) => {
    notGroups.push(inner);
    return '';
  });
  rest = rest.replace(/:where\(([^)]*)\)/gi, '');
  rest = rest.replace(/::[a-z-]+/gi, '');
  rest = rest.replace(/:(?:first-child|last-child|only-child|root)\b/gi, '');

  const tagMatch = /^([a-z][\w-]*|\*)/i.exec(rest);
  if (tagMatch?.[1] && tagMatch[1] !== '*' && element.tag !== tagMatch[1]) {
    return false;
  }
  if (tagMatch) {
    rest = rest.slice(tagMatch[0].length);
  }

  const classes = new Set(element.classes ?? []);
  for (const className of rest.matchAll(/\.([\w-]+)/g)) {
    if (!classes.has(className[1] as string)) {
      return false;
    }
  }

  for (const attribute of rest.matchAll(/\[([\w-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]/g)) {
    const name = attribute[1] as string;
    const value = element.attributes?.[name];
    if (value === undefined) {
      return false;
    }
    if (attribute[2] === '=' && value !== attribute[3]) {
      return false;
    }
  }

  for (const group of notGroups) {
    for (const inner of splitTopLevel(group)) {
      if (matchesCompound(inner, element)) {
        return false;
      }
    }
  }

  return true;
}

/** Splits a selector into compounds and `>` combinators without cutting inside `:not(a b)`. */
function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    if (current.trim()) {
      parts.push(current.trim());
    }
    current = '';
  };

  for (const character of selector.trim()) {
    if (character === '(') {
      depth += 1;
    }
    if (character === ')') {
      depth -= 1;
    }
    if (depth === 0 && /\s/.test(character)) {
      flush();
      continue;
    }
    if (depth === 0 && character === '>') {
      flush();
      parts.push('>');
      continue;
    }
    current += character;
  }
  flush();
  return parts;
}

/** Does `selector` match the last element of `path`? Descendant and child combinators only. */
export function matches(selector: string, path: ElementSpec[]): boolean {
  const parts = selectorParts(selector);
  if (parts.length === 0) {
    return false;
  }

  // An `ElementSpec` path models ancestry, not siblings. A sibling-combinator rule whose subject
  // could not match this element is simply skipped; one that could match is an explicit error,
  // because silently ignoring it would hand back a confidently wrong answer.
  if (/[+~]/.test(selector.replace(/\[[^\]]*\]/g, ''))) {
    const subject = parts[parts.length - 1] as string;
    const last = path[path.length - 1];
    if (last && matchesCompound(subject, last)) {
      throw new Error(`sibling combinator could match this element: ${selector}`);
    }
    return false;
  }

  let pathIndex = path.length - 1;
  let partIndex = parts.length - 1;
  const subject = parts[partIndex] as string;
  const last = path[pathIndex];
  if (!last || !matchesCompound(subject, last)) {
    return false;
  }
  partIndex -= 1;
  pathIndex -= 1;

  while (partIndex >= 0) {
    const part = parts[partIndex] as string;
    if (part === '>') {
      const parent = path[pathIndex];
      const compound = parts[partIndex - 1] as string;
      if (!parent || !matchesCompound(compound, parent)) {
        return false;
      }
      partIndex -= 2;
      pathIndex -= 1;
      continue;
    }

    let found = false;
    while (pathIndex >= 0) {
      const candidate = path[pathIndex] as ElementSpec;
      pathIndex -= 1;
      if (matchesCompound(part, candidate)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
    partIndex -= 1;
  }

  return true;
}

export interface DeclarationMatch {
  rule: StyleRule;
  value: string;
}

export function declarationValue(block: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matched = Array.from(block.matchAll(new RegExp(`(?:^|;)\\s*${escaped}\\s*:([^;]+)`, 'gm')));
  const last = matched[matched.length - 1];
  return last?.[1]?.trim();
}

/** The declaration that wins for the last element of `path` — or undefined if none matches. */
export function winningDeclaration(
  rules: StyleRule[],
  path: ElementSpec[],
  property: string,
  viewportWidth: number
): DeclarationMatch | undefined {
  let winner: DeclarationMatch | undefined;
  let winningSpecificity: [number, number, number] = [-1, -1, -1];

  for (const rule of rules) {
    if (!mediaApplies(rule.media, viewportWidth)) {
      continue;
    }
    const value = declarationValue(rule.block, property);
    if (value === undefined) {
      continue;
    }
    if (!matches(rule.selector, path)) {
      continue;
    }
    const ruleSpecificity = specificity(rule.selector);
    const comparison = compareSpecificity(ruleSpecificity, winningSpecificity);
    if (comparison > 0 || (comparison === 0 && winner && rule.order > winner.rule.order)) {
      winner = { rule, value };
      winningSpecificity = ruleSpecificity;
    } else if (!winner) {
      winner = { rule, value };
      winningSpecificity = ruleSpecificity;
    }
  }

  return winner;
}

/**
 * The value an inherited property (`text-align`, `color`) actually computes to on the last element
 * of `path`, walking down from the root so an ancestor's value reaches descendants that never
 * match a rule of their own.
 */
export function inheritedValue(
  rules: StyleRule[],
  path: ElementSpec[],
  property: string,
  viewportWidth: number,
  initial = 'initial'
): string {
  let current = initial;
  for (let depth = 0; depth < path.length; depth += 1) {
    const declared = winningDeclaration(rules, path.slice(0, depth + 1), property, viewportWidth);
    if (declared) {
      current = declared.value === 'inherit' ? current : declared.value;
    }
  }
  return current;
}
