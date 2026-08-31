/**
 * Why does pairing say "that league is already part of another franchise"?
 *
 *   npx tsx scripts/diagnose-franchise-claim.ts --league "Peach Bowl"
 *   npx tsx scripts/diagnose-franchise-claim.ts --league <League.id> --email you@example.com
 *
 * 🛑 READ-ONLY. Every query below is a find/count. There is no create, update,
 * delete or upsert in this file, and there must never be one — it is pointed at
 * a production database on purpose, to inspect a row a user cannot see from the
 * UI. Fixing what it finds is a separate, deliberate action.
 *
 * ⚠ IT PRINTS NO SECRETS. Never the DATABASE_URL, never a token. The database
 * host is reported as a bare hostname so you can confirm WHICH database you just
 * read without the credential that reached it.
 *
 * What it settles, and why the UI cannot:
 * `franchise_league_members` is unique on `(platform, leagueId)`, so one row can
 * make a league permanently unpairable. `attachToFranchise` refuses when that
 * row's `FranchiseLink.ownerUserId` is not the caller — and returns the SAME
 * sentence for three very different situations:
 *
 *   A. the link belongs to a different, live account          → refusal is correct
 *   B. the link belongs to YOU under a different user id      → should have merged
 *   C. the link's owner id matches no AppUser at all          → a dead claim
 *
 * ⚠ C IS REACHABLE AND PERMANENT. `FranchiseLink.ownerUserId` is a bare String
 * with an index and NO foreign key to AppUser, so nothing cascades when an
 * account is removed or replaced. The link outlives the owner, keeps the unique
 * (platform, leagueId) slot, and no screen in the app can release it.
 */
import * as dotenv from 'dotenv'

/* Same order as the other read-only audits here: .env.local wins, .env fills gaps.
   A bare tsx run loads neither on its own, so without this the script reads no
   DATABASE_URL and reports "not claimed" for every league — a false all-clear. */
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

import { prisma } from '../lib/prisma'

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : null
}

/** Hostname only — never the credential that reached it. */
function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? ''
  const m = raw.match(/@([^/:?]+)/)
  return m?.[1] ?? '(DATABASE_URL not set)'
}

async function main(): Promise<void> {
  const leagueArg = arg('league')
  const email = arg('email')

  if (!leagueArg) {
    console.error('usage: --league "<name or League.id>" [--email you@example.com]')
    process.exitCode = 1
    return
  }

  console.log(`database host : ${dbHost()}`)
  console.log(`league query  : ${leagueArg}`)
  console.log('')

  /* Accept an id or a name fragment — a user reading this off a screen has the name. */
  const leagues = await prisma.league.findMany({
    where: {
      OR: [{ id: leagueArg }, { name: { contains: leagueArg, mode: 'insensitive' } }],
    },
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      season: true,
      userId: true,
    },
    take: 25,
  })

  if (leagues.length === 0) {
    console.log('No League row matched. Try a shorter name fragment, or pass the League.id.')
    return
  }

  let viewerId: string | null = null
  if (email) {
    const me = await prisma.appUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    })
    viewerId = me?.id ?? null
    console.log(`your AppUser.id: ${viewerId ?? '(no AppUser found for that email)'}`)
    console.log('')
  }

  for (const lg of leagues) {
    const platform = String(lg.platform ?? '').toLowerCase()
    console.log('─'.repeat(72))
    console.log(`League   ${lg.name ?? '(unnamed)'}`)
    console.log(`  id            ${lg.id}`)
    console.log(`  platform      ${platform}   season ${lg.season ?? '—'}`)
    console.log(`  League.userId ${lg.userId ?? '(null)'}${viewerId && lg.userId === viewerId ? '   ← you own this league' : ''}`)

    /*
     * ⚠ TWO ID SPACES. Membership stores `League.id` for most platforms but
     * `FantraxLeague.id` for Fantrax, so checking only one returns "unclaimed"
     * for a league that is very much claimed. Both are looked up.
     */
    const keys = [{ platform, leagueId: lg.id }]
    if (platform === 'fantrax' && lg.platformLeagueId) {
      keys.push({ platform, leagueId: lg.platformLeagueId })
    }

    let foundAny = false
    for (const key of keys) {
      const member = await prisma.franchiseLeagueMember.findFirst({
        where: { platform: key.platform, leagueId: key.leagueId },
        select: { id: true, role: true, linkId: true, leagueId: true, createdAt: true },
      })
      if (!member) continue
      foundAny = true

      const link = await prisma.franchiseLink.findUnique({
        where: { id: member.linkId },
        select: { id: true, name: true, ownerUserId: true, createdAt: true },
      })

      console.log(`  CLAIMED by membership ${member.id}`)
      console.log(`    role          ${member.role}`)
      console.log(`    keyed on      ${member.leagueId}${member.leagueId === lg.id ? ' (League.id)' : ' (snapshot id)'}`)
      console.log(`    claimed at    ${member.createdAt.toISOString()}`)

      if (!link) {
        /* Cascade should prevent this; if it prints, the constraint is not doing its job. */
        console.log('    link          MISSING — orphaned membership row')
        console.log('    VERDICT       dead claim (no link). Nothing can pair this league.')
        continue
      }

      const memberCount = await prisma.franchiseLeagueMember.count({ where: { linkId: link.id } })
      const owner = await prisma.appUser.findUnique({
        where: { id: link.ownerUserId },
        select: { id: true, email: true },
      })

      console.log(`    franchise     "${link.name}" (${link.id}), ${memberCount} member(s)`)
      console.log(`    ownerUserId   ${link.ownerUserId}`)
      console.log(`    owner exists  ${owner ? 'yes' : 'NO — no AppUser with that id'}`)
      if (owner && email) {
        const same = owner.email && email && owner.email.toLowerCase() === email.toLowerCase()
        console.log(`    owner email   ${owner.email ?? '(none)'}${same ? '   ← same as yours' : ''}`)
      }

      if (!owner) {
        console.log('    VERDICT       C — DEAD CLAIM. The owning account no longer exists, but')
        console.log('                  the link holds the unique (platform, leagueId) slot forever.')
        console.log('                  No screen in the app can release it.')
      } else if (viewerId && link.ownerUserId === viewerId) {
        console.log('    VERDICT       B(same-id) — this is YOUR franchise under YOUR current id.')
        console.log('                  Pairing should have merged. If it errored, the bug is in the')
        console.log('                  merge path, not the ownership check.')
      } else if (viewerId) {
        console.log('    VERDICT       A or B — the link is owned by a DIFFERENT id than yours.')
        console.log('                  Same person under an old account => B (needs a merge).')
        console.log('                  A different person => A, and the refusal is correct.')
        console.log('                  The owner email above is what tells them apart.')
      } else {
        console.log('    VERDICT       re-run with --email to compare this owner against you.')
      }
    }

    if (!foundAny) {
      console.log('  not claimed by any franchise — this league is free to pair')
    }
  }
  console.log('─'.repeat(72))
}

main()
  .catch((err: unknown) => {
    console.error('diagnose-franchise-claim failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
