/**
 * One-off: probe Rolling Insights OAuth client_credentials → RSC token.
 * Do not commit secrets. Run: npx tsx scripts/test-ri-auth.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotenv(file: string) {
  const p = resolve(process.cwd(), file)
  if (!existsSync(p)) return
  const content = readFileSync(p, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotenv('.env.local')
loadDotenv('.env')

const clientId =
  process.env.ROLLING_INSIGHTS_CLIENT_ID ??
  process.env.RI_CLIENT_ID ??
  process.env.ROLLING_INSIGHTS_OAUTH_CLIENT_ID ??
  ''

const clientSecret =
  process.env.ROLLING_INSIGHTS_CLIENT_SECRET ??
  process.env.RI_CLIENT_SECRET ??
  process.env.ROLLING_INSIGHTS_OAUTH_CLIENT_SECRET ??
  ''

const existingRscToken =
  process.env.ROLLING_INSIGHTS_RSC_TOKEN ??
  process.env.RSC_TOKEN ??
  ''

if (!clientId || !clientSecret) {
  console.error('❌ Could not find Rolling Insights client_id or client_secret in env')
  console.error('   Checked: ROLLING_INSIGHTS_CLIENT_ID, RI_CLIENT_ID, ROLLING_INSIGHTS_OAUTH_CLIENT_ID')
  process.exit(1)
}

function mask(s: string, n = 4): string {
  return s.length <= n ? `${s.slice(0, n)}...` : `${s.slice(0, n)}...`
}

console.log(`✅ Found credentials: id=${mask(clientId)} secret=${mask(clientSecret)}`)

const TOKEN_ENDPOINTS = [
  'https://accounts.rolling-insights.com/oauth/token',
  'https://auth.rolling-insights.com/oauth/token',
  'https://api.rolling-insights.com/oauth/token',
  'https://rest.datafeeds.rolling-insights.com/oauth/token',
  'https://rolling-insights.com/oauth/token',
]

const DISCOVERY_URLS = [
  'https://accounts.rolling-insights.com/.well-known/openid-configuration',
  'https://auth.rolling-insights.com/.well-known/openid-configuration',
]

const FETCH_MS = 15_000

async function tryDiscovery(): Promise<string | null> {
  for (const url of DISCOVERY_URLS) {
    try {
      console.log(`\n🔍 Trying OIDC discovery: ${url}`)
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
      if (res.ok) {
        const data = (await res.json()) as { token_endpoint?: string }
        console.log(`   ✅ Found discovery doc! token_endpoint: ${data.token_endpoint}`)
        return data.token_endpoint ?? null
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

function maskToken(t: string): string {
  return `${String(t).slice(0, 20)}...`
}

function extractArrayPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  const record = data as Record<string, unknown>
  const candidates = [record.players, record.data, record.results, record.items]
  for (const c of candidates) {
    if (Array.isArray(c)) return c
  }
  return []
}

interface RestProbeResult {
  url: string
  queryTokenKey: 'RSC_token' | 'rsc_token'
  status: number
  ok: boolean
  count: number
  sample?: string
}

async function probeRestPlayers(token: string): Promise<RestProbeResult[]> {
  // http:// variants removed: the contract settles this (auth.https_required),
  // and probing over plaintext sends RSC_token in the clear to learn nothing.
  const endpoints = [
    'https://rest.datafeeds.rolling-insights.com/api/v1/players/NFL',
    'https://rest.datafeeds.rolling-insights.com/api/v1/NFL/players',
  ]

  const tokenKeys: Array<'RSC_token' | 'rsc_token'> = ['RSC_token', 'rsc_token']
  const out: RestProbeResult[] = []

  for (const endpoint of endpoints) {
    for (const key of tokenKeys) {
      try {
        const url = new URL(endpoint)
        url.searchParams.set(key, token)
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(FETCH_MS),
        })
        const text = await res.text()
        let count = 0
        let sample: string | undefined
        if (res.ok) {
          try {
            const json = JSON.parse(text) as unknown
            const arr = extractArrayPayload(json)
            count = arr.length
            if (arr[0]) sample = JSON.stringify(arr[0]).slice(0, 140)
          } catch {
            // non-JSON success body
          }
        }

        out.push({
          url: endpoint,
          queryTokenKey: key,
          status: res.status,
          ok: res.ok,
          count,
          sample,
        })
      } catch {
        out.push({
          url: endpoint,
          queryTokenKey: key,
          status: 0,
          ok: false,
          count: 0,
        })
      }
    }
  }

  return out
}

async function probeGraphqlNflRoster(token: string): Promise<{ status: number; ok: boolean; count: number }> {
  const urls = [
    'https://datafeeds.rolling-insights.com/graphql',
    'https://rest.datafeeds.rolling-insights.com/graphql',
  ]
  const query = '{ nflRoster { id player } }'

  for (const endpoint of urls) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(FETCH_MS),
      })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: { nflRoster?: unknown[] } }
      return {
        status: res.status,
        ok: true,
        count: Array.isArray(json.data?.nflRoster) ? json.data!.nflRoster!.length : 0,
      }
    } catch {
      // try next endpoint
    }
  }

  return { status: 0, ok: false, count: 0 }
}

async function tryTokenEndpoint(endpoint: string): Promise<string | null> {
  console.log(`\n🔑 Trying token endpoint: ${endpoint}`)

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_MS),
    })
    const text = await res.text()
    if (res.ok) {
      const data = JSON.parse(text) as Record<string, unknown>
      const token = data.access_token ?? data.token ?? data.rsc_token ?? data.RSC_token
      if (token) {
        console.log(`   ✅ SUCCESS via client_secret_post!`)
        console.log(`   Token type: ${data.token_type}`)
        console.log(`   Expires in: ${data.expires_in}s`)
        console.log(`   Token (first 20 chars): ${maskToken(String(token))}`)
        return String(token)
      }
    }
    console.log(`   ❌ Status ${res.status}: ${text.slice(0, 200)}`)
  } catch (e) {
    console.log(`   ❌ Network error: ${e}`)
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const body = new URLSearchParams({ grant_type: 'client_credentials' })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_MS),
    })
    const text = await res.text()
    if (res.ok) {
      const data = JSON.parse(text) as Record<string, unknown>
      const token = data.access_token ?? data.token ?? data.rsc_token ?? data.RSC_token
      if (token) {
        console.log(`   ✅ SUCCESS via client_secret_basic!`)
        console.log(`   Token (first 20 chars): ${maskToken(String(token))}`)
        return String(token)
      }
    }
    console.log(`   ❌ Basic auth status ${res.status}: ${text.slice(0, 200)}`)
  } catch (e) {
    console.log(`   ❌ Network error: ${e}`)
  }

  return null
}

async function testRscToken(token: string) {
  console.log('\n🏈 Probing REST player endpoints with RSC token...')
  const rest = await probeRestPlayers(token)
  let anyRestSuccess = false
  for (const row of rest) {
    if (row.ok) {
      anyRestSuccess = true
      console.log(`✅ REST ${row.status} ${row.url} (${row.queryTokenKey}) count=${row.count}`)
      if (row.sample) console.log(`   Sample: ${row.sample}`)
    } else {
      console.log(`❌ REST ${row.status} ${row.url} (${row.queryTokenKey})`)
    }
  }

  console.log('\n🏈 Probing GraphQL nflRoster fallback...')
  const gql = await probeGraphqlNflRoster(token)
  if (gql.ok) {
    console.log(`✅ GraphQL nflRoster SUCCESS (${gql.status}) count=${gql.count}`)
  } else {
    console.log('❌ GraphQL nflRoster failed')
  }

  if (!anyRestSuccess && !gql.ok) {
    console.log('\n⚠️ Token accepted by auth flow but data probes did not return usable payloads.')
    console.log('   This typically indicates endpoint mismatch or token scope/entitlement limits.')
  }
}

async function main() {
  if (existingRscToken) {
    console.log(`\n✅ Using existing RSC token from env: ${maskToken(existingRscToken)}`)
    await testRscToken(existingRscToken)
    return
  }

  const discoveredEndpoint = await tryDiscovery()
  const allEndpoints = discoveredEndpoint
    ? [discoveredEndpoint, ...TOKEN_ENDPOINTS]
    : TOKEN_ENDPOINTS

  let token: string | null = null
  for (const endpoint of allEndpoints) {
    token = await tryTokenEndpoint(endpoint)
    if (token) break
  }

  if (token) {
    console.log('\n────────────────────────────────────────')
    console.log('✅ RSC TOKEN OBTAINED!')
    console.log('Add this to your .env and Vercel env vars:')
    console.log(`ROLLING_INSIGHTS_RSC_TOKEN=${token}`)
    console.log('────────────────────────────────────────')
    await testRscToken(token)
  } else {
    console.log('\n────────────────────────────────────────')
    console.log('❌ Could not obtain RSC token from any endpoint.')
    console.log('The OAuth token endpoint may use a different URL pattern.')
    console.log('Check your Rolling Insights dashboard at:')
    console.log('  https://accounts.rolling-insights.com/')
    console.log('Look for: API Keys, Tokens, or RSC Token section')
    console.log('────────────────────────────────────────')
  }
}

main().catch(console.error)
