/**
 * ポップアップUIのロジック
 * - ポップアップから選択モードのON/OFFを制御
 * - 抽出データの表示
 * - クリップボードへのコピー
 * - データのクリア
 */

// ========================================
// DOM要素の参照
// ========================================

const toggleBtn = document.getElementById("toggleBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const patternType = document.getElementById("patternType");
const elementCount = document.getElementById("elementCount");
const dataTextarea = document.getElementById("dataTextarea");
const toast = document.getElementById("toast");

// ========================================
// 状態管理
// ========================================

let isSelectionModeActive = false;

// ========================================
// UI更新関数
// ========================================

/**
 * 選択モードボタンの表示を更新
 */
function updateToggleButton(isActive) {
    isSelectionModeActive = isActive;
    
    if (isActive) {
        toggleBtn.classList.add("active");
        toggleBtn.textContent = "選択中";
    } else {
        toggleBtn.classList.remove("active");
        toggleBtn.textContent = "選択開始";
    }
}

/**
 * パターン情報の表示を更新
 */
function updatePatternInfo(patternInfo) {
    if (!patternInfo) {
        patternType.textContent = "未検出";
        patternType.className = "badge";
        elementCount.textContent = "0";
        return;
    }
    
    switch (patternInfo.type) {
        case "single":
            patternType.textContent = "単一";
            patternType.className = "badge";
            break;
        case "1d":
            patternType.textContent = "1次元";
            patternType.className = "badge badge-success";
            break;
        case "2d":
            patternType.textContent = "2次元";
            patternType.className = "badge badge-warning";
            break;
        case "multiple":
            patternType.textContent = "複数";
            patternType.className = "badge";
            break;
        default:
            patternType.textContent = "未検出";
            patternType.className = "badge";
    }
    
    if (patternInfo.type === "2d" && patternInfo.rows !== undefined) {
        elementCount.textContent = `${patternInfo.rows}×${patternInfo.cols}`;
    } else {
        elementCount.textContent = `${patternInfo.count || 0}`;
    }
}

/**
 * 抽出データをテキストエリアに表示
 * Excelやエディタにそのまま貼り付けられる形式
 */
function updateDataDisplay(data, patternInfo) {
    if (!data || data.length === 0) {
        dataTextarea.value = "";
        return;
    }
    
    let displayText = "";
    
    if (patternInfo && patternInfo.type === "2d") {
        // 2次元: 行は改行、列はタブで区切り（Excel互換）
        displayText = data
            .map((row) => {
                if (Array.isArray(row)) {
                    return row.join("\t");
                }
                return String(row);
            })
            .join("\n");
    } else {
        // 1次元: 改行区切り
        displayText = data
            .map((item) => {
                if (Array.isArray(item)) {
                    return item.join("\t");
                }
                return String(item);
            })
            .join("\n");
    }
    
    dataTextarea.value = displayText;
}

/**
 * トースト通知を表示
 */
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    
    setTimeout(() => {
        toast.classList.remove("show");
    }, 1500);
}

// ========================================
// データ取得関数
// ========================================

/**
 * 保存されているデータを取得して表示
 */
function loadStoredData() {
    chrome.runtime.sendMessage({ action: "getExtractedData" }, (response) => {
        if (chrome.runtime.lastError) {
            return;
        }
        
        if (response && response.data) {
            updatePatternInfo(response.patternInfo);
            updateDataDisplay(response.data, response.patternInfo);
        } else {
            updatePatternInfo(null);
            updateDataDisplay(null, null);
        }
    });
}

/**
 * 選択モードの現在の状態を取得
 */
function checkSelectionModeStatus(callback) {
    chrome.runtime.sendMessage({ action: "getSelectionMode" }, (response) => {
        if (chrome.runtime.lastError) {
            callback(false);
            return;
        }
        if (response && typeof response.isActive === "boolean") {
            callback(response.isActive);
        } else {
            callback(false);
        }
    });
}

// ========================================
// イベントハンドラ
// ========================================

/**
 * 選択モードをトグル
 */
function performToggle() {
    chrome.runtime.sendMessage({ action: "toggleFromPopup" }, (response) => {
        if (chrome.runtime.lastError) {
            showToast("エラー");
            return;
        }
        
        if (response && response.isActive !== undefined) {
            updateToggleButton(response.isActive);
        }
    });
}

/**
 * トグルボタンのクリックハンドラ
 */
function handleToggleClick() {
    // ボタン操作でのみ選択モードをトグルする
    performToggle();
}

/**
 * コピーボタンのクリックハンドラ
 */
function handleCopyClick() {
    const text = dataTextarea.value;
    
    if (!text || text.trim() === "") {
        showToast("データなし");
        return;
    }
    
    navigator.clipboard.writeText(text)
        .then(() => {
            showToast("コピー完了");
        })
        .catch(() => {
            dataTextarea.select();
            document.execCommand("copy");
            showToast("コピー完了");
        });
}

/**
 * クリアボタンのクリックハンドラ
 */
function handleClearClick() {
    chrome.runtime.sendMessage({ action: "clearData" }, (response) => {
        if (chrome.runtime.lastError) {
            return;
        }
        
        updatePatternInfo(null);
        updateDataDisplay(null, null);
        updateToggleButton(false);
        showToast("クリア完了");
    });
}

// ========================================
// ストレージ変更の監視
// ========================================

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }
    
    if (changes.extractedData || changes.patternInfo) {
        const data = changes.extractedData ? changes.extractedData.newValue : null;
        const patternInfo = changes.patternInfo ? changes.patternInfo.newValue : null;
        
        if (data !== undefined) {
            updateDataDisplay(data, patternInfo);
        }
        if (patternInfo !== undefined) {
            updatePatternInfo(patternInfo);
        }
    }
});

// ========================================
// 初期化
// ========================================

/**
 * ポップアップの初期化
 * ポップアップ表示時には状態を反映するだけにし、
 * 選択モードのON/OFFはボタンクリックで明示的に行う
 */
function initialize() {
    // イベントリスナーの設定
    toggleBtn.addEventListener("click", handleToggleClick);
    copyBtn.addEventListener("click", handleCopyClick);
    clearBtn.addEventListener("click", handleClearClick);
    
    // 保存データの読み込み
    loadStoredData();
    
    // 現在の選択モード状態を確認してUIを反映
    checkSelectionModeStatus((isActive) => {
        updateToggleButton(isActive);
    });
}

document.addEventListener("DOMContentLoaded", initialize);
