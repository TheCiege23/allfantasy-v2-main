import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient

export type RiskLevel = "low" | "medium" | "high"

export type DuplicateManagerComparison = {
  suspectAppUserId: string
  suspectRosterId: string | null
  /** Display label only (username/display name) — never raw fingerprint values. */
  suspectLabel: string
  score: number
  riskLevel: RiskLevel
  reasons: string[]
  /** True when a HouseholdException already covers this specific pair — excluded from escalation. */
  householdExempt: boolean
}

export type DuplicateManagerAssessment = {
  riskLevel: RiskLevel
  topScore: number
  /** Sorted desc by score; only entries with score > 0 or an explicit reason. */
  comparisons: DuplicateManagerComparison[]
}

// Signal weights — named constants so they're easy to retune without hunting through logic.
const WEIGHT_SHARED_IP = 40
const WEIGHT_SHARED_DEVICE = 40
const WEIGHT_SHARED_USER_AGENT = 15
const WEIGHT_SHARED_PAYMENT_METHOD = 50
const WEIGHT_SIMILAR_EMAIL = 35
const WEIGHT_SIMILAR_NAME = 15
const WEIGHT_JOIN_TIMING_CLUSTER = 10

const RISK_THRESHOLD_HIGH = 60
const RISK_THRESHOLD_MEDIUM = 25
const JOIN_TIMING_CLUSTER_WINDOW_MS = 15 * 60 * 1000
const IDENTITY_SIGNAL_LOOKBACK_DAYS = 90

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLD_HIGH) return "high"
  if (score >= RISK_THRESHOLD_MEDIUM) return "medium"
  return "low"
}

/** Canonical (sorted) pair order so a household exception is never stored/looked-up in both A,B and B,A form. */
export function canonicalUserPair(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA]
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  // Small-string edit distance for email local-parts / usernames — not called on long strings.
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)])
  for (let j = 1; j < cols; j += 1) d[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[rows - 1][cols - 1]
}

function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/** Strips gmail dot/+tag evasion tricks; other domains only get case/whitespace normalization. */
/**
 * Null for a phone-only account. ⚠ Two missing emails must never compare as a match: both would
 * normalise to { local: "", domain: "" } and every pair of phone-only managers would score as
 * "same email".
 */
function normalizeEmailForComparison(email: string | null): { local: string; domain: string } | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  const [localRaw, domainRaw] = trimmed.split("@")
  const domain = domainRaw ?? ""
  let local = localRaw ?? ""
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+")[0].replace(/\./g, "")
  } else {
    local = local.split("+")[0]
  }
  return { local, domain }
}

function normalizeNameForComparison(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

async function findActiveHouseholdException(
  client: PrismaClientOrTx,
  leagueId: string,
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  const [a, b] = canonicalUserPair(userIdA, userIdB)
  const exception = await client.householdException.findFirst({
    where: {
      appUserIdA: a,
      appUserIdB: b,
      OR: [{ leagueId: null }, { leagueId }],
    },
    select: { id: true },
  })
  return !!exception
}

/**
 * Compares a joining user against every existing (non-orphan) manager already
 * in the league and returns a per-pair risk assessment. Read-only — callers
 * decide what to do with the result (block, flag, allow).
 */
export async function assessLeagueJoinRisk(input: {
  leagueId: string
  joiningUserId: string
  client?: PrismaClientOrTx
}): Promise<DuplicateManagerAssessment> {
  const client = input.client ?? prisma
  const { leagueId, joiningUserId } = input

  const [joiningUser, joiningProfile, joiningSignals, joiningSubscription, existingRosters] = await Promise.all([
    client.appUser.findUnique({ where: { id: joiningUserId }, select: { id: true, email: true, username: true, displayName: true } }),
    client.userProfile.findFirst({ where: { userId: joiningUserId }, select: { displayName: true } }),
    client.identitySignal.findMany({
      where: { userId: joiningUserId, createdAt: { gte: new Date(Date.now() - IDENTITY_SIGNAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) } },
      select: { ipHash: true, userAgentHash: true, deviceId: true },
    }),
    client.userSubscription.findFirst({ where: { userId: joiningUserId, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true }, orderBy: { createdAt: "desc" } }),
    client.roster.findMany({
      where: { leagueId, NOT: { platformUserId: { startsWith: "orphan-" } } },
      select: { id: true, platformUserId: true, createdAt: true },
    }),
  ])

  if (!joiningUser) {
    return { riskLevel: "low", topScore: 0, comparisons: [] }
  }

  const joiningIpHashes = new Set(joiningSignals.map((s) => s.ipHash).filter((v): v is string => !!v))
  const joiningUaHashes = new Set(joiningSignals.map((s) => s.userAgentHash).filter((v): v is string => !!v))
  const joiningDeviceIds = new Set(joiningSignals.map((s) => s.deviceId).filter((v): v is string => !!v))
  const joiningEmailNorm = normalizeEmailForComparison(joiningUser.email)
  const joiningNameNorm = normalizeNameForComparison(joiningProfile?.displayName || joiningUser.displayName || joiningUser.username)
  const now = Date.now()

  const comparisons: DuplicateManagerComparison[] = []

  for (const roster of existingRosters) {
    const suspectUserId = roster.platformUserId
    if (!suspectUserId || suspectUserId === joiningUserId) continue

    const [suspectUser, suspectProfile, suspectSignals, suspectSubscription] = await Promise.all([
      client.appUser.findUnique({ where: { id: suspectUserId }, select: { id: true, email: true, username: true, displayName: true } }),
      client.userProfile.findFirst({ where: { userId: suspectUserId }, select: { displayName: true } }),
      client.identitySignal.findMany({
        where: { userId: suspectUserId, createdAt: { gte: new Date(now - IDENTITY_SIGNAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) } },
        select: { ipHash: true, userAgentHash: true, deviceId: true },
      }),
      client.userSubscription.findFirst({ where: { userId: suspectUserId, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true }, orderBy: { createdAt: "desc" } }),
    ])
    if (!suspectUser) continue

    let score = 0
    const reasons: string[] = []

    if (suspectSignals.some((s) => s.ipHash && joiningIpHashes.has(s.ipHash))) {
      score += WEIGHT_SHARED_IP
      reasons.push("Shared network signal with an existing manager")
    }
    if (suspectSignals.some((s) => s.deviceId && joiningDeviceIds.has(s.deviceId))) {
      score += WEIGHT_SHARED_DEVICE
      reasons.push("Shared device signal with an existing manager")
    }
    if (suspectSignals.some((s) => s.userAgentHash && joiningUaHashes.has(s.userAgentHash))) {
      score += WEIGHT_SHARED_USER_AGENT
      reasons.push("Shared browser/device fingerprint with an existing manager")
    }
    if (joiningSubscription?.stripeCustomerId && suspectSubscription?.stripeCustomerId && joiningSubscription.stripeCustomerId === suspectSubscription.stripeCustomerId) {
      score += WEIGHT_SHARED_PAYMENT_METHOD
      reasons.push("Same payment method on file as an existing manager")
    }

    const suspectEmailNorm = normalizeEmailForComparison(suspectUser.email)
    const emailExactNormMatch =
      !!joiningEmailNorm && !!suspectEmailNorm &&
      joiningEmailNorm.domain === suspectEmailNorm.domain && joiningEmailNorm.local === suspectEmailNorm.local
    const emailCloseMatch =
      !!joiningEmailNorm && !!suspectEmailNorm &&
      !emailExactNormMatch &&
      joiningEmailNorm.domain === suspectEmailNorm.domain &&
      joiningEmailNorm.local.length > 2 &&
      similarityRatio(joiningEmailNorm.local, suspectEmailNorm.local) >= 0.85
    if (emailExactNormMatch || emailCloseMatch) {
      score += WEIGHT_SIMILAR_EMAIL
      reasons.push("Email address closely matches an existing manager's")
    }

    const suspectNameNorm = normalizeNameForComparison(suspectProfile?.displayName || suspectUser.displayName || suspectUser.username)
    if (joiningNameNorm.length > 2 && suspectNameNorm.length > 2 && similarityRatio(joiningNameNorm, suspectNameNorm) >= 0.85) {
      score += WEIGHT_SIMILAR_NAME
      reasons.push("Username/display name closely matches an existing manager's")
    }

    if (Math.abs(now - roster.createdAt.getTime()) <= JOIN_TIMING_CLUSTER_WINDOW_MS) {
      score += WEIGHT_JOIN_TIMING_CLUSTER
      reasons.push("Joined the league within minutes of an existing manager")
    }

    if (score <= 0) continue

    const householdExempt = await findActiveHouseholdException(client, leagueId, joiningUserId, suspectUserId)

    comparisons.push({
      suspectAppUserId: suspectUserId,
      suspectRosterId: roster.id,
      suspectLabel: suspectProfile?.displayName || suspectUser.displayName || suspectUser.username || "Manager",
      score,
      riskLevel: householdExempt ? "low" : scoreToRiskLevel(score),
      reasons,
      householdExempt,
    })
  }

  comparisons.sort((a, b) => b.score - a.score)
  const activeComparisons = comparisons.filter((c) => !c.householdExempt)
  const topScore = activeComparisons.length > 0 ? activeComparisons[0].score : 0

  return {
    riskLevel: scoreToRiskLevel(topScore),
    topScore,
    comparisons,
  }
}

/** Creates (or reuses) a HouseholdException for this pair — always stored in canonical order. */
export async function recordHouseholdException(input: {
  userIdA: string
  userIdB: string
  leagueId?: string | null
  reason?: string | null
  approvedByUserId: string
  client?: PrismaClientOrTx
}): Promise<void> {
  const client = input.client ?? prisma
  const [a, b] = canonicalUserPair(input.userIdA, input.userIdB)
  await client.householdException.upsert({
    where: { appUserIdA_appUserIdB_leagueId: { appUserIdA: a, appUserIdB: b, leagueId: input.leagueId ?? null } },
    create: {
      appUserIdA: a,
      appUserIdB: b,
      leagueId: input.leagueId ?? null,
      reason: input.reason ?? null,
      approvedByUserId: input.approvedByUserId,
    },
    update: {
      reason: input.reason ?? null,
      approvedByUserId: input.approvedByUserId,
    },
  })
}
