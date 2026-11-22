import type { Metadata } from "next";
import { availableImportPlatformsPhrase } from "@/lib/league-import/provider-ui-config";

/*
 * The description named "Sleeper or ESPN" long after Fantrax, MFL and Fleaflicker went live. It
 * reads the same one list every other platform sentence reads, so it follows `available`.
 */
export const metadata: Metadata = {
  title: "Import Your League – AllFantasy",
  description: `Import your fantasy league from ${availableImportPlatformsPhrase()} in a few steps. Read-only: AllFantasy never changes anything on your platform.`,
};

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
