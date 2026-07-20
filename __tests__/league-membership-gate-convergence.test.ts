import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard: no league authorization gate may derive membership from
 * `LeagueTeam.platformUserId`.
 *
 * That column is nullable (`String?`) and is only written by the native open-slot claim
 * path, so it is empty for imported (e.g. Sleeper) leagues. Gating on it hands a real
 * member a bare 403 for their own league. The always-populated counterpart is
 * `Roster.platformUserId`, and the canonical union lives in `lib/league-access.ts`.
 *
 * This scans source rather than behaviour because the failure is silent: each gate looks
 * perfectly reasonable in isolation, and six of them independently drifted onto the wrong
 * column. Reviewing one diff will not catch the seventh.
 */

const ROOTS = ['app', 'server', 'lib']
const REPO_ROOT = join(__dirname, '..')

/**
 * Files permitted to read `LeagueTeam.platformUserId` for NON-authorization purposes
 * (display, notification fan-out, engine roster mapping). Each entry is a deliberate
 * exemption, not a TODO — adding one means asserting the read does not gate access.
 */
const NON_AUTH_ALLOWLIST = new Set<string>([
  'server/services/standingsEngine.ts', // maps teams->rosters for standings rows
  'server/services/playoffEngine.ts', // maps teams->divisions for seeding
  'lib/league-import/placeholderClaim.ts', // WRITES the column during a claim
])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) walk(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** The anti-pattern: build a member set out of `teams[].platformUserId`, then gate on it. */
function isAuthGateOnNullableColumn(source: string): boolean {
  const selectsTeamPlatformUserId = /teams\s*:\s*\{\s*select\s*:\s*\{[^}]*platformUserId/s.test(source)
  if (!selectsTeamPlatformUserId) return false
  // Only a gate if the selected value feeds an access decision.
  return /memberIds/.test(source) && /\b(403|Forbidden)\b/.test(source)
}

describe('league membership gates have converged onto the canonical helper', () => {
  const files = ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)))

  it('finds source files to scan (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it('no authorization gate derives membership from LeagueTeam.platformUserId', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/')
      if (NON_AUTH_ALLOWLIST.has(rel)) continue
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (isAuthGateOnNullableColumn(source)) offenders.push(rel)
    }

    expect(offenders).toEqual([])
  })

  it('NEGATIVE CONTROL: the detector actually fires on the pre-fix gate shape', () => {
    const preFixGate = `
      const league = await prisma.league.findFirst({
        where: { id: leagueId },
        select: { id: true, userId: true, teams: { select: { platformUserId: true } } },
      })
      const memberIds = new Set(league.teams.map((t) => t.platformUserId).filter(Boolean))
      if (league.userId !== userId && !memberIds.has(userId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    `
    expect(isAuthGateOnNullableColumn(preFixGate)).toBe(true)

    // ...and does not fire on the converged shape.
    const converged = `
      const access = await resolveLeagueAccess(leagueId, userId)
      if (!access?.isMember) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    `
    expect(isAuthGateOnNullableColumn(converged)).toBe(false)
  })
})
