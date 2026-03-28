// 拡張アイコンのクリックで「選択モード」をON/OFFトグルする。
// 選択モードはタブ単位で管理する。
const activeTabs = {}; // キーをタブID、値をbooleanとして「現在選択モード中か」を保持する。

// 拡張アイコンがクリックされたときのハンドラを登録する。
chrome.action.onClicked.addListener((tab) => {
    // タブIDが取得できない場合は何もしない。
    if (!tab || typeof tab.id !== "number") {
        return;
    }

    const tabId = tab.id;
    const isActive = !!activeTabs[tabId]; // 未登録の場合はfalse扱い。

    if (isActive) {
        // すでに選択モード中のタブであればOFFにする。
        delete activeTabs[tabId];

        // content.js側に「選択モードOFF」を通知する。
        chrome.tabs.sendMessage(tabId, {type: "xpathpicker_disable"}, () => {
            // content script が存在しない場合などはエラーになることがあるので無視する。
            void chrome.runtime.lastError;
        });
        return;
    }

    // 選択モードをONに設定する。
    activeTabs[tabId] = true;

    // content.js側に「選択モードON」を通知する。
    chrome.tabs.sendMessage(tabId, {type: "xpathpicker_enable"}, () => {
        // 受信側がないページ（chrome:// など）の場合は状態を巻き戻す。
        if (chrome.runtime.lastError) {
            delete activeTabs[tabId];
        }
    });
});

// content.js 側からの状態同期を受け取る。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "xpathpicker_selection_mode_changed") {
        return;
    }

    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (typeof tabId !== "number") {
        return;
    }

    if (message.enabled) {
        activeTabs[tabId] = true;
    } else {
        delete activeTabs[tabId];
    }
});

// タブが閉じられた場合はactiveTabsの状態をクリーンアップする。
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeTabs[tabId]) {
        delete activeTabs[tabId];
    }
});

// ページ遷移中（loading）にタブ状態をリセットしてズレを防ぐ。
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" && activeTabs[tabId]) {
        delete activeTabs[tabId];
    }
});
