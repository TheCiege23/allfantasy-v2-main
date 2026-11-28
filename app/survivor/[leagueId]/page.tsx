'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { TribeCard } from '@/app/survivor/components/TribeCard'
import { islandChallengeScopeWord, islandExileCountLine, islandHeroCopy, islandTribeTotals } from '@/lib/survivor/survivorIslandView'
import type { SurvivorSeasonPlayer } from '@/lib/survivor/survivorUiTypes'
import { SurvivorHubBanner } from '@/app/survivor/components/SurvivorHubBanner'
import { legacyIslandScene } from '@/lib/survivor/survivorLegacyIsland'
import { SurvivorStatusCard } from '@/app/survivor/components/SurvivorStatusCard'
import { buildSurvivorStatusCard } from '@/lib/survivor/survivorStatusCard'
import { SurvivorChallengeBoardCard } from '@/components/survivor/SurvivorChallengeBoardCard'
import { SurvivorStateCard } from '@/components/survivor/core/SurvivorStateCard'
import { SvkSkeleton } from '@/components/survivor/core/SurvivorKit'

function parseDeadlineMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

export default function SurvivorIslandHomePage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const tribes = ctx.season?.tribes ?? []
  const phase = ctx.leaguePhase
  const postMerge = phase === 'merge' || phase === 'jury' || phase === 'finale'
  const council = ctx.season?.activeCouncil
  const ch = ctx.season?.currentChallenge
  const us = ctx.season?.userState
  const scene = legacyIslandScene({ phase, councilStatus: council?.status, challengeStatus: ch?.status, playerState: ctx.playerState })
  const [showIntro, setShowIntro] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (ctx.survivorModeEnabled && us?.userId) {
      setShowIntro(true)
    }
  }, [ctx.survivorModeEnabled, us?.userId])

  const playersByTribe = new Map<string, SurvivorSeasonPlayer[]>()
  for (const p of ctx.season?.players ?? []) {
    const tid = p.tribeId ?? '_none'
    const arr = playersByTribe.get(tid) ?? []
    arr.push(p)
    playersByTribe.set(tid, arr)
  }

  const voteEnd = parseDeadlineMs(council?.voteDeadlineAt ?? council?.votingDeadline ?? null)
  const challengeEnd = parseDeadlineMs(ch?.locksAt ?? ch?.lockAt ?? null)
  const scoresByUser = new Map((ctx.season?.weeklyScores ?? []).map(score => [score.userId, score]))
  const tribeTotals = islandTribeTotals(ctx.season?.weeklyScores ?? [])

  // The banner names what is happening; the status card below carries the deadline as a fact, once.
  const hero = useMemo(() => islandHeroCopy({
    councilStatus: council?.status,
    voteEnd,
    challengeStatus: ch?.status,
    challengeEnd,
    phase,
    now,
    challengeText: ch?.description || ch?.instructions,
  }), [council?.status, ch?.description, ch?.instructions, ch?.status, challengeEnd, now, phase, voteEnd])

  const statusCard = buildSurvivorStatusCard({ season: ctx.season, canVote: ctx.canVote, canSubmitChallenge: ctx.canSubmitChallenge, base, now })

  const primaryAction = phase === 'pre_draft' || phase === 'drafting'
    ? { href: `/league/${leagueId}/draft`, label: 'Open draft board' }
    : council?.status === 'voting_open'
      ? { href: `${base}/tribal`, label: ctx.canVote && !hero.voteClosed ? 'Cast your vote' : 'View council' }
      : ch?.status === 'open' && !hero.challengeClosed
        ? { href: `${base}/challenges`, label: 'Open challenge' }
        : { href: `${base}/tribe`, label: 'View tribe standings' }

  /*
   * ⚠ NO SEASON YET MEANS "WAIT" OR "IT FAILED", NEVER "PRE-DRAFT". Until /api/survivor/season answers,
   * `leaguePhase` defaults to 'pre_draft', so this page used to draw a pre-draft island — "Survivor
   * League", "Pre Draft · Week 1", "Tribes form after the draft", "Open draft board" — for a league in
   * week 9; and when the read FAILED it drew that permanently, with nothing saying so (2026-11-07).
   * Same rule SurvivorNativeHome already follows. After every hook, so hook order is unchanged.
   */
  if (!ctx.season && ctx.error) {
    return (
      <div className="min-h-screen px-3 py-4 md:px-6 md:py-6">
        <div className="survivor-panel rounded-xl px-4 py-6">
          <SurvivorStateCard state="island_error">
            <button type="button" className="sv-btn sv-btn-primary" onClick={() => ctx.refetch()}>Try again</button>
          </SurvivorStateCard>
        </div>
      </div>
    )
  }
  if (!ctx.season) {
    return (
      <div className="min-h-screen px-3 py-4 md:px-6 md:py-6">
        <div className="survivor-panel grid gap-3 rounded-xl px-4 py-5" role="status" aria-label="Loading the island" data-testid="survivor-island-loading">
          <SvkSkeleton height={22} width="55%" />
          <SvkSkeleton height={12} width="80%" />
          <SvkSkeleton height={12} width="65%" />
          <SvkSkeleton height={44} width="40%" radius={10} />
        </div>
        <div className="survivor-panel mt-3 grid gap-3 rounded-xl px-4 py-4" aria-hidden>
          {[0, 1, 2].map((i) => <SvkSkeleton key={i} height={40} radius={10} />)}
        </div>
      </div>
    )
  }

  return (
    <>
      <SurvivorFirstEntryModal
        leagueId={leagueId}
        userId={us?.userId ?? 'viewer'}
        enabled={showIntro}
        onClose={() => setShowIntro(false)}
        visualThemeId={ctx.season?.visualThemeId}
      />
      {leagueId ? <LeagueClipOverlayHost leagueId={leagueId} variant="survivor" enabled /> : null}
      <div className="min-h-screen px-3 py-4 md:px-6 md:py-6">
      <SurvivorHubBanner
        scene={scene}
        leagueName={ctx.leagueName}
        sport={ctx.leagueSport}
        week={ctx.currentWeek}
        phase={phase}
        headline={hero.title}
        description={hero.subtext}
        primaryAction={primaryAction}
        secondaryAction={{ href: `/league/${leagueId}`, label: 'League dashboard' }}
      />
      {/*
        The strip that sat here repeated the status card below — a "VULNERABLE" badge and "Private
        advantage held" over a card saying "Your tribe is at Tribal Council" and "Idols: You hold 1".
        Only the commissioner's link survives.
      */}
      {ctx.isCommissioner ? (
        <div className="mt-3 flex justify-end text-[13px]"><Link href={`${base}/commissioner`} className="sv-link">Commissioner hub →</Link></div>
      ) : null}
      {statusCard && phase !== 'pre_draft' && phase !== 'drafting' ? <SurvivorStatusCard card={statusCard} /> : null}

      {/* Tribes or individual */}
      {!postMerge ? (
        <section className="mt-6">
          <h2 className="sv-kicker mb-3 text-[12px]">
            Tribe standings
          </h2>
          {tribes.length === 0 ? (
            <div className="survivor-panel rounded-2xl p-5 text-sm text-white/75">
              <p className="sv-h text-[15px]">Tribes form after the draft</p>
              <p className="mt-1">The tribe board will show members and weekly scores once rosters are finalized.</p>
              <Link href={`/league/${leagueId}/draft`} className="sv-link mt-3 inline-block">Open draft board</Link>
            </div>
          ) : <div className={`flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible ${tribes.length >= 4 ? 'lg:grid-cols-4' : tribes.length === 3 ? 'lg:grid-cols-3' : ''}`}>
            {tribes.map((t) => {
              const n = playersByTribe.get(t.id)?.length ?? t.members?.length ?? 0
              const attending = council?.attendingTribeId === t.id && council?.status === 'voting_open'
              return (
                <TribeCard
                  key={t.id}
                  tribe={t}
                  memberCount={n}
                  weeklyScore={tribeTotals.get(t.id)}
                  status={attending ? 'tribal' : 'neutral'}
                />
              )
            })}
          </div>}
        </section>
      ) : (
        <section className="mt-6">
          <h2 className="sv-kicker mb-3 text-[12px]">
            Individual standings
          </h2>
          <div className="survivor-panel overflow-x-auto rounded-xl">
            <table className="w-full min-w-[320px] text-left text-[12px]">
              <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(ctx.season?.players ?? []).map((p, i) => (
                  <tr key={p.userId} className="border-b border-white/[0.04]">
                    <td className="px-3 py-2 font-mono tabular-nums text-white/60">{i + 1}</td>
                    <td className="px-3 py-2 text-white">{p.displayName}</td>
                    <td className="sv-score px-3 py-2 font-mono">{scoresByUser.has(p.userId) ? scoresByUser.get(p.userId)!.finalScore.toFixed(1) : 'No score yet'}</td>
                    <td className="px-3 py-2">
                      {p.hasImmunityThisWeek ? (
                        <span className="sv-immune text-[11px] font-semibold">Immune</span>
                      ) : (
                        <span className="text-[11px] text-white/35">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Challenge module */}
      <section className="mt-6">
        <div className="survivor-panel rounded-2xl sv-torch-bar p-4 md:p-5">
          <h2 className="sv-kicker text-[12px]">
            Challenge status
          </h2>
          {ch ? (
            <>
              <p className="sv-h mt-2 text-lg">{ch.title || 'Island challenge'}</p>
              <p className="mt-1 text-[12px] text-white/55">
                {islandChallengeScopeWord(ch.scope)}
              </p>
              <p className="mt-2 text-[13px] text-white/70">{ch.description || ch.instructions}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
                    ch.status === 'open' ? 'sv-chip-torch' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {ch.status === 'open' ? 'Open' : ch.status ?? '—'}
                </span>
                <Link href={`${base}/challenges`} className="sv-link text-[12px]">
                  View challenge →
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-white/50">No open challenge right now.</p>
          )}
        </div>
      </section>

      {/* Commissioner challenges and the manager's own rewards (choose a tribemate / steal target). */}
      {/* Open commissioner challenges only, two at most; results and rewards live on the Challenges page. */}
      {leagueId && phase !== 'pre_draft' && phase !== 'drafting' ? <SurvivorChallengeBoardCard leagueId={leagueId} compact allHref={`${base}/challenges`} /> : null}

      {/* Exile / jury modules */}
      {ctx.season?.exileStatus?.isActive ? (
        <section className="mt-6 rounded-2xl border border-violet-500/25 bg-violet-950/20 p-4">
          <h2 className="sv-kicker text-[12px] !text-violet-200">Exile Island</h2>
          <p className="mt-2 text-[13px] text-white/70">
            {ctx.season.exileMembershipHidden === true && ctx.playerState !== 'exile'
              ? 'Who is on Exile is secret in this league.'
              : `${islandExileCountLine((ctx.season.players ?? []).filter((p) => p.playerState === 'exile').length)}. Exiles can earn their way back.`}
          </p>
          <Link href={`${base}/exile`} className="mt-2 inline-block text-[12px] text-violet-300">
            Open Exile →
          </Link>
        </section>
      ) : null}

      {(phase === 'jury' || phase === 'finale') && (
        <section className="survivor-panel mt-6 rounded-2xl p-4">
          <h2 className="sv-kicker text-[12px]">Jury</h2>
          <p className="mt-2 text-[13px] text-white/70">
            Jury of {(ctx.season?.players ?? []).filter((p) => p.isJuryMember).length}
          </p>
          <Link href={`${base}/jury`} className="sv-link mt-2 inline-block text-[12px]">
            Jury chamber →
          </Link>
        </section>
      )}

      {phase === 'merge' ? (
        <div className="mt-6 flex justify-center">
          <Link
            href={`${base}/merge`}
            className="sv-chip-torch rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-wider"
          >
            🌊 Watch merge moment
          </Link>
        </div>
      ) : null}

      {phase === 'finale' ? (
        <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-amber-500/5 to-transparent" />
      ) : null}
    </div>
    </>
  )
}
