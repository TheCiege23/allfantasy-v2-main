/**
 * The weekly guillotine recap posted to league chat after each chop.
 *
 * TWO VERSIONS, ON PURPOSE:
 *  - AUTOMATIC, DETERMINISTIC. Built from the week's own period scores right after the chop and
 *    posted for every guillotine league: who was chopped and by how much, the top scorer, the
 *    narrowest escape, how many remain, and when the next chop and waiver run land. No model call,
 *    so it costs nothing and cannot invent anything.
 *  - AI-WRITTEN, ON REQUEST. The same facts turned into a short story by a model, posted only when
 *    a commissioner asks for it (POST /api/leagues/:id/guillotine/ai `{ type: 'recap', postToChat }`).
 *    scripts/cron-tier.mjs records the product rule this follows: AI generation is user-initiated,
 *    never cron-seeded, because a scheduled generation spends tokens on output nobody asked for.
 *
 * Both are idempotent per league, season, week and kind through the chat row id, so a retried chop
 * or a double-tapped button posts once.
 *
 * ⚠ The old (deleted) `guillotineChatPoster.postGuillotineWeeklyRecap`, never called, wrote `userId: 'system'`,
 * which is not an AppUser, so every post would have failed. This uses the same author as the chop
 * announcement: the league owner, tagged as a host announcement (see ./guillotineChat.ts).
 */

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { UNKNOWN_MANAGER_NAME } from '@/lib/commissioner-managers/managerNames'
import { routeTextCall } from '@/lib/ai/providerRouter'
import { resolveRosterDisplayNames } from './rosterDisplayNames'
import { getGuillotineSportConfig } from './sportConfig'

export type RecapTeam = { rosterId: string; name: string; points: number }

export type GuillotineWeekFacts = {
  week: number
  chopped: RecapTeam[]
  /** Highest score among teams still alive. */
  topScorer: RecapTeam | null
  /** The lowest-scoring survivor and how far above the highest chopped score they finished. */
  narrowestEscape: (RecapTeam & { margin: number }) | null
  teamsRemaining: number
  chopLabel: string | null
  waiverLabel: string | null
}

type ScoreRow = { rosterId: string; periodPoints: number }

const round1 = (n: number) => Math.round(n * 10) / 10
const pts = (n: number) => `${round1(n).toFixed(1)}`

/** Pure: facts from a week's scores and who was chopped. Teams with no score row are not counted. */
export function computeGuillotineWeekFacts(args: {
  week: number
  scores: readonly ScoreRow[]
  choppedRosterIds: readonly string[]
  names: ReadonlyMap<string, string>
  sport: string | null
}): GuillotineWeekFacts {
  const chopped = new Set(args.choppedRosterIds)
  const named = (row: ScoreRow): RecapTeam => ({
    rosterId: row.rosterId,
    name: args.names.get(row.rosterId) ?? UNKNOWN_MANAGER_NAME,
    points: Number.isFinite(row.periodPoints) ? row.periodPoints : 0,
  })
  const choppedTeams = args.scores.filter((s) => chopped.has(s.rosterId)).map(named).sort((a, b) => a.points - b.points)
  // A chopped roster with no score row still has to be named.
  for (const id of args.choppedRosterIds) {
    if (!choppedTeams.some((t) => t.rosterId === id)) {
      choppedTeams.push({ rosterId: id, name: args.names.get(id) ?? UNKNOWN_MANAGER_NAME, points: 0 })
    }
  }
  const survivors = args.scores.filter((s) => !chopped.has(s.rosterId)).map(named)
  const byPointsDesc = [...survivors].sort((a, b) => b.points - a.points)
  const lowestSurvivor = byPointsDesc[byPointsDesc.length - 1] ?? null
  const highestChopped = choppedTeams.reduce<number | null>((max, t) => (max == null || t.points > max ? t.points : max), null)
  const profile = args.sport ? getGuillotineSportConfig(args.sport) : undefined
  return {
    week: args.week,
    chopped: choppedTeams,
    topScorer: byPointsDesc[0] ?? null,
    narrowestEscape:
      lowestSurvivor && highestChopped != null ? { ...lowestSurvivor, margin: round1(lowestSurvivor.points - highestChopped) } : null,
    teamsRemaining: survivors.length,
    chopLabel: profile?.chopLabel ?? null,
    waiverLabel: profile?.waiverLabel ?? null,
  }
}

/** Pure: the automatic recap's text. */
export function renderGuillotineRecap(f: GuillotineWeekFacts): string {
  const lines = [`🪓 Week ${f.week} recap`]
  if (f.chopped.length > 0) {
    lines.push(`Chopped: ${f.chopped.map((t) => `${t.name} (${pts(t.points)})`).join(', ')}.`)
  } else {
    lines.push('No one was chopped this week.')
  }
  if (f.narrowestEscape && f.chopped.length > 0) {
    lines.push(`Closest call: ${f.narrowestEscape.name} survived with ${pts(f.narrowestEscape.points)} — ${pts(f.narrowestEscape.margin)} above the blade.`)
  }
  if (f.topScorer) lines.push(`Top scorer: ${f.topScorer.name} (${pts(f.topScorer.points)}).`)
  lines.push(`${f.teamsRemaining} ${f.teamsRemaining === 1 ? 'team remains' : 'teams remain'}.`)
  if (f.chopped.length > 0 && f.waiverLabel) lines.push(`The chopped roster${f.chopped.length > 1 ? 's go' : ' goes'} to waivers — bids settle ${f.waiverLabel}.`)
  if (f.teamsRemaining > 1 && f.chopLabel) lines.push(`Next chop: ${f.chopLabel.replace(/^By /, 'by ')}.`)
  return lines.join('\n')
}

/** The facts for a week, read from the database (the AI path, which runs after the chop). */
export async function loadGuillotineWeekFacts(leagueId: string, week: number): Promise<GuillotineWeekFacts | null> {
  const [league, scores, states] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }),
    prisma.guillotinePeriodScore.findMany({ where: { leagueId, weekOrPeriod: week }, select: { rosterId: true, periodPoints: true } }),
    prisma.guillotineRosterState.findMany({ where: { leagueId, choppedInPeriod: week }, select: { rosterId: true } }),
  ])
  if (!league || scores.length === 0) return null
  const chopped = states.map((s) => s.rosterId)
  const names = await resolveRosterDisplayNames(leagueId, [...scores.map((s) => s.rosterId), ...chopped])
  return computeGuillotineWeekFacts({ week, scores, choppedRosterIds: chopped, names, sport: String(league.sport) })
}

/** The most recent week with a chop, from the roster states the elimination engine writes. */
export async function latestChoppedWeek(leagueId: string): Promise<number | null> {
  const row = await prisma.guillotineRosterState.findFirst({
    where: { leagueId, choppedInPeriod: { not: null } },
    orderBy: { choppedInPeriod: 'desc' },
    select: { choppedInPeriod: true },
  })
  return row?.choppedInPeriod ?? null
}

function recapMessageId(leagueId: string, season: number | null | undefined, week: number, kind: 'auto' | 'ai'): string {
  return `guillotine-recap:${leagueId}:${season ?? 'na'}:w${week}:${kind}`
}

/**
 * Post the automatic recap. Called by the elimination engine right after the chop announcement;
 * best-effort there (a failed recap must never fail a chop). Returns false when it was already posted.
 */
export async function postAutomaticGuillotineRecap(args: {
  leagueId: string
  week: number
  season?: number | null
  scores: readonly ScoreRow[]
  choppedRosterIds: readonly string[]
  authorUserId: string
}): Promise<boolean> {
  const [league, names] = await Promise.all([
    prisma.league.findUnique({ where: { id: args.leagueId }, select: { sport: true } }),
    resolveRosterDisplayNames(args.leagueId, [...args.scores.map((s) => s.rosterId), ...args.choppedRosterIds]),
  ])
  const facts = computeGuillotineWeekFacts({
    week: args.week,
    scores: args.scores,
    choppedRosterIds: args.choppedRosterIds,
    names,
    sport: league?.sport ? String(league.sport) : null,
  })
  const created = await createLeagueChatMessage(args.leagueId, args.authorUserId, renderGuillotineRecap(facts), {
    idempotencyKey: recapMessageId(args.leagueId, args.season, args.week, 'auto'),
    type: 'host_announcement',
    metadata: { senderIsHost: true, contentType: 'guillotine_recap', guillotineRecap: true, weekOrPeriod: args.week, recapKind: 'auto' },
  })
  return created != null
}

const AI_SYSTEM = `You write the weekly recap for a fantasy "guillotine" league, where the lowest scorer each week is eliminated ("chopped").
Rules:
- Use ONLY the facts given. Never invent players, scores, trades, injuries or events.
- Use the team names exactly as given. Never mention anyone not listed.
- 90 to 150 words, plain prose, no headings or bullet points, no hashtags.
- Dramatic and fun, never insulting or personal about the managers themselves.`

function factsForPrompt(f: GuillotineWeekFacts): string {
  return [
    `Week: ${f.week}`,
    `Chopped: ${f.chopped.length ? f.chopped.map((t) => `${t.name} with ${pts(t.points)} points`).join('; ') : 'nobody'}`,
    f.narrowestEscape && f.chopped.length ? `Closest escape: ${f.narrowestEscape.name} with ${pts(f.narrowestEscape.points)}, ${pts(f.narrowestEscape.margin)} points above the chopped team` : null,
    f.topScorer ? `Top scorer: ${f.topScorer.name} with ${pts(f.topScorer.points)}` : null,
    `Teams remaining: ${f.teamsRemaining}`,
    f.chopLabel ? `Next chop: ${f.chopLabel}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * A cheap sanity check, not a fact-checker: the text must be non-empty and name at least one team
 * from this week. It catches an empty, refused or off-topic reply; it cannot catch an invented
 * name, which is what the system prompt is for.
 */
function mentionsAKnownTeam(text: string, f: GuillotineWeekFacts): boolean {
  if (!text.trim()) return false
  const known = [...f.chopped, f.topScorer, f.narrowestEscape].filter(Boolean).map((t) => t!.name)
  return known.some((name) => text.includes(name))
}

export type AiRecapResult =
  | { ok: true; posted: boolean; text: string; aiWritten: boolean; week: number }
  | { ok: false; status: 404 | 409; error: string }

/**
 * Commissioner-requested AI recap for the latest chopped week (or `week`). Posts to league chat
 * once per week; if the model is unavailable or its text fails the check, posts the deterministic
 * recap instead and says so in `aiWritten`. Caller is responsible for the commissioner and plan checks.
 */
export async function postAiGuillotineRecap(args: {
  leagueId: string
  userId: string
  week?: number | null
}): Promise<AiRecapResult> {
  const week = args.week ?? (await latestChoppedWeek(args.leagueId))
  if (week == null) return { ok: false, status: 409, error: 'There is no chop to recap yet. The first recap is available after the first chop.' }
  const facts = await loadGuillotineWeekFacts(args.leagueId, week)
  if (!facts) return { ok: false, status: 404, error: `No scores were found for week ${week}.` }

  const result = await routeTextCall({
    messages: [
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: factsForPrompt(facts) },
    ],
    maxTokens: 320,
    temperature: 0.7,
    profile: 'cheap',
    feature: 'guillotine_weekly_recap',
    userId: args.userId,
    leagueId: args.leagueId,
  }).catch(() => ({ ok: false as const }))

  const aiWritten = result.ok && mentionsAKnownTeam(result.text, facts)
  const text = aiWritten && result.ok ? `🪓 Week ${week} recap\n${result.text.trim()}` : renderGuillotineRecap(facts)

  const season = await prisma.guillotineSeason
    .findFirst({ where: { leagueId: args.leagueId }, orderBy: { createdAt: 'desc' }, select: { season: true } })
    .catch(() => null)
  const created = await createLeagueChatMessage(args.leagueId, args.userId, text, {
    idempotencyKey: recapMessageId(args.leagueId, season?.season ?? null, week, 'ai'),
    type: 'host_announcement',
    metadata: { senderIsHost: true, contentType: 'guillotine_recap', guillotineRecap: true, weekOrPeriod: week, recapKind: 'ai', aiWritten },
  })
  return { ok: true, posted: created != null, text, aiWritten, week }
}
