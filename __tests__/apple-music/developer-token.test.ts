// @vitest-environment node
// The route signs on the server. Under jsdom, TextEncoder returns a Uint8Array
// from another realm and jose refuses it ("payload must be an instance of Uint8Array").
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify } from 'jose'
import {
  DEVELOPER_TOKEN_TTL_SECONDS,
  getDeveloperToken,
  normalizePrivateKey,
  readAppleMusicConfig,
  resetDeveloperTokenCache,
  signDeveloperToken,
} from '@/lib/apple-music/developerToken'

// A throwaway key generated per run — never a real MusicKit key.
let privatePem = ''
let publicPem = ''

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  privatePem = await exportPKCS8(privateKey)
  publicPem = await exportSPKI(publicKey)
})

beforeEach(() => resetDeveloperTokenCache())

describe('readAppleMusicConfig', () => {
  it('is null unless all three values are set', () => {
    expect(readAppleMusicConfig({})).toBeNull()
    expect(readAppleMusicConfig({ APPLE_MUSIC_TEAM_ID: 'T', APPLE_MUSIC_KEY_ID: 'K' })).toBeNull()
    expect(
      readAppleMusicConfig({ APPLE_MUSIC_TEAM_ID: 'T', APPLE_MUSIC_KEY_ID: 'K', APPLE_MUSIC_PRIVATE_KEY: '  ' }),
    ).toBeNull()
  })

  it('reads the optional origin list', () => {
    const config = readAppleMusicConfig({
      APPLE_MUSIC_TEAM_ID: ' TEAM123 ',
      APPLE_MUSIC_KEY_ID: 'KEY456',
      APPLE_MUSIC_PRIVATE_KEY: privatePem,
      APPLE_MUSIC_ALLOWED_ORIGINS: 'https://allfantasy.ai, https://www.allfantasy.ai,',
    })
    expect(config?.teamId).toBe('TEAM123')
    expect(config?.origins).toEqual(['https://allfantasy.ai', 'https://www.allfantasy.ai'])
  })
})

describe('normalizePrivateKey', () => {
  it('recovers the same key from every way it gets pasted into an env var', () => {
    const escaped = privatePem.replace(/\n/g, '\\n')
    const crlf = privatePem.replace(/\n/g, '\r\n')
    const quoted = `"${privatePem}"`
    const oneLine = privatePem.replace(/\n/g, ' ')
    const canonical = normalizePrivateKey(privatePem)
    for (const variant of [escaped, crlf, quoted, oneLine]) {
      expect(normalizePrivateKey(variant)).toBe(canonical)
    }
  })
})

describe('signDeveloperToken', () => {
  it('signs an ES256 token Apple can verify: kid header, team issuer, 12h life', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { token, expiresAt } = await signDeveloperToken(
      { teamId: 'TEAM123', keyId: 'KEY456', privateKey: normalizePrivateKey(privatePem.replace(/\n/g, '\\n')), origins: [] },
      now,
    )

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'ES256', kid: 'KEY456' })
    const { payload } = await jwtVerify(token, await importSPKI(publicPem, 'ES256'), { issuer: 'TEAM123' })
    expect(payload.iat).toBe(now)
    expect(payload.exp).toBe(now + DEVELOPER_TOKEN_TTL_SECONDS)
    expect(expiresAt).toBe(now + DEVELOPER_TOKEN_TTL_SECONDS)
    expect(payload.origin).toBeUndefined()
  })

  it('locks the token to the allowed origins when they are configured', async () => {
    const { token } = await signDeveloperToken({
      teamId: 'TEAM123',
      keyId: 'KEY456',
      privateKey: privatePem,
      origins: ['https://allfantasy.ai'],
    })
    const { payload } = await jwtVerify(token, await importSPKI(publicPem, 'ES256'))
    expect(payload.origin).toEqual(['https://allfantasy.ai'])
  })

  it('rejects a key that is not a PKCS8 private key', async () => {
    await expect(
      signDeveloperToken({ teamId: 'T', keyId: 'K', privateKey: 'not a key', origins: [] }),
    ).rejects.toThrow()
  })
})

describe('getDeveloperToken', () => {
  const config = () => ({ teamId: 'TEAM123', keyId: 'KEY456', privateKey: privatePem, origins: [] })

  it('reuses a token with plenty of life left', async () => {
    const now = 1_800_000_000
    const first = await getDeveloperToken(config(), now)
    const second = await getDeveloperToken(config(), now + 60 * 60)
    expect(second.token).toBe(first.token)
  })

  it('re-signs once under an hour is left', async () => {
    const now = 1_800_000_000
    const first = await getDeveloperToken(config(), now)
    const later = await getDeveloperToken(config(), now + DEVELOPER_TOKEN_TTL_SECONDS - 30 * 60)
    expect(later.token).not.toBe(first.token)
    expect(later.expiresAt).toBeGreaterThan(first.expiresAt)
  })

  it('re-signs when the key id changes', async () => {
    const now = 1_800_000_000
    const first = await getDeveloperToken(config(), now)
    const rotated = await getDeveloperToken({ ...config(), keyId: 'NEWKEY' }, now)
    expect(decodeProtectedHeader(rotated.token).kid).toBe('NEWKEY')
    expect(rotated.token).not.toBe(first.token)
  })
})
