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
#   2. OS PACKAGES — from apt. Two attempts, each capped at 5 minutes with apt told to fail
#      fast; if they still fail, warn and continue.
#   3. LAUNCH CHECK — start each browser once. This is what decides whether step 2's failure
#      mattered: a missing essential library fails HERE, loudly, naming the browser, instead
#      of surfacing as a confusing mid-test crash. A missing font cannot fail it.
#
# ⚠ What step 2 tolerating failure can still change: text rendering. A test that compares
# screenshots could see a font difference on a run where apt failed — that would show up as
# a test failure, never as a silent pass. The ::warning:: below names the run where it happened.
#
# PW_INSTALL_RETRY_DELAY overrides the first backoff in seconds (tests set it to 0).
# PW_DEPS_ATTEMPT_TIMEOUT overrides the per-attempt cap on the apt phase (default 300s).
# PW_APT_WAIT_BUDGET caps the total time spent waiting for a timed-out attempt's apt (default 360s);
# PW_APT_WAIT_POLL is that wait's poll interval (default 5s; tests set it to 1).

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

# wait_for_apt — let a timed-out attempt's apt finish instead of failing the next step on its lock.
#
# 🛑 `timeout` SIGNALS `npx`, NOT THE `sudo apt-get` PLAYWRIGHT STARTED UNDER IT (2026-11-18). On a slow
# mirror attempt 1 hit the cap mid-download; its apt-get kept running — and kept the dpkg lock — so attempt 2
# died at once on "Could not get lock /var/lib/dpkg/lock-frontend … held by process N (apt-get)", and
# mobile-smoke went red with WebKit's libraries missing (twice in a row on PR #3853, jobs 134461192455 and
# its re-run). That leftover apt was still making progress, so it is WAITED FOR, never killed: killing dpkg
# mid-install can leave packages half-configured, which is worse than the slow mirror.
#
# Bounded by one budget shared across every wait, so a hung apt cannot run the job into its timeout.
apt_wait_left="${PW_APT_WAIT_BUDGET:-360}"
apt_wait_poll="${PW_APT_WAIT_POLL:-5}"
apt_busy() {
  command -v pgrep >/dev/null 2>&1 || return 1
  pgrep -x apt-get >/dev/null 2>&1 || pgrep -x apt >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1
}
wait_for_apt() {
  apt_busy || return 0
  echo "== waiting for the previous attempt's apt to finish (up to ${apt_wait_left}s left)"
  while apt_busy; do
    if [ "$apt_wait_left" -le 0 ]; then
      echo "::warning::apt from a timed-out attempt is still running; the wait budget is spent."
      return 1
    fi
    sleep "$apt_wait_poll"
    apt_wait_left=$((apt_wait_left - apt_wait_poll))
  done
  echo "== the previous attempt's apt finished"
}

echo "== 1/3 browsers: ${browsers[*]:-all}"
if ! retry 3 "$delay0" npx playwright install ${browsers[@]+"${browsers[@]}"}; then
  echo "::error::Playwright could not download the browser(s) (${browsers[*]:-all}) after 3 attempts."
  exit 1
fi

echo "== 2/3 OS packages"
# ⚠ BOUND THE APT PHASE. During the 2026-11-11 outage one apt attempt spent ~5 minutes on its
# own internal retries per package, so three attempts ran mobile-smoke (45-min limit, WebKit's
# long package list) into its job timeout. apt is told to fail fast, and each attempt is capped,
# so the whole phase stays under ~11 minutes even when every mirror is unreachable.
if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1; then
  printf '%s\n' 'Acquire::Retries "0";' 'Acquire::http::Timeout "20";' 'Acquire::https::Timeout "20";' \
    | sudo tee /etc/apt/apt.conf.d/99af-ci-fail-fast >/dev/null || true
fi
deps_cap="${PW_DEPS_ATTEMPT_TIMEOUT:-300}"
if command -v timeout >/dev/null 2>&1; then
  deps_cmd=(timeout --kill-after=15 "$deps_cap" npx playwright install-deps)
else
  deps_cmd=(npx playwright install-deps)
fi
deps_ok=0
deps_delay="$delay0"
for attempt in 1 2; do
  if "${deps_cmd[@]}" ${browsers[@]+"${browsers[@]}"}; then
    deps_ok=1
    break
  fi
  # Whatever the attempt left running finishes first: the retry would otherwise fail on its lock, and the
  # packages it was installing are exactly the ones this phase wants.
  wait_for_apt || true
  if [ "$attempt" -lt 2 ]; then
    echo "::warning::'${deps_cmd[*]}' failed (attempt $attempt of 2); retrying in ${deps_delay}s"
    sleep "$deps_delay"
  fi
done
if [ "$deps_ok" -ne 1 ]; then
  echo "::warning::Playwright's OS packages could not be installed after 2 attempts of up to ${deps_cap}s (apt mirror or DNS outage). Continuing on the runner image's own libraries; the launch check below decides whether that is enough. Fonts may differ on this run."
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
