import 'server-only'

import { prisma } from '@/lib/prisma'
import { getBaseUrl } from '@/lib/get-base-url'
import { createEmailUnsubscribeToken } from '@/lib/email/marketing-email'
import { createLeagueTradeGrader, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { buildPendingTradeOfferEmail } from '@/lib/trade-intel/tradeGradeEmail'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import type { NormalizedOffer } from './providerTradeOfferLedger'
import type { PendingTradeAsset } from './scanPendingSleeperTrades'
import { espnTeamId } from './espnTradeOffers'
import { gradeEspnOfferViews, viewsForRows, type EspnLedgerRow } from './espnOfferView'
import { espnOfferNotice, offerNeedsViewer } from './syncEspnTradeOffers'

/**
 * ESPN pending offers → the offer notice (bell, push AND the designed offer email) and the DM card
 * between the two managers. Called by `syncEspnTradeOffers.ts` for offers it has just seen for the
 * first time. DB-first: everything here reads our own tables; nothing calls ESPN.
 *
 * The Sleeper equivalents are `notifyOffers` / `postOfferToManagersDm` in
 * `lib/trade-intel/tradeNotifyService.ts`; the rules are the same and are restated where they bite.
 *
 * 🛑 PRIVACY (owner rule, `contracts/espn/GAPS.md` T-03): only the managers IN an offer ever hear of
 * it. The sweep already drops offers its team is not in; every function here re-checks, so a caller
 * that hands it a third-party offer still announces nothing.
 */

type LeagueRow = { id: string; userId: string; platformLeagueId: string; season: number | null; name: string | null }

const NOTIFY_CLAIM_TTL_MS = 45 * 24 * 60 * 60 * 1000

/** An AllFantasy user on one side of an offer, with THEIR OWN copy of the league. */
export type EspnPartyUser = { userId: string; teamId: string; rowId: string; rowName: string | null; teamName?: string | null }

type DispatchArgs = Parameters<typeof import('@/lib/notifications/NotificationDispatcher').dispatchNotification>[0]
type PostDmArgs = Parameters<typeof import('@/lib/chat-notifications/tradeOfferSources').postImportedOfferToDm>[0]

export type EspnNotifyDeps = {
  /** Every AllFantasy user who CLAIMED one of these ESPN teams on any AllFantasy copy of the league. */
  partyUsers: (platformLeagueId: string, teamIds: string[]) => Promise<EspnPartyUser[]>
  views: typeof viewsForRows
  grader: (rowId: string, userId: string) => Promise<LeagueTradeGrader | null>
  /** true = ours to send. A store failure answers false: no duplicate sends. */
  claim: (key: string, now: Date) => Promise<boolean>
  /** The user's address, and whether they turned trade emails off (`EmailPreference`). */
  emailContext: (userId: string) => Promise<{ email: string | null; tradeEmailsOff: boolean }>
  dispatch: (input: DispatchArgs) => Promise<unknown>
  postDm: (input: PostDmArgs) => Promise<unknown>
  baseUrl: () => string
  unsubscribeUrl: (email: string) => string
}

type PartyRow = {
  id: string
  name: string | null
  userId: string
  teams: ReadonlyArray<{ externalId: string; claimedByUserId: string | null; teamName?: string | null }>
}

/**
 * PURE. Claims on every copy → one entry per user. A user who claimed two different teams in this
 * league identifies no single side and is left out — guessing which side they are on is how an
 * offer reaches the wrong person.
 */
export function partyUsersFromRows(rows: ReadonlyArray<PartyRow>, teamIds: readonly string[]): EspnPartyUser[] {
  const wanted = new Set(teamIds.map((t) => espnTeamId(t)).filter((t): t is string => !!t))
  const teamsByUser = new Map<string, Set<string>>()
  const nameByTeam = new Map<string, string>()
  for (const row of rows) {
    for (const t of row.teams) {
      const teamId = espnTeamId(t.externalId)
      if (!teamId || !t.claimedByUserId) continue
      teamsByUser.set(t.claimedByUserId, (teamsByUser.get(t.claimedByUserId) ?? new Set<string>()).add(teamId))
      if (t.teamName?.trim() && !nameByTeam.has(teamId)) nameByTeam.set(teamId, t.teamName.trim())
    }
  }
  const out: EspnPartyUser[] = []
  for (const [userId, teams] of teamsByUser) {
    if (teams.size !== 1) continue
    const teamId = [...teams][0]!
    if (!wanted.has(teamId)) continue
    // Their OWN copy: the row they imported, else the first row they claimed on.
    const own = rows.find((r) => r.userId === userId) ?? rows.find((r) => r.teams.some((t) => t.claimedByUserId === userId))
    if (!own) continue
    out.push({ userId, teamId, rowId: own.id, rowName: own.name, teamName: nameByTeam.get(teamId) ?? null })
  }
  return out
}

async function claimOnce(key: string, now: Date): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({
      data: { cacheKey: key, data: { claimedAt: now.toISOString() }, expiresAt: new Date(now.getTime() + NOTIFY_CLAIM_TTL_MS) },
    })
    return true
  } catch {
    return false
  }
}

const defaultDeps: EspnNotifyDeps = {
  partyUsers: async (platformLeagueId, teamIds) => {
    const rows = await prisma.league
      .findMany({
        where: { platform: { equals: 'espn', mode: 'insensitive' }, sport: 'NFL', platformLeagueId },
        select: {
          id: true,
          name: true,
          userId: true,
          teams: { where: { claimedByUserId: { not: null } }, select: { externalId: true, claimedByUserId: true, teamName: true } },
        },
        orderBy: { id: 'asc' },
      })
      .catch(() => [] as PartyRow[])
    return partyUsersFromRows(rows as PartyRow[], teamIds)
  },
  views: viewsForRows,
  grader: (rowId, userId) => createLeagueTradeGrader({ leagueId: rowId, userId }).catch(() => null),
  claim: claimOnce,
  emailContext: async (userId) => {
    const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null)
    const email = user?.email?.trim() || null
    if (!email) return { email: null, tradeEmailsOff: true }
    const pref = await prisma.emailPreference
      .findFirst({ where: { email }, select: { tradeAlerts: true, unsubscribedAt: true } })
      .catch(() => null)
    return { email, tradeEmailsOff: pref?.tradeAlerts === false || pref?.unsubscribedAt != null }
  },
  dispatch: async (input) => (await import('@/lib/notifications/NotificationDispatcher')).dispatchNotification(input),
  postDm: async (input) => (await import('@/lib/chat-notifications/tradeOfferSources')).postImportedOfferToDm(input),
  baseUrl: () => getBaseUrl(),
  unsubscribeUrl: (email) => `${getBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(createEmailUnsubscribeToken(email))}`,
}

const ledgerRowOf = (o: NormalizedOffer, now: Date): EspnLedgerRow => ({
  providerTradeId: o.providerTradeId,
  status: o.status,
  proposedByRosterId: o.proposedByRosterId,
  rosterIds: o.rosterIds,
  consentedRosterIds: o.consentedRosterIds,
  proposedAt: o.proposedAt,
  firstSeenAt: now,
  expiresAt: o.expiresAt ?? null,
  assets: o.assets,
})

/** The recipient's OWN copy of the league, on the trades view. */
export const espnOfferHref = (rowId: string) => `/league/${encodeURIComponent(rowId)}?view=trades`

const espnLeagueUrl = (platformLeagueId: string) =>
  `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(platformLeagueId)}`

const inOffer = (o: NormalizedOffer, teamId: string) => o.rosterIds.includes(teamId) || o.proposedByRosterId === teamId

/** The one claim key per (recipient's row, offer, recipient) — the key that row's own sweep uses. */
export const espnOfferNotifyKey = (rowId: string, offerId: string, userId: string) =>
  `espn-offer-notify:v1:${rowId}:${offerId}:${userId}`

/**
 * The first time an offer waits on an AllFantasy user: ONE notice — bell, push and the designed
 * offer email — per user per offer.
 *
 * WHO: the managers IN the offer who still have to answer it. Never the proposer, never a team that
 * already accepted, never anyone else in the league. That is this row's connected user and any
 * AllFantasy user who claimed the other team, each graded on and linked to THEIR OWN copy.
 *
 * ONCE: a claim per (that user's row, offer, user), the key their own sweep uses too, so whichever
 * copy sees the offer first sends it.
 *
 * PREFERENCES: the dispatcher applies the `trade_proposals` channel settings, quiet hours, the mail
 * unsubscribe and undeliverable domains; the trade-email switch (`EmailPreference.tradeAlerts`) is
 * honoured here, as the Sleeper offer email honours it. Email off never silences the bell or push.
 */
export async function notifyNewEspnOffers(
  args: { league: LeagueRow; viewerTeamId: string; offers: NormalizedOffer[]; now: Date },
  over: Partial<EspnNotifyDeps> = {},
): Promise<number> {
  const d: EspnNotifyDeps = { ...defaultDeps, ...over }
  const me = espnTeamId(args.viewerTeamId)
  if (!me) return 0
  let sent = 0
  for (const offer of args.offers) {
    if (!inOffer(offer, me)) continue
    const party = await d.partyUsers(args.league.platformLeagueId, offer.rosterIds).catch(() => [] as EspnPartyUser[])
    const recipients = new Map<string, EspnPartyUser>()
    recipients.set(args.league.userId, { userId: args.league.userId, teamId: me, rowId: args.league.id, rowName: args.league.name })
    for (const p of party) if (!recipients.has(p.userId) && inOffer(offer, p.teamId)) recipients.set(p.userId, p)

    for (const r of recipients.values()) {
      if (!offerNeedsViewer(offer, r.teamId, args.now)) continue
      const [view] = await d.views({ leagueId: r.rowId, rows: [ledgerRowOf(offer, args.now)], viewerTeamId: r.teamId }).catch(() => [])
      if (!view) continue
      if (!(await d.claim(espnOfferNotifyKey(r.rowId, offer.providerTradeId, r.userId), args.now))) continue
      const grader = await d.grader(r.rowId, r.userId).catch(() => null)
      const grade = (await gradeEspnOfferViews([view], grader)).get(view.trade.transactionId) ?? null
      const { title, body } = espnOfferNotice({ leagueName: r.rowName, view, grade })
      const mail = await d.emailContext(r.userId).catch(() => ({ email: null, tradeEmailsOff: true }))
      const href = espnOfferHref(r.rowId)
      let emailOverride: { subject: string; html: string } | null = null
      if (mail.email && !mail.tradeEmailsOff) {
        const e = buildPendingTradeOfferEmail({
          leagueName: r.rowName?.trim() || 'your ESPN league',
          proposerName: view.trade.proposedBy,
          youGet: view.trade.assetsReceived,
          youGive: view.trade.assetsGiven,
          reviewUrl: `${d.baseUrl()}${href}`,
          provider: 'espn',
          providerUrl: espnLeagueUrl(args.league.platformLeagueId),
          dropNote: view.dropLine,
          grade,
          baseUrl: d.baseUrl(),
          leagueId: r.rowId,
          unsubscribeUrl: d.unsubscribeUrl(mail.email),
        })
        emailOverride = { subject: e.subject, html: e.html }
      }
      await d
        .dispatch({
          userIds: [r.userId],
          category: 'trade_proposals',
          type: 'trade_proposed',
          title,
          body,
          actionHref: href,
          actionLabel: 'Review offer',
          leagueId: r.rowId,
          severity: 'medium',
          dedupePrefix: `espn-offer:v1:${offer.providerTradeId}`,
          meta: { leagueId: r.rowId, provider: 'espn', providerTradeId: offer.providerTradeId, expiresAt: view.expiresAt },
          skipChannels: emailOverride ? { sms: true } : { email: true, sms: true },
          ...(emailOverride ? { emailOverride } : {}),
        })
        .then(() => {
          sent += 1
        })
        .catch(() => undefined)
    }
  }
  return sent
}

/**
 * The offer card in the DM between the two managers — ONLY when BOTH ESPN teams are claimed, by two
 * different AllFantasy users. A team nobody here claimed has nobody to receive it, and we never open
 * a conversation with someone who is not on AllFantasy.
 *
 * Once per offer: `postTradeOfferToDm` claims `trade-dm:v1:espn:<espnLeagueId>:<offerId>:offer` before
 * anything else, so every copy of the league may call this and only the first posts. Two teams only;
 * each manager's link opens their own copy. A conditional drop rides on the dropping side's list,
 * labelled as a drop — it is part of what that side pays, and no team receives him.
 */
export async function postEspnOfferDms(
  args: { league: LeagueRow; viewerTeamId: string; offers: NormalizedOffer[]; now: Date },
  over: Partial<EspnNotifyDeps> = {},
): Promise<number> {
  const d: EspnNotifyDeps = { ...defaultDeps, ...over }
  const me = espnTeamId(args.viewerTeamId)
  if (!me) return 0
  let posted = 0
  for (const offer of args.offers) {
    if (offer.status !== 'pending' || offer.rosterIds.length !== 2 || !offer.rosterIds.includes(me)) continue
    const proposerTeam = espnTeamId(offer.proposedByRosterId)
    if (!proposerTeam || !offer.rosterIds.includes(proposerTeam)) continue
    const receiverTeam = offer.rosterIds.find((t) => t !== proposerTeam)
    if (!receiverTeam) continue
    const party = await d.partyUsers(args.league.platformLeagueId, offer.rosterIds).catch(() => [] as EspnPartyUser[])
    const onlyUser = (teamId: string) => {
      const users = party.filter((p) => p.teamId === teamId)
      return users.length === 1 ? users[0]! : null
    }
    const proposer = onlyUser(proposerTeam)
    const receiver = onlyUser(receiverTeam)
    if (!proposer || !receiver || proposer.userId === receiver.userId) continue

    // From the proposer's side: what they give (and drop); what the receiver gives (and drops).
    const [view] = await d.views({ leagueId: proposer.rowId, rows: [ledgerRowOf(offer, args.now)], viewerTeamId: proposerTeam }).catch(() => [])
    if (!view) continue
    const label = (a: PendingTradeAsset) => ({
      label: a.playerName,
      detail: [a.position, a.team].filter((v) => v && v !== '—').join(' · ') || null,
    })
    const dropped = (a: PendingTradeAsset) => ({ label: a.playerName, detail: 'dropped if it goes through' })
    const result = await d
      .postDm({
        provider: 'espn',
        providerLeagueId: args.league.platformLeagueId,
        transactionId: offer.providerTradeId,
        leagueId: proposer.rowId,
        leagueName: proposer.rowName ?? args.league.name ?? null,
        proposer: {
          userId: proposer.userId,
          manager: safeDisplayName([proposer.teamName], `Team ${proposerTeam}`),
          gives: [...view.trade.assetsGiven.map(label), ...view.drops.viewer.map(dropped)],
          href: espnOfferHref(proposer.rowId),
        },
        receiver: {
          userId: receiver.userId,
          manager: safeDisplayName([receiver.teamName], `Team ${receiverTeam}`),
          gives: [...view.trade.assetsReceived.map(label), ...view.drops.partner.map(dropped)],
          href: espnOfferHref(receiver.rowId),
        },
        directionKnown: true,
        createdAt: offer.proposedAt ? offer.proposedAt.toISOString() : null,
      })
      .catch(() => null)
    if ((result as { posted?: boolean } | null)?.posted) posted += 1
  }
  return posted
}
