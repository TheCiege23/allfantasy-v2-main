# G23 - Language / i18n System Audit & Foundation

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

## 1. Current Language Architecture

The current language system is centered on:

- `lib/i18n/constants.ts`: canonical language codes, storage keys, display names, support status, text direction, and Intl locale mapping.
- `lib/i18n/translations.ts`: bundled app dictionary, with English as the source dictionary.
- `lib/i18n/translations-es-parity.ts`: Spanish parity helpers.
- `components/i18n/LanguageProviderClient.tsx`: client provider that reads `<html data-lang>`, reads/writes `localStorage.af_lang`, fetches `/api/i18n/translations`, and exposes `useLanguage`.
- `components/i18n/LanguageToggle.tsx`: global selector that now labels incomplete languages.
- `app/api/i18n/translations/route.ts`: returns merged English + selected-language messages and now includes support/fallback metadata.
- `app/api/i18n/preference/route.ts`: writes the `af_lang` cookie.
- `lib/preferences/LanguagePreferenceService.ts`: client persistence and document sync.
- `lib/preferences/HtmlPreferenceSync.ts`: document `lang`, `data-lang`, and `dir` updates.
- `app/layout.tsx`: server-side `<html lang data-lang dir>` source from the `af_lang` cookie.

The World Cup bracket product also has a large dedicated i18n island in `lib/world-cup/worldCupI18n.ts`. It already consumes the global language preference, but it is not yet unified with the primary app dictionary.

## 2. Supported Language Matrix

Dictionary coverage counted from `lib/i18n/translations.ts`:

| Language | Code | Dictionary keys | Status | Notes |
| --- | --- | ---: | --- | --- |
| English | `en` | 2357 | production-ready | Canonical source language. |
| Spanish | `es` | 2531 | partial | Broad coverage, but visible encoding/copy QA risk remains. UI now labels it Partial. |
| Chinese | `zh` | 98 | beta | Small starter dictionary only. |
| Filipino | `fil` | 98 | beta | Small starter dictionary only. |
| Vietnamese | `vi` | 98 | beta | Small starter dictionary only. |
| French | `fr` | 0 | future-only | Selector label now says Coming Soon. |
| Arabic | `ar` | 0 | future-only | RTL metadata exists, but UI is not RTL-ready. |

`SUPPORTED_LANGUAGES` still includes all seven codes so existing saved preferences and routes continue to resolve safely. The support status is now explicit so UI and API consumers do not imply full launch readiness for incomplete languages.

## 3. Persistence Model

Current persistence path:

- Cookie: `af_lang`
- Local storage: `af_lang`
- User profile: `UserProfile.preferredLanguage`
- API write path: `POST /api/i18n/preference`
- Profile sync path: `PATCH /api/user/profile` from `LanguageToggle`
- Server render source: `app/layout.tsx` reads `cookies().get("af_lang")`
- Client render source: `LanguageProviderClient` initializes from `<html data-lang>` and then reconciles with localStorage.

G23 foundation cleanup:

- `lib/preferences/types.ts` now re-exports the canonical `LanguageCode`.
- `lib/preferences/LocalizedRouteShellResolver.ts` now uses `SUPPORTED_LANGUAGES` and `resolveLanguage` from `lib/i18n/constants.ts` instead of maintaining an older `en`/`es` list.
- `app/layout.tsx` now resolves all known language codes through the canonical resolver and sets `dir`.

## 4. Server / Client Mismatch Risks

Fixed in G23:

- Root layout previously clamped all cookies except Spanish to English. Beta/future language cookies now render as their resolved language code.
- Root layout now sets `dir`, which prevents Arabic from being treated as LTR at the document level.
- Client document sync now updates `dir` whenever language changes.

Remaining risks:

- LocalStorage can still override the server cookie after hydration. This is expected today, but it can produce a visible language switch if the cookie and localStorage disagree.
- `/api/i18n/translations` can machine-translate missing keys when Google credentials are present. That prevents missing text but can create inconsistent terminology and mixed quality unless outputs are tracked.
- The primary app dictionary and World Cup dictionary are separate systems.
- Many API errors, form validation messages, email templates, notification titles, and AI prompts are still English-only.

## 5. Formatting Strategy

G23 adds shared formatting helpers in `lib/i18n/formatting.ts`:

- `resolveIntlLocale`
- `formatLocalizedDate`
- `formatLocalizedTime`
- `formatLocalizedNumber`
- `formatLocalizedCurrency`

These helpers resolve app language codes to Intl-compatible locales using the canonical language map. They are safe for gradual adoption across high-traffic UI and server-rendered messages.

Timezone-sensitive rendering should continue to use the existing timezone preference layer, including `lib/preferences/TimezoneFormattingResolver.ts`. The next pass should combine timezone + locale rather than replacing timezone behavior with locale-only formatting.

## 6. Hardcoded English Hotspots

High-risk customer-visible hotspots:

- `components/chimmy/ChimmyChatShell.tsx`: greeting, prompts, placeholders, loading/error copy.
- `components/notifications/*` and `lib/notifications/*`: notification titles, body copy, fallback copy.
- `lib/email-templates.ts`, `lib/email-growth/*`, `lib/resend-client.ts`, and email-sending API routes: subject/body copy.
- `app/api/**/route.ts`: API error strings and validation messages returned to clients.
- `app/settings/**`, `components/app/tabs/LeagueSettingsTab.tsx`, and commissioner surfaces: settings labels and validation copy.
- `components/app/draft-room/**`: timer, chat, audit log, pick-trade, and helper timestamps.
- `components/ai-tools/**` and `components/AIFeaturesPanel.tsx`: AI tool labels and fallback states.
- `app/af-legacy/page.tsx`: large legacy surface with extensive English copy and locale-unaware formatting.
- Admin surfaces are intentionally lower priority for customer launch but contain many `en-US` format calls.

Formatting hotspots:

- Many components call `toLocaleString()` or `toLocaleDateString()` directly.
- Several admin and AI context files hardcode `en-US`.
- Draft room, league home, AI tools, notifications, and bracket surfaces should migrate to the shared formatting helpers first.

## 7. Chimmy Language Behavior

Current behavior:

- `/api/chimmy/route.ts` reads `af_lang`, resolves it through `resolveLanguage`, and passes it into deterministic answers and Anthropic context.
- `buildAnthropicUserContext` flows language into the Anthropic pipeline.
- `lib/chimmy/anthropic-pipeline.ts` uses `getAiLanguageInstruction(ctx.language)` and prompts the model to respond in the selected language.
- `/api/chat/chimmy/route.ts` reads `af_lang` for deterministic fallback answers.
- World Cup Chimmy routes use the World Cup i18n helper and have dedicated language tests.

Risks:

- AI language is prompt-enforced, not contract-enforced.
- Deterministic Chimmy strings are only partially localized; many fall back to English.
- User prompts can request a different language, but there is no documented precedence rule between user prompt language and app-selected language.
- Other AI paths, including trade, waiver, draft, rankings, and provider-health prompts, contain English-only system/user prompts.

Recommended policy:

- App-selected language should be the default response language.
- User explicitly asking for another language can override narrative language, but cannot override facts, evidence, or engine math.
- AI must disclose insufficient localization rather than inventing untranslated data.
- Deterministic recommendations should be generated first, then localized/explained.

## 8. RTL Readiness Notes

G23 foundation:

- `ar` maps to `rtl`.
- Root layout sets `dir`.
- Client language sync sets `dir`.

Remaining RTL work:

- Arabic is future-only because the primary dictionary has zero Arabic keys.
- Layout-level RTL QA has not been performed.
- Components use many directional utility classes (`left`, `right`, `ml`, `mr`, `pl`, `pr`) that may need logical-property migration.
- Draft room, tables, charts, player rows, chat bubbles, drawers, and modals need browser proof before Arabic can be exposed as anything beyond future-only.

## 9. Safe Foundation Fixes Completed

Implemented in G23:

- Added language support status, text direction, and Intl locale metadata to `lib/i18n/constants.ts`.
- Added shared locale formatting helpers in `lib/i18n/formatting.ts`.
- Re-exported i18n constants and formatting helpers from `lib/i18n/index.ts`.
- Pointed old preference language types/resolvers to the canonical i18n source.
- Updated root layout to resolve all supported language codes and set `dir`.
- Updated document language sync to set `dir`.
- Added beta/partial/coming-soon labels to the global language selector, settings preferences, and signup language cards.
- Added support metadata to `/api/i18n/translations`.
- Added `__tests__/i18n-foundation.test.ts` for resolver fallback, support status, RTL metadata, Intl locale mapping, and formatting helpers.

No production fantasy-engine behavior, league behavior, APIs outside the i18n route, scoring, trades, waivers, schedules, or drafts were changed.

## 10. Remaining Translation Roadmap

Smallest-risk path:

1. Freeze the language support matrix in product copy: English production-ready, Spanish partial, zh/fil/vi beta, fr/ar coming soon.
2. Clean Spanish mojibake and run native copy QA before promoting Spanish.
3. Add dictionary key typing for high-traffic surfaces.
4. Migrate notification/email/API validation messages into typed message catalogs.
5. Adopt shared formatting helpers in dashboard, league home, matchup, roster, draft room, commissioner hub, and Chimmy surfaces.
6. Add localization coverage reports in CI for high-traffic dictionary namespaces.
7. Define an AI language precedence policy and add tests for Chimmy, trade AI, waiver AI, and draft AI.
8. Unify or bridge the World Cup dictionary island with the primary i18n source.
9. Add RTL smoke tests after Arabic has real dictionary coverage.
10. Only promote languages after dictionary coverage, copy QA, browser smoke, AI response policy tests, and email/notification coverage are green.

## Tests Run

Passed:

- Targeted TS/TSX parse check for G23-edited files.
- `npx vitest run __tests__/i18n-foundation.test.ts __tests__/i18n-placeholder-parity.test.ts __tests__/chimmy-language-prompt.test.ts`
  - Result: 3 files passed, 26 tests passed.
- `npx vitest run __tests__/world-cup-i18n.test.ts __tests__/world-cup-i18n-new-keys.test.ts __tests__/world-cup-public-flows-i18n.test.ts __tests__/world-cup-ai-language-chimmy.test.ts __tests__/world-cup-ai-language-explain.test.ts`
  - Result: 5 files passed, 1583 tests passed.
- `npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - Result: 11 passed.

Classified blocker:

- `npx vitest run __tests__/i18n-foundation.test.ts __tests__/i18n-placeholder-parity.test.ts __tests__/root-language-provider-layout.test.tsx __tests__/chimmy-language-prompt.test.ts`
  - Result: 3 files passed, `__tests__/root-language-provider-layout.test.tsx` failed 5 stale root-shell assertions.
  - Failing expectations are unrelated to G23 language behavior: old `SafeGlobalChrome` prop/Meta Pixel placement expectations and old `package.json` build string expectations.
  - G23 did not update this stale root-shell test because doing so would mix a root chrome/Railway assertion cleanup into the language foundation phase.

Bounded test-enabling fix:

- `lib/ai/auditLogger.ts` now guards missing `prisma.aiInteractionLog.create` before writing fire-and-forget AI audit rows. The file already documents that audit logging must never break an AI response; the guard prevents test/runtime logger gaps from blocking World Cup AI-language assertions.

## Readiness Assessment

Do not raise readiness from G23. The foundation is more truthful and centralized, but full customer-facing language readiness still requires translation QA, dictionary typing, localized validation/email/notification coverage, broader AI language enforcement, and RTL browser proof.

## G23B Root Language/Layout Test Cleanup

Resolved the stale root-shell assertion blocker in `__tests__/root-language-provider-layout.test.tsx`.

Clarified current root-shell behavior:

- `app/layout.tsx` owns Meta Pixel bootstrap and page-view tracking through `meta-pixel-immediate-bootstrap`, `meta-pixel-base`, and `MetaPixelPageViewTracker`.
- `components/shell/SafeGlobalChrome.tsx` owns route-aware global chrome gating, Facebook SDK loading, service-worker lifecycle, and `AuthRouteGlobalChrome`.
- SafeGlobalChrome should not own Meta Pixel/fbevents bootstrap.
- Root layout still must not own `fb-root`, Facebook SDK chrome, or service-worker registration markers.
- Railway build scripts intentionally run Next through `scripts/win-exfat-readlink-shim.cjs`; test expectations now match the current package/config contract.

No i18n behavior, analytics behavior, production layout behavior, SafeGlobalChrome behavior, or Railway build scripts were changed. Only stale test assertions were updated.

G23B verification:

- `npx vitest run __tests__/root-language-provider-layout.test.tsx __tests__/i18n-foundation.test.ts __tests__/chimmy-theme-readability.test.tsx`
  - Result: 3 files passed, 35 tests passed.
- `npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - Result: 11 passed.

Remaining issue:

- No G23B root language/layout blocker remains.
