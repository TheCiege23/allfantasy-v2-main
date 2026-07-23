import { THEME_DISPLAY_NAMES } from '@/lib/theme/constants'

/**
 * Customer-facing display names, kept deliberately separate per concept.
 *
 * Phase 1 of the paid-tier rebrand. Several distinct products currently render the
 * *same* string ("AF Legacy") while meaning different things — the top paid tier, the
 * strategy/intelligence workspace, the historical-identity product, and a visual theme.
 * Centralizing them here lets the visible rename change one concept without dragging
 * the others with it.
 *
 * Values below intentionally match what users see today. Phase 1 changes no rendered
 * copy; only the Phase 2 visible migration flips these values.
 *
 * NOT display names, and never to be driven from this module: `war_room`,
 * `af_war_room`, `hasWarRoom`, ThemeId 'legacy', feature IDs, entitlement IDs, token
 * rule codes, routes, database values, Stripe price/product IDs, environment-variable
 * names, and analytics event contracts. Those are stable internal identifiers.
 *
 * Localized copy is deliberately NOT sourced from here — see `lib/i18n/translations.ts`
 * and `lib/i18n/translations-es-parity.ts`. Substituting an English constant into a
 * locale dictionary would silently un-translate es/zh/vi. Those remain explicit
 * residual rename points for Phase 2.
 */

/**
 * Top paid subscription tier. Internal plan family stays `af_war_room`.
 * Phase 2 target value: 'AF Ultimate'.
 */
export const PAID_TIER_TOP_DISPLAY_NAME = 'AF Legacy'

/**
 * Strategy and intelligence workspace (the tool family behind `/war-room`).
 * Internal identifier stays `war_room`.
 */
export const WAR_ROOM_TOOL_DISPLAY_NAME = 'AF War Room'

/**
 * Historical identity product served at `/af-legacy`. Keeps its name in Phase 2 —
 * the rebrand exists so that this product owns "Legacy" outright.
 */
export const LEGACY_PRODUCT_DISPLAY_NAME = 'AF Legacy'

/**
 * Historical visual theme label. Keeps its name in Phase 2.
 *
 * Aliased from the pre-existing source of truth rather than re-declared: duplicating
 * the literal would create a second place to change it. ThemeId 'legacy' is persisted
 * on user profiles and must never change.
 */
export const LEGACY_THEME_DISPLAY_LABEL = THEME_DISPLAY_NAMES.legacy

/** Upgrade CTA for the top paid tier. */
export const PAID_TIER_TOP_UPGRADE_CTA = `Get ${PAID_TIER_TOP_DISPLAY_NAME}`

/** Catalog title for the top paid tier's monthly SKU. */
export const PAID_TIER_TOP_MONTHLY_TITLE = `${PAID_TIER_TOP_DISPLAY_NAME} Monthly`

/** Catalog title for the top paid tier's yearly SKU. */
export const PAID_TIER_TOP_YEARLY_TITLE = `${PAID_TIER_TOP_DISPLAY_NAME} Yearly`
