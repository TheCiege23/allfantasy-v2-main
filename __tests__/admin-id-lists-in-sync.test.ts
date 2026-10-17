// @vitest-environment node
/**
 * The owner/developer ID list exists twice — `MIDDLEWARE_ADMIN_USER_IDS` in middleware.ts (Edge-safe,
 * gates the VPN and state blocks) and `STATIC_ADMIN_USER_IDS` in lib/dev-admin/access.ts (the app's
 * admin check). Both said "keep in sync manually".
 *
 * 🛑 BOTH WERE IN SYNC AND BOTH WERE WRONG. On 2026-10-02 every ID in them was checked against
 * production `app_users` and none existed, so the middleware's owner bypass matched nobody and the
 * owner was locked out by the VPN gate while the app showed him as admin. This pins the two lists to
 * each other and refuses the retired IDs; it cannot check production, so the rule that every ID is a
 * real row stays a comment beside each list.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const UUID = /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g

function idsIn(file: string, constName: string): string[] {
  const src = readFileSync(resolve(__dirname, '..', file), 'utf8')
  const start = src.indexOf(`const ${constName} = new Set<string>([`)
  expect(start, `${constName} not found in ${file}`).toBeGreaterThan(-1)
  const body = src.slice(start, src.indexOf('])', start))
  return [...body.matchAll(UUID)].map((m) => m[1]).sort()
}

const middleware = idsIn('middleware.ts', 'MIDDLEWARE_ADMIN_USER_IDS')
const app = idsIn('lib/dev-admin/access.ts', 'STATIC_ADMIN_USER_IDS')

describe('owner/developer admin IDs', () => {
  it('🛑 the middleware list and the app list are identical', () => {
    expect(middleware).toEqual(app)
  })

  it('neither list is empty', () => {
    expect(middleware.length).toBeGreaterThan(0)
  })

  it('🛑 carries the owner account, TheCiege26', () => {
    expect(middleware).toContain('9791bae0-e47f-418a-ae40-285f6a2e7887')
  })

  it('🛑 the retired IDs, which exist nowhere in production, are not back', () => {
    for (const dead of ['944bb9f1-7a25-455b-8ef2-66146dbf3553', '3a7ffd10-b1a5-4a40-8d07-232364596735']) {
      expect(middleware).not.toContain(dead)
      expect(app).not.toContain(dead)
    }
  })
})
