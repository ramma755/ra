(function initHelper() {
  if (window.__handshakeKycHelperLoaded) return;
  window.__handshakeKycHelperLoaded = true;

  const defaults = {
    botUrl: "http://127.0.0.1:8080",
    referenceId: "eb9b89bd-dac9-4345-aed3-9da525e52a38",
    legalName: "Crystal Little",
    dateOfBirth: "1980-04-18",
    dashboardUrl: `${window.location.origin}/fellow/dashboard`,
    redirectAfterApproval: true,
  };

  const state = { ...defaults };
  const storageKey = "handshakeKycHelperSettings";
  const storageFallbackKey = "__handshakeKycHelperSettingsFallback";

  function getFallbackSettings() {
    try {
      const raw = window.localStorage.getItem(storageFallbackKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function setFallbackSettings(value) {
    try {
      window.localStorage.setItem(storageFallbackKey, JSON.stringify(value));
    } catch (_error) {
      // Ignore localStorage failures in locked-down browser contexts.
    }
  }

  function canUseChromeRuntime() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (_error) {
      return false;
    }
  }

  function saveSettings() {
    setFallbackSettings(state);
    if (!canUseChromeRuntime()) return;
    try {
      chrome.storage.local.set({ [storageKey]: state });
    } catch (_error) {
      // Ignore stale/invalidation errors and keep local fallback only.
    }
  }

  function loadSettings(callback) {
    const fallback = getFallbackSettings();
    if (!canUseChromeRuntime()) {
      callback(fallback);
      return;
    }
    try {
      chrome.storage.local.get(storageKey, (data) => {
        if (chrome.runtime.lastError) {
          callback(fallback);
          return;
        }
        callback(data?.[storageKey] || fallback);
      });
    } catch (_error) {
      callback(fallback);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!canUseChromeRuntime()) {
        reject(
          new Error(
            "Extension context invalidated. Reload extension in chrome://extensions, then refresh this onboarding page."
          )
        );
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .kyc-helper-launch {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        background: #0b6b43;
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      }
      .kyc-helper-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.35);
      }
      .kyc-helper-card {
        width: min(460px, calc(100vw - 24px));
        background: #fff;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.3);
        font-family: Inter, Arial, sans-serif;
      }
      .kyc-helper-title {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .kyc-helper-note {
        margin: 0 0 14px;
        color: #444;
        font-size: 13px;
      }
      .kyc-helper-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 10px;
      }
      .kyc-helper-field label {
        font-size: 12px;
        color: #333;
        font-weight: 600;
      }
      .kyc-helper-field input {
        border: 1px solid #cfd7e0;
        border-radius: 8px;
        padding: 10px;
        font-size: 13px;
      }
      .kyc-helper-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0 12px;
        font-size: 13px;
      }
      .kyc-helper-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .kyc-helper-btn {
        border: 0;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 13px;
        cursor: pointer;
        font-weight: 600;
      }
      .kyc-helper-btn-cancel {
        background: #e8edf3;
        color: #16202a;
      }
      .kyc-helper-btn-run {
        background: #0b6b43;
        color: #fff;
      }
      .kyc-helper-status {
        margin-top: 10px;
        min-height: 20px;
        font-size: 12px;
        color: #1d2939;
      }
      .kyc-helper-status-error {
        color: #b42318;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function createUi() {
    injectStyles();

    const launch = document.createElement("button");
    launch.className = "kyc-helper-launch";
    launch.textContent = "Instant Verify (Test)";

    const overlay = document.createElement("div");
    overlay.className = "kyc-helper-overlay";
    overlay.innerHTML = `
      <div class="kyc-helper-card">
        <h2 class="kyc-helper-title">Handshake KYC Test Helper</h2>
        <p class="kyc-helper-note">Runs local bot verification and skips document uploads.</p>
        <div class="kyc-helper-field">
          <label>Bot URL</label>
          <input id="kyc-helper-bot-url" placeholder="http://127.0.0.1:8080" />
        </div>
        <div class="kyc-helper-field">
          <label>Reference ID</label>
          <input id="kyc-helper-reference-id" />
        </div>
        <div class="kyc-helper-field">
          <label>Legal name</label>
          <input id="kyc-helper-legal-name" />
        </div>
        <div class="kyc-helper-field">
          <label>Date of birth (YYYY-MM-DD)</label>
          <input id="kyc-helper-dob" />
        </div>
        <div class="kyc-helper-field">
          <label>Dashboard URL</label>
          <input id="kyc-helper-dashboard-url" />
        </div>
        <label class="kyc-helper-row">
          <input type="checkbox" id="kyc-helper-redirect" />
          Redirect to dashboard after APPROVED
        </label>
        <div class="kyc-helper-actions">
          <button class="kyc-helper-btn kyc-helper-btn-cancel" id="kyc-helper-cancel">Close</button>
          <button class="kyc-helper-btn kyc-helper-btn-run" id="kyc-helper-run">Approve now</button>
        </div>
        <div class="kyc-helper-status" id="kyc-helper-status"></div>
      </div>
    `;

    document.body.appendChild(launch);
    document.body.appendChild(overlay);

    const inputs = {
      botUrl: overlay.querySelector("#kyc-helper-bot-url"),
      referenceId: overlay.querySelector("#kyc-helper-reference-id"),
      legalName: overlay.querySelector("#kyc-helper-legal-name"),
      dateOfBirth: overlay.querySelector("#kyc-helper-dob"),
      dashboardUrl: overlay.querySelector("#kyc-helper-dashboard-url"),
      redirectAfterApproval: overlay.querySelector("#kyc-helper-redirect"),
      status: overlay.querySelector("#kyc-helper-status"),
      run: overlay.querySelector("#kyc-helper-run"),
      close: overlay.querySelector("#kyc-helper-cancel"),
    };

    function setStatus(message, isError = false) {
      inputs.status.textContent = message;
      inputs.status.classList.toggle("kyc-helper-status-error", isError);
    }

    function syncFromState() {
      inputs.botUrl.value = state.botUrl;
      inputs.referenceId.value = state.referenceId;
      inputs.legalName.value = state.legalName;
      inputs.dateOfBirth.value = state.dateOfBirth;
      inputs.dashboardUrl.value = state.dashboardUrl;
      inputs.redirectAfterApproval.checked = !!state.redirectAfterApproval;
    }

    function syncToState() {
      state.botUrl = inputs.botUrl.value.trim();
      state.referenceId = inputs.referenceId.value.trim();
      state.legalName = inputs.legalName.value.trim();
      state.dateOfBirth = inputs.dateOfBirth.value.trim();
      state.dashboardUrl = inputs.dashboardUrl.value.trim();
      state.redirectAfterApproval = inputs.redirectAfterApproval.checked;
      saveSettings();
    }

    function setBusy(busy) {
      inputs.run.disabled = busy;
      inputs.run.textContent = busy ? "Approving..." : "Approve now";
    }

    launch.addEventListener("click", () => {
      syncFromState();
      setStatus("");
      overlay.style.display = "flex";
    });

    inputs.close.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.style.display = "none";
      }
    });

    inputs.run.addEventListener("click", async () => {
      syncToState();
      setBusy(true);
      setStatus("Calling local bot...");
      try {
        const response = await sendRuntimeMessage({
          type: "RUN_INSTANT_KYC_VERIFICATION",
          payload: {
            botUrl: state.botUrl,
            referenceId: state.referenceId,
            legalName: state.legalName,
            dateOfBirth: state.dateOfBirth,
          },
        });
        if (!response?.ok) {
          throw new Error(response?.error || "Verification request failed.");
        }
        const via = response?.baseUrl ? ` via ${response.baseUrl}` : "";
        setStatus(`Approved. Verification completed successfully${via}.`);
        if (state.redirectAfterApproval && state.dashboardUrl) {
          setTimeout(() => {
            window.location.href = state.dashboardUrl;
          }, 500);
        }
      } catch (error) {
        const message = String(error?.message || error);
        if (message.toLowerCase().includes("context invalidated")) {
          setStatus(
            "Extension was updated/reloaded. Refresh this page, then click Approve now again.",
            true
          );
          return;
        }
        const hint = " Ensure local bot is running: python -m uvicorn app.main:app --host 0.0.0.0 --port 8080";
        setStatus(`${message}${hint}`, true);
      } finally {
        setBusy(false);
      }
    });
  }

  loadSettings((saved) => {
    if (saved && typeof saved === "object") {
      Object.assign(state, saved);
    }
    createUi();
  });
})();
