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
| シフト | [シフトセル インライン編集](#シフトセル-インライン編集) | シフト設定画面の各セルをプルダウンで直接変更 | [![Install](https://img.shields.io/badge/install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/shift-inline-edit.user.js) |

---

### シフト

#### シフトセル インライン編集
[![Install](https://img.shields.io/badge/TamperMonkey-Install-green)](https://raw.githubusercontent.com/catdance124/tm-salon-board/main/shift-inline-edit.user.js)

シフト設定画面の各セルをクリックするとプルダウンが表示され、モーダルを開かずにシフトを直接変更できる。

| 操作 | 動作 |
|------|------|
| セルをクリック | プルダウンが表示される |
| シフト名を選択 | 即座に保存・セルが黄色（設定箇所）になる |
| 元の値に戻す | 保存しつつ黄色が消えて元の色に戻る |
| 「詳細入力...」を選択 | 元のモーダルが開き予定の入力もできる |
