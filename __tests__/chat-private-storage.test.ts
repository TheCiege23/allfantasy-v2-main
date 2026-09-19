// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), options: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { constructor(options: unknown) { mocks.options(options) } send = mocks.send; destroy = mocks.destroy },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@vercel/blob', () => ({ get: vi.fn(), put: vi.fn() }))
import { getPrivateChatFile, putPrivateChatFile } from '@/lib/chat-core/privateStorage'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CHAT_PRIVATE_S3_CONFIG', JSON.stringify({ endpoint: 'https://storage.example.test', bucketName: 'private', region: 'auto', accessKeyId: 'test', secretAccessKey: 'test', urlStyle: 'virtual-host' }))
})
afterEach(() => vi.unstubAllEnvs())
it('writes a private object with its content type and releases the client', async () => {
  mocks.send.mockResolvedValue({})
  await expect(putPrivateChatFile('chat/league/image/a.png', new Blob(['test']), 'image/png')).resolves.toBe('chat/league/image/a.png')
  expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'private', Key: 'chat/league/image/a.png', ContentType: 'image/png', CacheControl: 'private, no-store' })
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: false }))
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
it('keeps the reader alive through streaming and releases it when consumed', async () => {
  mocks.send.mockResolvedValue({ ContentType: 'image/png', Body: { transformToWebStream: () => new Blob(['test']).stream() } })
  const file = await getPrivateChatFile('chat/league/image/a.png')
  expect(mocks.destroy).not.toHaveBeenCalled()
  expect(await new Response(file!.stream).text()).toBe('test')
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
it('returns a missing file without leaking a storage exception', async () => {
  mocks.send.mockRejectedValue({ name: 'NoSuchKey' })
  expect(await getPrivateChatFile('chat/league/image/missing.png')).toBeNull()
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
it('releases the client on failed writes', async () => {
  mocks.send.mockRejectedValue(new Error('unavailable'))
  await expect(putPrivateChatFile('chat/league/image/a.png', new Blob(['test']), 'image/png')).rejects.toThrow('unavailable')
  expect(mocks.destroy).toHaveBeenCalledOnce()
})
