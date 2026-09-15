// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  FILTERED,
  scrubBreadcrumb,
  scrubHeaders,
  scrubRequest,
  scrubSpanJson,
  scrubUrl,
} from '@/lib/observability/redaction'

/*
 * ⚠ EVERY "ABSENT AFTER" ASSERTION HERE IS PAIRED WITH A "PRESENT BEFORE" ONE. A scrubbing test
 * whose fixture never contained the secret passes by construction — the exact check-that-cannot-fail
 * this repo keeps finding. The fixtures are built from these constants so the pairing is explicit.
 */
const RSC_TOKEN = 'riTOKENvalue123456'
const SESSION_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl'
const CRON_SECRET = 'cronSECRETvalue987654'
const TSDB_KEY = 'tsdbKEY555'
const OAUTH_CODE = 'oauthCODE4242'
const INVITE = 'inviteCODE777'

/*
 * ⚠ A NEUTRAL HOST, ON PURPOSE. `RSC_token` redaction does not depend on the host, and a literal
 * scheme-plus-provider-host URL is reported by the DB-first boundary guard (a required check) even in
 * a fixture that never makes a call — the guard is line-based. Do not "restore" the real host here.
 */
const RI_URL = `https://provider.example/api/v1/live/2026-09-14/NFL?RSC_token=${RSC_TOKEN}&_=1726300000000`

describe('scrubUrl', () => {
  it('removes the Rolling Insights token from a query string', () => {
    expect(RI_URL).toContain(RSC_TOKEN)
    const out = scrubUrl(RI_URL)
    expect(out).not.toContain(RSC_TOKEN)
    expect(out).toContain('RSC_token=***') // still says WHAT was removed
    expect(out).toContain('/api/v1/live/2026-09-14/NFL') // and keeps the path readable
  })

  it('removes the TheSportsDB key from its path segment', () => {
    // This rule IS host-specific, so the real host stays — without a scheme, which the DB-first guard's
    // URL matcher requires and the redaction rule does not look at.
    const url = `www.thesportsdb.com/api/v1/json/${TSDB_KEY}/eventsday.php?d=2026-09-14`
    expect(url).toContain(TSDB_KEY)
    expect(scrubUrl(url)).not.toContain(TSDB_KEY)
  })

  it('removes access-granting parameters the shared redactor has no reason to know', () => {
    const url = `https://www.allfantasy.ai/api/auth/callback/google?code=${OAUTH_CODE}&state=xyz&next=/core`
    const invite = `/join?invite=${INVITE}`
    expect(url).toContain(OAUTH_CODE)
    expect(invite).toContain(INVITE)
    expect(scrubUrl(url)).not.toContain(OAUTH_CODE)
    expect(scrubUrl(url)).toContain('next=/core')
    expect(scrubUrl(invite)).not.toContain(INVITE)
  })

  it('leaves an ordinary /core URL alone', () => {
    expect(scrubUrl('https://www.allfantasy.ai/core/trades?league=cm123&view=compare')).toBe(
      'https://www.allfantasy.ai/core/trades?league=cm123&view=compare',
    )
  })
})

describe('scrubHeaders', () => {
  it('filters credential headers by name, keeping the name so presence stays debuggable', () => {
    const headers = {
      authorization: `Bearer ${CRON_SECRET}`,
      cookie: `__Secure-next-auth.session-token=${SESSION_JWT}`,
      'x-cron-secret': CRON_SECRET,
      'user-agent': 'allfantasy-cron-dispatch/1',
      accept: 'application/json',
    }
    expect(JSON.stringify(headers)).toContain(CRON_SECRET)
    expect(JSON.stringify(headers)).toContain(SESSION_JWT)

    const out = scrubHeaders(headers)!
    expect(JSON.stringify(out)).not.toContain(CRON_SECRET)
    expect(JSON.stringify(out)).not.toContain(SESSION_JWT)
    expect(out).toMatchObject({ authorization: FILTERED, cookie: FILTERED, 'x-cron-secret': FILTERED })
    expect(out['user-agent']).toBe('allfantasy-cron-dispatch/1')
  })

  it('scrubs a referer that carries a token', () => {
    const out = scrubHeaders({ referer: `https://www.allfantasy.ai/reset-password?token=${SESSION_JWT}` })!
    expect(out.referer).not.toContain(SESSION_JWT)
  })
})

describe('scrubRequest', () => {
  it('drops cookies, bodies and env outright and scrubs the URL, headers and query', () => {
    const request = {
      url: RI_URL,
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}`, 'user-agent': 'x' },
      cookies: { '__Secure-next-auth.session-token': SESSION_JWT },
      data: { username: 'someone', password: 'hunter2hunter2' },
      env: { REMOTE_ADDR: '10.0.0.1' },
      query_string: [['RSC_token', RSC_TOKEN], ['code', OAUTH_CODE], ['league', 'cm123']],
    }
    const before = JSON.stringify(request)
    for (const secret of [RSC_TOKEN, SESSION_JWT, CRON_SECRET, OAUTH_CODE, 'hunter2hunter2']) expect(before).toContain(secret)

    const out = scrubRequest(request)
    const after = JSON.stringify(out)
    for (const secret of [RSC_TOKEN, SESSION_JWT, CRON_SECRET, OAUTH_CODE, 'hunter2hunter2']) expect(after).not.toContain(secret)
    expect(out).not.toHaveProperty('cookies')
    expect(out).not.toHaveProperty('data')
    expect(out).not.toHaveProperty('env')
    expect(out.method).toBe('POST')
    expect(out.query_string).toContainEqual(['league', 'cm123'])
  })

  it('handles a query string given as a string or an object', () => {
    expect(scrubRequest({ query_string: `a=1&RSC_token=${RSC_TOKEN}` }).query_string).toBe('a=1&RSC_token=***')
    const asObject = scrubRequest({ query_string: { code: OAUTH_CODE, league: 'x' } }).query_string as Record<string, string>
    expect(asObject.code).not.toContain(OAUTH_CODE)
    expect(asObject.league).toBe('x')
  })

  it('does not mutate the caller’s object', () => {
    const request = { cookies: { a: 'b' }, url: '/core' }
    scrubRequest(request)
    expect(request.cookies).toEqual({ a: 'b' })
  })
})

describe('scrubSpanJson and scrubBreadcrumb', () => {
  it('scrubs a provider call span description and its URL-bearing attributes', () => {
    const span = {
      description: `GET ${RI_URL}`,
      data: {
        'http.query': `RSC_token=${RSC_TOKEN}`,
        'url.full': RI_URL,
        'http.request.header.authorization': `Bearer ${CRON_SECRET}`,
        'http.response.status_code': 200,
        'af.db.count': 7,
      },
    }
    expect(JSON.stringify(span)).toContain(RSC_TOKEN)
    const out = scrubSpanJson(span)
    expect(JSON.stringify(out)).not.toContain(RSC_TOKEN)
    expect(JSON.stringify(out)).not.toContain(CRON_SECRET)
    expect(out.data['http.response.status_code']).toBe(200)
    expect(out.data['af.db.count']).toBe(7)
  })

  it('scrubs a URL under an attribute name nobody would guess (found in a real Next dev trace)', () => {
    /*
     * Measured 2026-09-15 against `next dev` with a local ingest: Next's own tracing set
     * `next.span_name` to the full request line, query string included. The first version of this
     * scrubber only looked at keys that sounded like URLs, and sent a planted invite code and token
     * straight through. So every string value is scrubbed now, whatever its key is called.
     */
    const planted = { invite: 'inviteCODE777', token: SESSION_JWT }
    const data = {
      'next.span_name': `GET /login?invite=${planted.invite}&token=${planted.token}&callbackUrl=/core`,
      'some.future.attribute': `retrying https://provider.example/x?RSC_token=${RSC_TOKEN}`,
      'af.db.count': 3,
    }
    expect(JSON.stringify(data)).toContain(planted.invite)
    const out = scrubSpanJson({ data })
    const serialised = JSON.stringify(out)
    for (const secret of [planted.invite, planted.token, RSC_TOKEN]) expect(serialised).not.toContain(secret)
    expect(out.data['next.span_name']).toContain('callbackUrl=/core')
    expect(out.data['af.db.count']).toBe(3)
  })

  it('scrubs a fetch breadcrumb URL', () => {
    const crumb = { category: 'fetch', data: { url: RI_URL, method: 'GET', status_code: 200 } }
    expect(crumb.data.url).toContain(RSC_TOKEN)
    expect(scrubBreadcrumb(crumb)!.data!.url).not.toContain(RSC_TOKEN)
  })

  it('passes null through (a dropped breadcrumb stays dropped)', () => {
    expect(scrubBreadcrumb(null)).toBeNull()
  })
})
