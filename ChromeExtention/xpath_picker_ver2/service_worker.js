// service_worker.js
// ═══════════════════════════════════════════════════════════════════════════
// Service Worker（バックグラウンドスクリプト）
// タブごとの有効/無効状態を管理し、コンテンツスクリプトの注入・制御を行う
// ═══════════════════════════════════════════════════════════════════════════

// タブIDをキーとして、拡張機能がアクティブかどうかを保持するMap
// chrome.storageは使用せず、メモリ上のみで管理（プライバシー保護のため）
const activeTabsMap = new Map();

// ───────────────────────────────────────────────────────────────────────────
// ポップアップやコンテンツスクリプトからのメッセージを受信するリスナー
// ───────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 拡張機能の有効化リクエスト
    if (message.action === "activate") {
        handleActivate(message.tabId)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true; // 非同期レスポンスを示す
    }

    // 拡張機能の無効化リクエスト
    if (message.action === "deactivate") {
        handleDeactivate(message.tabId)
            .then(() => sendResponse({ success: true }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }

    // 現在の状態を問い合わせるリクエスト
    if (message.action === "getStatus") {
        const isActive = activeTabsMap.get(message.tabId) || false;
        sendResponse({ isActive });
        return false;
    }
});

// ───────────────────────────────────────────────────────────────────────────
// 拡張機能を有効化する処理
// コンテンツスクリプトを対象タブに注入し、activateメッセージを送信
// ───────────────────────────────────────────────────────────────────────────
async function handleActivate(tabId) {
    // 既にアクティブな場合は何もしない
    if (activeTabsMap.get(tabId)) {
        return;
    }

    // コンテンツスクリプトを注入
    // すでに注入済みの場合でも再注入されるが、スクリプト側で重複登録を防止している
    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["contentScript.js"]
    });

    // CSSも注入（ハイライト用のスタイル）
    await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        css: `
            .xpath-picker-highlight {
                outline: 3px solid #f5a623 !important;
                background-color: rgba(255, 255, 0, 0.25) !important;
                box-shadow: 0 0 8px rgba(245, 166, 35, 0.6) !important;
            }
            .xpath-picker-panel {
                position: fixed !important;
                bottom: 16px !important;
                right: 16px !important;
                width: 340px !important;
                max-height: 400px !important;
                background: #fafafa !important;
                border: 1px solid #ccc !important;
                border-radius: 6px !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                z-index: 2147483647 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                font-size: 13px !important;
                color: #333 !important;
                overflow: hidden !important;
            }
            .xpath-picker-panel-header {
                padding: 10px 12px !important;
                background: #f0f0f0 !important;
                border-bottom: 1px solid #ddd !important;
                font-weight: 600 !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
            }
            .xpath-picker-panel-mode {
                padding: 8px 12px !important;
                background: #fff !important;
                border-bottom: 1px solid #eee !important;
                font-size: 12px !important;
                color: #666 !important;
            }
            .xpath-picker-panel-xpath {
                padding: 8px 12px !important;
                background: #f9f9f9 !important;
                border-bottom: 1px solid #eee !important;
                font-size: 11px !important;
                font-family: Monaco, Consolas, monospace !important;
                color: #555 !important;
                word-break: break-all !important;
                max-height: 60px !important;
                overflow-y: auto !important;
            }
            .xpath-picker-panel-content {
                padding: 10px 12px !important;
                max-height: 220px !important;
                overflow-y: auto !important;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                background: #fff !important;
                font-size: 12px !important;
                line-height: 1.5 !important;
            }
            .xpath-picker-panel-hint {
                padding: 8px 12px !important;
                background: #fffbe6 !important;
                border-top: 1px solid #eee !important;
                font-size: 11px !important;
                color: #888 !important;
            }
        `
    });

    // アクティブ状態をMapに記録
    activeTabsMap.set(tabId, true);

    // コンテンツスクリプトにactivateメッセージを送信
    await chrome.tabs.sendMessage(tabId, { action: "activate" });
}

// ───────────────────────────────────────────────────────────────────────────
// 拡張機能を無効化する処理
// コンテンツスクリプトにdeactivateメッセージを送り、クリーンアップさせる
// ───────────────────────────────────────────────────────────────────────────
async function handleDeactivate(tabId) {
    if (!activeTabsMap.get(tabId)) {
        return;
    }

    // コンテンツスクリプトにdeactivateメッセージを送信
    // スクリプトが存在しない場合のエラーは無視
    try {
        await chrome.tabs.sendMessage(tabId, { action: "deactivate" });
    } catch (e) {
        // タブが閉じられている等の場合は無視
    }

    // アクティブ状態をMapから削除
    activeTabsMap.delete(tabId);
}

// ───────────────────────────────────────────────────────────────────────────
// タブが閉じられたときにMapから削除（メモリリーク防止）
// ───────────────────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabsMap.delete(tabId);
});

// ───────────────────────────────────────────────────────────────────────────
// タブが更新（ページ遷移）されたときにアクティブ状態をリセット
// ───────────────────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
        activeTabsMap.delete(tabId);
    }
});