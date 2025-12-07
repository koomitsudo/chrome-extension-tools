// LLM APIとの通信と、API設定の読み出しを担当する。機密情報(APIキーやマスク前テキスト)を外部へ出力しないよう注意。

// 非同期でchrome.storageから設定値を取得するユーティリティ関数
async function getSettings() {
    const syncPromise = new Promise((resolve) => {
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
                resolve(items);
            }
        );
    });
    const localPromise = new Promise((resolve) => {
        chrome.storage.local.get(
            {
                apiKey: ""
            },
            (items) => {
                resolve(items);
            }
        );
    });
    const results = await Promise.all([syncPromise, localPromise]);
    const syncItems = results[0];
    const localItems = results[1];
    return {
        apiBaseUrl: syncItems.apiBaseUrl || "",
        apiModel: syncItems.apiModel || "",
        purposes: Array.isArray(syncItems.purposes) && syncItems.purposes.length > 0 ? syncItems.purposes : [
            "請求書送付",
            "入金確認",
            "督促",
            "一般的なお礼"
        ],
        // apiKeyは同期されないlocalストレージからのみ取得する
        apiKey: localItems.apiKey || ""
    };
}

// LLM APIに対してリクエストを送信する関数
// payloadには maskedText, purpose, memo が含まれる
async function callLlmApi(settings, payload) {
    const apiBaseUrl = (settings.apiBaseUrl || "").trim();
    const apiModel = (settings.apiModel || "").trim();
    const apiKey = (settings.apiKey || "").trim();
    if (!apiBaseUrl || !apiModel || !apiKey) {
        // 設定不足の場合はエラーを投げる
        throw new Error("API設定が不足しています。オプションページでAPIベースURL、モデル名、APIキーを設定してください。");
    }

    // ベースURLの末尾スラッシュを除去し、/chat/completions を付与
    const endpoint = apiBaseUrl.replace(/\/+$/, "") + "/chat/completions";

    // SystemプロンプトとUserプロンプトを組み立てる
    // ここでは [EMAIL] や [PHONE] などのトークンを維持したまま自然な日本語ビジネスメールを生成するよう指示する
    const systemPrompt = "あなたは日本語のビジネスメールのプロフェッショナルアシスタントです。与えられた用途・マスク済み本文・補足指示に基づき、日本語の丁寧なビジネスメール本文のみを出力してください。[EMAIL] や [PHONE] などのマスクトークンはそのまま維持して、再度具体的な個人情報に復元してはいけません。署名は含めず、本文のみを生成してください。";
    const userPromptLines = [];
    userPromptLines.push("用途: " + (payload.purpose || ""));
    userPromptLines.push("元テキスト(マスク済み):");
    userPromptLines.push(payload.maskedText || "");
    if (payload.memo && payload.memo.trim().length > 0) {
        userPromptLines.push("補足指示:");
        userPromptLines.push(payload.memo.trim());
    }
    const userPrompt = userPromptLines.join("\n");

    // OpenAI互換のChat Completions APIを想定したリクエストボディ
    const body = {
        model: apiModel,
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: userPrompt
            }
        ],
        temperature: 0.2
    };

    // タイムアウト付きのfetchを実装する
    const controller = new AbortController();
    const timeoutMs = 30000;
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // AuthorizationヘッダにAPIキーを設定するが、ログ等には絶対に出力しない
                "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            // レスポンスボディにキーが含まれる可能性があるため、そのままは返さない
            throw new Error("LLM APIエラー: HTTP " + response.status);
        }

        const data = await response.json();
        // OpenAI互換形式を想定し、choices[0].message.contentから本文を取得する
        if (!data || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0].message) {
            throw new Error("LLM API応答形式が想定外です。");
        }
        const content = data.choices[0].message.content || "";
        return content.trim();
    } catch (e) {
        // エラーメッセージにはAPIキーや元テキストを含めない
        if (e.name === "AbortError") {
            throw new Error("LLM API呼び出しがタイムアウトしました。");
        }
        throw new Error(e.message || "LLM API呼び出し中にエラーが発生しました。");
    } finally {
        clearTimeout(timeoutId);
    }
}

// コンテントスクリプトからのメッセージを受け取り、LLM APIを呼び出して結果を返す
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "generateReply") {
        // 非同期処理を行うためtrueを返す
        (async () => {
            try {
                const settings = await getSettings();
                // mask前のoriginalTextはここには送られてこない設計とし、
                // 機密情報はマスクされた形でのみ外部送信する。
                const replyText = await callLlmApi(settings, {
                    maskedText: message.maskedText || "",
                    purpose: message.purpose || "",
                    memo: message.memo || ""
                });
                sendResponse({
                    success: true,
                    replyText: replyText
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || "不明なエラーが発生しました。"
                });
            }
        })();
        return true;
    }
    return false;
});
