import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImportV4 } from "@/components/core-app/screens/ImportV4";
import { normalizeIncomingImportProvider } from "@/lib/import/importSearchParams";

/**
 * /import — cut over to the V4 screen.
 *
 * ⚠ EVERYTHING BELOW THE RENDER CALL IS DELIBERATELY UNCHANGED. This page is not
 * only a UI: it is the auth boundary and the param contract for every inbound
 * import link in the product — the legacy funnel, create-league, and the
 * source-platform deep links all arrive here with `?provider=`, `?username=`,
 * `?leagueId=`/`?sourceId=` and `?returnTo=`. The session check, the callbackUrl
 * that carries those params through login, the returnTo path validation and
 * `normalizeIncomingImportProvider` are the same code they were; swapping the
 * component underneath them is the whole change.
 *
 * ⚠ THE PROVIDER STRING IS NORMALISED, NOT PASSED THROUGH. Inbound links spell it
 * inconsistently and an unrecognised value must fall back to sleeper rather than
 * reach the client as a provider that does not exist.
 */

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
  /*
   * Relative paths only. An absolute URL here would turn every import link into
   * an open redirect, and the default is a real destination rather than "/" so
   * the create-league flow is not lost.
   */
  const returnTo = returnToRaw?.startsWith("/") ? returnToRaw : "/create-league";

  const providerRaw = pickQuery(sp, "provider");
  const defaultProvider = normalizeIncomingImportProvider(providerRaw) ?? "sleeper";
  const initialSleeperUsername = pickQuery(sp, "username");
  const initialLeagueSourceId =
    pickQuery(sp, "leagueId") || pickQuery(sp, "sourceId");

  /*
   * The Yahoo callback has always written `yahoo_error` here and nothing has ever
   * read it, so a failed connect returned a page that looked completely normal --
   * no error, and (because the callback also built a malformed URL) the Sleeper
   * form. The cause was only ever visible in the server log. Surface it.
   */
  const yahooError = pickQuery(sp, "yahoo_error");
  const yahooErrorDesc = pickQuery(sp, "yahoo_error_desc");
  const yahooConnected = pickQuery(sp, "yahoo_connected") === "1";

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
    <ImportV4
      defaultProvider={defaultProvider}
      initialAccount={initialSleeperUsername}
      initialLeagueSourceId={initialLeagueSourceId}
      returnTo={returnTo}
      yahooError={yahooError}
      yahooErrorDesc={yahooErrorDesc}
      yahooConnected={yahooConnected}
    />
  );
}
