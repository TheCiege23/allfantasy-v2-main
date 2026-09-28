// @vitest-environment node
/**
 * There is no sign-in by Sleeper username. A `sleeper` credentials provider used to accept a
 * public Sleeper username as the ONLY credential and sign the caller in as the account bound to
 * it. NextAuth serves every registered provider at /api/auth/callback/<id> whether or not a
 * button links to it, so registration alone is the exposure — this asserts on the registry.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const saved = process.env.NEXTAUTH_SECRET

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-not-a-real-credential'
})
afterAll(() => {
  if (saved === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = saved
})

describe('auth providers', () => {
  it('registers no provider that signs in by Sleeper username', async () => {
    const { authOptions } = await import('@/lib/auth')
    /*
     * ⚠ READ `options.id` FIRST. next-auth v4's CredentialsProvider returns a top-level
     * `id: "credentials"` for EVERY credentials provider and keeps a custom id in `options`,
     * which NextAuth merges at request time. Reading only the top level made this assertion
     * blind to exactly the provider it exists to forbid — measured against the old code.
     */
    const ids = authOptions.providers.map(
      (p) => (p as { options?: { id?: string } }).options?.id ?? (p as { id?: string }).id,
    )

    // Positive control: the registry was actually read, and still carries password sign-in.
    expect(ids).toContain('credentials')
    expect(ids).not.toContain('sleeper')
    for (const p of authOptions.providers) {
      const creds = (p as { options?: { credentials?: Record<string, unknown> } }).options?.credentials ?? {}
      expect(Object.keys(creds)).not.toContain('sleeperUsername')
    }
  })
})
