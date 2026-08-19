const button = document.getElementById("connect-btn");
const status = document.getElementById("status");

function setStatus(text, tone) {
  status.textContent = text;
  status.className = tone || "";
}

button.addEventListener("click", () => {
  button.disabled = true;
  setStatus("Connecting…", "");

  chrome.runtime.sendMessage({ type: "connectEspn" }, (response) => {
    button.disabled = false;

    if (chrome.runtime.lastError) {
      setStatus("Something went wrong. Please try again.", "error");
      return;
    }
    if (response && response.ok) {
      setStatus("ESPN connected. You can close this and import your league.", "success");
      return;
    }
    setStatus((response && response.message) || "Could not connect ESPN. Please try again.", "error");
  });
});
