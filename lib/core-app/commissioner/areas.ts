/**
 * Commissioner Hub — where everything lives (brief items 2, 4 and 9).
 *
 *   - `buildLeagueAreas`     every league area, and where it is actually run
 *   - `buildWorkflows`       step-by-step guides for the four jobs the brief names
 *   - `buildCommunities`     Discord, announcements, calendar, payments, platform
 *
 * ⚠ EVERY LINK HERE POINTS AT A SCREEN THAT EXISTS AND WORKS, and an imported
 * league is told where the change is really made. AllFantasy cannot write to
 * Sleeper (its API is read-only), so a "Change settings" button that opened an
 * AllFantasy form for a Sleeper league would record a change that never reaches
 * the league. `resolveActionAuthority` decides that per action, the same way
 * Commissioner OS does; nothing here re-derives it.
 *
 * ⚠ PLATFORM LINKS ARE VERIFIED OR ABSENT. `verifiedHandoff` returns null for a
 * URL format nobody has confirmed lands where it says (MFL, Fantrax,
 * Fleaflicker, and every provider's settings screen), and the step then names
 * the platform in words instead of linking somewhere that might be wrong.
 *
 * Client-safe: no Prisma.
 */

import { resolveActionAuthority } from '@/lib/commissioner-os/authority'
import { verifiedHandoff, platformLabel, type LinkLeague, type PlatformLink } from '@/lib/core-app/platformLinks'

export type HubLink = { label: string; href: string; external: boolean }

export type HubLeague = LinkLeague & {
  id: string
  name: string
  platform: string
  /** True when AllFantasy is this league's system of record. */
  native: boolean
}

function q(leagueId: string): string {
  return `?league=${encodeURIComponent(leagueId)}`
}

function leaguePage(leagueId: string, view: string): string {
  return `/league/${encodeURIComponent(leagueId)}?view=${encodeURIComponent(view)}`
}

function toHubLink(link: PlatformLink | null): HubLink | null {
  return link ? { label: link.label, href: link.href, external: link.external } : null
}

// ── League areas ────────────────────────────────────────────────────────────

export type LeagueArea = {
  key:
    | 'overview'
    | 'settings'
    | 'members'
    | 'standings'
    | 'schedule'
    | 'drafts'
    | 'trades'
    | 'waivers'
    | 'history'
    | 'announcements'
    | 'intelligence'
  label: string
  description: string
  link: HubLink
  /** Where a CHANGE is made, when that is not the page above. */
  changeOn: HubLink | null
  /** Short note for imported leagues: this page is a read of the platform. */
  note: string | null
}

export function buildLeagueAreas(league: HubLeague): LeagueArea[] {
  const pl = platformLabel(league.platform)
  const onPlatform = league.native ? null : toHubLink(verifiedHandoff(league, 'league'))
  const readNote = league.native ? null : `Read from ${pl}. Changes are made there.`
  const core = (screen: string) => `/core/${screen}${q(league.id)}`

  return [
    {
      key: 'overview',
      label: 'Overview',
      description: 'Standings snapshot, this week, and what changed.',
      link: { label: 'Open overview', href: `/core${q(league.id)}`, external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'settings',
      label: 'Settings',
      description: 'Scoring, rosters, waivers, trades, draft and playoffs.',
      link: { label: 'Open settings', href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : `A read-only summary here. Rules are changed on ${pl}.`,
    },
    {
      key: 'members',
      label: 'Members',
      description: 'Who manages each team, invites, and co-commissioners.',
      link: { label: 'Manage members', href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native
        ? null
        : `Team ownership is set on ${pl}. AllFantasy handles invites to claim a team here.`,
    },
    {
      key: 'standings',
      label: 'Standings',
      description: 'Records, points and playoff picture.',
      link: { label: 'Open standings', href: core('standings'), external: false },
      changeOn: null,
      note: readNote,
    },
    {
      key: 'schedule',
      label: 'Schedule',
      description: 'Every week’s matchups.',
      link: { label: 'Open schedule', href: leaguePage(league.id, 'schedule'), external: false },
      changeOn: onPlatform,
      note: readNote,
    },
    {
      key: 'drafts',
      label: 'Drafts',
      description: 'Draft board, order and results.',
      link: { label: 'Open Draft HQ', href: core('draft-hq'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : `The draft itself runs on ${pl}; Draft HQ follows it.`,
    },
    {
      key: 'trades',
      label: 'Trades',
      description: 'Offers, completed deals and review.',
      link: { label: 'Open trades', href: core('trades'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'trade')),
      note: league.native ? null : `Trades are accepted and vetoed on ${pl}.`,
    },
    {
      key: 'waivers',
      label: 'Waivers',
      description: 'Claims, FAAB and the last run.',
      link: { label: 'Open waivers', href: core('waivers'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'waivers')),
      note: league.native ? null : `Claims are processed on ${pl}.`,
    },
    {
      key: 'history',
      label: 'History',
      description: 'Past seasons, champions and all-time records.',
      link: { label: 'Open history', href: core('career'), external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'announcements',
      label: 'Announcements',
      description: 'League chat — where rulings and reminders are posted.',
      link: { label: 'Open league chat', href: leaguePage(league.id, 'league_chat'), external: false },
      changeOn: null,
      note: null,
    },
    {
      // The league Overview's commissioner card used to open this page; it now opens this hub,
      // so the hub has to keep a way there.
      key: 'intelligence',
      label: 'Commissioner intelligence',
      description: 'League and manager health, rivalries, the audit log and the intelligence modules.',
      link: {
        label: 'Open intelligence',
        href: `/league/${encodeURIComponent(league.id)}/intelligence`,
        external: false,
      },
      changeOn: null,
      note: null,
    },
  ]
}

// ── Guided workflows ────────────────────────────────────────────────────────

export type WorkflowStep = {
  title: string
  body: string
  link: HubLink | null
}

export type Workflow = {
  key: 'replace-manager' | 'change-rule' | 'schedule-draft' | 'resolve-dispute'
  title: string
  summary: string
  /** Stated up front for an imported league, so step 3 is not a surprise. */
  authorityNote: string | null
  steps: WorkflowStep[]
}

export function buildWorkflows(league: HubLeague): Workflow[] {
  const pl = platformLabel(league.platform)
  /*
   * Team ownership, rules and trade rulings are all EXTERNAL state on an imported
   * league — the platform holds the truth and a re-sync can observe the change.
   * One resolution covers all four guides.
   */
  const authority = resolveActionAuthority({ platform: league.platform, scope: 'external', verifiableFromImport: true })
  const onPlatform = toHubLink(verifiedHandoff(league, 'league'))
  const onPlatformTrade = toHubLink(verifiedHandoff(league, 'trade')) ?? onPlatform
  const chat: HubLink = { label: 'Open league chat', href: leaguePage(league.id, 'league_chat'), external: false }
  const settings: HubLink = { label: 'Open league settings', href: leaguePage(league.id, 'settings'), external: false }
  const resync: HubLink = { label: 'Re-sync this league', href: `/core/sync${q(league.id)}`, external: false }
  const platformStep = (what: string, link: HubLink | null): WorkflowStep => ({
    title: `Make the change on ${pl}`,
    body: `${pl} is this league’s system of record, so ${what} happens there. ${
      link ? '' : `Open the league in ${pl} and use its commissioner tools.`
    }`.trim(),
    link,
  })

  const replace: Workflow = {
    key: 'replace-manager',
    title: 'Replace a manager',
    summary: 'Find the team nobody is running, hand it to someone new, and tell the league.',
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: authority.canExecute
      ? [
          {
            title: 'Confirm who has gone quiet',
            body: 'Member activity below lists every manager with no owner or no move in 14 days.',
            link: { label: 'See member activity', href: '#ch-members', external: false },
          },
          {
            title: 'Open the team up',
            body: 'Orphan teams lists ownerless teams and lets you advertise one or hand it to an AI manager for now.',
            link: { label: 'Open orphan teams', href: `/league/${encodeURIComponent(league.id)}/orphan-teams`, external: false },
          },
          {
            title: 'Invite the replacement',
            body: 'Send your league’s invite link. The new manager joins and takes over the open team.',
            link: settings,
          },
          {
            title: 'Tell the league',
            body: 'Post who is taking over, so nobody is surprised by a new name in the standings.',
            link: chat,
          },
        ]
      : [
          {
            title: 'Confirm who has gone quiet',
            body: 'Member activity below lists every manager with no owner or no move in 14 days.',
            link: { label: 'See member activity', href: '#ch-members', external: false },
          },
          platformStep('changing a team’s owner', onPlatform),
          {
            title: 'Re-sync so AllFantasy sees the new owner',
            body: 'Until the next sync, AllFantasy still shows the old manager on that team.',
            link: resync,
          },
          {
            title: 'Invite them to claim the team here',
            body: 'Your league’s invite link lets the new manager connect the team to their AllFantasy account.',
            link: settings,
          },
          {
            title: 'Tell the league',
            body: 'Post who is taking over, so nobody is surprised by a new name in the standings.',
            link: chat,
          },
        ],
  }

  const pollStep: WorkflowStep = {
    title: 'Put it to a vote',
    body: 'Post a poll in league chat and give it a deadline — open votes show on this page and in the calendar until they close.',
    link: chat,
  }

  const changeRule: Workflow = {
    key: 'change-rule',
    title: 'Change a rule',
    summary: 'Check what the league runs on today, get the league’s agreement, apply it, and record it.',
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: 'Check the current rule',
        body: '“How this league runs” below shows the trade deadline, playoffs and waivers as they stand.',
        link: { label: 'See current rules', href: '#ch-rules', external: false },
      },
      pollStep,
      ...(authority.canExecute
        ? [
            {
              title: 'Apply it in settings',
              body: 'Every saved change is written to the league’s audit log and appears in the timeline on this page.',
              link: settings,
            },
          ]
        : [
            platformStep('changing a rule', onPlatform),
            {
              title: 'Re-sync so the change shows here',
              body: 'AllFantasy reads the new rule on the next sync.',
              link: resync,
            },
          ]),
      {
        title: 'Announce the change',
        body: 'Say what changed and from which week, in league chat, so the ruling is on the record.',
        link: chat,
      },
    ],
  }

  const scheduleDraft: Workflow = {
    key: 'schedule-draft',
    title: 'Schedule a draft',
    summary: 'Pick a time that works, set it, and make sure every manager has it.',
    authorityNote: league.native ? null : `${pl} runs this league’s draft, so the date is set there.`,
    steps: [
      {
        title: 'Find a time that works',
        body: 'Post a poll with two or three options and a deadline a few days out.',
        link: chat,
      },
      league.native
        ? {
            title: 'Set the draft date',
            body: 'Draft settings hold the date, draft type, pick timer and order. Once saved, it appears in this page’s calendar and calendar export.',
            link: settings,
          }
        : platformStep('setting the draft date', onPlatform),
      league.native
        ? {
            title: 'Lock in the draft order',
            body: 'Randomize or set the order in draft settings before draft day.',
            link: settings,
          }
        : {
            title: 'Follow it from Draft HQ',
            body: 'Draft HQ picks the draft up from the platform once it starts.',
            link: { label: 'Open Draft HQ', href: `/core/draft-hq${q(league.id)}`, external: false },
          },
      {
        title: 'Announce the date',
        body: league.native
          ? 'Post it in league chat. Managers can also add it to their calendars from the export on this page.'
          : 'Post the date and time in league chat, with the time zone.',
        link: chat,
      },
    ],
  }

  const resolveDispute: Workflow = {
    key: 'resolve-dispute',
    title: 'Resolve a dispute',
    summary: 'Get the facts, check the rule, rule on it, and put the ruling on the record.',
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: 'Get the facts',
        body: 'The trade or move in question, its date and who was involved — the Trades screen and the timeline on this page have both.',
        link: { label: 'Open trades', href: `/core/trades${q(league.id)}`, external: false },
      },
      {
        title: 'Check the rule',
        body: 'Read what the league actually runs on before ruling, so the decision rests on the rule and not on memory.',
        link: { label: 'See current rules', href: '#ch-rules', external: false },
      },
      authority.canExecute
        ? {
            title: 'Review it in the league',
            body: 'Pending trades can be approved or vetoed from the league’s Trades tab.',
            link: { label: 'Open trade review', href: leaguePage(league.id, 'trades'), external: false },
          }
        : platformStep('vetoing or reversing a move', onPlatformTrade),
      {
        title: 'If it’s a judgment call, let the league decide',
        body: 'A poll with a deadline keeps the ruling from being yours alone.',
        link: chat,
      },
      {
        title: 'Post the ruling',
        body: 'State the decision and the rule behind it in league chat — that post is the league’s record of it.',
        link: chat,
      },
    ],
  }

  return [replace, changeRule, scheduleDraft, resolveDispute]
}

// ── External communities ────────────────────────────────────────────────────

export type CommunityChannel = {
  key: 'discord' | 'announcements' | 'calendar' | 'payments' | 'platform'
  label: string
  status: 'connected' | 'available' | 'unavailable'
  detail: string
  link: HubLink | null
}

export type CommunitiesInput = {
  league: HubLeague
  /** The viewer is `League.userId` — the only role the Discord and broadcast routes accept. */
  viewerIsOwner: boolean
  discord: { guildName: string | null; channelName: string | null } | null
  datedEventCount: number
  payment: { link: string | null; provider: string | null; tracked: boolean }
  claimedTeams: number
  totalTeams: number
}

export function buildCommunities(input: CommunitiesInput): CommunityChannel[] {
  const { league } = input
  const pl = platformLabel(league.platform)
  const out: CommunityChannel[] = []

  out.push(
    input.discord
      ? {
          key: 'discord',
          label: 'Discord',
          status: 'connected',
          detail: `League chat relays to ${input.discord.channelName ? `#${input.discord.channelName}` : 'a channel'}${
            input.discord.guildName ? ` in ${input.discord.guildName}` : ''
          }.`,
          link: input.viewerIsOwner
            ? { label: 'Manage the bridge', href: `/core/discord${q(league.id)}`, external: false }
            : null,
        }
      : {
          key: 'discord',
          label: 'Discord',
          status: input.viewerIsOwner ? 'available' : 'unavailable',
          detail: input.viewerIsOwner
            ? 'Relay league chat to your Discord server, both ways.'
            : 'Not connected. Only the league owner can connect Discord.',
          link: input.viewerIsOwner
            ? { label: 'Connect Discord', href: `/core/discord${q(league.id)}`, external: false }
            : null,
        },
  )

  out.push({
    key: 'announcements',
    label: 'Email & announcements',
    status: input.claimedTeams > 0 ? 'available' : 'unavailable',
    detail:
      input.claimedTeams > 0
        ? `A league-chat post reaches the ${input.claimedTeams} of ${input.totalTeams} managers with AllFantasy accounts, by in-app, email or text as each has chosen.${
            input.viewerIsOwner && league.native ? ' An @everyone announcement notifies all of them at once.' : ''
          }`
        : 'No manager has connected an AllFantasy account yet, so there is nobody to email. Invite managers to claim their teams.',
    link: { label: 'Open league chat', href: leaguePage(league.id, 'league_chat'), external: false },
  })

  out.push({
    key: 'calendar',
    label: 'Calendar',
    status: input.datedEventCount > 0 ? 'available' : 'unavailable',
    detail:
      input.datedEventCount > 0
        ? `Download the league’s ${input.datedEventCount} dated ${input.datedEventCount === 1 ? 'event' : 'events'} as a calendar file for Google, Apple or Outlook.`
        : 'Nothing on this league’s calendar has a date yet, so there is nothing to export.',
    link: null,
  })

  out.push(
    input.payment.link
      ? {
          key: 'payments',
          label: 'Payment link',
          status: 'connected',
          detail: `Dues are collected through ${providerName(input.payment.provider)}.`,
          link: { label: `Open ${providerName(input.payment.provider)}`, href: input.payment.link, external: true },
        }
      : {
          key: 'payments',
          label: 'Payment link',
          status: 'available',
          detail: input.payment.tracked
            ? 'Dues are tracked, but no payment link is set. Add a LeagueSafe or FanCred link in the dues tracker.'
            : 'Track dues and add a LeagueSafe or FanCred link in the league’s dues tracker.',
          link: { label: 'Open dues tracker', href: leaguePage(league.id, 'settings'), external: false },
        },
  )

  if (league.native) {
    out.push({
      key: 'platform',
      label: 'Source platform',
      status: 'connected',
      detail: 'This league runs on AllFantasy — there is no other platform to keep in step.',
      link: null,
    })
  } else {
    const link = toHubLink(verifiedHandoff(league, 'league'))
    out.push({
      key: 'platform',
      label: pl,
      status: link ? 'connected' : 'available',
      detail: link
        ? `Rules, rosters and rulings are applied on ${pl}. AllFantasy re-reads the league on every sync.`
        : `Rules, rosters and rulings are applied on ${pl}. A direct link to this league on ${pl} isn’t verified yet.`,
      link,
    })
  }

  return out
}

function providerName(provider: string | null): string {
  const p = (provider ?? '').toLowerCase()
  if (p === 'leaguesafe') return 'LeagueSafe'
  if (p === 'fancred') return 'FanCred'
  return 'the league’s payment link'
}
