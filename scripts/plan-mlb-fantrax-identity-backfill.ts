import { readFileSync, writeFileSync } from 'node:fs'
import { planMlbFantraxIdentityLinks, type MlbIdentityRow } from '../lib/player-identity/mlbFantraxIdentityPlan'
import type { FantraxPlayerRef } from '../lib/league-import/fantrax/fantraxApi'

const [refsFile, identitiesFile, outputFile] = process.argv.slice(2)
if (!refsFile || !identitiesFile || !outputFile) throw new Error('Usage: tsx scripts/plan-mlb-fantrax-identity-backfill.ts player-map.json identities.json output.json')
const refs = JSON.parse(readFileSync(refsFile, 'utf8')) as Record<string, FantraxPlayerRef>
const identities = JSON.parse(readFileSync(identitiesFile, 'utf8')) as MlbIdentityRow[]
const { links, ...counts } = planMlbFantraxIdentityLinks(Object.values(refs), identities)
writeFileSync(outputFile, JSON.stringify(links))
console.log(JSON.stringify({ ...counts, proposed: links.length }))
