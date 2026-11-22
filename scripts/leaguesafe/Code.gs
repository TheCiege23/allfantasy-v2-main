/**
 * AllFantasy LeagueSafe capture — install ONLY on allfantasysportsapp@gmail.com.
 * Required Script Properties: LS_INBOUND_URL, LS_INBOUND_SECRET, LS_SENDER_DOMAINS.
 * Enable the Advanced Gmail service. See docs/leaguesafe/phase-0-setup.md.
 */
var AF_LS_BOT_ADDRESS = "allfantasysportsapp@gmail.com";
var AF_LS_LABEL = "af-processed";
var AF_LS_MAX_BYTES = 2 * 1024 * 1024;

function leagueSafeConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty("LS_INBOUND_URL") || "").trim();
  var secret = props.getProperty("LS_INBOUND_SECRET") || "";
  var domains = (props.getProperty("LS_SENDER_DOMAINS") || "")
    .split(",").map(function (value) { return value.trim().toLowerCase(); }).filter(Boolean);
  if (!/^https:\/\/[a-z0-9.-]+\/api\/integrations\/leaguesafe\/inbound$/i.test(url)) {
    throw new Error("Set LS_INBOUND_URL to the canonical HTTPS inbound endpoint, with no trailing slash.");
  }
  if (Utilities.newBlob(secret).getBytes().length < 32) {
    throw new Error("Set LS_INBOUND_SECRET to the same random 32+ byte secret used by AllFantasy.");
  }
  var validDomain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!domains.length || domains.some(function (value) { return !validDomain.test(value); })) {
    throw new Error("Set LS_SENDER_DOMAINS to exact domains verified in a real LeagueSafe email.");
  }
  if (Gmail.Users.getProfile("me").emailAddress.toLowerCase() !== AF_LS_BOT_ADDRESS) {
    throw new Error("Wrong Gmail account. Install and authorize this script on " + AF_LS_BOT_ADDRESS + ".");
  }
  return { url: url, secret: secret, domains: domains };
}

function captureLeagueSafeEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var config = leagueSafeConfig_();
    var labels = Gmail.Users.Labels.list("me").labels || [];
    var label = labels.filter(function (item) { return item.name === AF_LS_LABEL; })[0];
    if (!label) {
      label = Gmail.Users.Labels.create({
        name: AF_LS_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show"
      }, "me");
    }
    // Gmail API searches messages, not entire conversations. Label only each
    // acknowledged message so a later email in its thread is never skipped.
    var query = "in:anywhere {" + config.domains.map(function (domain) {
      return "from:(@" + domain + ")";
    }).join(" ") + "} -label:" + AF_LS_LABEL;
    var pending = Gmail.Users.Messages.list("me", {
      q: query, maxResults: 25, includeSpamTrash: true
    }).messages || [];
    var started = Date.now();
    var failures = 0;
    for (var index = 0; index < pending.length; index++) {
      if (Date.now() - started > 240000) break;
      var id = pending[index].id;
      var stage = "gmail_read";
      try {
        var email = Gmail.Users.Messages.get("me", id, { format: "raw" });
        if (!email.raw || !email.internalDate) throw new Error("Missing raw message metadata.");
        stage = "raw_decode";
        // Advanced Gmail may already decode the REST bytes field into Byte[].
        // Decode only an encoded string; preserve signed bytes returned by Apps Script.
        var rawBytes = typeof email.raw === "string"
          ? Utilities.base64DecodeWebSafe(email.raw)
          : email.raw;
        var raw = Utilities.newBlob(rawBytes).getDataAsString("UTF-8");
        stage = "build_payload";
        var payload = JSON.stringify({
          messageId: id,
          receivedAt: new Date(Number(email.internalDate)).toISOString(),
          rawBody: raw
        });
        if (Utilities.newBlob(payload).getBytes().length > AF_LS_MAX_BYTES) {
          console.error("LeagueSafe: Gmail message " + id + " exceeds the 2 MiB capture limit; left unprocessed.");
          failures++;
          continue;
        }
        stage = "sign_request";
        var timestamp = String(Math.floor(Date.now() / 1000));
        var bytes = Utilities.computeHmacSha256Signature(
          timestamp + "." + payload, config.secret, Utilities.Charset.UTF_8
        );
        var hex = bytes.map(function (value) {
          return ("0" + ((value + 256) % 256).toString(16)).slice(-2);
        }).join("");
        stage = "http_send";
        var response = UrlFetchApp.fetch(config.url, {
          method: "post", contentType: "application/json; charset=utf-8", payload: payload,
          headers: { "X-LS-Timestamp": timestamp, "X-LS-Signature": "v1=" + hex },
          muteHttpExceptions: true, followRedirects: false
        });
        var code = response.getResponseCode();
        if (code !== 200 && code !== 202) {
          console.error("LeagueSafe: Gmail message " + id + " received HTTP " + code + "; left unprocessed.");
          failures++;
          continue;
        }
        stage = "receipt_decode";
        var receipt = JSON.parse(response.getContentText());
        if (receipt.ok !== true || receipt.stored !== true || typeof receipt.id !== "string" ||
            ["captured", "rejected", "parsed", "unparseable"].indexOf(receipt.processingStatus) === -1) {
          throw new Error("Missing storage acknowledgement.");
        }
        // The Gmail conversation displays this label. Never label a whole thread:
        // doing so could mark an uncaptured message that arrived during this run.
        stage = "gmail_label";
        Gmail.Users.Messages.modify({ addLabelIds: [label.id] }, "me", id);
      } catch (_) {
        // Never log the exception/response/payload: they can contain email text.
        console.error("LeagueSafe: Gmail message " + id + " failed at " + stage + "; retry on next run.");
        failures++;
      }
    }
    if (failures) throw new Error("LeagueSafe capture has " + failures + " failed message(s). Check Executions; messages remain unprocessed.");
  } finally {
    lock.releaseLock();
  }
}

/** Run once after the first successful manual capture. Safe to run again. */
function installLeagueSafeTrigger() {
  leagueSafeConfig_();
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "captureLeagueSafeEmails";
  });
  if (!exists) ScriptApp.newTrigger("captureLeagueSafeEmails").timeBased().everyMinutes(5).create();
}
