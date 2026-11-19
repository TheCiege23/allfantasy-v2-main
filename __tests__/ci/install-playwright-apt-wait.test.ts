// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `scripts/ci/install-playwright.sh` — a timed-out apt attempt must not fail the retry on its own lock.
 *
 * Reproduces the 2026-11-18 mobile-smoke failure (PR #3853, twice): `timeout` stopped `npx`, the apt it had started
 * kept running and kept the dpkg lock, attempt 2 died on "Could not get lock", and WebKit could not launch.
 *
 * Every external command is a stub on PATH, driven by files in a state dir:
 *   npx install-deps — attempt 1 "times out" and leaves a background "apt" that holds the lock for `APT_SECONDS`,
 *                      then marks the packages installed; any attempt made while it runs fails on the lock.
 *                      With APT_PROGRESS=1 it appends to a progress file every second, as a real download grows
 *                      apt's cache; without it, it makes no progress at all (a hung mirror).
 *   pgrep            — true while that background apt is alive.
 *   node -e          — the launch check: succeeds only once the packages are installed.
 */
const SCRIPT = join(process.cwd(), 'scripts/ci/install-playwright.sh')
let dir = ''

function stub(bin: string, name: string, body: string) {
  const p = join(bin, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

function run(env: Record<string, string>) {
  dir = mkdtempSync(join(tmpdir(), 'pw-install-'))
  const bin = join(dir, 'bin')
  const state = join(dir, 'state')
  mkdirSync(bin)
  mkdirSync(state)
  stub(bin, 'timeout', 'shift 2; exec "$@"') // drop `--kill-after=15 <cap>`
  stub(bin, 'sudo', '[ "$1" = tee ] && { cat >/dev/null; exit 0; }; exec "$@"')
  stub(bin, 'pgrep', `[ -f "${state}/apt.pid" ] && kill -0 "$(cat "${state}/apt.pid")" 2>/dev/null`)
  stub(
    bin,
    'npx',
    `case "$*" in
  *install-deps*)
    n=$(cat "${state}/deps_calls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "${state}/deps_calls"
    if [ -f "${state}/apt.pid" ] && kill -0 "$(cat "${state}/apt.pid")" 2>/dev/null; then
      echo "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process $(cat "${state}/apt.pid") (apt-get)" >&2
      exit 100
    fi
    if [ "$n" -eq 1 ]; then
      # Detached from the script's stdout/stderr, as a real apt-get under sudo is: otherwise the harness waits on the pipe.
      ( i=0; while [ "$i" -lt "\${APT_SECONDS}" ]; do sleep 1; [ "\${APT_PROGRESS:-0}" = 1 ] && echo x >> "${state}/progress"; i=$((i + 1)); done
        touch "${state}/installed"; rm -f "${state}/apt.pid" ) >/dev/null 2>&1 &
      echo $! > "${state}/apt.pid"
      exit 124
    fi
    touch "${state}/installed"; exit 0 ;;
  *) exit 0 ;;
esac`,
  )
  stub(bin, 'node', `[ -f "${state}/installed" ]`)
  const started = Date.now()
  const r = spawnSync('bash', [SCRIPT, 'webkit'], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PW_INSTALL_RETRY_DELAY: '0',
      PW_APT_WAIT_POLL: '1',
      PW_APT_PROGRESS_PATHS: join(state, 'progress'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  })
  const calls = existsSync(join(state, 'deps_calls')) ? Number(readFileSync(join(state, 'deps_calls'), 'utf8')) : 0
  return { status: r.status, out: `${r.stdout}${r.stderr}`, ms: Date.now() - started, calls }
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('install-playwright.sh — the apt phase', () => {
  it('🛑 waits for a timed-out attempt\'s apt instead of failing the retry on its lock, and WebKit launches', () => {
    const r = run({ APT_SECONDS: '2' })
    expect(r.out).toMatch(/waiting for the previous attempt's apt to finish/)
    expect(r.out).not.toMatch(/Could not get lock/)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
    expect(r.calls).toBe(2)
  }, 30_000)

  it('the wait is bounded: an apt still busy when the budget is spent ends the wait, and the run still ends', () => {
    const r = run({ APT_SECONDS: '20', APT_PROGRESS: '1', PW_APT_WAIT_BUDGET: '2' })
    expect(r.out).toMatch(/wait budget is spent/)
    expect(r.ms).toBeLessThan(12_000)
    // Honest failure: the packages really are missing, and the launch check says so.
    expect(r.out).toMatch(/webkit cannot launch/)
    expect(r.status).toBe(1)
  }, 30_000)

  /*
   * 🛑 THE 2026-11-18 CASE ON PR #3857: a mirror so slow the leftover apt was still downloading when a fixed 6-minute
   * wait gave up. The wait now follows progress, so an apt that outlasts the stall window — but keeps downloading — is
   * still waited for. (The stall window stands in for the old fixed cap: 2s here against an apt that runs for 5.)
   */
  it('🛑 a slow apt that keeps making progress is waited for past the stall window, and WebKit launches', () => {
    const r = run({ APT_SECONDS: '5', APT_PROGRESS: '1', PW_APT_STALL_SECONDS: '2' })
    expect(r.out).toMatch(/the previous attempt's apt finished/)
    expect(r.out).not.toMatch(/has made no progress/)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
  }, 30_000)

  it('an apt that has stopped making progress is given up on after the stall window, not the whole budget', () => {
    const r = run({ APT_SECONDS: '20', PW_APT_STALL_SECONDS: '2', PW_APT_WAIT_BUDGET: '600' })
    expect(r.out).toMatch(/made no progress for \d+s; giving up on it/)
    expect(r.ms).toBeLessThan(12_000)
    expect(r.status).toBe(1)
  }, 30_000)

  it('🛑 never retries into a lock it knows is held: the retry is skipped, not run to fail on "Could not get lock"', () => {
    const r = run({ APT_SECONDS: '20', PW_APT_STALL_SECONDS: '2' })
    expect(r.out).toMatch(/skipping the retry: apt from the timed-out attempt still holds the dpkg lock/)
    expect(r.out).not.toMatch(/Could not get lock/)
    expect(r.calls).toBe(1)
  }, 30_000)

  it('an apt that has already finished costs nothing: the retry just runs', () => {
    const r = run({ APT_SECONDS: '0' })
    // Attempt 1 "times out" in the stub, but its apt is (all but) gone at once, so the retry succeeds.
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/webkit launches/)
  }, 30_000)
})
