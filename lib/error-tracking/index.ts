/**
 * Error tracking: frontend globals, API failure logs, AI failure logs, optional Sentry.
 */

export { captureException, setErrorReporter, type CaptureContext } from './capture'
export { initFrontendErrorTracking } from './frontend'
export { logApiFailure, type ApiFailureContext } from './api'
export { logAiFailure, type AiFailureContext } from './ai'
export { initSentryServer } from './sentry'
