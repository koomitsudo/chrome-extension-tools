// popup.js
// ═══════════════════════════════════════════════════════════════════════════
// ポップアップのUIロジック
// ON/OFFボタンの制御と状態表示を担当
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
    const btnOn = document.getElementById("btnOn");
    const btnOff = document.getElementById("btnOff");
    const statusText = document.getElementById("statusText");

    // ───────────────────────────────────────────────────────────────────────
    // 現在アクティブなタブのIDを取得するヘルパー関数
    // ───────────────────────────────────────────────────────────────────────
    async function getCurrentTabId() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab ? tab.id : null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // UI状態を更新する関数
    // isActive: trueならON状態、falseならOFF状態として表示を切り替える
    // ───────────────────────────────────────────────────────────────────────
    function updateUI(isActive) {
        if (isActive) {
            statusText.textContent = "ON";
            statusText.classList.add("active");
            btnOn.disabled = true;
            btnOff.disabled = false;
        } else {
            statusText.textContent = "OFF";
            statusText.classList.remove("active");
            btnOn.disabled = false;
            btnOff.disabled = true;
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // ポップアップ表示時に現在の状態を取得して反映
    // ───────────────────────────────────────────────────────────────────────
    const tabId = await getCurrentTabId();
    if (tabId) {
        chrome.runtime.sendMessage({ action: "getStatus", tabId }, (response) => {
            if (response) {
                updateUI(response.isActive);
            }
        });
    }

    // ───────────────────────────────────────────────────────────────────────
    // ONボタンのクリックイベント
    // Service Workerにactivateメッセージを送信
    // ───────────────────────────────────────────────────────────────────────
    btnOn.addEventListener("click", async () => {
        const tabId = await getCurrentTabId();
        if (!tabId) {
            return;
        }

        chrome.runtime.sendMessage({ action: "activate", tabId }, (response) => {
            if (response && response.success) {
                updateUI(true);
            } else {
                console.error("Activation failed:", response?.error);
            }
        });
    });

    // ───────────────────────────────────────────────────────────────────────
    // OFFボタンのクリックイベント
    // Service Workerにdeactivateメッセージを送信
    // ───────────────────────────────────────────────────────────────────────
    btnOff.addEventListener("click", async () => {
        const tabId = await getCurrentTabId();
        if (!tabId) {
            return;
        }

        chrome.runtime.sendMessage({ action: "deactivate", tabId }, (response) => {
            if (response && response.success) {
                updateUI(false);
            } else {
                console.error("Deactivation failed:", response?.error);
            }
        });
    });
});