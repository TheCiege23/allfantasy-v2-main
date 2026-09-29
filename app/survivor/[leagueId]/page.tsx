'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { SURVIVOR_ISLAND_TAGLINE } from '@/lib/survivor/survivorIslandContent'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { TribeCard } from '@/app/survivor/components/TribeCard'
import { SurvivorStatusBadge } from '@/app/survivor/components/SurvivorStatusBadge'
import type { SurvivorSeasonPlayer } from '@/lib/survivor/survivorUiTypes'
import { getSurvivorThemeById } from '@/lib/survivor/survivorVisuals'

function phaseBadgeClass(phase: string) {
  if (phase === 'merge') return 'bg-gradient-to-r from-cyan-500/25 to-orange-500/25 text-orange-100'
  if (phase === 'jury' || phase === 'finale') return 'bg-amber-500/20 text-amber-100'
  if (phase === 'pre_merge' || phase === 'drafting') return 'bg-amber-900/30 text-amber-100'
  return 'bg-white/10 text-white/80'
}

function phaseLabel(phase: string) {
  const p = phase || 'pre_draft'
  if (p === 'pre_merge') return 'PRE-MERGE'
  if (p === 'merge') return 'MERGED'
  if (p === 'jury') return 'JURY PHASE'
  if (p === 'finale') return 'FINALE'
  return p.replace(/_/g, ' ').toUpperCase()
}

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

  const { heroTitle, heroSubtext } = useMemo(() => {
    if (council?.status === 'voting_open' && voteEnd) {
      return {
        heroTitle: `⏱ TRIBAL IN ${formatDurationMs(voteEnd - now)}`,
        heroSubtext: 'Votes are private until the host reads them. Cast yours with @Chimmy.',
      }
    }
    if (council?.status === 'voting_open') {
      return {
        heroTitle: '⏱ TRIBAL COUNCIL IS LIVE',
        heroSubtext: 'The tribe is on the beach. Seal your vote before the deadline.',
      }
    }
    if (ch?.status === 'open' && challengeEnd) {
      return {
        heroTitle: `🏆 CHALLENGE CLOSES IN ${formatDurationMs(challengeEnd - now)}`,
        heroSubtext: ch.description || ch.instructions || 'Submit where your commissioner instructed — tribe chat or @Chimmy.',
      }
    }
    if (ch?.status === 'open') {
      return {
        heroTitle: '🏆 CHALLENGE OPEN',
        heroSubtext: 'Points and immunity are on the line this week.',
      }
    }
    if (phase === 'merge') {
      return {
        heroTitle: '🌊 MERGE WEEK',
        heroSubtext: 'Buffs drop. From here on, immunity is earned as an individual.',
      }
    }
    return {
      heroTitle: '🏝 THIS WEEK ON THE ISLAND',
      heroSubtext: 'Watch the league feed for swaps, exile twists, and ceremony beats from the host.',
    }
  }, [council?.status, ch?.description, ch?.instructions, ch?.status, challengeEnd, now, phase, voteEnd])

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
      {/* Header */}
      <div
        className="survivor-panel relative overflow-hidden rounded-2xl p-4 md:p-6"
        style={{
          background: `linear-gradient(135deg, var(--survivor-bg) 0%, rgba(34,211,238,0.06) 100%)`,
        }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
              {ctx.leagueName}
            </h1>
            <p className="mt-1 text-[12px] text-[var(--survivor-text-medium)]">Season · Week {ctx.currentWeek}</p>
          </div>
          <div
            className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest ${phaseBadgeClass(phase)}`}
          >
            {phaseLabel(phase)}
          </div>
          <div className="flex items-center gap-2">
            {us ? <SurvivorStatusBadge variant={headerBadgeVariant} /> : null}
            {ctx.isCommissioner ? (
              <Link
                href={`/league/${leagueId}`}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-lg text-white/60"
                aria-label="Commissioner settings"
              >
                ⚙️
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="survivor-panel relative mt-4 overflow-hidden rounded-2xl p-4 md:grid md:grid-cols-5 md:gap-6 md:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 30h60M30 0v60' stroke='%23fff' stroke-width='0.5'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative md:col-span-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--survivor-torch)]">
            This week on the island
          </p>
          <p className="mt-3 font-mono text-xl font-semibold leading-snug tabular-nums text-white md:text-2xl">
            {heroTitle}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--survivor-text-medium)]">{heroSubtext}</p>
          <p className="mt-3 text-[11px] leading-relaxed text-white/45">{SURVIVOR_ISLAND_TAGLINE}</p>
        </div>
        <div className="relative mt-4 rounded-xl border border-white/[0.08] bg-black/30 p-4 md:col-span-2 md:mt-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Your status</p>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg font-bold ring-2 ring-cyan-500/30"
            >
              {(us?.displayName ?? 'You').slice(0, 1)}
            </div>
            <div>
              <p className="font-semibold text-white">{us?.displayName ?? 'Player'}</p>
              {us?.hasImmunityThisWeek ? (
                <p className="mt-1 text-[12px] text-cyan-300">🛡 Immune this week</p>
              ) : null}
              {ctx.hasActiveIdol ? (
                <p className="mt-1 text-[12px] text-violet-300">🔮 You hold a power</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Tribes or individual */}
      {!postMerge ? (
        <section className="mt-6">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
            Tribe standings
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
            {tribes.map((t) => {
              const n = playersByTribe.get(t.id)?.length ?? t.members?.length ?? 0
              const attending = council?.attendingTribeId === t.id && council?.status === 'voting_open'
              return (
                <TribeCard
                  key={t.id}
                  tribe={t}
                  memberCount={n}
                  weeklyScore={undefined}
                  status={attending ? 'tribal' : 'neutral'}
                />
              )
            })}
          </div>
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
                    <td className="px-3 py-2 font-mono text-sky-200">—</td>
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
