/**
 * Read-only check: does any connected Fantrax account in the named environment
 * own a team in the supplied league? Prints counts only, never user IDs,
 * team names, team IDs, or decrypted Secret IDs.
 *
 * node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *   scripts/audits/fantrax-account-league-ownership.ts 51isdapqmt6atvdz
 * Add --production-readonly only when using --env-file=.env.
 */
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import { listFantraxOwnedTeams } from '@/lib/league-import/fantrax/fantraxTeamSelection'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const leagueId = process.argv[2]
  if (!/^[a-z0-9]{16}$/.test(leagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  const target = targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL)
  if (target.label !== 'staging' && !(target.kind === 'production' &&
    process.argv.includes('--production-readonly'))) throw new Error('UNSAFE_DATABASE_TARGET')

  const accounts = await prisma.leagueAuth.findMany({ where: { platform: 'fantrax', apiKey: { not: null } },
    select: { userId: true, updatedAt: true } })
  let owningAccounts = 0
  let ownedTeams = 0
  let unreadableAccounts = 0
  let newestConnectionAt: string | null = null
  for (const account of accounts) {
    const updated = account.updatedAt.toISOString()
    if (!newestConnectionAt || updated > newestConnectionAt) newestConnectionAt = updated
    try {
      const credential = await getDecryptedAuth(account.userId, 'fantrax')
      if (!credential?.apiKey) { unreadableAccounts++; continue }
      const response = await getFantraxLeagues(credential.apiKey)
      if (!response.ok) { unreadableAccounts++; continue }
      const owned = response.data.filter((league) => league.leagueId === leagueId)
        .flatMap(listFantraxOwnedTeams)
      if (owned.length) { owningAccounts++; ownedTeams += owned.length }
    } catch { unreadableAccounts++ }
  }
  console.log(JSON.stringify({ target: target.label, readOnly: true,
    connectedAccounts: accounts.length, owningAccounts, ownedTeams,
    unreadableAccounts, newestConnectionAt }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error?.code || error?.name || 'AUDIT_FAILED' }))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
