import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_SECONDS = 366 * 86_400

function exportSecret() {
  return process.env.AWARD_SHEET_EXPORT_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
}

function signature(secret: string, data: string) {
  return createHmac('sha256', secret).update('af-award-sheet:v1:').update(data).digest()
}

export function createAwardSheetToken(leagueId: string, userId: string, now = Date.now()) {
  const secret = exportSecret()
  if (!secret) return null
  const payload = Buffer.from(JSON.stringify({ leagueId, userId, expires: Math.floor(now / 1000) + TTL_SECONDS })).toString('base64url')
  return `${payload}.${signature(secret, payload).toString('base64url')}`
}

export function readAwardSheetToken(token: string, leagueId: string, now = Date.now()): string | null {
  const secret = exportSecret()
  const [payload, sig, ...rest] = token.split('.')
  if (!secret || !payload || !sig || rest.length || token.length > 1600) return null
  try {
    const actual = Buffer.from(sig, 'base64url')
    const expected = signature(secret, payload)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return data.leagueId === leagueId && typeof data.userId === 'string' && Number.isSafeInteger(data.expires) &&
      data.expires > Math.floor(now / 1000) ? data.userId : null
  } catch {
    return null
  }
}
