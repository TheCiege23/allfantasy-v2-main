/** Read a licensed, normalized NBA draft board. Supply --apply to save it after a dry run. */
import { readFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { importNbaProspectRanks } from '@/lib/adp/nbaProspectRanks'

async function main() {
  const [file, flag, ...extra] = process.argv.slice(2)
  if (!file || (flag && flag !== '--apply') || extra.length) {
    throw new Error('Usage: ingest-nba-prospect-ranks.ts <normalized.json> [--apply]')
  }
  const result = await importNbaProspectRanks(JSON.parse(await readFile(file, 'utf8')), flag === '--apply')
  console.log(JSON.stringify(result))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  console.error(/^(Usage:|Supply a fresh|Fewer than five|The stored rankings)/.test(message) ? message : 'NBA prospect rankings could not be imported.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
