/**
 * AllFantasy — Connect ESPN (background service worker, Manifest V3)
 *
 * Reads the user's own ESPN session cookies (SWID + espn_s2) via the "cookies" permission,
 * scoped only to *://*.espn.com/*, and saves them to the signed-in AllFantasy account via the
 * existing encrypted save endpoint (POST /api/league/auth). Nothing else is read or sent.
 *
 * SECURITY: cookie values are never logged — not to console, not in error messages, not
 * anywhere. Only success/failure + a short error code ever leave this function.
 */

// Candidate origins the extension will try, in order — covers the AllFantasy apex/www variant
// and lets host_permissions stay a short, explicit allowlist (no <all_urls>).
const ALLFANTASY_ORIGINS = ["https://www.allfantasy.ai", "https://allfantasy.ai"];

// Domain variants ESPN's SWID/espn_s2 cookies may be scoped under.
const ESPN_COOKIE_URLS = ["https://fantasy.espn.com", "https://www.espn.com", "https://espn.com"];

async function readEspnCookie(name) {
  for (const url of ESPN_COOKIE_URLS) {
    try {
      const cookie = await chrome.cookies.get({ url, name });
      if (cookie && cookie.value) return cookie.value;
    } catch {
      // try the next domain variant
    }
  }
  return null;
}

async function readEspnCookies() {
  const [swid, espnS2] = await Promise.all([readEspnCookie("SWID"), readEspnCookie("espn_s2")]);
  return { swid, espnS2 };
}

/**
 * Reads the two ESPN cookies and saves them to the signed-in AllFantasy account.
 * Returns a plain result object — never throws, never includes cookie values.
 */
async function connectEspn() {
  const { swid, espnS2 } = await readEspnCookies();

  if (!swid || !espnS2) {
    return {
      ok: false,
      code: "ESPN_NOT_LOGGED_IN",
      message: "Log into ESPN (fantasy.espn.com) first, then try again.",
    };
  }

  let lastNetworkError = null;

  for (const origin of ALLFANTASY_ORIGINS) {
    try {
      const response = await fetch(`${origin}/api/league/auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "espn", espnSwid: swid, espnS2: espnS2 }),
      });

      if (response.status === 401) {
        return {
          ok: false,
          code: "NOT_SIGNED_IN",
          message: "Sign in to AllFantasy in this browser first, then try again.",
        };
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return {
          ok: false,
          code: "SAVE_FAILED",
          message: (data && data.error) || "Could not save your ESPN connection. Please try again.",
        };
      }

      return { ok: true };
    } catch (err) {
      lastNetworkError = err;
      // Try the next AllFantasy origin candidate before giving up.
    }
  }

  return {
    ok: false,
    code: "NETWORK_ERROR",
    message: "Could not reach AllFantasy. Check your connection and try again.",
  };
}

/** Lets the AllFantasy Settings page detect the extension is installed without triggering a save. */
async function ping() {
  return { ok: true, installed: true };
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return { ok: false, code: "BAD_REQUEST" };
  if (message.type === "connectEspn") return connectEspn();
  if (message.type === "ping") return ping();
  return { ok: false, code: "UNKNOWN_MESSAGE" };
}

// Messages from the AllFantasy web page (Settings → Connected Accounts), scoped by
// externally_connectable in manifest.json to the AllFantasy origin only.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep the channel open for the async response
});

// Messages from the extension's own popup (the fallback trigger).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});
