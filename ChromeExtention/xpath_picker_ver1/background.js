// 拡張アイコンのクリックで「選択モード」をON/OFFトグルする。
// 選択モードはタブ単位で管理する。
const activeTabs = {}; // キーをタブID、値をbooleanとして「現在選択モード中か」を保持する。

// 拡張アイコンがクリックされたときのハンドラを登録する。
chrome.action.onClicked.addListener(tab => {
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
            // chrome.runtime.lastError を参照してもよいが、ここでは何もしない。
        });
    } else {
        // 選択モードをONに設定する。
        activeTabs[tabId] = true;
        // content.js側に「選択モードON」を通知する。
        chrome.tabs.sendMessage(tabId, {type: "xpathpicker_enable"}, () => {
            // こちらもエラーは無視する。content script 側でのみ処理される。
        });
    }
});

// タブが閉じられた場合はactiveTabsの状態をクリーンアップする。
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (activeTabs[tabId]) {
        delete activeTabs[tabId];
    }
});
