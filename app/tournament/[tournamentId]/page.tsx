'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { AdvancementOverlay, EliminationOverlay } from '@/app/tournament/components/AdvancementCard'
import { TournamentStatusCard } from '@/app/tournament/components/TournamentStatusCard'
import { LeagueIdentityCard } from '@/app/tournament/components/LeagueIdentityCard'
import { RoundProgressBar } from '@/app/tournament/components/RoundProgressBar'
import { ForumPostCard } from '@/app/tournament/components/ForumPostCard'
import { MiniCommissionerHub } from '@/app/tournament/[tournamentId]/components/MiniCommissionerHub'
import { KingBuffaloPresentedBy } from '@/components/tournament/KingBuffaloPresentedBy'
import { CommissionerHubHeader } from '@/components/commissioner-hub/CommissionerHubHeader'
import {
  CommissionerFeederGrid,
  type FeederCard,
} from '@/components/commissioner-hub/CommissionerFeederGrid'
import { resolveHubAccent } from '@/lib/commissioner-hub/feeder-accent'
import { LEAGUE_TYPE_MEDIA } from '@/lib/create-league-v2/theme'
import type { LanguageCode } from '@/lib/i18n/constants'

function formatConferenceOrdinal(rank: number, lang: LanguageCode): string {
  if (lang === 'es') return `${rank}.º`
  const m = rank % 10
  const m100 = rank % 100
  if (m100 >= 11 && m100 <= 13) return `${rank}th`
  if (m === 1) return `${rank}st`
  if (m === 2) return `${rank}nd`
  if (m === 3) return `${rank}rd`
  return `${rank}th`
}

function useCountdown(
  target: Date | null,
  formatLine: (parts: { d: number; h: number; m: number; s: number }) => string,
) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!target || target.getTime() <= now) return null
  const total = Math.floor((target.getTime() - now) / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return formatLine({ d, h, m, s })
}

export default function TournamentHomePage() {
  const { t, tInterpolate, language } = useLanguage()
  const tournamentId = useParams<{ tournamentId: string }>()?.tournamentId ?? ''
  const base = `/tournament/${tournamentId}`
  const router = useRouter()
  const ctx = useTournamentUi()
  const {
    shell,
    conferences,
    announcements,
    participant,
    viewerUserId,
    hubKind,
    isCommissioner,
    legacyFeederLeagues,
    legacyMiniCommissioners,
    legacyPendingLeagueSettingRequests,
    viewerMiniCommissionerLeagueIds,
    legacyWaitlistUi,
  } = ctx
  const state = useTournamentParticipantState(ctx)

  const conference = useMemo(
    () => conferences.find((c) => c.id === participant?.currentConferenceId) ?? null,
    [conferences, participant?.currentConferenceId],
  )

  const currentRoundMeta = useMemo(
    () => ctx.rounds.find((r) => r.roundNumber === (state.standingsRound?.roundNumber ?? shell.currentRoundNumber)),
    [ctx.rounds, state.standingsRound?.roundNumber, shell.currentRoundNumber],
  )

  const tlFromCtx = useMemo(() => {
    if (!participant?.currentLeagueId) return null
    return ctx.tournamentLeagues.find((l) => l.id === participant.currentLeagueId) ?? null
  }, [ctx.tournamentLeagues, participant?.currentLeagueId])

  const countdownDraft = useCountdown(state.nextDraftAt, (parts) =>
    tInterpolate('tournament.hub.countdown', {
      d: String(parts.d),
      h: String(parts.h),
      m: String(parts.m),
      s: String(parts.s),
    }),
  )
  const within24h =
    state.nextDraftAt && state.nextDraftAt.getTime() - Date.now() < 86400000 && state.nextDraftAt.getTime() > Date.now()

  const isWildcard = state.myStandingsRow?.advancementStatus === 'wildcard_eligible'

  const [elimOpen, setElimOpen] = useState(false)
  const [waitlistBusy, setWaitlistBusy] = useState(false)

  const showWaitlistPanel = Boolean(
    hubKind === 'legacy' &&
      legacyWaitlistUi?.waitlistEnabled &&
      !participant &&
      (legacyWaitlistUi.registrationFull || legacyWaitlistUi.viewerOnWaitlist),
  )

  const joinWaitlist = useCallback(async () => {
    setWaitlistBusy(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/waitlist`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('tournament.hub.waitlist.errorJoin'))
        return
      }
      toast.success(j.already ? t('tournament.hub.waitlist.successAlready') : t('tournament.hub.waitlist.successJoined'))
      router.refresh()
    } finally {
      setWaitlistBusy(false)
    }
  }, [router, t, tournamentId])

  const leaveWaitlist = useCallback(async () => {
    setWaitlistBusy(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/waitlist`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('tournament.hub.waitlist.errorLeave'))
        return
      }
      toast.success(t('tournament.hub.waitlist.successLeft'))
      router.refresh()
    } finally {
      setWaitlistBusy(false)
    }
  }, [router, t, tournamentId])

  useEffect(() => {
    if (state.status !== 'eliminated') return
    try {
      const seen = localStorage.getItem(`tournament-elim-seen-${shell.id}`) === '1'
      setElimOpen(!seen)
    } catch {
      setElimOpen(true)
    }
  }, [state.status, shell.id])

  const dismissElim = () => {
    try {
      localStorage.setItem(`tournament-elim-seen-${shell.id}`, '1')
    } catch {
      /* ignore */
    }
    setElimOpen(false)
  }

  const showAdvanceOverlay = state.status === 'advanced' && !state.hasSeenAdvancement && participant && tlFromCtx

  const conferenceRows = useMemo(() => {
    if (!conference) return []
    const rows = state.standingsLeagues
      .filter((L) => L.conferenceId === conference.id)
      .flatMap((L) => L.participants)
    rows.sort((a, b) => b.pointsFor - a.pointsFor || b.wins - a.wins)
    return rows.slice(0, 8)
  }, [conference, state.standingsLeagues])

  const top5 = conferenceRows.slice(0, 5)

  const globalBoard = useMemo(() => {
    const rows = state.standingsLeagues.flatMap((L) => L.participants)
    rows.sort((a, b) => b.pointsFor - a.pointsFor)
    const idx = viewerUserId ? rows.findIndex((r) => r.userId === viewerUserId) : -1
    return { rows, idx, total: rows.length }
  }, [state.standingsLeagues, viewerUserId])

  const percentile = globalBoard.idx >= 0 && globalBoard.total > 0
    ? Math.round((1 - globalBoard.idx / globalBoard.total) * 100)
    : null

  const latest = announcements[0]

  const copyInvite = useCallback(
    async (url: string, label: string) => {
      if (!url?.trim()) {
        toast.error(t('tournament.hub.copyNoLink'))
        return
      }
      try {
        await navigator.clipboard.writeText(url)
        toast.success(tInterpolate('tournament.hub.copySuccess', { label }))
      } catch {
        toast.error(t('tournament.hub.copyError'))
      }
    },
    [t, tInterpolate],
  )

  const adv = shell.advancersPerLeague
  const bubbleN = shell.bubbleEnabled ? Math.min(shell.bubbleSize, 8) : 0

  const remainingByRound: Record<number, number> = {}
  for (const r of ctx.rounds) {
    const tls = ctx.tournamentLeagues.filter((l) => l.roundId === r.id)
    const n = tls.reduce((acc, l) => acc + l.currentTeamCount, 0)
    remainingByRound[r.roundNumber] = n || shell.currentParticipantCount
  }

  const isFinals = currentRoundMeta?.roundType === 'championship'

  // Commissioner-hub styling — create-league v2 visual language.
  const hubAccent = resolveHubAccent('tournament')
  const tournamentMedia = LEAGUE_TYPE_MEDIA.tournament
  const feederCards: FeederCard[] = useMemo(() => {
    if (!legacyFeederLeagues) return []
    return legacyFeederLeagues.map((row) => ({
      id: row.tournamentLeagueId,
      href: `/league/${row.leagueId}?openChat=league`,
      name: row.name,
      sport: shell.sport ?? null,
      tierLabel: row.conferenceName ?? null,
      inviteCode: row.inviteCode ?? null,
    }))
  }, [legacyFeederLeagues, shell.sport])

  const roundLabelDisplay =
    currentRoundMeta?.roundLabel ??
    tInterpolate('tournament.hub.roundN', { n: String(shell.currentRoundNumber || 1) })

  const commissionerSubtitle = tInterpolate('tournament.hub.commissioner.subtitle', {
    sport: shell.sport,
    current: String(shell.currentParticipantCount),
    max: String(shell.maxParticipants),
    count: String(feederCards.length),
    leagueWord:
      feederCards.length === 1
        ? t('tournament.hub.commissioner.feederLeagueOne')
        : t('tournament.hub.commissioner.feederLeagueMany'),
  })

  const shellStatusLabel =
    shell.status === 'bubble'
      ? t('tournament.hub.status.bubbleWeek')
      : isFinals
        ? t('tournament.hub.status.finals')
        : t('tournament.hub.status.active')

  return (
    <div className={`mx-auto max-w-3xl space-y-4 md:max-w-4xl ${isFinals ? 'rounded-2xl ring-1 ring-yellow-500/20' : ''}`}>
      {shell.status === 'bubble' ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-center text-[13px] font-bold text-amber-100">
          {t('tournament.hub.bubbleWeekBanner')}
        </div>
      ) : null}

      {within24h && state.nextDraftAt ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-50">
          {tInterpolate('tournament.hub.draftSoon', {
            league: tlFromCtx?.name ?? t('tournament.hub.draftSoonYourLeague'),
            when: state.nextDraftAt.toLocaleString(),
          })}
          <Link href={`${base}/drafts`} className="ml-2 font-bold underline">
            {t('tournament.hub.draftsLink')}
          </Link>
        </div>
      ) : null}

      {state.status === 'advanced' && state.hasSeenAdvancement && tlFromCtx ? (
        <div className="rounded-xl border border-yellow-500/50 bg-gradient-to-br from-yellow-500/10 to-transparent p-4 shadow-[0_0_24px_rgba(245,184,0,0.12)]">
          <p className="text-[11px] font-bold uppercase tracking-widest text-yellow-200/90">{t('tournament.hub.newLeagueEyebrow')}</p>
          <p className="mt-1 text-[18px] font-bold text-white">{tlFromCtx.name}</p>
          <p className="mt-2 text-[12px] text-[var(--tournament-text-mid)]">{t('tournament.hub.newLeagueBody')}</p>
          <Link
            href={tlFromCtx.leagueId ? `/league/${tlFromCtx.leagueId}` : `${base}/league`}
            className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-yellow-500/90 px-4 text-[14px] font-bold text-black hover:bg-yellow-400"
          >
            {t('tournament.hub.newLeagueCta')}
          </Link>
        </div>
      ) : null}

      <div
        className={`overflow-hidden rounded-2xl border border-[var(--tournament-border)] bg-gradient-to-r from-[#0a1520] via-[#0c1220] to-[#121028] p-4 md:flex md:items-center md:justify-between md:p-5 ${
          isFinals ? 'from-yellow-900/20' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20 text-2xl">🏆</div>
          <div>
            <h1 className="text-[18px] font-black text-white md:text-[22px]">{shell.name}</h1>
            <p className="text-[11px] text-[var(--tournament-text-dim)]">{shell.sport}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-stretch gap-2 md:mt-0 md:items-end">
          {hubKind === 'legacy' ? (
            <div className="w-full max-w-xs md:self-end">
              <KingBuffaloPresentedBy variant="compact" />
            </div>
          ) : null}
          <span className="self-start rounded-full bg-white/10 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-cyan-200 md:self-end">
            {roundLabelDisplay}
          </span>
          <p className="text-[12px] text-[var(--tournament-text-mid)]">
            {tInterpolate('tournament.hub.participantsLine', {
              current: String(shell.currentParticipantCount),
              max: String(shell.maxParticipants),
            })}
          </p>
        </div>
      </div>

      {showWaitlistPanel && legacyWaitlistUi ? (
        <div
          className="rounded-2xl border border-cyan-500/25 bg-[#081226]/90 p-4 shadow-[0_0_24px_rgba(34,211,238,0.06)]"
          data-testid="tournament-waitlist-panel"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-100/90">{t('tournament.hub.waitlist.title')}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--tournament-text-mid)]">
            {legacyWaitlistUi.viewerOnWaitlist
              ? t('tournament.hub.waitlist.bodyOnList')
              : t('tournament.hub.waitlist.bodyCapacity')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {legacyWaitlistUi.viewerOnWaitlist ? (
              <button
                type="button"
                disabled={waitlistBusy}
                onClick={() => void leaveWaitlist()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-[12px] font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                data-testid="tournament-waitlist-leave"
              >
                {waitlistBusy ? t('tournament.hub.waitlist.busy') : t('tournament.hub.waitlist.leave')}
              </button>
            ) : viewerUserId ? (
              <button
                type="button"
                disabled={waitlistBusy}
                onClick={() => void joinWaitlist()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-cyan-500/25 px-4 text-[12px] font-bold text-cyan-50 ring-1 ring-cyan-400/35 hover:bg-cyan-500/35 disabled:opacity-50"
                data-testid="tournament-waitlist-join"
              >
                {waitlistBusy ? t('tournament.hub.waitlist.busy') : t('tournament.hub.waitlist.join')}
              </button>
            ) : (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(base)}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-cyan-500/25 px-4 text-[12px] font-bold text-cyan-50 ring-1 ring-cyan-400/35 hover:bg-cyan-500/35"
                data-testid="tournament-waitlist-sign-in"
              >
                {t('tournament.hub.waitlist.signIn')}
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {hubKind === 'legacy' && isCommissioner && feederCards.length > 0 ? (
        <>
          <CommissionerHubHeader
            chip={tInterpolate('tournament.hub.commissioner.chip', { round: roundLabelDisplay })}
            title={shell.name}
            subtitle={commissionerSubtitle}
            accent={hubAccent}
            videoSrc={tournamentMedia?.video ?? '/af-crest.png'}
            videoFallback={tournamentMedia?.fallback ?? null}
            stats={[
              { label: t('tournament.hub.stat.feederLeagues'), value: String(feederCards.length) },
              { label: t('tournament.hub.stat.participants'), value: String(shell.currentParticipantCount) },
              {
                label: t('tournament.hub.stat.round'),
                value: currentRoundMeta?.roundLabel ?? `R${shell.currentRoundNumber || 1}`,
              },
              {
                label: t('tournament.hub.stat.status'),
                value: <span className="text-sm font-medium text-white/70">{shellStatusLabel}</span>,
              },
            ]}
            actions={
              <Link
                href={`/tournament/${tournamentId}/commissioner`}
                className={`inline-flex items-center rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white/85 transition hover:bg-white/[0.08] ${hubAccent.text}`}
                data-testid="tournament-commissioner-dashboard-link"
              >
                {t('tournament.hub.commissionerDashboard')}
              </Link>
            }
          />
          <CommissionerFeederGrid
            leagues={feederCards}
            accent={hubAccent}
            title={t('tournament.hub.feederGrid.title')}
            hint={t('tournament.hub.feederGrid.hint')}
            footer={
              <div className="flex flex-wrap gap-2">
                {(legacyFeederLeagues ?? []).map((row) => (
                  <button
                    key={`copy-${row.tournamentLeagueId}`}
                    type="button"
                    onClick={() => void copyInvite(row.joinUrl, row.name)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.06]"
                    title={tInterpolate('tournament.hub.feederGrid.copyTitle', { name: row.name })}
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} aria-hidden />
                    <span className="max-w-[9rem] truncate">{row.name}</span>
                  </button>
                ))}
              </div>
            }
          />
        </>
      ) : null}

      {hubKind === 'legacy' ? (
        <MiniCommissionerHub
          tournamentId={tournamentId}
          isCommissioner={isCommissioner}
          viewerUserId={viewerUserId}
          legacyFeederLeagues={legacyFeederLeagues}
          legacyMiniCommissioners={legacyMiniCommissioners}
          legacyPendingLeagueSettingRequests={legacyPendingLeagueSettingRequests}
          viewerMiniCommissionerLeagueIds={viewerMiniCommissionerLeagueIds}
        />
      ) : null}

      {state.standingsError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
          {state.standingsError}
        </div>
      ) : null}

      {participant ? (
        <TournamentStatusCard
          status={state.status}
          conference={conference}
          league={tlFromCtx}
          shellName={shell.name}
          currentRound={state.currentRound}
          totalRounds={shell.totalRounds}
          recordW={state.myStandingsRow?.wins ?? participant.careerWins}
          recordL={state.myStandingsRow?.losses ?? participant.careerLosses}
          pointsFor={state.myStandingsRow?.pointsFor ?? participant.careerPointsFor}
          conferenceRank={state.conferenceRank}
          basePath={base}
          nextDraftAt={state.nextDraftAt}
          isDraftLive={state.isDraftLive}
          isWildcardAdvance={isWildcard}
        />
      ) : (
        <div className="tournament-panel p-4 text-[13px] text-[var(--tournament-text-mid)]">
          {t('tournament.hub.notRegistered')}
        </div>
      )}

      <div className="rounded-xl border border-orange-500/35 bg-[#0c1219] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-orange-500/20 px-2 py-0.5 text-[11px] font-bold uppercase text-orange-100">
            {state.isDraftLive ? t('tournament.hub.nextEvent.draftMatchup') : t('tournament.hub.nextEvent.nextEvent')}
          </span>
        </div>
        {countdownDraft ? (
          <p className="mt-2 font-mono text-[26px] font-bold tracking-tight text-[var(--tournament-gold)]">
            {countdownDraft}
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-[var(--tournament-text-mid)]">{t('tournament.hub.nextEvent.scheduleUpdates')}</p>
        )}
        <p className="mt-1 text-[12px] text-[var(--tournament-text-dim)]">
          {currentRoundMeta
            ? tInterpolate('tournament.hub.nextEvent.weeksLine', {
                start: String(currentRoundMeta.weekStart),
                end: String(currentRoundMeta.weekEnd),
                label: currentRoundMeta.roundLabel,
              })
            : t('tournament.hub.nextEvent.seasonClock')}
        </p>
        {tlFromCtx?.leagueId ? (
          <Link
            href={`/league/${tlFromCtx.leagueId}`}
            className="mt-3 inline-block text-[13px] font-semibold text-[var(--tournament-active)] hover:underline"
          >
            {t('tournament.hub.nextEvent.goDraftRoom')}
          </Link>
        ) : null}
      </div>

      {tlFromCtx && conference ? (
        <LeagueIdentityCard
          name={tlFromCtx.name}
          conference={conference}
          roundLabel={currentRoundMeta?.roundLabel ?? t('tournament.hub.roundWord')}
          teamSlots={tlFromCtx.teamSlots}
          currentCount={tlFromCtx.currentTeamCount}
          status={tlFromCtx.status}
          leagueId={tlFromCtx.id}
          href={tlFromCtx.leagueId ? `/league/${tlFromCtx.leagueId}` : `${base}/league`}
          leagueIndex={0}
        />
      ) : null}

      {conference && top5.length ? (
        <div className="tournament-panel overflow-x-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-white">{t('tournament.hub.conferenceRace')}</h2>
            <span className="text-[11px] text-[var(--tournament-text-dim)]">{conference.name}</span>
          </div>
          <ul className="space-y-2">
            {top5.map((row, i) => (
              <li
                key={row.id}
                className={`flex items-center gap-3 rounded-lg border border-[var(--tournament-border)] px-3 py-2 text-[12px] ${
                  row.userId === viewerUserId ? 'bg-yellow-500/10' : 'bg-black/20'
                }`}
                style={
                  row.userId === viewerUserId
                    ? { boxShadow: 'inset 3px 0 0 0 var(--tournament-gold)' }
                    : undefined
                }
              >
                <span className="w-6 font-mono font-bold text-white">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-white">{row.participant.displayName}</span>
                <span className="text-[var(--tournament-text-mid)]">
                  {row.wins}-{row.losses}
                </span>
                <span className="font-semibold text-white">{row.pointsFor.toFixed(1)}</span>
                <span className="hidden text-[11px] uppercase text-[var(--tournament-text-dim)] sm:inline">
                  {row.advancementStatus.replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
          {adv > 0 ? (
            <div className="mt-3 border-t border-dashed border-[var(--tournament-gold)]/50 pt-2 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--tournament-gold)]">
              {tInterpolate('tournament.hub.qualificationLine', { adv: String(adv) })}
            </div>
          ) : null}
          {bubbleN > 0 ? (
            <div className="mt-2 border-t border-dashed border-amber-500/50 pt-2 text-center text-[11px] font-bold uppercase tracking-wide text-amber-200">
              {tInterpolate('tournament.hub.bubbleZone', { n: String(bubbleN) })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="tournament-panel p-4">
        <h2 className="text-[13px] font-bold text-white">{t('tournament.hub.overall.title')}</h2>
        {globalBoard.idx >= 0 ? (
          <>
            <p className="mt-2 text-[15px] text-white">
              {tInterpolate('tournament.hub.overall.rankLine', {
                rank: String(globalBoard.idx + 1),
                total: String(globalBoard.total),
              })}
            </p>
            {percentile != null ? (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-yellow-400"
                  style={{ width: `${Math.min(100, percentile)}%` }}
                />
              </div>
            ) : null}
            <p className="mt-2 text-[11px] text-[var(--tournament-text-dim)]">
              {t('tournament.hub.overall.tiebreakerNote')}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-[var(--tournament-text-dim)]">{t('tournament.hub.overall.joinToAppear')}</p>
        )}
      </div>

      <RoundProgressBar
        rounds={ctx.rounds}
        currentRoundNumber={shell.currentRoundNumber || 1}
        remainingByRound={remainingByRound}
      />

      {latest ? (
        <div>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[var(--tournament-text-dim)]">
            {t('tournament.hub.latestAnnouncement')}
          </h2>
          <ForumPostCard
            type={latest.type}
            title={latest.title}
            content={latest.content}
            createdAt={latest.createdAt}
            readOnly={state.status === 'eliminated'}
          />
          <Link href={`${base}/forum`} className="mt-2 inline-block text-[12px] font-semibold text-cyan-300 hover:underline">
            {t('tournament.hub.openForum')}
          </Link>
        </div>
      ) : null}

      {showAdvanceOverlay && participant && tlFromCtx ? (
        <AdvancementOverlay
          open
          variant={isWildcard ? 'wildcard' : 'qualified'}
          fromRound={state.currentRound - 1 > 0 ? state.currentRound - 1 : 1}
          toRound={state.currentRound}
          record={`${state.myStandingsRow?.wins ?? 0}-${state.myStandingsRow?.losses ?? 0}`}
          conferenceRank={
            state.conferenceRank ? formatConferenceOrdinal(state.conferenceRank, language) : '—'
          }
          conferenceName={conference?.name ?? t('tournament.advancement.conferenceFallback')}
          newLeagueName={tlFromCtx.name}
          draftAt={tlFromCtx.draftScheduledAt ? new Date(tlFromCtx.draftScheduledAt).toLocaleString() : null}
          basePath={base}
          onDismiss={state.markAdvancementSeen}
        />
      ) : null}

      {elimOpen ? (
        <EliminationOverlay
          open
          round={state.currentRound}
          record={`${participant?.careerWins ?? 0}-${participant?.careerLosses ?? 0}`}
          pointsFor={participant?.careerPointsFor ?? 0}
          basePath={base}
          onDismiss={dismissElim}
        />
      ) : null}
    </div>
  )
}
