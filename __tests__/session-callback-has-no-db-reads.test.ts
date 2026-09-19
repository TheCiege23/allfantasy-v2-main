/**
 * The NextAuth session callback must not touch the database.
 *
 * 🛑 THIS IS A PER-REQUEST COST, NOT A PER-FEATURE ONE. Whatever this callback does, it does on
 * every authenticated request in the product — there are ~2,259 `getServerSession` call sites
 * across ~1,017 API routes, and `/core?league=` resolves the session twice per render
 * (`generateMetadata` and the page). A `spotifyAccount` boolean lived here and cost one or two
 * prisma reads each time, for a fact read by exactly one hook; it now rides on the
 * `/api/music/favorites` response that hook already fetches.
 *
 * ⚠ A SOURCE GUARD, BECAUSE THERE IS NO CHEAP BEHAVIOURAL ONE. Nothing in this repo executes the
 * real callback — every suite mocks `@/lib/auth` to `{ authOptions: {} }` — so importing the real
 * module to count prisma calls would drag in the whole auth graph. Reading the source is the check
 * that actually runs.
 *
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY ASSERTION, and that is load-bearing rather than tidy: the
 * comment left in `lib/auth.ts` explaining the removal contains both `prisma` and
 * `spotifyAccount`, so a guard reading raw text would fail on the warning against the thing it is
 * warning about.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

/** Remove line and block comments, leaving string and template literals intact. */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i += 1
      while (i < source.length) {
        out += source[i]
        if (source[i] === '\\') {
          out += source[i + 1] ?? ''
          i += 2
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    out += c
    i += 1
  }
  return out
}

/** The body of `async session({ session, token }) { … }`, comments removed. */
function sessionCallbackBody(): string {
  const source = stripComments(readFileSync(join(ROOT, 'lib', 'auth.ts'), 'utf8'))
  const start = source.indexOf('async session({ session, token })')
  if (start < 0) {
    throw new Error('could not find the session callback in lib/auth.ts — this guard is blind')
  }

  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  let i = open
  let quote: string | null = null
  for (; i < source.length; i += 1) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  if (depth !== 0) {
    throw new Error('could not brace-match the session callback — this guard is blind')
  }
  return source.slice(open, i + 1)
}

describe('the guard is looking at the real callback', () => {
  /*
   * 🛑 WITHOUT THIS, EVERY ASSERTION BELOW PASSES ON AN EMPTY STRING. A rename, a reformat or a
   * broken brace matcher would silently reduce the extraction to nothing, and "nothing contains
   * no prisma call" is a check that cannot fail.
   */
  it('extracts a body that is recognisably the session callback', () => {
    const body = sessionCallbackBody()

    expect(body.length).toBeGreaterThan(200)
    expect(body).toContain('session.user.id')
    expect(body).toContain('token.username')
    expect(body).toContain('return session')
  })
})

describe('the session callback reads nothing from the database', () => {
  it('makes no prisma call', () => {
    expect(sessionCallbackBody()).not.toContain('prisma.')
  })

  it('does not reach the database by any other client', () => {
    const body = sessionCallbackBody()

    // The cost is the round trip, not the spelling of the client that makes it. This callback is
    // field copying off an already-decoded token; anything it has to WAIT for is a per-request tax.
    expect(body).not.toContain('await')
    expect(body).not.toContain('$queryRaw')
    expect(body).not.toContain('findUnique')
    expect(body).not.toContain('findFirst')
  })
})

describe('the removed flag stays removed', () => {
  it('is not set on the session', () => {
    expect(sessionCallbackBody()).not.toContain('spotifyAccount')
  })

  it('is not declared on the session type', () => {
    /*
     * The declaration is what makes re-adding it look supported. Stripping comments matters here
     * too — the note left in its place names the field it is warning about.
     */
    const declarations = stripComments(
      readFileSync(join(ROOT, 'types', 'next-auth.d.ts'), 'utf8'),
    )

    expect(declarations).toContain('interface Session')
    expect(declarations).not.toContain('spotifyAccount')
  })
})
