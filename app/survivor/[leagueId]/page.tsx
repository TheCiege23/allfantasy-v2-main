'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { TribeCard } from '@/app/survivor/components/TribeCard'
import { SurvivorStatusBadge } from '@/app/survivor/components/SurvivorStatusBadge'
import type { SurvivorSeasonPlayer } from '@/lib/survivor/survivorUiTypes'
import { getSurvivorThemeById } from '@/lib/survivor/survivorVisuals'
import { SurvivorIslandHero } from '@/components/survivor/SurvivorIslandHero'

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Soon'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

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
  const theme = getSurvivorThemeById(ctx.season?.visualThemeId, leagueId)
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
  const tribeTotals = new Map<string, number>()
  for (const score of ctx.season?.weeklyScores ?? []) {
    if (score.tribeId && score.countedTowardTribeTotal) tribeTotals.set(score.tribeId, (tribeTotals.get(score.tribeId) ?? 0) + score.finalScore)
  }

  const { heroTitle, heroSubtext } = useMemo(() => {
    if (council?.status === 'voting_open' && voteEnd) {
      return {
        heroTitle: `Council vote closes in ${formatDurationMs(voteEnd - now)}`,
        heroSubtext: 'Votes are private until the host reads them. Cast yours with @Chimmy.',
      }
    }
    if (council?.status === 'voting_open') {
      return {
        heroTitle: 'The elimination vote is open',
        heroSubtext: 'The tribe is on the beach. Seal your vote before the deadline.',
      }
    }
    if (ch?.status === 'open' && challengeEnd) {
      return {
        heroTitle: `Challenge closes in ${formatDurationMs(challengeEnd - now)}`,
        heroSubtext: ch.description || ch.instructions || 'Submit where your commissioner instructed — tribe chat or @Chimmy.',
      }
    }
    if (ch?.status === 'open') {
      return {
        heroTitle: 'This week’s challenge is open',
        heroSubtext: 'Points and immunity are on the line this week.',
      }
    }
    if (phase === 'merge') {
      return {
        heroTitle: 'Merge week',
        heroSubtext: 'Buffs drop. From here on, immunity is earned as an individual.',
      }
    }
    return {
      heroTitle: 'This week on the island',
      heroSubtext: 'Watch the league feed for swaps, exile twists, and ceremony beats from the host.',
    }
  }, [council?.status, ch?.description, ch?.instructions, ch?.status, challengeEnd, now, phase, voteEnd])

  const primaryAction = phase === 'pre_draft' || phase === 'drafting'
    ? { href: `/league/${leagueId}/draft`, label: 'Open draft board' }
    : council?.status === 'voting_open'
      ? { href: `${base}/tribal`, label: ctx.canVote ? 'Cast your vote' : 'View council' }
      : ch?.status === 'open'
        ? { href: `${base}/challenges`, label: 'Open challenge' }
        : { href: `${base}/tribe`, label: 'View tribe standings' }

  const headerBadgeVariant =
    ctx.playerState === 'immune'
      ? 'immune'
      : ctx.playerState === 'exile'
        ? 'exiled'
        : ctx.playerState === 'jury'
          ? 'jury'
          : ctx.playerState === 'finalist'
            ? 'finalist'
            : ctx.playerState === 'eliminated'
              ? 'eliminated'
              : ctx.canVote
                ? 'vulnerable'
                : 'safe'

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
      <div className={`min-h-screen px-3 py-4 md:px-6 md:py-6 ${theme.backgroundClass}`}>
      <SurvivorIslandHero
        leagueId={leagueId}
        leagueName={ctx.leagueName}
        sport={ctx.leagueSport}
        week={ctx.currentWeek}
        phase={phase}
        visualThemeId={ctx.season?.visualThemeId}
        headline={heroTitle}
        description={heroSubtext}
        primaryAction={primaryAction}
        secondaryAction={{ href: `/league/${leagueId}`, label: 'League dashboard' }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/75">
        {us ? <SurvivorStatusBadge variant={headerBadgeVariant} /> : null}
        <span>{us?.displayName ?? 'Your island'}{us?.hasImmunityThisWeek ? ' · Immune this week' : ''}{ctx.hasActiveIdol ? ' · Private advantage held' : ''}</span>
        {ctx.isCommissioner ? <Link href={`${base}/commissioner`} className="ml-auto font-semibold text-amber-200 hover:underline">Commissioner hub</Link> : null}
      </div>

      {/* Tribes or individual */}
      {!postMerge ? (
        <section className="mt-6">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
            Tribe standings
          </h2>
          {tribes.length === 0 ? (
            <div className="rounded-2xl border border-amber-300/20 bg-black/30 p-5 text-sm text-white/75">
              <p className="font-semibold text-white">Tribes form after the draft</p>
              <p className="mt-1">The tribe board will show members and weekly scores once rosters are finalized.</p>
              <Link href={`/league/${leagueId}/draft`} className="mt-3 inline-block font-semibold text-amber-200 hover:underline">Open draft board</Link>
            </div>
          ) : <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
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
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
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
                    <td className="px-3 py-2 font-mono text-sky-200">{scoresByUser.has(p.userId) ? scoresByUser.get(p.userId)!.finalScore.toFixed(1) : 'No score yet'}</td>
                    <td className="px-3 py-2">
                      {p.hasImmunityThisWeek ? (
                        <span className="text-[11px] text-cyan-300">Immune</span>
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
        <div className="survivor-panel border-l-4 border-[var(--survivor-torch)] p-4 md:p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--survivor-torch)]">
            Challenge status
          </h2>
          {ch ? (
            <>
              <p className="mt-2 text-lg font-bold text-white">{ch.title || 'Island challenge'}</p>
              <p className="mt-1 text-[12px] text-white/55">
                {(ch.scope ?? 'tribe').toUpperCase()} · {ch.submissionMode ?? 'tribe_chat'}
              </p>
              <p className="mt-2 text-[13px] text-white/70">{ch.description || ch.instructions}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
                    ch.status === 'open' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {ch.status === 'open' ? 'Open' : ch.status ?? '—'}
                </span>
                <Link href={`${base}/challenges`} className="text-[12px] font-semibold text-sky-300">
                  View challenge →
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-white/50">No open challenge right now.</p>
          )}
        </div>
      </section>

      {/* Host message */}
      <section className="mt-6 survivor-panel p-4">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--survivor-torch)]/20 text-lg">
            🔥
          </div>
          <div>
            <p className="text-[11px] font-bold text-[var(--survivor-torch)]">Chimmy</p>
            <p className="mt-1 text-[13px] text-white/75">
              The host posts ceremony beats here. Tune into League Chat for the full feed.
            </p>
          </div>
        </div>
      </section>

      {/* Exile / jury modules */}
      {ctx.season?.exileStatus?.isActive ? (
        <section className="mt-6 rounded-2xl border border-violet-500/25 bg-violet-950/20 p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-violet-200">Exile Island</h2>
          <p className="mt-2 text-[13px] text-white/70">
            {(ctx.season.players ?? []).filter((p) => p.playerState === 'exile').length} players on Exile · Return path
            follows commissioner rules.
          </p>
          <Link href={`${base}/exile`} className="mt-2 inline-block text-[12px] text-violet-300">
            Open Exile →
          </Link>
        </section>
      ) : null}

      {(phase === 'jury' || phase === 'finale') && (
        <section className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-950/20 p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-amber-200">Jury</h2>
          <p className="mt-2 text-[13px] text-white/70">
            Jury of {(ctx.season?.players ?? []).filter((p) => p.isJuryMember).length}
          </p>
          <Link href={`${base}/jury`} className="mt-2 inline-block text-[12px] text-amber-200">
            Jury chamber →
          </Link>
        </section>
      )}

      {phase === 'merge' ? (
        <div className="mt-6 flex justify-center">
          <Link
            href={`${base}/merge`}
            className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-cyan-100"
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
