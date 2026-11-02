import "server-only"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { getPlayoffBracketView } from "./playoffService"
import { gameHasLocked } from "./bracketCoach"
import { advanceScoreSnapshot, defaultBracketAlerts, entryChecklist, pendingBracketAlerts, provisionalStandings, readBracketAlerts, scoreLedger,
  type BracketAlert, type BracketAlertPreferences, type BracketExperience, type ProjectionEntry, type ScoreSnapshot } from "./bracketExperience"
import type { PlayoffChallengeView, PlayoffSport } from "./types"
import { bracketCompanionCopy } from "@/lib/brackets/bracketCompanionCopy"

const snapshotKey = (id: string) => `bracket-experience:v1:entry:${id}`
// Older developer clients predate these deployed schema columns. Keep this read port narrow;
// generating a client in the shared dependency directory would overwrite another checkout's client.
const finalizedEntryReader = prisma.playoffBracketEntry as unknown as { findMany(input: {
  where: { challengeId: string; finalizedAt: { not: null } }; select: { id: true; tiebreakerTotalScore: true }
}): Promise<Array<{ id: string; tiebreakerTotalScore: number | null }>> }
const projectionEntries = (view: PlayoffChallengeView, tie: Map<string, number | null> = new Map()): ProjectionEntry[] => view.entries.map(e => ({
  id: e.id, name: e.name, totalScore: e.totalScore ?? 0, correctPicks: e.correctPicks ?? 0, finalizedAt: e.finalizedAt ?? null, rank: e.rank ?? null, tiebreakerTotalScore: tie.get(e.id) ?? null,
}))
export async function loadProvisionalStandings(view: PlayoffChallengeView) {
  if (!view.series.some(g => g.bestOf === 1)) return null
  const locked = view.series.filter(g => g.bestOf === 1 && g.status === "in_progress" && gameHasLocked(g, Date.now())).map(g => g.id)
  const entries = await finalizedEntryReader.findMany({ where: { challengeId: view.challenge.id, finalizedAt: { not: null } }, select: { id: true, tiebreakerTotalScore: true } })
  const picks = locked.length ? await prisma.playoffBracketPick.findMany({ where: { challengeId: view.challenge.id, entryId: { in: entries.map(e => e.id) }, seriesId: { in: locked } }, select: { entryId: true, seriesId: true, pickTeamName: true } }) : []
  return provisionalStandings(view, projectionEntries(view, new Map(entries.map(e => [e.id,e.tiebreakerTotalScore]))), picks)
}
export async function loadBracketExperience(view: PlayoffChallengeView): Promise<BracketExperience> {
  const owned = view.activeEntry?.userId === view.viewerUserId
  const ledger = owned ? scoreLedger(view) : []
  // A failed auxiliary read does not replace existing verified totals or become fabricated history.
  const [snapshot, profile, standings] = await Promise.all([
    (async () => { try { return owned ? await prisma.sportsDataCache.findUnique({ where: { cacheKey: snapshotKey(view.activeEntry!.id) }, select: { data: true } }) : null } catch { return null } })(),
    (async () => { try { return view.viewerUserId ? await prisma.userProfile.findUnique({ where: { userId: view.viewerUserId }, select: { notificationPreferences: true } }) : null } catch { return null } })(),
    loadProvisionalStandings(view).catch(() => null),
  ])
  const state = snapshot?.data as ScoreSnapshot | null
  return { checklist: entryChecklist(view), ledger, officialTotal: owned ? view.activeEntry!.totalScore ?? 0 : 0, explainedTotal: ledger.reduce((sum,r) => sum + r.points,0),
    history: { available: state?.version === 1, since: state?.since ?? null, events: state?.version === 1 ? state.events : [], trimmed: state?.trimmed ?? 0 },
    alerts: profile ? readBracketAlerts(profile.notificationPreferences, view.challenge.id) : { ...defaultBracketAlerts },
    scheduledTracking: !view.challenge.isTestMode && (
      ["nba_cup", "nfl", "nba", "nhl"].includes(view.challenge.sport) ||
      view.challenge.sport === "ncaaf" && process.env.BRACKET_AUTO_RESULT_SYNC_ENABLED === "true"
    ), standings }
}
/** Optimistic compare-and-swap retains simultaneous changes to other settings and other pools. */
export async function saveBracketAlerts(userId: string, challengeId: string, preferences: BracketAlertPreferences) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { notificationPreferences: true, updatedAt: true } })
    if (!profile) throw new Error("PROFILE_REQUIRED")
    const previous = (profile.notificationPreferences && typeof profile.notificationPreferences === "object" ? profile.notificationPreferences : {}) as Record<string, any>
    const next = { ...previous, bracketCoach: { ...(previous.bracketCoach ?? {}), [challengeId]: preferences } }
    const result = await prisma.userProfile.updateMany({ where: { userId, updatedAt: profile.updatedAt }, data: { notificationPreferences: next } })
    if (result.count) return preferences
  }
  throw new Error("PREFERENCES_CHANGED")
}
type StoredSnapshot = ScoreSnapshot & { pendingAlerts?: BracketAlert[] }
const snapshotExpiry = (season: number) => new Date(Date.UTC(Math.max(season + 2, new Date().getUTCFullYear() + 1),0,1))
async function observeEntry(view: PlayoffChallengeView, prefs: BracketAlertPreferences) {
  const entry = view.activeEntry!
  const key = snapshotKey(entry.id), now = Date.now(), observedAt = new Date(now).toISOString()
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`
    if (!lock?.acquired) return null
    const row = await tx.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } })
    const previous = row?.data as StoredSnapshot | null
    // A slower concurrent sweep cannot rewind a newer baseline.
    if (previous?.observedAt && Date.parse(previous.observedAt) >= now) return null
    const ledger = scoreLedger(view)
    if (previous?.rows.some(before => { const after = ledger.find(r => r.id === before.id); return after && before.sourceAt && (!after.sourceAt || Date.parse(before.sourceAt) > Date.parse(after.sourceAt)) })) return null
    const next = advanceScoreSnapshot(previous?.version === 1 ? previous : null, ledger, entry.rank ?? null, observedAt)
    const retained = (previous?.pendingAlerts ?? []).filter(a => Date.parse(a.deadline) > now)
    const candidates = pendingBracketAlerts(view, prefs, previous?.version === 1 ? previous : null, next, now)
    const pending = prefs.enabled ? [...retained, ...candidates.filter(a => !retained.some(p => p.key === a.key))].slice(0, 30) : []
    const data: StoredSnapshot = { ...next, pendingAlerts: pending }
    await tx.sportsDataCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, data: data as never, expiresAt: snapshotExpiry(view.challenge.seasonYear) }, update: { data: data as never, expiresAt: snapshotExpiry(view.challenge.seasonYear) } })
    return data
  }, { timeout: 10000 })
}
async function deliverEntryAlerts(view: PlayoffChallengeView, prefs: BracketAlertPreferences, snapshot: StoredSnapshot) {
  const profile = await prisma.userProfile.findUnique({ where: { userId: view.activeEntry!.userId }, select: { notificationPreferences: true } })
  prefs = readBracketAlerts(profile?.notificationPreferences, view.challenge.id)
  if (!prefs.enabled) return 0
  const copy = bracketCompanionCopy(prefs.locale), entry = view.activeEntry!, key = snapshotKey(entry.id)
  const pending = (snapshot.pendingAlerts ?? []).filter(a => Date.parse(a.deadline) > Date.now() && prefs[a.kind === "missing" ? "missingPicks" : a.kind === "lock" ? "locks" : a.kind === "result" ? "results" : "rankChanges"])
  let delivered = 0
  // One summary per entry per sweep; bursty finals/locks never become one push per game.
  if (!pending.length) return 0
  const digest = createHash("sha256").update(pending.map(a => a.key).sort().join("|")).digest("hex")
  const soon = pending.filter(a => a.kind === "missing" || a.kind === "lock")
  const title = soon.length ? copy.alertSoon : copy.alertUpdate
  const body = prefs.spoilerSafe ? copy.alertPrivate : soon.length ? copy.alertLocks(soon.length) : copy.alertResults(pending.filter(a => a.kind === "result").reduce((sum,a) => sum + a.count,0))
  const { dispatchNotification } = await import("@/lib/notifications/NotificationDispatcher")
  const result = await dispatchNotification({ userIds: [entry.userId], category: "bracket_updates", productType: "bracket", type: "bracket_personal_update", title, body,
    actionHref: `/brackets/leagues/${view.challenge.id}/entries/${entry.id}`, actionLabel: copy.openEntry,
    dedupePrefix: `bracket-coach:${entry.id}:${digest}`, skipChannels: { sms: true }, meta: { eventKey: digest, expiresAt: new Date(Math.min(...pending.map(a => Date.parse(a.deadline)))).toISOString(), spoilerSafe: prefs.spoilerSafe, challengeId: view.challenge.id, bracketAlertKinds: [...new Set(pending.map(a => a.kind))] },
  })
  if (!result.failed) {
    delivered = result.delivered
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      const row = await tx.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } })
      const current = row?.data as StoredSnapshot | null
      if (!current?.version) return
      const sent = new Set(pending.map(a => a.key))
      await tx.sportsDataCache.update({ where: { cacheKey: key }, data: { data: { ...current, pendingAlerts: (current.pendingAlerts ?? []).filter(a => !sent.has(a.key)), alertKeys: [...new Set([...current.alertKeys, ...sent])].slice(-200) } as never } })
    })
  }
  return delivered
}
/** Authenticated crons observe results and upcoming locks; page GETs never publish alerts or write history. */
export async function sweepBracketExperience(sport: PlayoffSport, season: number, challengeIds?: string[]) {
  if (challengeIds && !challengeIds.length) return { processed: 0, alerts: 0, failures: 0 }
  const cursorKey = `bracket-experience:v1:cursor:${sport}:${season}`
  const stored = await prisma.sportsDataCache.findUnique({ where: { cacheKey: cursorKey }, select: { data: true } })
  const cursor = (stored?.data as { pool?: string; entry?: string } | null) ?? {}
  const pools = await prisma.playoffBracketChallenge.findMany({
    where: {
      sport, seasonYear: season, isTestMode: false,
      ...(challengeIds
        ? { id: { in: challengeIds, ...(cursor.pool ? { gte: cursor.pool } : {}) } }
        : cursor.pool ? { id: { gte: cursor.pool } } : {}),
    },
    orderBy: { id: "asc" }, take: 6, select: { id: true },
  })
  let processed = 0, alerts = 0, failures = 0, last: { pool?: string; entry?: string } = {}
  for (const pool of pools) {
    if (processed >= 100) break
    const entries = await prisma.playoffBracketEntry.findMany({ where: { challengeId: pool.id, ...(pool.id === cursor.pool && cursor.entry ? { id: { gt: cursor.entry } } : {}) }, orderBy: { id: "asc" }, take: 101 - processed, select: { id: true, userId: true } })
    const batch = entries.slice(0,100 - processed)
    // One canonical pool read per batch rather than rebuilding the complete pool per participant.
    const base = batch.length ? await getPlayoffBracketView({ challengeId: pool.id, user: null }) : null
    const picks = base ? await prisma.playoffBracketPick.findMany({ where: { challengeId: pool.id, entryId: { in: batch.map(e => e.id) } } }) : []
    for (const entry of batch) {
      try {
        const canonical = base?.entries.find(e => e.id === entry.id && e.userId === entry.userId)
        if (!base || !canonical) throw new Error("ENTRY_SNAPSHOT_UNAVAILABLE")
        const view: PlayoffChallengeView = { ...base, viewerUserId: entry.userId, activeEntry: canonical, picks: picks.filter(p => p.entryId === entry.id).map(p => ({ ...p, createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : "", updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : "" })) }
        const profile = await prisma.userProfile.findUnique({ where: { userId: entry.userId }, select: { notificationPreferences: true } })
        const prefs = readBracketAlerts(profile?.notificationPreferences, pool.id)
        const snapshot = await observeEntry(view,prefs)
        if (snapshot) alerts += await deliverEntryAlerts(view,prefs,snapshot)
      } catch { failures++ }
      processed++; last = { pool: pool.id, entry: entry.id }
    }
    if (entries.length > batch.length) break
    last = { pool: pool.id, entry: "~" }
  }
  if (pools.length < 6 && processed < 100) last = {}
  await prisma.sportsDataCache.upsert({ where: { cacheKey: cursorKey }, create: { cacheKey: cursorKey, data: last, expiresAt: snapshotExpiry(season) }, update: { data: last, expiresAt: snapshotExpiry(season) } })
  return { processed, alerts, failures }
}
