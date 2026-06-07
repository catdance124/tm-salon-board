# tm-salon-board

サロンボード（ネイルサロン向けSaaS）のUI改善 TamperMonkey スクリプト集。

## 使い方

### 1. TamperMonkey をインストール

ブラウザに [TamperMonkey](https://www.tampermonkey.net/) 拡張機能を追加する。

### 2. スクリプトをインストール

下記スクリプト一覧のインストールリンクをクリック → TamperMonkey の確認画面で「インストール」をクリック。

### 3. サロンボードにアクセス

対象ページを開くと自動でスクリプトが適用される。

---

## スクリプト一覧

| カテゴリ | スクリプト | 説明 | インストール |
|---------|-----------|------|------------|
| スケジュール | [スケジュール 週表示](#スケジュール-週表示) | スケジュール画面に7日分の週表示パネルを追加 | [![Install](https://img.shields.io/badge/install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/schedule/schedule-week-view.user.js) |
| シフト | [シフトセル インライン編集](#シフトセル-インライン編集) | シフト設定画面の各セルをプルダウンで直接変更 | [![Install](https://img.shields.io/badge/install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/shift/shift-inline-edit.user.js) |
| クーポン | [クーポンリスト強化](#クーポンリスト強化) | クーポン一覧にコピー・インライン詳細表示・並べ替えを追加 | [![Install](https://img.shields.io/badge/install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/coupon/coupon-list-enhance.user.js) |

---

### スケジュール

#### スケジュール 週表示
[![Install](https://img.shields.io/badge/TamperMonkey-Install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/schedule/schedule-week-view.user.js)

スケジュール画面に7日分（月〜日）の週表示パネルを追加する。

| 操作 | 動作 |
|------|------|
| 「週表示」ボタンをクリック | 週表示パネルが開き、7日分の予約を一覧表示 |
| 日付をクリック | その日の詳細スケジュールページへ移動 |
| 「前週」「次週」ボタン | 表示週を前後に切り替え |
| 「×」ボタン / 「週表示を閉じる」 | パネルを閉じる |

---

### シフト

#### シフトセル インライン編集
[![Install](https://img.shields.io/badge/TamperMonkey-Install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/shift/shift-inline-edit.user.js)

シフト設定画面の各セルをクリックするとプルダウンが表示され、モーダルを開かずにシフトを直接変更できる。

| 操作 | 動作 |
|------|------|
| セルをクリック | プルダウンが表示される |
| シフト名を選択 | 即座に保存・セルが黄色（設定箇所）になる |
| 元の値に戻す | 保存しつつ黄色が消えて元の色に戻る |
| 「詳細入力...」を選択 | 元のモーダルが開き予定の入力もできる |

---

### クーポン

#### クーポンリスト強化
[![Install](https://img.shields.io/badge/TamperMonkey-Install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/scripts/coupon/coupon-list-enhance.user.js)

クーポン一覧ページに以下の機能を追加する。

| 操作 | 動作 |
|------|------|
| ドラッグ&ドロップ | クーポンの並び順を入れ替え |
| 詳細トグル | 行をクリックしてインラインでクーポン詳細を表示 |
| コピーボタン | クーポン情報をコピーして新規作成画面に貼り付け |
