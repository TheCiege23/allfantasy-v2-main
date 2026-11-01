/**
 * AF ADP for the mock draft pool — the same number the live draft room shows.
 *
 * The live room attaches it in `getResolvedDraftPoolForLeague`: `loadAdpBoard` for the draft's
 * context gives each player's imported-league and AllFantasy-draft corpora, and `computeAfAdp`
 * blends them with the row's market ADP. A mock has no league session, so its context is built
 * from the mock's own settings (sport, scoring, team count, draft type, dynasty or redraft) —
 * exactly the fields `buildDraftContext` reads from a real league and session.
 *
 * Additive: `adp` keeps meaning market ADP. A row with nothing to blend gets `afAdp: null`, and a
 * board that cannot be read leaves every row null rather than failing the pool.
 */
import { computeAfAdp } from '@/lib/adp/afAdp'
import { buildPlayerKey, type DraftContext } from '@/lib/adp/computeAllFantasyAdp'
import { buildDraftContext } from '@/lib/adp/draftContextKey'
import type { AdpCorpusSplit } from '@/lib/adp/loadAdpBoard'

export interface MockAfAdpFields {
  afAdp: number | null
  afAdpContributions?: { market: number; imported: number; af: number }
  afAdpImportedSampleSize?: number | null
  afAdpOwnSampleSize?: number | null
}

export interface MockAfAdpContextInput {
  sport: string
  season?: string | null
  scoring?: string | null
  isDynasty: boolean
  teamCount?: number | null
  draftType?: string | null
}

/** Pure: blend every row that has a name and position. */
export function attachAfAdpToEntries<T>(
  entries: T[],
  corpora: ReadonlyMap<string, AdpCorpusSplit>,
): Array<T | (T & MockAfAdpFields)> {
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name : ''
    const position = typeof row.position === 'string' ? row.position : ''
    if (!name || !position) return entry
    const marketAdp = typeof row.adp === 'number' && Number.isFinite(row.adp) ? row.adp : null
    const af = computeAfAdp({ marketAdp, split: corpora.get(buildPlayerKey(name, position)) })
    const fields: MockAfAdpFields = af
      ? {
          afAdp: af.afAdp,
          afAdpContributions: af.contributions,
          afAdpImportedSampleSize: af.importedSampleSize,
          afAdpOwnSampleSize: af.afSampleSize,
        }
      : { afAdp: null }
    return { ...entry, ...fields }
  })
}

export function buildMockDraftContext(input: MockAfAdpContextInput): DraftContext {
  const teamCount = typeof input.teamCount === 'number' && input.teamCount > 0 ? input.teamCount : null
  return buildDraftContext({
    league: {
      sport: input.sport,
      season: Number(input.season) || new Date().getUTCFullYear(),
      scoring: input.scoring ?? null,
      isDynasty: input.isDynasty,
      leagueVariant: null,
      leagueSize: teamCount,
    },
    session: { draftType: input.draftType ?? null, teamCount },
  })
}

/** Loads the board for the mock's context and blends it in. Never throws. */
export async function attachAfAdpToMockPool<T>(
  entries: T[],
  input: MockAfAdpContextInput,
  deps: {
    loadCorpora?: (context: DraftContext) => Promise<ReadonlyMap<string, AdpCorpusSplit>>
  } = {},
): Promise<Array<T | (T & MockAfAdpFields)>> {
  if (entries.length === 0) return entries
  try {
    const context = buildMockDraftContext(input)
    const loadCorpora =
      deps.loadCorpora ??
      (async (ctx: DraftContext) => {
        const { loadAdpBoard } = await import('@/lib/adp/loadAdpBoard')
        return (await loadAdpBoard(ctx, { draftMode: 'real' })).corpora
      })
    return attachAfAdpToEntries(entries, await loadCorpora(context))
  } catch {
    return entries.map((entry) => (entry && typeof entry === 'object' ? { ...entry, afAdp: null } : entry))
  }
}
