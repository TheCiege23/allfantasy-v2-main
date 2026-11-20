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
#   2. LINKED LIBRARIES — the few apt packages the browser binaries cannot START without, asked of
#      Playwright itself (scripts/ci/playwright-linked-packages.cjs) and installed FIRST.
#   3. OS PACKAGES — Playwright's full list from apt (fonts, media codecs). Two attempts, each capped
#      at 5 minutes with apt told to fail fast; if they still fail, warn and continue.
#   4. LAUNCH CHECK — start each browser once. This is what decides whether step 3's failure
#      mattered: a missing essential library fails HERE, loudly, naming the browser, instead
#      of surfacing as a confusing mid-test crash. A missing font cannot fail it.
#
# 🛑 WHY STEP 2 EXISTS (2026-11-20, mobile-smoke job 136336052767). On ubuntu-26.04 WebKit's full list
# is 185 packages / 140 MB, mostly fonts and a gstreamer + ffmpeg codec stack. The one library WebKit
# could not start without — libevent-2.1.so.7, a 146 kB package — sat ~114th in that queue. On a mirror
# serving ~57 KB/s, 25 minutes of apt reached package 103, and WebKit failed step 4. Twenty minutes
# earlier, on the SAME image (ubuntu-26.04 20261111.196.1), the same 140 MB took ten seconds. Nothing
# about the image or the list had changed; only its ORDER mattered. Pinning the runner would not
# have helped, and step 3's caps cannot help either: they bound time, not which packages arrive.
#
# ⚠ What step 2 tolerating failure can still change: text rendering. A test that compares
# screenshots could see a font difference on a run where apt failed — that would show up as
# a test failure, never as a silent pass. The ::warning:: below names the run where it happened.
#
# PW_INSTALL_RETRY_DELAY overrides the first backoff in seconds (tests set it to 0).
# PW_DEPS_ATTEMPT_TIMEOUT overrides the per-attempt cap on the apt phase (default 300s).
# PW_APT_WAIT_BUDGET caps the total time spent waiting for a timed-out attempt's apt (default 1200s);
# PW_APT_STALL_SECONDS gives up sooner when that apt has made no progress for this long (default 180s);
# PW_APT_PROGRESS_PATHS is what "progress" is measured on (default apt's download cache and dpkg's log);
# PW_APT_WAIT_POLL is that wait's poll interval (default 5s; tests set it to 1).
# PW_LINKED_DEPS_TIMEOUT caps how long step 2 is waited for (default 900s).
# PW_APT_OPTIONAL_WAIT_BUDGET, when SET, replaces PW_APT_WAIT_BUDGET once every browser already launches after step 2,
# because what step 3 adds is then only fonts and codecs. Opt-in per lane: a lane that compares screenshots
# (e2e/draft-room-visual.spec.ts) wants the fonts, so it keeps the full wait by leaving this unset.

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
# 🛑 A FIXED 6-MINUTE WAIT WAS TOO SHORT FOR A SLOW MIRROR (2026-11-18, PR #3857). One 13.5 MB package took 3.5
# minutes; the leftover apt was still downloading — package 72 of 186 — when the wait gave up, the retry died on the
# lock, and WebKit failed its launch check while the packages it needed were still arriving. So the wait now follows
# PROGRESS: it continues while apt's download cache or dpkg's log is still growing, gives up after
# PW_APT_STALL_SECONDS without either changing, and never runs past one overall budget shared by every wait — so a
# hung apt still cannot run mobile-smoke (45-minute job) into its timeout.
apt_wait_left="${PW_APT_WAIT_BUDGET:-1200}"
apt_stall_limit="${PW_APT_STALL_SECONDS:-180}"
apt_wait_poll="${PW_APT_WAIT_POLL:-5}"
apt_progress_paths="${PW_APT_PROGRESS_PATHS:-/var/cache/apt/archives /var/log/dpkg.log}"
apt_busy() {
  command -v pgrep >/dev/null 2>&1 || return 1
  pgrep -x apt-get >/dev/null 2>&1 || pgrep -x apt >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1
}
# Bytes under the progress paths. apt's partial-download directory is root-only, so this reads through sudo when it
# can; a path that cannot be read counts 0 rather than failing the wait.
apt_progress_mark() {
  local reader=()
  # Only through sudo when it works without a prompt; otherwise read what this user can.
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then reader=(sudo -n); fi
  # shellcheck disable=SC2086 # the paths are a space-separated list on purpose
  "${reader[@]}" du -sb $apt_progress_paths 2>/dev/null | awk '{ s += $1 } END { print s + 0 }'
}
wait_for_apt() {
  apt_busy || return 0
  echo "== waiting for the previous attempt's apt to finish (up to ${apt_wait_left}s left; gives up after ${apt_stall_limit}s with no progress)"
  local last stalled=0 now
  last="$(apt_progress_mark)"
  while apt_busy; do
    if [ "$apt_wait_left" -le 0 ]; then
      echo "::warning::apt from a timed-out attempt is still running; the wait budget is spent."
      return 1
    fi
    if [ "$stalled" -ge "$apt_stall_limit" ]; then
      echo "::warning::apt from a timed-out attempt is still running but has made no progress for ${stalled}s; giving up on it."
      return 1
    fi
    sleep "$apt_wait_poll"
    apt_wait_left=$((apt_wait_left - apt_wait_poll))
    now="$(apt_progress_mark)"
    if [ "$now" != "$last" ]; then
      stalled=0
      last="$now"
    else
      stalled=$((stalled + apt_wait_poll))
    fi
  done
  echo "== the previous attempt's apt finished"
}

echo "== 1/4 browsers: ${browsers[*]:-all}"
if ! retry 3 "$delay0" npx playwright install ${browsers[@]+"${browsers[@]}"}; then
  echo "::error::Playwright could not download the browser(s) (${browsers[*]:-all}) after 3 attempts."
  exit 1
fi

# launch_ok <browser> — start the browser once and close it. Prints Playwright's error on failure.
launch_ok() {
  node -e "
    const pw = require('@playwright/test');
    const type = pw[process.argv[1]];
    if (!type || typeof type.launch !== 'function') { console.error('unknown browser: ' + process.argv[1]); process.exit(1); }
    type.launch().then((x) => x.close()).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
  " "$1"
}

# run_bounded <seconds> <command...> — run the command in the background and WAIT for it at most <seconds>.
# Returns its status, or 124 while it is still running. It is never signalled: for the same reason wait_for_apt
# never kills apt, an apt stopped mid-dpkg can leave packages half-configured. What it leaves running, wait_for_apt
# deals with before the next apt call.
run_bounded() {
  local cap=$1 waited=0 status_file rc
  shift
  status_file="${TMPDIR:-/tmp}/af-pw-bounded-$$-$RANDOM"
  rm -f "$status_file"
  ( "$@"; echo "$?" >"$status_file" ) &
  while [ ! -s "$status_file" ]; do
    if [ "$waited" -ge "$cap" ]; then
      return 124
    fi
    sleep "$apt_wait_poll"
    waited=$((waited + apt_wait_poll))
  done
  wait 2>/dev/null
  rc="$(cat "$status_file")"
  rm -f "$status_file"
  return "${rc:-1}"
}

# ⚠ BOUND THE APT PHASES. During the 2026-11-11 outage one apt attempt spent ~5 minutes on its
# own internal retries per package, so three attempts ran mobile-smoke (45-min limit, WebKit's
# long package list) into its job timeout. apt is told to fail fast, and each attempt is capped,
# so the whole phase stays under ~11 minutes even when every mirror is unreachable.
if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1; then
  printf '%s\n' 'Acquire::Retries "0";' 'Acquire::http::Timeout "20";' 'Acquire::https::Timeout "20";' \
    | sudo tee /etc/apt/apt.conf.d/99af-ci-fail-fast >/dev/null || true
fi

echo "== 2/4 linked libraries: ${launch[*]}"
# Install what the browser binaries link against BEFORE the 140 MB full list, so a slow mirror delays fonts and
# codecs rather than whether a browser starts. The helper exits non-zero when it cannot tell; that is "carry on with
# step 3 as before", never "nothing is missing". It can only change ORDER: step 4 still decides.
linked_install() {
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq &&
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}
linked_ready=0
if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if linked_out="$(node "$script_dir/playwright-linked-packages.cjs" "${launch[@]}")"; then
    read -r -d '' -a linked_pkgs <<<"$linked_out" || true
    if [ ${#linked_pkgs[@]} -eq 0 ]; then
      echo "every library the browsers link against is already on this runner"
      linked_ready=1
    else
      linked_cap="${PW_LINKED_DEPS_TIMEOUT:-900}"
      echo "installing first (${#linked_pkgs[@]}): ${linked_pkgs[*]}"
      run_bounded "$linked_cap" linked_install "${linked_pkgs[@]}"
      linked_rc=$?
      if [ "$linked_rc" -eq 0 ]; then
        echo "linked libraries installed"
        linked_ready=1
      elif [ "$linked_rc" -eq 124 ]; then
        echo "::warning::the linked-library install is still running after ${linked_cap}s; step 3 waits for it."
      else
        echo "::warning::the linked-library install failed (exit $linked_rc); step 3 installs the full list anyway."
      fi
    fi
  else
    echo "::notice::could not determine the browsers' linked libraries (see above); step 3 installs the full list."
  fi
fi
# Every browser already starts, so what step 3 adds is optional: a lane that opts in does not let a slow mirror spend
# 20 minutes of a 45-minute job waiting on fonts. Its apt is still left to finish in the background, never killed.
if [ "$linked_ready" -eq 1 ] && [ -n "${PW_APT_OPTIONAL_WAIT_BUDGET:-}" ]; then
  all_launch=1
  for b in "${launch[@]}"; do
    launch_ok "$b" >/dev/null 2>&1 || { all_launch=0; break; }
  done
  if [ "$all_launch" -eq 1 ]; then
    echo "every browser already launches; step 3 is fonts and codecs, so its apt wait is capped at ${PW_APT_OPTIONAL_WAIT_BUDGET}s"
    apt_wait_left="$PW_APT_OPTIONAL_WAIT_BUDGET"
  fi
fi
# Anything step 2 left running holds the dpkg lock that step 3 needs.
wait_for_apt || true

echo "== 3/4 OS packages"
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
  # A retry while that apt still holds the lock can only fail on it ("Could not get lock"): skip it and let the
  # launch check below say whether what did get installed is enough.
  if apt_busy; then
    echo "::warning::skipping the retry: apt from the timed-out attempt still holds the dpkg lock."
    break
  fi
  if [ "$attempt" -lt 2 ]; then
    echo "::warning::'${deps_cmd[*]}' failed (attempt $attempt of 2); retrying in ${deps_delay}s"
    sleep "$deps_delay"
  fi
done
if [ "$deps_ok" -ne 1 ]; then
  echo "::warning::Playwright's OS packages could not be installed after 2 attempts of up to ${deps_cap}s (apt mirror or DNS outage). Continuing on the runner image's own libraries; the launch check below decides whether that is enough. Fonts may differ on this run."
fi

echo "== 4/4 launch check: ${launch[*]}"
for b in "${launch[@]}"; do
  if ! launch_ok "$b"; then
    echo "::error::$b cannot launch on this runner — a required system library is missing (see the error above). This is the real install failure, not a flaky one."
    exit 1
  fi
  echo "$b launches"
done
