import 'server-only'
import { prisma } from '@/lib/prisma'
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { DEFAULT_PARTNER_SETTINGS, mergePartnerSettings, type PartnerSettings } from './settings'
import { checkCodeShape, normalizeCode, type CodeCheck } from './code'
import { flagReasons, refuseRedemption, type RedemptionRefusal } from './fraud'

/**
 * Commissioner Partner Codes — database operations for codes and referrals.
 * Money (webhooks, ledger) is in ledger.ts; scheduled work in jobs.ts.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_KEYS = Object.keys(DEFAULT_PARTNER_SETTINGS) as (keyof PartnerSettings)[]

export async function loadPartnerSettings(): Promise<PartnerSettings> {
  const row = await prisma.partnerProgramSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  })
  const out = { ...DEFAULT_PARTNER_SETTINGS }
  for (const key of SETTINGS_KEYS) {
    const v = (row as Record<string, unknown>)[key]
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

export async function updatePartnerSettings(patch: Record<string, unknown>, adminUserId: string | null): Promise<PartnerSettings> {
  const merged = mergePartnerSettings(await loadPartnerSettings(), patch)
  await prisma.partnerProgramSettings.update({
    where: { id: 'singleton' },
    data: { ...merged, updatedByUserId: adminUserId },
  })
  return merged
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** A code (current or retired alias) → its PartnerCode row. */
export async function findPartnerCode(raw: string) {
  const normalized = normalizeCode(raw)
  if (!normalized) return null
  const direct = await prisma.partnerCode.findUnique({ where: { codeNormalized: normalized } })
  if (direct) return direct
  const alias = await prisma.partnerCodeAlias.findUnique({
    where: { codeNormalized: normalized },
    select: { partnerCode: true },
  })
  return alias?.partnerCode ?? null
}

export type CodeAvailability = CodeCheck | { ok: false; reason: 'taken' }

export async function checkCodeAvailability(raw: string, forUserId: string | null): Promise<CodeAvailability> {
  const shape = checkCodeShape(raw)
  if (!shape.ok) return shape
  const existing = await findPartnerCode(shape.normalized)
  if (existing && existing.ownerUserId !== forUserId) return { ok: false, reason: 'taken' }
  return shape
}

export type ClaimResult =
  | { ok: true; code: string; created: boolean }
  | { ok: false; reason: 'length' | 'characters' | 'reserved' | 'not_allowed' | 'taken' | 'change_limit' }

/**
 * Claim a code, or change your existing one. One code per commissioner. A
 * changed code's old name becomes an alias, so shared images and links keep
 * working. Changes are limited per rolling year (settings.maxCodeChangesPerYear).
 */
export async function claimPartnerCode(userId: string, raw: string, now = new Date()): Promise<ClaimResult> {
  const avail = await checkCodeAvailability(raw, userId)
  if (!avail.ok) return avail
  const settings = await loadPartnerSettings()
  const mine = await prisma.partnerCode.findUnique({ where: { ownerUserId: userId } })

  try {
    if (!mine) {
      await prisma.partnerCode.create({
        data: { ownerUserId: userId, code: avail.display, codeNormalized: avail.normalized },
      })
      return { ok: true, code: avail.display, created: true }
    }
    if (mine.codeNormalized === avail.normalized) {
      // Same code, new casing ("theciege" → "TheCiege"): free, not a change.
      if (mine.code !== avail.display) {
        await prisma.partnerCode.update({ where: { id: mine.id }, data: { code: avail.display } })
      }
      return { ok: true, code: avail.display, created: false }
    }
    const yearAgo = now.getTime() - 365 * 86_400_000
    const recent = mine.codeChangedAt.filter((d) => d.getTime() > yearAgo)
    if (recent.length >= settings.maxCodeChangesPerYear) return { ok: false, reason: 'change_limit' }

    // Reclaiming one of your own old names: drop that alias first.
    await prisma.$transaction([
      prisma.partnerCodeAlias.deleteMany({ where: { codeNormalized: avail.normalized, partnerCodeId: mine.id } }),
      prisma.partnerCodeAlias.upsert({
        where: { codeNormalized: mine.codeNormalized },
        create: { codeNormalized: mine.codeNormalized, partnerCodeId: mine.id },
        update: {},
      }),
      prisma.partnerCode.update({
        where: { id: mine.id },
        data: { code: avail.display, codeNormalized: avail.normalized, codeChangedAt: [...recent, now] },
      }),
    ])
    return { ok: true, code: avail.display, created: false }
  } catch (error) {
    // Lost a race for the same name.
    if ((error as { code?: string })?.code === 'P2002') return { ok: false, reason: 'taken' }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export type AttachResult =
  | { ok: true; referralId: string; partnerCodeId: string; flagged: boolean; code: string }
  | { ok: false; reason: RedemptionRefusal | 'unknown_code' }

/**
 * Tie a user to a code — at signup (from the /join cookie), or when they type
 * the code at checkout. One code per user, ever: a second call with the SAME
 * code is a no-op success, with a different code it is refused.
 */
export async function attachReferral(args: {
  userId: string
  rawCode: string
  email?: string | null
  ip?: string | null
  isDemo?: boolean
}): Promise<AttachResult> {
  const code = await findPartnerCode(args.rawCode)
  if (!code) return { ok: false, reason: 'unknown_code' }
  const existing = await prisma.partnerReferral.findUnique({ where: { userId: args.userId } })
  if (existing && existing.partnerCodeId === code.id) {
    return { ok: true, referralId: existing.id, partnerCodeId: code.id, flagged: existing.status === 'flagged', code: code.code }
  }
  const refusal = refuseRedemption({
    redeemerUserId: args.userId,
    ownerUserId: code.ownerUserId,
    redeemerHasRedemption: !!existing,
    codeStatus: code.status as 'active' | 'paused' | 'revoked',
  })
  if (refusal) return { ok: false, reason: refusal }

  const ip = args.ip?.trim() || null
  const since = new Date(Date.now() - 86_400_000)
  const sameIpLast24h = ip
    ? await prisma.partnerReferral.count({ where: { partnerCodeId: code.id, signupIp: ip, createdAt: { gte: since } } })
    : 0
  const reasons = flagReasons({
    sameCardOnCode: 0, // known only at first payment; checked again in ledger.ts
    matchesOwnerCard: false,
    sameIpLast24h: sameIpLast24h + 1,
    isDisposableEmail: isUndeliverableEmailDomain(args.email ?? null),
    // No login-IP history exists to compare the owner against; not guessed.
    matchesOwnerIp: false,
  })
  try {
    const row = await prisma.partnerReferral.create({
      data: {
        partnerCodeId: code.id,
        userId: args.userId,
        status: reasons.length ? 'flagged' : 'pending',
        flagReasons: reasons,
        signupIp: ip,
        emailDomain: args.email?.split('@')[1]?.toLowerCase() ?? null,
        isDemo: !!args.isDemo,
      },
    })
    return { ok: true, referralId: row.id, partnerCodeId: code.id, flagged: reasons.length > 0, code: code.code }
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return { ok: false, reason: 'already_redeemed' }
    throw error
  }
}

/**
 * Record that a referred user was seen today. Cheap and idempotent (one row per
 * user per day); never throws into the caller's request.
 */
export async function recordPartnerReferralActivity(userId: string, now = new Date()): Promise<void> {
  try {
    const ref = await prisma.partnerReferral.findUnique({ where: { userId }, select: { id: true } })
    if (!ref) return
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    await prisma.partnerReferralActivity.upsert({
      where: { referralId_day: { referralId: ref.id, day } },
      create: { referralId: ref.id, day },
      update: {},
    })
  } catch (error) {
    console.warn('[partner-codes] activity not recorded', (error as Error)?.message)
  }
}

/** Is this user eligible for the friend discount right now? */
export async function partnerDiscountEligibility(userId: string) {
  const ref = await prisma.partnerReferral.findUnique({
    where: { userId },
    select: { id: true, status: true, firstPaidAt: true, paidInvoiceCount: true, partnerCode: { select: { id: true, code: true, status: true } } },
  })
  if (!ref) return null
  if (ref.firstPaidAt || ref.paidInvoiceCount > 0) return null // first subscription only
  if (ref.status === 'rejected' || ref.partnerCode.status !== 'active') return null
  return { referralId: ref.id, partnerCodeId: ref.partnerCode.id, code: ref.partnerCode.code }
}
