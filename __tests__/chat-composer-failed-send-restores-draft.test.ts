import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A failed send must give the message back.
 *
 * 🛑 WHAT HAPPENED. A user attached an image, typed a message, and clicked send while their
 * browser had briefly lost connectivity. The composer emptied, no request left the machine,
 * no error appeared anywhere, and the message was gone. The only visible trace was
 * `net::ERR_INTERNET_DISCONNECTED` in the console — on an unrelated NextAuth endpoint.
 *
 * TWO DEFECTS COMBINED, and neither is dangerous alone:
 *   1. ChatComposer.handleSend clears text, attachments, GIF and poll BEFORE awaiting
 *      onSend, and had `try { … } finally { setSending(false) }` with NO catch. A rejection
 *      left the input empty and reported nothing.
 *   2. Both send handlers had silent early `return`s and swallowed their own errors, so the
 *      composer could not tell "sent" from "did nothing" even if it had looked.
 *
 * ⚠ THE FIX IS SYMMETRIC AND BOTH HALVES ARE REQUIRED. The handlers throw on every
 * non-send path; the composer catches, restores, and reports. Either half alone still loses
 * messages — a catch with nothing to catch, or a throw with nobody listening.
 */

const COMPOSER = 'app/dashboard/components/chat/ChatComposer.tsx'
const DRAWER = 'components/core-app/comms/CommsDrawer.tsx'
const THREAD = 'components/core-app/comms/ThreadPanel.tsx'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** Comment-stripped, so these assertions read CODE and not the prose describing it. */
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

describe('the composer puts a failed message back', () => {
  it('restores every field it optimistically cleared', () => {
    const code = stripComments(read(COMPOSER))
    // The clear is optimistic; each of these must be undone on failure.
    for (const restore of [
      'setText(prevText)',
      'setPendingGif(prevGif)',
      'setAttachments(prevAttachments)',
      'setPollDraft(prevPoll)',
    ]) {
      expect(code).toContain(restore)
    }
  })

  it('has a catch at all — it previously had only try/finally', () => {
    const code = stripComments(read(COMPOSER))
    // `finally { setSending(false) }` resets the spinner and reports nothing.
    expect(code).toMatch(/catch\s*\(err\)/)
    expect(code).toContain('toast.error')
  })

  it('names the offline case, which is what the user actually hit', () => {
    const code = stripComments(read(COMPOSER))
    expect(code).toContain('navigator.onLine')
  })
})

describe('both send handlers signal failure instead of swallowing it', () => {
  /*
   * ⚠ ASSERT THE THROW, NOT THE PRESENCE OF A CATCH. A `catch` that only calls setError is
   * exactly the shape that lost the message: it looks like error handling and tells the
   * composer nothing. What matters is that the rejection propagates.
   */
  it.each([
    ['CommsDrawer', DRAWER],
    ['ThreadPanel', THREAD],
  ])('%s rethrows after recording the error', (_label, file) => {
    const code = stripComments(read(file))
    expect(code).toMatch(/setError\([\s\S]{0,160}?\n\s*throw e/)
  })

  it.each([
    ['CommsDrawer', DRAWER],
    ['ThreadPanel', THREAD],
  ])('%s throws on its guard paths rather than returning silently', (_label, file) => {
    const code = stripComments(read(file))
    expect(code).toMatch(/if \(!scopeId\) throw|if \(!openThread\) throw/)
    expect(code).toMatch(/throw new Error\('still sending the previous message'\)/)
    expect(code).toMatch(/throw new Error\('nothing to send'\)/)
  })

  /*
   * The specific regression: a bare `return` on a guard. It is indistinguishable from a
   * successful send to the caller, and the caller has already thrown the draft away.
   */
  /*
   * ⚠ SCOPED TO sendPayload, NOT THE WHOLE FILE — and the first version was not, which is
   * why it failed. `toggleMute` in ThreadPanel legitimately guards with
   * `if (!openThread || busy) return`: no draft is at stake there, so a silent return is
   * correct. A file-wide assertion would have banned a good pattern to catch a bad one, and
   * the next person would have "fixed" a mute button that was never broken.
   *
   * The defect is a silent return on the path the COMPOSER awaits. Assert there.
   */
  function sendPayloadBody(file: string): string {
    const code = stripComments(read(file))
    const start = code.indexOf('const sendPayload')
    expect(start).toBeGreaterThan(-1)
    const end = code.indexOf('\n  const ', start + 20)
    return code.slice(start, end === -1 ? undefined : end)
  }

  it.each([
    ['CommsDrawer', DRAWER],
    ['ThreadPanel', THREAD],
  ])('%s has no silent guard return inside sendPayload', (_label, file) => {
    const body = sendPayloadBody(file)
    expect(body).not.toMatch(/if \(!scopeId \|\| sending\) return/)
    expect(body).not.toMatch(/if \(!openThread \|\| busy\) return/)
    expect(body).not.toMatch(/Object\.keys\(metadata\)\.length === 0\) return/)
  })

  it('leaves unrelated guards alone — toggleMute may still return silently', () => {
    // A positive control for the scoping above: proves the file-wide pattern still exists
    // and that the previous test is passing because of scope, not because it matches nothing.
    const code = stripComments(read(THREAD))
    expect(code).toMatch(/if \(!openThread \|\| busy\) return/)
  })
})
