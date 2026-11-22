import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

import { payloadHash } from './payloadHash'
import { isValidSourceSlug, parsePlayerKey, playerKeyFromRef } from './playerKey'
import { isDynastyProspectStorageEnabled, type FlagEnv } from './storageFlag'
import {
  toProspectSport,
  type ProspectSport,
  type ProspectStatus,
  type ProspectVendorAdapter,
  type VendorProspectRecord,
  type VendorRookieEligibilityRecord,
} from './vendorAdapter'

/**
 * The INGESTION layer for dynasty prospects: takes records from a `ProspectVendorAdapter` and upserts
 * them into `prospect_players` / `rookie_eligibility_records`.
 *
 * 🛑 NOTHING SCHEDULES THIS YET, AND THAT IS DELIBERATE. No vendor is chosen, so there is nothing
 * real to import. When one is, the scheduled caller ships in the SAME change as the first surface
 * that reads these tables (CLAUDE.md: a read pointed at a table nothing refreshes "fails silently
 * and looks correct"). The plan puts it inside `/api/cron/import-players?intel=1` as a weekly-gated
 * phase — never a new `cron-schedule.json` entry.
 *
 * Behind DYNASTY_PROSPECT_STORAGE_ENABLED (./storageFlag.ts): while it is off this neither calls the
 * adapter nor touches the database.
 *
 * ⚠ CHANGE IS DETECTED BY HASH. Each normalised record is hashed (./payloadHash.ts); a row whose
 * stored `payloadHash` matches is not rewritten — only its `lastSyncedAt` moves, so staleness stays
 * measurable. `raw` and `sourceUpdatedAt` are stored but NOT hashed: a vendor that restamps its own
 * timestamp on every response would otherwise rewrite every row on every run.
 *
 * ⚠ THE WRITER NEVER WRITES `sportsPlayerId`. Linking a prospect to his SportsPlayer row on debut is
 * an identity decision for a linker (exact id or name + birth date + org, never name alone — plan
 * §4.4), and a vendor re-import must not erase a link the linker made.
 */

type ProspectWriteDb = Pick<typeof prisma, 'prospectPlayer' | 'rookieEligibilityRecord'>

type IngestOpts = { db?: ProspectWriteDb; env?: FlagEnv; now?: Date }

export type IngestSkipped = { status: 'disabled' } | { status: 'unsupported'; reason: string }

export type ProspectIngestResult =
  | IngestSkipped
  | {
      status: 'ok'
      sport: ProspectSport
      source: string
      received: number
      created: number
      updated: number
      unchanged: number
      /** Records refused before any write, with why. */
      rejected: Array<{ sourcePlayerId: string; reason: string }>
    }

export type EligibilityIngestResult =
  | IngestSkipped
  | {
      status: 'ok'
      sport: ProspectSport
      season: number
      source: string
      received: number
      created: number
      updated: number
      unchanged: number
      rejected: Array<{ playerKey: string | null; reason: string }>
    }

const ID_CHUNK = 1000
const STATUSES: readonly ProspectStatus[] = ['prospect', 'graduated', 'released', 'unknown']

function text(raw: string | null | undefined, max: number): string | null {
  const s = String(raw ?? '').trim()
  return s ? s.slice(0, max) : null
}

function int(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null
}

/** `YYYY-MM-DD` (or a Date) → UTC midnight; anything unparseable → null. */
function dateOnly(raw: string | Date | null | undefined): Date | null {
  if (raw == null || raw === '') return null
  const d = raw instanceof Date ? raw : new Date(String(raw).slice(0, 10) + 'T00:00:00.000Z')
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function timestamp(raw: string | Date | null | undefined): Date | null {
  if (raw == null || raw === '') return null
  const d = raw instanceof Date ? raw : new Date(String(raw))
  return Number.isNaN(d.getTime()) ? null : d
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export type NormalizedProspect = ReturnType<typeof hashedFields> & { payloadHash: string }

/** The stored, hashed shape of one vendor record — or why it was refused. */
export function normalizeVendorProspect(
  record: VendorProspectRecord,
): { ok: true; row: NormalizedProspect } | { ok: false; reason: string } {
  const sourcePlayerId = String(record?.sourcePlayerId ?? '').trim()
  if (!sourcePlayerId) return { ok: false, reason: 'missing sourcePlayerId' }
  if (sourcePlayerId.length > 64) return { ok: false, reason: 'sourcePlayerId longer than 64' }
  const name = String(record.name ?? '').trim()
  if (!name) return { ok: false, reason: 'missing name' }
  const row = hashedFields(record, sourcePlayerId, name)
  return { ok: true, row: { ...row, payloadHash: payloadHash(row) } }
}

function hashedFields(record: VendorProspectRecord, sourcePlayerId: string, name: string) {
  const status = STATUSES.includes(record.status as ProspectStatus) ? (record.status as ProspectStatus) : 'prospect'
  return {
    sourcePlayerId,
    name,
    normalizedName: normalizePlayerName(name),
    position: text(record.position, 16),
    birthDate: dateOnly(record.birthDate),
    nationality: text(record.nationality, 48),
    currentOrg: text(record.currentOrg, 64),
    currentTeam: text(record.currentTeam, 96),
    currentLevel: text(record.currentLevel, 24),
    draftYear: int(record.draftYear),
    draftRound: int(record.draftRound),
    draftPick: int(record.draftPick),
    draftOverall: int(record.draftOverall),
    draftTeam: text(record.draftTeam, 64),
    etaYear: int(record.etaYear),
    status,
    stats: record.stats ?? null,
  }
}

function checkAdapter(adapter: ProspectVendorAdapter, sport: string): { sport: ProspectSport } | IngestSkipped {
  const s = toProspectSport(sport)
  if (!s) return { status: 'unsupported', reason: `sport ${sport} is not MLB, NBA or NHL` }
  if (!isValidSourceSlug(adapter.source)) return { status: 'unsupported', reason: `invalid source slug ${adapter.source}` }
  if (!adapter.sports.includes(s)) return { status: 'unsupported', reason: `${adapter.source} does not supply ${s}` }
  return { sport: s }
}

async function existingHashes<K extends string>(
  ids: K[],
  read: (chunk: K[]) => Promise<Array<{ key: K; payloadHash: string }>>,
): Promise<Map<K, string>> {
  const out = new Map<K, string>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    for (const r of await read(ids.slice(i, i + ID_CHUNK))) out.set(r.key, r.payloadHash)
  }
  return out
}

/** Import one sport's prospects from a vendor adapter, upserting only what changed. */
export async function ingestProspectsFromVendor(
  adapter: ProspectVendorAdapter,
  sportInput: string,
  opts: IngestOpts = {},
): Promise<ProspectIngestResult> {
  if (!isDynastyProspectStorageEnabled(opts.env)) return { status: 'disabled' }
  const checked = checkAdapter(adapter, sportInput)
  if ('status' in checked) return checked
  const { sport } = checked
  const source = adapter.source
  const db = opts.db ?? prisma
  const now = opts.now ?? new Date()

  const records = await adapter.fetchProspects(sport)
  const rejected: Array<{ sourcePlayerId: string; reason: string }> = []
  const batch = new Map<string, { row: NormalizedProspect; record: VendorProspectRecord }>()
  for (const record of records) {
    const n = normalizeVendorProspect(record)
    const id = String(record?.sourcePlayerId ?? '').trim()
    if (!n.ok) {
      rejected.push({ sourcePlayerId: id, reason: n.reason })
      continue
    }
    // Two records for one id in one response: keep the first and say so, rather than letting the
    // later silently win depending on array order.
    if (batch.has(n.row.sourcePlayerId)) {
      rejected.push({ sourcePlayerId: id, reason: 'duplicate sourcePlayerId in batch' })
      continue
    }
    batch.set(n.row.sourcePlayerId, { row: n.row, record })
  }

  const stored = await existingHashes([...batch.keys()], async (chunk) =>
    (
      await db.prospectPlayer.findMany({
        where: { sport, source, sourcePlayerId: { in: chunk } },
        select: { sourcePlayerId: true, payloadHash: true },
      })
    ).map((r) => ({ key: r.sourcePlayerId, payloadHash: r.payloadHash })),
  )

  let created = 0
  let updated = 0
  const unchangedIds: string[] = []
  for (const [sourcePlayerId, { row, record }] of batch) {
    const held = stored.get(sourcePlayerId)
    if (held === row.payloadHash) {
      unchangedIds.push(sourcePlayerId)
      continue
    }
    const { stats, ...fields } = row
    const data = {
      ...fields,
      statsPayload: json(stats),
      rawPayload: json(record.raw),
      sourceUpdatedAt: timestamp(record.sourceUpdatedAt),
      lastSyncedAt: now,
    }
    await db.prospectPlayer.upsert({
      where: { sport_source_sourcePlayerId: { sport, source, sourcePlayerId } },
      create: { sport, source, ...data },
      update: data,
    })
    if (held === undefined) created++
    else updated++
  }
  for (let i = 0; i < unchangedIds.length; i += ID_CHUNK) {
    await db.prospectPlayer.updateMany({
      where: { sport, source, sourcePlayerId: { in: unchangedIds.slice(i, i + ID_CHUNK) } },
      data: { lastSyncedAt: now },
    })
  }

  return { status: 'ok', sport, source, received: records.length, created, updated, unchanged: unchangedIds.length, rejected }
}

/**
 * Write rookie verdicts for one sport + season under ONE source. Exported apart from the vendor path
 * so an in-house rule set can write through the same hashing and scoping later, under its own slug.
 *
 * ⚠ A `vendor:` key must be in THIS source's id space. A verdict about `vendor:other:123` written
 * under `source = x` would be x vouching for an id it does not own.
 */
export async function writeRookieEligibility(
  input: { sport: string; season: number; source: string; records: VendorRookieEligibilityRecord[] },
  opts: IngestOpts = {},
): Promise<EligibilityIngestResult> {
  if (!isDynastyProspectStorageEnabled(opts.env)) return { status: 'disabled' }
  const sport = toProspectSport(input.sport)
  if (!sport) return { status: 'unsupported', reason: `sport ${input.sport} is not MLB, NBA or NHL` }
  if (!isValidSourceSlug(input.source)) return { status: 'unsupported', reason: `invalid source slug ${input.source}` }
  if (!Number.isInteger(input.season) || input.season < 1900 || input.season > 2200) {
    return { status: 'unsupported', reason: `invalid season ${input.season}` }
  }
  const { season, source } = input
  const db = opts.db ?? prisma
  const now = opts.now ?? new Date()

  const rejected: Array<{ playerKey: string | null; reason: string }> = []
  const batch = new Map<string, { isRookie: boolean; basis: string; evidence: Record<string, unknown> | null; payloadHash: string }>()
  for (const r of input.records) {
    const playerKey = r?.player ? playerKeyFromRef(r.player) : null
    const ref = parsePlayerKey(playerKey)
    if (!playerKey || !ref) {
      rejected.push({ playerKey, reason: 'player key is not namespaced' })
      continue
    }
    if (ref.kind === 'vendor' && ref.source !== source) {
      rejected.push({ playerKey, reason: `vendor key belongs to ${ref.source}, not ${source}` })
      continue
    }
    if (typeof r.isRookie !== 'boolean') {
      rejected.push({ playerKey, reason: 'isRookie is not a boolean' })
      continue
    }
    const basis = String(r.basis ?? '').trim()
    if (!basis) {
      rejected.push({ playerKey, reason: 'missing basis' })
      continue
    }
    if (batch.has(playerKey)) {
      rejected.push({ playerKey, reason: 'duplicate player in batch' })
      continue
    }
    const evidence = r.evidence ?? null
    batch.set(playerKey, { isRookie: r.isRookie, basis, evidence, payloadHash: payloadHash({ isRookie: r.isRookie, basis, evidence }) })
  }

  const stored = await existingHashes([...batch.keys()], async (chunk) =>
    (
      await db.rookieEligibilityRecord.findMany({
        where: { sport, season, source, playerKey: { in: chunk } },
        select: { playerKey: true, payloadHash: true },
      })
    ).map((r) => ({ key: r.playerKey, payloadHash: r.payloadHash })),
  )

  let created = 0
  let updated = 0
  let unchanged = 0
  for (const [playerKey, v] of batch) {
    const held = stored.get(playerKey)
    if (held === v.payloadHash) {
      unchanged++
      continue
    }
    const data = { isRookie: v.isRookie, basis: v.basis, evidence: json(v.evidence), payloadHash: v.payloadHash, computedAt: now }
    await db.rookieEligibilityRecord.upsert({
      where: { sport_season_playerKey_source: { sport, season, playerKey, source } },
      create: { sport, season, playerKey, source, ...data },
      update: data,
    })
    if (held === undefined) created++
    else updated++
  }

  return { status: 'ok', sport, season, source, received: input.records.length, created, updated, unchanged, rejected }
}

/** Import a vendor's rookie verdicts for one sport + season, under the adapter's own source. */
export async function ingestRookieEligibilityFromVendor(
  adapter: ProspectVendorAdapter,
  sportInput: string,
  season: number,
  opts: IngestOpts = {},
): Promise<EligibilityIngestResult> {
  if (!isDynastyProspectStorageEnabled(opts.env)) return { status: 'disabled' }
  const checked = checkAdapter(adapter, sportInput)
  if ('status' in checked) return checked
  if (!adapter.fetchRookieEligibility) return { status: 'unsupported', reason: `${adapter.source} supplies no rookie eligibility` }
  const records = await adapter.fetchRookieEligibility(checked.sport, season)
  return writeRookieEligibility({ sport: checked.sport, season, source: adapter.source, records }, opts)
}
