import { describe, it, expect, vi } from 'vitest'
const read = vi.hoisted(() => vi.fn())
vi.mock('@/lib/chat-core/privateStorage', () => ({ getPrivateChatFile: read, putPrivateChatFile: vi.fn(), privateChatStorageConfigured: () => true }))
import { ownsChimmyScreenshot, readChimmyScreenshot } from '@/lib/chimmy-chat/privateScreenshot'
describe('private Chimmy image access', () => {
 it('rejects other owners and traversal before touching storage', async () => {
 for (const path of ['chimmy-screenshots/other/abc.png','chimmy-screenshots/me/../other.png','chimmy-screenshots/me/abc.svg','https://example.com/me/abc.png']) { expect(ownsChimmyScreenshot(path,'me')).toBe(false); expect(await readChimmyScreenshot(path,'me')).toBeNull() }
 expect(read).not.toHaveBeenCalled()
 });
 it('serves only an owned supported image', async () => { read.mockResolvedValue({stream:{},contentType:'image/png'}); expect(await readChimmyScreenshot('chimmy-screenshots/me/abc.png','me')).toBeTruthy(); read.mockResolvedValue({stream:{},contentType:'text/html'}); expect(await readChimmyScreenshot('chimmy-screenshots/me/abc.png','me')).toBeNull() })
})
