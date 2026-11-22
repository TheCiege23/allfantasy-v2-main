import 'server-only'

import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { ManagerRecord } from '@/lib/competitive-edge/managerRecord'
import type { LeagueManagerRecords } from '@/lib/competitive-edge/managerRecordLoader'

/**
 * A leaguemate's record for Chimmy — "what does Mike usually do in trades?" (2026-11-16, re-score
 * item 11: Manager Psychology returns as FACTS ONLY, PAID, behind Competitive Edge).
 *
 * 🛑 THE CONTRACT GOES TO THE MODEL WITH THE FACTS. Every block says it: state the counts, never a
 * label for the person ("a shark", "RB-hungry", "a hoarder"), never what they will do next. The
 * retired profile engine sold labels; this sells evidence the user can check. The record is the one
 * the manager card and the commissioner's screen read (lib/competitive-edge/managerRecord.ts), so
 * Chimmy cannot describe a manager differently from them.
 *
 * Without the plan the model gets NO history. The refusal rides back as `locked`, and the executor puts
 * this tool on `proToolsRefused` — the chat's own "AF Pro adds …" line and upgrade button
 * (lib/chimmy/answerPolish.ts), the same path every AF Pro tool's refusal takes, iOS rules included.
 */

export type ManagerRecordContext = {
  text: string
  /** The plan does not include Competitive Edge — the chat shows its AF Pro line and button. */
  locked: boolean
}

export type ManagerRecordDeps = {
  access: (userId: string) => Promise<CoreDepthAccess>
  load: (input: { leagueId: string; userId: string }) => Promise<SectionState<LeagueManagerRecords>>
}

const CONTRACT =
  'FACTS ONLY. Quote these counts as they are. Never label the manager (no "shark", "buyer", "hoarder", "aggressive", "likes X"), never say what they will do or accept next, and never fill a missing section from your own knowledge — a section that says it could not be read means you do not know.'

async function defaultDeps(): Promise<ManagerRecordDeps> {
  const [{ resolveCoreDepth }, { loadLeagueManagerRecords }] = await Promise.all([
    import('@/lib/core-app/corePaywall'),
    import('@/lib/competitive-edge/managerRecordLoader'),
  ])
  return {
    access: (userId) => resolveCoreDepth(userId, 'competitive_edge'),
    load: (input) => loadLeagueManagerRecords(input),
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The managers a name points at — exact first, then a whole-word match, then a substring. Several
 * matches are returned as several, never guessed between.
 */
export function matchManagers(records: ManagerRecord[], teamNames: Map<string, string[]>, query: string): ManagerRecord[] {
  const q = norm(query)
  if (!q) return []
  const names = (r: ManagerRecord) => [r.manager.name, ...(teamNames.get(r.manager.teamExternalId) ?? [])].map(norm)
  const exact = records.filter((r) => names(r).includes(q))
  if (exact.length) return exact
  const word = records.filter((r) => names(r).some((n) => n.split(' ').includes(q)))
  if (word.length) return word
  return records.filter((r) => names(r).some((n) => n.includes(q)))
}

function section<T>(label: string, s: SectionState<T>, lines: (d: T) => string[]): string {
  return s.available ? `${label}: ${lines(s.data).join(' ')}` : `${label}: could not be read — ${s.reason}`
}

/** One manager's whole record, as the lines the model may quote. */
export function renderManagerRecord(r: ManagerRecord): string {
  const parts = [
    section('Trades', r.trades, (d) => [
      ...d.facts.map((f) => f.text),
      ...(d.coverage.shortfall ? [d.coverage.shortfall] : []),
      ...(d.coverage.stale ? ['(This trade history may be out of date.)'] : []),
    ]),
    section('Waivers', r.waivers, (d) => [...d.facts.map((f) => f.text), ...(d.stale ? ['(This waiver history may be out of date.)'] : [])]),
    section('Drafts', r.drafts, (d) => [
      ...d.facts.map((f) => f.text),
      ...(d.unattributedSeasons.length
        ? [`Picks from ${d.unattributedSeasons.join(', ')} are not matched to managers yet, so the draft count may be low.`]
        : []),
    ]),
  ]
  return `${r.manager.name} — ${parts.join(' | ')}`
}

/** The league in one line per manager — for "who trades the most here". Volume lines only. */
function renderLeagueSummary(records: ManagerRecord[]): string {
  return records
    .map((r) => {
      const trades = r.trades.available ? `${r.trades.data.coverage.trades} trades` : 'trades unknown'
      const claims = r.waivers.available ? `${r.waivers.data.claims} waiver claims this season` : 'waivers unknown'
      const faab = r.waivers.available && r.waivers.data.faabRemaining != null ? `, $${r.waivers.data.faabRemaining} FAAB left` : ''
      const drafts = r.drafts.available ? `${r.drafts.data.drafts} drafts on file` : 'drafts unknown'
      return `${r.manager.name}: ${trades}, ${claims}${faab}, ${drafts}`
    })
    .join('; ')
}

export async function buildManagerRecordContext(
  args: { leagueId: string; userId: string; manager?: string | null },
  deps: Partial<ManagerRecordDeps> = {},
): Promise<ManagerRecordContext> {
  const d: ManagerRecordDeps = { ...(await defaultDeps()), ...deps }

  const access = await d.access(args.userId).catch(() => null)
  if (!access) {
    return { text: 'MANAGER RECORD: the plan check failed just now. Do not describe any manager’s history; say it could not be checked.', locked: false }
  }
  if (!access.unlocked) {
    return {
      text:
        "NOT RUN: a leaguemate's trade, waiver and draft history is part of Competitive Edge, which this user's plan does not include. " +
        'Do NOT mention the plan, upgrading or this tool: a line naming it, with an upgrade button, is shown under your answer automatically. ' +
        "Do NOT describe, estimate or characterise any manager's history or habits. Answer from public league facts other tools return (standings, records, rosters).",
      locked: true,
    }
  }

  const read = await d.load({ leagueId: args.leagueId, userId: args.userId }).catch(() => null)
  if (!read) return { text: 'MANAGER RECORD: the league’s manager history could not be read just now. Do not describe any manager’s history.', locked: false }
  if (!read.available) return { text: `MANAGER RECORD: not available — ${read.reason} Do not describe any manager’s history.`, locked: false }

  const { records } = read.data
  if (records.length === 0) return { text: 'MANAGER RECORD: no other managers are on file for this league.', locked: false }

  const query = args.manager?.trim()
  if (!query) {
    return {
      text: `MANAGER RECORDS — every other manager in ${read.data.league.name ?? 'this league'} (ask about one by name for their full record). ${CONTRACT}\n${renderLeagueSummary(records)}`,
      locked: false,
    }
  }

  const hits = matchManagers(records, new Map(), query)
  if (hits.length === 0) {
    return {
      text: `MANAGER RECORD: no manager in this league matches "${query}". The managers are: ${records.map((r) => r.manager.name).join(', ')}. Ask which one they mean.`,
      locked: false,
    }
  }
  if (hits.length > 1) {
    return {
      text: `MANAGER RECORD: "${query}" matches more than one manager (${hits.map((r) => r.manager.name).join(', ')}). Ask which one they mean; do not guess.`,
      locked: false,
    }
  }
  return { text: `MANAGER RECORD (facts only). ${CONTRACT}\n${renderManagerRecord(hits[0]!)}`, locked: false }
}
