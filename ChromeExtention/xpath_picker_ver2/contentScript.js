// contentScript.js
// ═══════════════════════════════════════════════════════════════════════════
// コンテンツスクリプト本体
// DOM操作、ハイライト、XPath取得、モード管理のすべてのロジックを担当
// プライバシー保護のため、データは変数のみで管理し永続化しない
// ═══════════════════════════════════════════════════════════════════════════

(function() {
    "use strict";

    // 重複注入防止フラグ
    // 一度注入されたら、再度実行されても初期化をスキップする
    if (window.__xpathPickerInjected) {
        return;
    }
    window.__xpathPickerInjected = true;

    // ═══════════════════════════════════════════════════════════════════════
    // 状態管理用の変数群（メモリ上のみで管理、永続化なし）
    // ═══════════════════════════════════════════════════════════════════════

    // 拡張機能が有効かどうか
    let isActive = false;

    // 現在のモード: "none" | "single" | "vertical" | "horizontal" | "table"
    let currentMode = "none";

    // クリックされた要素の履歴（最大2つまで保持）
    let clickedElements = [];

    // クリックされた要素のXPath履歴
    let clickedXPaths = [];

    // 現在ハイライトされている要素群
    let highlightedElements = [];

    // 取得したテキストデータ
    // 単一モード: string
    // 縦/横モード: string[]
    // 表モード: string[][]
    let extractedData = null;

    // 推定されたXPathパターン（表示用）
    let xpathPattern = "";

    // フローティングパネルのDOM要素
    let panelElement = null;

    // イベントリスナーの参照（解除用に保持）
    let clickHandler = null;
    let dblClickHandler = null;

    // ═══════════════════════════════════════════════════════════════════════
    // XPathユーティリティ関数群
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // 要素から絶対XPathを生成する
    // 形式: /html/body/div[1]/div[2]/span[1] のような文字列を返す
    // ───────────────────────────────────────────────────────────────────────
    function getXPathForElement(element) {
        // テキストノードや非Element要素の場合は親を辿る
        if (element.nodeType !== Node.ELEMENT_NODE) {
            return "";
        }

        const segments = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            // ルート要素（html）に到達したら終了
            if (current === document.documentElement) {
                segments.unshift("/html");
                break;
            }

            const tagName = current.tagName.toLowerCase();

            // 同じタグ名を持つ兄弟要素の中でのインデックスを計算（1始まり）
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName.toLowerCase() === tagName) {
                    index++;
                }
                sibling = sibling.previousElementSibling;
            }

            // 同じタグ名の兄弟が他にもいるかチェック
            let hasSameTagSibling = false;
            sibling = current.nextElementSibling;
            while (sibling) {
                if (sibling.tagName.toLowerCase() === tagName) {
                    hasSameTagSibling = true;
                    break;
                }
                sibling = sibling.nextElementSibling;
            }

            // インデックスが1でも、同じタグの兄弟がいる場合はインデックスを付与
            // インデックスが2以上なら必ず付与
            if (index > 1 || hasSameTagSibling) {
                segments.unshift(`/${tagName}[${index}]`);
            } else {
                segments.unshift(`/${tagName}`);
            }

            current = current.parentElement;
        }

        return segments.join("");
    }

    // ───────────────────────────────────────────────────────────────────────
    // XPath文字列から要素を取得する
    // ───────────────────────────────────────────────────────────────────────
    function getElementByXPath(xpath) {
        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return result.singleNodeValue;
        } catch (e) {
            return null;
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // XPath文字列から複数の要素を取得する
    // ───────────────────────────────────────────────────────────────────────
    function getElementsByXPath(xpath) {
        const elements = [];
        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );
            for (let i = 0; i < result.snapshotLength; i++) {
                elements.push(result.snapshotItem(i));
            }
        } catch (e) {
            // XPath構文エラー等は無視
        }
        return elements;
    }

    // ───────────────────────────────────────────────────────────────────────
    // 2つのXPathを比較し、異なるインデックス部分を特定してパターンを生成する
    // 例: /html/body/div[1]/ul/li[1] と /html/body/div[1]/ul/li[2]
    //     → パターン: /html/body/div[1]/ul/li[*]
    //     → 可変インデックス位置の情報を返す
    // ───────────────────────────────────────────────────────────────────────
    function analyzeXPathPair(xpath1, xpath2) {
        // XPathをセグメントに分割する正規表現
        // 例: "/html/body/div[1]/span" → ["html", "body", "div[1]", "span"]
        const segmentRegex = /\/([^\/]+)/g;

        const segments1 = [];
        const segments2 = [];

        let match;
        while ((match = segmentRegex.exec(xpath1)) !== null) {
            segments1.push(match[1]);
        }
        segmentRegex.lastIndex = 0;
        while ((match = segmentRegex.exec(xpath2)) !== null) {
            segments2.push(match[1]);
        }

        // セグメント数が異なる場合は単純なパターン化が困難
        if (segments1.length !== segments2.length) {
            return null;
        }

        // 各セグメントを比較し、インデックス部分が異なる位置を探す
        const pattern = [];
        let variableIndex = -1;
        const indexRegex = /^(.+)\[(\d+)\]$/;

        for (let i = 0; i < segments1.length; i++) {
            const seg1 = segments1[i];
            const seg2 = segments2[i];

            if (seg1 === seg2) {
                // 完全一致ならそのまま
                pattern.push(seg1);
            } else {
                // インデックス部分だけが異なるか確認
                const m1 = indexRegex.exec(seg1);
                const m2 = indexRegex.exec(seg2);

                if (m1 && m2 && m1[1] === m2[1]) {
                    // タグ名が同じでインデックスだけが異なる
                    pattern.push(`${m1[1]}[*]`);
                    variableIndex = i;
                } else {
                    // タグ名自体が異なる場合はパターン化困難
                    return null;
                }
            }
        }

        if (variableIndex === -1) {
            return null;
        }

        return {
            pattern: "/" + pattern.join("/"),
            variableIndex: variableIndex,
            baseSegments: segments1.slice(0, variableIndex),
            variableTag: indexRegex.exec(segments1[variableIndex])[1],
            suffixSegments: segments1.slice(variableIndex + 1)
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // パターンに基づいて繰り返し要素を取得する
    // インデックスを1から順にインクリメントし、存在する要素をすべて収集
    // ───────────────────────────────────────────────────────────────────────
    function collectElementsByPattern(patternInfo) {
        const elements = [];
        let index = 1;
        const maxIterations = 1000; // 無限ループ防止

        while (index <= maxIterations) {
            // インデックスを具体的な数値に置き換えてXPathを構築
            const baseXPath = "/" + patternInfo.baseSegments.join("/");
            const variablePart = `/${patternInfo.variableTag}[${index}]`;
            const suffixXPath = patternInfo.suffixSegments.length > 0
                ? "/" + patternInfo.suffixSegments.join("/")
                : "";
            const xpath = baseXPath + variablePart + suffixXPath;

            const el = getElementByXPath(xpath);
            if (el) {
                elements.push(el);
                index++;
            } else {
                // 要素が見つからなくなったら終了
                break;
            }
        }

        return elements;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ハイライト関連の関数群
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // すべてのハイライトをクリアする
    // ───────────────────────────────────────────────────────────────────────
    function clearAllHighlights() {
        highlightedElements.forEach(el => {
            if (el && el.classList) {
                el.classList.remove("xpath-picker-highlight");
            }
        });
        highlightedElements = [];
    }

    // ───────────────────────────────────────────────────────────────────────
    // 指定された要素にハイライトを適用する
    // ───────────────────────────────────────────────────────────────────────
    function applyHighlight(element) {
        if (element && element.classList) {
            element.classList.add("xpath-picker-highlight");
            highlightedElements.push(element);
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // 複数の要素にハイライトを適用する
    // ───────────────────────────────────────────────────────────────────────
    function applyHighlights(elements) {
        elements.forEach(el => applyHighlight(el));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // フローティングパネル関連の関数群
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // フローティングパネルを作成または取得する
    // ───────────────────────────────────────────────────────────────────────
    function getOrCreatePanel() {
        if (panelElement && document.body.contains(panelElement)) {
            return panelElement;
        }

        panelElement = document.createElement("div");
        panelElement.className = "xpath-picker-panel";
        panelElement.innerHTML = `
            <div class="xpath-picker-panel-header">
                <span>XPath Picker 結果</span>
            </div>
            <div class="xpath-picker-panel-mode">モード: 未選択</div>
            <div class="xpath-picker-panel-xpath">XPath: -</div>
            <div class="xpath-picker-panel-content">要素をクリックしてください</div>
            <div class="xpath-picker-panel-hint">ダブルクリックで選択解除</div>
        `;

        document.body.appendChild(panelElement);
        return panelElement;
    }

    // ───────────────────────────────────────────────────────────────────────
    // フローティングパネルを削除する
    // ───────────────────────────────────────────────────────────────────────
    function removePanel() {
        if (panelElement && panelElement.parentNode) {
            panelElement.parentNode.removeChild(panelElement);
        }
        panelElement = null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // パネルの内容を更新する
    // ───────────────────────────────────────────────────────────────────────
    function updatePanel(mode, xpath, content) {
        const panel = getOrCreatePanel();

        const modeText = {
            "none": "未選択",
            "single": "単一要素",
            "vertical": "縦方向（1次元配列）",
            "horizontal": "横方向（1次元配列）",
            "table": "表（2次元配列）"
        };

        const modeEl = panel.querySelector(".xpath-picker-panel-mode");
        const xpathEl = panel.querySelector(".xpath-picker-panel-xpath");
        const contentEl = panel.querySelector(".xpath-picker-panel-content");

        if (modeEl) {
            modeEl.textContent = `モード: ${modeText[mode] || mode}`;
        }

        if (xpathEl) {
            xpathEl.textContent = `XPath: ${xpath || "-"}`;
        }

        if (contentEl) {
            contentEl.textContent = content || "(データなし)";
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // テキスト抽出関連の関数群
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // 要素からテキストを取得し、トリムして返す
    // ───────────────────────────────────────────────────────────────────────
    function getElementText(element) {
        if (!element) {
            return "";
        }
        // textContentを取得し、連続する空白を1つにまとめてトリム
        return (element.textContent || "").replace(/\s+/g, " ").trim();
    }

    // ───────────────────────────────────────────────────────────────────────
    // テーブル要素から2次元配列としてデータを抽出する
    // ───────────────────────────────────────────────────────────────────────
    function extractTableData(tableElement) {
        const data = [];
        const rows = tableElement.querySelectorAll("tr");

        rows.forEach(row => {
            const rowData = [];
            const cells = row.querySelectorAll("th, td");
            cells.forEach(cell => {
                rowData.push(getElementText(cell));
            });
            if (rowData.length > 0) {
                data.push(rowData);
            }
        });

        return data;
    }

    // ───────────────────────────────────────────────────────────────────────
    // 要素の最近傍のテーブル要素を探す
    // ───────────────────────────────────────────────────────────────────────
    function findNearestTable(element) {
        let current = element;
        while (current) {
            if (current.tagName && current.tagName.toLowerCase() === "table") {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // 要素の最近傍の行要素（tr）を探す
    // ───────────────────────────────────────────────────────────────────────
    function findNearestRow(element) {
        let current = element;
        while (current) {
            if (current.tagName && current.tagName.toLowerCase() === "tr") {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // 2つの要素の最近傍共通祖先を見つける
    // ───────────────────────────────────────────────────────────────────────
    function findCommonAncestor(el1, el2) {
        const ancestors1 = [];
        let current = el1;
        while (current) {
            ancestors1.push(current);
            current = current.parentElement;
        }

        current = el2;
        while (current) {
            if (ancestors1.includes(current)) {
                return current;
            }
            current = current.parentElement;
        }

        return document.body;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // モード判定と処理のメイン関数群
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // 単一要素モードの処理
    // ───────────────────────────────────────────────────────────────────────
    function handleSingleMode(element) {
        currentMode = "single";
        clearAllHighlights();

        const xpath = getXPathForElement(element);
        const text = getElementText(element);

        clickedElements = [element];
        clickedXPaths = [xpath];
        extractedData = text;
        xpathPattern = xpath;

        applyHighlight(element);
        updatePanel("single", xpath, text || "(空のテキスト)");
    }

    // ───────────────────────────────────────────────────────────────────────
    // 2回目のクリックの処理
    // 縦方向/横方向/テーブルモードを判定して適切な処理を行う
    // ───────────────────────────────────────────────────────────────────────
    function handleSecondClick(element) {
        const xpath1 = clickedXPaths[0];
        const xpath2 = getXPathForElement(element);
        const el1 = clickedElements[0];
        const el2 = element;

        // 同じ要素を再度クリックした場合は無視
        if (el1 === el2) {
            return;
        }

        clickedElements.push(el2);
        clickedXPaths.push(xpath2);

        // 1. テーブルセルの場合はテーブルモードを優先
        const table1 = findNearestTable(el1);
        const table2 = findNearestTable(el2);

        if (table1 && table1 === table2) {
            // 同じテーブル内の要素をクリックした場合
            handleTableMode(table1);
            return;
        }

        // 2. 同じ行内のセルなら横方向モード
        const row1 = findNearestRow(el1);
        const row2 = findNearestRow(el2);

        if (row1 && row1 === row2) {
            handleHorizontalMode(row1);
            return;
        }

        // 3. XPathパターン解析による縦方向モードの試行
        const patternInfo = analyzeXPathPair(xpath1, xpath2);

        if (patternInfo) {
            handleVerticalMode(patternInfo);
            return;
        }

        // 4. パターン解析が失敗した場合、共通祖先ベースで横方向を試みる
        const commonAncestor = findCommonAncestor(el1, el2);
        handleHorizontalModeByAncestor(commonAncestor, el1, el2);
    }

    // ───────────────────────────────────────────────────────────────────────
    // 縦方向モードの処理
    // XPathパターンに基づいて繰り返し要素を収集
    // ───────────────────────────────────────────────────────────────────────
    function handleVerticalMode(patternInfo) {
        currentMode = "vertical";
        clearAllHighlights();

        const elements = collectElementsByPattern(patternInfo);
        const texts = elements.map(el => getElementText(el));

        extractedData = texts;
        xpathPattern = patternInfo.pattern;

        applyHighlights(elements);

        // 改行区切りで表示
        const displayText = texts.length > 0
            ? texts.map((t, i) => `[${i + 1}] ${t}`).join("\n")
            : "(要素が見つかりません)";

        updatePanel("vertical", patternInfo.pattern, displayText);
    }

    // ───────────────────────────────────────────────────────────────────────
    // 横方向モードの処理（行要素ベース）
    // ───────────────────────────────────────────────────────────────────────
    function handleHorizontalMode(rowElement) {
        currentMode = "horizontal";
        clearAllHighlights();

        // 行内のすべてのセル（td, th）を取得
        const cells = rowElement.querySelectorAll("td, th");
        const elements = Array.from(cells);
        const texts = elements.map(el => getElementText(el));

        extractedData = texts;
        xpathPattern = getXPathForElement(rowElement) + "/*";

        applyHighlights(elements);

        // パイプ区切りで表示
        const displayText = texts.length > 0
            ? texts.join(" | ")
            : "(要素が見つかりません)";

        updatePanel("horizontal", xpathPattern, displayText);
    }

    // ───────────────────────────────────────────────────────────────────────
    // 横方向モードの処理（共通祖先ベース）
    // テーブル以外の構造で横方向に並ぶ要素を取得
    // ───────────────────────────────────────────────────────────────────────
    function handleHorizontalModeByAncestor(ancestor, el1, el2) {
        currentMode = "horizontal";
        clearAllHighlights();

        // el1とel2の直接の親で、ancestorの子孫となる要素を特定
        // 簡易実装として、ancestorの直接の子要素群を取得
        const children = Array.from(ancestor.children);
        const texts = children.map(el => getElementText(el)).filter(t => t.length > 0);

        if (texts.length > 0) {
            extractedData = texts;
            xpathPattern = getXPathForElement(ancestor) + "/*";
            applyHighlights(children);

            const displayText = texts.join(" | ");
            updatePanel("horizontal", xpathPattern, displayText);
        } else {
            // 子要素からテキストが取れない場合は単一モードにフォールバック
            handleSingleMode(el2);
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // テーブルモードの処理
    // テーブル全体を2次元配列として取得
    // ───────────────────────────────────────────────────────────────────────
    function handleTableMode(tableElement) {
        currentMode = "table";
        clearAllHighlights();

        const data = extractTableData(tableElement);
        extractedData = data;
        xpathPattern = getXPathForElement(tableElement);

        // テーブル全体をハイライト
        applyHighlight(tableElement);

        // 行ごとにパイプ区切りで表示
        let displayText = "";
        if (data.length > 0) {
            displayText = data.map((row, i) => {
                return `[行${i + 1}] ${row.join(" | ")}`;
            }).join("\n");
        } else {
            displayText = "(テーブルにデータがありません)";
        }

        updatePanel("table", xpathPattern, displayText);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // イベントハンドラ
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // クリックイベントのハンドラ
    // iframe/Shadow DOM内の要素は無視する
    // ───────────────────────────────────────────────────────────────────────
    function onClickHandler(event) {
        // パネル自体のクリックは無視
        if (panelElement && panelElement.contains(event.target)) {
            return;
        }

        // デフォルトの動作を抑制（リンクのナビゲーションなど）
        event.preventDefault();
        event.stopPropagation();

        const target = event.target;

        // iframe内の要素チェック（簡易版：iframe要素自体は選択可能だが、中身は不可）
        if (target.tagName && target.tagName.toLowerCase() === "iframe") {
            return;
        }

        // Shadow DOM内の要素チェック（簡易版）
        // getRootNode()がShadowRootを返す場合は無視
        if (target.getRootNode && target.getRootNode() instanceof ShadowRoot) {
            return;
        }

        // クリック履歴に基づいてモードを決定
        if (clickedElements.length === 0) {
            // 1回目のクリック → 単一要素モード
            handleSingleMode(target);
        } else if (clickedElements.length === 1) {
            // 2回目のクリック → 縦/横/テーブルモードを判定
            handleSecondClick(target);
        } else {
            // 3回目以降のクリック → リセットして単一モードから再開
            resetSelection();
            handleSingleMode(target);
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // ダブルクリックイベントのハンドラ
    // 選択状態をリセットする
    // ───────────────────────────────────────────────────────────────────────
    function onDblClickHandler(event) {
        // パネル自体のダブルクリックは無視
        if (panelElement && panelElement.contains(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        resetSelection();
    }

    // ───────────────────────────────────────────────────────────────────────
    // 選択状態を完全にリセットする
    // ───────────────────────────────────────────────────────────────────────
    function resetSelection() {
        clearAllHighlights();
        currentMode = "none";
        clickedElements = [];
        clickedXPaths = [];
        extractedData = null;
        xpathPattern = "";

        updatePanel("none", "-", "要素をクリックしてください");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 拡張機能の有効化/無効化
    // ═══════════════════════════════════════════════════════════════════════

    // ───────────────────────────────────────────────────────────────────────
    // 拡張機能を有効化する（イベントリスナー登録、パネル表示）
    // ───────────────────────────────────────────────────────────────────────
    function activate() {
        if (isActive) {
            return;
        }

        isActive = true;

        // イベントリスナーを登録
        // captureフェーズで捕捉することで、他のクリックハンドラより先に処理
        clickHandler = onClickHandler;
        dblClickHandler = onDblClickHandler;

        document.addEventListener("click", clickHandler, true);
        document.addEventListener("dblclick", dblClickHandler, true);

        // パネルを表示
        getOrCreatePanel();
        updatePanel("none", "-", "要素をクリックしてください");
    }

    // ───────────────────────────────────────────────────────────────────────
    // 拡張機能を無効化する（クリーンアップ）
    // すべてのデータを破棄し、UIを削除する
    // ───────────────────────────────────────────────────────────────────────
    function deactivate() {
        if (!isActive) {
            return;
        }

        isActive = false;

        // イベントリスナーを解除
        if (clickHandler) {
            document.removeEventListener("click", clickHandler, true);
            clickHandler = null;
        }
        if (dblClickHandler) {
            document.removeEventListener("dblclick", dblClickHandler, true);
            dblClickHandler = null;
        }

        // ハイライトをクリア
        clearAllHighlights();

        // パネルを削除
        removePanel();

        // データをクリア（プライバシー保護）
        currentMode = "none";
        clickedElements = [];
        clickedXPaths = [];
        extractedData = null;
        xpathPattern = "";
    }

    // ═══════════════════════════════════════════════════════════════════════
    // メッセージリスナー（Service Workerからの指示を受け取る）
    // ═══════════════════════════════════════════════════════════════════════

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "activate") {
            activate();
            sendResponse({ success: true });
        } else if (message.action === "deactivate") {
            deactivate();
            sendResponse({ success: true });
        }
        return false;
    });

})();