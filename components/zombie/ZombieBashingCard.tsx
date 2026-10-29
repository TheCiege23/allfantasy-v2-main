'use client'

import clsx from 'clsx'
import type { ZombieMatchupView } from '@/lib/zombie/zombieMatchupBoard'
import { ZombieStatusChip, zombieChipStatus } from './ZombieStatusChip'

/*
 * One Zombie matchup as the handoff's Bashing card: both sides with their status, the margin on a meter
 * marked with the sport's real bash/maul lines, and — once final — the points the winnings engine
 * actually moved. Nothing here promises loot or items: a bashing/mauling moves a share of the loser's
 * week, an infection moves all of it.
 */

export type ZombieBashingRules = { bashingThreshold: number; maulingThreshold: number; bashShare: number; maulShare: number }

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })
const pct = (share: number) => `${Math.round(share * 100)}%`

const HEADLINE = {
  mauling: { label: 'Mauled!', art: 'maul', tone: 'text-red-300', ring: 'border-red-400/40' },
  bashing: { label: 'Bashed!', art: 'bash', tone: 'text-amber-300', ring: 'border-amber-400/40' },
  infection: { label: 'Infected', art: 'turn', tone: 'text-lime-300', ring: 'border-lime-400/40' },
} as const

export function ZombieBashingCard({
  m,
  rules,
  revived,
}: {
  m: ZombieMatchupView
  rules: ZombieBashingRules
  revived?: ReadonlySet<string>
}) {
  const winner = m.leader === 'home' ? m.home : m.leader === 'away' ? m.away : null
  const loser = m.leader === 'home' ? m.away : m.leader === 'away' ? m.home : null
  const scale = Math.max(rules.maulingThreshold * 1.25, m.margin)
  const at = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  const head = m.outcome ? HEADLINE[m.outcome.kind] : null

  let caption: string
  if (m.final && m.transfer && loser && winner) {
    caption =
      m.outcome?.kind === 'infection'
        ? `${loser.name} turned — their whole week (${fmt(m.transfer.amount)}) goes to ${winner.name}.`
        : `${loser.name} hands ${fmt(m.transfer.amount)} Outbreak Points to ${winner.name} — ${pct(
            m.outcome?.kind === 'mauling' ? rules.maulShare : rules.bashShare,
          )} of their week.`
  } else if (m.final) {
    caption = m.leader ? 'Final. No blowout, so no points change hands.' : 'Final. A tie moves nothing.'
  } else if (m.outcome && winner) {
    caption = `${winner.name} is on pace for a ${m.outcome.kind} — ${m.outcome.kind === 'mauling' ? rules.maulingThreshold : rules.bashingThreshold}+ when the week ends.`
  } else if (m.atRisk) {
    const side = m.atRisk === 'home' ? m.home : m.away
    caption = `Infection on the line: if ${side.name} loses, they turn.`
  } else {
    caption = 'Not final yet.'
  }

  return (
    <article
      className={clsx(
        'zombie-enter rounded-2xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(7,8,13,0.6))] p-4 sm:p-5',
        head && m.final ? head.ring : 'border-white/10',
        m.mySide && 'ring-1 ring-white/25',
      )}
      data-testid="zombie-bashing-card"
    >
      {head ? (
        <div className="mb-3 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
          <img src={`/zombie/art/${head.art}.svg`} alt="" className="h-8 w-8" />
          <span className={clsx('text-sm font-black uppercase tracking-[0.14em]', head.tone)}>
            {m.final ? head.label : `On pace: ${m.outcome!.kind}`}
          </span>
        </div>
      ) : m.atRisk ? (
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">Infection on the line</p>
      ) : null}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Side side={m.home} mine={m.mySide === 'home'} leading={m.leader === 'home'} revived={revived} />
        <span className="text-xs font-black text-white/40">VS</span>
        <Side side={m.away} mine={m.mySide === 'away'} leading={m.leader === 'away'} revived={revived} align="right" />
      </div>

      <div className="mt-4" aria-label={`Margin ${fmt(m.margin)}; bashing ${rules.bashingThreshold}+, mauling ${rules.maulingThreshold}+`}>
        <div className="relative h-2.5 rounded-full bg-white/10">
          <div
            className={clsx(
              'absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:duration-700',
              m.margin >= rules.maulingThreshold ? 'bg-red-400' : m.margin >= rules.bashingThreshold ? 'bg-amber-400' : 'bg-lime-500/70',
            )}
            style={{ width: at(m.margin) }}
          />
          {[rules.bashingThreshold, rules.maulingThreshold].map((line) => (
            <span key={line} className="absolute -top-1 h-[18px] w-0.5 bg-white/70" style={{ left: at(line) }} />
          ))}
        </div>
        <div className="relative mt-1.5 h-4 text-[11px] text-white/55">
          <span className="absolute -translate-x-1/2" style={{ left: at(rules.bashingThreshold) }}>
            Bash {rules.bashingThreshold}
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: at(rules.maulingThreshold) }}>
            Maul {rules.maulingThreshold}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-white/70">
          {m.leader ? `${m.final ? 'Won' : 'Leading'} by ${fmt(m.margin)}` : 'Level'}
        </p>
      </div>

      <p className="mt-3 rounded-xl bg-black/30 px-3 py-2 text-[13px] leading-snug text-white/80">{caption}</p>
    </article>
  )
}

function Side({
  side,
  mine,
  leading,
  revived,
  align = 'left',
}: {
  side: ZombieMatchupView['home']
  mine: boolean
  leading: boolean
  revived?: ReadonlySet<string>
  align?: 'left' | 'right'
}) {
  return (
    <div className={clsx('min-w-0', align === 'right' && 'text-right')}>
      <p className="truncate text-sm font-bold text-white">
        {side.name}
        {mine ? <span className="font-normal text-white/50"> · you</span> : null}
      </p>
      <div className={clsx('mt-1 flex', align === 'right' && 'justify-end')}>
        <ZombieStatusChip status={zombieChipStatus(side.status, revived?.has(side.rosterId))} />
      </div>
      <p className={clsx('mt-1.5 font-mono text-2xl font-bold', leading ? 'text-lime-300' : 'text-white/80')}>{fmt(side.score)}</p>
    </div>
  )
}
