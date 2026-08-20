import "server-only"

// PRIVACY BOUNDARY: This module never reads chat data.
// Monitoring is based solely on on-field actions and trade data.

import Anthropic from "@anthropic-ai/sdk"
import type { LeagueSport, Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { normalizeToSupportedSport } from "@/lib/sport-scope"

import { notifyCommissionerOfFlag } from "./integrityNotifier"
import { COLLUSION_VALUE_GAP_PCT, normalizeSensitivity } from "./sensitivity"

export type CollusionEvidence = {
  tradeTransactionId: string
  team1: { rosterId: string; teamName: string; wins: number; losses: number }
  team2: { rosterId: string; teamName: string; wins: number; losses: number }
  assetsTeam1Gave: { name: string; position: string; estimatedValue: number }[]
  assetsTeam2Gave: { name: string; position: string; estimatedValue: number }[]
  team1TotalValue: number
  team2TotalValue: number
  valueDifferential: number
  valueDifferentialPct: number
  priorTradesBetweenPair: number
  isPlayoffContender: { team1: boolean; team2: boolean }
  redFlags: string[]
}

export type CollusionScanResult = {
  leagueId: string
  flags: {
    severity: "low" | "medium" | "high"
    confidence: number
    summary: string
    evidence: CollusionEvidence
  }[]
  scannedAt: string
}

type OfferPlayerPiece = { kind: "player"; name: string; position: string; externalId?: string }
type OfferPickPiece = { kind: "pick"; name: string; position: string; year: number; round: number }
type OfferPiece = OfferPlayerPiece | OfferPickPiece

function parseOffers(raw: unknown): OfferPiece[] {
  if (!Array.isArray(raw)) return []
  const out: OfferPiece[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      const id = item.trim()
      if (!id) continue
      out.push({ kind: "player", name: id, position: "UNK", externalId: id })
      continue
    }
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    if (typeof o.type === "string" && o.type.toLowerCase() === "pick") {
      const year = typeof o.year === "number" ? o.year : typeof o.season === "number" ? o.season : new Date().getFullYear()
      const round = typeof o.round === "number" ? o.round : Number(o.round ?? 1)
      out.push({
        kind: "pick",
        name: `Pick ${year} R${round}`,
        position: "PICK",
        year,
        round: Number.isFinite(round) ? round : 1,
      })
      continue
    }
    const ext =
      typeof o.playerId === "string"
        ? o.playerId.trim()
        : typeof o.externalId === "string"
          ? o.externalId.trim()
          : typeof o.sleeperPlayerId === "string"
            ? o.sleeperPlayerId.trim()
            : undefined
    const name =
      (typeof o.playerName === "string" && o.playerName) ||
      (typeof o.name === "string" && o.name) ||
      (typeof o.player_name === "string" && o.player_name) ||
      ext ||
      ""
    if (!name) continue
    const position = typeof o.position === "string" ? o.position : "UNK"
    out.push({ kind: "player", name, position, externalId: ext })
  }
  return out
}

/** Trade value from ADP (lower ADP = higher fantasy value). No filesystem / hybrid-valuation deps. */
function estimatedValueFromAdp(adp: number | null | undefined): number {
  const a = typeof adp === "number" && Number.isFinite(adp) ? adp : 220
  return Math.max(5, Math.round(4000 / Math.sqrt(Math.max(a, 0.5))))
}

function pickHeuristicValue(year: number, round: number): number {
  const r = Math.min(Math.max(round, 1), 16)
  const yrBoost = year >= new Date().getFullYear() ? 1 : 0.92
  return Math.max(8, Math.round((17 - r) * 14 * yrBoost))
}

function dedupeSportsPlayersByExternalId<T extends { externalId: string; fetchedAt: Date }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const r of rows) {
    const prev = m.get(r.externalId)
    if (!prev || r.fetchedAt > prev.fetchedAt) m.set(r.externalId, r)
  }
  return m
}

async function valueOffers(
  leagueSport: LeagueSport,
  pieces: OfferPiece[],
): Promise<{ name: string; position: string; estimatedValue: number }[]> {
  const sportStr = String(leagueSport)
  const recSport = normalizeToSupportedSport(sportStr)

  const rows: { name: string; position: string; estimatedValue: number }[] = []

  const playerPieces = pieces.filter((p): p is OfferPlayerPiece => p.kind === "player")
  const pickPieces = pieces.filter((p): p is OfferPickPiece => p.kind === "pick")

  for (const p of pickPieces) {
    rows.push({
      name: p.name,
      position: "PICK",
      estimatedValue: pickHeuristicValue(p.year, p.round),
    })
  }

  const externalIds = [...new Set(playerPieces.map((x) => x.externalId).filter(Boolean) as string[])]
  const nameHints = [...new Set(playerPieces.filter((x) => !x.externalId && x.name?.trim()).map((x) => x.name.trim()))]

  const spFetched =
    externalIds.length > 0
      ? await prisma.sportsPlayer.findMany({
          where: { sport: sportStr, externalId: { in: externalIds } },
          select: { externalId: true, name: true, position: true, fetchedAt: true, sleeperId: true },
        })
      : []

  const byExt = dedupeSportsPlayersByExternalId(spFetched)

  const nameFetched =
    nameHints.length > 0
      ? await prisma.sportsPlayer.findMany({
          where: {
            sport: sportStr,
            OR: nameHints.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })),
          },
          select: { externalId: true, name: true, position: true, fetchedAt: true, sleeperId: true },
          orderBy: { fetchedAt: "desc" },
        })
      : []

  const byNameLower = new Map<string, (typeof nameFetched)[0]>()
  for (const r of nameFetched) {
    const k = r.name.trim().toLowerCase()
    if (!byNameLower.has(k)) byNameLower.set(k, r)
  }

  /*
   * ⚠ THE ADP JOIN NEEDS THE `${sport}:` PREFIX, AND WITHOUT IT NOTHING EVER
   * MATCHED. `SportsPlayer.externalId` and `SportsPlayerRecord.id` are written in
   * the same loop of `lib/sleeper/SleeperPlayerSeedService.ts` from the same
   * source id, in two different shapes:
   *
   *     SportsPlayer.externalId  = player.playerId            -> "4017"
   *     SportsPlayerRecord.id    = `${sport}:${player.playerId}` -> "NFL:4017"
   *
   * This function looked records up by the bare externalId, so the query matched
   * zero rows — measured: 0 hits across a 4,000-id sample. Every player therefore
   * fell through to `estimatedValueFromAdp(undefined)`, which is a flat 270 for
   * everyone. A player-for-player trade valued out exactly even no matter who was
   * in it, `valueDifferentialPct` was always 0, and the engine could not flag a
   * lopsided trade at all. Only pick-bearing trades ever produced a differential,
   * which is why `integrity_flags` is empty in production.
   *
   * The canonical key is the SLEEPER id, not the externalId: externalId also
   * carries already-prefixed shapes from other importers (`sleeper:13599`,
   * `tsdb_...`), which would build a nonsense `NFL:sleeper:13599`. So the sleeper
   * id is preferred and the bare externalId is only a fallback for rows that have
   * none.
   */
  const recordKeyFor = (row: { externalId: string; sleeperId?: string | null }): string | null => {
    const raw = row.sleeperId?.trim() || (/^[0-9]+$/.test(row.externalId) ? row.externalId : '')
    return raw ? `${String(recSport)}:${raw}` : null
  }

  const keyByExternalId = new Map<string, string>()
  for (const r of [...byExt.values(), ...nameFetched]) {
    const key = recordKeyFor(r)
    if (key) keyByExternalId.set(r.externalId, key)
  }

  const recordIds = [...new Set(keyByExternalId.values())]
  const recordRows =
    recordIds.length > 0
      ? await prisma.sportsPlayerRecord.findMany({
          where: { sport: String(recSport), id: { in: recordIds } },
          select: { id: true, adp: true },
        })
      : []
  const adpByRecordId = new Map(recordRows.map((r) => [r.id, r.adp]))

  for (const p of playerPieces) {
    let sp = p.externalId ? byExt.get(p.externalId) : undefined
    if (!sp && p.name?.trim()) {
      sp = byNameLower.get(p.name.trim().toLowerCase())
    }
    if (!sp && p.externalId) {
      const one = await prisma.sportsPlayer.findFirst({
        where: {
          sport: sportStr,
          OR: [{ externalId: p.externalId }, { sleeperId: p.externalId }],
        },
        select: { externalId: true, name: true, position: true, fetchedAt: true, sleeperId: true },
        orderBy: { fetchedAt: "desc" },
      })
      if (one) {
        sp = one
        // This late resolution missed the bulk key-building pass above, so register
        // its record key too — otherwise it silently falls back to the flat default.
        const key = recordKeyFor(one)
        if (key && !keyByExternalId.has(one.externalId)) {
          keyByExternalId.set(one.externalId, key)
          const late = await prisma.sportsPlayerRecord.findUnique({
            where: { id: key },
            select: { id: true, adp: true },
          })
          if (late) adpByRecordId.set(late.id, late.adp)
        }
      }
    }

    const playerKey = sp?.externalId ?? p.externalId
    const recordKey = playerKey ? keyByExternalId.get(playerKey) : undefined
    const adp = recordKey ? adpByRecordId.get(recordKey) : undefined
    const estimatedValue = sp ? estimatedValueFromAdp(adp) : 45

    rows.push({
      name: sp?.name ?? p.name,
      position: sp?.position ?? p.position,
      estimatedValue,
    })
  }

  return rows
}

function sumValues(rows: { estimatedValue: number }[]): number {
  return rows.reduce((a, b) => a + b.estimatedValue, 0)
}

function playoffContender(wins: number, losses: number, playoffWeek: number | null | undefined): boolean {
  const total = wins + losses
  if (total < 3) return true
  if (playoffWeek != null && total >= playoffWeek - 1) {
    return wins >= Math.ceil((playoffWeek - 1) * 0.45)
  }
  return wins >= 6
}

async function runClaudeCollusionPrompt(payload: {
  leagueId: string
  evidence: CollusionEvidence
}): Promise<{
  verdict: "clean" | "suspicious" | "likely_collusion"
  confidence: number
  severity: "low" | "medium" | "high"
  summary: string
  redFlags: string[]
} | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return null

  /*
   * ⚠ EVERYTHING FROM HERE IS INSIDE ONE try/catch, AND IT USED NOT TO BE. The
   * `client.messages.create()` call was unguarded — only the trailing
   * `JSON.parse` had a catch — so ANY API failure (auth, rate limit, network, a
   * retired model id) propagated out of this helper, out of
   * `scanTradeForCollusion`, and aborted the whole scan.
   *
   * That is not hypothetical: measured 2026-08-20, the model id below returns
   * `404 not_found_error: model: claude-sonnet-4-20250514`. With an
   * ANTHROPIC_API_KEY configured, every collusion scan therefore threw, every
   * time. This helper is explicitly optional — the caller already falls back to
   * a deterministic verdict when it returns null — so a failure here must
   * degrade to that path, never take the scan down with it.
   */
  try {
  const client = new Anthropic({ apiKey: key })
  const user = `League: ${payload.leagueId}. Trade analysis:
Team1 (${payload.evidence.team1.wins}-${payload.evidence.team1.losses}, playoff contender: ${payload.evidence.isPlayoffContender.team1}) gives: ${JSON.stringify(payload.evidence.assetsTeam1Gave)}
Team2 (${payload.evidence.team2.wins}-${payload.evidence.team2.losses}, playoff contender: ${payload.evidence.isPlayoffContender.team2}) gives: ${JSON.stringify(payload.evidence.assetsTeam2Gave)}
Value differential: ${payload.evidence.valueDifferentialPct.toFixed(1)}%
Prior trades between these managers this season: ${payload.evidence.priorTradesBetweenPair}
Analyze for collusion using ONLY this data.`

  const res = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: `You are an anti-collusion AI for fantasy sports leagues.
You analyze trades using ONLY on-field data — never chat messages.
Respond ONLY with JSON: {
  "verdict": "clean" | "suspicious" | "likely_collusion",
  "confidence": 0.0,
  "severity": "low" | "medium" | "high",
  "summary": "plain English",
  "redFlags": ["..."]
}`,
    messages: [{ role: "user", content: user }],
  })

  const text = res.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") return null
  const raw = text.text.trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  return JSON.parse(jsonMatch[0]) as {
    verdict: "clean" | "suspicious" | "likely_collusion"
    confidence: number
    severity: "low" | "medium" | "high"
    summary: string
    redFlags: string[]
  }
  } catch (err) {
    console.warn(
      "[integrity] collusion AI pass unavailable, falling back to deterministic scoring:",
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

export async function scanTradeForCollusion(leagueId: string, tradeTransactionId: string): Promise<CollusionScanResult> {
  const scannedAt = new Date().toISOString()
  /*
   * The commissioner's own sensitivity setting. Read here rather than assumed:
   * this row was written by the settings rail on every save since the table
   * existed, and until now nothing consumed it -- see lib/integrity/sensitivity.ts.
   * `medium` (the column default, and the value for every league that never
   * touched the control) resolves to the 35% gap this function used to hardcode,
   * so wiring it up is a no-op for anyone who has not deliberately moved it.
   */
  const settings = await prisma.leagueIntegritySettings.findUnique({ where: { leagueId } })
  const gapPct = COLLUSION_VALUE_GAP_PCT[normalizeSensitivity(settings?.collusionSensitivity)]
  const trade = await prisma.redraftLeagueTrade.findFirst({
    where: { id: tradeTransactionId, leagueId },
    include: {
      proposerRoster: true,
      receiverRoster: true,
      league: { select: { playoffStartWeek: true, sport: true } },
      season: true,
    },
  })

  if (!trade) {
    return { leagueId, flags: [], scannedAt }
  }

  const leagueSport = trade.league.sport

  const proposerPieces = parseOffers(trade.proposerOffers as unknown)
  const receiverPieces = parseOffers(trade.receiverOffers as unknown)
  const assetsTeam1Gave = await valueOffers(leagueSport, proposerPieces)
  const assetsTeam2Gave = await valueOffers(leagueSport, receiverPieces)

  const team1Total = sumValues(assetsTeam1Gave)
  const team2Total = sumValues(assetsTeam2Gave)
  const valueDifferential = Math.abs(team1Total - team2Total)
  const hi = Math.max(team1Total, team2Total, 1)
  const valueDifferentialPct = (valueDifferential / hi) * 100

  const prior = await prisma.redraftLeagueTrade.count({
    where: {
      leagueId,
      seasonId: trade.seasonId,
      id: { not: trade.id },
      status: { in: ["accepted", "completed"] },
      OR: [
        {
          proposerRosterId: trade.proposerRosterId,
          receiverRosterId: trade.receiverRosterId,
        },
        {
          proposerRosterId: trade.receiverRosterId,
          receiverRosterId: trade.proposerRosterId,
        },
      ],
    },
  })

  const pw = trade.league.playoffStartWeek ?? 14
  const t1 = trade.proposerRoster
  const t2 = trade.receiverRoster
  const evidence: CollusionEvidence = {
    tradeTransactionId: trade.id,
    team1: {
      rosterId: t1.id,
      teamName: t1.teamName?.trim() || t1.ownerName,
      wins: t1.wins,
      losses: t1.losses,
    },
    team2: {
      rosterId: t2.id,
      teamName: t2.teamName?.trim() || t2.ownerName,
      wins: t2.wins,
      losses: t2.losses,
    },
    assetsTeam1Gave,
    assetsTeam2Gave,
    team1TotalValue: team1Total,
    team2TotalValue: team2Total,
    valueDifferential,
    valueDifferentialPct,
    priorTradesBetweenPair: prior,
    isPlayoffContender: {
      team1: playoffContender(t1.wins, t1.losses, pw),
      team2: playoffContender(t2.wins, t2.losses, pw),
    },
    redFlags: [],
  }

  if (valueDifferentialPct >= 15 && team1Total !== team2Total) {
    evidence.redFlags.push(`Value differential ~${valueDifferentialPct.toFixed(0)}%`)
  }
  if (prior >= 2) evidence.redFlags.push("Repeated trades between same managers this season")

  const ai = await runClaudeCollusionPrompt({ leagueId, evidence })
  if (ai?.redFlags?.length) {
    evidence.redFlags = [...new Set([...evidence.redFlags, ...ai.redFlags])]
  }

  const verdict = ai?.verdict ?? (valueDifferentialPct >= gapPct ? "suspicious" : "clean")
  const confidence = ai?.confidence ?? (valueDifferentialPct >= gapPct ? 0.55 : 0.2)
  const severity = ai?.severity ?? (valueDifferentialPct >= 40 ? "high" : valueDifferentialPct >= 25 ? "medium" : "low")

  const flags: CollusionScanResult["flags"] = []
  if (verdict === "suspicious" || verdict === "likely_collusion") {
    const summary = ai?.summary ?? "Trade shows a large market value imbalance between sides."
    const existing = await prisma.integrityFlag.findFirst({
      where: { leagueId, tradeTransactionId: trade.id, status: "open" },
    })
    if (!existing) {
      const row = await prisma.integrityFlag.create({
        data: {
          leagueId,
          flagType: "collusion",
          severity,
          status: "open",
          affectedRosterIds: [t1.id, t2.id],
          affectedTeamNames: [evidence.team1.teamName, evidence.team2.teamName],
          summary,
          evidenceJson: evidence as unknown as Prisma.InputJsonValue,
          aiConfidence: confidence,
          tradeTransactionId: trade.id,
        },
      })
      await notifyCommissionerOfFlag(row.id)
    }
    flags.push({ severity, confidence, summary, evidence })
  }

  await prisma.leagueIntegritySettings.upsert({
    where: { leagueId },
    create: { leagueId, lastCollusionScanAt: new Date() },
    update: { lastCollusionScanAt: new Date() },
  })

  return { leagueId, flags, scannedAt }
}

export async function fullLeagueCollusionScan(leagueId: string): Promise<CollusionScanResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const trades = await prisma.redraftLeagueTrade.findMany({
    where: {
      leagueId,
      status: "accepted",
      createdAt: { gte: since },
    },
    select: { id: true },
  })

  const flags: CollusionScanResult["flags"] = []
  let scannedAt = new Date().toISOString()
  for (const t of trades) {
    const dup = await prisma.integrityFlag.findFirst({
      where: { leagueId, tradeTransactionId: t.id },
    })
    if (dup) continue
    const r = await scanTradeForCollusion(leagueId, t.id)
    scannedAt = r.scannedAt
    flags.push(...r.flags)
  }
  return { leagueId, flags, scannedAt }
}
