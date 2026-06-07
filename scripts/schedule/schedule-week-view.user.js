// ==UserScript==
// @name         サロンボード スケジュール 週表示
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      1.1.0
// @description  スケジュール画面に7日分の週表示を追加する（1時間区切り・固定ヘッダー）
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
    if (v.length === 8) return new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
    return new Date();
  }

  function formatDateYMD(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatTime(t) {
    if (!t || t.length < 4) return t || '';
    return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  }

  function addMinutes(timeStr, minutes) {
    const h = parseInt(timeStr.slice(0, 2), 10), m = parseInt(timeStr.slice(2, 4), 10);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}`;
  }

  function timeToMin(t) {
    return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2, 4), 10);
  }

  function getWeekMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getTimeSlots(openTime, closeTime) {
    const slots = [];
    const openHour = Math.floor(timeToMin(openTime) / 60);
    const closeHour = Math.floor(timeToMin(closeTime) / 60);
    for (let h = openHour; h < closeHour; h++) {
      slots.push(`${String(h).padStart(2, '0')}00`);
    }
    return slots;
  }

  async function fetchSchedule(dateStr) {
    const url = `/KLP/schedule/salonSchedule/retrieveScheduleJson?date=${dateStr}&org.apache.struts.taglib.html.TOKEN=${getToken()}&storeIdForMultipleTabCheck=${getStoreId()}&_=${Date.now()}`;
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

  function buildReserveMap(data) {
    const map = new Map();
    for (const r of [...(data.netReservations || []), ...(data.extReservations || [])]) {
      map.set(r.reserveId || r.id, r);
    }
    return map;
  }

  function renderTimeCell(ss, reserveMap, slotTime) {
    const slotStart = timeToMin(slotTime);
    const slotEnd = slotStart + 60;

    if (!ss) return `<td style="border:1px solid #ebebeb;min-width:90px;height:32px;"></td>`;

    const allDayPlan = ss.plans?.find(p => p.isAllDay);
    if (allDayPlan) {
      return `<td style="background:#eeeeee;border:1px solid #e0e0e0;min-width:90px;height:32px;"></td>`;
    }

    const overlapping = [];
    for (const a of (ss.assignments || [])) {
      const s = timeToMin(a.startTime), e = s + a.execTime;
      if (s < slotEnd && e > slotStart) {
        overlapping.push({ type: 'rsv', startMin: s, assignment: a, rsv: reserveMap.get(a.reserveId) });
      }
    }
    for (const p of (ss.plans || []).filter(p => !p.isAllDay)) {
      const s = timeToMin(p.startTime), e = s + p.execTime;
      if (s < slotEnd && e > slotStart) {
        overlapping.push({ type: 'plan', startMin: s, plan: p });
      }
    }

    if (overlapping.length === 0) {
      return `<td style="background:#fff;border:1px solid #ebebeb;min-width:90px;height:32px;"></td>`;
    }

    const blocks = overlapping
      .sort((a, b) => a.startMin - b.startMin)
      .map(item => {
        if (item.type === 'rsv') {
          const { assignment: a, rsv } = item;
          const color = rsv?.coupons?.[0]?.categories?.[0]?.iconColor || 'b0c4de';
          const isStart = timeToMin(a.startTime) >= slotStart;
          const name = rsv?.reserveName || rsv?.customer?.name || '';
          const routeShort = rsv?.routeShortName ? `[${rsv.routeShortName}] ` : '';
          const endTime = addMinutes(a.startTime, a.execTime);
          const tooltip = `${name}\n${formatTime(a.startTime)}〜${formatTime(endTime)}(${a.execTime}分)`;
          return `<div style="background:#${color}44;border-left:3px solid #${color};padding:1px 4px;margin:1px 0;border-radius:2px;font-size:11px;line-height:1.5;" title="${tooltip}">${
            isStart
              ? `<span style="color:#555;font-size:10px;">${formatTime(a.startTime)}</span> <strong>${routeShort}${name}</strong>`
              : `<span style="color:#999;font-size:10px;">↑ ${routeShort}${name}</span>`
          }</div>`;
        } else {
          const { plan: p } = item;
          const isStart = timeToMin(p.startTime) >= slotStart;
          const endTime = addMinutes(p.startTime, p.execTime);
          const tooltip = `${p.title}\n${formatTime(p.startTime)}〜${formatTime(endTime)}`;
          return `<div style="background:#e8e8e855;border-left:3px solid #aaa;padding:1px 4px;margin:1px 0;border-radius:2px;font-size:11px;line-height:1.5;" title="${tooltip}">${
            isStart
              ? `<span style="color:#555;font-size:10px;">${formatTime(p.startTime)}</span> <span style="color:#555;">${p.title || '予定'}</span>`
              : `<span style="color:#999;font-size:10px;">↑ ${p.title || '予定'}</span>`
          }</div>`;
        }
      }).join('');

    return `<td style="background:#fff;vertical-align:top;padding:2px;border:1px solid #ebebeb;min-width:90px;">${blocks}</td>`;
  }

  function renderWeekTable(weekData, staffList) {
    const todayStr = formatDateYMD(new Date());
    const reserveMaps = weekData.map(({ data }) => buildReserveMap(data || {}));

    const firstData = weekData.find(d => d.data?.result === 'success')?.data;
    const slots = getTimeSlots(firstData?.openTime || '0900', firstData?.closeTime || '2100');

    const staffThs = staffList.map(s =>
      `<th style="position:sticky;top:0;z-index:10;padding:6px 8px;background:#e0e8f0;border:1px solid #c8d6e5;white-space:nowrap;font-size:12px;text-align:center;min-width:90px;">${s.name}</th>`
    ).join('');

    const rows = weekData.map(({ date, dateStr }, dayIdx) => {
      const dow = date.getDay();
      const isToday = dateStr === todayStr;
      const fgColor = isToday ? '#1a73e8' : dow === 0 ? '#c62828' : dow === 6 ? '#1565c0' : '#333';
      const bgColor = isToday ? '#dce8fb' : dow === 0 ? '#fde8e8' : dow === 6 ? '#e8eef8' : '#f0f0f0';
      const label = `${date.getMonth() + 1}/${date.getDate()}(${DAYS_JA[dow]})`;
      const data = weekData[dayIdx].data;
      const reserveMap = reserveMaps[dayIdx];

      const totalCols = staffList.length + 1;
      const dateHeaderRow = `<tr>
        <td colspan="${totalCols}" style="padding:3px 10px;background:${bgColor};color:${fgColor};font-weight:bold;border:1px solid #ccc;border-top:2px solid #aab8cc;">
          <a href="/KLP/schedule/salonSchedule/?date=${dateStr}" style="color:inherit;text-decoration:none;">${label}</a>
        </td>
      </tr>`;

      // 休日スタッフを調べて日付ヘッダーに表示
      const holidayStaffs = staffList.filter(staff => {
        const ss = data?.staffSchedules?.find(s => s.stock?.staffId === staff.staffId);
        return ss?.plans?.some(p => p.isAllDay);
      }).map(s => s.name);

      const slotRows = slots.map(slot => {
        const timeTd = `<td style="padding:1px 6px;background:#f8f8f8;border:1px solid #e8e8e8;font-size:11px;color:#888;text-align:right;white-space:nowrap;width:38px;vertical-align:middle;">${formatTime(slot)}</td>`;
        const staffCells = staffList.map(staff => {
          const ss = data?.staffSchedules?.find(s => s.stock?.staffId === staff.staffId);
          return renderTimeCell(ss, reserveMap, slot);
        }).join('');
        return `<tr>${timeTd}${staffCells}</tr>`;
      }).join('');

      return dateHeaderRow + slotRows;
    }).join('');

    return `<div style="overflow-y:auto;max-height:600px;">
      <table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr>
            <th style="position:sticky;top:0;z-index:10;width:38px;background:#e0e8f0;border:1px solid #c8d6e5;"></th>
            ${staffThs}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  let currentMonday = null;
  let weekPanelEl = null;

  function updateWeekLabel() {
    const label = weekPanelEl?.querySelector('.tm-week-label');
    if (!label) return;
    const end = new Date(currentMonday);
    end.setDate(end.getDate() + 6);
    label.textContent = `${currentMonday.getMonth() + 1}/${currentMonday.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}`;
  }

  async function loadAndRender() {
    const body = weekPanelEl?.querySelector('.tm-week-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:24px;color:#888;font-size:13px;">読み込み中...</div>';
    try {
      const weekData = await fetchWeekData(currentMonday);
      const staffList = buildStaffList(weekData);
      if (!staffList.length) {
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
      <div class="tm-week-body"></div>
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
