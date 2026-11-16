import { SignJWT, importPKCS8 } from 'jose'

/**
 * Apple Music developer token — the pass MusicKit JS needs before it will talk
 * to Apple at all.
 *
 * It is a short ES256 JWT signed with the MusicKit private key (.p8) from the
 * Apple Developer portal. The TOKEN goes to the browser; the KEY never does.
 *
 * ⚠ THE PRIVATE KEY IS A SECRET. Never log it, never put it in an error message,
 * never return it. A signing failure is reported as "check the key format" and
 * nothing more.
 *
 * Env (all three required, or Apple Music reports itself as not set up):
 *   APPLE_MUSIC_TEAM_ID        — top-right of the developer portal
 *   APPLE_MUSIC_KEY_ID         — shown on the key's page
 *   APPLE_MUSIC_PRIVATE_KEY    — the whole .p8 file, BEGIN/END lines included.
 *                                Multi-line in double quotes, or one line with \n.
 * Optional:
 *   APPLE_MUSIC_ALLOWED_ORIGINS — comma list, e.g. https://allfantasy.ai. When set,
 *                                Apple refuses the token from any other site.
 */

export type AppleMusicConfig = {
  teamId: string
  keyId: string
  privateKey: string
  origins: string[]
}

/** Twelve hours. Apple allows up to six months; a short life limits a copied token. */
export const DEVELOPER_TOKEN_TTL_SECONDS = 12 * 60 * 60

/** Re-sign when less than this much life is left, so a client never gets a token about to die. */
const REFRESH_MARGIN_SECONDS = 60 * 60

const PEM_BEGIN = '-----BEGIN PRIVATE KEY-----'
const PEM_END = '-----END PRIVATE KEY-----'

/**
 * Accepts the key however it survived the trip into an env var: real newlines,
 * literal `\n`, Windows line endings, wrapping quotes, or squashed onto one line.
 */
export function normalizePrivateKey(raw: string): string {
  let pem = raw.trim()
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1).trim()
  }
  pem = pem.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')

  const begin = pem.indexOf(PEM_BEGIN)
  const end = pem.indexOf(PEM_END)
  if (begin === -1 || end === -1 || end < begin) return pem

  const body = pem.slice(begin + PEM_BEGIN.length, end).replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? []
  return [PEM_BEGIN, ...lines, PEM_END].join('\n')
}

export function readAppleMusicConfig(
  env: Record<string, string | undefined> = process.env,
): AppleMusicConfig | null {
  const teamId = env.APPLE_MUSIC_TEAM_ID?.trim()
  const keyId = env.APPLE_MUSIC_KEY_ID?.trim()
  const rawKey = env.APPLE_MUSIC_PRIVATE_KEY
  if (!teamId || !keyId || !rawKey?.trim()) return null

  const origins = (env.APPLE_MUSIC_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  return { teamId, keyId, privateKey: normalizePrivateKey(rawKey), origins }
}

export async function signDeveloperToken(
  config: AppleMusicConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const key = await importPKCS8(config.privateKey, 'ES256')
  const expiresAt = nowSeconds + DEVELOPER_TOKEN_TTL_SECONDS
  const claims = config.origins.length > 0 ? { origin: config.origins } : {}

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAt)
    .sign(key)

  return { token, expiresAt }
}

let cached: { token: string; expiresAt: number; fingerprint: string } | null = null

/** Signs once and reuses the token until it has under an hour left. */
export async function getDeveloperToken(
  config: AppleMusicConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const fingerprint = `${config.teamId}:${config.keyId}:${config.origins.join(',')}`
  if (
    cached &&
    cached.fingerprint === fingerprint &&
    cached.expiresAt - nowSeconds > REFRESH_MARGIN_SECONDS
  ) {
    return { token: cached.token, expiresAt: cached.expiresAt }
  }
  const signed = await signDeveloperToken(config, nowSeconds)
  cached = { ...signed, fingerprint }
  return signed
}

/** Test seam: forget the cached token. */
export function resetDeveloperTokenCache(): void {
  cached = null
}
