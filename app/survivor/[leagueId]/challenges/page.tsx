'use client'

import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { ChallengePickCard } from '@/app/survivor/components/chimmy/ChallengePickCard'

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

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

  const end = parseDeadlineMs(ch?.locksAt ?? ch?.lockAt ?? null)
  const remaining = end ? end - now : null

  const stateChip = useMemo(() => {
    const st = ch?.status ?? '—'
    if (st === 'open') return { label: 'OPEN', cls: 'bg-emerald-500/20 text-emerald-200' }
    if (st === 'locked') return { label: 'LOCKED', cls: 'bg-white/10 text-white/45' }
    if (st === 'graded' || st === 'complete') return { label: 'COMPLETE', cls: 'bg-cyan-500/15 text-cyan-200' }
    return { label: String(st).toUpperCase(), cls: 'bg-amber-500/15 text-amber-100' }
  }, [ch?.status])

  const submitWhere =
    ch?.submissionMode === 'private_chimmy'
      ? 'Message @Chimmy with your pick.'
      : ch?.submissionMode === 'both'
        ? 'Submit in Tribe Chat or via @Chimmy — follow your commissioner.'
        : 'Submit in Tribe Chat so your tribe can coordinate.'

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <div
        className="survivor-panel border-l-4 border-[var(--survivor-torch)] p-4 md:p-6"
        style={{ borderLeftColor: 'var(--survivor-torch)' }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-torch)]">Active challenge</p>
        {ch ? (
          <>
            <h1 className="mt-2 text-xl font-bold text-white md:text-2xl">{ch.title ?? 'Island challenge'}</h1>
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

            <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/25 p-4">
              <p className="text-[11px] font-bold uppercase text-white/45">Where to submit</p>
              <p className="mt-1 text-[13px] text-white/80">{submitWhere}</p>
            </div>

            <div className="mt-4 rounded-xl border border-orange-500/25 bg-orange-500/5 p-4">
              <p className="text-[11px] font-bold uppercase text-orange-200/90">Reward</p>
              <p className="mt-1 text-[14px] text-white">
                {ch.rewardType ? `🏆 ${ch.rewardType}` : '🏆 Immunity or league reward (commissioner configured)'}
              </p>
              <p className="mt-2 text-[11px] text-white/45">✓ Tribal immunity may hinge on this result.</p>
            </div>

            {end ? (
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase text-white/40">Deadline</p>
                <time
                  dateTime={new Date(end).toISOString()}
                  className="mt-1 block font-mono text-lg tabular-nums text-orange-200"
                >
                  ⏱ {remaining != null ? formatDurationMs(remaining) : '—'} remaining
                </time>
                <p className="text-[12px] text-white/50">Submissions lock at kickoff or the time your league sets.</p>
              </div>
            ) : null}

            {ctx.canSubmitChallenge ? (
              <div className="mt-6 md:max-w-md">
                <ChallengePickCard
                  title={ch.title ?? 'Challenge'}
                  instructions={ch.instructions ?? 'Describe your pick in one line.'}
                  onLock={() => {}}
                >
                  <p className="text-[11px] text-white/40">Confirmation step can live in @Chimmy private chat.</p>
                </ChallengePickCard>
                <p className="mt-2 text-[11px] text-white/35">
                  Wire-up: this card is a UI shell — your league may collect picks in chat instead.
                </p>
              </div>
            ) : (
              <p className="mt-6 text-[13px] text-amber-200/90">
                {ch.status !== 'open'
                  ? 'Submissions are closed for this challenge.'
                  : 'You cannot submit from this account state right now.'}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-[14px] text-white/50">No active challenge on the board. Check back after the host posts.</p>
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
          Past challenges
        </h2>
        <div className="space-y-2">
          {[3, 2, 1].map((w) => (
            <details key={w} className="survivor-panel rounded-xl p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-white/80">
                Week {ctx.currentWeek - w} · Logged results appear here
              </summary>
              <p className="mt-2 text-[12px] text-white/45">Winner, reward, and tribal fallout will populate from season data.</p>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-8 text-center md:hidden">
        <Link
          href={`/survivor/${leagueId}/chat`}
          className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[14px] font-semibold text-sky-200"
        >
          Open chat for submissions
        </Link>
      </div>
    </div>
  )
}
