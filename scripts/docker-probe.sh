#!/usr/bin/env bash
#
# Black-box probe of the released container.
#
# Every other gate in this repository (pnpm check, vitest, playwright, release-check) runs from a
# source checkout with the repository root as the working directory. The image is a different
# machine: it ships dist/, public/, drizzle/ and templates/, and never src/. Defects that live in
# that gap are invisible to all four gates — which is how a release shipped where every single
# /a/:id/og.png answered 500 because the Open Graph fonts existed only under src/.
#
# So this probe boots the actual image and drives the actual product: setup wizard, one-time bot
# key, publish with a share, then fetch the page, its stylesheet, its fonts, and its OG card.
#
# Usage:
#   scripts/docker-probe.sh                  # builds docker/Dockerfile from the repo root
#   scripts/docker-probe.sh <image-tag>      # probes an image that is already built
#
set -euo pipefail

IMAGE="${1:-}"
FAILURES=0
CONTAINER=""
VOLUME=""

say() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }
pass() { say "PASS: $*"; }
fail() { say "FAIL: $*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
  [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [ -n "$VOLUME" ] && docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

REPO_ROOT="$(git rev-parse --show-toplevel)"
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
BASE="http://127.0.0.1:${PORT}"

section "Docker clean-room probe"
if [ -z "$IMAGE" ]; then
  IMAGE="agent-artifacts:probe-$$"
  say "Building $IMAGE from docker/Dockerfile ..."
  docker build -q -f "$REPO_ROOT/docker/Dockerfile" -t "$IMAGE" "$REPO_ROOT" >/dev/null
fi
say "Image: $IMAGE"
say "Base:  $BASE"

CONTAINER="aa-probe-$$"
VOLUME="aa-probe-data-$$"
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$CONTAINER" -v "$VOLUME:/data" \
  -e "BASE_URL=$BASE" -e AA_RATE_LIMITS_DISABLED=true \
  -p "127.0.0.1:${PORT}:3000" "$IMAGE" >/dev/null

section "Boot"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -eq 1 ]; then
  pass "container answers /healthz."
else
  fail "container never answered /healthz."
  docker logs "$CONTAINER" 2>&1 | tail -30
  say "RESULT: FAIL"
  exit 1
fi

probe_status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
probe_type() { curl -s -o /dev/null -w '%{content_type}' "$1"; }

section "Static surfaces"
page="$(curl -fsS "$BASE/style-guide")"
stylesheet="$(printf '%s' "$page" | grep -o '<link rel="stylesheet" href="[^"]*"' | head -1 | sed -E 's/.*href="([^"]*)".*/\1/')"
if [ -n "$stylesheet" ]; then
  pass "page links a stylesheet ($stylesheet)."
else
  fail "page rendered no stylesheet link."
fi

for path in "$stylesheet" "/assets/fonts/source-sans-3-latin-var.woff2"; do
  [ -z "$path" ] && continue
  status="$(probe_status "$BASE$path")"
  if [ "$status" = "200" ]; then pass "$path → 200."; else fail "$path → $status."; fi
done

section "Onboarding"
setup_token="$(docker logs "$CONTAINER" 2>&1 | grep -o 'Setup token: [A-Za-z0-9_-]*' | head -1 | awk '{print $3}')"
if [ -z "$setup_token" ]; then
  fail "no setup token in the container log."
  say "RESULT: FAIL"
  exit 1
fi
pass "setup token found in the boot log."

headers="$(mktemp)"
curl -s -o /dev/null -D "$headers" -X POST "$BASE/setup" \
  --data-urlencode "setup_token=$setup_token" \
  --data-urlencode 'email=probe@example.test' \
  --data-urlencode 'password=probe-password-1' \
  --data-urlencode 'password_confirm=probe-password-1' \
  --data-urlencode 'bot_name=Probe Bot'
cookie="$(grep -i '^set-cookie:' "$headers" | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]*).*/\1/' | tr -d '\r')"
location="$(grep -i '^location:' "$headers" | head -1 | awk '{print $2}' | tr -d '\r')"
rm -f "$headers"

api_key="$(curl -fsS -H "Cookie: $cookie" "$BASE$location" | grep -o 'aa_bot_[A-Za-z0-9_-]*' | head -1)"
if [ -n "$api_key" ]; then
  pass "setup revealed a one-time bot key."
else
  fail "setup did not reveal a bot key."
  say "RESULT: FAIL"
  exit 1
fi

share_url="$(curl -fsS -X POST "$BASE/v1/artifacts" \
  -H "Authorization: Bearer $api_key" -H 'Content-Type: application/json' \
  -d '{"slug":"docker-probe","type":"markdown","title":"Docker probe","content":"# Docker probe","share":true}' \
  | grep -o '"url":"[^"]*"' | head -1 | sed -E 's/"url":"([^"]*)"/\1/')"
share_id="${share_url##*/}"
if [ -n "$share_id" ]; then
  pass "published an artifact with a share ($share_id)."
else
  fail "publishing with share:true returned no share url."
  say "RESULT: FAIL"
  exit 1
fi

section "Public surfaces"
for path in "/a/$share_id" "/a/$share_id/content"; do
  status="$(probe_status "$BASE$path")"
  if [ "$status" = "200" ]; then pass "$path → 200."; else fail "$path → $status."; fi
done

# The probe this script exists for. An image whose OG fonts did not ship answers 500 here while
# every source-checkout gate stays green.
og_file="$(mktemp)"
og_status="$(curl -s -o "$og_file" -w '%{http_code}' "$BASE/a/$share_id/og.png")"
og_type="$(probe_type "$BASE/a/$share_id/og.png")"
og_size="$(wc -c < "$og_file" | tr -d ' ')"
og_magic="$(head -c 8 "$og_file" | od -An -tx1 | tr -d ' \n')"
rm -f "$og_file"

if [ "$og_status" = "200" ] && [ "$og_magic" = "89504e470d0a1a0a" ] && [ "$og_size" -gt 1000 ]; then
  pass "og.png → 200, real PNG, $og_size bytes."
else
  fail "og.png → status=$og_status type=$og_type size=$og_size magic=$og_magic (expected a PNG)."
  docker logs "$CONTAINER" 2>&1 | grep -i 'og\|font' | tail -10
fi

section "Runtime asset errors in the log"
if docker logs "$CONTAINER" 2>&1 | grep -q 'MISSING RUNTIME ASSET\|STYLESHEET'; then
  fail "the container logged a missing runtime asset:"
  docker logs "$CONTAINER" 2>&1 | grep -A4 'MISSING RUNTIME ASSET\|STYLESHEET' | tail -20
else
  pass "no missing-runtime-asset diagnostics in the log."
fi

section "Summary"
if [ "$FAILURES" -eq 0 ]; then
  say "RESULT: PASS"
  exit 0
fi
say "RESULT: FAIL ($FAILURES failure(s))."
exit 1
