'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { TribeMemberCard } from '@/app/survivor/components/TribeMemberCard'
import { tribeCrestAlt } from '@/lib/survivor/survivorTribeIdentity'
import { islandMemberBadge, islandTribeTotals } from '@/lib/survivor/survivorIslandView'

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

  // Said once, here, instead of a badge on every member's card.
  const atCouncil = Boolean(councilOpen && (!ctx.season?.activeCouncil?.attendingTribeId || ctx.season.activeCouncil.attendingTribeId === tribe?.id))
  const tribeStatusLabel = atCouncil ? 'At Tribal Council this week' : postMerge ? 'Merged tribe' : 'Safe this week'

  // The same sums the home page's tribe cards show, so the two pages agree.
  const totals = useMemo(() => islandTribeTotals(ctx.season?.weeklyScores ?? []), [ctx.season?.weeklyScores])
  const scoreByUser = useMemo(() => new Map((ctx.season?.weeklyScores ?? []).map((s) => [s.userId, s.finalScore])), [ctx.season?.weeklyScores])
  const ours = tribe ? totals.get(tribe.id) : undefined
  const theirs = opponent ? totals.get(opponent.id) : undefined
  const share = ours != null && theirs != null && ours + theirs > 0 ? ours / (ours + theirs) : null

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
            <p className={`mt-1 text-[12px] ${atCouncil ? 'font-semibold text-[#f4a493]' : 'text-[var(--survivor-text-medium)]'}`} data-testid="survivor-tribe-status">
              {roster.length} members · {tribeStatusLabel}
            </p>
          </div>
        </div>
        {!postMerge ? (
          <div className="mt-4 md:mt-0 md:text-right">
            <p className="font-mono text-3xl font-bold tabular-nums text-white" data-testid="survivor-tribe-score">{ours != null ? ours.toFixed(1) : 'No score yet'}</p>
            <p className="text-[11px] text-[var(--survivor-text-dim)]">This week&apos;s tribe score</p>
            {opponent ? (
              <p className="mt-2 text-[12px] text-white/55">
                vs {opponent.name ?? 'Opponent'}: <span className="sv-score font-mono">{theirs != null ? theirs.toFixed(1) : '—'}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      {share != null ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${tribe?.name ?? 'Your tribe'} has ${Math.round(share * 100)}% of the points this week`}>
          {/* Inline tokens: the `from-[#…] to-[#…]` gradient utilities compiled to nothing here, so the fill was invisible. */}
          <div className="h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: 'linear-gradient(90deg, var(--survivor-gold), var(--survivor-torch))' }} />
        </div>
      ) : null}
      {share != null ? (
        <p className="mt-1.5 text-[11px] text-[var(--survivor-text-dim)]" data-testid="survivor-tribe-share">
          {tribe?.name ?? 'Your tribe'} has {Math.round(share * 100)}% of this week&apos;s points
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="sv-kicker mb-3 text-[12px]">Roster</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {roster.map((p) => (
            <TribeMemberCard
              key={p.userId}
              name={p.displayName}
              avatarUrl={p.avatarUrl ?? null}
              outWeek={p.eliminatedWeek ?? null}
              weeklyScore={scoreByUser.get(p.userId)}
              statusVariant={islandMemberBadge(p)}
            />
          ))}
        </div>
      </section>

      {/*
        The "Tribe challenge history" panel that sat here was a disclosure button that opened nothing over
        a promise ("Last three weeks will appear here"). Past results live on the Challenges page.
      */}
      <Link href={`${base}/challenges`} className="sv-link mt-6 block w-fit text-[13px]">Past challenge results →</Link>

      {/* In the page flow at the end, not floating: fixed, it sat over the last lines of the page on a phone. */}
      <Link
        href={`${base}/chat`}
        className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--survivor-torch)] px-5 text-[14px] font-semibold text-[#1a0f05] hover:bg-[#f4b47a] md:w-auto md:inline-flex"
      >
        💬 Tribe Chat
      </Link>
    </div>
  )
}
