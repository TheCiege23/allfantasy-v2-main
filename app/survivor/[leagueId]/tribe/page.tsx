'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { TribeMemberCard } from '@/app/survivor/components/TribeMemberCard'
import type { SurvivorStatusBadgeVariant } from '@/app/survivor/components/SurvivorStatusBadge'
import type { SurvivorSeasonPlayer } from '@/lib/survivor/survivorUiTypes'
import { tribeCrestAlt } from '@/lib/survivor/survivorTribeIdentity'

function memberVariant(p: SurvivorSeasonPlayer, councilOpen: boolean): SurvivorStatusBadgeVariant {
  if (p.playerState === 'eliminated' || (p.eliminatedWeek != null && p.eliminatedWeek > 0)) return 'eliminated'
  if (p.playerState === 'exile') return 'exiled'
  if (p.isJuryMember || p.playerState === 'jury') return 'jury'
  if (p.isFinalist) return 'finalist'
  if (p.hasImmunityThisWeek) return 'immune'
  if (councilOpen && p.playerState === 'active' && !p.hasImmunityThisWeek) return 'vulnerable'
  return 'safe'
}

export default function SurvivorTribePage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const councilOpen = ctx.season?.activeCouncil?.status === 'voting_open'
  const tribeId = ctx.tribeId
  const tribes = ctx.season?.tribes ?? []
  const tribe = tribes.find((t) => t.id === tribeId) ?? tribes[0]
  const postMerge = ['merge', 'jury', 'finale'].includes(ctx.leaguePhase)

  const roster = useMemo(() => {
    const all = ctx.season?.players ?? []
    if (postMerge) {
      return [...all].sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
    }
    if (!tribeId) return all
    return all.filter((p) => p.tribeId === tribeId)
  }, [ctx.season?.players, postMerge, tribeId])

  const opponent = useMemo(() => {
    if (!tribeId || tribes.length < 2) return null
    return tribes.find((t) => t.id !== tribeId) ?? null
  }, [tribeId, tribes])

  const tribeStatusLabel =
    councilOpen && ctx.season?.activeCouncil?.attendingTribeId === tribe?.id
      ? 'TRIBAL TONIGHT'
      : postMerge
        ? 'MERGED TRIBE'
        : 'SAFE'

  return (
    <div className="relative px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <header className="survivor-panel rounded-2xl p-4 md:flex md:items-end md:justify-between md:p-6">
        <div className="flex items-start gap-4">
          {!postMerge && tribe?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tribe.logoUrl}
              alt={tribeCrestAlt(tribe.name ?? 'Your', tribe.mascot)}
              width={120}
              height={142}
              className="h-[142px] w-[120px] shrink-0 object-contain"
              data-testid="survivor-your-tribe-crest"
            />
          ) : <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-black text-black/80"
            style={{ backgroundColor: tribe?.colorHex ?? '#f0a35e' }}
          >
            {(tribe?.name ?? 'T').slice(0, 1)}
          </div>}
          <div>
            <p className="sv-kicker text-[11px]">Your tribe</p>
            <h1
              className="sv-h text-2xl uppercase tracking-[0.1em] md:text-3xl"
              style={{ color: tribe?.colorHex ? undefined : undefined }}
            >
              <span style={{ color: tribe?.colorHex ?? 'var(--survivor-gold)' }}>{tribe?.name ?? 'Tribe'}</span>
            </h1>
            <p className="mt-1 text-[12px] text-[var(--survivor-text-medium)]">
              {roster.length} members · {tribeStatusLabel}
            </p>
          </div>
        </div>
        <div className="mt-4 md:mt-0 md:text-right">
          <p className="font-mono text-3xl font-bold tabular-nums text-white">—</p>
          <p className="text-[11px] text-[var(--survivor-text-dim)]">Weekly tribe score (syncs with league scoring)</p>
          {opponent ? (
            <p className="mt-2 text-[12px] text-white/55">
              vs {opponent.name ?? 'Opponent'}: <span className="sv-score font-mono">—</span>
            </p>
          ) : null}
        </div>
      </header>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#e8c98e] to-[#f0a35e]" />
      </div>

      <section className="mt-6">
        <h2 className="sv-kicker mb-3 text-[12px]">Roster</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {roster.map((p) => (
            <TribeMemberCard
              key={p.userId}
              name={p.displayName}
              avatarUrl={p.avatarUrl ?? null}
              outWeek={p.eliminatedWeek ?? null}
              weeklyScore={undefined}
              statusVariant={memberVariant(p, Boolean(councilOpen))}
              ringClass={
                p.hasImmunityThisWeek
                  ? 'ring-[#f2c46b]/50'
                  : councilOpen && p.playerState === 'active' && !p.hasImmunityThisWeek
                    ? 'ring-red-500/35'
                    : 'ring-white/10'
              }
              atRisk={Boolean(councilOpen && p.playerState === 'active' && !p.hasImmunityThisWeek)}
            />
          ))}
        </div>
      </section>

      <section className="mt-8 survivor-panel rounded-2xl p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          aria-expanded={false}
        >
          <span className="sv-kicker text-[12px]">Tribe challenge history</span>
          <span className="text-white/35">▼</span>
        </button>
        <p className="mt-2 text-[12px] text-white/45">Last three weeks will appear here as the season logs results.</p>
      </section>

      <Link
        href={`${base}/chat`}
        className="fixed bottom-20 right-4 z-30 flex h-14 min-h-[56px] items-center gap-2 rounded-full bg-[var(--survivor-torch)] px-5 text-[13px] font-semibold text-[#1a0f05] shadow-[0_10px_30px_rgba(0,0,0,0.45)] hover:bg-[#f4b47a] md:bottom-8 md:right-8"
      >
        💬 Tribe Chat
      </Link>
    </div>
  )
}
