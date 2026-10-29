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
import { messagesFor } from '@/lib/i18n/messages'
import { commissionerAreasMessages } from '@/lib/core-app/messages/commissionerAreas'

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

export function buildLeagueAreas(league: HubLeague, language = 'en'): LeagueArea[] {
  const m = messagesFor(commissionerAreasMessages, language)
  const pl = platformLabel(league.platform)
  const onPlatform = league.native ? null : toHubLink(verifiedHandoff(league, 'league'))
  const readNote = league.native ? null : m.areaReadNote(pl)
  const core = (screen: string) => `/core/${screen}${q(league.id)}`

  return [
    {
      key: 'overview',
      label: m.areaOverviewLabel,
      description: m.areaOverviewDescription,
      link: { label: m.areaOverviewLink, href: `/core${q(league.id)}`, external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'settings',
      label: m.areaSettingsLabel,
      description: m.areaSettingsDescription,
      link: { label: m.areaSettingsLink, href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : m.areaSettingsNote(pl),
    },
    {
      key: 'members',
      label: m.areaMembersLabel,
      description: m.areaMembersDescription,
      link: { label: m.areaMembersLink, href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : m.areaMembersNote(pl),
    },
    {
      key: 'standings',
      label: m.areaStandingsLabel,
      description: m.areaStandingsDescription,
      link: { label: m.areaStandingsLink, href: core('standings'), external: false },
      changeOn: null,
      note: readNote,
    },
    {
      key: 'schedule',
      label: m.areaScheduleLabel,
      description: m.areaScheduleDescription,
      link: { label: m.areaScheduleLink, href: leaguePage(league.id, 'schedule'), external: false },
      changeOn: onPlatform,
      note: readNote,
    },
    {
      key: 'drafts',
      label: m.areaDraftsLabel,
      description: m.areaDraftsDescription,
      link: { label: m.openDraftHq, href: core('draft-hq'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : m.areaDraftsNote(pl),
    },
    {
      key: 'trades',
      label: m.areaTradesLabel,
      description: m.areaTradesDescription,
      link: { label: m.openTrades, href: core('trades'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'trade')),
      note: league.native ? null : m.areaTradesNote(pl),
    },
    {
      key: 'waivers',
      label: m.areaWaiversLabel,
      description: m.areaWaiversDescription,
      link: { label: m.areaWaiversLink, href: core('waivers'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'waivers')),
      note: league.native ? null : m.areaWaiversNote(pl),
    },
    {
      key: 'history',
      label: m.areaHistoryLabel,
      description: m.areaHistoryDescription,
      link: { label: m.areaHistoryLink, href: core('career'), external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'announcements',
      label: m.areaAnnouncementsLabel,
      description: m.areaAnnouncementsDescription,
      link: { label: m.openLeagueChat, href: leaguePage(league.id, 'league_chat'), external: false },
      changeOn: null,
      note: null,
    },
    {
      // The league Overview's commissioner card used to open this page; it now opens this hub,
      // so the hub has to keep a way there.
      key: 'intelligence',
      label: m.areaIntelligenceLabel,
      description: m.areaIntelligenceDescription,
      link: {
        label: m.areaIntelligenceLink,
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

export function buildWorkflows(league: HubLeague, language = 'en'): Workflow[] {
  const m = messagesFor(commissionerAreasMessages, language)
  const pl = platformLabel(league.platform)
  /*
   * Team ownership, rules and trade rulings are all EXTERNAL state on an imported
   * league — the platform holds the truth and a re-sync can observe the change.
   * One resolution covers all four guides.
   */
  const authority = resolveActionAuthority({ platform: league.platform, scope: 'external', verifiableFromImport: true })
  const onPlatform = toHubLink(verifiedHandoff(league, 'league'))
  const onPlatformTrade = toHubLink(verifiedHandoff(league, 'trade')) ?? onPlatform
  const chat: HubLink = { label: m.openLeagueChat, href: leaguePage(league.id, 'league_chat'), external: false }
  const settings: HubLink = { label: m.wfOpenLeagueSettings, href: leaguePage(league.id, 'settings'), external: false }
  const resync: HubLink = { label: m.wfResync, href: `/core/sync${q(league.id)}`, external: false }
  const platformStep = (what: string, link: HubLink | null): WorkflowStep => ({
    title: m.wfPlatformStepTitle(pl),
    body: m.wfPlatformStepBody(pl, what, !!link).trim(),
    link,
  })

  const replace: Workflow = {
    key: 'replace-manager',
    title: m.wfReplaceTitle,
    summary: m.wfReplaceSummary,
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: authority.canExecute
      ? [
          {
            title: m.wfReplaceQuietTitle,
            body: m.wfReplaceQuietBody,
            link: { label: m.wfReplaceQuietLink, href: '#ch-members', external: false },
          },
          {
            title: m.wfReplaceOpenTeamTitle,
            body: m.wfReplaceOpenTeamBody,
            link: { label: m.wfReplaceOpenTeamLink, href: `/league/${encodeURIComponent(league.id)}/orphan-teams`, external: false },
          },
          {
            title: m.wfReplaceInviteTitle,
            body: m.wfReplaceInviteBody,
            link: settings,
          },
          {
            title: m.wfTellLeagueTitle,
            body: m.wfTellLeagueBody,
            link: chat,
          },
        ]
      : [
          {
            title: m.wfReplaceQuietTitle,
            body: m.wfReplaceQuietBody,
            link: { label: m.wfReplaceQuietLink, href: '#ch-members', external: false },
          },
          platformStep(m.wfReplacePlatformWhat, onPlatform),
          {
            title: m.wfReplaceResyncTitle,
            body: m.wfReplaceResyncBody,
            link: resync,
          },
          {
            title: m.wfReplaceClaimTitle,
            body: m.wfReplaceClaimBody,
            link: settings,
          },
          {
            title: m.wfTellLeagueTitle,
            body: m.wfTellLeagueBody,
            link: chat,
          },
        ],
  }

  const pollStep: WorkflowStep = {
    title: m.wfPollTitle,
    body: m.wfPollBody,
    link: chat,
  }

  const changeRule: Workflow = {
    key: 'change-rule',
    title: m.wfRuleTitle,
    summary: m.wfRuleSummary,
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: m.wfRuleCheckTitle,
        body: m.wfRuleCheckBody,
        link: { label: m.wfSeeCurrentRules, href: '#ch-rules', external: false },
      },
      pollStep,
      ...(authority.canExecute
        ? [
            {
              title: m.wfRuleApplyTitle,
              body: m.wfRuleApplyBody,
              link: settings,
            },
          ]
        : [
            platformStep(m.wfRulePlatformWhat, onPlatform),
            {
              title: m.wfRuleResyncTitle,
              body: m.wfRuleResyncBody,
              link: resync,
            },
          ]),
      {
        title: m.wfRuleAnnounceTitle,
        body: m.wfRuleAnnounceBody,
        link: chat,
      },
    ],
  }

  const scheduleDraft: Workflow = {
    key: 'schedule-draft',
    title: m.wfDraftTitle,
    summary: m.wfDraftSummary,
    authorityNote: league.native ? null : m.wfDraftAuthorityNote(pl),
    steps: [
      {
        title: m.wfDraftFindTimeTitle,
        body: m.wfDraftFindTimeBody,
        link: chat,
      },
      league.native
        ? {
            title: m.wfDraftSetDateTitle,
            body: m.wfDraftSetDateBody,
            link: settings,
          }
        : platformStep(m.wfDraftPlatformWhat, onPlatform),
      league.native
        ? {
            title: m.wfDraftOrderTitle,
            body: m.wfDraftOrderBody,
            link: settings,
          }
        : {
            title: m.wfDraftFollowTitle,
            body: m.wfDraftFollowBody,
            link: { label: m.openDraftHq, href: `/core/draft-hq${q(league.id)}`, external: false },
          },
      {
        title: m.wfDraftAnnounceTitle,
        body: league.native ? m.wfDraftAnnounceNativeBody : m.wfDraftAnnounceImportedBody,
        link: chat,
      },
    ],
  }

  const resolveDispute: Workflow = {
    key: 'resolve-dispute',
    title: m.wfDisputeTitle,
    summary: m.wfDisputeSummary,
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: m.wfDisputeFactsTitle,
        body: m.wfDisputeFactsBody,
        link: { label: m.openTrades, href: `/core/trades${q(league.id)}`, external: false },
      },
      {
        title: m.wfDisputeRuleTitle,
        body: m.wfDisputeRuleBody,
        link: { label: m.wfSeeCurrentRules, href: '#ch-rules', external: false },
      },
      authority.canExecute
        ? {
            title: m.wfDisputeReviewTitle,
            body: m.wfDisputeReviewBody,
            link: { label: m.wfDisputeReviewLink, href: leaguePage(league.id, 'trades'), external: false },
          }
        : platformStep(m.wfDisputePlatformWhat, onPlatformTrade),
      {
        title: m.wfDisputeJudgmentTitle,
        body: m.wfDisputeJudgmentBody,
        link: chat,
      },
      {
        title: m.wfDisputePostTitle,
        body: m.wfDisputePostBody,
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
  /** The viewer is `League.userId` — the only role the Discord bridge routes accept. */
  viewerIsOwner: boolean
  /** The viewer may send an @everyone announcement here (commissioner or co-commissioner, native league). */
  viewerCanBroadcast: boolean
  discord: { guildName: string | null; channelName: string | null } | null
  datedEventCount: number
  payment: { link: string | null; provider: string | null; tracked: boolean }
  claimedTeams: number
  totalTeams: number
  /** The reader's language; default English. */
  language?: string
}

export function buildCommunities(input: CommunitiesInput): CommunityChannel[] {
  const { league } = input
  const m = messagesFor(commissionerAreasMessages, input.language)
  const pl = platformLabel(league.platform)
  const out: CommunityChannel[] = []

  out.push(
    input.discord
      ? {
          key: 'discord',
          label: 'Discord',
          status: 'connected',
          detail: m.commDiscordConnectedDetail(input.discord.channelName, input.discord.guildName),
          link: input.viewerIsOwner
            ? { label: m.commDiscordManage, href: `/core/discord${q(league.id)}`, external: false }
            : null,
        }
      : {
          key: 'discord',
          label: 'Discord',
          status: input.viewerIsOwner ? 'available' : 'unavailable',
          detail: input.viewerIsOwner
            ? m.commDiscordAvailableDetail
            : m.commDiscordUnavailableDetail,
          link: input.viewerIsOwner
            ? { label: m.commDiscordConnect, href: `/core/discord${q(league.id)}`, external: false }
            : null,
        },
  )

  out.push({
    key: 'announcements',
    label: m.commAnnouncementsLabel,
    status: input.claimedTeams > 0 ? 'available' : 'unavailable',
    detail:
      input.claimedTeams > 0
        ? m.commAnnouncementsReach(input.claimedTeams, input.totalTeams) + (input.viewerCanBroadcast ? m.commAnnouncementsBroadcast : '')
        : m.commAnnouncementsNobody,
    link: { label: m.openLeagueChat, href: leaguePage(league.id, 'league_chat'), external: false },
  })

  out.push({
    key: 'calendar',
    label: m.commCalendarLabel,
    status: input.datedEventCount > 0 ? 'available' : 'unavailable',
    detail:
      input.datedEventCount > 0
        ? m.commCalendarDownload(input.datedEventCount)
        : m.commCalendarEmpty,
    link: null,
  })

  out.push(
    input.payment.link
      ? {
          key: 'payments',
          label: m.commPaymentLabel,
          status: 'connected',
          detail: m.commPaymentCollected(providerName(input.payment.provider, input.language)),
          link: {
            label: m.commPaymentOpen(providerName(input.payment.provider, input.language)),
            href: input.payment.link,
            external: true,
          },
        }
      : {
          key: 'payments',
          label: m.commPaymentLabel,
          status: 'available',
          detail: input.payment.tracked
            ? m.commPaymentTrackedNoLink
            : m.commPaymentUntracked,
          link: { label: m.commPaymentOpenTracker, href: leaguePage(league.id, 'settings'), external: false },
        },
  )

  if (league.native) {
    out.push({
      key: 'platform',
      label: m.commPlatformNativeLabel,
      status: 'connected',
      detail: m.commPlatformNativeDetail,
      link: null,
    })
  } else {
    const link = toHubLink(verifiedHandoff(league, 'league'))
    out.push({
      key: 'platform',
      label: pl,
      status: link ? 'connected' : 'available',
      detail: link
        ? m.commPlatformLinkedDetail(pl)
        : m.commPlatformUnlinkedDetail(pl),
      link,
    })
  }

  return out
}

function providerName(provider: string | null, language?: string): string {
  const p = (provider ?? '').toLowerCase()
  if (p === 'leaguesafe') return 'LeagueSafe'
  if (p === 'fancred') return 'FanCred'
  return messagesFor(commissionerAreasMessages, language).commPaymentFallbackProvider
}
