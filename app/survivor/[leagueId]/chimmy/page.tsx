'use client'

import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { VoteSubmissionCard } from '@/app/survivor/components/chimmy/VoteSubmissionCard'
import { DeadlineReminderCard } from '@/app/survivor/components/chimmy/DeadlineReminderCard'
import { ExileTokenSummaryCard } from '@/app/survivor/components/chimmy/ExileTokenSummaryCard'
import { JuryVotingCard } from '@/app/survivor/components/chimmy/JuryVotingCard'
import { ChallengePickCard } from '@/app/survivor/components/chimmy/ChallengePickCard'

export default function SurvivorChimmyPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const ch = ctx.season?.currentChallenge
  const council = ctx.season?.activeCouncil

  const voteTargets = useMemo(() => {
    const players = ctx.season?.players ?? []
    const tid = council?.attendingTribeId
    const pool = tid
      ? players.filter((p) => p.tribeId === tid && p.playerState === 'active')
      : players.filter((p) => p.playerState === 'active')
    return pool.map((p) => ({
      id: p.userId,
      name: p.displayName,
      immune: Boolean(p.hasImmunityThisWeek),
    }))
  }, [ctx.season?.players, council?.attendingTribeId])

  const finalists = useMemo(
    () => (ctx.season?.players ?? []).filter((p) => p.isFinalist).map((p) => ({ id: p.userId, name: p.displayName })),
    [ctx.season?.players],
  )

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <header className="flex items-center gap-3 survivor-panel rounded-2xl p-4">
        <div className="torch-pulse flex h-11 w-11 items-center justify-center rounded-full bg-violet-600/40 text-xl">
          @
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-200">@Chimmy Private</p>
          <p className="text-[13px] text-white/55">Private ballots and power actions appear only from DB state.</p>
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {council?.status === 'voting_open' && ctx.canVote ? (
          <VoteSubmissionCard targets={voteTargets} onConfirm={async (targetUserId) => {
            const res = await fetch('/api/survivor/chimmy', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ leagueId, message: `@Chimmy vote <@${targetUserId}>` }),
            })
            const result = await res.json()
            if (!res.ok || !result.vote?.ok || result.vote.doesNotCount) throw new Error(result.error ?? result.reply ?? 'Vote was not recorded.')
            ctx.refetch()
          }} />
        ) : council?.status === 'voting_open' ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-[13px] text-amber-100">
            Tribal is open, but this viewer cannot cast a vote for this council.
          </div>
        ) : null}

        {ctx.playerState === 'exile' ? (
          <ExileTokenSummaryCard
            balance={ctx.tokenBalance ?? 0}
            needed={5}
            events={[]}
          />
        ) : null}

        {ctx.playerState === 'jury' && ctx.leaguePhase === 'finale' && finalists.length ? (
          <JuryVotingCard finalists={finalists} />
        ) : null}

        {ch?.status === 'open' && ctx.canSubmitChallenge ? (
          <ChallengePickCard title={ch.title ?? 'Challenge'} instructions={ch.instructions ?? 'Lock a pick privately.'} onLock={() => {}}>
            <p className="text-[11px] text-white/40">Commissioner may still collect this through chat.</p>
          </ChallengePickCard>
        ) : null}

        <DeadlineReminderCard label="Vote deadline approaching" href={`/survivor/${leagueId}/tribal`} />

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] text-amber-100">
          Forbidden hidden information stays redacted for players and playing commissioners.
        </div>
      </div>
    </div>
  )
}
