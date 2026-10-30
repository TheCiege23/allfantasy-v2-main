'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SerumUseCard } from '@/app/zombie/components/chimmy/SerumUseCard'
import { BombUseCard } from '@/app/zombie/components/chimmy/BombUseCard'
import { AmbushConfirmationCard } from '@/app/zombie/components/chimmy/AmbushConfirmationCard'
import { RevivalCard } from '@/app/zombie/components/chimmy/RevivalCard'
import { BashingDecisionCard } from '@/app/zombie/components/chimmy/BashingDecisionCard'

type LeagueTeam = {
  rosterId: string
  status: string
  fantasyTeamName: string | null
  displayName: string | null
}

export default function ZombieChatHubPage() {
  const { leagueId  } = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const [teams, setTeams] = useState<LeagueTeam[]>([])
  const [resolution, setResolution] = useState<{ status: string } | null>(null)
  const [inv, setInv] = useState<{
    items: { itemType: string; isUsed: boolean }[]
    teamStatus: string
    rules: { reviveThreshold: number }
    isWhisperer: boolean
    ambushesRemaining: number | null
    pendingBashingDecision: {
      id: string
      week: number
      loserName: string
      margin: number
      hoursLeft?: number
    } | null
  } | null>(null)
  useEffect(() => {
    if (!leagueId) return
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: { teams: LeagueTeam[] } } | null) => setTeams(d?.league?.teams ?? []))
      .catch(() => setTeams([]))
  }, [leagueId])

  useEffect(() => {
    if (!leagueId) return
    fetch(`/api/zombie/inventory?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          items: { itemType: string; isUsed: boolean }[]
          teamStatus: string
          rules: { reviveThreshold: number }
          resolution: { status: string } | null
          isWhisperer: boolean
          ambushesRemaining: number | null
          pendingBashingDecision: {
            id: string
            week: number
            loserName: string
            margin: number
            hoursLeft?: number
          } | null
        } | null) => {
          if (!d) return
          setInv({
            items: d.items,
            teamStatus: d.teamStatus,
            rules: d.rules,
            isWhisperer: d.isWhisperer,
            ambushesRemaining: d.ambushesRemaining,
            pendingBashingDecision: d.pendingBashingDecision ?? null,
          })
          setResolution(d.resolution)
        },
      )
      .catch(() => null)
  }, [leagueId])

  if (!leagueId) return null

  const resolving = resolution?.status === 'resolving'
  const serumCount = inv?.items.filter((i) => i.itemType.toLowerCase().includes('serum') && !i.isUsed).length ?? 0
  const hasBomb = inv?.items.some((i) => i.itemType.toLowerCase().includes('bomb') && !i.isUsed) ?? false
  const isSurvivor = (inv?.teamStatus ?? '').toLowerCase().includes('survivor')
  const isZombie = (inv?.teamStatus ?? '').toLowerCase().includes('zombie')

  const allies = teams
    .filter((t) => t.status.toLowerCase().includes('survivor') && t.rosterId)
    .map((t) => ({
      userId: t.rosterId,
      name: t.fantasyTeamName || t.displayName || t.rosterId,
    }))

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-lg font-bold text-white">Chat & @Chimmy</h1>
      <p className="text-[12px] text-[var(--zombie-text-dim)]">
        Use the cards below to send DM commands directly to @Chimmy. League chat still lives on the main league screen.
      </p>

      {resolving ? (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-100"
          role="status"
        >
          🔄 Processing weekly results… Open chat to read system posts. Prefer waiting before sending new actions.
        </div>
      ) : null}

      <Link
        href={`/league/${encodeURIComponent(leagueId)}?view=league_chat`}
        className="flex min-h-[56px] items-center justify-center rounded-xl bg-sky-600/35 text-[14px] font-bold text-white hover:bg-sky-600/45"
        data-testid="zombie-open-league-chat"
      >
        Open league chat
      </Link>

      <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--zombie-text-dim)]">Action cards</p>
        <SerumUseCard leagueId={leagueId} serumCount={serumCount} allies={allies} />
        <BombUseCard leagueId={leagueId} hasBomb={hasBomb} isSurvivor={isSurvivor} />
        <AmbushConfirmationCard
          leagueId={leagueId}
          isWhisperer={inv?.isWhisperer ?? false}
          ambushesLeft={inv?.ambushesRemaining ?? 0}
        />
        <RevivalCard
          leagueId={leagueId}
          serumCount={serumCount}
          reviveThreshold={inv?.rules.reviveThreshold ?? 3}
        />
        {inv?.pendingBashingDecision ? (
          <BashingDecisionCard
            leagueId={leagueId}
            loserName={inv.pendingBashingDecision.loserName}
            margin={inv.pendingBashingDecision.margin}
            hoursLeft={inv.pendingBashingDecision.hoursLeft}
          />
        ) : null}
      </div>

      <div className="rounded-xl border border-white/[0.08] p-3 text-[11px] text-[var(--zombie-text-dim)]">
        <p className="font-bold text-white/80">Message styles (in chat)</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>✓ Success: green left border panel</li>
          <li>✗ Rejected: red left border panel</li>
          <li>⏳ Pending: amber border</li>
          <li>⚡ System: full width, no avatar</li>
        </ul>
      </div>

      {isZombie ? (
        <p className="text-[11px] text-[var(--zombie-text-dim)]">Zombie: some weapons stay locked — see Items tab.</p>
      ) : null}
    </div>
  )
}
