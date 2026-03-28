// - 選択モードON時: クリックで Full XPath を自動コピー
// - コピー成功時のみ一瞬緑色のハイライトを表示
// - ダブルクリックで選択モード終了

// 二重 inject 防止用フラグ
if (!window.__xpathPickerInitialized) {
    window.__xpathPickerInitialized = true;

    // 選択モードON/OFFフラグ
    let selectionModeEnabled = false;

    // 現在ホバー中の要素
    let currentHoverElement = null;

    // ハイライト用オーバーレイ要素
    let overlayElement = null;

    // オーバーレイ要素の識別用ID
    const OVERLAY_ID = "__xpath_picker_overlay__";

    // イベントハンドラ参照
    let onMouseMoveHandler = null;
    let onClickHandler = null;
    let onDblClickHandler = null;

    // 選択モード開始
    function startSelectionMode() {
        if (selectionModeEnabled) {
            return;
        }
        selectionModeEnabled = true;
        createOverlay();
        onMouseMoveHandler = handleMouseMove;
        onClickHandler = handleClick;
        onDblClickHandler = handleDblClick;
        document.addEventListener("mousemove", onMouseMoveHandler, true);
        document.addEventListener("click", onClickHandler, true);
        document.addEventListener("dblclick", onDblClickHandler, true);

        // バッジを ON に更新
        chrome.runtime.sendMessage({
            type: "UPDATE_BADGE",
            enabled: true
        });
    }

    // 選択モード終了
    function stopSelectionMode() {
        if (!selectionModeEnabled) {
            return;
        }
        selectionModeEnabled = false;
        if (onMouseMoveHandler) {
            document.removeEventListener("mousemove", onMouseMoveHandler, true);
            onMouseMoveHandler = null;
        }
        if (onClickHandler) {
            document.removeEventListener("click", onClickHandler, true);
            onClickHandler = null;
        }
        if (onDblClickHandler) {
            document.removeEventListener("dblclick", onDblClickHandler, true);
            onDblClickHandler = null;
        }
        removeOverlay();
        resetSelectionState();

        // バッジを OFF に更新
        chrome.runtime.sendMessage({
            type: "UPDATE_BADGE",
            enabled: false
        });
    }

    // 内部状態リセット
    function resetSelectionState() {
        currentHoverElement = null;
    }

    // ハイライト用オーバーレイ作成（通常時は透明）
    function createOverlay() {
        if (overlayElement && overlayElement.parentNode) {
            return;
        }
        overlayElement = document.createElement("div");
        overlayElement.id = OVERLAY_ID;
        overlayElement.style.cssText = [
            "position: fixed",
            "border: 2px solid transparent",
            "background-color: transparent",
            "pointer-events: none",
            "z-index: 2147483647",
            "box-sizing: border-box",
            "top: 0",
            "left: 0",
            "width: 0",
            "height: 0"
        ].join(";");
        document.documentElement.appendChild(overlayElement);
    }

    // ハイライト用オーバーレイ削除
    function removeOverlay() {
        if (overlayElement && overlayElement.parentNode) {
            overlayElement.parentNode.removeChild(overlayElement);
        }
        overlayElement = null;
    }

    // マウス移動時: ホバー要素を記録（オーバーレイ位置も更新するが透明）
    function handleMouseMove(event) {
        if (!selectionModeEnabled) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        // オーバーレイ自身は無視する
        if (target.id === OVERLAY_ID) {
            return;
        }
        if (currentHoverElement === target) {
            return;
        }
        currentHoverElement = target;
        updateOverlayPosition(target);
    }

    // オーバーレイ位置とサイズ更新
    function updateOverlayPosition(element) {
        if (!overlayElement) {
            return;
        }
        const rect = element.getBoundingClientRect();
        overlayElement.style.top = rect.top + "px";
        overlayElement.style.left = rect.left + "px";
        overlayElement.style.width = rect.width + "px";
        overlayElement.style.height = rect.height + "px";
    }

    // クリック時: Full XPath を取得して自動でクリップボードにコピー
    function handleClick(event) {
        if (!selectionModeEnabled) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = currentHoverElement || event.target;
        if (!(target instanceof Element)) {
            return;
        }
        // オーバーレイ自身は無視する
        if (target.id === OVERLAY_ID) {
            return;
        }

        const xpathInfo = getAbsoluteXPath(target);
        if (!xpathInfo || !xpathInfo.xpath) {
            showErrorFeedback();
            console.warn("XPath生成失敗:", xpathInfo && xpathInfo.error ? xpathInfo.error : "unknown");
            return;
        }
        const xpath = xpathInfo.xpath;

        // クリップボードに自動コピー
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(xpath).then(function() {
                // コピー成功時: 一瞬だけ緑色を表示
                showCopyFeedback();
            }).catch(function(error) {
                console.error("クリップボードへのコピーに失敗:", error);
                // フォールバック: execCommand を試す
                fallbackCopyToClipboard(xpath);
            });
        } else {
            // navigator.clipboard が使えないページでは即フォールバック
            fallbackCopyToClipboard(xpath);
        }

        // background.js にも通知（storage 保存用、オプション）
        chrome.runtime.sendMessage({
            type: "XPATH_RESULT",
            mode: "SINGLE",
            xpath: xpath
        });
    }

    // コピー成功時の視覚フィードバック（一瞬だけ緑色を表示）
    function showCopyFeedback() {
        if (!overlayElement) {
            return;
        }
        // 緑色を表示
        overlayElement.style.borderColor = "#00FF00";
        overlayElement.style.backgroundColor = "rgba(0, 255, 0, 0.3)";
        // 300ms 後に透明に戻す
        setTimeout(function() {
            if (overlayElement) {
                overlayElement.style.borderColor = "transparent";
                overlayElement.style.backgroundColor = "transparent";
            }
        }, 300);
    }

    // エラー時の視覚フィードバック（赤色）
    function showErrorFeedback() {
        if (!overlayElement) {
            return;
        }
        overlayElement.style.borderColor = "#FF0000";
        overlayElement.style.backgroundColor = "rgba(255, 0, 0, 0.25)";
        setTimeout(function() {
            if (overlayElement) {
                overlayElement.style.borderColor = "transparent";
                overlayElement.style.backgroundColor = "transparent";
            }
        }, 450);
    }

    // フォールバック: execCommand でコピー
    function fallbackCopyToClipboard(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;";

        const parent = document.body || document.documentElement;
        if (!parent) {
            console.error("コピー先となるDOMルートが見つかりません");
            return;
        }

        parent.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            showCopyFeedback();
        } catch (e) {
            console.error("フォールバックコピーも失敗:", e);
        }
        if (textarea.parentNode) {
            textarea.parentNode.removeChild(textarea);
        }
    }

    // ダブルクリック時: 選択モードを終了
    function handleDblClick(event) {
        if (!selectionModeEnabled) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        stopSelectionMode();
    }

    // 絶対XPath(Full XPath)生成
    // target から親をたどり、各階層で tagName[index] を付与（例: /html[1]/body[1]/div[2]/span[3]）
    function getAbsoluteXPath(element) {
        if (!(element instanceof Element)) {
            return {xpath: null, error: "invalid-element"};
        }

        const rootNode = typeof element.getRootNode === "function" ? element.getRootNode() : null;
        if (typeof ShadowRoot !== "undefined" && rootNode instanceof ShadowRoot) {
            // Shadow DOM 内の要素は通常の XPath では表現できない
            return {xpath: null, error: "shadow-dom-not-supported"};
        }

        if (!document.documentElement || !document.documentElement.contains(element)) {
            return {xpath: null, error: "detached-element"};
        }

        const segments = [];
        let currentNode = element;
        while (currentNode && currentNode.nodeType === Node.ELEMENT_NODE) {
            const nodeName = getXPathNodeName(currentNode);
            const index = getSiblingIndexForXPath(currentNode);
            segments.unshift(nodeName + "[" + index + "]");
            currentNode = currentNode.parentElement;
        }

        if (segments.length === 0) {
            return {xpath: null, error: "empty-xpath"};
        }

        const xpath = "/" + segments.join("/");
        if (!isXPathResolvedToElement(xpath, element)) {
            return {xpath: null, error: "xpath-validation-failed"};
        }

        return {xpath: xpath, error: null};
    }

    function getXPathNodeName(element) {
        const htmlNamespace = "http://www.w3.org/1999/xhtml";
        const localName = element.localName || element.tagName || "*";

        if (element.namespaceURI && element.namespaceURI !== htmlNamespace) {
            const rawName = element.nodeName || localName;
            return "*[name()='" + rawName + "']";
        }

        return String(localName).toLowerCase();
    }

    function getSiblingIndexForXPath(element) {
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (isSameXPathElementType(sibling, element)) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }
        return index;
    }

    function isSameXPathElementType(left, right) {
        return left.localName === right.localName && left.namespaceURI === right.namespaceURI;
    }

    function isXPathResolvedToElement(xpath, element) {
        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return !!result && result.singleNodeValue === element;
        } catch (e) {
            console.warn("XPath評価エラー:", e);
            return false;
        }
    }

    // popup.js からのメッセージ受付
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (!message || typeof message.type !== "string") {
            return;
        }
        if (message.type === "SET_SELECTION_MODE") {
            const enabled = !!message.enabled;
            if (enabled) {
                startSelectionMode();
            } else {
                stopSelectionMode();
            }
            return;
        }
        if (message.type === "GET_SELECTION_STATE") {
            // popup.js が初期化時に現在の選択モード状態を問い合わせる
            sendResponse({enabled: selectionModeEnabled});
            return true;
        }
    });
}
