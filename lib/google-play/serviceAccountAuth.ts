/**
 * Google service-account auth shared by the Play integrations (install stats,
 * purchase verification). Signs the OAuth JWT with node:crypto so no Google SDK
 * is needed for a handful of REST calls.
 *
 * Errors are built from status codes only. Never include the key, the
 * assertion, or a purchase token in a message: these strings reach logs and,
 * for the admin dashboard, the page.
 */

import { createSign } from "node:crypto"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const REQUEST_TIMEOUT_MS = 10_000

export type ServiceAccount = { client_email: string; private_key: string }

export function parseServiceAccount(raw: string): ServiceAccount | null {
  const candidates = [raw.trim()]
  // Railway and similar dashboards mangle multi-line JSON, so base64 is accepted too.
  if (!raw.trim().startsWith("{")) {
    try {
      candidates.push(Buffer.from(raw.trim(), "base64").toString("utf8"))
    } catch {
      // not base64
    }
  }
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as Partial<ServiceAccount>
      if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        }
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

export async function getGoogleAccessToken(account: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64Url(
    JSON.stringify({ iss: account.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  )
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claims}`)
  const assertion = `${header}.${claims}.${base64Url(signer.sign(account.private_key))}`

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (HTTP ${res.status})`)
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error("Google token exchange returned no access token")
  return body.access_token
}
