import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * What a salary cap league imported from another platform must say when AllFantasy holds no
 * contracts for it.
 *
 * 🛑 THE CAP SCREENS SHOWED AN UNTOUCHED CAP AS IF IT WERE THE LEAGUE'S. Measured on production
 * 2026-11-20: 12 salary cap leagues, all imported from Sleeper, each with a config row written at
 * import, and `player_contracts` and `salary_cap_team_ledgers` empty for every one. Sleeper carries no
 * contract data; these leagues keep their contracts in a spreadsheet or another site. So Cap space read
 * the full default cap, Contracts read none, and Team builder planned against money nobody has.
 *
 * Null for a league AllFantasy hosts (an empty cap there is the real state before the startup
 * auction) and for any league that has contracts on file.
 */
export function importedCapContractsNote(platform: string | null | undefined, contractsOnFile: number): string | null {
  if (isNativePlatform(platform) || contractsOnFile > 0) return null
  const p = String(platform ?? '').trim().toLowerCase()
  const label = ({ sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fleaflicker: 'Fleaflicker', fantrax: 'Fantrax' } as Record<string, string>)[p] ?? 'the platform it was imported from'
  return `This league’s contracts are not in AllFantasy. It was imported from ${label}, which does not carry salaries or contract years, so the cap space, contracts and team builder here show an empty cap, not your league’s real one.`
}
