"use client";

import { LeagueImportFlow } from "@/components/unified-import-ui/LeagueImportFlow";
import type { LegacyPlatformTab } from "@/lib/import/importSearchParams";

export function ImportPageClient({
  userId,
  returnTo,
  defaultProvider = "sleeper",
  initialSleeperUsername = "",
  initialLeagueSourceId = "",
}: {
  userId: string;
  returnTo: string;
  defaultProvider?: LegacyPlatformTab;
  initialSleeperUsername?: string;
  initialLeagueSourceId?: string;
}) {
  return (
    <LeagueImportFlow
      userId={userId}
      returnTo={returnTo}
      defaultProvider={defaultProvider}
      initialSleeperUsername={initialSleeperUsername}
      initialLeagueSourceId={initialLeagueSourceId}
      mode="full"
      showBackButton
      showSupportButton
    />
  );
}
