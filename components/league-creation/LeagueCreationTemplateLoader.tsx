'use client';

import { type ReactNode } from 'react';
import { useSportPreset, type LeagueSportOption } from '@/hooks/useSportPreset';
import { Loader2 } from 'lucide-react';

interface LeagueCreationTemplateLoaderProps {
  sport: LeagueSportOption;
  variant?: string | null;
  children: (payload: NonNullable<ReturnType<typeof useSportPreset>['preset']>) => ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: (error: string) => ReactNode;
}

/**
 * LeagueCreationTemplateLoader — automatically loads default roster template, scoring template,
 * sport-specific draft settings, and sport-specific schedule configuration when sport (or variant) changes.
 * Renders children with the loaded preset; shows loading/error state otherwise.
 */
export function LeagueCreationTemplateLoader({
  sport,
  variant,
  children,
  loadingFallback,
  errorFallback,
}: LeagueCreationTemplateLoaderProps) {
  const { preset, loading, error } = useSportPreset(sport, variant);

  if (loading) {
    if (loadingFallback !== undefined) return <>{loadingFallback}</>;
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading templates…
      </div>
    );
  }

  if (error) {
    if (errorFallback) return <>{errorFallback(error)}</>;
    return (
      <p className="text-sm text-amber-500 py-2">
        Failed to load templates: {error}
      </p>
    );
  }

  if (!preset) return null;

  return <>{children(preset)}</>;
}
