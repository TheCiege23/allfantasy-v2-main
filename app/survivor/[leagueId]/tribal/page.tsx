'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import clsx from 'clsx'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { SurvivorVoteRevealScrolls, type RevealScroll } from '@/components/league/survivor/SurvivorVoteRevealScrolls'
import { SurvivorRevote } from '@/components/survivor/SurvivorRevote'
import { SurvivorVoteCast } from '@/components/survivor/weekly/SurvivorVoteCast'
import { SurvivorWeeklyMoments } from '@/components/survivor/weekly/SurvivorWeeklyMoments'
import { SurvivorAvatar, survivorAvatarStatus } from '@/components/survivor/weekly/SurvivorAvatar'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'

export default function SurvivorTribalPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const council = ctx.season?.activeCouncil
  const week = council?.week ?? ctx.currentWeek
  const tribe = ctx.season?.tribes?.find((t) => t.id === council?.attendingTribeId)

  const attendingPlayers = useMemo(() => {
    const tid = council?.attendingTribeId
    const all = ctx.season?.players ?? []
    if (!tid) return all.filter((p) => p.playerState === 'active')
    return all.filter((p) => p.tribeId === tid && p.playerState !== 'eliminated')
  }, [council?.attendingTribeId, ctx.season?.players])

  const revealSteps: RevealScroll[] = useMemo(() => {
    if (!council?.isRevealed || !Array.isArray(council.revealSequence)) return []
    return council.revealSequence.map((step, index) => ({ order: index + 1, targetName: step.targetName ?? null, status: (step.status ?? 'counts') as RevealScroll['status'], isExtraVote: step.isExtraVote === true }))
  }, [council?.isRevealed, council?.revealSequence])

  const status = council?.status
  const quiet = !council?.isRevealed && (status === 'revealing' || status === 'voting_closed' || status === 'closed')

  if (council?.phase === 'revote') return <SurvivorRevote leagueId={leagueId} />

  if (status === 'voting_open') {
    return (
      <div className="relative px-0 pb-28 pt-0 md:px-6 md:pb-10 md:pt-4" data-testid="survivor-tribal-vote">
        <SurvivorVoteCast
          leagueId={leagueId}
          tribeName={tribe?.name ? stripLeadingTribeIcon(tribe.name) || tribe.name : null}
          backHref={base}
          idolHref={`/league/${encodeURIComponent(leagueId)}?tab=survivor`}
        />
        <p className="mx-auto mt-4 max-w-lg px-3 text-center text-[12px] text-white/45">
          Prefer chat? You can still vote privately with <Link href={`${base}/chimmy`} className="text-amber-200 underline">@Chimmy</Link>. It is the same ballot.
        </p>
      </div>
    )
  }

  return (
    <div className="relative min-h-[75vh] px-3 pb-32 pt-4 md:px-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, rgba(255,68,68,0.25), transparent 40%), radial-gradient(circle at 80% 30%, rgba(255,140,66,0.2), transparent 35%)`,
        }}
      />
      <div className="relative">
        <div className="mx-auto mb-6 max-w-3xl"><SurvivorWeeklyMoments leagueId={leagueId} exileHref={`${base}/exile`} /></div>
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.35em] text-red-300/80">Elimination Council</p>
        <h1 className="mt-2 text-center text-2xl font-black uppercase tracking-[0.15em] text-white">
          Week {week} · {tribe?.name ?? 'Tribe'} beach
        </h1>

        {attendingPlayers.some((p) => p.hasImmunityThisWeek) ? (
          <div className="mx-auto mt-4 max-w-lg rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-center text-[13px] text-amber-100">
            <img src="/survivor/weekly/immunity-necklace-icon.svg" alt="" width={20} height={20} className="mr-1 inline-block h-5 w-5 align-[-4px]" />
            {(attendingPlayers.find((p) => p.hasImmunityThisWeek)?.displayName ?? 'A player')} is immune this week.
          </div>
        ) : null}

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-2 md:grid-cols-3">
          {attendingPlayers.map((p) => (
            <div
              key={p.userId}
              className={clsx(
                'survivor-panel flex flex-col items-center rounded-xl p-3 text-center',
                p.hasImmunityThisWeek && 'bg-amber-400/[0.07] ring-1 ring-amber-300/40',
              )}
            >
              <SurvivorAvatar name={p.displayName} size={48} status={survivorAvatarStatus({ immune: p.hasImmunityThisWeek, out: p.playerState === 'eliminated' })} imageUrl={p.avatarUrl ?? null} />
              <p className="mt-2 truncate text-[12px] font-semibold text-white">{p.displayName}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">
                {p.hasImmunityThisWeek ? 'Immune' : status === 'voting_open' ? 'Voting' : '—'}
              </p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-6 max-w-lg text-center">
          {quiet ? (
            <div className="space-y-2">
              <img src="/survivor/exile/scroll-sealed.svg" alt="Council results sealed" width={200} height={140} className="mx-auto" /><p className="text-lg font-bold uppercase tracking-[0.2em] text-white/90">The votes are in.</p>
              <p className="text-[13px] text-white/50">Results remain sealed until the Torch Ceremony is published.</p>
            </div>
          ) : council?.isRevealed ? null : (
            <p className="text-[13px] text-white/45">No open council. Chimmy will announce the next voting window in league chat.</p>
          )}
        </div>
      </div>

      {council?.isRevealed ? (
        <div className="relative mx-auto mt-6 max-w-2xl">
          <SurvivorVoteRevealScrolls
            key={council.id}
            scrolls={revealSteps}
            totalSteps={council.revealTotalSteps ?? revealSteps.length}
            eliminatedName={council.eliminatedName ?? null}
            isTie={council.isTie === true}
            tiePhase={null}
            revealMode={council.revealMode ?? 'one_at_a_time'}
            nextStepAt={council.revealNextStepAt ?? null}
            onRequestMore={ctx.refetch}
            exileEnabled={ctx.season?.exileEnabled !== false}
            week={council.week}
            tribeName={tribe?.name ?? null}
          />
        </div>
      ) : null}
    </div>
  )
}
