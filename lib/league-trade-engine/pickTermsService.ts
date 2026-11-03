import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import type { TradeAssetInput } from './types'
import { isNativeFuturePickLeague, loadNativeFuturePicks, parseInventoryPickId } from './nativeFuturePicks'
import { CodedTradeError } from './redraftDraftPicks'
import {
  describeOutcome,
  describePickTerms,
  parsePickTerms,
  PICK_TERMS_KEY,
  readPickTermsEnabled,
  readPickTermsRecords,
  resolvePickTerms,
  type PickTerms,
  type PickTermsOutcome,
  type PickTermsRecord,
} from './pickTerms'

/**
 * Conditional and protected picks (./pickTerms.ts) against the league's rows: the check an offer
 * runs, the record a settled trade writes, the undo a reversed trade runs, the settlement when the
 * pick's rookie draft is created, and the Trades page, Chimmy and Commish OS reads.
 *
 * Storage, without a migration: an offer carries its terms on the trade item (`metadata.pickTerms`,
 * with an English `pickLabel` every history reader already shows); a settled trade writes the
 * record to `League.settings.pick_terms[<fdp id>]` with `jsonb_set` on that one key, inside the
 * trade's own transaction. Settling them is inside the draft's creation transaction.
 *
 * DB-first: nothing here calls a provider. Native dynasty leagues only.
 */

type Db = Prisma.TransactionClient

const loadLeague = (leagueId: string, db: Db = prisma) =>
  db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true, platform: true, leagueType: true, isDynasty: true, settings: true },
  })

async function teamNames(leagueId: string, db: Db = prisma): Promise<Map<string, string>> {
  const { seasonTeamsByRoster } = await import('@/lib/dispersal-draft/nativeDispersal')
  const [rosters, teamByRoster] = await Promise.all([
    db.roster.findMany({ where: { leagueId }, select: { id: true } }),
    seasonTeamsByRoster(db, leagueId),
  ])
  const teams = await db.redraftRoster.findMany({ where: { id: { in: [...teamByRoster.values()] } }, select: { id: true, teamName: true, ownerName: true } })
  const byTeam = new Map(teams.map((t) => [t.id, t.teamName?.trim() || t.ownerName || null]))
  return new Map(rosters.map((r, i) => [r.id, byTeam.get(teamByRoster.get(r.id) ?? '') ?? `Team ${i + 1}`]))
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────

async function writeRecord(db: Db, leagueId: string, pickId: string, record: PickTermsRecord | null): Promise<void> {
  if (record == null) {
    await db.$executeRaw`UPDATE leagues SET settings = settings #- ARRAY[${PICK_TERMS_KEY}, ${pickId}]::text[] WHERE id = ${leagueId} AND jsonb_typeof(settings) = 'object'`
    return
  }
  // The parent object is made first: `jsonb_set` creates only the last key of a path.
  await db.$executeRaw`
    UPDATE leagues SET settings = jsonb_set(
      jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, ARRAY[${PICK_TERMS_KEY}]::text[],
        COALESCE(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings -> ${PICK_TERMS_KEY} END, '{}'::jsonb)),
      ARRAY[${PICK_TERMS_KEY}, ${pickId}]::text[], ${JSON.stringify(record)}::jsonb)
    WHERE id = ${leagueId}`
}

// ── The offer ──────────────────────────────────────────────────────────────────────────────────────

const termsOf = (a: TradeAssetInput): unknown => (a.metadata && typeof a.metadata === 'object' ? (a.metadata as Record<string, unknown>).pickTerms : undefined)

/**
 * The offer's assets with any pick terms checked and stored in the shape the settlement reads, plus
 * an English label for every history reader. Throws `CodedTradeError` (its code reaches the client) for terms the league would not
 * settle. An offer without terms is returned untouched and costs no reads.
 */
export async function checkOfferPickTerms(leagueId: string, assets: TradeAssetInput[]): Promise<TradeAssetInput[]> {
  if (!assets.some((a) => termsOf(a) != null)) return assets
  const league = await loadLeague(leagueId)
  if (!league || !isNativeFuturePickLeague(league)) throw new CodedTradeError('PICK_TERMS_UNSUPPORTED', 'Pick terms are for dynasty leagues AllFantasy runs.')
  if (!readPickTermsEnabled(league.settings)) throw new CodedTradeError('PICK_TERMS_OFF', 'Conditional and protected picks are not on in this league.')
  if (!(await ownerHasAfCommissionerPlan(league.userId))) throw new CodedTradeError('PICK_TERMS_PLAN', 'Conditional and protected picks are part of the league owner’s AF Commissioner plan.')
  const [inventory, names] = await Promise.all([loadNativeFuturePicks(leagueId), teamNames(leagueId)])
  const records = readPickTermsRecords(league.settings)
  const rosterIds = new Set(names.keys())
  return assets.map((a) => {
    const raw = termsOf(a)
    if (raw == null) return a
    const ref = String(a.itemReference ?? '')
    const pick = parseInventoryPickId(ref)
    if (!pick || !inventory?.ownerByPickId.has(ref)) throw new CodedTradeError('PICK_TERMS_NOT_A_PICK', 'Only a future pick in this league can carry terms.')
    if (records[ref] && !records[ref]!.result) throw new CodedTradeError('PICK_TERMS_ALREADY', 'That pick already carries terms from an earlier trade; they travel with it until its draft.')
    const parsed = parsePickTerms(raw, { teamCount: rosterIds.size, rounds: inventory.rounds, rosterIds, pickRound: pick.round })
    if (!parsed.ok) throw new CodedTradeError('PICK_TERMS_INVALID', parsed.error)
    const label = `${pick.season} ${ordinal(pick.round)} (${names.get(pick.originalRosterId) ?? 'a team'}), ${describePickTerms(parsed.value, (id) => names.get(id) ?? 'a team', 'en', names.get(pick.originalRosterId) ?? 'the original team')}`
    return { ...a, metadata: { ...(a.metadata ?? {}), pickTerms: parsed.value, pickLabel: label } }
  })
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`

// ── The settled trade, and its undo ───────────────────────────────────────────────────────────────

/** Inside the trade's transaction, after its picks move: every pick it gave terms records them. */
export async function recordSettledPickTerms(tx: Db, input: { leagueId: string; assets: readonly TradeAssetInput[]; tradeId?: string | null; now?: Date }): Promise<void> {
  for (const a of input.assets) {
    const ref = String(a.itemReference ?? '')
    const terms = termsOf(a) as PickTerms | undefined
    if (!terms || !parseInventoryPickId(ref)) continue
    await writeRecord(tx, input.leagueId, ref, { terms, tradeId: input.tradeId ?? null, setAt: (input.now ?? new Date()).toISOString(), result: null })
  }
}

/** Inside a reversal's transaction: the terms this trade gave are taken back with the picks. */
export async function clearPickTermsForTrade(tx: Db, input: { leagueId: string; tradeId: string }): Promise<void> {
  const league = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
  for (const [pickId, rec] of Object.entries(readPickTermsRecords(league?.settings))) {
    if (rec.tradeId === input.tradeId && !rec.result) await writeRecord(tx, input.leagueId, pickId, null)
  }
}

// ── The draft ──────────────────────────────────────────────────────────────────────────────────────

type ActiveRow = { id: string; round: number; originalRosterId: string; currentOwnerId: string }

/** Draft roster ids of the season's playoff field, or null when it is not on file. */
async function loadPlayoffField(tx: Db, leagueId: string, season: number): Promise<Set<string> | null> {
  const s = await tx.redraftSeason.findFirst({ where: { leagueId, season }, select: { id: true } })
  if (!s) return null
  const seeds = await tx.redraftPlayoffSeed.findMany({ where: { seasonId: s.id }, select: { rosterId: true } })
  if (!seeds.length) return null
  const [teams, rosters] = await Promise.all([
    tx.redraftRoster.findMany({ where: { id: { in: seeds.map((x) => x.rosterId) } }, select: { ownerId: true } }),
    tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  // Imported lazily: the draft module imports this one's caller.
  const { draftRosterIdForOwner } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
  return new Set(teams.map((t) => draftRosterIdForOwner(t.ownerId, rosters)).filter((x): x is string => Boolean(x)))
}

export type DraftPickOverride = { skip: true } | { round: number }

/**
 * Inside `consumeNativeFuturePicksForDraft`: settle the terms of every traded pick in this draft.
 * Returns, per future_draft_picks row id, how its entry changes (skipped, or conveyed as another
 * round); rows not in the map convey as they are. A rolled-over protection moves next season's pick
 * here; every outcome is recorded on the pick's terms.
 */
export async function settlePickTermsForDraft(
  tx: Db,
  input: { leagueId: string; season: number; rows: readonly ActiveRow[]; slotOrder: ReadonlyArray<{ rosterId: string; slot?: number }>; rounds: number; draftSessionId: string; now: Date },
): Promise<Map<string, DraftPickOverride>> {
  const overrides = new Map<string, DraftPickOverride>()
  const league = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
  const records = readPickTermsRecords(league?.settings)
  const due = Object.entries(records).filter(([id, rec]) => !rec.result && parseInventoryPickId(id)?.season === input.season)
  if (!due.length) return overrides

  const ordered = [...input.slotOrder].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
  const slotOf = (rosterId: string) => {
    const i = ordered.findIndex((e) => e.rosterId === rosterId)
    return i < 0 ? null : i + 1
  }
  let playoff: Set<string> | null | undefined
  const rowFor = (round: number, original: string) => input.rows.find((r) => r.round === round && r.originalRosterId === original)
  const record = (pickId: string, rec: PickTermsRecord, outcome: PickTermsOutcome, extra: { note?: string | null; round?: number | null } = {}) =>
    writeRecord(tx, input.leagueId, pickId, { ...rec, result: { outcome, at: input.now.toISOString(), note: extra.note ?? null, round: extra.round ?? null } })

  for (const [pickId, rec] of due) {
    const pick = parseInventoryPickId(pickId)!
    const row = rowFor(pick.round, pick.originalRosterId)
    // No active row, or a row back with its original team: nothing traded to settle.
    if (!row || row.currentOwnerId === row.originalRosterId) {
      await record(pickId, rec, 'returned')
      continue
    }
    if (rec.terms.kind === 'conditional' && playoff === undefined) playoff = await loadPlayoffField(tx, input.leagueId, input.season - 1)
    const r = resolvePickTerms({ terms: rec.terms, slot: slotOf(pick.originalRosterId), playoffTeams: playoff ?? null })

    if (r.outcome === 'protected') {
      overrides.set(row.id, { skip: true })
      if (!r.rollsOver) {
        await record(pickId, rec, 'protected')
        continue
      }
      // The original team's same-round pick next season conveys instead, unprotected — if the
      // original team still holds it.
      const next = await tx.futureDraftPick.findUnique({
        where: { leagueId_pickSeason_round_originalRosterId: { leagueId: input.leagueId, pickSeason: input.season + 1, round: pick.round, originalRosterId: pick.originalRosterId } },
        select: { currentOwnerId: true, status: true },
      })
      if (next && (next.currentOwnerId !== pick.originalRosterId || next.status !== 'active')) {
        await record(pickId, rec, 'protected', { note: 'The rollover pick was no longer the original team’s to give.' })
        continue
      }
      const moved = { currentOwnerId: row.currentOwnerId, traded: true, status: 'active' as const, sourceTradeId: rec.tradeId, tradedAt: input.now }
      await tx.futureDraftPick.upsert({
        where: { leagueId_pickSeason_round_originalRosterId: { leagueId: input.leagueId, pickSeason: input.season + 1, round: pick.round, originalRosterId: pick.originalRosterId } },
        create: { leagueId: input.leagueId, pickSeason: input.season + 1, round: pick.round, originalRosterId: pick.originalRosterId, ...moved },
        update: moved,
      })
      await record(pickId, rec, 'protected_rolled_over', { round: pick.round })
      continue
    }
    if (r.outcome === 'did_not_convey') {
      overrides.set(row.id, { skip: true })
      await record(pickId, rec, 'did_not_convey')
      continue
    }
    if (r.outcome === 'became_round') {
      const swap = rowFor(r.round, pick.originalRosterId)
      const stillOriginal = !swap || swap.currentOwnerId === pick.originalRosterId
      if (r.round > input.rounds || !stillOriginal) {
        await record(pickId, rec, 'conveyed_unjudged', { note: r.round > input.rounds ? 'This draft has no such round.' : 'The original team no longer held that round’s pick.' })
        continue
      }
      overrides.set(row.id, { round: r.round })
      // The swapped-in pick is spent by this draft, row or no row.
      await tx.futureDraftPick.upsert({
        where: { leagueId_pickSeason_round_originalRosterId: { leagueId: input.leagueId, pickSeason: input.season, round: r.round, originalRosterId: pick.originalRosterId } },
        create: { leagueId: input.leagueId, pickSeason: input.season, round: r.round, originalRosterId: pick.originalRosterId, currentOwnerId: row.currentOwnerId, traded: true, status: 'used', usedInDraftSessionId: input.draftSessionId, usedAt: input.now, sourceTradeId: rec.tradeId },
        update: { currentOwnerId: row.currentOwnerId, traded: true, status: 'used', usedInDraftSessionId: input.draftSessionId, usedAt: input.now },
      })
      await record(pickId, rec, 'became_round', { round: r.round })
      continue
    }
    await record(pickId, rec, r.outcome === 'conveyed_unjudged' ? 'conveyed_unjudged' : r.outcome === 'condition_not_met' ? 'condition_not_met' : 'conveyed', { note: r.outcome === 'conveyed_unjudged' ? r.note : null })
  }
  return overrides
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────

export type PickTermsView =
  | { supported: false }
  | {
      supported: true
      enabled: boolean
      /** Switched on and the league owner holds AF Commissioner: an offer may carry terms. */
      active: boolean
      isCommissioner: boolean
      canEdit: boolean
      teams: { rosterId: string; name: string }[]
      rounds: number
      /** Every pick carrying terms, settled or not. */
      picks: { pickId: string; season: number; round: number; original: string; holder: string | null; terms: PickTerms; outcome: PickTermsOutcome | null; note: string | null; outcomeRound: number | null }[]
    }

export async function readPickTermsView(leagueId: string, userId: string): Promise<{ ok: true; view: PickTermsView } | { ok: false; status: 403 | 404 }> {
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404 }
  if (!isNativeFuturePickLeague(league)) return { ok: true, view: { supported: false } }
  const [commissioner, names, inventory] = await Promise.all([isElevatedCommissioner(leagueId, userId), teamNames(leagueId), loadNativeFuturePicks(leagueId)])
  const member = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  if (!commissioner && !member && !await acceptedCoOwnerRosterId(leagueId, userId)) return { ok: false, status: 403 }
  const [ownerPlan, viewerPlan] = await Promise.all([
    ownerHasAfCommissionerPlan(league.userId),
    commissioner ? prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } }).then(hasAfCommissionerPlan) : Promise.resolve(false),
  ])
  const enabled = readPickTermsEnabled(league.settings)
  const records = readPickTermsRecords(league.settings)
  return {
    ok: true,
    view: {
      supported: true,
      enabled,
      active: enabled && ownerPlan,
      isCommissioner: commissioner,
      canEdit: commissioner && viewerPlan,
      teams: [...names].map(([rosterId, name]) => ({ rosterId, name })),
      rounds: inventory?.rounds ?? 0,
      picks: Object.entries(records)
        .map(([pickId, rec]) => {
          const p = parseInventoryPickId(pickId)!
          const holder = inventory?.ownerByPickId.get(pickId)
          return {
            pickId,
            season: p.season,
            round: p.round,
            original: names.get(p.originalRosterId) ?? 'A team',
            holder: holder ? names.get(holder) ?? null : null,
            terms: rec.terms,
            outcome: rec.result?.outcome ?? null,
            note: rec.result?.note ?? null,
            outcomeRound: rec.result?.round ?? null,
          }
        })
        .sort((a, b) => a.season - b.season || a.round - b.round),
    },
  }
}

/** For Chimmy: the rule and every pick's terms, in plain English. */
export async function readPickTermsForChimmy(leagueId: string): Promise<string | null> {
  const league = await loadLeague(leagueId)
  if (!league || !isNativeFuturePickLeague(league)) return null
  const records = Object.entries(readPickTermsRecords(league.settings))
  const enabled = readPickTermsEnabled(league.settings)
  if (!enabled && !records.length) return null
  const names = await teamNames(leagueId)
  const name = (id: string) => names.get(id) ?? 'a team'
  const lines = records.map(([pickId, rec]) => {
    const p = parseInventoryPickId(pickId)!
    const done = describeOutcome(rec, 'en')
    return `${p.season} ${ordinal(p.round)} (${name(p.originalRosterId)}): ${describePickTerms(rec.terms, name, 'en', name(p.originalRosterId))}${done ? ` — ${done}` : ' — settled when that rookie draft is created'}`
  })
  const rule = enabled
    ? 'Conditional and protected picks are on: a future pick in a trade can be top-N protected (stays with the original team, or rolls to the next year) or conditional on a team making or missing the playoffs; terms are settled on the final draft order when the rookie draft is created (enforced).'
    : 'Conditional and protected picks are off for new trades; terms already agreed are still settled.'
  return lines.length ? `${rule} Picks with terms: ${lines.join('; ')}.` : rule
}

/** Commish OS: picks whose terms the next rookie draft will settle — the commissioner should know before creating it. */
export async function readPickTermsTasks(leagueId: string): Promise<WorkspaceTaskCandidate[]> {
  const league = await loadLeague(leagueId)
  if (!league || !isNativeFuturePickLeague(league)) return []
  const inventory = await loadNativeFuturePicks(leagueId)
  const next = inventory?.seasons[0]
  if (next == null) return []
  const due = Object.entries(readPickTermsRecords(league.settings)).filter(([id, rec]) => !rec.result && parseInventoryPickId(id)?.season === next)
  if (!due.length) return []
  const names = await teamNames(leagueId)
  const name = (id: string) => names.get(id) ?? 'a team'
  const lines = due.map(([id, rec]) => {
    const p = parseInventoryPickId(id)!
    return `${ordinal(p.round)} (${name(p.originalRosterId)}): ${describePickTerms(rec.terms, name, 'en', name(p.originalRosterId))}`
  })
  return [
    {
      sourceKey: `pick-terms-due:${next}:${due.map(([id]) => id).sort().join(',')}:v1`,
      title: due.length === 1 ? `A ${next} pick carries terms` : `${due.length} ${next} picks carry terms`,
      description: `${lines.join('; ')}. They are settled on the final order when the ${next} rookie draft is created, so set that order first.`,
      priority: 'standard',
      automationCandidate: false,
      relatedLinks: [{ label: 'Trades', moduleId: 'managers' as const, href: `/core/trades?league=${encodeURIComponent(leagueId)}#pick-terms` }],
    },
  ]
}

