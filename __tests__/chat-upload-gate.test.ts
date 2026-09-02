import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The chat attachment gate.
 *
 * 🛑 WHAT BROKE. `/api/chat/upload` used `requireVerifiedUser`, which demands
 * `ageConfirmedAt` as well as a verified email or phone. `lib/auth.ts` never writes
 * `ageConfirmedAt` on an OAuth sign-in, so every Google account that had not separately
 * confirmed its age got a 403 `AGE_REQUIRED` attaching an image in a league chat. Identical
 * defect to the one that stopped those accounts setting a profile picture, on a surface
 * nobody had reported yet.
 *
 * ⚠ THE FIX LOOSENS THE WRONG-SHAPED CHECK AND TIGHTENS THE RIGHT ONE. Age confirmation
 * goes; the `purpose=profile` bypass — which allowed an upload with NO leagueId and NO
 * threadId, skipping membership entirely — also goes, because avatars moved to
 * /api/user/profile/avatar and nothing sends it any more. Net effect: every upload must now
 * name a league or thread and prove access to it.
 */

const ROUTE = 'app/api/chat/upload/route.ts'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** Comment-stripped, so assertions read CODE and not the prose explaining the code. */
function stripComments(src: string): string {
  const out: string[] = []
  let inBlock = false
  for (const raw of src.split('\n')) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      line = line.slice(end + 2)
      inBlock = false
    }
    for (;;) {
      const start = line.indexOf('/*')
      if (start === -1) break
      const end = line.indexOf('*/', start + 2)
      if (end === -1) { line = line.slice(0, start); inBlock = true; break }
      line = line.slice(0, start) + line.slice(end + 2)
    }
    const lc = line.indexOf('//')
    if (lc !== -1) line = line.slice(0, lc)
    out.push(line)
  }
  return out.join('\n')
}

describe('chat uploads are not age-gated', () => {
  it('uses requireAuth, not requireVerifiedUser', () => {
    const code = stripComments(read(ROUTE))
    expect(code).toContain('requireAuth()')
    // The whole point: age confirmation must not gate attaching an image.
    expect(code).not.toContain('requireVerifiedUser')
  })

  it('matches its sibling chat upload routes, which were always session-only', () => {
    /*
     * Three chat upload routes with three different answers to "who may attach a file" is
     * how one of them ends up wrong without anybody noticing. This one was the outlier.
     */
    const shared = stripComments(read('app/api/shared/chat/upload/route.ts'))
    const bracket = stripComments(read('app/api/bracket/chat-upload/route.ts'))
    expect(shared).not.toContain('requireVerifiedUser')
    expect(bracket).not.toContain('requireVerifiedUser')
  })
})

describe('membership is still the real authorization', () => {
  /*
   * ⚠ THIS IS THE HALF THAT MUST NOT WEAKEN. Dropping the age check is only safe because
   * the caller still has to prove they are IN the league or thread. If these disappear,
   * the route becomes "any signed-in user may write into any league's chat storage".
   */
  /*
   * ⚠ ASSERT THE CALL SITE, NOT THE NAME. The first version of this test used
   * `toContain('canAccessLeague(')` and PASSED when the call site was deleted — because
   * `async function canAccessLeague(` is still in the file. It matched the definition of a
   * check nobody was running any more. Caught by mutation, not by review: removing the
   * membership guard left all six tests green.
   *
   * The awaited, negated call in the guard is what has to be present.
   */
  it('still proves league or thread access before writing', () => {
    const code = stripComments(read(ROUTE))
    expect(code).toMatch(/!\(await canAccessLeague\(leagueId, userId\)\)/)
    expect(code).toMatch(/!\(await canAccessThread\(threadId, userId\)\)/)
    expect(code).toMatch(/status:\s*403/)
  })

  it('rejects an upload that names neither a league nor a thread', () => {
    const code = stripComments(read(ROUTE))
    expect(code).toMatch(/if\s*\(!leagueId\s*&&\s*!threadId\)/)
  })

  /*
   * 🛑 THE BYPASS THAT IS GONE. `purpose=profile` let an upload skip the leagueId/threadId
   * requirement entirely — the one check that proves the caller belongs anywhere. It
   * existed for the settings page, which now uploads to /api/user/profile/avatar. Left in
   * place it would be a membership-free write path with no legitimate caller.
   */
  it('has no purpose=profile bypass left', () => {
    const code = stripComments(read(ROUTE))
    expect(code).not.toContain('isProfileAvatarUpload')
    expect(code).not.toContain("purpose")
  })

  it('writes every object under a league- or thread-scoped key', () => {
    const code = stripComments(read(ROUTE))
    expect(code).toContain('`chat/${leagueId}/')
    expect(code).toContain('`chat/thread/${threadId}/')
    // The profile prefix belonged to the removed bypass.
    expect(code).not.toContain('`profile/${userId}/')
  })
})
