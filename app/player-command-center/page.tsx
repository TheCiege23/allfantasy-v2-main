import type { Metadata } from 'next'
import PlayerCommandCenterClient from '@/components/player-command-center/PlayerCommandCenterClient'

export const metadata: Metadata = {
  title: 'Player Command Center | AllFantasy',
  description:
    'Search a player once and see every league where they matter — lineup status, injuries, time to lock, and the best move in each league.',
}

export default function PlayerCommandCenterPage() {
  return <PlayerCommandCenterClient />
}
