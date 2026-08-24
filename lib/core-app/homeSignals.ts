/**
 * What the /core home is telling the user right now, in a form Chimmy can be
 * grounded on.
 *
 * ⚠ WHY THIS IS IDS AND COUNTS, NOT SENTENCES. The obvious version hands the
 * chat the brief's own prose. It must not: @chimmy answers in the league tab
 * are posted publicly to everyone in that league, so any free text this
 * endpoint accepts from a client is text a user could author and have the model
 * repeat under our name. League names are provider strings too, so even those
 * do not cross the wire.
 *
 * What crosses is a validated id list and two integers. The server looks the
 * names up itself, from leagues it has already confirmed belong to the caller,
 * and composes the grounding sentence from its own words. The model therefore
 * sees only text this codebase wrote.
 *
 * ⚠ CLIENT-SAFE: no 'server-only', no prisma. CommsDrawer is a client
 * component and imports the type and the serializer; importing anything
 * server-only from a 'use client' file 500s the whole /core catch-all.
 */

/** Ids are capped hard: this is grounding, not a report. */
export const HOME_SIGNAL_ID_CAP = 5
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export type HomeSignals = {
  /** Leagues where a starter is ruled out. */
  urgent: string[]
  /** Leagues whose draft is live right now. */
  drafting: string[]
  /** Size of the unified issues queue the home is rendering. */
  openIssues: number
}

/**
 * Built from the SAME dash34 facts that feed the brief and the issues queue —
 * `priority: 'urgent'` (a starter ruled out) and `priority: 'draft'` (on the
 * clock now) — so the assistant cannot disagree with the screen it was opened
 * from. Type-only import: this file stays client-safe.
 */
export function buildHomeSignals(
  dash34: { allLeagues?: Dash34LeagueLike[]; leagues?: Dash34LeagueLike[] } | null,
  openIssues: number,
): HomeSignals | null {
  if (!dash34) return null
  const ranked = dash34.allLeagues ?? dash34.leagues ?? []
  const urgent: string[] = []
  const drafting: string[] = []
  for (const l of ranked) {
    if (!l?.id) continue
    if (l.priority === 'urgent' && urgent.length < HOME_SIGNAL_ID_CAP) urgent.push(l.id)
    else if (l.priority === 'draft' && drafting.length < HOME_SIGNAL_ID_CAP) drafting.push(l.id)
  }
  const signals: HomeSignals = { urgent, drafting, openIssues: Math.max(0, openIssues) }
  if (urgent.length === 0 && drafting.length === 0 && signals.openIssues === 0) return null
  return signals
}

type Dash34LeagueLike = { id: string; priority?: string | null }

export function serializeHomeSignals(signals: HomeSignals | null): string | null {
  if (!signals) return null
  if (signals.urgent.length === 0 && signals.drafting.length === 0 && signals.openIssues === 0) {
    return null
  }
  return JSON.stringify(signals)
}

/**
 * Parse and sanitise what a client sent. Anything unexpected degrades to null
 * rather than throwing — a malformed signal must never fail someone's question.
 */
export function parseHomeSignals(raw: unknown): HomeSignals | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  const ids = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === 'string' && ID_PATTERN.test(v))
          .slice(0, HOME_SIGNAL_ID_CAP)
      : []

  const openIssuesRaw = obj.openIssues
  const openIssues =
    typeof openIssuesRaw === 'number' && Number.isFinite(openIssuesRaw)
      ? Math.max(0, Math.min(999, Math.trunc(openIssuesRaw)))
      : 0

  const signals: HomeSignals = {
    urgent: ids(obj.urgent),
    drafting: ids(obj.drafting),
    openIssues,
  }
  if (signals.urgent.length === 0 && signals.drafting.length === 0 && signals.openIssues === 0) {
    return null
  }
  return signals
}

/**
 * The grounding block, composed from OUR words plus names the caller has
 * already been confirmed to hold. `nameById` covers only leagues the server
 * resolved; an id it could not resolve is dropped rather than printed raw.
 */
export function renderHomeSignalsPrompt(
  signals: HomeSignals,
  nameById: Map<string, string>,
): string | null {
  const named = (list: string[]): string[] =>
    list.map((id) => nameById.get(id)).filter((n): n is string => typeof n === 'string' && n.length > 0)

  const urgentNames = named(signals.urgent)
  const draftingNames = named(signals.drafting)
  const lines: string[] = []

  if (signals.urgent.length > 0) {
    lines.push(
      urgentNames.length > 0
        ? `${signals.urgent.length} league(s) have a starter who cannot play: ${urgentNames.join(', ')}.`
        : `${signals.urgent.length} league(s) have a starter who cannot play.`,
    )
  }
  if (signals.drafting.length > 0) {
    lines.push(
      draftingNames.length > 0
        ? `${signals.drafting.length} draft(s) are live right now: ${draftingNames.join(', ')}.`
        : `${signals.drafting.length} draft(s) are live right now.`,
    )
  }
  if (signals.openIssues > 0) {
    lines.push(`${signals.openIssues} item(s) are sitting in their queue of things needing a decision.`)
  }
  if (lines.length === 0) return null

  return [
    "## WHAT THIS USER'S HOME SCREEN IS SHOWING THEM RIGHT NOW",
    ...lines,
    'These are facts AllFantasy has already put on their screen from data on file. Do not contradict them, and when the user asks a follow-up such as "which lineup?" answer from this list rather than re-deriving it.',
  ].join('\n')
}
