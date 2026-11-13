/**
 * Demo league configuration and the stable alias mapping.
 *
 * Both live in `platform_config` (the existing admin-editable key/value table), so
 * this feature needs NO migration:
 *
 *   demo_league.source.v1             → { leagueId, setByUserId, setAt }
 *   demo_league.aliases.v1.<leagueId> → { next, teams: { <realTeamKey>: <aliasIndex> } }
 *
 * The alias map is the server-side record that makes fake names STABLE: the same real
 * team gets the same alias index — and therefore the same fake team and manager name —
 * across sessions, weeks and syncs. An index, once given, is never reassigned or reused,
 * even if that team later leaves the league.
 *
 * ⚠ SERVER-ONLY. Nothing in this module may be imported by a client component: the
 * alias map is keyed by real team ids, and the source config names the real league.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

const SOURCE_KEY = 'demo_league.source.v1'
const ALIAS_KEY_PREFIX = 'demo_league.aliases.v1.'

export type DemoSourceConfig = {
  leagueId: string
  setByUserId: string
  setAt: string
}

type AliasMap = { next: number; teams: Record<string, number> }

function parseSource(raw: string | null | undefined): DemoSourceConfig | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<DemoSourceConfig>
    if (typeof v.leagueId !== 'string' || !v.leagueId.trim()) return null
    return {
      leagueId: v.leagueId,
      setByUserId: typeof v.setByUserId === 'string' ? v.setByUserId : '',
      setAt: typeof v.setAt === 'string' ? v.setAt : '',
    }
  } catch {
    return null
  }
}

function parseAliases(raw: string | null | undefined): AliasMap {
  if (!raw) return { next: 0, teams: {} }
  try {
    const v = JSON.parse(raw) as Partial<AliasMap>
    const teams: Record<string, number> = {}
    let max = -1
    if (v.teams && typeof v.teams === 'object') {
      for (const [k, idx] of Object.entries(v.teams)) {
        if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0) {
          teams[k] = idx
          if (idx > max) max = idx
        }
      }
    }
    const next = typeof v.next === 'number' && v.next > max ? v.next : max + 1
    return { next, teams }
  } catch {
    // A corrupt map must not silently restart numbering at 0 and hand an old team's
    // fake name to a different team. Refuse instead; the caller fails closed.
    throw new Error('demo alias map is unreadable')
  }
}

export async function getDemoSourceConfig(): Promise<DemoSourceConfig | null> {
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: SOURCE_KEY }, select: { value: true } })
    return parseSource(row?.value)
  } catch {
    return null
  }
}

export async function setDemoSourceConfig(leagueId: string, setByUserId: string): Promise<DemoSourceConfig> {
  const cfg: DemoSourceConfig = { leagueId, setByUserId, setAt: new Date().toISOString() }
  const value = JSON.stringify(cfg)
  await prisma.platformConfig.upsert({ where: { key: SOURCE_KEY }, create: { key: SOURCE_KEY, value }, update: { value } })
  return cfg
}

export async function clearDemoSourceConfig(): Promise<void> {
  await prisma.platformConfig.deleteMany({ where: { key: SOURCE_KEY } })
}

/**
 * Return a stable alias index for every real team key, assigning new indices to keys
 * seen for the first time. Existing assignments are never changed.
 *
 * New keys are assigned in the order given, so callers pass a deterministic order
 * (e.g. by real team id) — that makes the first assignment reproducible too.
 *
 * Concurrency: two first-visit requests could both read an empty map. The write runs in
 * a transaction holding a Postgres advisory lock keyed on the league, and re-reads the
 * map inside it, so the second request sees the first one's assignments instead of
 * overwriting them with a different numbering.
 */
export async function ensureTeamAliases(sourceLeagueId: string, realTeamKeys: string[]): Promise<Map<string, number>> {
  const key = `${ALIAS_KEY_PREFIX}${sourceLeagueId}`
  const read = async () => parseAliases((await prisma.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value)

  let map = await read()
  const missing = realTeamKeys.filter((k) => map.teams[k] === undefined)
  if (missing.length > 0) {
    map = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      const row = await tx.platformConfig.findUnique({ where: { key }, select: { value: true } })
      const current = parseAliases(row?.value)
      let changed = false
      for (const k of realTeamKeys) {
        if (current.teams[k] !== undefined) continue
        current.teams[k] = current.next
        current.next += 1
        changed = true
      }
      if (changed) {
        const value = JSON.stringify(current)
        await tx.platformConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
      }
      return current
    })
  }
  return new Map(Object.entries(map.teams))
}
