'use client'

import clsx from 'clsx'

/**
 * Inline action cards rendered in chat when @Chimmy processes zombie actions.
 * These display as rich message cards with status, confirmation, and results.
 */

type ActionCardProps = {
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  actorName: string
  timestamp?: string
}

export function SerumUseActionCard({
  status,
  actorName,
  targetName,
  serumType,
  timestamp,
}: ActionCardProps & { targetName: string; serumType: 'protect' | 'revive' }) {
  return (
    <div className={clsx(
      'rounded-xl border border-teal-500/25 bg-teal-950/30 p-4',
      status === 'confirmed' && 'serum-anim',
    )}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">🧪</span>
        <div>
          <p className="text-[13px] font-bold text-teal-200">
            {serumType === 'revive' ? 'Revival Attempt' : 'Serum Protection'}
          </p>
          <p className="text-[11px] text-[var(--zombie-text-mid)]">
            {actorName} → {targetName}
          </p>
        </div>
        <StatusChip status={status} />
      </div>
      {status === 'confirmed' && (
        <p className="mt-2 text-[12px] text-teal-300/80">
          {serumType === 'revive'
            ? `${targetName} has been revived! Back to Survivor status.`
            : `${targetName} is protected this week. Infection blocked once.`}
        </p>
      )}
      {status === 'rejected' && (
        <p className="mt-2 text-[12px] text-red-300/80">
          Action denied. Check serum count and timing rules.
        </p>
      )}
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

export function BombUseActionCard({
  status,
  actorName,
  timestamp,
}: ActionCardProps) {
  return (
    <div className={clsx(
      'rounded-xl border-2 border-red-500/40 bg-red-950/40 p-4',
      status === 'confirmed' && 'bomb-anim',
    )}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">💣</span>
        <div>
          <p className="text-[15px] font-black text-red-200">BOMB DETONATED</p>
          <p className="text-[11px] text-[var(--zombie-text-mid)]">by {actorName}</p>
        </div>
        <StatusChip status={status} />
      </div>
      {status === 'confirmed' && (
        <p className="mt-2 text-[12px] text-red-200/80">
          The top Zombie&apos;s weekly winnings have been destroyed. One-time use consumed.
        </p>
      )}
      {status === 'pending' && (
        <p className="mt-2 text-[12px] text-amber-200/80">
          Awaiting confirmation. Type DETONATE to confirm.
        </p>
      )}
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

export function AmbushActionCard({
  status,
  actorName,
  ambushType,
  targetMatchup,
  timestamp,
}: ActionCardProps & { ambushType: string; targetMatchup?: string }) {
  return (
    <div className={clsx(
      'rounded-xl border border-[var(--zombie-crimson)]/30 bg-[var(--zombie-crimson)]/[0.06] p-4',
      status === 'confirmed' && 'ambush-anim',
    )}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎭</span>
        <div>
          <p className="text-[13px] font-bold text-[var(--zombie-crimson)]">Ambush Deployed</p>
          <p className="text-[11px] text-[var(--zombie-text-mid)]">
            {actorName} · {ambushType}
          </p>
        </div>
        <StatusChip status={status} />
      </div>
      {targetMatchup && (
        <p className="mt-2 text-[12px] text-[var(--zombie-text-mid)]">
          Target: {targetMatchup}
        </p>
      )}
      {status === 'confirmed' && (
        <p className="mt-1 text-[11px] text-[var(--zombie-crimson)]/80">
          Matchup remap active. New pairings take effect at next lock.
        </p>
      )}
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

export function BashingDecisionCard({
  status,
  actorName,
  victimName,
  margin,
  decision,
  timestamp,
}: ActionCardProps & { victimName: string; margin: number; decision?: 'take_loot' | 'show_mercy' }) {
  return (
    <div className={clsx(
      'rounded-xl border border-orange-500/25 bg-orange-950/20 p-4',
    )}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">🔥</span>
        <div>
          <p className="text-[13px] font-bold text-orange-200">Bashing Decision</p>
          <p className="text-[11px] text-[var(--zombie-text-mid)]">
            {actorName} defeated {victimName} by {margin.toFixed(1)} pts
          </p>
        </div>
        <StatusChip status={status} />
      </div>
      {status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg bg-orange-500/25 py-2 text-[12px] font-semibold text-orange-100"
          >
            Take Loot
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-white/10 py-2 text-[12px] text-white/60"
          >
            Show Mercy
          </button>
        </div>
      )}
      {status === 'confirmed' && decision && (
        <p className="mt-2 text-[12px] text-orange-200/80">
          {decision === 'take_loot'
            ? 'Loot taken. Winnings transferred.'
            : 'Mercy shown. No additional penalty.'}
        </p>
      )}
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

export function RevivalNotificationCard({
  playerName,
  timestamp,
}: { playerName: string; timestamp?: string }) {
  return (
    <div className="rounded-xl border border-[var(--zombie-gold)]/30 bg-[var(--zombie-gold)]/[0.06] p-4 revival-anim">
      <div className="flex items-center gap-2">
        <span className="text-2xl">⚡</span>
        <div>
          <p className="text-[14px] font-black text-[var(--zombie-gold)]">REVIVAL</p>
          <p className="text-[12px] text-[var(--zombie-text-mid)]">
            {playerName} has returned from the dead!
          </p>
        </div>
      </div>
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

export function InfectionNotificationCard({
  victimName,
  infectorName,
  margin,
  timestamp,
}: { victimName: string; infectorName: string; margin?: number; timestamp?: string }) {
  return (
    <div className="rounded-xl border border-[var(--zombie-purple)]/30 bg-[var(--zombie-purple)]/[0.06] p-4 zombie-turn-anim">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🧟</span>
        <div>
          <p className="text-[14px] font-black text-[var(--zombie-purple)]">INFECTION</p>
          <p className="text-[12px] text-[var(--zombie-text-mid)]">
            {victimName} turned by {infectorName}
            {margin != null ? ` — ${margin.toFixed(1)} pt margin` : ''}
          </p>
        </div>
      </div>
      {timestamp && <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">{timestamp}</p>}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/20 text-amber-200',
    confirmed: 'bg-[var(--zombie-green)]/20 text-[var(--zombie-green)]',
    rejected: 'bg-red-500/20 text-red-300',
    expired: 'bg-white/10 text-[var(--zombie-text-dim)]',
  }

  return (
    <span className={clsx(
      'ml-auto rounded px-2 py-0.5 text-[11px] font-bold uppercase',
      styles[status] ?? styles.pending,
    )}>
      {status}
    </span>
  )
}
