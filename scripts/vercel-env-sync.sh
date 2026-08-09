#!/usr/bin/env bash
#
# Push the payment + operator-identity environment variables from `.env` up to
# Vercel.
#
# Values are read out of `.env` rather than typed on the command line, so no
# secret ever reaches your shell history or the process table. The script itself
# holds no secrets and is safe to commit — `.env` is gitignored.
#
# Each variable is removed and then re-added, because `vercel env add` refuses to
# overwrite an existing value. That makes the script safe to re-run, which is the
# point: you run it again on the day Grow approves the account, when GROW_ENV
# becomes `production` and the sandbox keys are swapped for live ones.
#
#   npm run vercel:env              push
#   npm run vercel:env -- --dry-run show what would be pushed, change nothing
#
# Environment variables are baked at BUILD time, so a redeploy is required
# afterwards for any of this to take effect.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

VERCEL="npx --yes vercel@latest"

# Set on production AND preview: harmless in both, and it lets a preview
# deployment exercise the sandbox checkout end to end.
BOTH=(
  GROW_USER_ID
  GROW_PAGE_CODE
  GROW_CALLBACK_SECRET
  GROW_ENV
  LEGAL_OPERATOR_TAX_ID
  LEGAL_CONTACT_PHONE
  LEGAL_OPERATOR_ADDRESS
)

# Production ONLY. A preview deployment lives on its own *.vercel.app URL, and
# pinning this to the production domain there would make a preview checkout hand
# the gateway a callback URL pointing at production. Left unset on preview,
# `appBaseUrl()` falls back to Vercel's own per-deployment URL — which is exactly
# what a preview should use.
PROD_ONLY=(
  NEXT_PUBLIC_APP_URL
)

# Read one value from .env, stripping surrounding quotes.
#
# Python rather than `source .env`: these values contain spaces and commas, and
# sourcing splits on the first space — the bug that once made the operator
# address read back as null while looking perfectly fine in the file.
read_env() {
  python3 - "$1" <<'PY'
import re, sys, pathlib
key = sys.argv[1]
for line in pathlib.Path(".env").read_text().splitlines():
    m = re.match(rf'^{re.escape(key)}=(.*)$', line)
    if m:
        v = m.group(1).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        sys.stdout.write(v)
        break
PY
}

# Never print a secret in full — enough to recognise it, not enough to leak it.
mask() {
  local v="$1"
  if [ ${#v} -le 10 ]; then printf '%s' "$v"; else printf '%s…%s' "${v:0:6}" "${v: -4}"; fi
}

push() {
  local key="$1" env="$2" value
  value="$(read_env "$key")"
  if [ -z "$value" ]; then
    printf '  ! %-24s MISSING in .env — skipped\n' "$key"
    return
  fi
  printf '  · %-24s %-10s %s\n' "$key" "$env" "$(mask "$value")"
  [ "$DRY" = "1" ] && return
  $VERCEL env rm "$key" "$env" --yes >/dev/null 2>&1
  printf '%s' "$value" | $VERCEL env add "$key" "$env" >/dev/null 2>&1 \
    && printf '    ✓ set\n' \
    || printf '    ✗ FAILED — run manually: vercel env add %s %s\n' "$key" "$env"
}

echo "▸ Vercel account:"
$VERCEL whoami 2>&1 | tail -1 || { echo "  not logged in — run: npx vercel login"; exit 1; }
echo

[ "$DRY" = "1" ] && echo "▸ DRY RUN — nothing will be changed" && echo

for key in "${BOTH[@]}"; do
  push "$key" production
  push "$key" preview
done
for key in "${PROD_ONLY[@]}"; do
  push "$key" production
done

echo
echo "Environment variables are baked at BUILD time."
echo "Push a commit (or run \`npx vercel --prod\`) for these to take effect."
