/**
 * What a Yahoo refusal means, in the user's terms.
 *
 * ⚠ THE STATUS IS THE WHOLE DIAGNOSIS, AND BOTH PATHS USED TO DISCARD IT.
 * Discovery collapsed every rejection into one sentence; the import pipeline did
 * the opposite and handed Yahoo's raw JSON body to the screen, which rendered as
 *
 *   {"error":{"xml:lang":"en-us","yahoo:uri":"/fantasy/v2/league/nfl.l.1361311
 *    ?format=json","description":"This application is not authorized to perform
 *    this action.","detail":""}}
 *
 * — unreadable, and it published our own API path to the user. One mapper, used
 * by both, so the two cannot drift apart again.
 *
 * ⚠ 403 IS AN APP PERMISSION, NOT A USER PROBLEM, AND SAYING SO MATTERS.
 * Observed 2026-08-27 against a real account: the token was valid and freshly
 * issued, and Yahoo still answered "This application is not authorized to perform
 * this action" to every fantasy endpoint — the account-wide league list AND a
 * single named league. That is Yahoo refusing the APP, so revoking and
 * reconnecting cannot change it, and telling someone to try again sends them
 * round a loop they have already been round. The fix is in Yahoo's developer
 * console, on the app the client id belongs to.
 */
export function describeYahooRejection(status: number): string {
  if (status === 401) {
    return 'Yahoo would not accept the saved authorisation for your account. Reconnect Yahoo and try again.'
  }
  if (status === 403) {
    return (
      'Yahoo refused this request: the AllFantasy app is not authorised for Fantasy Sports. ' +
      'That is a permission on the app itself, in Yahoo’s developer console — ' +
      'reconnecting your account will not change it, so there is nothing to retry here yet.'
    )
  }
  if (status === 404) {
    return 'Yahoo has no league with that ID on this account. Check the number in your league’s address.'
  }
  return `Yahoo rejected the request (HTTP ${status}). Reconnect Yahoo and try again.`
}
