// API設定および用途プリセットをchrome.storageに保存・復元する。
// 非秘密情報(apiBaseUrl, apiModel, purposes)は sync に保存し、
// APIキーは同期されない local に保存する。
// オプション画面にはAPIキーの値そのものは自動復元せず、
// 「保存済みかどうか」だけ表示する。

function loadOptions() {
    const apiBaseUrlInput = document.getElementById("apiBaseUrl");
    const apiModelInput = document.getElementById("apiModel");
    const apiKeyInput = document.getElementById("apiKey");
    const purpose1Input = document.getElementById("purpose1");
    const purpose2Input = document.getElementById("purpose2");
    const purpose3Input = document.getElementById("purpose3");
    const purpose4Input = document.getElementById("purpose4");
    const apiKeyStatus = document.getElementById("apiKeyStatus");

    // 非秘密の設定は sync から取得する
    chrome.storage.sync.get(
        {
            apiBaseUrl: "",
            apiModel: "",
            purposes: [
                "請求書送付",
                "入金確認",
                "督促",
                "一般的なお礼"
            ]
        },
        (items) => {
            apiBaseUrlInput.value = items.apiBaseUrl || "";
            apiModelInput.value = items.apiModel || "";

            const purposes = Array.isArray(items.purposes) ? items.purposes : [];
            purpose1Input.value = purposes[0] || "請求書送付";
            purpose2Input.value = purposes[1] || "入金確認";
            purpose3Input.value = purposes[2] || "督促";
            purpose4Input.value = purposes[3] || "一般的なお礼";
        }
    );

    // APIキーは local から取得し、「保存済みかどうか」だけ表示する
    chrome.storage.local.get(
        {
            apiKey: ""
        },
        (items) => {
            // 値そのものはフォームに復元しない
            apiKeyInput.value = "";
            if (items.apiKey && typeof items.apiKey === "string" && items.apiKey.length > 0) {
                apiKeyStatus.textContent = "APIキーは保存済みです。変更したい場合のみ新しいキーを入力してください。空のまま保存すると既存のキーは維持されます。";
            } else {
                apiKeyStatus.textContent = "APIキーは未設定です。新しいキーを入力して保存してください。";
            }
        }
    );
}

function saveOptions() {
    const apiBaseUrlInput = document.getElementById("apiBaseUrl");
    const apiModelInput = document.getElementById("apiModel");
    const apiKeyInput = document.getElementById("apiKey");
    const purpose1Input = document.getElementById("purpose1");
    const purpose2Input = document.getElementById("purpose2");
    const purpose3Input = document.getElementById("purpose3");
    const purpose4Input = document.getElementById("purpose4");
    const statusMessage = document.getElementById("statusMessage");
    const apiKeyStatus = document.getElementById("apiKeyStatus");

    const apiBaseUrl = (apiBaseUrlInput.value || "").trim();
    const apiModel = (apiModelInput.value || "").trim();
    const newApiKey = (apiKeyInput.value || "").trim();

    const purposes = [
        purpose1Input.value || "請求書送付",
        purpose2Input.value || "入金確認",
        purpose3Input.value || "督促",
        purpose4Input.value || "一般的なお礼"
    ];

    // sync には非秘密設定のみ保存する
    const syncPromise = new Promise((resolve) => {
        chrome.storage.sync.set(
            {
                apiBaseUrl: apiBaseUrl,
                apiModel: apiModel,
                purposes: purposes
            },
            () => {
                resolve();
            }
        );
    });

    // local にはAPIキーのみ保存する
    const localPromise = new Promise((resolve) => {
        if (newApiKey.length > 0) {
            // 入力がある場合のみ上書き保存する
            chrome.storage.local.set(
                {
                    apiKey: newApiKey
                },
                () => {
                    resolve();
                }
            );
        } else {
            // 空の場合は既存のキーを維持するため、何もしない
            resolve();
        }
    });

    Promise.all([syncPromise, localPromise]).then(() => {
        // フォーム上のAPIキー入力欄はクリアしておく(覗き見対策)
        apiKeyInput.value = "";
        statusMessage.textContent = "保存しました。";
        setTimeout(() => {
            statusMessage.textContent = "";
        }, 3000);

        // 保存後に状態表示を更新する
        chrome.storage.local.get(
            {
                apiKey: ""
            },
            (items) => {
                if (items.apiKey && typeof items.apiKey === "string" && items.apiKey.length > 0) {
                    apiKeyStatus.textContent = "APIキーは保存済みです。変更したい場合のみ新しいキーを入力してください。空のまま保存すると既存のキーは維持されます。";
                } else {
                    apiKeyStatus.textContent = "APIキーは未設定です。新しいキーを入力して保存してください。";
                }
            }
        );
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    const saveButton = document.getElementById("saveButton");
    saveButton.addEventListener("click", (event) => {
        event.preventDefault();
        saveOptions();
    });
});
