import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImportPageClient } from "./ImportPageClient";
import { normalizeIncomingImportProvider } from "@/lib/import/importSearchParams";

export const dynamic = "force-dynamic";

function pickQuery(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const sp =
    searchParams instanceof Promise ? await searchParams : searchParams ?? {};
  const returnToRaw = pickQuery(sp, "returnTo");
  const returnTo = returnToRaw?.startsWith("/") ? returnToRaw : "/create-league";

  const providerRaw = pickQuery(sp, "provider");
  const defaultProvider = normalizeIncomingImportProvider(providerRaw) ?? "sleeper";
  const initialSleeperUsername = pickQuery(sp, "username");
  const initialLeagueSourceId =
    pickQuery(sp, "leagueId") || pickQuery(sp, "sourceId");

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    const qs = new URLSearchParams();
    qs.set("returnTo", returnTo);
    if (providerRaw) qs.set("provider", providerRaw);
    if (initialSleeperUsername) qs.set("username", initialSleeperUsername);
    if (initialLeagueSourceId) qs.set("leagueId", initialLeagueSourceId);
    const callbackUrl = encodeURIComponent(`/import?${qs.toString()}`);
    redirect(`/login?callbackUrl=${callbackUrl}`);
  }

  return (
    <ImportPageClient
      userId={session.user.id}
      returnTo={returnTo}
      defaultProvider={defaultProvider}
      initialSleeperUsername={initialSleeperUsername}
      initialLeagueSourceId={initialLeagueSourceId}
    />
  );
}
