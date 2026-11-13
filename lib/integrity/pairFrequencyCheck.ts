import 'server-only'

// PRIVACY BOUNDARY: reads trade records only — never chat.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { notifyCommissionerOfFlag } from './integrityNotifier'
import { expectedLabel, pairFrequency, type PairFinding } from './tradeAudit'
import { readTradeValueAudits } from './tradeValueAudit'

/**
 * League-wide: two teams that trade with each other far more than the league's own trade volume
 * predicts (`pairFrequency`). The per-trade review only ever saw "this pair has traded before"; a pair
 * that trades every other week across a whole season was never named as a pattern.
 *
 * ⚠ INFORMATIONAL, NEVER AN ACCUSATION. Frequent partners are usually just two active managers. The
 * flag opens at `low`, carries no trade sides (so the card shows it without the escalate/dismiss
 * verdict row — `IntegrityFlagCard`'s build rule 3), and points the commissioner at the trade history
 * review, where each trade's value at the time is laid out. It is the review that can show a pattern
 * of value flowing one way; the count alone cannot.
 *
 * One open flag per pair (keyed `pair:<a>|<b>` in `tradeTransactionId`), updated as the count grows.
 */

const WINDOW_MS = 365 * 24 * 60 * 60 * 1000

function pairKey(f: Pick<PairFinding, 'teamIds'>): string {
  return `pair:${[...f.teamIds].sort().join('|')}`
}

function pairSummary(f: PairFinding): string {
  const lean =
    Math.abs(f.netShareToFirst) >= 0.15
      ? ` Value has run toward ${f.netShareToFirst > 0 ? f.names[0] : f.names[1]} across those trades.`
      : ' Value has been roughly even across those trades.'
  return `${f.names[0]} and ${f.names[1]} have traded ${f.count} times — the league's volume would predict ${expectedLabel(f.expected)}.${lean} Open their trade history review before deciding anything.`
}

export async function checkRepeatTradingPairs(leagueId: string, now: Date = new Date()): Promise<{ findings: PairFinding[] }> {
  const rows = await readTradeValueAudits(leagueId, { since: new Date(now.getTime() - WINDOW_MS) })
  if (rows.length === 0) return { findings: [] }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueSize: true } }).catch(() => null)
  const seen = new Set(rows.flatMap((r) => [r.sideATeamId, r.sideBTeamId]))
  const teamCount = Math.max(typeof league?.leagueSize === 'number' ? league.leagueSize : 0, seen.size)
  const findings = pairFrequency(rows, teamCount)

  for (const f of findings) {
    const key = pairKey(f)
    const evidence = {
      kind: 'pair_frequency',
      tradeTransactionId: key,
      team1: { rosterId: f.teamIds[0], teamName: f.names[0] },
      team2: { rosterId: f.teamIds[1], teamName: f.names[1] },
      pairTrades: f.count,
      expectedPairTrades: f.expected,
      tradesOutsideFairRange: f.outside,
      netShareToTeam1: f.netShareToFirst,
      redFlags: [
        `${f.count} trades between these two in the last year; an even spread would give ${expectedLabel(f.expected)}.`,
        ...(f.outside > 0 ? [`${f.outside} of them fell outside the fair range when they were made.`] : []),
      ],
      reviewModel: 'pair_frequency',
    }
    const open = await prisma.integrityFlag.findFirst({ where: { leagueId, tradeTransactionId: key, status: 'open' }, select: { id: true } })
    if (open) {
      await prisma.integrityFlag.update({ where: { id: open.id }, data: { summary: pairSummary(f), evidenceJson: evidence as unknown as Prisma.InputJsonValue } })
      continue
    }
    // A pair the commissioner already closed is reopened only when it has traded again since.
    const closed = await prisma.integrityFlag.findFirst({
      where: { leagueId, tradeTransactionId: key, status: { not: 'open' } },
      orderBy: { createdAt: 'desc' },
      select: { evidenceJson: true },
    })
    const closedCount = Number((closed?.evidenceJson as { pairTrades?: unknown } | null)?.pairTrades ?? 0)
    if (closed && closedCount >= f.count) continue
    const row = await prisma.integrityFlag.create({
      data: {
        leagueId,
        flagType: 'collusion',
        severity: 'low',
        status: 'open',
        affectedRosterIds: [...f.teamIds],
        affectedTeamNames: [...f.names],
        summary: pairSummary(f),
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        aiConfidence: 0,
        tradeTransactionId: key,
      },
    })
    await notifyCommissionerOfFlag(row.id).catch(() => {})
  }
  return { findings }
}
