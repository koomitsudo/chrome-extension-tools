// GmailのDOMにボタンとモーダルUIを埋め込み、テキスト取得とPIIマスキング、LLM呼び出し要求、返信欄への挿入までを行う。
// PIIマスキング用のパターン定義
// 将来拡張しやすいよう、正規表現とプレースホルダを配列で管理する
const piiPatterns = [
    {
        // メールアドレス
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        placeholder: "[EMAIL]"
    },
    {
        // 日本の電話番号を大まかに想定(0から始まり、ハイフンあり/なし)
        pattern: /\b0\d{1,4}[-]?\d{1,4}[-]?\d{3,4}\b/g,
        placeholder: "[PHONE]"
    },
    {
        // 日本の郵便番号(例: 123-4567)
        pattern: /\b\d{3}-\d{4}\b/g,
        placeholder: "[ZIP]"
    },
    {
        // クレジットカード番号らしき13〜16桁の連続数字
        pattern: /\b\d{13,16}\b/g,
        placeholder: "[CARD]"
    }
];

// テキスト中のPIIをマスクする関数
function maskPii(text) {
    let result = text || "";
    for (let i = 0; i < piiPatterns.length; i++) {
        const rule = piiPatterns[i];
        result = result.replace(rule.pattern, rule.placeholder);
    }
    return result;
}

// Gmailスレッド内の直近の受信メッセージ本文を簡易的に取得する関数
// クラス名や属性は将来変わる可能性があるため、あくまで簡易ロジックとする
function getLastMessageBodyText() {
    // role="listitem"配下のdir="ltr"のdivをメッセージ本文候補とみなす
    const candidates = document.querySelectorAll('div[role="listitem"] div[dir="ltr"]');
    for (let i = candidates.length - 1; i >= 0; i--) {
        const el = candidates[i];
        const text = (el.innerText || "").trim();
        if (text.length > 0) {
            return text;
        }
    }
    return "";
}

// 現在の選択テキストを取得する関数
function getSelectedText() {
    const selection = window.getSelection();
    if (!selection) {
        return "";
    }
    const text = selection.toString();
    return (text || "").trim();
}

// Gmailの返信入力欄(contenteditable)を探す関数
// 日本語/英語環境両対応をおおまかに想定し、aria-labelを利用する
function findMessageBodyElements() {
    const selectors = [
        'div[aria-label="メッセージ本文"]',
        'div[aria-label="Message body"]'
    ];
    const elements = [];
    for (let i = 0; i < selectors.length; i++) {
        const nodeList = document.querySelectorAll(selectors[i]);
        for (let j = 0; j < nodeList.length; j++) {
            const el = nodeList[j];
            if (el.isContentEditable) {
                elements.push(el);
            }
        }
    }
    return elements;
}

// 対象の返信入力欄にAI返信ボタンを設置する
function ensureButtons() {
    const bodyElements = findMessageBodyElements();
    for (let i = 0; i < bodyElements.length; i++) {
        const bodyEl = bodyElements[i];
        if (bodyEl.dataset.aiReplyButtonAttached === "true") {
            continue;
        }
        // 同じ親要素内にボタンを追加する
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "AI返信";
        button.className = "ai-reply-button";
        button.addEventListener("click", () => {
            openAiReplyModal(bodyEl);
        });
        // 親要素の末尾にボタンを挿入する
        if (bodyEl.parentElement) {
            bodyEl.parentElement.appendChild(button);
        } else {
            bodyEl.insertAdjacentElement("afterend", button);
        }
        bodyEl.dataset.aiReplyButtonAttached = "true";
    }
}

// モーダルUIを表示する関数
function openAiReplyModal(targetEditable) {
    // 既存モーダルがあれば除去
    const existingOverlay = document.getElementById("ai-reply-modal-overlay");
    if (existingOverlay && existingOverlay.parentNode) {
        existingOverlay.parentNode.removeChild(existingOverlay);
    }

    // ベーステキストを決定(優先: 選択テキスト、次に直近メッセージ本文)
    let baseText = getSelectedText();
    if (!baseText) {
        baseText = getLastMessageBodyText();
    }

    // オーバーレイ生成
    const overlay = document.createElement("div");
    overlay.id = "ai-reply-modal-overlay";
    overlay.className = "ai-reply-modal-overlay";

    // モーダル本体
    const modal = document.createElement("div");
    modal.className = "ai-reply-modal";

    // タイトル
    const title = document.createElement("div");
    title.className = "ai-reply-modal-title";
    title.textContent = "AI返信生成";

    // プレビューエリア(読み取り専用)
    const previewLabel = document.createElement("label");
    previewLabel.className = "ai-reply-label";
    previewLabel.textContent = "元テキストプレビュー(送信前にPIIがマスクされます):";

    const previewTextarea = document.createElement("textarea");
    previewTextarea.className = "ai-reply-textarea ai-reply-preview";
    previewTextarea.readOnly = true;
    previewTextarea.value = baseText || "";

    // 用途セレクト
    const purposeLabel = document.createElement("label");
    purposeLabel.className = "ai-reply-label";
    purposeLabel.textContent = "用途:";

    const purposeSelect = document.createElement("select");
    purposeSelect.className = "ai-reply-select";

    // 用途プリセットをstorageから取得し、セレクトに設定する
    chrome.storage.sync.get(
        {
            purposes: [
                "請求書送付",
                "入金確認",
                "督促",
                "一般的なお礼"
            ]
        },
        (items) => {
            const purposes = Array.isArray(items.purposes) && items.purposes.length > 0
                ? items.purposes
                : [
                    "請求書送付",
                    "入金確認",
                    "督促",
                    "一般的なお礼"
                ];
            for (let i = 0; i < purposes.length; i++) {
                const opt = document.createElement("option");
                opt.value = purposes[i];
                opt.textContent = purposes[i];
                purposeSelect.appendChild(opt);
            }
        }
    );

    // 補足メモ
    const memoLabel = document.createElement("label");
    memoLabel.className = "ai-reply-label";
    memoLabel.textContent = "補足メモ(トーンや条件など):";

    const memoTextarea = document.createElement("textarea");
    memoTextarea.className = "ai-reply-textarea ai-reply-memo";
    memoTextarea.placeholder = "例: できるだけ柔らかく、期日だけは強めにお願いしたい など";

    // ボタンエリア
    const buttonRow = document.createElement("div");
    buttonRow.className = "ai-reply-button-row";

    const generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.className = "ai-reply-primary-button";
    generateButton.textContent = "生成";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ai-reply-secondary-button";
    cancelButton.textContent = "キャンセル";

    // ステータスメッセージ表示用
    const statusDiv = document.createElement("div");
    statusDiv.className = "ai-reply-status";

    cancelButton.addEventListener("click", () => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    });

    generateButton.addEventListener("click", () => {
        const originalText = previewTextarea.value || "";
        // originalTextは拡張機能内でのみ利用し、外部送信には使わない
        const maskedText = maskPii(originalText);
        const purpose = purposeSelect.value || "";
        const memo = memoTextarea.value || "";

        if (!maskedText && !memo) {
            statusDiv.textContent = "元テキストまたはメモのいずれかは入力してください。";
            return;
        }

        generateButton.disabled = true;
        cancelButton.disabled = true;
        statusDiv.textContent = "生成中...";

        // マスク済みテキスト、用途、メモのみをサービスワーカーへ送信する
        chrome.runtime.sendMessage(
            {
                type: "generateReply",
                maskedText: maskedText,
                purpose: purpose,
                memo: memo
            },
            (response) => {
                generateButton.disabled = false;
                cancelButton.disabled = false;

                if (chrome.runtime.lastError) {
                    statusDiv.textContent = "通信エラーが発生しました: " + chrome.runtime.lastError.message;
                    return;
                }
                if (!response || !response.success) {
                    statusDiv.textContent = (response && response.error) ? response.error : "返信生成に失敗しました。";
                    return;
                }

                const replyText = response.replyText || "";
                if (!replyText) {
                    statusDiv.textContent = "空の返信が生成されました。";
                    return;
                }

                insertTextAtCursor(targetEditable, replyText);

                // 挿入後はモーダルを閉じる
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }
        );
    });

    // DOM構築
    buttonRow.appendChild(generateButton);
    buttonRow.appendChild(cancelButton);

    modal.appendChild(title);
    modal.appendChild(previewLabel);
    modal.appendChild(previewTextarea);
    modal.appendChild(purposeLabel);
    modal.appendChild(purposeSelect);
    modal.appendChild(memoLabel);
    modal.appendChild(memoTextarea);
    modal.appendChild(buttonRow);
    modal.appendChild(statusDiv);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// contenteditable要素のカーソル位置にテキストを挿入する関数
function insertTextAtCursor(editableEl, text) {
    if (!editableEl) {
        return;
    }
    editableEl.focus();
    const selection = window.getSelection();
    if (!selection) {
        editableEl.innerText += text;
        return;
    }
    if (selection.rangeCount === 0) {
        const range = document.createRange();
        range.selectNodeContents(editableEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    let range = selection.getRangeAt(0);
    if (!editableEl.contains(range.startContainer)) {
        const newRange = document.createRange();
        newRange.selectNodeContents(editableEl);
        newRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(newRange);
        range = newRange;
    }
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
}

// 定期的に返信入力欄を探索してボタン設置を試みる
// GmailはSPA的な構造のため、MutationObserverでは取りこぼす可能性があるため、簡易的にsetIntervalを用いる
setInterval(() => {
    try {
        ensureButtons();
    } catch (e) {
        // エラーは握りつぶすが、PIIやAPIキーはここで扱っていないためセキュリティ上の問題はない
    }
}, 3000);
