// タブ切り替えのロジックのみを担当するシンプルなスクリプト。
// Manifest V3ではポップアップ側のスクリプトは通常通り実行される。

// DOMの読み込み完了後に初期化処理を実行する。
document.addEventListener("DOMContentLoaded", function () {
    // すべてのタブボタン要素を取得する。
    const tabButtons = document.querySelectorAll(".tab-button");
    // すべてのタブコンテンツ要素を取得する。
    const tabContents = document.querySelectorAll(".tab-content");

    // タブを切り替えるためのヘルパー関数。
    // targetIdには表示したいタブコンテンツのIDを渡す。
    const activateTab = function (targetId) {
        // すべてのタブボタンからactiveクラスを外す。
        tabButtons.forEach(function (button) {
            button.classList.remove("active");
        });

        // すべてのタブコンテンツからactiveクラスを外し、非表示にする。
        tabContents.forEach(function (content) {
            content.classList.remove("active");
        });

        // 対象のIDを持つコンテンツ要素を取得する。
        const targetContent = document.getElementById(targetId);
        if (!targetContent) {
            // 指定IDの要素が存在しない場合は何もしない。
            // HTML側のIDとdata-tabの値が一致しているか確認すること。
            return;
        }

        // 対象コンテンツにactiveクラスを付与して表示する。
        targetContent.classList.add("active");

        // 同じIDを指すタブボタンにactiveクラスを付与する。
        tabButtons.forEach(function (button) {
            const buttonTabId = button.getAttribute("data-tab");
            if (buttonTabId === targetId) {
                button.classList.add("active");
            }
        });
    };

    // 各タブボタンにクリックイベントリスナーを登録する。
    tabButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            // data-tab属性から対象コンテンツのIDを取得する。
            const targetId = button.getAttribute("data-tab");
            if (!targetId) {
                // data-tabが設定されていないボタンは無視する。
                return;
            }
            // 指定されたタブをアクティブにする。
            activateTab(targetId);
        });
    });

    // 初期表示時に、HTML側でactiveが付与されているタブがあればそれを優先して表示する。
    // 明示的に制御したい場合は、最初にtab1を強制的にアクティブにしてもよい。
    const initialActiveButton = document.querySelector(".tab-button.active");
    const initialTabId = initialActiveButton ? initialActiveButton.getAttribute("data-tab") : "tab1";
    activateTab(initialTabId);
});
