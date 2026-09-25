import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The /messages composer must NAME the conversation it is uploading into.
 *
 * `/api/shared/chat/upload` now stores privately and only for a member of the chat the
 * request names (see __tests__/shared-chat-upload-private.test.ts). A composer that posts
 * only the file gets a 400 and the photo never attaches — so the client half of the fix is
 * that every upload call site sends the selected thread id.
 *
 * Source-level on purpose: MessagesContent is a 2,000-line client page with a dozen fetches
 * on mount, and the property is a single FormData field. Comments are stripped and each
 * upload block is read on its own, so prose describing the field cannot satisfy it.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

/** The code between each `new FormData()` and the POST to the shared upload route that uses it. */
function uploadBlocks(code: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const post = code.indexOf('"/api/shared/chat/upload"', from)
    if (post === -1) break
    const start = code.lastIndexOf('new FormData()', post)
    blocks.push(code.slice(start, post))
    from = post + 1
  }
  return blocks
}

describe('/messages uploads name their conversation', () => {
  it('sends threadId with every upload to /api/shared/chat/upload', () => {
    const blocks = uploadBlocks(stripComments(read('app/messages/MessagesContent.tsx')))
    expect(blocks).toHaveLength(2) // the photo button and the file button
    for (const b of blocks) {
      expect(b).toMatch(/formData\.append\("threadId", selectedThreadId\)/)
    }
  })

  /*
   * A pending attachment is stored under the conversation it was uploaded into. Sending it
   * after switching conversations would post a photo the new conversation cannot open.
   */
  it('drops a pending attachment when the conversation changes', () => {
    const code = stripComments(read('app/messages/MessagesContent.tsx'))
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*clearAttachmentState\(setAttachmentPreview, setUploadError\)\s*\}, \[selectedThreadId\]\)/,
    )
  })

  it('the shared media hook sends it too', () => {
    const blocks = uploadBlocks(stripComments(read('hooks/useMediaUpload.ts')))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatch(/formData\.append\("threadId", threadId\)/)
  })
})
