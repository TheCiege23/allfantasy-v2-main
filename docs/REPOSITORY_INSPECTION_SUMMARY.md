# Repository Inspection Summary

**Purpose:** Catalog existing systems before implementing changes. No code written — inspection only.

**Areas inspected:** AI providers, env/config loaders, sports API integrations, deterministic context builders, admin diagnostics/status, media/content generation routes, public share/invite/referral systems.

---

## 1. What Already Exists (Fully Implemented and In Use)

### AI provider files
- **Canonical config:** `lib/provider-config.ts` — `getOpenAIConfigFromEnv`, `getDeepSeekConfigFromEnv`, `getXaiConfigFromEnv`, `getClearSportsConfigFromEnv`; `getProviderStatus()`; `logProviderStatus()` (no secrets).
- **Orchestration providers:** `lib/ai-orchestration/providers/openai-provider.ts`, `deepseek-provider.ts`, `grok-provider.ts` — implement `IProviderClient`; use provider-config for availability; OpenAI adapter uses `lib/openai-client` for actual calls.
- **Provider registry:** `lib/ai-orchestration/provider-registry.ts` — `getProvider(role)`, `checkProviderAvailability()`, `getAvailableFromRequested(roles)`; roles: `openai`, `deepseek`, `grok`.
- **Orchestration:** `lib/ai-orchestration/orchestration-service.ts` — `runUnifiedOrchestration(req)`; request validation, mode resolution, retry, sports-context enricher.
- **Health check:** `lib/ai-orchestration-engine/provider-health-check.ts` — `runProviderHealthCheck()` for openai/deepseek/grok (optional async healthCheck per provider).

### Env/config loaders
- **Single source for API keys (server):** `lib/provider-config.ts` — OpenAI, DeepSeek, xAI, ClearSports; env names documented in file header and `.env.example`.
- **Startup logging:** `instrumentation.ts` — calls `logProviderStatus()` on Next.js server boot (experimental instrumentation).
- **`.env.example`** — Documents OPENAI_*, DEEPSEEK_*, XAI_*, GROK_*, CLEARSPORTS_*, plus AI_INTEGRATIONS_* and CLEAR_SPORTS_* legacy aliases; sports (ROLLING_INSIGHTS_*, API_SPORTS_KEY, etc.), auth, email, etc.

### Sports API integrations
- **Unified router:** `lib/sports-router.ts` — single entry for sports data; request types (sport, dataType, identifier, dateRange, season); in-memory cache; source priority per sport (e.g. NFL: rolling_insights → api_sports → espn → clear_sports → thesportsdb; NBA/MLB: clear_sports → thesportsdb → espn).
- **ClearSports:** `lib/clear-sports/client.ts` — uses `getClearSportsConfigFromEnv()`; rate limit, retry, timeout, safe logging; `lib/clear-sports/normalize.ts`, `types.ts`, `index.ts`.
- **Rolling Insights:** `lib/rolling-insights.ts` — OAuth client_credentials (ROLLING_INSIGHTS_CLIENT_ID/SECRET), GraphQL; NFL rosters, teams, schedule, depth charts, etc.
- **API-Sports:** `lib/api-sports.ts` — american-football API (v1.american-football.api-sports.io); API_SPORTS_KEY; teams, players, games, standings, stats.
- **ESPN:** `lib/espn-data.ts` — site.api.espn.com + sports.core.api.espn.com; NFL-focused (team IDs, athletes, etc.).
- **Usage:** `sports-router` is used by league sync, discover, depth-charts, injuries, live-scores, team-stats, etc.; ClearSports availability gated by `isClearSportsAvailable()` in sports-router.

### Deterministic context builders
- **Envelope builder:** `lib/unified-ai/AIContextEnvelopeBuilder.ts` — `buildAIContextEnvelope(input)`, `buildEnvelopeForTool(tool, opts)`; normalizes sport via `normalizeToSupportedSport`; sets featureType, sport, leagueId, userId, deterministicPayload, statisticsPayload, behaviorPayload, etc.
- **Deterministic → AI bridge:** `lib/unified-ai/DeterministicToAIContextBridge.ts` — `deterministicPayloadToContextSummary(payload, source)`, hard-constraints builder; sources: trade_engine, rankings_engine, waiver_engine, simulation, legacy_score, reputation, psychological, graph, draft_board.
- **Deterministic rules:** `lib/ai-orchestration-engine/deterministic-rules.ts` — `DETERMINISTIC_RULES` array and `getDeterministicRulesPromptBlock()` for system prompts (AI cannot override scores, invent players, etc.).
- **Feature adapters:** `lib/ai-context-envelope/adapters/trade-context-to-envelope.ts`, `waiver-to-envelope.ts`; `lib/ai-context-envelope/contracts.ts`, `schema.ts`.

### Admin diagnostics/status pages
- **Admin app:** `app/admin/page.tsx` — tab-based (overview, signups, questionnaire, ideas, feedback, email, blog, tools, analytics, ai_issues, share_rewards, calibration, model_drift, users, leagues, moderation, features, system); gated by admin session + ADMIN_EMAILS/role.
- **Provider diagnostics API:** `app/api/admin/providers/diagnostics/route.ts` — GET; requireAdmin; returns `runProviderHealthCheck()` + `getProviderStatus()` + `getProviderDiagnostics()` (failures, fallbacks, latency); no secrets.
- **Provider diagnostics UI:** `app/admin/components/AdminProviderDiagnostics.tsx` — fetches `/api/admin/providers/diagnostics`, shows status badges, recent failures, fallbacks, latency; refresh.
- **Provider status (user-facing):** `app/api/ai/providers/status/route.ts` — GET; session required; returns `checkProviderAvailability()` (openai, deepseek, grok) for selector/badges.
- **System health:** `app/api/admin/system/health/route.ts` — GET; requireAdmin; `getSystemHealth()` from `lib/admin-dashboard`.
- **API status (admin):** `app/api/admin/api-status/route.ts` — checks external APIs (sleeper, yahoo, mfl, fantrax, fantasycalc, thesportsdb, espn, openai, grok) for status/latency.

### Media/content generation routes
- **Blog:** `app/api/blog/generate/route.ts`, `app/api/blog/generate-and-save/route.ts`, `app/api/blog/route.ts`, `app/api/blog/[articleId]/route.ts`, `app/api/blog/[articleId]/publish/route.ts`, `app/api/blog/slug/[slug]/route.ts`, `app/api/blog/[articleId]/internal-links/route.ts`; `app/api/media/blog/route.ts`.
- **Social clips:** `app/api/social-clips/generate/route.ts`, `app/api/social-clips/ai/generate/route.ts`, `app/api/social-clips/[assetId]/route.ts`, approve, publish, retry, logs.
- **Clips (legacy):** `app/api/clips/generate/route.ts`, `app/api/clips/[id]/route.ts`.
- **Fantasy media / video:** `app/api/fantasy-media/generate/route.ts`, `app/api/fantasy-media/script/route.ts`, `app/api/fantasy-media/episodes/route.ts`, `app/api/fantasy-media/episodes/[id]/route.ts`, `app/api/fantasy-media/episodes/[id]/status/route.ts`; `app/api/media/video/route.ts`, `app/api/media/social/route.ts`.
- **Podcast:** `app/api/podcast/generate/route.ts`, `app/api/podcast/episodes/route.ts`, `app/api/podcast/episodes/[id]/route.ts`.
- **League content:** `app/api/leagues/[leagueId]/story/create/route.ts`, `app/api/leagues/[leagueId]/commentary/generate/route.ts`, `app/api/leagues/[leagueId]/media/route.ts`, `app/api/leagues/[leagueId]/media/[articleId]/route.ts`.
- **Content feed:** `app/api/content-feed/route.ts`.

### Public share/invite/referral systems
- **Share (achievements/moments):** `app/api/share/moment/route.ts`, `app/api/share/generate-copy/route.ts`, `app/api/share/preview/route.ts`, `app/api/share/publish/route.ts`, `app/api/share/track/route.ts`, `app/api/share/targets/route.ts`; `lib/social-sharing/` (SharePreviewResolver, SharePublishService, GrokShareCopyService, AchievementShareGenerator, etc.); public page `app/share/[shareId]/page.tsx` (ShareableMoment).
- **Legacy share (captions):** `app/api/legacy/share/route.ts`, `app/api/legacy/share/engagement/route.ts` — share_type, style, platform; AI-generated captions.
- **Invite (viral):** `lib/invite-engine/InviteEngine.ts` (createInviteLink, preview, accept, list, revoke, analytics); routes: `app/api/invite/generate/route.ts`, `app/api/invite/accept/route.ts`, `app/api/invite/list/route.ts`, `app/api/invite/revoke/route.ts`, `app/api/invite/preview/route.ts`, `app/api/invite/stats/route.ts`, `app/api/invite/share/route.ts`; pages `app/invite/accept/page.tsx`, etc.
- **League invite (join code):** `lib/league-invite/LeagueInviteService.ts`, InviteTokenGenerator, InviteValidationResolver; `app/api/commissioner/leagues/[leagueId]/invite/route.ts` (GET/POST code and link); `app/api/league-invite/preview/route.ts` (public preview by code); join flow e.g. `app/join/page.tsx`.
- **Referral:** `lib/referral/ReferralService.ts` (getOrCreateReferralCode, buildReferralLink, attributeSignup, recordClick, etc.); `app/api/referral/link/route.ts`, `app/api/referral/track-click/route.ts`, `app/api/referral/progress/route.ts`, `app/api/referral/stats/route.ts`, `app/api/referral/rewards/route.ts`, `app/api/referral/rewards/redeem/route.ts`, `app/api/referral/leaderboard/route.ts`; signup attribution in `app/api/auth/register/route.ts` (referralCode, attributeSignup, grantRewardForSignup); admin `app/api/admin/share-rewards/route.ts`.
- **Other share surfaces:** `app/api/trade/share/route.ts`, `app/api/mock-draft/share/route.ts`, `app/api/creators/[creatorIdOrSlug]/share/route.ts`.
- **Share engine (tracking/URLs):** `lib/share-engine/shareUrls.ts`, `lib/share-engine/ShareTrackingService.ts`.

---

## 2. What Is Partially Implemented

- **AI config usage:** Orchestration providers use `lib/provider-config` for **availability** only. Actual **keys/config** for calls still come from legacy clients: `lib/openai-client.ts` (getOpenAIConfig/getOpenAIClient reads env directly), `lib/deepseek-client.ts` (process.env.DEEPSEEK_API_KEY, no provider-config), `lib/xai-client.ts` (XAI_API_KEY/GROK_API_KEY directly). So: availability is centralized; key loading is duplicated (provider-config + openai/deepseek/xai clients).
- **Direct env reads outside provider-config:** Several features still read AI env vars themselves: `lib/ai-gm-intelligence.ts`, `lib/league-power-rankings/PowerRankingsCommentaryAI.ts`, `app/api/legacy/transfer/route.ts`, `app/api/rankings/route.ts`, `lib/legacy-ai-context.ts`, `app/api/legacy/trade/league-analyze/route.ts` *(removed 2026-09-30 — commit `1b2e29ca4`)*, `app/api/instant/improve-trade/route.ts`, `lib/social-sharing/GrokShareCopyService.ts`, `lib/social-clips-grok/GrokSocialContentService.ts`, `lib/ai-external/grok.ts`, `lib/ai/bracket-orchestrator.ts`, `lib/automated-blog/BlogGenerationService.ts`, `lib/ai-social-clip-engine/AISocialClipOrchestrator.ts`. So: “partially” migrated to canonical config.
- **ClearSports in orchestration:** ClearSports is used for **sports data** (sports-router, enricher); it is **not** an LLM provider. Provider health/diagnostics include “clearsports” in status/diagnostics payload but `runProviderHealthCheck()` only runs openai/deepseek/grok. So: ClearSports is “available” in status; no async health check for ClearSports in the same way as LLM providers.
- **Admin “system” tab:** Exists (AdminSystemPanel, system health API); provider diagnostics are one panel; full “system” tab content (e.g. all external deps, queue status) may still be evolving.
- **Sports router sport set:** `lib/sports-router.ts` uses `Sport = 'NFL' | 'NBA' | 'MLB'` in its main request type; platform sport scope (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER) is enforced elsewhere (sport-scope, sport-defaults). So: sports-router’s TypeScript type is a subset; actual usage may route other sports through fallbacks.

---

## 3. What Must Be Merged Carefully

- **Provider-config vs legacy clients:** Any change to “single source of truth” for API keys must migrate call sites from `getOpenAIConfig()` / `deepseekClient` / direct `process.env.XAI_API_KEY` to provider-config (or to orchestration only), and keep a single place for env var names and fallbacks. Merging could touch: openai-client, deepseek-client, xai-client, BlogGenerationService, AISocialClipOrchestrator, GrokShareCopyService, GrokSocialContentService, ai-external/grok, bracket-orchestrator, league-power-rankings, legacy routes (transfer, rankings; league-analyze was removed 2026-09-30), instant/improve-trade, ai-gm-intelligence.
- **Orchestration vs direct AI calls:** Many features call OpenAI/Grok/DeepSeek directly (blog, social clips, waiver/trade commentary, legacy share, improve-trade, bracket AI). Moving them to `runUnifiedOrchestration` (or a shared wrapper that uses provider-config + registry) would require consistent envelope building, tool keys, and error/fallback behavior. Merge any new “unified” paths alongside existing routes so legacy and new flows both work during transition.
- **Deterministic context vs new features:** New AI features that depend on engine outputs (e.g. legacy score, reputation, rankings) must feed context via `buildAIContextEnvelope` and the deterministic bridge; merging new payload shapes should extend `DeterministicToAIContextBridge` and envelope types without breaking existing trade/waiver/rankings/simulation adapters.
- **Sports context enricher:** `lib/ai-orchestration/sports-context-enricher.ts` and ClearSports usage are tied to sport scope and sports-router. Any new sport or new data source (e.g. new league or new API) should be added in a way that respects existing priority and cache rules and does not break NFL/NBA/MLB flows.
- **Admin diagnostics vs provider-status-service:** `lib/admin/provider-status-service.ts` holds failure/fallback/latency state; `lib/provider-diagnostics.ts` re-exports it. The admin diagnostics route and AdminProviderDiagnostics UI depend on this. Any refactor of “where diagnostics are stored” or “what getProviderDiagnostics returns” must keep the admin API contract and payload shape.
- **Share vs legacy share vs referral:** Multiple systems overlap in “share” wording: achievement share (shareable moments, generate-copy, preview), legacy share (captions), referral (links, attribution), invite (links, accept). New share/invite/referral features must clarify which system they use (share-engine, invite-engine, league-invite, referral) to avoid duplicating logic or overwriting different DB tables.

---

## 4. What Must Not Be Overwritten

- **`lib/provider-config.ts`:** Canonical list of env vars and `get*ConfigFromEnv` / `getProviderStatus` / `logProviderStatus`. Do not remove or rename env var names or the “no secrets” guarantees; only extend (e.g. new provider) or refactor call sites to use it.
- **`lib/ai-orchestration/provider-registry.ts`** and **`lib/ai-orchestration/providers/*`:** Single registry and adapter pattern for openai/deepseek/grok. Do not replace with a second competing registry; extend with new providers or new methods on existing interfaces.
- **`lib/ai-orchestration/orchestration-service.ts` — `runUnifiedOrchestration`:** Main entry for unified AI; used by `/api/ai/orchestrate`, `/api/ai/run`, `/api/ai/chimmy`, `/api/ai/compare`. Do not change the request/response contract or mode handling without updating all those routes and any docs (e.g. PROMPT152, PROMPT123).
- **`lib/sports-router.ts`:** Central routing and caching for sports data; used by many API routes and sync jobs. Do not replace or bypass; only add sources or sports following existing pattern and priority/cache rules.
- **`lib/unified-ai/AIContextEnvelopeBuilder.ts`** and **`lib/unified-ai/DeterministicToAIContextBridge.ts`:** Authoritative envelope shape and deterministic→prompt rules. Do not change envelope field semantics or deterministic source list without updating all envelope builders and prompt assembly.
- **`lib/ai-orchestration-engine/deterministic-rules.ts`:** Rules injected into prompts. Do not remove or soften rules; only add new ones if needed.
- **`lib/admin/provider-status-service.ts`** and **`app/api/admin/providers/diagnostics/route.ts`:** Admin-only diagnostics and API. Do not expose secrets or stack traces; do not change the diagnostics payload structure without updating AdminProviderDiagnostics.
- **`app/api/ai/providers/status/route.ts`:** Returns only availability (no secrets). Used by provider selector and Chimmy; keep response shape and auth behavior.
- **Invite vs league-invite vs referral:** Three distinct systems (invite-engine for viral links, league-invite for league join codes, referral for referral codes and rewards). Do not overwrite one with the other; keep APIs and DB models separate.
- **`.env.example`:** Single reference for env var names. Any new provider or config should be added here; do not remove or rename existing vars without a migration plan for deploy/config.

---

## Quick reference — key file paths

| Area | Key paths |
|------|-----------|
| AI provider config | `lib/provider-config.ts` |
| AI orchestration | `lib/ai-orchestration/` (provider-interface, provider-registry, orchestration-service, providers/*, sports-context-enricher) |
| Provider health | `lib/ai-orchestration-engine/provider-health-check.ts` |
| Env / startup | `instrumentation.ts`, `.env.example` |
| Legacy AI clients | `lib/openai-client.ts`, `lib/deepseek-client.ts`, `lib/xai-client.ts` |
| Sports router | `lib/sports-router.ts` |
| Sports sources | `lib/clear-sports/`, `lib/rolling-insights.ts`, `lib/api-sports.ts`, `lib/espn-data.ts` |
| Envelope / deterministic | `lib/unified-ai/AIContextEnvelopeBuilder.ts`, `lib/unified-ai/DeterministicToAIContextBridge.ts`, `lib/ai-orchestration-engine/deterministic-rules.ts`, `lib/ai-context-envelope/` |
| Admin diagnostics | `lib/admin/provider-status-service.ts`, `lib/provider-diagnostics.ts`, `app/api/admin/providers/diagnostics/route.ts`, `app/admin/components/AdminProviderDiagnostics.tsx` |
| AI routes | `app/api/ai/orchestrate/route.ts`, `app/api/ai/run/route.ts`, `app/api/ai/chimmy/route.ts`, `app/api/ai/compare/route.ts`, `app/api/ai/providers/status/route.ts` |
| Media/content | `app/api/blog/*`, `app/api/social-clips/*`, `app/api/clips/*`, `app/api/fantasy-media/*`, `app/api/podcast/*`, `app/api/content-feed/route.ts`, `app/api/leagues/.../media/*`, `app/api/leagues/.../story/create`, `app/api/leagues/.../commentary/generate` |
| Share | `app/api/share/*`, `lib/social-sharing/`, `lib/share-engine/` |
| Invite | `lib/invite-engine/`, `app/api/invite/*` |
| League invite | `lib/league-invite/`, `app/api/commissioner/leagues/[leagueId]/invite/route.ts`, `app/api/league-invite/preview/route.ts` |
| Referral | `lib/referral/`, `app/api/referral/*`, `app/api/admin/share-rewards/route.ts` |
