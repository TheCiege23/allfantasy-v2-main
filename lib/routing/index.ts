export {
  getProductEntryRoute,
  getProductRouteConfigs,
  isPathInProduct,
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
} from "./UnauthorizedFallbackResolver"
export {
  isAllowedDeepLink,
  getDeepLinkRedirect,
} from "./DeepLinkHandler"
