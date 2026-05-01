import "server-only"
import crypto from "crypto"
import { isAdminEmailAllowed } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { WORLD_CUP_TOURNAMENT_KEY, type WorldCupChallengeView } from "./types"
import { DEFAULT_WORLD_CUP_SCORING, generateWorldCupBracketTemplate, isWorldCupMatchLocked } from "./worldCupBracketBuilder"
import { buildWorldCupLeaderboardRows, recalculateWorldCupChallenge } from "./worldCupScoringService"
type SessionUser = { id?: string | null; email?: string | null; name?: string | null }
const db = () => prisma as any
const iso = (v: Date | string | null | undefined) => v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null
export function getWorldCupAppBaseUrl() { return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "") }
export async function generateWorldCupInviteCode() { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (let a = 0; a < 12; a++) { let out = "WC"; for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]; if (!(await db().worldCupBracketChallenge.findUnique({ where: { inviteCode: out } }))) return out } return `WC${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}` }
async function displayName(user: SessionUser) { if (user.name?.trim()) return user.name.trim(); if (user.email) return user.email.split("@")[0]; if (!user.id) return "Bracket Manager"; const u = await db().appUser.findUnique({ where: { id: user.id }, select: { displayName: true, username: true, email: true } }); return u?.displayName || u?.username || u?.email?.split("@")[0] || "Bracket Manager" }
export function userCanManageWorldCupChallenge(i: { userId?: string | null; userEmail?: string | null; ownerUserId?: string | null; isAdmin?: boolean }) { return Boolean(i.isAdmin || (i.userId && i.ownerUserId && i.userId === i.ownerUserId) || isAdminEmailAllowed(i.userEmail)) }
export async function createWorldCupBracketChallenge(input: { user: SessionUser; name: string; seasonYear?: number; visibility?: "public" | "private"; pickLockStrategy?: "per_match" | "tournament_start"; pickLockAt?: Date | null; includeThirdPlace?: boolean; scoring?: Partial<typeof DEFAULT_WORLD_CUP_SCORING> }) {
  if (!input.user.id) throw new Error("Authenticated user required")
  const inviteCode = await generateWorldCupInviteCode(), inviteUrl = `${getWorldCupAppBaseUrl()}/join/bracket/${inviteCode}`, template = generateWorldCupBracketTemplate({ includeThirdPlace: input.includeThirdPlace }), name = await displayName(input.user)
  const result = await db().$transaction(async (tx: any) => {
    const scoringProfile = await tx.worldCupBracketScoringProfile.create({ data: { name: "World Cup Standard", ...DEFAULT_WORLD_CUP_SCORING, ...(input.scoring ?? {}) } })
    const challenge = await tx.worldCupBracketChallenge.create({ data: { name: input.name, ownerUserId: input.user.id, seasonYear: input.seasonYear ?? 2026, tournamentKey: WORLD_CUP_TOURNAMENT_KEY, inviteCode, inviteUrl, visibility: input.visibility ?? "private", pickLockStrategy: input.pickLockStrategy ?? "per_match", pickLockAt: input.pickLockAt ?? null, scoringProfileId: scoringProfile.id, status: "open", includeThirdPlace: Boolean(input.includeThirdPlace) } })
    await tx.worldCupBracketSlot.createMany({ data: template.slots.map((s) => ({ challengeId: challenge.id, ...s })) })
    const ids = new Map<number, string>(); template.matches.forEach((m) => ids.set(m.matchNumber, crypto.randomUUID()))
    await tx.worldCupBracketMatch.createMany({ data: template.matches.map((m) => ({ id: ids.get(m.matchNumber), challengeId: challenge.id, round: m.round, roundIndex: m.roundIndex, matchNumber: m.matchNumber, homeSlotKey: m.homeSlotKey, awaySlotKey: m.awaySlotKey, homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName, nextMatchId: m.nextMatchNumber ? ids.get(m.nextMatchNumber) ?? null : null, nextMatchSlot: m.nextMatchSlot ?? null })) })
    const participant = await tx.worldCupBracketParticipant.create({ data: { challengeId: challenge.id, userId: input.user.id, displayName: name } })
    await tx.worldCupBracketInvite.create({ data: { challengeId: challenge.id, inviteCode, createdByUserId: input.user.id } })
    return { challenge, participant }
  })
  return { challengeId: result.challenge.id, participantId: result.participant.id, inviteCode, inviteUrl }
}
function serialize(input: { challenge: any; participant: any | null; picks: any[]; leaderboard: any[]; userId?: string | null; isAdmin?: boolean }): WorldCupChallengeView {
  const c = input.challenge
  return { challenge: { id: c.id, name: c.name, ownerUserId: c.ownerUserId, seasonYear: c.seasonYear, inviteCode: c.inviteCode, inviteUrl: c.inviteUrl, visibility: c.visibility, pickLockStrategy: c.pickLockStrategy, pickLockAt: iso(c.pickLockAt), status: c.status, includeThirdPlace: Boolean(c.includeThirdPlace), lastSyncedAt: iso(c.lastSyncedAt), createdAt: iso(c.createdAt) ?? new Date().toISOString(), updatedAt: iso(c.updatedAt) ?? new Date().toISOString() }, scoring: { roundOf32Points: c.scoringProfile?.roundOf32Points ?? 1, roundOf16Points: c.scoringProfile?.roundOf16Points ?? 2, quarterFinalPoints: c.scoringProfile?.quarterFinalPoints ?? 4, semiFinalPoints: c.scoringProfile?.semiFinalPoints ?? 8, finalPoints: c.scoringProfile?.finalPoints ?? 16, championBonusPoints: c.scoringProfile?.championBonusPoints ?? 0, thirdPlacePoints: c.scoringProfile?.thirdPlacePoints ?? 4 }, slots: c.slots.map((s: any) => ({ id: s.id, slotKey: s.slotKey, round: s.round, region: s.region, sourceGroup: s.sourceGroup, sourceRank: s.sourceRank, teamId: s.teamId, displayName: s.displayName, isPlaceholder: Boolean(s.isPlaceholder), lockedAt: iso(s.lockedAt) })), matches: c.matches.map((m: any) => ({ id: m.id, apiFixtureId: m.apiFixtureId, round: m.round, roundIndex: m.roundIndex, matchNumber: m.matchNumber, homeSlotKey: m.homeSlotKey, awaySlotKey: m.awaySlotKey, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName, homeTeamLogo: m.homeTeamLogo, awayTeamLogo: m.awayTeamLogo, homeScore: m.homeScore, awayScore: m.awayScore, homePenaltyScore: m.homePenaltyScore, awayPenaltyScore: m.awayPenaltyScore, status: m.status, startsAt: iso(m.startsAt), winnerTeamId: m.winnerTeamId, winnerTeamName: m.winnerTeamName, nextMatchId: m.nextMatchId, nextMatchSlot: m.nextMatchSlot })), participant: input.participant ? { id: input.participant.id, userId: input.participant.userId, displayName: input.participant.displayName, joinedAt: iso(input.participant.joinedAt) ?? new Date().toISOString(), totalScore: input.participant.totalScore, maxPossibleScore: input.participant.maxPossibleScore, championPickTeamId: input.participant.championPickTeamId, championPickName: input.participant.championPickName, correctPicks: input.participant.correctPicks, rank: input.participant.rank } : null, picks: input.picks.map((p) => ({ id: p.id, matchId: p.matchId, round: p.round, selectedTeamId: p.selectedTeamId, selectedSlotKey: p.selectedSlotKey, selectedTeamName: p.selectedTeamName, pointsAwarded: p.pointsAwarded, isCorrect: p.isCorrect, lockedAt: iso(p.lockedAt) })), leaderboard: input.leaderboard, isOwner: Boolean(input.userId && input.userId === c.ownerUserId), isAdmin: Boolean(input.isAdmin) }
}
export async function getWorldCupChallengeView(input: { challengeId: string; user?: SessionUser | null; isAdmin?: boolean }) {
  const c = await db().worldCupBracketChallenge.findUnique({ where: { id: input.challengeId }, include: { scoringProfile: true, slots: { orderBy: { slotKey: "asc" } }, matches: { orderBy: { matchNumber: "asc" } }, participants: { orderBy: [{ rank: "asc" }, { joinedAt: "asc" }], include: { picks: { include: { match: true } } } } } })
  if (!c) return null
  const userId = input.user?.id ?? null, isPart = Boolean(userId && c.participants.some((p: any) => p.userId === userId)), can = userCanManageWorldCupChallenge({ userId, userEmail: input.user?.email, ownerUserId: c.ownerUserId, isAdmin: input.isAdmin })
  if (c.visibility === "private" && !isPart && !can) return null
  const participant = userId ? c.participants.find((p: any) => p.userId === userId) ?? null : null
  const picks = participant ? await db().worldCupBracketPick.findMany({ where: { participantId: participant.id }, orderBy: { createdAt: "asc" } }) : []
  return serialize({ challenge: c, participant, picks, leaderboard: buildWorldCupLeaderboardRows({ participants: c.participants, matches: c.matches, scoring: c.scoringProfile }), userId, isAdmin: Boolean(input.isAdmin || isAdminEmailAllowed(input.user?.email)) })
}
export async function getWorldCupChallengeByInvite(inviteCode: string) {
  try {
    const i = await db().worldCupBracketInvite.findUnique({
      where: { inviteCode },
      include: { challenge: { include: { participants: true } } },
    })
    if (!i || (i.expiresAt && new Date(i.expiresAt) <= new Date()) || (i.maxUses != null && i.useCount >= i.maxUses)) return null

    const o = await db().appUser.findUnique({
      where: { id: i.challenge.ownerUserId },
      select: { displayName: true, username: true, email: true },
    })

    return {
      inviteCode,
      challengeId: i.challenge.id,
      name: i.challenge.name,
      ownerName: o?.displayName || o?.username || o?.email?.split("@")[0] || "AllFantasy Manager",
      seasonYear: i.challenge.seasonYear,
      participantCount: i.challenge.participants.length,
      status: i.challenge.status,
      visibility: i.challenge.visibility,
    }
  } catch {
    // If the DB is unavailable in local/dev, degrade to a 404 path instead of crashing this page.
    return null
  }
}
export async function joinWorldCupChallengeByInvite(input: { inviteCode: string; user: SessionUser }) {
  if (!input.user.id) throw new Error("Authenticated user required")
  const name = await displayName(input.user)
  const result = await db().$transaction(async (tx: any) => {
    const invite = await tx.worldCupBracketInvite.findUnique({ where: { inviteCode: input.inviteCode } })
    if (!invite || (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) || (invite.maxUses != null && invite.useCount >= invite.maxUses)) throw new Error("Invite not found")
    const existing = await tx.worldCupBracketParticipant.findUnique({ where: { challengeId_userId: { challengeId: invite.challengeId, userId: input.user.id } } })
    if (existing) return { challengeId: invite.challengeId, participant: existing }
    const created = await tx.worldCupBracketParticipant.create({ data: { challengeId: invite.challengeId, userId: input.user.id, displayName: name } })
    const claimed = invite.maxUses == null
      ? await tx.worldCupBracketInvite.update({ where: { id: invite.id }, data: { useCount: { increment: 1 } } }).then(() => ({ count: 1 }))
      : await tx.worldCupBracketInvite.updateMany({ where: { id: invite.id, useCount: { lt: invite.maxUses } }, data: { useCount: { increment: 1 } } })
    if (claimed.count !== 1) throw new Error("Invite not found")
    return { challengeId: invite.challengeId, participant: created }
  })
  return { challengeId: result.challengeId, participantId: result.participant.id }
}
function side(match: any, pick: { selectedTeamId?: string | null; selectedSlotKey?: string | null }) { if (pick.selectedTeamId && pick.selectedTeamId === match.homeTeamId) return "home"; if (pick.selectedTeamId && pick.selectedTeamId === match.awayTeamId) return "away"; if (pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey) return "home"; if (pick.selectedSlotKey && pick.selectedSlotKey === match.awaySlotKey) return "away"; return null }
export async function saveWorldCupPicks(input: { challengeId: string; userId: string; picks: Array<{ matchId: string; selectedTeamId?: string | null; selectedSlotKey?: string | null }> }) { const c = await db().worldCupBracketChallenge.findUnique({ where: { id: input.challengeId }, include: { matches: true, participants: { where: { userId: input.userId } } } }); if (!c) throw new Error("Challenge not found"); const participant = c.participants[0]; if (!participant) throw new Error("Join the bracket before making picks"); const byId = new Map<string, any>(c.matches.map((m: any) => [m.id, m] as [string, any])); await db().$transaction(async (tx: any) => { for (const pick of input.picks) { const m = byId.get(pick.matchId); if (!m) throw new Error("Match not found"); if (isWorldCupMatchLocked({ challenge: c, match: m })) throw new Error("This matchup is locked"); const s = side(m, pick); if (!s) throw new Error("Selected team is not in this matchup"); const selectedTeamId = s === "home" ? m.homeTeamId : m.awayTeamId, selectedSlotKey = s === "home" ? m.homeSlotKey : m.awaySlotKey, selectedTeamName = s === "home" ? m.homeTeamName : m.awayTeamName; await tx.worldCupBracketPick.upsert({ where: { matchId_participantId: { matchId: m.id, participantId: participant.id } }, create: { challengeId: c.id, participantId: participant.id, matchId: m.id, round: m.round, selectedTeamId, selectedSlotKey, selectedTeamName }, update: { selectedTeamId, selectedSlotKey, selectedTeamName, round: m.round, isCorrect: null, pointsAwarded: 0 } }); if (m.round === "final") await tx.worldCupBracketParticipant.update({ where: { id: participant.id }, data: { championPickTeamId: selectedTeamId, championPickName: selectedTeamName } }) } }); await recalculateWorldCupChallenge(c.id); return getWorldCupChallengeView({ challengeId: c.id, user: { id: input.userId } }) }
export async function createAdditionalWorldCupInvite(input: { challengeId: string; createdByUserId: string; maxUses?: number | null; expiresAt?: Date | null }) { const inviteCode = await generateWorldCupInviteCode(), inviteUrl = `${getWorldCupAppBaseUrl()}/join/bracket/${inviteCode}`; const invite = await db().worldCupBracketInvite.create({ data: { challengeId: input.challengeId, inviteCode, createdByUserId: input.createdByUserId, maxUses: input.maxUses ?? null, expiresAt: input.expiresAt ?? null } }); return { inviteCode: invite.inviteCode, inviteUrl } }
export async function updateWorldCupChallengeSettings(input: { challengeId: string; name?: string; visibility?: "public" | "private"; pickLockStrategy?: "per_match" | "tournament_start"; pickLockAt?: Date | null; status?: string }) { return db().worldCupBracketChallenge.update({ where: { id: input.challengeId }, data: { name: input.name, visibility: input.visibility, pickLockStrategy: input.pickLockStrategy, pickLockAt: input.pickLockAt, status: input.status } }) }
export async function listUserWorldCupChallenges(userId: string) { const rows = await db().worldCupBracketParticipant.findMany({ where: { userId }, include: { challenge: { include: { _count: { select: { participants: true } } } } }, orderBy: { joinedAt: "desc" } }); return rows.map((r: any) => ({ id: r.challenge.id, name: r.challenge.name, seasonYear: r.challenge.seasonYear, inviteCode: r.challenge.inviteCode, status: r.challenge.status, participantCount: r.challenge._count.participants, totalScore: r.totalScore, rank: r.rank, joinedAt: iso(r.joinedAt) })) }
