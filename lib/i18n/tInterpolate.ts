import { interpolateTemplate } from "./interpolate";

export type InterpolationVars = Record<string, string | number | undefined>;

/**
 * Resolve a dictionary key with `t`, then replace `{{name}}` placeholders.
 * Use with `useLanguage().tInterpolate` in React, or pass any `t` (e.g. server-side lookup).
 */
export function tInterpolate(
  t: (key: string) => string,
  key: string,
  vars: InterpolationVars = {},
): string {
  return interpolateTemplate(t(key), vars);
}

/**
 * `t(key)` with an explicit English fallback, for labels defined in `lib/` beside a `labelKey`.
 *
 * ⚠ `t` RETURNS THE KEY ITSELF WHEN A STRING IS MISSING, so `t(key) || fallback` is dead code:
 * the key is truthy and lands on screen as "settings.x.y". This compares against the key instead.
 */
export function tOr(
  t: (key: string) => string,
  key: string | null | undefined,
  fallback: string,
): string {
  if (!key) return fallback;
  const value = t(key);
  return value && value !== key ? value : fallback;
}
