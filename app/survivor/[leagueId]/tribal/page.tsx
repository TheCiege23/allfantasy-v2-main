'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { ScrollReveal, type ScrollRevealStep } from '@/app/survivor/components/ScrollReveal'

export default function SurvivorTribalPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const council = ctx.season?.activeCouncil
  const week = council?.week ?? ctx.currentWeek
  const tribe = ctx.season?.tribes?.find((t) => t.id === council?.attendingTribeId)

  const [revealOpen, setRevealOpen] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const fn = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  const attendingPlayers = useMemo(() => {
    const tid = council?.attendingTribeId
    const all = ctx.season?.players ?? []
    if (!tid) return all.filter((p) => p.playerState === 'active')
    return all.filter((p) => p.tribeId === tid && p.playerState !== 'eliminated')
  }, [council?.attendingTribeId, ctx.season?.players])

  const revealSteps: ScrollRevealStep[] = useMemo(() => {
    const names = attendingPlayers.map((p) => p.displayName).filter(Boolean)
    const picks = names.slice(0, Math.min(5, Math.max(3, names.length)))
    const steps: ScrollRevealStep[] = []
    for (const n of picks) {
      steps.push({ type: 'vote', targetName: n })
    }
    steps.push({ type: 'pause', hostLine: 'The final vote…' })
    steps.push({ type: 'vote', targetName: picks[picks.length - 1] ?? 'Unknown' })
    return steps
  }, [attendingPlayers])

  const status = council?.status
  const quiet = status === 'revealing' || status === 'voting_closed'

  return (
    <div className="relative min-h-[75vh] px-3 pb-32 pt-4 md:px-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, rgba(255,68,68,0.25), transparent 40%), radial-gradient(circle at 80% 30%, rgba(255,140,66,0.2), transparent 35%)`,
        }}
      />
      <div className="relative">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.35em] text-red-300/80">Tribal Council</p>
        <h1 className="mt-2 text-center text-2xl font-black uppercase tracking-[0.15em] text-white">
          Week {week} · {tribe?.name ?? 'Tribe'} beach
        </h1>

        {attendingPlayers.some((p) => p.hasImmunityThisWeek) ? (
          <div className="mx-auto mt-4 max-w-lg rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-center text-[13px] text-cyan-100">
            🛡 {(attendingPlayers.find((p) => p.hasImmunityThisWeek)?.displayName ?? 'A player')} is immune this week.
          </div>
        ) : null}

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-2 md:grid-cols-3">
          {attendingPlayers.map((p) => (
            <div
              key={p.userId}
              className={clsx(
                'survivor-panel flex flex-col items-center rounded-xl p-3 text-center',
                p.hasImmunityThisWeek && 'ring-1 ring-cyan-400/40',
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/80">
                {p.displayName.slice(0, 1)}
              </div>
              <p className="mt-2 truncate text-[12px] font-semibold text-white">{p.displayName}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">
                {p.hasImmunityThisWeek ? 'Immune' : status === 'voting_open' ? 'Voting' : '—'}
              </p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-6 max-w-lg text-center">
          {status === 'voting_open' ? (
            <>
              <p className="font-mono text-[13px] tabular-nums text-orange-200">Vote before the commissioner&apos;s deadline.</p>
              <Link
                href={`${base}/chimmy`}
                className="mt-4 inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-600/80 text-[15px] font-bold uppercase tracking-wide text-white shadow-lg shadow-red-900/40"
              >
                🗳 Vote now via @Chimmy
              </Link>
            </>
          ) : quiet ? (
            <div className="space-y-2">
              <p className="text-lg font-bold uppercase tracking-[0.2em] text-white/90">The votes are in.</p>
              <p className="text-[13px] text-white/50">Waiting for the host to read the parchment…</p>
            </div>
          ) : (
            <p className="text-[13px] text-white/45">No open tribal session. Check back when your commissioner opens council.</p>
          )}
        </div>

        <div className="mx-auto mt-6 flex max-w-lg flex-col gap-2">
          <button
            type="button"
            className="min-h-[48px] rounded-xl border border-white/15 text-[12px] text-white/70"
            onClick={() => setRevealOpen(true)}
          >
            Preview scroll reveal (UI demo)
          </button>
          <p className="text-center text-[11px] text-white/30">
            Live reveal sequences consume data from the tribal engine when available.
          </p>
        </div>
      </div>

      {revealOpen ? (
        <ScrollReveal
          steps={revealSteps}
          reducedMotion={reducedMotion}
          onComplete={() => setRevealOpen(false)}
          hostLines={revealSteps.map((_, i) => `Vote ${i + 1} of ${revealSteps.length}`)}
        />
      ) : null}
    </div>
  )
}
