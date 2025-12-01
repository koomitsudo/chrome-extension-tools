/**
 * このファイルはWebページ上で動作するコンテンツスクリプトです。
 * 主な機能:
 * 1. 要素のクリック検出とハイライト表示
 * 2. XPathの自動生成
 * 3. 複数要素からのパターン認識（1次元・2次元配列）
 * 4. パターンに基づく全要素の自動検出
 * 5. テキストデータの抽出
 */

// ========================================
// グローバル状態管理
// ========================================

// 選択モードがアクティブかどうか
let isSelectionModeActive = false;

// 選択された要素とそのXPathを保持する配列
// 各要素は { element: HTMLElement, xpath: string } の形式
let selectedElements = [];

// 検出されたパターン情報
// { type: 'single' | '1d' | '2d', xpath: string, variableIndices: number[] }
let detectedPattern = null;

// パターンに一致した全要素（ハイライト用）
let matchedElements = [];

// ハイライト用のオーバーレイ要素を管理するMap
const highlightOverlays = new Map();

// ========================================
// XPath生成関数
// ========================================

/**
 * DOM要素から絶対XPathを生成する
 * 
 * アルゴリズムの説明:
 * 1. 要素にIDがある場合は //*[@id="xxx"] 形式で短縮
 * 2. body要素に到達したら /html/body を返す
 * 3. それ以外は親要素のXPathに現在要素のタグ名とインデックスを追加
 *    インデックスは同じタグ名を持つ兄弟要素の中での位置（1始まり）
 * 
 * @param {HTMLElement} element - XPathを生成する対象の要素
 * @returns {string} 生成されたXPath文字列
 */
function generateXPath(element) {
    // ID属性がある場合は短縮形式を使用
    // ただし、パターン認識の精度を上げるため、絶対パスも併用できるようにする
    if (element.id && !element.id.match(/^\d/)) {
        // IDが数字で始まる場合は無効なXPathになるため除外
        return `//*[@id="${element.id}"]`;
    }
    
    // body要素に到達した場合
    if (element === document.body) {
        return "/html/body";
    }
    
    // documentまたはnullに到達した場合（異常系）
    if (!element || !element.parentNode || element === document.documentElement) {
        if (element === document.documentElement) {
            return "/html";
        }
        return "";
    }
    
    // 兄弟要素の中での位置を計算
    let index = 1;
    const siblings = element.parentNode.children;
    const tagName = element.tagName.toLowerCase();
    
    for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
            break;
        }
        if (sibling.tagName && sibling.tagName.toLowerCase() === tagName) {
            index++;
        }
    }
    
    // 同じタグ名の兄弟が1つしかない場合でもインデックスを付与
    // これはパターン認識を正確にするために必要
    const parentXPath = generateXPath(element.parentNode);
    return `${parentXPath}/${tagName}[${index}]`;
}

/**
 * ID参照を使わない完全な絶対XPathを生成する
 * パターン認識時の比較用に使用
 * 
 * @param {HTMLElement} element - XPathを生成する対象の要素
 * @returns {string} 生成された絶対XPath文字列
 */
function generateAbsoluteXPath(element) {
    if (element === document.body) {
        return "/html/body";
    }
    
    if (!element || !element.parentNode || element === document.documentElement) {
        if (element === document.documentElement) {
            return "/html";
        }
        return "";
    }
    
    let index = 1;
    const siblings = element.parentNode.children;
    const tagName = element.tagName.toLowerCase();
    
    for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
            break;
        }
        if (sibling.tagName && sibling.tagName.toLowerCase() === tagName) {
            index++;
        }
    }
    
    const parentXPath = generateAbsoluteXPath(element.parentNode);
    return `${parentXPath}/${tagName}[${index}]`;
}

// ========================================
// XPathパターン認識関数
// ========================================

/**
 * XPath文字列をセグメント（各階層の要素）に分割する
 * 
 * 例: "/html/body/div[1]/ul/li[3]/span" 
 *  → ["html", "body", "div[1]", "ul", "li[3]", "span"]
 * 
 * @param {string} xpath - 分割するXPath文字列
 * @returns {string[]} セグメントの配列
 */
function parseXPathToSegments(xpath) {
    // 先頭のスラッシュを除去し、スラッシュで分割
    const cleaned = xpath.replace(/^\/+/, "");
    return cleaned.split("/").filter((segment) => segment.length > 0);
}

/**
 * セグメントからタグ名とインデックスを抽出する
 * 
 * 例: "li[3]" → { tag: "li", index: 3 }
 *     "span" → { tag: "span", index: null }
 * 
 * @param {string} segment - パースするセグメント
 * @returns {{ tag: string, index: number|null }} パース結果
 */
function parseSegment(segment) {
    const match = segment.match(/^([a-zA-Z0-9_-]+)(?:\[(\d+)\])?$/);
    if (match) {
        return {
            tag: match[1],
            index: match[2] ? parseInt(match[2], 10) : null
        };
    }
    // ID参照形式のセグメントの場合
    const idMatch = segment.match(/^\*\[@id="([^"]+)"\]$/);
    if (idMatch) {
        return {
            tag: "*",
            index: null,
            id: idMatch[1]
        };
    }
    return { tag: segment, index: null };
}

/**
 * 2つのXPathを比較し、共通パターンと相違点を検出する
 * 
 * このアルゴリズムの動作:
 * 1. 両方のXPathをセグメントに分割
 * 2. 各セグメントを順に比較
 * 3. タグ名が同じでインデックスのみが異なる箇所を特定
 * 4. 相違箇所のインデックス位置を記録
 * 
 * @param {string} xpath1 - 比較する1つ目のXPath
 * @param {string} xpath2 - 比較する2つ目のXPath
 * @returns {{ pattern: string, variableIndices: number[], isValid: boolean }}
 */
function compareXPaths(xpath1, xpath2) {
    const segments1 = parseXPathToSegments(xpath1);
    const segments2 = parseXPathToSegments(xpath2);
    
    // セグメント数が異なる場合はパターン認識不可
    if (segments1.length !== segments2.length) {
        return { pattern: null, variableIndices: [], isValid: false };
    }
    
    const patternSegments = [];
    const variableIndices = [];
    
    for (let i = 0; i < segments1.length; i++) {
        const parsed1 = parseSegment(segments1[i]);
        const parsed2 = parseSegment(segments2[i]);
        
        // タグ名が異なる場合はパターン認識不可
        if (parsed1.tag !== parsed2.tag) {
            return { pattern: null, variableIndices: [], isValid: false };
        }
        
        // インデックスが異なる場合、その位置を可変として記録
        if (parsed1.index !== parsed2.index && parsed1.index !== null && parsed2.index !== null) {
            variableIndices.push(i);
            patternSegments.push(`${parsed1.tag}[*]`);
        } else if (parsed1.index !== null) {
            patternSegments.push(`${parsed1.tag}[${parsed1.index}]`);
        } else {
            patternSegments.push(parsed1.tag);
        }
    }
    
    // 相違点がない場合は同一要素（パターンなし）
    if (variableIndices.length === 0) {
        return { pattern: null, variableIndices: [], isValid: false };
    }
    
    const pattern = "/" + patternSegments.join("/");
    return { pattern, variableIndices, isValid: true };
}

/**
 * 3つ以上のXPathから2次元パターンを検出する
 * 
 * 2次元パターンの検出条件:
 * - 既存のパターンで1箇所が可変（例: li[*]）
 * - 新しい要素が既存パターンと別の箇所でも異なる（例: td[2] vs td[3]）
 * - 結果として2箇所以上が可変になる
 * 
 * @param {string} existingPattern - 既存のパターン
 * @param {number[]} existingVariableIndices - 既存の可変位置
 * @param {string} newXPath - 新しいXPath
 * @returns {{ pattern: string, variableIndices: number[], isValid: boolean, is2D: boolean }}
 */
function detect2DPattern(existingPattern, existingVariableIndices, newXPath) {
    const patternSegments = parseXPathToSegments(existingPattern);
    const newSegments = parseXPathToSegments(newXPath);
    
    if (patternSegments.length !== newSegments.length) {
        return { pattern: null, variableIndices: [], isValid: false, is2D: false };
    }
    
    const resultSegments = [];
    const resultVariableIndices = [...existingVariableIndices];
    let newVariableFound = false;
    
    for (let i = 0; i < patternSegments.length; i++) {
        const parsed1 = parseSegment(patternSegments[i]);
        const parsed2 = parseSegment(newSegments[i]);
        
        // タグ名が異なる場合は不一致
        if (parsed1.tag !== parsed2.tag) {
            return { pattern: null, variableIndices: [], isValid: false, is2D: false };
        }
        
        // 既に可変の位置はそのまま維持
        if (existingVariableIndices.includes(i)) {
            resultSegments.push(`${parsed1.tag}[*]`);
        }
        // 新たに異なるインデックスを発見した場合
        else if (parsed1.index !== null && parsed2.index !== null && parsed1.index !== parsed2.index) {
            resultVariableIndices.push(i);
            resultSegments.push(`${parsed1.tag}[*]`);
            newVariableFound = true;
        }
        // 同一のインデックス
        else if (parsed1.index !== null) {
            resultSegments.push(`${parsed1.tag}[${parsed1.index}]`);
        } else {
            resultSegments.push(parsed1.tag);
        }
    }
    
    // 新しい可変位置が見つからない場合は既存パターンのまま
    if (!newVariableFound) {
        return { pattern: existingPattern, variableIndices: existingVariableIndices, isValid: true, is2D: resultVariableIndices.length >= 2 };
    }
    
    const pattern = "/" + resultSegments.join("/");
    return { pattern, variableIndices: resultVariableIndices, isValid: true, is2D: resultVariableIndices.length >= 2 };
}

/**
 * 現在選択されている要素からパターンを検出・更新する
 * 
 * 選択要素数に応じた処理:
 * - 1要素: 単一要素モード（パターンなし）
 * - 2要素: 1次元パターン検出を試行
 * - 3要素以上: 2次元パターン検出を試行
 */
function updatePattern() {
    if (selectedElements.length === 0) {
        detectedPattern = null;
        matchedElements = [];
        return;
    }
    
    if (selectedElements.length === 1) {
        // 単一要素モード
        detectedPattern = {
            type: "single",
            xpath: selectedElements[0].xpath,
            variableIndices: []
        };
        matchedElements = [selectedElements[0].element];
        return;
    }
    
    // パターン認識用に絶対XPathを使用
    const absoluteXPaths = selectedElements.map((sel) => generateAbsoluteXPath(sel.element));
    
    if (selectedElements.length === 2) {
        // 2要素の比較で1次元パターンを検出
        const result = compareXPaths(absoluteXPaths[0], absoluteXPaths[1]);
        
        if (result.isValid) {
            detectedPattern = {
                type: result.variableIndices.length >= 2 ? "2d" : "1d",
                xpath: result.pattern,
                variableIndices: result.variableIndices
            };
            // パターンに一致する全要素を検出
            matchedElements = findMatchingElements(result.pattern);
        } else {
            // パターン認識失敗：複数選択として扱う
            detectedPattern = {
                type: "multiple",
                xpath: null,
                variableIndices: []
            };
            matchedElements = selectedElements.map((sel) => sel.element);
        }
    } else {
        // 3要素以上：既存パターンと新要素を比較して2次元パターンを検出
        let currentPattern = detectedPattern;
        
        // まだパターンがない場合は最初の2要素から生成
        if (!currentPattern || currentPattern.type === "multiple") {
            const initialResult = compareXPaths(absoluteXPaths[0], absoluteXPaths[1]);
            if (initialResult.isValid) {
                currentPattern = {
                    type: initialResult.variableIndices.length >= 2 ? "2d" : "1d",
                    xpath: initialResult.pattern,
                    variableIndices: initialResult.variableIndices
                };
            } else {
                detectedPattern = {
                    type: "multiple",
                    xpath: null,
                    variableIndices: []
                };
                matchedElements = selectedElements.map((sel) => sel.element);
                return;
            }
        }
        
        // 最新の要素とパターンを比較
        const latestXPath = absoluteXPaths[absoluteXPaths.length - 1];
        const result2D = detect2DPattern(currentPattern.xpath, currentPattern.variableIndices, latestXPath);
        
        if (result2D.isValid) {
            detectedPattern = {
                type: result2D.is2D ? "2d" : "1d",
                xpath: result2D.pattern,
                variableIndices: result2D.variableIndices
            };
            matchedElements = findMatchingElements(result2D.pattern);
        } else {
            // パターン更新失敗：既存パターンを維持
            matchedElements = findMatchingElements(currentPattern.xpath);
        }
    }
}

// ========================================
// 要素検索関数
// ========================================

/**
 * パターンXPathに一致する全要素を検出する
 * 
 * ワイルドカード [*] を含むパターンを実際のXPath評価に変換する
 * document.evaluate() はワイルドカードをサポートしないため、
 * 親要素から子要素を列挙する方式で実装
 * 
 * @param {string} pattern - ワイルドカードを含むパターンXPath
 * @returns {HTMLElement[]} 一致した要素の配列
 */
function findMatchingElements(pattern) {
    if (!pattern) {
        return [];
    }
    
    // パターンを解析してワイルドカードの位置を特定
    const segments = parseXPathToSegments(pattern);
    const wildcardIndices = [];
    
    segments.forEach((segment, index) => {
        if (segment.includes("[*]")) {
            wildcardIndices.push(index);
        }
    });
    
    if (wildcardIndices.length === 0) {
        // ワイルドカードがない場合は通常のXPath評価
        try {
            const result = document.evaluate(
                pattern,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
                elements.push(result.snapshotItem(i));
            }
            return elements;
        } catch (e) {
            console.error("XPath evaluation error:", e);
            return [];
        }
    }
    
    // ワイルドカードを含む場合は再帰的に要素を収集
    return collectElementsWithWildcard(segments, 0, document);
}

/**
 * ワイルドカードを含むセグメント配列から要素を再帰的に収集する
 * 
 * @param {string[]} segments - XPathセグメントの配列
 * @param {number} segmentIndex - 現在処理中のセグメントインデックス
 * @param {Node} currentNode - 現在のコンテキストノード
 * @returns {HTMLElement[]} 一致した要素の配列
 */
function collectElementsWithWildcard(segments, segmentIndex, currentNode) {
    // 全セグメントを処理し終えた場合、現在のノードが結果
    if (segmentIndex >= segments.length) {
        return currentNode !== document ? [currentNode] : [];
    }
    
    const segment = segments[segmentIndex];
    const parsed = parseSegment(segment.replace("[*]", "[1]")); // パース用に仮インデックス
    const isWildcard = segment.includes("[*]");
    
    let results = [];
    
    // 特殊ケース: html, body
    if (segment === "html" && currentNode === document) {
        return collectElementsWithWildcard(segments, segmentIndex + 1, document.documentElement);
    }
    if (segment === "body" && currentNode === document.documentElement) {
        return collectElementsWithWildcard(segments, segmentIndex + 1, document.body);
    }
    
    // 子要素を探索
    const children = currentNode.children || [];
    
    if (isWildcard) {
        // ワイルドカードの場合：同じタグ名の全ての子要素を対象
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.tagName && child.tagName.toLowerCase() === parsed.tag) {
                const subResults = collectElementsWithWildcard(segments, segmentIndex + 1, child);
                results = results.concat(subResults);
            }
        }
    } else {
        // 固定インデックスの場合：指定位置の要素のみ
        const targetIndex = parsed.index || 1;
        let count = 0;
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.tagName && child.tagName.toLowerCase() === parsed.tag) {
                count++;
                if (count === targetIndex) {
                    const subResults = collectElementsWithWildcard(segments, segmentIndex + 1, child);
                    results = results.concat(subResults);
                    break;
                }
            }
        }
    }
    
    return results;
}

// ========================================
// ハイライト表示関数
// ========================================

/**
 * 要素にハイライトオーバーレイを追加する
 * 
 * SVGやdiv要素ではなく、box-shadowとoutlineを使用することで
 * ページのレイアウトを崩さずにハイライトを表示する
 * 
 * @param {HTMLElement} element - ハイライトする要素
 * @param {string} type - ハイライトの種類 ("selected" | "matched")
 */
function addHighlight(element, type) {
    // 既存のハイライトを確認
    const existingOverlay = highlightOverlays.get(element);
    if (existingOverlay) {
        // タイプが同じなら何もしない
        if (existingOverlay.dataset.highlightType === type) {
            return;
        }
        // タイプが異なる場合は更新
        removeHighlight(element);
    }
    
    // オーバーレイ用のdiv要素を作成
    const overlay = document.createElement("div");
    overlay.className = "xpath-extractor-highlight";
    overlay.dataset.highlightType = type;
    
    // 要素の位置とサイズを取得
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    
    // オーバーレイのスタイルを設定
    overlay.style.cssText = `
        position: absolute;
        top: ${rect.top + scrollY}px;
        left: ${rect.left + scrollX}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        z-index: 2147483647;
        box-sizing: border-box;
    `;
    
    // タイプに応じた色を設定
    if (type === "selected") {
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.border = "2px solid #FFD700";
    } else if (type === "matched") {
        overlay.style.backgroundColor = "rgba(144, 238, 144, 0.25)";
        overlay.style.border = "1px dashed #32CD32";
    }
    
    // ドキュメントに追加
    document.body.appendChild(overlay);
    highlightOverlays.set(element, overlay);
}

/**
 * 要素からハイライトオーバーレイを削除する
 * 
 * @param {HTMLElement} element - ハイライトを削除する要素
 */
function removeHighlight(element) {
    const overlay = highlightOverlays.get(element);
    if (overlay) {
        overlay.remove();
        highlightOverlays.delete(element);
    }
}

/**
 * 全てのハイライトをクリアする
 */
function clearAllHighlights() {
    highlightOverlays.forEach((overlay) => {
        overlay.remove();
    });
    highlightOverlays.clear();
}

/**
 * 全ての選択状態をリセットする
 */
function clearAllSelections() {
    clearAllHighlights();
    selectedElements = [];
    detectedPattern = null;
    matchedElements = [];
    saveDataToStorage();
}

/**
 * 現在の状態に基づいて全てのハイライトを再描画する
 */
function refreshHighlights() {
    clearAllHighlights();
    
    // 選択された要素を黄色でハイライト
    selectedElements.forEach((sel) => {
        addHighlight(sel.element, "selected");
    });
    
    // パターンに一致した要素（選択されていないもの）を緑でハイライト
    matchedElements.forEach((element) => {
        const isSelected = selectedElements.some((sel) => sel.element === element);
        if (!isSelected) {
            addHighlight(element, "matched");
        }
    });
}

/**
 * ウィンドウのリサイズやスクロール時にハイライト位置を更新する
 */
function updateHighlightPositions() {
    highlightOverlays.forEach((overlay, element) => {
        const rect = element.getBoundingClientRect();
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        
        overlay.style.top = `${rect.top + scrollY}px`;
        overlay.style.left = `${rect.left + scrollX}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
    });
}

// ========================================
// データ抽出関数
// ========================================

/**
 * パターンに一致する全要素からテキストデータを抽出する
 * 
 * 抽出形式:
 * - 単一/複数選択: 1次元配列 ["text1", "text2", ...]
 * - 1次元パターン: 1次元配列 ["text1", "text2", ...]
 * - 2次元パターン: 2次元配列 [["r1c1", "r1c2"], ["r2c1", "r2c2"], ...]
 * 
 * @returns {{ data: string[] | string[][], patternInfo: object }}
 */
function extractData() {
    if (!detectedPattern || matchedElements.length === 0) {
        // 選択要素のテキストのみを返す
        const texts = selectedElements.map((sel) => {
            return normalizeText(sel.element.textContent);
        });
        return {
            data: texts,
            patternInfo: {
                type: "multiple",
                count: texts.length,
                xpath: null
            }
        };
    }
    
    if (detectedPattern.type === "2d") {
        // 2次元データの抽出
        return extract2DData();
    }
    
    // 1次元データの抽出
    const texts = matchedElements.map((element) => {
        return normalizeText(element.textContent);
    });
    
    return {
        data: texts,
        patternInfo: {
            type: detectedPattern.type,
            count: texts.length,
            xpath: detectedPattern.xpath
        }
    };
}

/**
 * 2次元パターンからマトリックス形式でデータを抽出する
 * 
 * @returns {{ data: string[][], patternInfo: object }}
 */
function extract2DData() {
    if (!detectedPattern || detectedPattern.variableIndices.length < 2) {
        return extractData(); // 1次元として処理
    }
    
    const segments = parseXPathToSegments(detectedPattern.xpath);
    const varIndices = detectedPattern.variableIndices;
    
    // 最初の可変インデックスを行、2番目を列として扱う
    const rowVarIndex = varIndices[0];
    const colVarIndex = varIndices[1];
    
    // 行ごとにデータを収集
    const rowElements = new Map();
    
    matchedElements.forEach((element) => {
        const elementXPath = generateAbsoluteXPath(element);
        const elementSegments = parseXPathToSegments(elementXPath);
        
        if (elementSegments.length !== segments.length) {
            return;
        }
        
        // 行のインデックスを取得
        const rowParsed = parseSegment(elementSegments[rowVarIndex]);
        const rowKey = rowParsed.index || 0;
        
        if (!rowElements.has(rowKey)) {
            rowElements.set(rowKey, []);
        }
        
        // 列のインデックスを取得
        const colParsed = parseSegment(elementSegments[colVarIndex]);
        const colKey = colParsed.index || 0;
        
        rowElements.get(rowKey).push({
            colIndex: colKey,
            text: normalizeText(element.textContent)
        });
    });
    
    // 行をソートして2次元配列を構築
    const sortedRowKeys = Array.from(rowElements.keys()).sort((a, b) => a - b);
    const matrix = sortedRowKeys.map((rowKey) => {
        const cols = rowElements.get(rowKey);
        cols.sort((a, b) => a.colIndex - b.colIndex);
        return cols.map((col) => col.text);
    });
    
    return {
        data: matrix,
        patternInfo: {
            type: "2d",
            rows: matrix.length,
            cols: matrix.length > 0 ? Math.max(...matrix.map((row) => row.length)) : 0,
            xpath: detectedPattern.xpath
        }
    };
}

/**
 * テキストを正規化する（改行・タブ・連続空白を整理）
 * 
 * @param {string} text - 正規化するテキスト
 * @returns {string} 正規化されたテキスト
 */
function normalizeText(text) {
    if (!text) {
        return "";
    }
    return text
        .replace(/[\r\n\t]+/g, " ") // 改行・タブを空白に
        .replace(/\s+/g, " ") // 連続空白を単一空白に
        .trim(); // 前後の空白を削除
}

// ========================================
// ストレージ操作関数
// ========================================

/**
 * 抽出データをChrome Storageに保存する
 */
function saveDataToStorage() {
    const extracted = extractData();
    const data = extracted.data;
    const patternInfo = extracted.patternInfo;
    
    chrome.runtime.sendMessage({
        action: "saveExtractedData",
        data: data,
        patternInfo: patternInfo
    }).catch(() => {
        // バックグラウンドスクリプトが応答しない場合は無視
    });
}

// ========================================
// イベントハンドラ
// ========================================

/**
 * 要素クリック時のハンドラ
 * 
 * @param {MouseEvent} event - クリックイベント
 */
function handleElementClick(event) {
    if (!isSelectionModeActive) {
        return;
    }
    
    // デフォルトのクリック動作をブロック
    event.preventDefault();
    event.stopPropagation();
    
    const element = event.target;
    
    // 自分自身のオーバーレイ要素は無視
    if (element.classList.contains("xpath-extractor-highlight")) {
        return;
    }
    
    // 既に選択されているかチェック
    const existingIndex = selectedElements.findIndex((sel) => sel.element === element);
    
    if (existingIndex !== -1) {
        // 選択済みの場合は何もしない（ダブルクリックで解除）
        return;
    }
    
    // 新しい要素を選択
    const xpath = generateXPath(element);
    selectedElements.push({ element: element, xpath: xpath });
    
    // パターンを更新
    updatePattern();
    
    // ハイライトを再描画
    refreshHighlights();
    
    // データを保存
    saveDataToStorage();
    
    console.log(`[XPath Extractor] Selected: ${xpath}`);
    if (detectedPattern) {
        console.log(`[XPath Extractor] Pattern: ${detectedPattern.type}, XPath: ${detectedPattern.xpath}`);
    }
}

/**
 * 要素ダブルクリック時のハンドラ（選択解除）
 * 
 * @param {MouseEvent} event - ダブルクリックイベント
 */
function handleElementDoubleClick(event) {
    if (!isSelectionModeActive) {
        return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const element = event.target;
    
    // 選択リストから削除
    const index = selectedElements.findIndex((sel) => sel.element === element);
    if (index !== -1) {
        selectedElements.splice(index, 1);
        
        // パターンを更新
        updatePattern();
        
        // ハイライトを再描画
        refreshHighlights();
        
        // データを保存
        saveDataToStorage();
        
        console.log("[XPath Extractor] Deselected element");
    }
}

/**
 * キーボードイベントハンドラ
 * 
 * @param {KeyboardEvent} event - キーボードイベント
 */
function handleKeyDown(event) {
    // Escキーで選択モード終了
    if (event.key === "Escape" && isSelectionModeActive) {
        deactivateSelectionMode();
    }
}

/**
 * マウスオーバー時のホバーエフェクト
 * 
 * @param {MouseEvent} event - マウスオーバーイベント
 */
function handleMouseOver(event) {
    if (!isSelectionModeActive) {
        return;
    }
    
    const element = event.target;
    if (element.classList.contains("xpath-extractor-highlight")) {
        return;
    }
    
    // ホバー用のスタイルを追加
    element.classList.add("xpath-extractor-hover");
}

/**
 * マウスアウト時のホバーエフェクト解除
 * 
 * @param {MouseEvent} event - マウスアウトイベント
 */
function handleMouseOut(event) {
    const element = event.target;
    element.classList.remove("xpath-extractor-hover");
}

// ========================================
// 選択モード制御
// ========================================

/**
 * 選択モードを有効化する
 */
function activateSelectionMode() {
    if (isSelectionModeActive) {
        return;
    }
    
    isSelectionModeActive = true;
    
    // イベントリスナーを追加
    document.addEventListener("click", handleElementClick, true);
    document.addEventListener("dblclick", handleElementDoubleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    
    // カーソルを変更
    document.body.classList.add("xpath-extractor-active");
    
    console.log("[XPath Extractor] Selection mode activated");
}

/**
 * 選択モードを無効化する
 */
function deactivateSelectionMode() {
    if (!isSelectionModeActive) {
        return;
    }
    
    isSelectionModeActive = false;
    
    // イベントリスナーを削除
    document.removeEventListener("click", handleElementClick, true);
    document.removeEventListener("dblclick", handleElementDoubleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("mouseout", handleMouseOut, true);
    
    // カーソルを戻す
    document.body.classList.remove("xpath-extractor-active");
    
    // ホバークラスを全て削除
    document.querySelectorAll(".xpath-extractor-hover").forEach((el) => {
        el.classList.remove("xpath-extractor-hover");
    });
    
    console.log("[XPath Extractor] Selection mode deactivated");
}

/**
 * 選択モードをトグルする
 * 
 * @returns {{ isActive: boolean }} 新しい状態
 */
function toggleSelectionMode() {
    if (isSelectionModeActive) {
        deactivateSelectionMode();
    } else {
        activateSelectionMode();
    }
    return { isActive: isSelectionModeActive };
}

// ========================================
// メッセージハンドラ
// ========================================

/**
 * バックグラウンドスクリプトからのメッセージを処理する
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 選択モードのトグル
    if (request.action === "toggleSelectionMode") {
        const result = toggleSelectionMode();
        sendResponse(result);
        return true;
    }
    
    // 選択モードの状態取得
    if (request.action === "getSelectionMode") {
        sendResponse({ isActive: isSelectionModeActive });
        return true;
    }
    
    // 選択のクリア
    if (request.action === "clearSelection") {
        clearAllSelections();
        sendResponse({ success: true });
        return true;
    }
    
    // 現在のデータを取得
    if (request.action === "getCurrentData") {
        const extracted = extractData();
        const data = extracted.data;
        const patternInfo = extracted.patternInfo;
        sendResponse({ data: data, patternInfo: patternInfo });
        return true;
    }
});

// ========================================
// 初期化
// ========================================

// スクロールとリサイズ時にハイライト位置を更新
window.addEventListener("scroll", updateHighlightPositions, { passive: true });
window.addEventListener("resize", updateHighlightPositions, { passive: true });

console.log("[XPath Extractor] Content script loaded");
