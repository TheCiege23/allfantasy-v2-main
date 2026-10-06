import type { Prisma } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { prisma } from '../lib/prisma'
import { searchCFBPlayers } from '../lib/cfb-player-data'
import { normalizePlayerName } from '../lib/team-abbrev'
import { VERIFIED_NCAAF_RESERVES } from '../lib/player-identity/verifiedNcaafReserves'

// Reviewed repair only. Default is a dry run. This does not infer current school,
// delete canonical identities, change lineup slots, or write any scores.
const KNOWN_BAD_LINKS: Record<string, string> = { '05khp': '5296359', '04zjh': '5227943', '05w3m': '5296625' }
const key = (name: string) => {
 const parts = name.split(',')
 return normalizePlayerName(parts.length === 2 ? `${parts[1]} ${parts[0]}` : name).replace(/[.'’-]/g, '')
}
async function main() {
 const args = process.argv.slice(2)
 const snapshotId = args.find(a => a.startsWith('--snapshot='))?.slice('--snapshot='.length)
 const apply = args.includes('--apply')
 if (!snapshotId) throw new Error('Pass --snapshot=<owned Fantrax snapshot UUID>; --apply is optional')
 const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: snapshotId }, select: { appUserId: true, season: true, sport: true, roster: true } })
 const league = await prisma.league.findFirst({ where: { platform: 'fantrax', platformLeagueId: snapshotId, sport: 'NCAAF', season: 2026 }, select: { id: true } })
 if (!snapshot?.appUserId || snapshot.sport !== 'cfb' || snapshot.season !== 2026 || !league || !Array.isArray(snapshot.roster)) throw new Error('Owned imported 2026 CFB scope guard failed')
 const roster = snapshot.roster as Array<{ fantraxId?: string; name?: string; primaryPosition?: string }>
 const proofs = VERIFIED_NCAAF_RESERVES.filter(p => p.cfbdId)
 for (const proof of VERIFIED_NCAAF_RESERVES) {
  const source = roster.filter(p => p.fantraxId === proof.fantraxId)
  if (source.length !== 1 || key(source[0]!.name ?? '') !== key(proof.name) || source[0]!.primaryPosition !== proof.position) throw new Error(`Source proof guard failed: ${proof.fantraxId}`)
  if (!proof.cfbdId) continue
  const provider = await searchCFBPlayers(proof.name)
  const exact = provider.filter(p => String(p.id) === proof.cfbdId && key(p.fullName) === key(proof.cfbdName!) && p.position === proof.position && p.team === proof.historicalSchool)
  if (exact.length !== 1) throw new Error(`Historical provider proof guard failed: ${proof.fantraxId}`)
 }
 const before = await prisma.playerIdentityMap.findMany({ where: { sport: { in: ['NCAAF', 'NCAAFB'] }, OR: [{ fantraxId: { in: VERIFIED_NCAAF_RESERVES.map(p => p.fantraxId) } }, { cfbdId: { in: proofs.map(p => p.cfbdId!) } }] } })
 const prospectProof = VERIFIED_NCAAF_RESERVES.find(p => p.fantraxId === '077wg')!
 const prospectOwned = before.filter(r => r.fantraxId === prospectProof.fantraxId)
 if (prospectOwned.length > 1 || prospectOwned.some(r => key(r.canonicalName) !== key(prospectProof.name) || r.position !== prospectProof.position || r.cfbdId !== null)) throw new Error('Prospect source identity guard failed')
 const plan = proofs.map(p => {
  const owned = before.filter(r => r.fantraxId === p.fantraxId)
  if (owned.length !== 1 || key(owned[0]!.canonicalName) !== key(p.name) || owned[0]!.position !== p.position) throw new Error(`Unique source identity guard failed: ${p.fantraxId}`)
  const row = owned[0]!
  if (row.cfbdId && row.cfbdId !== p.cfbdId && row.cfbdId !== KNOWN_BAD_LINKS[p.fantraxId]) throw new Error(`Existing link conflict: ${p.fantraxId}`)
  if (before.some(r => r.cfbdId === p.cfbdId && r.fantraxId && r.fantraxId !== p.fantraxId)) throw new Error(`Reverse source identity conflict: ${p.fantraxId}`)
  return { proof: p, row, changed: row.cfbdId !== p.cfbdId }
 })
 if (apply) {
  mkdirSync(resolve('tmp'), { recursive: true })
  writeFileSync(resolve('tmp', `ncaaf-reserve-identities-before-${Date.now()}.json`), JSON.stringify(before, null, 2), { flag: 'wx' })
  await prisma.$transaction(async tx => {
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fantrax:ncaaf-current-roster-links'))`
   for (const { proof, row, changed } of plan) {
    if (!changed) continue
    const collision = await tx.playerIdentityMap.count({ where: { sport: { in: ['NCAAF', 'NCAAFB'] }, cfbdId: proof.cfbdId, fantraxId: { not: null }, NOT: { fantraxId: proof.fantraxId } } })
    const owners = await tx.playerIdentityMap.count({ where: { sport: { in: ['NCAAF', 'NCAAFB'] }, fantraxId: proof.fantraxId } })
    if (collision || owners !== 1) throw new Error('Concurrent provider claim guard failed')
    const written = await tx.playerIdentityMap.updateMany({ where: { id: row.id, fantraxId: row.fantraxId, canonicalName: row.canonicalName, position: row.position, cfbdId: row.cfbdId, updatedAt: row.updatedAt }, data: { cfbdId: proof.cfbdId, lastSyncedAt: new Date() } })
    if (written.count !== 1) throw new Error('Concurrent identity update guard failed')
   }
   const prospectNow = await tx.playerIdentityMap.count({ where: { sport: { in: ['NCAAF', 'NCAAFB'] }, fantraxId: prospectProof.fantraxId } })
   if (prospectNow !== prospectOwned.length) throw new Error('Concurrent prospect identity guard failed')
   if (!prospectNow) await tx.playerIdentityMap.create({ data: { sport: 'NCAAF', fantraxId: prospectProof.fantraxId, canonicalName: prospectProof.name, normalizedName: normalizePlayerName(prospectProof.name), position: prospectProof.position, cfbdId: null, currentTeam: null } })
   const cacheKey = `fantrax:ncaaf-reserve-proof:${snapshotId}:2026`
   const data = { verifiedAt: new Date().toISOString(), season: 2026, players: VERIFIED_NCAAF_RESERVES } as unknown as Prisma.InputJsonValue
   const expiresAt = new Date('2027-01-01T00:00:00Z')
   await tx.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
  }, { isolationLevel: 'Serializable', timeout: 60000 })
 }
 console.log(JSON.stringify({ apply, historicalIdentitiesVerified: proofs.length, prospectIdentityCreates: prospectOwned.length ? 0 : 1, writes: plan.filter(p => p.changed).length, correctedNamesakes: plan.filter(p => p.changed && p.row.cfbdId).length, availability: VERIFIED_NCAAF_RESERVES.reduce((a, p) => ({ ...a, [p.availability]: (a[p.availability] ?? 0) + 1 }), {} as Record<string, number>), remainingProviderIdentity: ['Ryder Lyons'] }))
}
main().catch(e => { console.error({ error: e instanceof Error ? e.message : 'Reserve identity repair failed' }); process.exitCode = 1 }).finally(() => prisma.$disconnect())
