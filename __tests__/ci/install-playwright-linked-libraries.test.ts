// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `scripts/ci/install-playwright.sh` step 2 — install what the browser binaries LINK against before the full list.
 *
 * Reproduces the 2026-11-20 mobile-smoke failure (job 136336052767): on a ~57 KB/s mirror, `install-deps webkit`
 * (185 packages, 140 MB) spent 25 minutes and never reached libevent-2.1-7t64, so WebKit could not start. The same
 * image passed twenty minutes earlier when the mirror was fast. The fix is order, not a different list.
 *
 * Every external command is a stub on PATH, driven by files in a state dir:
 *   node <helper>    — playwright-linked-packages.cjs: LINKED_MODE=missing prints the packages, =none prints nothing,
 *                      =unknown exits 2 (it could not tell).
 *   apt-get          — `install` sleeps LINKED_SECONDS holding the "lock" (state/apt.pid), then exits LINKED_EXIT and,
 *                      on success, marks the LINKED libraries present (unless LINKED_PROVIDES=0). Every call is recorded.
 *   npx install-deps — the full list on a slow mirror: "times out" and leaves an apt running for FULL_SECONDS that
 *                      only then marks everything installed (or succeeds at once with FULL_SECONDS=0).
 *   node -e          — the launch check: succeeds once either the linked libraries or everything is present.
 */
const SCRIPT = join(process.cwd(), 'scripts/ci/install-playwright.sh')
let dir = ''

function stub(bin: string, name: string, body: string) {
  const p = join(bin, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

function run(env: Record<string, string>) {
  dir = mkdtempSync(join(tmpdir(), 'pw-linked-'))
  const bin = join(dir, 'bin')
  const state = join(dir, 'state')
  mkdirSync(bin)
  mkdirSync(state)
  stub(bin, 'uname', 'echo Linux')
  stub(bin, 'timeout', 'shift 2; exec "$@"')
  stub(bin, 'sudo', '[ "$1" = tee ] && { cat >/dev/null; exit 0; }; exec "$@"')
  stub(bin, 'pgrep', `[ -f "${state}/apt.pid" ] && kill -0 "$(cat "${state}/apt.pid")" 2>/dev/null`)
  stub(
    bin,
    'apt-get',
    `echo "$*" >> "${state}/apt_calls"
case "$*" in
  *install*)
    echo $$ > "${state}/apt.pid"
    sleep "\${LINKED_SECONDS:-0}"
    rm -f "${state}/apt.pid"
    [ "\${LINKED_EXIT:-0}" = 0 ] && [ "\${LINKED_PROVIDES:-1}" = 1 ] && touch "${state}/linked"
    exit "\${LINKED_EXIT:-0}" ;;
  *) exit 0 ;;
esac`,
  )
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
    if [ "\${FULL_SECONDS:-0}" -gt 0 ]; then
      ( sleep "\${FULL_SECONDS}"; touch "${state}/installed"; rm -f "${state}/apt.pid" ) >/dev/null 2>&1 &
      echo $! > "${state}/apt.pid"
      exit 124
    fi
    touch "${state}/installed"; exit 0 ;;
  *) exit 0 ;;
esac`,
  )
  stub(
    bin,
    'node',
    `case "$1" in
  *playwright-linked-packages.cjs)
    case "\${LINKED_MODE:-unknown}" in
      missing) printf 'libevent-2.1-7t64\\nlibgles2\\n'; exit 0 ;;
      none) exit 0 ;;
      *) echo "playwright-linked-packages: cannot tell" >&2; exit 2 ;;
    esac ;;
  *) [ -f "${state}/installed" ] || [ -f "${state}/linked" ] ;;
esac`,
  )
  const started = Date.now()
  const r = spawnSync('bash', [SCRIPT, 'webkit'], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PW_INSTALL_RETRY_DELAY: '0',
      PW_APT_WAIT_POLL: '1',
      PW_APT_PROGRESS_PATHS: join(state, 'progress'),
      PW_APT_OPTIONAL_WAIT_BUDGET: '2',
      ...env,
    },
    encoding: 'utf8',
    timeout: 45_000,
  })
  const read = (f: string) => (existsSync(join(state, f)) ? readFileSync(join(state, f), 'utf8') : '')
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    ms: Date.now() - started,
    aptCalls: read('apt_calls').split('\n').filter(Boolean),
    depsCalls: Number(read('deps_calls') || 0),
  }
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('install-playwright.sh — linked libraries first', () => {
  it('🛑 the 2026-11-20 case: the full list is stuck on a slow mirror, but WebKit launches on what step 2 installed', () => {
    // The full install's apt would take 60s; nothing waits for it, because the browser already starts.
    const r = run({ LINKED_MODE: 'missing', FULL_SECONDS: '60' })
    expect(r.aptCalls).toContain('install -y --no-install-recommends libevent-2.1-7t64 libgles2')
    expect(r.out).toMatch(/linked libraries installed/)
    expect(r.out).toMatch(/every browser already launches; step 3 is fonts and codecs/)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
    // Bounded by the optional wait budget (2s here), not by the 60s apt.
    expect(r.ms).toBeLessThan(20_000)
  }, 45_000)

  it('🛑 without the opt-in the wait is NOT shortened: a screenshot lane still waits for its fonts', () => {
    // Positive control for the case above. Same stuck-ish full install (4s), budget left at the normal default.
    const r = run({ LINKED_MODE: 'missing', FULL_SECONDS: '4', PW_APT_OPTIONAL_WAIT_BUDGET: '' })
    expect(r.out).toMatch(/linked libraries installed/)
    expect(r.out).not.toMatch(/every browser already launches/)
    expect(r.out).toMatch(/the previous attempt's apt finished/)
    expect(r.status).toBe(0)
  }, 45_000)

  it('the linked packages go in BEFORE the full list is attempted', () => {
    const r = run({ LINKED_MODE: 'missing' })
    expect(r.out.indexOf('installing first (2): libevent-2.1-7t64 libgles2')).toBeGreaterThan(-1)
    expect(r.out.indexOf('installing first')).toBeLessThan(r.out.indexOf('== 3/4 OS packages'))
    expect(r.depsCalls).toBe(1)
    expect(r.status).toBe(0)
  }, 45_000)

  it('nothing missing costs no apt call, and the full install still runs', () => {
    const r = run({ LINKED_MODE: 'none', FULL_SECONDS: '0' })
    expect(r.out).toMatch(/every library the browsers link against is already on this runner/)
    expect(r.aptCalls).toEqual([])
    expect(r.depsCalls).toBe(1)
    expect(r.status).toBe(0)
  }, 45_000)

  it('🛑 "could not tell" is never read as "nothing missing": the full install runs exactly as before', () => {
    const r = run({ LINKED_MODE: 'unknown', FULL_SECONDS: '0' })
    expect(r.out).toMatch(/could not determine the browsers' linked libraries/)
    expect(r.out).not.toMatch(/every browser already launches/)
    expect(r.aptCalls).toEqual([])
    expect(r.depsCalls).toBe(1)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
  }, 45_000)

  it('🛑 and with "could not tell" the full install is still waited for — the optional budget does not apply', () => {
    // Positive control for the test above: the full apt takes 4s, the optional budget is 2s, the normal one is 600s.
    const r = run({ LINKED_MODE: 'unknown', FULL_SECONDS: '4', PW_APT_WAIT_BUDGET: '600', PW_APT_STALL_SECONDS: '600' })
    expect(r.out).toMatch(/the previous attempt's apt finished/)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
  }, 45_000)

  it('a failed linked install warns and falls through to the full install', () => {
    const r = run({ LINKED_MODE: 'missing', LINKED_EXIT: '100', FULL_SECONDS: '0' })
    expect(r.out).toMatch(/the linked-library install failed \(exit 100\)/)
    expect(r.out).not.toMatch(/every browser already launches/)
    expect(r.depsCalls).toBe(1)
    expect(r.out).toMatch(/webkit launches/)
    expect(r.status).toBe(0)
  }, 45_000)

  it('a linked install past its cap is left running and waited for, not killed, and the full install then runs', () => {
    const r = run({ LINKED_MODE: 'missing', LINKED_SECONDS: '4', PW_LINKED_DEPS_TIMEOUT: '1', FULL_SECONDS: '0' })
    expect(r.out).toMatch(/the linked-library install is still running after 1s/)
    expect(r.out).toMatch(/the previous attempt's apt finished/)
    expect(r.out).not.toMatch(/Could not get lock/)
    expect(r.depsCalls).toBe(1)
    expect(r.status).toBe(0)
  }, 45_000)

  it('🛑 the launch check still decides: an install that does not make the browser start is not a pass', () => {
    // apt "succeeds" but provides nothing, so the precheck fails, the optional budget is NOT applied, and with the
    // full install stuck past the normal budget step 4 fails honestly.
    const r = run({ LINKED_MODE: 'missing', LINKED_PROVIDES: '0', FULL_SECONDS: '30', PW_APT_WAIT_BUDGET: '2' })
    expect(r.out).toMatch(/linked libraries installed/)
    expect(r.out).not.toMatch(/every browser already launches/)
    expect(r.out).toMatch(/wait budget is spent/)
    expect(r.out).toMatch(/webkit cannot launch/)
    expect(r.status).toBe(1)
  }, 45_000)
})

describe('playwright-linked-packages.cjs — reading Playwright\'s message', () => {
  const require = createRequire(import.meta.url)
  const { packagesFromMessage, DLOPEN_ONLY_PACKAGES } = require('../../scripts/ci/playwright-linked-packages.cjs')

  // Captured verbatim from playwright-core 1.64.1's validator on 2026-11-20, against a stand-in WebKit directory
  // whose binary links libevent-2.1.so.7 (absent) on a host without libGLESv2.so.2.
  const REAL = [
    '',
    '╔══════════════════════════════════════════════════════╗',
    '║ Host system is missing dependencies to run browsers. ║',
    '║ Please install them with the following command:      ║',
    '║                                                      ║',
    '║     npx playwright install-deps                      ║',
    '║                                                      ║',
    '║ Alternatively, use apt:                              ║',
    '║     apt-get install libevent-2.1-7t64\\               ║',
    '║         libgles2                                     ║',
    '║                                                      ║',
    '║ <3 Playwright Team                                   ║',
    '╚══════════════════════════════════════════════════════╝',
  ].join('\n')

  it('reads every package from the boxed apt command', () => {
    expect(packagesFromMessage(REAL)).toEqual(['libevent-2.1-7t64', 'libgles2'])
  })

  it('returns null when Playwright could only name libraries, not packages', () => {
    const unmapped = REAL.replace(/Please install[\s\S]*Team {3}/, 'Missing libraries:                                   ║\n║     libnotreal.so.9')
    expect(packagesFromMessage(unmapped)).toBeNull()
  })

  it('returns null rather than guess when a token is not a package name', () => {
    expect(packagesFromMessage('apt-get install libevent-2.1-7t64 $(rm -rf /)')).toBeNull()
  })

  it('drops only the dlopen-only H.264 package, which drags in ffmpeg', () => {
    expect([...DLOPEN_ONLY_PACKAGES]).toEqual(['gstreamer1.0-libav'])
  })
})
