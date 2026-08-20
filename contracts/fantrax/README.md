# Fantrax contract

`ENDPOINTS.yaml` is the shape authority. Read it instead of calling the API to find
out what something returns. Unknowns go in `GAPS.md`.

## What this is

A public REST API at `https://www.fantrax.com/fxea/general`, documented by the
vendor at <https://www.fantrax.com/developer> (v1.8, Beta). It covers league
discovery, league config, rosters, standings, matchups, draft picks and draft
results, plus a player-id map and ADP for NFL and NCAAF.

## Why it matters here

**It replaces the CSV upload path.** Fantrax import previously meant exporting
report CSVs from Fantrax and uploading them through `/af-legacy` — which is also
why the provider is still `available: false` in `lib/league-import/provider-ui-config.ts`:
the new import screen has no upload control, and one cannot be a one-line text field.

With this API, Fantrax works the way Sleeper does — the user supplies **one
identifier** and we list their leagues. That removes the blocker, not by working
around it, but by making it irrelevant.

The CSV parser (`lib/fantrax-parser.ts`) and the upload route are not obsolete;
they remain the path for anyone who cannot or will not share a secret id.

## Auth in one line

A `userSecretId`, copied by the user from their Fantrax profile screen. No OAuth,
no app registration, no key, no approval. Only `getLeagues` needs it; every
league-scoped call takes a `leagueId` instead.

Storage needs no new backend: `POST /api/league/auth` already lists `fantrax` in
`SUPPORTED_PLATFORMS` and encrypts an `apiKey` field.

### ⚠ Treat it like the RSC token

`userSecretId` is a long-lived user credential that the API accepts as a **query
string parameter**. `CLAUDE.md` already documents this exact hazard for Rolling
Insights: naive URL logging leaks a credential that does not expire.

- Send it in the **POST body**, which the API also accepts.
- Never log a full request URL.
- Never return it to a client, and never commit it in a fixture.

## Fixtures

`fixtures/` holds real captured responses. Only endpoints that need **no
credential** are captured here, and that is deliberate — a `getLeagues` fixture
would embed a live user secret.

| File | Endpoint | Captured |
|---|---|---|
| `getAdp.NFL.QB.json` | `getAdp` | 2026-08-20 |

## Confidence

Endpoint names, parameters and the auth model came from the vendor page and are
solid. **Field-level shapes are medium confidence at best** — the vendor calls its
own page "a draft document that has basic usage information", and everything
requiring a secret is unprobed. Check `GAPS.md` before relying on a field.
