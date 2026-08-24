'use client'

import { useMemo } from 'react'
import { SimulationPanel } from '@/components/ai/sim/SimulationPanel'
import type { SimPlayerInput, SimTeamInput } from '@/lib/ai/sim/types'

function toSimPlayer(p: { id: string; name: string; position: string }, idx: number): SimPlayerInput {
  return {
    id: p.id || `asset-${idx}`,
    name: p.name,
    position: p.position?.trim() || 'FLEX',
    projection: 9 + (idx % 6) * 0.85,
    variance: 7,
  }
}

function padToNine(players: SimPlayerInput[], seed: string): SimPlayerInput[] {
  const out = [...players]
  let i = 0
  while (out.length < 9) {
    out.push({
      id: `${seed}-bench-${i}`,
      position: 'FLEX',
      projection: 7.2 + (i % 4) * 0.15,
      variance: 6.5,
    })
    i++
  }
  return out.slice(0, 9)
}

/**
 * Monte Carlo trade impact for the sender side. Lists are the assets entered on each side of the trade hub
 * (same shape as the main evaluator — typically the players involved in the deal).
 */
export function TradeSimulationStrip({
  senderTeamName,
  receiverTeamName,
  senderPlayers,
  receiverPlayers,
  leagueSize = 12,
}: {
  senderTeamName: string
  receiverTeamName: string
  senderPlayers: Array<{ id: string; name: string; position: string }>
  receiverPlayers: Array<{ id: string; name: string; position: string }>
  leagueSize?: number
}) {
  const requestBody = useMemo(() => {
    const snd = senderPlayers.filter((p) => p.name.trim()).map(toSimPlayer)
    const rcv = receiverPlayers.filter((p) => p.name.trim()).map(toSimPlayer)
    const senderBefore = padToNine(snd, 'snd')
    const receiverBefore = padToNine(rcv, 'rcv')
    const senderAfter = padToNine(rcv, 'snd-aft')

    const teams: SimTeamInput[] = [
      { id: 'sender', name: senderTeamName, roster: senderBefore },
      { id: 'receiver', name: receiverTeamName, roster: receiverBefore },
    ]

    return {
      kind: 'trade' as const,
      iterations: 160,
      teams,
      beforePlayers: senderBefore,
      afterPlayers: senderAfter,
      focusedTeamId: 'sender',
      leagueSize,
      weeksRemaining: 12,
    }
  }, [senderTeamName, receiverTeamName, senderPlayers, receiverPlayers, leagueSize])

  const canSim = senderPlayers.some((p) => p.name.trim()) && receiverPlayers.some((p) => p.name.trim())

  if (!canSim) return null

  return (
    <SimulationPanel
      title="Sim this trade"
      description="Rest-of-season Monte Carlo estimate for the sender: compares your listed package vs the package you receive. Projections are synthetic placeholders, not real player projections."
      requestBody={requestBody}
      tradeFocusTeamId="sender"
      className="mt-6"
    />
  )
}
