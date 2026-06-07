// ==UserScript==
// @name         サロンボード クーポンリスト強化
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      1.0.0
// @description  クーポン一覧にコピー・インライン詳細・↑↓並べ替えを追加
// @author       catdance124
// @match        https://salonboard.com/CNK/draft/couponList*
// @match        https://salonboard.com/CNK/draft/couponEdit*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tm_coupon_copy_data';

  // ========== couponEdit ページ：コピーデータの復元 ==========
  if (location.pathname.includes('/draft/couponEdit')) {
    restoreCopyData();
    return;
  }

  // ========== couponList ページ ==========
  injectStyle();
  waitAndRun();

  // ----------------------------------------------------------------

  function waitAndRun(retries = 20) {
    const rows = getDataRows();
    if (rows.length > 0) {
      init(rows);
    } else if (retries > 0) {
      setTimeout(() => waitAndRun(retries - 1), 200);
    }
  }

  function init(rows) {
    addDragSort(rows);
    rows.forEach(row => {
      addDetailToggle(row);
      addCopyButton(row);
    });
  }

  // ----------------------------------------------------------------
  // データ行の取得
  // ----------------------------------------------------------------

  function getDataRows() {
    return Array.from(
      document.querySelectorAll('tr')
    ).filter(tr => tr.querySelector('input[name^="frmCouponListDto"][name$=".seq"]'));
  }

  // 詳細リンクから couponSortDate / couponId を抽出
  function getCouponInfo(row) {
    const link = row.querySelector('a[onclick^="doEdit"]');
    if (!link) return null;
    const m = link.getAttribute('onclick').match(/doEdit\(event,\s*'([^']+)',\s*'([^']+)'\)/);
    return m ? { couponSortDate: m[1], couponId: m[2] } : null;
  }

  // ----------------------------------------------------------------
  // ドラッグ&ドロップ並べ替え
  // ----------------------------------------------------------------

  function addDragSort(rows) {
    let dragSrcIdx = null;

    rows.forEach((row, i) => {
      const seqCell = row.cells[0];
      if (!seqCell) return;

      // グラブハンドル
      const handle = document.createElement('div');
      handle.className = 'tm-drag-handle';
      handle.textContent = '⠿';
      handle.title = 'ドラッグして並べ替え';
      seqCell.appendChild(handle);

      // ハンドルを掴んだときだけ draggable を有効化
      handle.addEventListener('mousedown', () => { row.draggable = true; });
      handle.addEventListener('mouseup',   () => { row.draggable = false; });

      row.addEventListener('dragstart', (e) => {
        dragSrcIdx = getDataRows().indexOf(row);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        // ドラッグ中の行は pointer-events を切り、下の行にイベントを届かせる
        setTimeout(() => {
          row.classList.add('tm-dragging');
          row.style.pointerEvents = 'none';
        }, 0);
      });

      row.addEventListener('dragend', () => {
        row.draggable = false;
        row.classList.remove('tm-dragging');
        row.style.pointerEvents = '';
        rows.forEach(r => r.classList.remove('tm-drag-over'));
        dragSrcIdx = null;
      });

      row.addEventListener('dragover', (e) => {
        if (dragSrcIdx === null || getDataRows().indexOf(row) === dragSrcIdx) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        rows.forEach(r => r.classList.remove('tm-drag-over'));
        row.classList.add('tm-drag-over');
      });

      // relatedTarget が行の内側なら dragleave を無視（子要素間の移動で誤発火する対策）
      row.addEventListener('dragleave', (e) => {
        if (row.contains(e.relatedTarget)) return;
        row.classList.remove('tm-drag-over');
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (dragSrcIdx === null) return;

        const currentRows = getDataRows();
        const toIdx = currentRows.indexOf(row);
        if (dragSrcIdx === toIdx) return;

        rows.forEach(r => r.classList.remove('tm-drag-over'));

        const fromRow = currentRows[dragSrcIdx];
        const toRow   = row;
        const tbody   = fromRow.closest('tbody') || fromRow.parentNode;

        // ドラッグ元の直後に詳細展開行があれば一緒に移動
        const fromDetail = fromRow.nextElementSibling?.classList?.contains('tm-detail-row')
          ? fromRow.nextElementSibling : null;

        if (dragSrcIdx < toIdx) {
          tbody.insertBefore(fromRow, toRow.nextSibling);
          if (fromDetail) tbody.insertBefore(fromDetail, toRow.nextSibling);
        } else {
          tbody.insertBefore(fromRow, toRow);
          if (fromDetail) tbody.insertBefore(fromDetail, toRow);
        }

        // DOM順で seq を振り直し（保存は「クーポン並び替え登録」ボタンで）
        getDataRows().forEach((r, idx) => {
          const seqInput = r.querySelector('input[name$=".seq"]');
          if (seqInput) seqInput.value = idx + 1;
        });

        showSaveBanner();
      });
    });
  }

  function showSaveBanner() {
    document.querySelector('.tm-save-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'tm-save-banner';
    banner.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
      'background:#f0a030', 'color:#fff', 'padding:10px 20px',
      'border-radius:6px', 'font-size:13px', 'z-index:99999',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)', 'pointer-events:none',
    ].join(';');
    banner.textContent = '順番を変更しました。「クーポン並び替え登録」ボタンで保存してください。';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }

  // ----------------------------------------------------------------
  // ▼ インライン詳細
  // ----------------------------------------------------------------

  function addDetailToggle(row) {
    const info = getCouponInfo(row);
    if (!info) return;

    const detailTd = row.cells[row.cells.length - 2];
    if (!detailTd) return;

    const btn = makeBtn('▼詳細', async () => {
      const existing = row.nextElementSibling;
      if (existing?.classList.contains('tm-detail-row')) {
        existing.remove();
        btn.textContent = '▼詳細';
        return;
      }

      btn.textContent = '▲詳細';
      const detailRow = document.createElement('tr');
      detailRow.className = 'tm-detail-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.innerHTML = '<span class="tm-loading">読み込み中…</span>';
      detailRow.appendChild(td);
      row.insertAdjacentElement('afterend', detailRow);

      try {
        const data = await fetchCouponDetail(info);
        td.innerHTML = renderDetail(data);
      } catch (e) {
        td.innerHTML = '<span style="color:red">読み込みに失敗しました</span>';
        console.error('[tm-coupon] 詳細取得失敗:', e);
      }
    });

    btn.style.display = 'block';
    btn.style.marginTop = '4px';
    detailTd.appendChild(btn);
  }

  async function fetchCouponDetail({ couponSortDate, couponId }) {
    const ctx  = window.ctxStr || 'CNK';
    const page = document.querySelector('#couponSelectForm [name=page]')?.value || '1';
    const params = new URLSearchParams({
      couponSortDate, couponId, page,
      _csrf: getCsrfToken(),
    });
    const res = await fetch(`/${ctx}/draft/couponEdit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return parseCouponEditHtml(html);
  }

  function parseCouponEditHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const val  = (name) => doc.querySelector(`[name="${name}"]`)?.value?.trim() || '';
    const checked = (name) => doc.querySelector(`[name="${name}"]:checked`)?.value?.trim() || '';
    const selText = (name) => {
      const sel = doc.querySelector(`[name="${name}"]`);
      return sel?.options[sel.selectedIndex]?.text?.trim() || '';
    };

    const expiryYear  = val('frmCouponEditCnkDto.selectedExpirationYear');
    const expiryMonth = val('frmCouponEditCnkDto.selectedExpirationMonth');
    const expiryDay   = val('frmCouponEditCnkDto.selectedExpirationDay');
    const autoExpiry  = checked('frmCouponEditCnkDto.checkedAutoExpiration');
    const expiry = autoExpiry === 'true'
      ? '自動（1ヶ月）'
      : (expiryYear ? `${expiryYear}/${expiryMonth}/${expiryDay}` : 'なし');

    const discountType = checked('frmCouponEditCnkDto.selectedDiscountType');
    let discount = '';
    if (discountType === 'CD01') discount = val('frmCouponEditCnkDto.discountPrice') + '円引き';
    else if (discountType === 'CD02') discount = val('frmCouponEditCnkDto.discountRate') + '%OFF';
    else if (discountType === 'CD03') discount = 'その他';

    return {
      '種別':     selText('frmCouponEditCnkDto.selectedCouponTypeCd'),
      '使用条件': val('frmCouponEditCnkDto.useCondition'),
      '説明文':   val('frmCouponEditCnkDto.contentExplanation'),
      '料金':     val('frmCouponEditCnkDto.price') ? val('frmCouponEditCnkDto.price') + '円' : '',
      '割引':     discount,
      '施術時間': val('frmCouponEditCnkDto.sejyutsuAimTime') ? val('frmCouponEditCnkDto.sejyutsuAimTime') + '分' : '',
      '有効期限': expiry,
    };
  }

  function renderDetail(data) {
    const rows = Object.entries(data)
      .filter(([, v]) => v)
      .map(([k, v]) =>
        `<div class="tm-dl"><span class="tm-dt">${k}</span><span class="tm-dd">${escHtml(v)}</span></div>`
      ).join('');
    return `<div class="tm-detail-content">${rows || '<span style="color:#999">詳細情報なし</span>'}</div>`;
  }

  // ----------------------------------------------------------------
  // コピーボタン
  // ----------------------------------------------------------------

  function addCopyButton(row) {
    const info = getCouponInfo(row);
    if (!info) return;

    const actionTd = row.cells[row.cells.length - 1];
    if (!actionTd) return;

    const btn = makeBtn('コピー', async () => {
      const name = row.querySelector('td:nth-child(4)')?.textContent?.trim() || 'このクーポン';
      if (!confirm(`「${name.substring(0, 30)}」をコピーして新規作成しますか？`)) return;

      btn.textContent = '処理中…';
      btn.disabled = true;

      try {
        await prepareCopy(info);
        // couponAddForm で新規作成ページへ遷移
        // couponSortDate を空にしないとサーバーが既存クーポン編集と解釈してしまう
        const addForm = document.getElementById('couponAddForm');
        if (addForm) {
          const sortDateInput = addForm.querySelector('[name="couponSortDate"]');
          if (sortDateInput) sortDateInput.value = '';
          addForm.submit();
        } else {
          location.href = '/' + (window.ctxStr || 'CNK') + '/draft/couponEdit';
        }
      } catch (e) {
        console.error('[tm-coupon] コピー失敗:', e);
        alert('コピーに失敗しました: ' + e.message);
        btn.textContent = 'コピー';
        btn.disabled = false;
      }
    });

    btn.className += ' tm-copy-btn';
    btn.style.display = 'block';
    btn.style.marginTop = '4px';
    actionTd.appendChild(btn);
  }

  async function prepareCopy({ couponSortDate, couponId }) {
    const ctx  = window.ctxStr || 'CNK';
    const page = document.querySelector('#couponSelectForm [name=page]')?.value || '1';
    const params = new URLSearchParams({
      couponSortDate, couponId, page,
      _csrf: getCsrfToken(),
    });
    const res = await fetch(`/${ctx}/draft/couponEdit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // コピーするコンテンツフィールドのホワイトリスト
    // couponPhoto は別クーポンのIDを新規クーポンに設定するとサーバーエラーになるため除外
    const COPY_FIELDS = new Set([
      'frmCouponEditCnkDto.selectedCouponTypeCd',
      'frmCouponEditCnkDto.couponName',
      'frmCouponEditCnkDto.contentExplanation',
      'frmCouponEditCnkDto.selectedTeijiJoukenCd',
      'frmCouponEditCnkDto.useCondition',
      'frmCouponEditCnkDto.checkedAutoExpiration',
      'frmCouponEditCnkDto.selectedExpirationYear',
      'frmCouponEditCnkDto.selectedExpirationMonth',
      'frmCouponEditCnkDto.selectedExpirationDay',
      'frmCouponEditCnkDto.selectedSchCouponCategory',
      'frmCouponEditCnkDto.selectedApplyMenu',
      'frmCouponEditCnkDto.selectedSejyutsuCountKbn',
      'frmCouponEditCnkDto.sejyutsuCount',
      'frmCouponEditCnkDto.sejyutsuPeriod',
      'frmCouponEditCnkDto.price',
      'frmCouponEditCnkDto.sejyutsuAimTime',
      'frmCouponEditCnkDto.selectedDiscountType',
      'frmCouponEditCnkDto.discountPrice',
      'frmCouponEditCnkDto.discountRate',
      'frmCouponEditCnkDto.selectedMenuCategoryCd',
    ]);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const copyData = {};
    doc.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.name || !COPY_FIELDS.has(el.name)) return;
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (!el.checked) return;
        if (!Array.isArray(copyData[el.name])) copyData[el.name] = [];
        copyData[el.name].push(el.value);
      } else {
        if (!Array.isArray(copyData[el.name])) copyData[el.name] = el.value;
      }
    });

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(copyData));
  }

  // ----------------------------------------------------------------
  // couponEdit ページ：コピーデータ復元
  // ----------------------------------------------------------------

  function restoreCopyData() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(STORAGE_KEY);

    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // DOMが準備できてから適用
    const apply = () => {
      let applied = 0;

      Object.entries(data).forEach(([name, value]) => {
        const values = Array.isArray(value) ? value : [value];
        document.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach(el => {
          if (el.type === 'radio') {
            el.checked = values.includes(el.value);
          } else if (el.type === 'checkbox') {
            el.checked = values.includes(el.value);
          } else if (el.tagName === 'SELECT') {
            el.disabled = false;
            el.value = values[0] || '';
          } else {
            const v = values[0] || '';
            if (v) el.disabled = false;
            el.value = v;
          }
          applied++;
        });
      });

      if (applied > 0) {
        const banner = document.createElement('div');
        banner.style.cssText = [
          'position:fixed', 'top:10px', 'right:10px', 'z-index:99999',
          'background:#4caf50', 'color:#fff', 'padding:10px 16px',
          'border-radius:6px', 'font-size:13px', 'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
        ].join(';');
        banner.textContent = '✓ コピー元のデータを読み込みました。内容を確認して保存してください。';
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 5000);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
  }

  // ----------------------------------------------------------------
  // ユーティリティ
  // ----------------------------------------------------------------

  function getCsrfToken() {
    return document.querySelector('input[name="_csrf"]')?.value || '';
  }

  function makeBtn(label, onClick, disabled = false) {
    const btn = document.createElement('button');
    btn.className = 'tm-sort-btn';
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .tm-sort-btn {
        display: inline-block;
        padding: 2px 6px;
        background: #5a9fd4;
        color: #fff;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        line-height: 1.5;
      }
      .tm-sort-btn:hover:not(:disabled) { background: #3a7fb4; }
      .tm-sort-btn:disabled { background: #bbb; cursor: default; }
      .tm-copy-btn { background: #e8883a !important; }
      .tm-copy-btn:hover:not(:disabled) { background: #c06820 !important; }
      .tm-detail-row > td {
        background: #f5f8ff;
        padding: 10px 16px;
        border-top: 1px dashed #b0c4de;
      }
      .tm-detail-content {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 20px;
        font-size: 12px;
      }
      .tm-dl {
        display: flex;
        gap: 6px;
        align-items: flex-start;
        min-width: 200px;
      }
      .tm-dt {
        font-weight: bold;
        color: #556;
        white-space: nowrap;
        min-width: 60px;
      }
      .tm-dd {
        color: #333;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .tm-loading { color: #999; font-style: italic; font-size: 12px; }
      .tm-drag-handle {
        display: inline-block;
        margin-top: 4px;
        font-size: 16px;
        color: #aaa;
        cursor: grab;
        user-select: none;
        letter-spacing: -2px;
        padding: 2px 4px;
        border-radius: 3px;
        transition: color 0.15s;
      }
      .tm-drag-handle:hover { color: #5a9fd4; background: #eef4fb; }
      .tm-dragging { opacity: 0.4; pointer-events: none; }
      .tm-drag-over { outline: 2px dashed #5a9fd4; background: #eef4fb !important; }
      .tm-draggable { cursor: default; }
    `;
    document.head.appendChild(style);
  }
})();
