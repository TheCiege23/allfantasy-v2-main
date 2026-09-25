/**
 * Competitive Edge for a DRAFT — what each other manager in this league has actually taken, across
 * this league's past drafts, stated as counts. Pure: the loader (./draftEdgeLoader.ts) supplies the
 * league's picks with the manager who made each one.
 *
 * 🛑 THE SAME CONTRACT AS THE TRADE AND WAIVER EDGES (./tradeEdge.ts, ./waiverEdge.ts):
 *   - FACTS, NEVER LABELS. "took a RB with 5 of their 9 picks in rounds 1–3" — never "RB-heavy",
 *     "a Zero-RB drafter".
 *   - NO PREDICTIONS. Nothing here says what anyone will take next.
 *   - THE MANAGER IS A PERSON, NOT A TEAM SLOT. Picks are matched on the Sleeper user id that owned
 *     the drafting team THAT season (`dw_draft_facts.metadata.ownerSleeperId`). `managerId` cannot be
 *     used: a departed manager's picks fall back to the slot number, which Sleeper reuses, so they
 *     would be credited to whoever holds that slot now.
 *   - COVERAGE IS PART OF THE ANSWER. Below DRAFT_FLOOR drafts no pattern is shown — one draft is an
 *     anecdote — and the payload says which drafts it read and which it could not attribute.
 */

import type { EdgeFact } from './tradeEdge'

/** Drafts a manager must have picked in before any pattern is shown. */
export const DRAFT_FLOOR = 2
/** "Early" means these rounds. */
export const EARLY_ROUNDS = 3

export type EdgeDraftPick = {
  season: number
  round: number
  position: string | null
  /** The Sleeper user id of the team's owner that season. */
  ownerSleeperId: string
}

export type EdgeDraftManager = {
  /** `LeagueTeam.platformUserId` — the manager's Sleeper user id. */
  ownerSleeperId: string
  name: string
  teamExternalId: string
}

export type DraftEdgeRival = {
  manager: { name: string; teamExternalId: string }
  drafts: number
  picks: number
  sufficient: boolean
  facts: EdgeFact[]
}

export type DraftEdge = {
  rivals: DraftEdgeRival[]
  coverage: {
    source: 'sleeper_draft_history'
    /** Seasons whose picks are matched to their managers. */
    seasons: number[]
    /** Seasons with any pick not yet matched to a manager — the counts omit those picks. */
    unattributedSeasons: number[]
  }
}

const SKIP_POSITIONS = new Set(['', 'PICK', 'UNKNOWN', 'N/A'])

function pos(p: string | null | undefined): string | null {
  const v = String(p ?? '').trim().toUpperCase()
  return v && !SKIP_POSITIONS.has(v) ? v : null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function positionPlural(p: string): string {
  return /S$/.test(p) ? p : `${p}s`
}

function seasonRange(seasons: number[]): string {
  if (seasons.length === 0) return ''
  const s = [...seasons].sort((a, b) => a - b)
  return s[0] === s[s.length - 1] ? `${s[0]}` : `${s[0]}–${s[s.length - 1]}`
}

function top(counts: Map<string, number>): [string, number] | null {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null
}

function rivalFacts(
  name: string,
  mine: EdgeDraftPick[],
  draftsOnFile: number,
): { facts: EdgeFact[]; drafts: number; sufficient: boolean } {
  const facts: EdgeFact[] = []
  const seasons = [...new Set(mine.map((p) => p.season))].sort((a, b) => a - b)
  const drafts = seasons.length

  if (drafts === 0) {
    facts.push({ key: 'draft.record', text: `${name} has no picks on file in this league's drafts.`, bearsOnDeal: false })
    return { facts, drafts, sufficient: false }
  }
  facts.push({
    key: 'draft.record',
    text: `${name} drafted in ${drafts} of the ${draftsOnFile} drafts on file (${seasonRange(seasons)}), ${plural(mine.length, 'pick')} in all.`,
    bearsOnDeal: false,
  })
  const sufficient = drafts >= DRAFT_FLOOR
  if (!sufficient) return { facts, drafts, sufficient }

  // The first-round pick, draft by draft: the clearest single signal a draft history carries.
  const firstPickPos = new Map<string, number>()
  for (const season of seasons) {
    const first = mine.filter((p) => p.season === season).sort((a, b) => a.round - b.round)[0]
    const p = first ? pos(first.position) : null
    if (first && first.round === 1 && p) firstPickPos.set(p, (firstPickPos.get(p) ?? 0) + 1)
  }
  const firstTop = top(firstPickPos)
  if (firstTop) {
    facts.push({
      key: `draft.first_round.${firstTop[0]}`,
      text: `Their first-round pick was at ${firstTop[0]} in ${firstTop[1]} of their ${drafts} drafts.`,
      bearsOnDeal: false,
    })
  }

  const early = mine.filter((p) => p.round <= EARLY_ROUNDS)
  const earlyPos = new Map<string, number>()
  for (const p of early) {
    const v = pos(p.position)
    if (v) earlyPos.set(v, (earlyPos.get(v) ?? 0) + 1)
  }
  const earlyTop = top(earlyPos)
  if (earlyTop && early.length >= 3) {
    facts.push({
      key: `draft.early.${earlyTop[0]}`,
      text: `In rounds 1–${EARLY_ROUNDS}, ${earlyTop[1]} of their ${early.length} picks were ${positionPlural(earlyTop[0])}.`,
      bearsOnDeal: false,
    })
  }

  // Quarterback timing: the position whose draft slot varies most between managers.
  const qbEarlyDrafts = seasons.filter((season) =>
    mine.some((p) => p.season === season && p.round <= EARLY_ROUNDS && pos(p.position) === 'QB'),
  ).length
  const anyQb = mine.some((p) => pos(p.position) === 'QB')
  if (anyQb) {
    facts.push({
      key: 'draft.qb_early',
      text:
        qbEarlyDrafts === 0
          ? `They haven't taken a QB in rounds 1–${EARLY_ROUNDS} in any of their ${drafts} drafts.`
          : `They took a QB in rounds 1–${EARLY_ROUNDS} in ${qbEarlyDrafts} of their ${drafts} drafts.`,
      bearsOnDeal: false,
    })
  }
  return { facts, drafts, sufficient }
}

export function buildDraftEdge(input: {
  picks: EdgeDraftPick[]
  managers: EdgeDraftManager[]
  /** The viewer's Sleeper user id — left out of the rivals. */
  viewerOwnerSleeperId: string | null
  unattributedSeasons: number[]
}): DraftEdge {
  const draftsOnFile = new Set(input.picks.map((p) => p.season)).size
  const byOwner = new Map<string, EdgeDraftPick[]>()
  for (const p of input.picks) {
    const list = byOwner.get(p.ownerSleeperId) ?? []
    list.push(p)
    byOwner.set(p.ownerSleeperId, list)
  }

  const rivals: DraftEdgeRival[] = input.managers
    .filter((m) => m.ownerSleeperId !== input.viewerOwnerSleeperId)
    .map((m) => {
      const mine = byOwner.get(m.ownerSleeperId) ?? []
      const { facts, drafts, sufficient } = rivalFacts(m.name, mine, draftsOnFile)
      return { manager: { name: m.name, teamExternalId: m.teamExternalId }, drafts, picks: mine.length, sufficient, facts }
    })
    .sort((a, b) => b.drafts - a.drafts || a.manager.name.localeCompare(b.manager.name))

  const seasons = [...new Set(input.picks.map((p) => p.season))].sort((a, b) => a - b)
  return {
    rivals,
    coverage: {
      source: 'sleeper_draft_history',
      seasons,
      // Kept even when the season also has matched picks: a PARTLY matched draft still undercounts.
      unattributedSeasons: [...new Set(input.unattributedSeasons)].sort((a, b) => a - b),
    },
  }
}
