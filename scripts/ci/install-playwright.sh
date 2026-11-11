#!/usr/bin/env bash
#
# Install Playwright browsers for CI without letting an apt outage fail every lane.
#
#   bash scripts/ci/install-playwright.sh [browser...]     # no args = every browser
#
# Why this exists (2026-11-11): from ~14:00 UTC GitHub's runners could not resolve
# security.ubuntu.com. `npx playwright install --with-deps` treats any apt failure as fatal,
# so every Playwright lane died in the install step before running a test — and four of
# those lanes are required checks, so nothing in the repo could merge. The packages that
# failed were optional fonts; the runner image already carries the libraries a browser needs.
#
# So the install is split into what it actually is:
#   1. BROWSERS   — from Playwright's own CDN. Retried; still fatal if they can't be fetched.
#   2. OS PACKAGES — from apt. Retried with backoff; if they still fail, warn and continue.
#   3. LAUNCH CHECK — start each browser once. This is what decides whether step 2's failure
#      mattered: a missing essential library fails HERE, loudly, naming the browser, instead
#      of surfacing as a confusing mid-test crash. A missing font cannot fail it.
#
# ⚠ What step 2 tolerating failure can still change: text rendering. A test that compares
# screenshots could see a font difference on a run where apt failed — that would show up as
# a test failure, never as a silent pass. The ::warning:: below names the run where it happened.
#
# PW_INSTALL_RETRY_DELAY overrides the first backoff in seconds (tests set it to 0).

set -u

browsers=("$@")
if [ ${#browsers[@]} -eq 0 ]; then
  launch=(chromium firefox webkit)
else
  launch=("${browsers[@]}")
fi
delay0="${PW_INSTALL_RETRY_DELAY:-15}"

# retry <attempts> <first-delay-seconds> <command...> — doubles the delay each time.
retry() {
  local max=$1 delay=$2 n=1
  shift 2
  until "$@"; do
    if [ "$n" -ge "$max" ]; then
      return 1
    fi
    echo "::warning::'$*' failed (attempt $n of $max); retrying in ${delay}s"
    sleep "$delay"
    n=$((n + 1))
    delay=$((delay * 2))
  done
}

echo "== 1/3 browsers: ${browsers[*]:-all}"
if ! retry 3 "$delay0" npx playwright install ${browsers[@]+"${browsers[@]}"}; then
  echo "::error::Playwright could not download the browser(s) (${browsers[*]:-all}) after 3 attempts."
  exit 1
fi

echo "== 2/3 OS packages"
if ! retry 3 "$delay0" npx playwright install-deps ${browsers[@]+"${browsers[@]}"}; then
  echo "::warning::Playwright's OS packages could not be installed after 3 attempts (apt mirror or DNS outage). Continuing on the runner image's own libraries; the launch check below decides whether that is enough. Fonts may differ on this run."
fi

echo "== 3/3 launch check: ${launch[*]}"
for b in "${launch[@]}"; do
  if ! node -e "
    const pw = require('@playwright/test');
    const type = pw[process.argv[1]];
    if (!type || typeof type.launch !== 'function') { console.error('unknown browser: ' + process.argv[1]); process.exit(1); }
    type.launch().then((x) => x.close()).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
  " "$b"; then
    echo "::error::$b cannot launch on this runner — a required system library is missing (see the error above). This is the real install failure, not a flaky one."
    exit 1
  fi
  echo "$b launches"
done
