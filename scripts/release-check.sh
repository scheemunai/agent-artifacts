#!/usr/bin/env bash
set -euo pipefail

REF="${1:-HEAD}"
FAILURES=0
WARNINGS=0

say() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }
fail() { say "FAIL: $*"; FAILURES=$((FAILURES + 1)); }
warn() { say "WARN: $*"; WARNINGS=$((WARNINGS + 1)); }
pass() { say "PASS: $*"; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aa-release-check.XXXXXX")"
ARCHIVE_DIR="$TMP_DIR/archive"
AUDIT_JSON="$TMP_DIR/pnpm-audit-prod.json"
AUDIT_ERR="$TMP_DIR/pnpm-audit-prod.stderr"
trap 'rm -rf "$TMP_DIR"' EXIT

section "Release check"
say "Repository: $(basename "$REPO_ROOT")"
say "Ref:        $REF"
say "Archive:    temporary clean tree"

mkdir -p "$ARCHIVE_DIR"
if git -C "$REPO_ROOT" archive --format=tar "$REF" | tar -xf - -C "$ARCHIVE_DIR"; then
  file_count="$(find "$ARCHIVE_DIR" -type f | wc -l | tr -d ' ')"
  pass "git archive created from $REF ($file_count files)."
else
  fail "could not create git archive for ref '$REF'."
fi

section "Archive path guard"
path_failures=()
while IFS= read -r -d '' path; do
  rel="${path#"$ARCHIVE_DIR"/}"
  [ "$rel" = "$path" ] && rel="${path#"$ARCHIVE_DIR"}"
  rel="${rel#./}"
  [ -z "$rel" ] && continue

  case "$rel" in
    .env.example|*/.env.example)
      # Public template is allowed; real env files are not.
      ;;
    .env|.env.*|*/.env|*/.env.*|\
    *.db|*.db-wal|*.db-shm|*.sqlite|*.sqlite3|*.sqlite-wal|*.sqlite-shm|\
    .session-secret|*/.session-secret|.setup-token|*/.setup-token|\
    .scratch|.scratch/*|*/.scratch|*/.scratch/*|\
    data|data/*|*/data|*/data/*|\
    *live-backup*|*.bak|*.backup|*.pre-*|*.tmp|*.old)
      path_failures+=("$rel")
      ;;
  esac
done < <(find "$ARCHIVE_DIR" \( -type f -o -type d \) -print0)

if [ "${#path_failures[@]}" -eq 0 ]; then
  pass "no forbidden env/db/session/scratch/data/backup paths in archive."
else
  fail "forbidden paths found in archive:"
  printf '  - %s\n' "${path_failures[@]}"
fi

section "High-confidence secret pattern scan"
secret_re='(aa_(bot|live|test)_[A-Za-z0-9_-]{32}|sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
secret_hits=()
while IFS= read -r -d '' file; do
  if LC_ALL=C grep -Iq . "$file"; then
    rel="${file#"$ARCHIVE_DIR"/}"
    while IFS= read -r line_no; do
      [ -n "$line_no" ] && secret_hits+=("$rel:$line_no")
    done < <(LC_ALL=C grep -nE "$secret_re" "$file" 2>/dev/null | cut -d: -f1)
  fi
done < <(find "$ARCHIVE_DIR" -type f -print0)

if [ "${#secret_hits[@]}" -eq 0 ]; then
  pass "no high-confidence token/private-key patterns found."
else
  fail "high-confidence secret-like values found; values are intentionally not printed:"
  printf '  - %s\n' "${secret_hits[@]}"
fi

section "Internal hostname/path surfacing"
internal_re='(anacreon\.ai|/opt/projects|/mnt/HC_Volume|/home/webuser|usercontent\.agentartifact)'
internal_hits=()
while IFS= read -r -d '' file; do
  if LC_ALL=C grep -Iq . "$file"; then
    rel="${file#"$ARCHIVE_DIR"/}"
    # This script necessarily contains the patterns it searches for; do not self-report.
    [ "$rel" = "scripts/release-check.sh" ] && continue
    while IFS= read -r line_no; do
      [ -n "$line_no" ] && internal_hits+=("$rel:$line_no")
    done < <(LC_ALL=C grep -nE "$internal_re" "$file" 2>/dev/null | cut -d: -f1)
  fi
done < <(find "$ARCHIVE_DIR" -type f -print0)

if [ "${#internal_hits[@]}" -eq 0 ]; then
  pass "no internal hostname/path references found."
else
  warn "internal hostname/path references found; review before public release (values not printed):"
  printf '  - %s\n' "${internal_hits[@]}"
fi

section "pnpm audit --prod"
AUDIT_STATUS=0
(
  cd "$ARCHIVE_DIR"
  pnpm audit --prod --json > "$AUDIT_JSON" 2> "$AUDIT_ERR"
) || AUDIT_STATUS=$?

AUDIT_SUMMARY="$(node - "$AUDIT_JSON" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`could not parse pnpm audit JSON: ${error.message}`);
  process.exit(3);
}
const v = data.metadata?.vulnerabilities ?? {};
const counts = {
  critical: Number(v.critical ?? 0),
  high: Number(v.high ?? 0),
  moderate: Number(v.moderate ?? 0),
  low: Number(v.low ?? 0),
  info: Number(v.info ?? 0),
};
console.log(`critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} low=${counts.low} info=${counts.info}`);
if (counts.critical + counts.high > 0) {
  process.exit(2);
}
NODE
)" || AUDIT_PARSE_STATUS=$?
AUDIT_PARSE_STATUS="${AUDIT_PARSE_STATUS:-0}"

if [ "$AUDIT_PARSE_STATUS" -eq 0 ]; then
  pass "pnpm audit --prod has no high/critical vulnerabilities ($AUDIT_SUMMARY)."
  if [ "$AUDIT_STATUS" -ne 0 ]; then
    warn "pnpm audit exited $AUDIT_STATUS but high/critical count is zero; inspect lower-severity advisories if present."
  fi
else
  fail "pnpm audit --prod failed high/critical gate or could not be parsed (${AUDIT_SUMMARY:-no summary})."
  if [ -s "$AUDIT_ERR" ]; then
    say "pnpm audit stderr (first 20 lines):"
    sed -n '1,20p' "$AUDIT_ERR"
  fi
fi

section "Summary"
if [ "$FAILURES" -eq 0 ]; then
  say "RESULT: PASS ($WARNINGS warning(s))."
  exit 0
else
  say "RESULT: FAIL ($FAILURES failure group(s), $WARNINGS warning(s))."
  exit 1
fi
