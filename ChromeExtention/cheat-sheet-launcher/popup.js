// popup.js
document.addEventListener("DOMContentLoaded", function () {
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");

    // タブ切り替え関数
    const activateTab = function (targetId) {
        // 全ボタンとコンテンツを非アクティブ化
        tabButtons.forEach(btn => btn.classList.remove("active"));
        tabContents.forEach(content => content.classList.remove("active"));

        // 対象コンテンツをアクティブ化
        const targetContent = document.getElementById(targetId);
        if (targetContent) {
            targetContent.classList.add("active");
        }

        // 対象ボタンをアクティブ化
        tabButtons.forEach(btn => {
            if (btn.getAttribute("data-tab") === targetId) {
                btn.classList.add("active");
                // アクティブなボタンが視界に入るようにスクロール調整
                btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }
        });
    };

    // クリックイベント設定
    tabButtons.forEach(button => {
        button.addEventListener("click", function () {
            const targetId = button.getAttribute("data-tab");
            if (targetId) {
                activateTab(targetId);
            }
        });
    });

    // 初期表示設定 (HTMLでactiveがついているものを優先)
    const initialActiveButton = document.querySelector(".tab-button.active");
    if (initialActiveButton) {
        const initialTabId = initialActiveButton.getAttribute("data-tab");
        activateTab(initialTabId);
    }
});
