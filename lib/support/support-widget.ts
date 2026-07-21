/**
 * Identifiers for the global support widget (the AF-crest "S" button in the app shell).
 *
 * The feedback route keys its ALWAYS-notify behaviour off `SUPPORT_WIDGET_TOOL` — a support
 * message must reach the support inbox every time, praise included, unlike the per-tool feedback
 * widgets which only notify on bug/blocking. Client and server therefore have to agree on the
 * exact string, so it lives here once instead of as a literal repeated in both places.
 */
export const SUPPORT_WIDGET_TOOL = 'global-support-widget'

/** Fixed feedback type for support-widget submissions (the form has no type selector). */
export const SUPPORT_WIDGET_FEEDBACK_TYPE = 'support'
