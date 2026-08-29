import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImportV4 } from "@/components/core-app/screens/ImportV4";
import { normalizeIncomingImportProvider } from "@/lib/import/importSearchParams";
import { IMPORT_PROVIDER_UI_OPTIONS } from "@/lib/league-import/provider-ui-config";
import { prisma } from "@/lib/prisma";

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

  /*
   * ⚠ PARSING A PROVIDER IS NOT THE SAME AS OFFERING IT, AND THE DEEP LINK IS THE WAY IN.
   *
   * `normalizeIncomingImportProvider` only decides whether the string names a provider we
   * know; it says nothing about whether that provider is usable. Disabling a tile in
   * ImportV4 therefore does NOT close the door, because /import is reached with
   * `?provider=` from source-platform deep links — and, until 2026-08-29, from Yahoo's own
   * connect flow, whose returnTo was literally `/import?provider=yahoo`. Someone pressed
   * "Connect Yahoo", came back here, and was handed the same button again.
   *
   * So an unavailable provider falls back to the default rather than being selected. The
   * tile still shows with its "soon" chip and its BLOCKED_REASON, which is the honest
   * outcome: the provider is visible and named as not ready, instead of opening a panel
   * that cannot finish.
   */
  const providerRaw = pickQuery(sp, "provider");
  const requestedProvider = normalizeIncomingImportProvider(providerRaw);
  const requestedIsAvailable =
    requestedProvider != null &&
    IMPORT_PROVIDER_UI_OPTIONS.some((p) => p.provider === requestedProvider && p.available);
  const defaultProvider = requestedIsAvailable ? requestedProvider : "sleeper";
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
  /*
   * ⚠ THE TWO CALLBACKS SET DIFFERENT PARAMETERS, AND THIS ONLY KNEW ONE.
   * `/api/auth/yahoo/callback` returns `yahoo_connected=1`;
   * `/api/league/yahoo/callback` returns `success=yahoo_connected`. Both are
   * real exits from a successful OAuth round trip, and a manager who came back
   * through the second one landed on a page still offering to connect an
   * account they had just connected. Read both spellings rather than picking a
   * winner, because either callback can legitimately be the one that ran.
   */
  const yahooConnectedFromQuery =
    pickQuery(sp, "yahoo_connected") === "1" ||
    pickQuery(sp, "success") === "yahoo_connected";

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string };
  } | null;

  /*
   * ⚠ AND A CONNECTION IS NOT A QUERY STRING. Deriving this from the URL alone
   * meant the fact survived exactly one render: a refresh, a new tab, or coming
   * back the next day all showed "not connected" while the token sat in the
   * database the whole time. The row is the truth; the query parameter is only
   * how we learn about it a few milliseconds early, before the redirect settles.
   *
   * Read AFTER the session check below so an unauthenticated visitor never
   * costs a query.
   */

  if (!session?.user?.id) {
    const qs = new URLSearchParams();
    qs.set("returnTo", returnTo);
    if (providerRaw) qs.set("provider", providerRaw);
    if (initialSleeperUsername) qs.set("username", initialSleeperUsername);
    if (initialLeagueSourceId) qs.set("leagueId", initialLeagueSourceId);
    const callbackUrl = encodeURIComponent(`/import?${qs.toString()}`);
    redirect(`/login?callbackUrl=${callbackUrl}`);
  }

  /*
   * Never throws: the import page's job is importing, and a failed lookup here
   * should degrade to "offer to connect" rather than take the page down. That
   * is the same answer the old query-only check gave, so the floor has not
   * moved.
   */
  const yahooAuthRow = await (prisma as never as {
    leagueAuth: {
      findUnique: (args: unknown) => Promise<{ oauthToken: string | null } | null>;
    };
  }).leagueAuth
    .findUnique({
      where: { userId_platform: { userId: session.user.id, platform: "yahoo" } },
      select: { oauthToken: true },
    })
    .catch(() => null);

  /* A row with no token is a connect that started and never finished — the same
     shape the ESPN row has carried since August. It is not a connection. */
  const yahooConnected = yahooConnectedFromQuery || Boolean(yahooAuthRow?.oauthToken);

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
