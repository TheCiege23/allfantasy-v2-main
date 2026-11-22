import 'server-only'

import { gunzipSync } from 'node:zlib'
import { importPKCS8, SignJWT } from 'jose'

/**
 * The ONE place App Store Connect's Sales Reports API is called (admin download counts).
 * Callers read through lib/app-store/appStoreDownloads.ts, which caches each day.
 *
 * Needs an App Store Connect API key — NOT the In-App Purchase key behind APPLE_IAP_*,
 * which cannot call this API. Create it in App Store Connect → Users and Access →
 * Integrations → App Store Connect API → Team Keys, with the "Sales" role:
 *   APP_STORE_CONNECT_KEY_ID       the key's ID
 *   APP_STORE_CONNECT_ISSUER_ID    the Issuer ID shown above the key list
 *   APP_STORE_CONNECT_PRIVATE_KEY  the .p8 file's contents (literal \n or base64 accepted)
 *   APP_STORE_CONNECT_VENDOR_NUMBER  Payments and Financial Reports → top left
 * Optional: APP_STORE_CONNECT_APP_ID (falls back to APPLE_IAP_APP_APPLE_ID) limits the
 * count to AllFantasy when the account publishes other apps.
 *
 * The key signs a short-lived token sent in the Authorization header; it never appears
 * in a URL or an error message.
 */

const API = 'https://api.appstoreconnect.apple.com/v1/salesReports'
const TIMEOUT_MS = 15_000

export type AppStoreConfig = {
  keyId: string
  issuerId: string
  privateKey: string
  vendorNumber: string
  appId: string | null
}

function decodeKey(raw: string): string {
  const text = raw.trim()
  if (text.includes('BEGIN PRIVATE KEY')) return text.replace(/\\n/g, '\n')
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8')
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded
  } catch {
    // not base64
  }
  return text
}

export function readAppStoreConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: AppStoreConfig } | { ok: false; missing: string[] } {
  const keyId = env.APP_STORE_CONNECT_KEY_ID?.trim()
  const issuerId = env.APP_STORE_CONNECT_ISSUER_ID?.trim()
  const privateKey = env.APP_STORE_CONNECT_PRIVATE_KEY?.trim()
  const vendorNumber = env.APP_STORE_CONNECT_VENDOR_NUMBER?.trim()
  const missing = [
    !keyId && 'APP_STORE_CONNECT_KEY_ID',
    !issuerId && 'APP_STORE_CONNECT_ISSUER_ID',
    !privateKey && 'APP_STORE_CONNECT_PRIVATE_KEY',
    !vendorNumber && 'APP_STORE_CONNECT_VENDOR_NUMBER',
  ].filter((m): m is string => Boolean(m))
  if (missing.length) return { ok: false, missing }
  const appId = (env.APP_STORE_CONNECT_APP_ID || env.APPLE_IAP_APP_APPLE_ID)?.trim() || null
  return { ok: true, config: { keyId: keyId!, issuerId: issuerId!, privateKey: decodeKey(privateKey!), vendorNumber: vendorNumber!, appId } }
}

let token: { value: string; expires: number; keyId: string } | null = null

async function bearer(config: AppStoreConfig): Promise<string> {
  if (token && token.keyId === config.keyId && token.expires > Date.now() + 60_000) return token.value
  const key = await importPKCS8(config.privateKey, 'ES256')
  // Apple refuses tokens that live longer than 20 minutes.
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })
    .setIssuer(config.issuerId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setAudience('appstoreconnect-v1')
    .sign(key)
  token = { value, expires: Date.now() + 15 * 60_000, keyId: config.keyId }
  return value
}

/** For tests. */
export function resetAppStoreTokenCache(): void {
  token = null
}

/**
 * One day's Summary Sales Report as TSV text, or `null` when Apple has no report for
 * that day (HTTP 404 — either nothing happened that day or it is not published yet;
 * the caller decides which by the day's age). Anything else throws, with the status only.
 */
export async function fetchDailySalesReport(
  config: AppStoreConfig,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportDate]': date,
    'filter[reportSubType]': 'SUMMARY',
    'filter[reportType]': 'SALES',
    'filter[vendorNumber]': config.vendorNumber,
    'filter[version]': '1_1',
  })
  const res = await fetchImpl(`${API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await bearer(config)}`, Accept: 'application/a-gzip' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (res.status === 401 || res.status === 403) {
    throw new Error(`App Store Connect refused the key (HTTP ${res.status}) — check it has the Sales role`)
  }
  if (!res.ok) throw new Error(`App Store Connect answered ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // The body is gzip unless something upstream already inflated it.
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
}
