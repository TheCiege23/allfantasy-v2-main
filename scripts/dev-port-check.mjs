/**
 * scripts/dev-port-check.mjs
 *
 * Diagnose (or kill) lingering `next dev` servers. Helpful for the Windows +
 * Next 14 + HMR pathology where a dev process gets stuck and the next boot
 * reuses or fails over to a different port, leaving stale `.next/` artifacts
 * and 500 responses — and for freeing the Prisma query-engine DLL, which a
 * live dev server keeps mapped so `prisma generate` cannot replace it.
 *
 * USAGE
 *   node scripts/dev-port-check.mjs              # report only
 *   node scripts/dev-port-check.mjs --kill       # kill them (after a confirmation print)
 *   node scripts/dev-port-check.mjs --ports=3000,3001,52712  # explicit list, skips discovery
 *
 * 🛑 TWO DEFECTS THIS FILE USED TO HAVE, BOTH OF WHICH MADE IT EXIT 0 HAVING
 * FREED NOTHING. Keep them fixed:
 *
 *  1. It scanned a HARDCODED [3000, 3001]. Every session here runs its own
 *     port (3007 / 3101 / 3213 were live when this was measured), so the scan
 *     found no listeners and printed "ports are free" — a textbook check that
 *     cannot fail. Ports are now DISCOVERED from the running dev servers, and
 *     the old pair is only a fallback.
 *  2. It killed the LISTENING pid, which is the `start-server.js` child. Its
 *     parent is the `next dev` supervisor, which respawns it — so the port
 *     (and the engine DLL) came straight back. Kills now resolve up the parent
 *     chain to the supervisor first.
 *
 * ⚠ Killing does not buy a durable quiet window in a shared checkout: peers
 * restart their servers within minutes. Announce first.
 *
 * No external deps. Uses `lsof` / `netstat` / `powershell` via child_process,
 * with platform detection for Windows vs POSIX. Never silently mutates
 * anything; `--kill` is required to send signals.
 */

import { execSync, spawnSync } from 'node:child_process'

const ARGV = process.argv.slice(2)
const FLAG_KILL = ARGV.includes('--kill')
const FLAG_QUIET = ARGV.includes('--quiet') || ARGV.includes('-q')
// An explicit --ports= list disables discovery entirely: naming the ports IS
// the override. `null` (no flag) means "discover, and fall back to the pair
// below only so a bare run still checks the Next defaults".
const EXPLICIT_PORTS = (() => {
  const arg = ARGV.find((a) => a.startsWith('--ports='))
  if (!arg) return null
  return arg
    .slice('--ports='.length)
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
})()

const FALLBACK_PORTS = [3000, 3001]

const IS_WINDOWS = process.platform === 'win32'

function log(msg) {
  if (!FLAG_QUIET) process.stdout.write(`[dev-port-check] ${msg}\n`)
}

/**
 * Returns array of { port, pid, processName } for every PID listening on the
 * requested ports. Best-effort; returns [] on a CLI failure rather than
 * crashing.
 */
function findHolders(ports) {
  const raw = IS_WINDOWS ? findHoldersWindows(ports) : findHoldersPosix(ports)
  // netstat (Windows) and lsof (POSIX) often report the same listener twice
  // — once for IPv4 and once for IPv6. Dedupe by `port|pid`.
  const seen = new Set()
  const out = []
  for (const h of raw) {
    const key = `${h.port}|${h.pid}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
  }
  return out
}

function findHoldersWindows(ports) {
  const out = []
  let netstatOut = ''
  try {
    netstatOut = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return out
  }
  // netstat -ano lines look like:
  //   TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345
  for (const rawLine of netstatOut.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('TCP')) continue
    if (!/\bLISTENING\b/i.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    const local = parts[1]
    const pid = Number(parts[parts.length - 1])
    if (!Number.isFinite(pid) || pid <= 0) continue
    const portMatch = local.match(/:(\d+)$/)
    if (!portMatch) continue
    const port = Number(portMatch[1])
    if (!ports.includes(port)) continue
    out.push({ port, pid, processName: lookupProcessNameWindows(pid) })
  }
  return out
}

function lookupProcessNameWindows(pid) {
  try {
    const csv = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // CSV rows: "node.exe","12345","Console","1","123,456 K"
    const first = String(csv).split(/\r?\n/).find((l) => l.includes(`"${pid}"`)) || ''
    const m = first.match(/^"([^"]+)"/)
    return m ? m[1] : 'unknown'
  } catch {
    return 'unknown'
  }
}

function findHoldersPosix(ports) {
  const out = []
  for (const port of ports) {
    let pidsRaw = ''
    try {
      pidsRaw = execSync(`lsof -t -i tcp:${port} -sTCP:LISTEN`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      continue
    }
    for (const pidStr of pidsRaw.split(/\s+/).filter(Boolean)) {
      const pid = Number(pidStr)
      if (!Number.isFinite(pid)) continue
      out.push({ port, pid, processName: lookupProcessNamePosix(pid) })
    }
  }
  return out
}

function lookupProcessNamePosix(pid) {
  try {
    const cmd = execSync(`ps -p ${pid} -o comm=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return cmd.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Every live node process as { pid, ppid, commandLine }. Best-effort: returns
 * [] rather than throwing, so a missing `ps`/`powershell` degrades to the
 * old port-only behaviour instead of crashing the script.
 */
function listNodeProcesses() {
  return IS_WINDOWS ? listNodeProcessesWindows() : listNodeProcessesPosix()
}

function listNodeProcessesWindows() {
  // Deliberately no double quotes in this PowerShell source: an inner `"` is
  // eaten when a native exe is invoked on Windows, so `-Filter "Name='node.exe'"`
  // arrives mangled. Filtering in the pipeline needs no quoting at all.
  const script =
    'Get-CimInstance Win32_Process | ' +
    "Where-Object { $_.Name -eq 'node.exe' } | " +
    'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.status !== 0 || !r.stdout) return []
  let parsed
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    return []
  }
  // ConvertTo-Json emits a bare object, not an array, when there is exactly one row.
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows
    .filter((row) => row && Number.isFinite(Number(row.ProcessId)))
    .map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      commandLine: String(row.CommandLine || ''),
    }))
}

function listNodeProcessesPosix() {
  try {
    const out = execSync('ps -eo pid=,ppid=,args=', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split(/\r?\n/)
      .map((line) => {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
        if (!m) return null
        return { pid: Number(m[1]), ppid: Number(m[2]), commandLine: m[3] }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * True for the `next dev` SUPERVISOR — the process that respawns the server.
 * Its child (`.../next/dist/server/lib/start-server.js`) is what actually holds
 * the port and maps the Prisma engine, and deliberately does NOT match here.
 */
function isNextDevSupervisor(commandLine) {
  const at = commandLine.search(/bin[\\/]next\b/)
  if (at === -1) return false
  // `dev` must be its own argv token. A bare /\bdev\b/ also matches inside
  // `.next-dev-local`, which is a dist-dir name, not the dev subcommand.
  return /(^|\s)dev(\s|$)/.test(commandLine.slice(at))
}

function portForProcess(commandLine) {
  const m = commandLine.match(/(?:-p|--port)[\s=]+(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Walk up the parent chain from a listening pid to the `next dev` supervisor.
 * Falls back to the pid itself when no supervisor is found (a stray server
 * started by hand, or a parent that is not a node process). `seen` guards
 * against a cycle, which a recycled pid can produce.
 */
function resolveSupervisor(pid, procs) {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const seen = new Set()
  let cur = byPid.get(pid)
  while (cur && !seen.has(cur.pid)) {
    seen.add(cur.pid)
    if (isNextDevSupervisor(cur.commandLine)) return cur.pid
    cur = byPid.get(cur.ppid)
  }
  return pid
}

function killTarget(pid) {
  if (IS_WINDOWS) {
    // /T terminates the subtree, so the supervisor's start-server child goes
    // with it. Killing the child alone lets the supervisor respawn it.
    const r = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { encoding: 'utf8' })
    if (r.status === 0) return { ok: true }
    return { ok: false, error: (r.stderr || r.stdout || '').trim() }
  }
  try {
    process.kill(pid, 'SIGTERM')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
}

function main() {
  const procs = listNodeProcesses()
  const devServers = procs.filter((p) => isNextDevSupervisor(p.commandLine))

  const discovered = devServers.map((p) => portForProcess(p.commandLine)).filter((n) => n !== null)
  const ports = EXPLICIT_PORTS
    ? EXPLICIT_PORTS
    : Array.from(new Set([...FALLBACK_PORTS, ...discovered])).sort((a, b) => a - b)

  log(`platform=${IS_WINDOWS ? 'win32' : process.platform}  next dev servers: ${devServers.length}`)
  for (const d of devServers) {
    log(`  supervisor pid ${d.pid}  port ${portForProcess(d.commandLine) ?? 'default'}`)
  }
  log(`checking ports: ${ports.join(', ')}${EXPLICIT_PORTS ? '  (explicit, discovery skipped)' : `  (${discovered.length} discovered)`}`)

  const holders = findHolders(ports)
  for (const h of holders) {
    log(`port ${h.port} held by pid ${h.pid} (${h.processName})`)
  }

  // Targets are SUPERVISORS, keyed by pid, so one server behind two listeners
  // (IPv4 + IPv6) is killed once rather than twice.
  const targets = new Map()
  for (const h of holders) {
    const sup = resolveSupervisor(h.pid, procs)
    const note = sup === h.pid ? `port ${h.port}` : `port ${h.port} via child ${h.pid}`
    const prev = targets.get(sup)
    targets.set(sup, prev ? `${prev}; ${note}` : note)
  }
  // A dev server whose listener we could not see still maps the engine DLL.
  for (const d of devServers) {
    if (!targets.has(d.pid)) targets.set(d.pid, 'found by process scan, no listener matched')
  }

  if (targets.size === 0) {
    // These two are NOT the same result, and conflating them is how this
    // script used to report success while measuring the wrong ports.
    if (devServers.length === 0) {
      log('no next dev server running, and nothing on the checked ports — nothing to free')
    } else {
      log('WARNING: dev servers are running but no listener matched — do not read this as "free"')
    }
    process.exit(0)
  }

  log('')
  for (const [pid, why] of targets) log(`target pid ${pid}  (${why})`)

  if (!FLAG_KILL) {
    log('')
    log('to stop these, re-run with --kill, or manually:')
    for (const pid of targets.keys()) log(IS_WINDOWS ? `  taskkill /F /T /PID ${pid}` : `  kill ${pid}`)
    process.exit(0)
  }

  let killed = 0
  let failed = 0
  for (const [pid, why] of targets) {
    const r = killTarget(pid)
    if (r.ok) {
      log(`killed supervisor pid ${pid} (${why})`)
      killed++
    } else {
      log(`FAILED to kill pid ${pid}: ${r.error}`)
      const combined = `${r.error}`.toLowerCase()
      if (IS_WINDOWS && /access|denied|privilege|not allowed/i.test(combined)) {
        log('')
        log('Windows refused termination (common for a protected or foreign integrity process).')
        log('1) Open PowerShell as Administrator.')
        log('2) Walk parents until you find the launcher root, e.g.:')
        log(`     Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${pid} } | Select-Object Name,ParentProcessId,CommandLine`)
        log('3) Kill the root of the tree (example):')
        log('     taskkill /F /T /PID <rootPid>')
        log('Or use Task Manager → Details → End process tree on the top parent.')
      }
      failed++
    }
  }

  // Verify by EFFECT, not by taskkill's exit code — the whole reason this
  // script existed and still freed nothing.
  const stillAlive = listNodeProcesses().filter((p) => targets.has(p.pid))
  if (stillAlive.length > 0) {
    log('')
    if (IS_WINDOWS) {
      // /F is immediate, so anything still here is a real failure.
      log(`STILL ALIVE after the kill: ${stillAlive.map((p) => p.pid).join(', ')} — this run did NOT free them`)
      failed += stillAlive.length
    } else {
      // SIGTERM is graceful; a server may still be shutting down. Not a failure yet.
      log(`still shutting down (SIGTERM is graceful): ${stillAlive.map((p) => p.pid).join(', ')} — re-run to confirm`)
    }
  }

  log(`done — killed ${killed}, failed ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
