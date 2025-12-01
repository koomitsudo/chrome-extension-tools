/**
 * このファイルはChrome拡張機能のService Workerとして動作し、
 * キーボードショートカットの処理とコンテンツスクリプトへのメッセージ中継を担当します。
 */

// ========================================
// キーボードショートカット処理
// ========================================

/**
 * Ctrl+Shift+E (Mac: Command+Shift+E) のショートカットで
 * 選択モードのトグルをコンテンツスクリプトに通知
 */
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-selection") {
        // 現在アクティブなタブを取得してメッセージを送信
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSelectionMode" })
                    .catch((error) => {
                        // コンテンツスクリプトがまだロードされていない場合のエラーを無視
                        console.log("Content script not ready:", error.message);
                    });
            }
        });
    }
});

// ========================================
// メッセージハンドラ
// ========================================

/**
 * Popupやコンテンツスクリプトからのメッセージを処理
 * 主にデータの保存・取得とモード切り替えの中継を行う
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 抽出データの保存リクエスト
    if (request.action === "saveExtractedData") {
        chrome.storage.local.set({
            extractedData: request.data,
            patternInfo: request.patternInfo,
            timestamp: Date.now()
        }, () => {
            sendResponse({ success: true });
        });
        return true; // 非同期レスポンスを示す
    }
    
    // 抽出データの取得リクエスト
    if (request.action === "getExtractedData") {
        chrome.storage.local.get(["extractedData", "patternInfo", "timestamp"], (result) => {
            sendResponse({
                data: result.extractedData || null,
                patternInfo: result.patternInfo || null,
                timestamp: result.timestamp || null
            });
        });
        return true; // 非同期レスポンスを示す
    }
    
    // データクリアリクエスト
    if (request.action === "clearData") {
        chrome.storage.local.remove(["extractedData", "patternInfo", "timestamp"], () => {
            // 現在のタブにクリア通知を送信
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "clearSelection" })
                        .catch(() => {});
                }
            });
            sendResponse({ success: true });
        });
        return true;
    }
    
    // 選択モードのトグルリクエスト（Popupから）
    if (request.action === "toggleFromPopup") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSelectionMode" })
                    .then((response) => {
                        // コンテンツスクリプト側のトグル結果（isActive）をそのまま返す
                        sendResponse(response);
                    })
                    .catch((error) => {
                        // コンテンツスクリプトが存在しない場合などのエラー
                        sendResponse({ success: false, error: error.message });
                    });
            } else {
                // アクティブタブが取得できなかった場合のフォールバック
                sendResponse({ success: false, error: "No active tab" });
            }
        });
        return true;
    }
    
    // 現在の選択モード状態を取得
    if (request.action === "getSelectionMode") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "getSelectionMode" })
                    .then((response) => {
                        sendResponse(response);
                    })
                    .catch(() => {
                        // コンテンツスクリプトがいない場合は常に非アクティブ扱い
                        sendResponse({ isActive: false });
                    });
            } else {
                sendResponse({ isActive: false });
            }
        });
        return true;
    }
});

// ========================================
// 拡張機能インストール時の初期化
// ========================================

chrome.runtime.onInstalled.addListener(() => {
    console.log("XPath Pattern Extractor installed successfully");
    // 初期状態でストレージをクリア
    chrome.storage.local.clear();
});
