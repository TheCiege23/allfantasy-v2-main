'use client'

import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { WeeklyCallCard } from '@/app/survivor/components/WeeklyCallCard'
import { RealGameChallengeCard } from '@/app/survivor/components/RealGameChallengeCard'
import { SurvivorChallengeBoardCard } from '@/components/survivor/SurvivorChallengeBoardCard'
import { islandDeadlineLabel } from '@/lib/survivor/survivorIslandView'

type PastChallenge = { id: string; week: number; title: string; scope: string; status: string; challengeType: string; resultSummary: string | null }

function parseDeadlineMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

export default function SurvivorChallengesPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const ch = ctx.season?.currentChallenge
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const [past, setPast] = useState<PastChallenge[] | null>(null)
  useEffect(() => {
    if (!leagueId) return
    let live = true
    fetch(`/api/survivor/challenge?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('challenges'))))
      .then((json: { challenges?: PastChallenge[] }) => {
        // The weekly call and the real-game picks have their own cards; settled slates and graded challenges are the history.
        if (live) setPast((json.challenges ?? []).filter(row => row.challengeType !== 'weekly_call' && row.challengeType !== 'real_game_pick' && ['complete', 'graded', 'resolved'].includes(row.status)))
      })
      .catch(() => { if (live) setPast([]) })
    return () => { live = false }
  }, [leagueId])
  const automatic = ch?.submissionMode === 'automatic'

  const end = parseDeadlineMs(ch?.locksAt ?? ch?.lockAt ?? null)
  // Taking answers only while open AND before the lock: a closed challenge is "This week's challenge",
  // never "Active challenge … 0m remaining".
  const live = ch?.status === 'open' && (end == null || end > now)

  const stateChip = useMemo(() => {
    const st = ch?.status ?? '—'
    if (st === 'open' && !live) return { label: 'LOCKED', cls: 'bg-white/10 text-white/45' }
    if (st === 'open') return { label: 'OPEN', cls: 'sv-chip-torch' }
    if (st === 'closed') return { label: 'CLOSED', cls: 'bg-white/10 text-white/45' }
    if (st === 'locked') return { label: 'LOCKED', cls: 'bg-white/10 text-white/45' }
    if (st === 'graded' || st === 'complete') return { label: 'COMPLETE', cls: 'bg-[rgba(242,196,107,0.12)] text-[#f2c46b]' }
    return { label: String(st).toUpperCase(), cls: 'bg-amber-500/15 text-amber-100' }
  }, [ch?.status, live])

  const submitWhere =
    ch?.submissionMode === 'private_chimmy'
      ? 'Message @Chimmy with your pick.'
      : ch?.submissionMode === 'both'
        ? 'Submit in Tribe Chat or via @Chimmy — follow your commissioner.'
        : 'Submit in Tribe Chat so your tribe can coordinate.'

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <div
        className="survivor-panel rounded-2xl sv-torch-bar p-4 md:p-6"
        style={{ borderLeftColor: 'var(--survivor-torch)' }}
      >
        <p className="sv-eyebrow">{live ? 'Open challenge' : 'This week’s challenge'}</p>
        {ch ? (
          <>
            <h1 className="sv-h mt-2 text-xl md:text-2xl">{ch.title ?? 'Island challenge'}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white/70">
                {(ch.scope ?? 'tribe').replace(/_/g, ' ')}
              </span>
              <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${stateChip.cls}`}>
                {stateChip.label}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--survivor-text-medium)]">
              {ch.description || ch.instructions || 'Your commissioner sets the story beat — stay ready.'}
            </p>

            {automatic || live ? <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/25 p-4" data-testid="survivor-challenge-how">
              <p className="sv-kicker text-[11px]">{automatic ? 'How it works' : 'Where to submit'}</p>
              <p className="mt-1 text-[13px] text-white/80">{automatic ? 'Nothing to submit: set your best lineup. Chimmy settles it from the final scores.' : submitWhere}</p>
            </div> : null}

            <div className="mt-4 rounded-xl border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.06)] p-4">
              <p className="sv-kicker text-[11px]">Reward</p>
              <p className="mt-1 text-[14px] text-white">
                {ch.rewardType ? `🏆 ${ch.rewardType}` : '🏆 Immunity or league reward (commissioner configured)'}
              </p>
              <p className="mt-2 text-[11px] text-white/45">✓ Tribal immunity may hinge on this result.</p>
            </div>

            {end && live ? (
              <div className="mt-4">
                <p className="sv-kicker text-[11px]">Deadline</p>
                <time
                  dateTime={new Date(end).toISOString()}
                  className="mt-1 block font-mono text-lg tabular-nums text-[var(--survivor-torch)]"
                >
                  ⏱ {islandDeadlineLabel(end, now)}
                </time>
                <p className="text-[12px] text-white/50">Submissions lock at kickoff or the time your league sets.</p>
              </div>
            ) : null}

            {!automatic && !live ? (
              <p className="mt-6 text-[13px] text-[#f6d3ae]">Submissions are closed for this challenge.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-[14px] text-white/50">No active challenge on the board. Check back after the host posts.</p>
        )}
      </div>

      {leagueId ? <SurvivorChallengeBoardCard leagueId={leagueId} /> : null}
      {leagueId ? <RealGameChallengeCard leagueId={leagueId} /> : null}
      {leagueId ? <WeeklyCallCard leagueId={leagueId} /> : null}

      <details className="mt-8" data-testid="survivor-past-challenges">
        <summary className="sv-kicker mb-3 cursor-pointer text-[12px]">
          Past challenges{past && past.length ? ` (${past.length})` : ''}
        </summary>
        {past && past.length === 0 ? <p className="text-[13px] text-white/50">No challenge results yet.</p> : null}
        <div className="space-y-2">
          {(past ?? []).slice(0, 12).map((row) => (
            <div key={row.id} className="survivor-panel rounded-xl p-3">
              <p className="text-[13px] font-semibold text-white/85">Week {row.week} · {row.title || 'Challenge'}</p>
              <p className="mt-1 text-[12px] text-white/60">{row.resultSummary ?? 'Settled.'}</p>
            </div>
          ))}
        </div>
      </details>

      {live && !automatic ? (
        <div className="mt-8 text-center md:hidden" data-testid="survivor-challenge-chat-cta">
          <Link
            href={`/survivor/${leagueId}/chat`}
            className="sv-btn min-h-[56px] w-full text-[var(--survivor-torch)]"
          >
            Open chat for submissions
          </Link>
        </div>
      ) : null}
    </div>
  )
}
