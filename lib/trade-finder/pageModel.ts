import type { FinderCandidateGrade } from './candidateGrades'

/**
 * What the /trade-finder page renders, built from the route's response. PURE and client-safe.
 *
 * 🛑 THE PAGE USED TO READ `opportunities` AS TRADES (2026-09-27). Those are insight notes — a title,
 * a description, some players — with NO give or get side, no fairness and no verdict. The page drew
 * each as a trade card and filled the gaps itself: `fairness ?? 80`, `verdict ?? 'FAIR'`, empty
 * sides. Every card read "FAIR · 80" whatever the league. The trades are `candidates`; the notes are
 * listed as notes. Nothing here invents a value the response did not carry.
 */

/** One suggested trade, from the viewer's side. */
export type FinderTrade = {
  id: string
  give: Array<{ name: string; position: string; team: string; value: number }>
  get: Array<{ name: string; position: string; team: string; value: number }>
  partnerName: string
  partnerObjective: string
  aiSummary: string
  /** THE grade from your side. Absent or null: not graded — the card says so, never a stand-in. */
  grade?: FinderCandidateGrade | null
}

/** Something the finder noticed that is NOT a trade. */
export type FinderInsight = { title: string; description: string }

type Asset = { name?: unknown; position?: unknown; value?: unknown }
type Candidate = {
  tradeId?: unknown
  archetype?: unknown
  whyThisExists?: unknown
  teamA?: { gives?: Asset[]; receives?: Asset[] }
  leagueGrade?: FinderCandidateGrade | null
  partnerName?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function side(assets: Asset[] | undefined): FinderTrade['give'] {
  return (assets ?? []).map((a) => ({ name: str(a.name), position: str(a.position) || 'FLEX', team: '', value: num(a.value) }))
}

export function toFinderTrades(data: { candidates?: unknown; recommendations?: unknown }): FinderTrade[] {
  const candidates = Array.isArray(data.candidates) ? (data.candidates as Candidate[]) : []
  const summaries = new Map<string, string>()
  for (const r of Array.isArray(data.recommendations) ? (data.recommendations as Array<{ tradeId?: unknown; summary?: unknown }>) : []) {
    if (str(r.tradeId) && str(r.summary)) summaries.set(str(r.tradeId), str(r.summary))
  }
  return candidates
    .filter((c) => (c.teamA?.gives?.length ?? 0) > 0 && (c.teamA?.receives?.length ?? 0) > 0)
    .map((c) => {
      const id = str(c.tradeId)
      const why = Array.isArray(c.whyThisExists) ? (c.whyThisExists as unknown[]).map(str).filter(Boolean).join(' ') : ''
      return {
        id,
        give: side(c.teamA?.gives),
        get: side(c.teamA?.receives),
        partnerName: str(c.partnerName) || 'Another manager',
        partnerObjective: str(c.archetype).replaceAll('_', ' ').toLowerCase(),
        aiSummary: summaries.get(id) ?? why,
        grade: c.leagueGrade ?? null,
      }
    })
}

export function toFinderInsights(data: { opportunities?: unknown }): FinderInsight[] {
  const rows = Array.isArray(data.opportunities) ? (data.opportunities as Array<{ title?: unknown; description?: unknown }>) : []
  return rows
    .map((o) => ({ title: str(o.title), description: str(o.description) }))
    .filter((o) => o.title || o.description)
}
