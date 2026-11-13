import {
  resolveFallbackRoute,
  type FallbackIntent,
  type FallbackRouteSpec,
} from "./FallbackRouteResolver"

type RecoveryContext =
  | "dashboard"
  | "search"
  | "notifications"
  | "settings"
  | "profile"
  | "legacy_import"
  | "provider_pending"
  | "tool_page"

interface RecoveryActionSpec {
  id: string
  label: string
  href?: string
  intent?: FallbackIntent
  emphasis?: "primary" | "secondary"
}

function toAction(
  id: string,
  route: FallbackRouteSpec,
  emphasis: "primary" | "secondary" = "secondary"
): RecoveryActionSpec {
  return {
    id,
    label: route.label,
    href: route.href,
    emphasis,
  }
}

export function resolveRecoveryActions(context: RecoveryContext): RecoveryActionSpec[] {
  switch (context) {
    case "dashboard":
      return [
        toAction("create", resolveFallbackRoute("create_league"), "primary"),
        toAction("import", resolveFallbackRoute("import_league")),
        toAction("chimmy", resolveFallbackRoute("ask_chimmy")),
      ]
    case "search":
      return [
        toAction("tools", resolveFallbackRoute("explore_tools"), "primary"),
        toAction("chimmy", resolveFallbackRoute("ask_chimmy")),
      ]
    case "notifications":
      return [
        toAction("dashboard", resolveFallbackRoute("dashboard"), "primary"),
        toAction("settings", resolveFallbackRoute("settings")),
      ]
    case "settings":
      return [
        toAction("dashboard", resolveFallbackRoute("dashboard"), "primary"),
        toAction("home", resolveFallbackRoute("home")),
      ]
    case "profile":
      return [
        toAction("dashboard", resolveFallbackRoute("dashboard"), "primary"),
        toAction("settings", resolveFallbackRoute("settings")),
      ]
    case "legacy_import":
      return [
        toAction("import", resolveFallbackRoute("import_league"), "primary"),
        toAction("connect", resolveFallbackRoute("connect_provider")),
      ]
    case "provider_pending":
      return [
        toAction("settings", resolveFallbackRoute("settings"), "primary"),
        toAction("home", resolveFallbackRoute("home")),
      ]
    case "tool_page":
      return [
        toAction("tools", resolveFallbackRoute("explore_tools"), "primary"),
        toAction("dashboard", resolveFallbackRoute("dashboard")),
      ]
    default:
      return [toAction("dashboard", resolveFallbackRoute("dashboard"), "primary")]
  }
}
