// ==UserScript==
// @name         サロンボード スケジュール 週表示
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      1.0.0
// @description  スケジュール画面に7日分の週表示を追加する
// @author       catdance124
// @match        https://salonboard.com/KLP/schedule/salonSchedule/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

  function getToken() {
    return document.querySelector('input[name="org.apache.struts.taglib.html.TOKEN"]')?.value || '';
  }

  function getStoreId() {
    return document.querySelector('input[name="storeIdForMultipleTabCheck"]')?.value || '';
  }

  function getCurrentDate() {
    const v = document.getElementById('date')?.value || '';
    if (v.length === 8) {
      return new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
    }
    return new Date();
  }

  function formatDateYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  function formatTime(t) {
    if (!t || t.length < 4) return t || '';
    return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  }

  function addMinutes(timeStr, minutes) {
    const h = parseInt(timeStr.slice(0, 2), 10);
    const m = parseInt(timeStr.slice(2, 4), 10);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}`;
  }

  function getWeekMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async function fetchSchedule(dateStr) {
    const token = getToken();
    const storeId = getStoreId();
    const url = `/KLP/schedule/salonSchedule/retrieveScheduleJson?date=${dateStr}&org.apache.struts.taglib.html.TOKEN=${token}&storeIdForMultipleTabCheck=${storeId}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchWeekData(monday) {
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return d;
    });
    const results = await Promise.allSettled(dates.map(d => fetchSchedule(formatDateYMD(d))));
    return dates.map((d, i) => ({
      date: d,
      dateStr: formatDateYMD(d),
      data: results[i].status === 'fulfilled' ? results[i].value : null,
    }));
  }

  function buildStaffList(weekData) {
    const staffMap = new Map();
    for (const { data } of weekData) {
      if (!data?.staffSchedules) continue;
      for (const s of data.staffSchedules) {
        const id = s.stock?.staffId;
        if (id && !staffMap.has(id)) {
          staffMap.set(id, { staffId: id, name: s.stock.name, sortNo: s.stock.sortNo || 0 });
        }
      }
    }
    return [...staffMap.values()].sort((a, b) => a.sortNo - b.sortNo);
  }

  function renderReservationBlock(rsv) {
    const color = rsv.coupons?.[0]?.categories?.[0]?.iconColor || 'b0c4de';
    const endTime = addMinutes(rsv.startTime, rsv.execTime);
    const routeShort = rsv.routeShortName ? `<span style="font-size:9px;color:#666;">[${rsv.routeShortName}]</span> ` : '';
    return `<div style="background:#${color}33;border-left:3px solid #${color};padding:2px 4px;margin:2px 0;border-radius:2px;cursor:default;" title="${rsv.reserveName}\n${formatTime(rsv.startTime)}〜${formatTime(endTime)}(${rsv.execTime}分)">
      <div style="font-size:10px;color:#555;">${formatTime(rsv.startTime)}〜${formatTime(endTime)}</div>
      <div style="font-size:11px;font-weight:bold;">${routeShort}${rsv.reserveName || rsv.customer?.name || ''}</div>
    </div>`;
  }

  function renderCell(staffId, dayEntry) {
    const { data } = dayEntry;
    if (!data || data.result !== 'success') {
      return `<td style="background:#f5f5f5;text-align:center;color:#bbb;font-size:11px;border:1px solid #e0e0e0;">-</td>`;
    }

    const staffSchedule = data.staffSchedules?.find(s => s.stock?.staffId === staffId);
    if (!staffSchedule) {
      return `<td style="background:#f9f9f9;border:1px solid #e0e0e0;"></td>`;
    }

    const holidayPlan = staffSchedule.plans?.find(p => p.isAllDay || p.title === '休日');
    if (holidayPlan) {
      return `<td style="background:#f0f0f0;text-align:center;color:#999;font-size:12px;vertical-align:middle;border:1px solid #e0e0e0;">${holidayPlan.title || '休'}</td>`;
    }

    const assignments = staffSchedule.assignments || [];
    if (assignments.length === 0) {
      return `<td style="background:#fff;border:1px solid #e0e0e0;min-width:110px;"></td>`;
    }

    const sorted = [...assignments].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const blocks = sorted.map(renderReservationBlock).join('');
    return `<td style="background:#fff;vertical-align:top;padding:3px;border:1px solid #e0e0e0;min-width:110px;">${blocks}</td>`;
  }

  function renderWeekTable(weekData, staffList) {
    const todayStr = formatDateYMD(new Date());

    const headerCells = weekData.map(({ date, dateStr }) => {
      const dow = date.getDay();
      const isToday = dateStr === todayStr;
      const fgColor = isToday ? '#1a73e8' : dow === 0 ? '#c62828' : dow === 6 ? '#1565c0' : '#333';
      const bgColor = isToday ? '#e8f0fe' : '#f4f4f4';
      const label = `${date.getMonth() + 1}/${date.getDate()}(${DAYS_JA[dow]})`;
      return `<th style="padding:6px 10px;background:${bgColor};color:${fgColor};font-weight:bold;text-align:center;border:1px solid #d0d0d0;white-space:nowrap;min-width:110px;">
        <a href="/KLP/schedule/salonSchedule/?date=${dateStr}" style="color:inherit;text-decoration:none;" title="${dateStr}">${label}</a>
      </th>`;
    }).join('');

    const rows = staffList.map(staff => {
      const nameTd = `<td style="padding:6px 8px;background:#f4f4f4;font-weight:bold;white-space:nowrap;border:1px solid #d0d0d0;font-size:12px;">${staff.name}</td>`;
      const cells = weekData.map(entry => renderCell(staff.staffId, entry)).join('');
      return `<tr>${nameTd}${cells}</tr>`;
    }).join('');

    return `<table style="border-collapse:collapse;width:100%;font-size:12px;">
      <thead>
        <tr>
          <th style="padding:6px 8px;background:#e8e8e8;border:1px solid #d0d0d0;"></th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  let currentMonday = null;
  let weekPanelEl = null;

  async function loadAndRender() {
    const body = weekPanelEl?.querySelector('.tm-week-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:24px;color:#888;font-size:13px;">読み込み中...</div>';

    try {
      const weekData = await fetchWeekData(currentMonday);
      const staffList = buildStaffList(weekData);

      if (staffList.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:24px;color:#c00;">データが取得できませんでした</div>';
        return;
      }

      updateWeekLabel();
      body.innerHTML = renderWeekTable(weekData, staffList);
    } catch (e) {
      console.error('[tm-schedule-week] error:', e);
      body.innerHTML = '<div style="text-align:center;padding:24px;color:#c00;">エラーが発生しました</div>';
    }
  }

  function updateWeekLabel() {
    const label = weekPanelEl?.querySelector('.tm-week-label');
    if (!label) return;
    const end = new Date(currentMonday);
    end.setDate(end.getDate() + 6);
    label.textContent = `${currentMonday.getMonth() + 1}/${currentMonday.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}`;
  }

  function shiftWeek(delta) {
    currentMonday = new Date(currentMonday);
    currentMonday.setDate(currentMonday.getDate() + delta * 7);
    updateWeekLabel();
    loadAndRender();
  }

  function createWeekPanel(insertBefore) {
    const panel = document.createElement('div');
    panel.id = 'tm-week-panel';
    panel.style.cssText = 'background:#fff;border:1px solid #c8d6e5;border-radius:4px;margin:6px 0 8px;box-shadow:0 2px 8px rgba(0,0,0,0.12);overflow:hidden;';

    panel.innerHTML = `
      <div style="background:#4a86c8;color:#fff;padding:7px 12px;display:flex;align-items:center;gap:10px;user-select:none;">
        <span style="font-weight:bold;font-size:13px;">週表示</span>
        <button class="tm-week-prev" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;">◀ 前週</button>
        <span class="tm-week-label" style="font-size:13px;min-width:130px;text-align:center;"></span>
        <button class="tm-week-next" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;">次週 ▶</button>
        <span style="flex:1;"></span>
        <button class="tm-week-close" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;" title="閉じる">×</button>
      </div>
      <div class="tm-week-body" style="overflow-x:auto;max-height:480px;overflow-y:auto;"></div>
    `;

    panel.querySelector('.tm-week-prev').addEventListener('click', () => shiftWeek(-1));
    panel.querySelector('.tm-week-next').addEventListener('click', () => shiftWeek(1));
    panel.querySelector('.tm-week-close').addEventListener('click', () => {
      panel.remove();
      weekPanelEl = null;
      const btn = document.getElementById('tm-week-toggle');
      if (btn) btn.textContent = '週表示';
    });

    insertBefore.parentElement.insertBefore(panel, insertBefore);
    return panel;
  }

  function addWeekViewButton() {
    const calPager = document.querySelector('.scheduleCalenderPager');
    if (!calPager) {
      console.warn('[tm-schedule-week] .scheduleCalenderPager が見つかりません');
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'tm-week-toggle';
    btn.textContent = '週表示';
    btn.style.cssText = 'background:#4a86c8;color:#fff;border:none;border-radius:3px;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:bold;margin-right:8px;vertical-align:middle;';

    btn.addEventListener('click', () => {
      if (weekPanelEl) {
        weekPanelEl.remove();
        weekPanelEl = null;
        btn.textContent = '週表示';
        return;
      }
      currentMonday = getWeekMonday(getCurrentDate());
      weekPanelEl = createWeekPanel(calPager);
      btn.textContent = '週表示を閉じる';
      loadAndRender();
    });

    calPager.parentElement.insertBefore(btn, calPager);
  }

  function waitAndRun(retries = 20) {
    const ready = document.querySelector('.scheduleCalenderPager') && document.getElementById('date')?.value;
    if (ready) {
      addWeekViewButton();
      console.log('[tm-schedule-week] 初期化完了');
    } else if (retries > 0) {
      setTimeout(() => waitAndRun(retries - 1), 300);
    } else {
      console.warn('[tm-schedule-week] タイムアウト');
    }
  }

  waitAndRun();
})();
