export {
  getProductEntryRoute,
  getProductRouteConfigs,
  isPathInProduct,
  PRODUCT_ROUTE_CONFIGS,
  type ProductRouteConfig,
} from "./CrossProductRouteResolver"
export {
  getProductSwitchHref,
  getProductSwitchItems,
} from "./ProductSwitchController"
export {
  safeRedirectPath,
  getRedirectAfterLogin,
  getRedirectAfterSignup,
  loginUrlWithIntent,
  signupUrlWithIntent,
} from "./PostAuthIntentRouter"
export {
  isProtectedPath,
  isAdminPath,
  getLoginRedirectUrl,
} from "./ProtectedRouteResolver"
export {
  getUnauthorizedFallback,
  DEFAULT_UNAUTHORIZED_FALLBACK,
} from "./UnauthorizedFallbackResolver"
export {
  normalizeDeepLink,
  isAllowedDeepLink,
  getDeepLinkRedirect,
} from "./DeepLinkHandler"
