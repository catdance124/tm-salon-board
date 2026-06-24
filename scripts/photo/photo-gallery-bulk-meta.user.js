// ==UserScript==
// @name         サロンボード フォトギャラリー メタ情報一括設定
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      1.0.0
// @description  フォトギャラリー編集画面で、未入力の行にタイトル・キャプション・クーポンを一括設定し、No.（掲載順）を指定開始番号から連番に振り直す
// @author       catdance124
// @match        https://salonboard.com/CNK/draft/photoGalleryEdit*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LS_KEY = 'tm-pg-bulk-meta';      // 入力値の保存先
  const LIST = 'frmPhotoGalleryInfoDtoList';

  // ----------------------------------------------------------------
  // 行モデルの収集
  // ----------------------------------------------------------------

  // name="frmPhotoGalleryInfoDtoList[i].xxx" の i から要素を引く
  function field(i, suffix) {
    return document.querySelector(`[name="${LIST}[${i}].${suffix}"]`);
  }

  // ページ上に存在する行インデックスの最大値を検出
  function detectMaxIndex() {
    let max = -1;
    document.querySelectorAll(`[name^="${LIST}["]`).forEach(el => {
      const m = /\[(\d+)\]/.exec(el.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max;
  }

  // 画像あり行（photogalleryPhoto が非空）を {i, sortNo, title, sortInput, ...} で返す
  function collectPhotoRows() {
    const rows = [];
    const max = detectMaxIndex();
    for (let i = 0; i <= max; i++) {
      const photoInput = field(i, 'photogalleryPhoto');
      if (!photoInput || !photoInput.value.trim()) continue; // 画像なしスロットは除外
      const sortInput = field(i, 'photogallerySortNo');
      const titleInput = field(i, 'photogalleryTitle');
      const captionInput = field(i, 'photogalleryCaption');
      const couponIdInput = field(i, 'couponId');
      rows.push({
        i,
        sortInput,
        titleInput,
        captionInput,
        sortNo: parseInt(sortInput?.value, 10),
        titleEmpty: !(titleInput && titleInput.value.trim()),
        couponId: (couponIdInput?.value || '').trim(),
      });
    }
    return rows;
  }

  // 未入力（タイトル空）の対象行を、現在の sortNo 昇順で返す
  function collectTargets() {
    return collectPhotoRows()
      .filter(r => r.titleEmpty)
      .sort((a, b) => (a.sortNo || 0) - (b.sortNo || 0));
  }

  // ページ内の既存クーポンを {couponId -> {name, sourceIndex}} で重複排除して返す
  function collectCoupons() {
    const map = new Map();
    collectPhotoRows().forEach(r => {
      if (!r.couponId || map.has(r.couponId)) return;
      const nameDiv = field(r.i, 'couponId')?.closest('td')?.querySelector('.jsc_SB_modal_coupon_name');
      map.set(r.couponId, {
        name: (nameDiv?.textContent || field(r.i, 'couponName')?.value || r.couponId).trim(),
        sourceIndex: r.i,
      });
    });
    return map;
  }

  // 画像あり行の最大 sortNo（開始No. の既定値算出用）
  function maxSortNo() {
    return collectPhotoRows().reduce((m, r) => Math.max(m, r.sortNo || 0), 0);
  }

  // ----------------------------------------------------------------
  // 値の流し込み（サイト側のイベント連鎖を起こすため input/change を発火）
  // ----------------------------------------------------------------

  function setInputValue(input, value) {
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ソース行（その couponId を持つ既存行）から、対象行へクーポンをコピーする。
  //
  // クーポンセル（td.jsc_SB_modal_coupon_wrapper）は内部に2つのカセット容器を持つ:
  //   - div.jsc_SB_modal_coupon       … 設定済み用（表示される）
  //   - div.jsc_SB_modal_coupon_empty … 未設定用（dn クラスで display:none）
  // 未設定行で hidden4本だけ書くと、値は送信される（保存はされる）が、書き込み先が
  // display:none 側のため画面プレビューが更新されない。そこでセル(wrapper)ごと複製し、
  // name 属性のインデックスだけ対象行に書き換えて、見た目（設定済みカセット）も再現する。
  function applyCoupon(targetIndex, sourceIndex) {
    const srcWrap = field(sourceIndex, 'couponId')?.closest('.jsc_SB_modal_coupon_wrapper');
    const dstWrap = field(targetIndex, 'couponId')?.closest('.jsc_SB_modal_coupon_wrapper');
    if (!srcWrap || !dstWrap) return;
    const from = `${LIST}[${sourceIndex}]`;
    const to = `${LIST}[${targetIndex}]`;
    dstWrap.innerHTML = srcWrap.innerHTML.split(from).join(to);
  }

  // ----------------------------------------------------------------
  // 一括適用
  // ----------------------------------------------------------------

  function runApply(opts, resultEl) {
    const targets = collectTargets();
    if (targets.length === 0) {
      showResult(resultEl, '未入力（タイトルが空）の行がありません。', true);
      return;
    }
    const start = opts.startNo;
    // クーポンのソース行（その couponId を持つ既存行）を一度だけ解決
    const couponSource = opts.couponId ? collectCoupons().get(opts.couponId)?.sourceIndex : undefined;
    targets.forEach((row, k) => {
      // No.（掲載順）
      setInputValue(row.sortInput, String(start + k));
      // タイトル / キャプション（指定があれば設定。対象は元々空なので上書き問題なし）
      if (opts.title) setInputValue(row.titleInput, opts.title);
      if (opts.caption) setInputValue(row.captionInput, opts.caption);
      // クーポン（ソース行のクーポンセルを複製）
      if (couponSource !== undefined) applyCoupon(row.i, couponSource);
    });
    const last = start + targets.length - 1;
    showResult(
      resultEl,
      `${targets.length}件に適用しました（No. ${start}〜${last}）。` +
      `内容を確認して、サロンボードの保存ボタンで登録してください。`,
      false
    );
  }

  function showResult(el, msg, isWarn) {
    el.textContent = msg;
    el.style.color = isWarn ? '#c0392b' : '#2a7d2a';
  }

  // ----------------------------------------------------------------
  // パネル UI
  // ----------------------------------------------------------------

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  }
  function save(partial) {
    const cur = loadSaved();
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...partial })); } catch { /* noop */ }
  }

  function buildPanel() {
    const saved = loadSaved();

    const panel = el('div', 'tm-bm-panel');

    // ヘッダ（折りたたみトグル）
    const header = el('div', 'tm-bm-header');
    header.appendChild(textEl('span', 'tm-bm-title', '📋 メタ情報 一括設定'));
    const toggle = textEl('button', 'tm-bm-toggle', '−');
    header.appendChild(toggle);
    panel.appendChild(header);

    const bodyWrap = el('div', 'tm-bm-body');

    // タイトル
    bodyWrap.appendChild(textEl('label', 'tm-bm-label', 'タイトル'));
    const titleInput = el('input', 'tm-bm-input');
    titleInput.type = 'text';
    titleInput.value = saved.title || '';
    titleInput.addEventListener('input', () => save({ title: titleInput.value }));
    bodyWrap.appendChild(titleInput);

    // キャプション
    bodyWrap.appendChild(textEl('label', 'tm-bm-label', 'キャプション'));
    const captionInput = el('textarea', 'tm-bm-input tm-bm-textarea');
    captionInput.value = saved.caption || '';
    captionInput.addEventListener('input', () => save({ caption: captionInput.value }));
    bodyWrap.appendChild(captionInput);

    // クーポン
    bodyWrap.appendChild(textEl('label', 'tm-bm-label', 'クーポン'));
    const couponSelect = el('select', 'tm-bm-input');
    bodyWrap.appendChild(couponSelect);

    // 開始No.
    bodyWrap.appendChild(textEl('label', 'tm-bm-label', '開始No.（掲載順）'));
    const startInput = el('input', 'tm-bm-input tm-bm-num');
    startInput.type = 'number';
    startInput.min = '1';
    startInput.addEventListener('input', () => save({ startNo: startInput.value }));
    bodyWrap.appendChild(startInput);

    // 対象件数表示
    const targetInfo = textEl('div', 'tm-bm-target', '');
    bodyWrap.appendChild(targetInfo);

    // 注意書き
    bodyWrap.appendChild(textEl('div', 'tm-bm-note',
      '※ 対象は「タイトルが空」の行のみ。No.は既存の番号と重複し得ます。保存は手動です。'));

    // 適用ボタン
    const applyBtn = textEl('button', 'tm-bm-apply', 'この内容で一括適用');
    bodyWrap.appendChild(applyBtn);

    // 結果メッセージ
    const result = textEl('div', 'tm-bm-result', '');
    bodyWrap.appendChild(result);

    panel.appendChild(bodyWrap);

    // --- 動的更新 ---
    function refresh() {
      // クーポン選択肢を再構築（現在の選択を維持）
      const coupons = collectCoupons();
      const prev = couponSelect.value || saved.couponId || '';
      couponSelect.innerHTML = '';
      const optNone = textEl('option', '', '（変更しない）');
      optNone.value = '';
      couponSelect.appendChild(optNone);
      coupons.forEach((info, id) => {
        const o = textEl('option', '', info.name);
        o.value = id;
        couponSelect.appendChild(o);
      });
      // 直前の選択が選択肢に残っていれば復元
      couponSelect.value = [...couponSelect.options].some(o => o.value === prev) ? prev : '';

      // 開始No. の既定値（未設定時のみ max+1）
      if (!startInput.value) startInput.value = saved.startNo || (maxSortNo() + 1);

      // 対象件数
      const n = collectTargets().length;
      targetInfo.textContent = `未入力の行 ${n} 件に適用`;
    }
    couponSelect.addEventListener('change', () => save({ couponId: couponSelect.value }));

    // 折りたたみ
    toggle.addEventListener('click', () => {
      const hidden = bodyWrap.style.display === 'none';
      bodyWrap.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '−' : '＋';
    });

    // 適用
    applyBtn.addEventListener('click', () => {
      const startNo = parseInt(startInput.value, 10);
      if (!Number.isFinite(startNo) || startNo < 1) {
        showResult(result, '開始No. を正しく入力してください。', true);
        return;
      }
      runApply({
        title: titleInput.value.trim(),
        caption: captionInput.value.trim(),
        couponId: couponSelect.value,
        startNo,
      }, result);
      refresh();
    });

    document.body.appendChild(panel);

    // 初回＋DOM変化（写真追加後の再描画）に追従して件数・クーポンを更新
    refresh();
    const obs = new MutationObserver(() => refresh());
    const form = document.querySelector(`[name^="${LIST}["]`)?.closest('form') || document.body;
    obs.observe(form, { childList: true, subtree: true });
  }

  // ----------------------------------------------------------------
  // ユーティリティ
  // ----------------------------------------------------------------

  function el(tag, className) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    return n;
  }
  function textEl(tag, className, text) {
    const n = el(tag, className);
    n.textContent = text;
    if (tag === 'button') n.type = 'button';
    return n;
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = TM_CSS;
    document.head.appendChild(style);
  }

  const TM_CSS = `
.tm-bm-panel{position:fixed;right:16px;bottom:16px;z-index:99990;width:280px;background:#fff;border:1px solid #c8d8e8;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:12px;color:#333;font-family:"Meiryo","メイリオ",sans-serif}
.tm-bm-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(180deg,#5a9fd4 0%,#3a7fc1 100%);color:#fff;border-radius:8px 8px 0 0;cursor:default}
.tm-bm-title{font-weight:bold;font-size:13px}
.tm-bm-toggle{border:none;background:rgba(255,255,255,.25);color:#fff;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:14px;line-height:1}
.tm-bm-body{padding:10px 12px;display:flex;flex-direction:column;gap:4px;max-height:70vh;overflow:auto}
.tm-bm-label{font-weight:bold;color:#556;margin-top:4px}
.tm-bm-input{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:inherit}
.tm-bm-textarea{resize:vertical;min-height:48px}
.tm-bm-num{width:90px}
.tm-bm-target{margin-top:6px;font-weight:bold;color:#3a7fc1}
.tm-bm-note{color:#999;font-size:11px;line-height:1.4;margin-top:2px}
.tm-bm-apply{margin-top:8px;padding:8px;border:none;border-radius:4px;background:#e8883a;color:#fff;font-size:13px;cursor:pointer}
.tm-bm-apply:hover{background:#c06820}
.tm-bm-result{margin-top:6px;font-size:11px;line-height:1.5;min-height:1em}
`;

  // ---- 起動 ----
  injectStyle();
  buildPanel();
})();
