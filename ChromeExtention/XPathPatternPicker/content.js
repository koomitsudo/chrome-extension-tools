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
        const xpath = getAbsoluteXPath(target);

        // クリップボードに自動コピー
        navigator.clipboard.writeText(xpath).then(function() {
            // コピー成功時: 一瞬だけ緑色を表示
            showCopyFeedback();
        }).catch(function(error) {
            console.error("クリップボードへのコピーに失敗:", error);
            // フォールバック: execCommand を試す
            fallbackCopyToClipboard(xpath);
        });

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

    // フォールバック: execCommand でコピー
    function fallbackCopyToClipboard(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            showCopyFeedback();
        } catch (e) {
            console.error("フォールバックコピーも失敗:", e);
        }
        document.body.removeChild(textarea);
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
    // target から親をたどり、各階層で tagName[index] を付与（ 例: /html[1]/body[1]/div[2]/span[3]
    function getAbsoluteXPath(element) {
        const segments = [];
        let currentNode = element;
        while (currentNode && currentNode.nodeType === Node.ELEMENT_NODE) {
            const tagName = currentNode.tagName.toLowerCase();
            let index = 1;
            let sibling = currentNode.previousElementSibling;
            while (sibling) {
                if (sibling.tagName.toLowerCase() === tagName) {
                    index++;
                }
                sibling = sibling.previousElementSibling;
            }
            const segment = tagName + "[" + index + "]";
            segments.unshift(segment);
            currentNode = currentNode.parentElement;
        }
        const xpath = "/" + segments.join("/");
        return xpath;
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