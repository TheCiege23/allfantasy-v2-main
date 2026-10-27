import { prisma } from '@/lib/prisma'
import { generateZombieRulesDocumentHtml } from '@/lib/zombie/rulesDocGenerator'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { ZombieRulesClient } from './ZombieRulesClient'

export default async function ZombieRulesPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { sport: true, isPaid: true, name: true, currentWeek: true, season: true, experienceMode: true },
  })
  const [html, rules, leagueConfig] = await Promise.all([
    generateZombieRulesDocumentHtml(leagueId, z?.sport ?? 'NFL'),
    getZombieRulesForSport(z?.sport ?? 'NFL'),
    getZombieLeagueConfig(leagueId),
  ])

  return (
    <ZombieRulesClient
      leagueId={leagueId}
      sport={z?.sport ?? 'NFL'}
      isPaid={z?.isPaid ?? false}
      leagueName={z?.name ?? 'Zombie League'}
      currentWeek={z?.currentWeek ?? 1}
      season={z?.season ?? new Date().getFullYear()}
      rulesHtml={html}
      rules={rules}
      experienceMode={z?.experienceMode ?? null}
      serumAwardHighScore={leagueConfig?.serumAwardHighScore ?? false}
      serumAwardOnBashMaul={leagueConfig?.serumAwardOnBashMaul ?? false}
    />
  )
}
