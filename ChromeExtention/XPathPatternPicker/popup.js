// - ONボタン: content.js を inject して選択モードON
// - OFFボタン: 選択モードOFF
// - XPath はクリック時に自動でクリップボードにコピーされるためテキストエリア不要

const onButton = document.getElementById("onButton");
const offButton = document.getElementById("offButton");
const statusText = document.getElementById("statusText");

// ポップアップ初期化
initializePopupState();

// ポップアップの状態を初期化する
async function initializePopupState() {
    try {
        // 現在のタブで content.js が動作しているか、選択モード状態を問い合わせる
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (tabs && tabs.length > 0) {
            const tab = tabs[0];
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {type: "GET_SELECTION_STATE"});
                updateUiByState(response && response.enabled);
            } catch (e) {
                // content.js がまだ inject されていない場合は OFF 状態とみなす
                updateUiByState(false);
            }
        } else {
            updateUiByState(false);
        }
    } catch (e) {
        console.error("初期化エラー:", e);
        updateUiByState(false);
    }
}

// ON/OFF状態に応じてUI表示を更新する
function updateUiByState(isOn) {
    if (isOn) {
        statusText.textContent = "状態: ON（クリックでコピー）";
        onButton.disabled = true;
        offButton.disabled = false;
        onButton.style.backgroundColor = "#d8f0ff";
        offButton.style.backgroundColor = "#f5f5f5";
    } else {
        statusText.textContent = "状態: OFF";
        onButton.disabled = false;
        offButton.disabled = true;
        onButton.style.backgroundColor = "#f5f5f5";
        offButton.style.backgroundColor = "#ffd8d8";
    }
}

// ON ボタンクリック: content.js の inject + 選択モードON
onButton.addEventListener("click", async function() {
    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (!tabs || tabs.length === 0) {
            return;
        }
        const tab = tabs[0];

        // content.js をアクティブタブに inject する
        await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            files: ["content.js"]
        });

        // inject 完了後に選択モードONを指示
        chrome.tabs.sendMessage(tab.id, {
            type: "SET_SELECTION_MODE",
            enabled: true
        });

        // バッジを更新（background.js 経由）
        chrome.runtime.sendMessage({
            type: "UPDATE_BADGE",
            enabled: true,
            tabId: tab.id
        });

        updateUiByState(true);
    } catch (e) {
        console.error("ONボタン処理エラー:", e);
    }
});

// OFF ボタンクリック: 選択モードOFF
offButton.addEventListener("click", async function() {
    try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (tabs && tabs.length > 0) {
            const tab = tabs[0];
            chrome.tabs.sendMessage(tab.id, {
                type: "SET_SELECTION_MODE",
                enabled: false
            });

            // バッジを更新（background.js 経由）
            chrome.runtime.sendMessage({
                type: "UPDATE_BADGE",
                enabled: false,
                tabId: tab.id
            });
        }
        updateUiByState(false);
    } catch (e) {
        console.error("OFFボタン処理エラー:", e);
    }
});