import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TSDB_LEAGUE,
  describeFailure,
  isCcLicensed,
  normalizeCdnUrl,
  parseV1Body,
  redactV1Url,
  rowsOrEmpty,
} from '@/lib/sports-data/theSportsDbContract'

const FIXTURE_DIR = path.join(process.cwd(), 'contracts', 'thesportsdb', 'fixtures')

type Fixture = {
  _probe: {
    name: string
    top_level_key: string | null
    top_level_type: string | null
    returned_null: boolean | null
    api_message: string | null
    row_count: number | null
  }
  response: unknown
}

function loadFixtures(): Fixture[] {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json') && f !== '_manifest.json')
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')) as Fixture)
}

describe('TheSportsDB v1 envelope — against committed fixtures', () => {
  const fixtures = loadFixtures()

  it('has fixtures to test against', () => {
    // Guards the whole suite: if fixtures/ were emptied, every data-driven
    // test below would vacuously pass.
    expect(fixtures.length).toBeGreaterThanOrEqual(14)
  })

  it.each(fixtures.map((f) => [f._probe.name, f] as const))(
    'classifies %s the same way the probe did',
    (_name, fixture) => {
      const result = parseV1Body(JSON.stringify(fixture.response))
      const { top_level_type: type } = fixture._probe

      if (type === 'array') {
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.rows).toHaveLength(fixture._probe.row_count ?? 0)
      } else if (type === 'null') {
        expect(result).toMatchObject({ ok: false, reason: 'no_data' })
      } else if (type === 'string') {
        expect(result).toMatchObject({ ok: false, reason: 'api_error' })
      }
    }
  )
})

describe('the 200-on-error trap', () => {
  // Real captured body: contracts/thesportsdb/fixtures/v1.ERROR.nonnumeric_league.json
  const ERROR_BODY = '{"events":"Invalid League ID passed"}'

  it('reports an error, not rows, when the message replaces the array', () => {
    const result = parseV1Body(ERROR_BODY)
    expect(result).toEqual({
      ok: false,
      reason: 'api_error',
      key: 'events',
      message: 'Invalid League ID passed',
    })
  })

  it('yields zero rows where a naive parser would report 24', () => {
    // This is the whole reason the module exists. `?? []` does not fire on a
    // string, so `.length` reads the message's character count as a row count.
    const naive = (JSON.parse(ERROR_BODY).events ?? []) as unknown as string
    expect(naive.length).toBe(24)

    expect(rowsOrEmpty(parseV1Body(ERROR_BODY))).toHaveLength(0)
  })

  it('keeps null distinct from an empty array', () => {
    // Both mean "nothing came back", but only one can also mean "your id was
    // rejected". Collapsing them is what makes a bad request look like an
    // empty league.
    expect(parseV1Body('{"events":null}')).toMatchObject({ reason: 'no_data' })
    expect(parseV1Body('{"events":[]}')).toMatchObject({ ok: true, rows: [] })
  })

  it('treats an HTML error page as a retired endpoint, not a crash', () => {
    expect(parseV1Body('<!DOCTYPE html><html><body>404</body></html>')).toMatchObject({
      reason: 'html_error_page',
    })
  })

  it('handles empty and non-JSON bodies without throwing', () => {
    expect(parseV1Body('')).toMatchObject({ reason: 'empty_body' })
    expect(parseV1Body('not json at all')).toMatchObject({ reason: 'invalid_json' })
  })

  it('describes every failure without leaking a key', () => {
    for (const raw of ['{"events":"Invalid League ID passed"}', '{"events":null}', '', 'nope', '<html>']) {
      const r = parseV1Body(raw)
      if (!r.ok) expect(describeFailure(r)).toEqual(expect.any(String))
    }
  })
})

describe('credential redaction', () => {
  it('removes the key from a v1 URL path', () => {
    const url = 'https://www.thesportsdb.com/api/v1/json/abc123/eventsnextleague.php?id=4391'
    const redacted = redactV1Url(url)
    expect(redacted).not.toContain('abc123')
    expect(redacted).toContain('***REDACTED***')
    expect(redacted).toContain('eventsnextleague.php?id=4391')
  })

  it('leaves a URL with no key untouched', () => {
    const url = 'https://www.thesportsdb.com/api/v2/json/livescore/4391'
    expect(redactV1Url(url)).toBe(url)
  })
})

describe('CDN host normalization', () => {
  it('unifies the two hosts that appear in the same response', () => {
    const r2 = normalizeCdnUrl('https://r2.thesportsdb.com/images/media/team/badge/abc.png')
    const www = normalizeCdnUrl('https://www.thesportsdb.com/images/media/team/badge/abc.png')
    expect(r2).toBe(www)
  })

  it('returns null for empty or malformed input rather than a bad URL', () => {
    expect(normalizeCdnUrl('')).toBeNull()
    expect(normalizeCdnUrl(null)).toBeNull()
    expect(normalizeCdnUrl('not-a-url')).toBeNull()
  })
})

describe('league constants', () => {
  it('uses the real NCAA league name, not the obvious one', () => {
    // `?l=NCAA Football` returns {"teams":null} — see GAPS.md R-06.
    expect(TSDB_LEAGUE.NCAAF.strLeague).toBe('NCAA Division 1')
    expect(TSDB_LEAGUE.NCAAF.id).toBe(4479)
    expect(TSDB_LEAGUE.NFL.id).toBe(4391)
  })

  it('matches the league ids in the committed fixtures', () => {
    const nfl = loadFixtures().find((f) => f._probe.name === 'lookupleague.NFL')
    const rows = rowsOrEmpty(parseV1Body(JSON.stringify(nfl?.response)))
    expect(Number((rows[0] as Record<string, unknown>).idLeague)).toBe(TSDB_LEAGUE.NFL.id)
  })
})

describe('artwork licence gate', () => {
  it('only clears art explicitly marked Creative Commons', () => {
    expect(isCcLicensed({ strCreativeCommons: 'Yes' })).toBe(true)
    expect(isCcLicensed({ strCreativeCommons: 'yes' })).toBe(true)
    expect(isCcLicensed({ strCreativeCommons: 'No' })).toBe(false)
    // Absent signal must fail closed — most assets carry no signal at all.
    expect(isCcLicensed({})).toBe(false)
    expect(isCcLicensed({ strCreativeCommons: null })).toBe(false)
  })
})
