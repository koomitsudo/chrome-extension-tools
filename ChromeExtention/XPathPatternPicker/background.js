// Service Worker: content.js からのメッセージを受信して storage に保存し、バッジを更新する
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (!message || typeof message.type !== "string") {
        return;
    }

    // XPath 結果を storage に保存
    if (message.type === "XPATH_RESULT") {
        chrome.storage.local.set({
            xpathResult: message.xpath || "",
            xpathMode: message.mode || "NONE"
        });
        return;
    }

    // バッジの更新（ON/OFF状態をアイコン上に表示）
    if (message.type === "UPDATE_BADGE") {
        const tabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (!tabId) {
            return;
        }
        if (message.enabled) {
            chrome.action.setBadgeText({text: "ON", tabId: tabId});
            chrome.action.setBadgeBackgroundColor({color: "#4CAF50", tabId: tabId});
        } else {
            chrome.action.setBadgeText({text: "", tabId: tabId});
        }
        return;
    }
});