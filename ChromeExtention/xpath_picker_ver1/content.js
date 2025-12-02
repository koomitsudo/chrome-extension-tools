// このファイルはcontent_scriptsとして全フレームに挿入される。
// background.jsからのメッセージで「選択モード」のON/OFFを切り替え、
// ONのときはページ上のクリックを捕捉して、
// クリックされた要素の絶対XPathを計算しクリップボードにコピーし、
// さらに対象要素に0.3秒間の黄色いオーバーレイを表示する。

// 現在選択モードかどうかを保持するフラグ。
let selectionModeEnabled = false;

// クリックイベントリスナーを保持しておき、OFFにする際にremoveEventListenerする。
let clickListener = null;

// 画面右上にコピー結果などを表示するための簡易トースト要素を管理する。
let toastElement = null;

// background.jsからのメッセージを受け取るリスナー。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
        return;
    }
    if (message.type === "xpathpicker_enable") {
        enableSelectionMode();
    } else if (message.type === "xpathpicker_disable") {
        disableSelectionMode();
    }
});

// 選択モードをONにする処理。
// すでにONなら何もしない。
function enableSelectionMode() {
    if (selectionModeEnabled) {
        return;
    }
    selectionModeEnabled = true;

    // キャプチャフェーズでクリックを捕捉し、ページ本来のクリックを止める。
    clickListener = function(event) {
        // 選択モードがOFFにされていたら何もしない。
        if (!selectionModeEnabled) {
            return;
        }

        // ページ本来のクリック動作（リンク遷移やボタン動作など）を止める。
        event.preventDefault();
        event.stopPropagation();

        // 実際にハンドリングするターゲット要素を決める。
        // クリックターゲットがテキストノードなど非HTMLElementの場合は親要素を使う。
        let target = event.target;
        if (!target) {
            cleanUpAfterSelection();
            return;
        }
        if (target.nodeType !== Node.ELEMENT_NODE) {
            target = target.parentElement;
        }
        if (!target || target.nodeType !== Node.ELEMENT_NODE) {
            cleanUpAfterSelection();
            return;
        }

        // 対象要素の位置とサイズを取得し、黄色いオーバーレイを0.3秒表示する。
        highlightElement(target);

        // 対象要素の絶対XPathを計算する。
        const xpath = computeFullXPath(target);

        // クリップボードにコピーを試みる。
        copyTextToClipboard(xpath).then(() => {
            // 成功時はトーストで通知する。
            showToast("XPath copied", false);
        }).catch(() => {
            // 失敗時もトーストで通知する。
            showToast("Copy failed", true);
        }).finally(() => {
            // 一度のクリックで終了する仕様なので必ずOFFにする。
            cleanUpAfterSelection();
        });
    };

    // ドキュメント全体にクリックリスナーをキャプチャフェーズで登録する。
    window.addEventListener("click", clickListener, true);
}

// 選択モードをOFFにする処理。
// リスナーを解除し、フラグを落とす。
function disableSelectionMode() {
    selectionModeEnabled = false;
    if (clickListener) {
        window.removeEventListener("click", clickListener, true);
        clickListener = null;
    }
}

// 一度のクリック処理が終わったあとの共通クリーンアップ処理。
// 選択モードをOFFにしてリスナーも外す。
function cleanUpAfterSelection() {
    disableSelectionMode();
}

// 絶対XPathを計算する関数。
// DevToolsの「Copy full XPath」と同様に、/html/body/... のように
// /タグ名[インデックス] を連結してルートまでの絶対パスを生成する。
function computeFullXPath(element) {
    const segments = [];
    let el = element;
    while (el && el.nodeType === Node.ELEMENT_NODE) {
        const tagName = el.tagName.toLowerCase();
        let index = 1;
        let sibling = el.previousElementSibling;
        // 同じタグ名を持つ兄弟要素のうち、前方にある要素を数えてインデックスを決める。
        while (sibling) {
            if (sibling.tagName === el.tagName) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }
        segments.unshift(tagName + "[" + index + "]");
        el = el.parentElement;
    }
    // ルートからの絶対パスとして結合する。
    return "/" + segments.join("/");
}

// クリックされた要素の位置に固定配置のオーバーレイを表示する。
// 0.3秒後に自動的に削除する。
function highlightElement(element) {
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement("div");

    // オーバーレイのスタイルをインラインで指定する。
    // position:fixed にしてビューポート基準で描画し、スクロール位置に依存しないようにする。
    overlay.style.position = "fixed";
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.background = "rgba(255,230,0,0.35)";
    overlay.style.outline = "2px solid rgba(255,200,0,0.9)";
    overlay.style.borderRadius = "2px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "999999";

    // bodyに追加する。documentElementでも良いが、ここではbodyを採用する。
    const parent = document.body || document.documentElement;
    parent.appendChild(overlay);

    // 300ミリ秒経過後にオーバーレイを削除する。
    setTimeout(() => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }, 300);
}

// クリップボードにテキストを書き込む処理。
// まず navigator.clipboard.writeText を試み、
// 失敗した場合は document.execCommand("copy") を用いたフォールバックを試す。
function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        // まずClipboard APIを試す。これはユーザー操作中のイベントで呼び出される想定。
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                resolve();
            }).catch(() => {
                // Clipboard APIが失敗した場合はexecCommandでのフォールバックを試す。
                fallbackCopyText(text).then(resolve).catch(reject);
            });
        } else {
            // Clipboard APIが存在しない環境では直接フォールバックを試す。
            fallbackCopyText(text).then(resolve).catch(reject);
        }
    });
}

// execCommand("copy")を使ったフォールバックコピー処理。
// 一時的なtextareaを作成し、その内容を選択してコピーする。
function fallbackCopyText(text) {
    return new Promise((resolve, reject) => {
        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            // 視覚的な影響を最小化するため、画面外に配置する。
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            textarea.style.top = "0";
            const parent = document.body || document.documentElement;
            parent.appendChild(textarea);
            textarea.focus();
            textarea.select();

            const successful = document.execCommand("copy");
            parent.removeChild(textarea);

            if (successful) {
                resolve();
            } else {
                reject(new Error("execCommand copy failed"));
            }
        } catch (e) {
            reject(e);
        }
    });
}

// コピー成否などをユーザーに知らせる簡易トーストを表示する。
// errorがtrueの場合は背景色を少し赤寄りにする。
function showToast(message, error) {
    // 既存のトーストがあれば削除してから新しく作る。
    if (toastElement && toastElement.parentNode) {
        toastElement.parentNode.removeChild(toastElement);
    }

    toastElement = document.createElement("div");
    toastElement.textContent = message;
    toastElement.style.position = "fixed";
    toastElement.style.top = "12px";
    toastElement.style.right = "12px";
    toastElement.style.padding = "6px 10px";
    toastElement.style.fontSize = "12px";
    toastElement.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    toastElement.style.color = "#000000";
    toastElement.style.background = error ? "rgba(255,200,200,0.9)" : "rgba(255,255,200,0.9)";
    toastElement.style.border = "1px solid rgba(0,0,0,0.15)";
    toastElement.style.borderRadius = "4px";
    toastElement.style.zIndex = "1000000";
    toastElement.style.pointerEvents = "none";
    const parent = document.body || document.documentElement;
    parent.appendChild(toastElement);

    // 約1.2秒後に自動的に消す。
    setTimeout(() => {
        if (toastElement && toastElement.parentNode) {
            toastElement.parentNode.removeChild(toastElement);
            toastElement = null;
        }
    }, 1200);
}
