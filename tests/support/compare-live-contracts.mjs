#!/usr/bin/env node

const [leftInput, rightInput] = process.argv.slice(2);

if (!leftInput || !rightInput) {
  console.error(
    'Usage: node tests/support/compare-live-contracts.mjs <left-base-url> <right-base-url>'
  );
  process.exit(2);
}

const leftOrigin = normalizeOrigin(leftInput);
const rightOrigin = normalizeOrigin(rightInput);
const origins = [leftOrigin, rightOrigin];

const [left, right] = await Promise.all([
  fetchContract(leftOrigin, 'left'),
  fetchContract(rightOrigin, 'right'),
]);

const normalizedLeft = normalizeContract(left, origins);
const normalizedRight = normalizeContract(right, origins);

if (normalizedLeft === normalizedRight) {
  console.log('contracts match after normalizing base URLs');
  process.exit(0);
}

console.error(unifiedDiff(normalizedLeft, normalizedRight, 'left', 'right'));
process.exit(1);

function normalizeOrigin(input) {
  const url = new URL(input);
  if (url.pathname.endsWith('/v1/contract')) {
    return `${url.origin}${url.pathname.slice(0, -'/v1/contract'.length)}`.replace(/\/$/, '');
  }
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

async function fetchContract(origin, label) {
  const response = await fetch(`${origin}/v1/contract`);
  if (!response.ok) {
    throw new Error(`${label} contract returned HTTP ${response.status}`);
  }
  return response.text();
}

function normalizeContract(text, baseOrigins) {
  let normalized = text;
  for (const origin of baseOrigins) {
    normalized = normalized.split(origin).join('https://<BASE>');
  }
  return normalized;
}

function unifiedDiff(left, right, leftLabel, rightLabel) {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const max = Math.max(leftLines.length, rightLines.length);
  const lines = [`--- ${leftLabel}`, `+++ ${rightLabel}`];

  for (let index = 0; index < max; index += 1) {
    const leftLine = leftLines[index];
    const rightLine = rightLines[index];
    if (leftLine === rightLine) {
      continue;
    }
    lines.push(`@@ line ${index + 1} @@`);
    if (leftLine !== undefined) {
      lines.push(`- ${leftLine}`);
    }
    if (rightLine !== undefined) {
      lines.push(`+ ${rightLine}`);
    }
  }

  return lines.join('\n');
}
