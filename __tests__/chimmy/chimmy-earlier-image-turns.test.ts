/**
 * "I can't see the image you attached" on a text-only question (2026-09-30): an earlier screenshot
 * turn replays as bare text, so the model took the new question to have an image. Earlier image
 * turns are now marked, and the policy says only the current request can carry one.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CHIMMY_CURRENT_REQUEST_POLICY, EARLIER_IMAGE_NOTE, markEarlierImageTurns } from '@/lib/chimmy/currentRequestFocus'

describe('earlier image turns', () => {
  it('marks the two shapes an image turn replays as, and nothing else', () => {
    const turns = [
      { role: 'user', content: 'Screenshot: IMG_1234.png' },
      { role: 'user', content: '[image-only request]' },
      { role: 'assistant', content: 'Screenshot: noted' },
      { role: 'user', content: 'Braelon Allen for 2028 2nd Rd (JeffersonTD).' },
    ]
    const marked = markEarlierImageTurns(turns)
    expect(marked[0]!.content).toBe(`Screenshot: IMG_1234.png ${EARLIER_IMAGE_NOTE}`)
    expect(marked[1]!.content).toBe(`[image-only request] ${EARLIER_IMAGE_NOTE}`)
    expect(marked[2]!.content).toBe('Screenshot: noted')
    expect(marked[3]!.content).toBe('Braelon Allen for 2028 2nd Rd (JeffersonTD).')
    // Idempotent: a turn already marked is not marked twice.
    expect(markEarlierImageTurns(marked)[0]!.content).toBe(marked[0]!.content)
  })

  it('the policy says only the current request can carry an image', () => {
    expect(CHIMMY_CURRENT_REQUEST_POLICY).toMatch(/Only the CURRENT request can carry an image/)
  })

  it('the route marks history and hands the tool loop the screenshot evidence', () => {
    const route = readFileSync('app/api/chat/chimmy/route.ts', 'utf8')
    expect(route).toMatch(/^\s*const conversation = markEarlierImageTurns\(parsedConversation\.slice/m)
    expect(route).toMatch(/^\s*question: screenshotSummary\n\s*\? `\$\{message\}\\n\\n\$\{fenceScreenshotEvidence\(classifyScreenshotEvidence\(screenshotSummary\)\)\}`/m)
  })
})
