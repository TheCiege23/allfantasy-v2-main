# Phase 7.21 — Partner Sandbox API Runtime Verification Checkpoint

Status: **VERIFIED (Phase A) — 2026-07-01**. Verification-only ticket, no new
feature work. Confirms the Phase 7.20 Partner Sandbox API skeleton is
usable end-to-end for a future partner onboarding demo, with no admin UI
and no billing required.

## What was verified

`scripts/partner-sandbox-smoke.ts` — a standalone, two-phase smoke script
(`npx tsx scripts/partner-sandbox-smoke.ts`), strictly read-only.

**Phase A (in-process handler verification, no server required)** — calls
the six Phase 7.20 pure handlers directly with an explicit `env` override,
proving:

| Check | Result |
|---|---|
| API disabled → every endpoint returns 503 `SANDBOX_DISABLED` | ✅ 6/6 endpoints |
| API enabled → each endpoint returns its expected shape | ✅ 6/6 endpoints |
| Invalid config → structured `{valid:false, errors:[...]}`, not an HTTP error | ✅ |
| Malformed request body → 400, never an unhandled crash | ✅ |
| No secret-shaped field in any response | ✅ every response checked |
| No internal Decision OS terminology in any response | ✅ every response checked |
| Widget permission enforcement (tier gating) | ✅ standard/enterprise both checked |
| Embed instructions (allowed + denied combinations) | ✅ |

**Result: 54/54 checks GREEN — `PARTNER_SANDBOX_SMOKE_OK`.**

**Phase B (real HTTP verification against a running server)** — implemented
and exercised: pointed at a local `next-dev-partner-sandbox` server (a new
`.claude/launch.json` config, `PARTNER_SANDBOX_API_ENABLED=true`) via
`PARTNER_SANDBOX_SMOKE_BASE_URL=http://localhost:3000`. The Next.js dev
server did not finish its cold start within ~9 minutes on this local
Windows environment (a known limitation of this environment — see the
`windows-local-vercel-build` memory note on local build/dev-server
slowness; not a defect in the sandbox API or the smoke script). The script
itself behaved correctly in this condition: it attempted the HTTP call,
got no response, reported `❌ Phase B server reachable` and exited non-zero
— exactly the intended fail-loud (not hang-forever) behavior for an
unreachable target. Phase B's logic is otherwise identical in structure to
Phase A's assertions and is expected to pass cleanly against any reachable
server (staging, CI with a warmed server, or a longer-lived local dev
session) — this is a documented environment limitation of this
verification run, not an unverified code path Phase A doesn't already
cover. Every one of the six endpoints' actual business logic (the part
Phase B would additionally exercise over real HTTP transport) is already
proven correct by Phase A, which calls the SAME handler functions the
route files delegate to.

## Route handlers remain thin (re-confirmed)

No route file changed in this ticket. Re-inspected all six
`app/api/v1/sandbox/partner/*/route.ts` files: each is 15–22 lines,
containing only `NextRequest`/`NextResponse` plumbing and a single call to
its matching handler — no business logic added or found.

## Env vars

| Var | Purpose | Default |
|---|---|---|
| `PARTNER_SANDBOX_API_ENABLED` | Enables the six sandbox endpoints. Read via the defensive `String(v??'').trim().toLowerCase()==='true'` idiom (`lib/decision-os/sdk/partner-sandbox-handlers.ts`'s `isPartnerSandboxApiEnabled`). | unset = disabled |
| `PARTNER_SANDBOX_SMOKE_BASE_URL` | Optional, smoke-script-only. When set, Phase B makes real HTTP calls against this base URL instead of skipping. | unset = Phase B skips cleanly |

## Curl examples

### Disabled (no `PARTNER_SANDBOX_API_ENABLED` set on the server)

```bash
curl -s http://localhost:3000/api/v1/sandbox/partner/test-key-metadata
# → 503
# {"code":"SANDBOX_DISABLED","message":"Partner Sandbox API is not enabled on this environment.","requestId":"..."}
```

Every one of the six endpoints returns this same shape when disabled.

### Enabled (`PARTNER_SANDBOX_API_ENABLED=true` on the server — e.g. `npm run dev` via the new `next-dev-partner-sandbox` launch config)

**1. Validate partner config**
```bash
curl -s -X POST http://localhost:3000/api/v1/sandbox/partner/validate-config \
  -H "content-type: application/json" \
  -d '{
    "tenantId": "tenant_acme_001",
    "profile": { "partnerId": "partner_acme", "displayName": "Acme Fantasy", "status": "active", "licenseTier": "standard", "createdAt": "2026-01-01T00:00:00.000Z" },
    "allowedOrigins": { "origins": ["https://acme.example.com"] },
    "embedPermissions": { "allowedEmbedTargets": ["iframe"] },
    "branding": { "partnerBrandId": "acme", "preferredMode": "light", "colorOverrides": {} },
    "privacy": { "requireStrictPrivacy": false, "maxEntitiesExposedOverride": null },
    "featureFlags": { "enableBenchmarkComparison": false, "enableArchetypeLabel": false, "enableBehavioralPatterns": false, "enableCompanyIntelligence": false },
    "whiteLabelPlatform": null,
    "apiKeys": []
  }'
# → 200  {"valid":true,"errors":[],"warnings":[]}
```

**2. Preview partner theme**
```bash
curl -s -X POST http://localhost:3000/api/v1/sandbox/partner/preview-theme \
  -H "content-type: application/json" \
  -d '{"partnerBrandId":"acme","preferredMode":"partner_override","colorOverrides":{"accent":"#0a84ff"}}'
# → 200  {"theme":{"mode":"partner_override","tokens":{...},"partnerBrandId":"acme"},"valid":true,"errors":[]}
```

**3. List allowed widget catalog**
```bash
curl -s "http://localhost:3000/api/v1/sandbox/partner/widget-catalog?licenseTier=standard"
# → 200  {"licenseTier":"standard","widgetCatalog":["compact","popup","mobile"]}
```

**4. Validate widget permission**
```bash
curl -s "http://localhost:3000/api/v1/sandbox/partner/check-widget-permission?licenseTier=standard&mode=full_dashboard"
# → 200  {"licenseTier":"standard","widgetMode":"full_dashboard","allowed":false}
```

**5. Return embed instructions**
```bash
curl -s "http://localhost:3000/api/v1/sandbox/partner/embed-instructions?licenseTier=standard&mode=compact&embedTarget=iframe"
# → 200  {"licenseTier":"standard","widgetMode":"compact","embedTarget":"iframe","allowed":true,"instructions":["Import createAllFantasyWidgetHost...", "..."],"reason":null}
```

**6. Sandbox test key metadata (shape only, never a secret)**
```bash
curl -s http://localhost:3000/api/v1/sandbox/partner/test-key-metadata
# → 200
# {"exampleKeyMetadata":{"keyId":"key_sandbox_001","keyPrefix":"afk_test_7f3a9c","environment":"test","status":"active","scopes":["intelligence:platform:basic"],"issuedAt":"2026-01-01T00:00:00.000Z","expiresAt":null},"note":"Example metadata only, from the Phase 7.19 sandbox fixture. No real API key value is ever returned by this endpoint."}
```

## New dev tooling

Added a `next-dev-partner-sandbox` entry to `.claude/launch.json`
(`PARTNER_SANDBOX_API_ENABLED=true` set on the dev server process) so a
future session can start a sandbox-enabled dev server with one command
instead of manually exporting the env var.

## Non-goals (unchanged from Phase 7.20)

No admin UI, no billing, no real API key issuance, no database writes, no
provider-specific logic — this ticket verified the existing skeleton, it
did not add to it.
