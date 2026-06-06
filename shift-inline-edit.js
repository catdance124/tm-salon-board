// ==UserScript==
// @name         サロンボード シフトセル インライン編集
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      2.4.0
// @description  シフト設定の各セルをプルダウンで直接編集できるようにする
// @author       catdance124
// @match        https://salonboard.com/KLP/set/shiftSetup/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function getShiftPatterns() {
    const patterns = Array.from(
      document.getElementById('shiftId')?.options || []
    ).map(o => ({ id: o.value, name: o.textContent.trim() }));

    const shortNameMap = {};
    const idToShortName = {};
    if (window.shiftMasterList) {
      Object.entries(window.shiftMasterList).forEach(([id, info]) => {
        shortNameMap[info.shiftShortName] = id;
        idToShortName[id] = info.shiftShortName;
      });
    }

    return { patterns, shortNameMap, idToShortName };
  }

  function cellTextToValue(text, shortNameMap) {
    if (text === '休') return 'holiday';
    return shortNameMap[text] || null;
  }

  function getCsrfToken() {
    return document.querySelector('input[name="org.apache.struts.taglib.html.TOKEN"]')?.value || '';
  }

  async function applyShiftDirect(staffId, date, shiftValue) {
    const isHoliday = shiftValue === 'holiday';
    const params = new URLSearchParams({
      shiftKbn: isHoliday ? '1' : '0',
      shiftId: isHoliday ? '' : shiftValue,
      staffId,
      date,
      'org.apache.struts.taglib.html.TOKEN': getCsrfToken(),
    });

    const res = await fetch('/KLP/ajax/changeShiftSchedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  // 現在開いているドロップダウンを閉じる関数
  let closeCurrentDropdown = null;

  function showDropdown(link, patterns, idToShortName, currentValue, staffId, date, initialValue, initialClass) {
    // 既存のドロップダウンを閉じる
    if (closeCurrentDropdown) closeCurrentDropdown();

    const rect = link.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      `top:${rect.bottom + 2}px`,
      `left:${rect.left}px`,
      'background:#fff',
      'border:1px solid #aaa',
      'border-radius:3px',
      'box-shadow:0 2px 6px rgba(0,0,0,0.2)',
      'z-index:99999',
      'min-width:80px',
      'font-size:12px',
    ].join(';');

    const options = [
      { value: 'holiday', label: '休' },
      ...patterns.map(p => ({ value: p.id, label: p.name })),
      { value: '__modal__', label: '詳細入力...' },
    ];

    options.forEach(opt => {
      const item = document.createElement('div');
      item.textContent = opt.label;
      item.style.cssText = [
        'padding:5px 10px',
        'cursor:pointer',
        opt.value === currentValue ? 'background:#e8f0fe;font-weight:bold' : '',
      ].join(';');
      item.addEventListener('mouseenter', () => item.style.background = '#f0f0f0');
      item.addEventListener('mouseleave', () => {
        item.style.background = opt.value === currentValue ? '#e8f0fe' : '';
      });

      if (opt.value === '__modal__') {
        item.style.borderTop = '1px solid #ddd';
        item.style.color = '#555';
      }

      item.addEventListener('click', async () => {
        closeCurrentDropdown();

        if (opt.value === '__modal__') {
          link.dataset.openModal = '1';
          link.click();
          return;
        }

        if (opt.value === currentValue) return;

        const prevText = link.textContent.trim();
        const prevClass = Array.from(link.classList).find(c => c.startsWith('mod_btn_35_'));
        const newText = opt.value === 'holiday' ? '休' : (idToShortName[opt.value] || opt.label);

        // 元の値に戻す場合は黄色ではなく初期クラスに戻す、それ以外は黄色ハイライト
        const newClass = opt.value === initialValue ? initialClass : 'mod_btn_35_4';

        // 楽観的更新
        link.textContent = newText;
        if (prevClass) link.classList.replace(prevClass, newClass);
        link.dataset.currentValue = opt.value;

        try {
          await applyShiftDirect(staffId, date, opt.value);
        } catch (e) {
          console.error('[tm-shift] 変更失敗:', e);
          link.textContent = prevText;
          if (prevClass) link.classList.replace(newClass, prevClass);
          link.dataset.currentValue = currentValue;
          alert('シフトの変更に失敗しました');
        }
      });

      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    const close = (e) => {
      if (e && menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener('click', close, true);
      closeCurrentDropdown = null;
    };

    closeCurrentDropdown = () => close();
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  function addDropdownToCell(link, patterns, shortNameMap, idToShortName) {
    const td = link.closest('td');
    if (!td || link.dataset.tmDropdown) return;

    const [staffId, date] = link.id.split('_');
    if (!staffId || !date) return;

    link.dataset.tmDropdown = '1';
    // 初期値と初期クラスを記憶
    const initialValue = cellTextToValue(link.textContent.trim(), shortNameMap) || 'holiday';
    const initialClass = Array.from(link.classList).find(c => c.startsWith('mod_btn_35_'));

    link.addEventListener('click', (e) => {
      // 詳細入力フラグが立っていたら元のモーダルをそのまま開く
      if (link.dataset.openModal) {
        delete link.dataset.openModal;
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const currentText = link.textContent.trim();
      const currentValue = link.dataset.currentValue
        || cellTextToValue(currentText, shortNameMap)
        || 'holiday';

      showDropdown(link, patterns, idToShortName, currentValue, staffId, date, initialValue, initialClass);
    });
  }

  function main() {
    const { patterns, shortNameMap, idToShortName } = getShiftPatterns();
    console.log(`[tm-shift] patterns=${patterns.length}`, patterns);
    if (patterns.length === 0) {
      console.warn('[tm-shift] シフトパターンが0件のため終了');
      return;
    }

    const links = document.querySelectorAll('a.shiftdate');
    console.log(`[tm-shift] ${links.length}件のセルにドロップダウンを追加`);
    links.forEach(link => addDropdownToCell(link, patterns, shortNameMap, idToShortName));
    console.log('[tm-shift] 完了');
  }

  function waitAndRun(retries = 20) {
    const hasData = window.shiftMasterList && Object.keys(window.shiftMasterList).length > 0;
    const hasCells = document.querySelectorAll('a.shiftdate').length > 0;
    console.log(`[tm-shift] 試行${21 - retries}/20 shiftMasterList=${hasData} cells=${document.querySelectorAll('a.shiftdate').length}`);
    if (hasData && hasCells) {
      console.log('[tm-shift] 条件OK、main()を実行します');
      main();
    } else if (retries > 0) {
      setTimeout(() => waitAndRun(retries - 1), 300);
    } else {
      console.warn('[tm-shift] タイムアウト');
    }
  }

  console.log('[tm-shift] スクリプト開始', location.href);
  waitAndRun();
})();
