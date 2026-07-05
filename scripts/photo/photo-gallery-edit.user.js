// ==UserScript==
// @name         サロンボード 画像アップロード編集（トリミング・余白追加）
// @namespace    https://github.com/catdance124/tm-salon-board
// @version      1.2.0
// @description  画像アップロード時にトリミング・余白追加（アスペクト比調整）ができる編集画面を追加。フォトギャラリー・クーポン編集など、共通の画像アップローダーを使う画面全般で動作。フォトギャラリーは既存写真の編集・再アップロードにも対応
// @author       catdance124
// @match        https://salonboard.com/CNK/draft/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MAX_DIM = 2400;          // 出力画像の最長辺（px）の上限
  const DEFAULT_MAX_BYTES = 10485760; // 約10MB（#fileSizeLimit が取れない場合のフォールバック）

  // アスペクト比プリセット（label と 比率 w/h、自由は NaN）
  const ASPECT_PRESETS = [
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
    // salon board は正確な 1:1 を縦長(3:4)枠として扱い、4:3 表示枠の中で画像が小さく
    // 余白だらけになる。見た目はほぼ正方形のまま「横長」と判定させるため僅かに横長(1.01:1)にする。
    { label: '1:1', value: 1.01 },
    { label: '16:9', value: 16 / 9 },
    { label: '自由', value: NaN },
  ];

  // 編集済みファイルの目印（再ラップでエディタが再帰起動しないように）
  const editedFiles = new WeakSet();

  // ラップ前の本来の addWaitImgeFile（新規・既存編集の両経路から後勝ちで waitImgeFile を上書きする）
  let origAddWaitImgeFile = null;

  // 起動は IIFE 末尾（injectStyle が参照する CSS 定数の初期化後）で行う

  // ----------------------------------------------------------------
  // addWaitImgeFile のラップ（ファイル選択・D&D の両経路を横取り）
  // ----------------------------------------------------------------

  function waitForHook(retries = 50) {
    if (typeof window.addWaitImgeFile === 'function') {
      wrapAddWaitImgeFile();
    } else if (retries > 0) {
      setTimeout(() => waitForHook(retries - 1), 200);
    }
  }

  function wrapAddWaitImgeFile() {
    origAddWaitImgeFile = window.addWaitImgeFile;
    window.addWaitImgeFile = function (file) {
      // まず本来の挙動（waitImgeFile への保存）を実行
      origAddWaitImgeFile(file);
      // 既に編集済み or 画像でない場合はそのまま
      if (!file || editedFiles.has(file)) return;
      if (!/^image\/(jpe?g|png|gif)$/i.test(file.type)) return;
      // 自前エディタを開く（非同期。適用すれば後勝ちで waitImgeFile を上書き）
      openEditor(file, finishEdit);
    };
  }

  // 編集確定後の共通処理：waitImgeFile を編集後画像に差し替え、サイトの「登録する」を
  // 自動実行して 1 ステップでアップロードする（新規・既存編集の両経路で共有）。
  function finishEdit(editedFile, dataUrl) {
    editedFiles.add(editedFile);
    if (origAddWaitImgeFile) origAddWaitImgeFile(editedFile);
    updateSitePreview(dataUrl);
    triggerSiteUpload();
  }

  // サイト側モーダルのサムネイルプレビューを編集後画像に差し替える
  function updateSitePreview(dataUrl) {
    const thumb = document.querySelector('.jscImageUploaderModalThumbnail');
    const thumbArea = document.querySelector('.jscImageUploaderModalThumbnailArea');
    const dropArea = document.querySelector('.jscImageUploaderModalDropArea');
    const submit = document.querySelector('.jscImageUploaderModalSubmitButton');
    if (thumb) { thumb.classList.remove('isDummy'); thumb.setAttribute('src', dataUrl); }
    if (dropArea) dropArea.classList.remove('isActive');
    if (thumbArea) thumbArea.classList.add('isActive');
    if (submit) submit.classList.add('isActive');
  }

  // サイトの「登録する」ボタンを実行して編集後画像をそのままアップロードする
  function triggerSiteUpload() {
    const submit = document.querySelector('.jscImageUploaderModalSubmitButton');
    if (submit) submit.click();
  }

  function getMaxBytes() {
    const v = parseInt(document.querySelector('#fileSizeLimit')?.value, 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_BYTES;
  }

  // ----------------------------------------------------------------
  // 既存写真の編集・上書き再アップロード
  // ----------------------------------------------------------------

  // 画像ありスロットの操作ボタン群に「編集」ボタンを追加する
  function initSlotEditButtons() {
    document.querySelectorAll('td.jscImgArea').forEach(td => {
      const opDiv = td.querySelector('.operationBtn');
      const idInput = td.querySelector('input.jscPhotogalleryPhotoId');
      if (!opDiv || !idInput) return;
      if (!idInput.value.trim()) return;            // 空きスロットには付けない
      if (opDiv.querySelector('.tm-pe-edit-existing')) return; // 重複付与しない

      const wrap = el('p', 'mt5');
      const btn = textEl('button', 'tm-pe-edit-existing', '編集');
      btn.addEventListener('click', (e) => { e.preventDefault(); editExistingPhoto(td); });
      wrap.appendChild(btn);
      opDiv.appendChild(wrap);
    });
  }

  // 既存写真を読み込んでエディタを開き、同じスロットへ上書き再アップロードする
  async function editExistingPhoto(td) {
    if (document.querySelector('.tm-pe-overlay')) return; // エディタ多重起動防止

    const img = td.querySelector('img[name$=".photogalleryPhoto_IMG"]');
    const id = td.querySelector('input.jscPhotogalleryPhotoId')?.value.trim();
    const uploadBtn = td.querySelector('img.mod_btn_upload');
    if (!img || !id || !uploadBtn) return;

    const base = img.getAttribute('src').split('?')[0];
    // impolicy なし・大バウンド＋キャッシュバスターで実解像度を CORS 取得（汚染回避）
    const url = base + '?w=4000&h=4000&cb=' + Math.random().toString(36).slice(2);

    // 先にそのスロットのアップロードモーダルを開いて #imgUploadForm の文脈を確保
    uploadBtn.click();

    let file;
    try {
      const im = await loadCrossOriginImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = im.naturalWidth;
      canvas.height = im.naturalHeight;
      canvas.getContext('2d').drawImage(im, 0, 0);
      file = await canvasToFile(canvas, 'edit-' + id + '.jpg', 'image/jpeg', getMaxBytes());
    } catch (err) {
      console.error('[tm-photo] 既存画像の取得に失敗:', err);
      alert('既存画像の読み込みに失敗しました。時間をおいて再度お試しください。');
      if (typeof window.modalClose === 'function') window.modalClose();
      return;
    }

    openEditor(file, finishEdit);
  }

  // crossOrigin で画像を読み込む（canvas へ描いて書き出せるようにする）
  function loadCrossOriginImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('画像の読み込みに失敗: ' + url));
      im.src = url;
    });
  }

  // ----------------------------------------------------------------
  // エディタ本体
  // ----------------------------------------------------------------

  function openEditor(file, onApply) {
    // 多重起動防止：サイトはアップロードモーダルを開くたびに document へ drop ハンドラを
    // 重複登録するため、1 回のドロップで addWaitImgeFile（＝本関数）が複数回呼ばれ、
    // エディタが何枚も重なって表示されてしまう。すでに開いていれば無視する。
    if (document.querySelector('.tm-pe-overlay')) return;

    const objectUrl = URL.createObjectURL(file);
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

    // 状態
    const state = {
      mode: 'pad',          // 'pad' | 'crop'（縦長→4:3 が主用途なので余白追加を既定に）
      aspect: 4 / 3,        // 選択中のアスペクト比
      bgColor: '#ffffff',
      margins: { t: 0, r: 0, b: 0, l: 0 }, // % 指定（pad モード用）
    };

    let cropper = null;

    // --- DOM 構築 ---
    const overlay = el('div', 'tm-pe-overlay');
    const dialog = el('div', 'tm-pe-dialog');
    overlay.appendChild(dialog);

    // ヘッダ
    const header = el('div', 'tm-pe-header');
    header.appendChild(textEl('span', 'tm-pe-title', '画像を編集してからアップロード'));
    const closeX = textEl('button', 'tm-pe-x', '×');
    closeX.title = '編集せず閉じる（元画像のまま）';
    header.appendChild(closeX);
    dialog.appendChild(header);

    // ツールバー
    const toolbar = el('div', 'tm-pe-toolbar');

    // モードタブ
    const modeRow = el('div', 'tm-pe-row');
    modeRow.appendChild(textEl('span', 'tm-pe-label', 'モード'));
    const padTab = textEl('button', 'tm-pe-tab', '余白を追加');
    const cropTab = textEl('button', 'tm-pe-tab', '切り抜き');
    modeRow.appendChild(padTab);
    modeRow.appendChild(cropTab);
    toolbar.appendChild(modeRow);

    // アスペクト比プリセット
    const aspectRow = el('div', 'tm-pe-row');
    aspectRow.appendChild(textEl('span', 'tm-pe-label', '比率'));
    const aspectBtns = ASPECT_PRESETS.map(p => {
      const b = textEl('button', 'tm-pe-chip', p.label);
      b.addEventListener('click', () => { state.aspect = p.value; syncAspectUI(); applyAspect(); });
      aspectRow.appendChild(b);
      return { btn: b, value: p.value };
    });
    toolbar.appendChild(aspectRow);

    // 背景色（pad モード）
    const bgRow = el('div', 'tm-pe-row tm-pe-padonly');
    bgRow.appendChild(textEl('span', 'tm-pe-label', '余白の色'));
    const bgPicker = el('input', 'tm-pe-color');
    bgPicker.type = 'color';
    bgPicker.value = state.bgColor;
    bgPicker.addEventListener('input', () => { state.bgColor = bgPicker.value; renderPad(); });
    bgRow.appendChild(bgPicker);
    // 白／黒のショートカット
    ['#ffffff', '#000000'].forEach(c => {
      const sw = el('button', 'tm-pe-swatch');
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => { state.bgColor = c; bgPicker.value = c; renderPad(); });
      bgRow.appendChild(sw);
    });
    toolbar.appendChild(bgRow);

    // 余白スライダー（pad モード）
    const marginRow = el('div', 'tm-pe-row tm-pe-padonly');
    marginRow.appendChild(textEl('span', 'tm-pe-label', '余白(%)'));
    const sliders = {};
    [['t', '上'], ['b', '下'], ['l', '左'], ['r', '右']].forEach(([key, lbl]) => {
      const wrap = el('label', 'tm-pe-slider');
      wrap.appendChild(textEl('span', 'tm-pe-slider-lbl', lbl));
      const s = el('input', '');
      s.type = 'range'; s.min = '0'; s.max = '50'; s.step = '1'; s.value = '0';
      const out = textEl('span', 'tm-pe-slider-val', '0');
      s.addEventListener('input', () => { state.margins[key] = +s.value; out.textContent = s.value; renderPad(); });
      sliders[key] = { input: s, out };
      wrap.appendChild(s);
      wrap.appendChild(out);
      marginRow.appendChild(wrap);
    });
    toolbar.appendChild(marginRow);

    dialog.appendChild(toolbar);

    // ボディ（crop ビュー / pad ビュー）
    const body = el('div', 'tm-pe-body');
    const cropWrap = el('div', 'tm-pe-cropwrap');
    const cropImg = el('img', 'tm-pe-cropimg');
    cropImg.src = objectUrl;
    cropWrap.appendChild(cropImg);
    const padWrap = el('div', 'tm-pe-padwrap');
    body.appendChild(cropWrap);
    body.appendChild(padWrap);
    dialog.appendChild(body);

    // フッタ
    const footer = el('div', 'tm-pe-footer');
    footer.appendChild(textEl('span', 'tm-pe-hint', '表示エリアの比率に合わせて切り抜き・余白追加ができます'));
    const cancelBtn = textEl('button', 'tm-pe-btn tm-pe-btn-ghost', 'キャンセル（元画像のまま）');
    const applyBtn = textEl('button', 'tm-pe-btn tm-pe-btn-primary', 'この内容でアップロード');
    footer.appendChild(cancelBtn);
    footer.appendChild(applyBtn);
    dialog.appendChild(footer);

    document.body.appendChild(overlay);

    // 元画像（pad の描画ソース）
    const srcImg = new Image();
    srcImg.onload = () => { syncModeUI(); };
    srcImg.src = objectUrl;

    // --- モード切替 ---
    padTab.addEventListener('click', () => { state.mode = 'pad'; syncModeUI(); });
    cropTab.addEventListener('click', () => { state.mode = 'crop'; syncModeUI(); });

    function syncModeUI() {
      const isPad = state.mode === 'pad';
      padTab.classList.toggle('is-active', isPad);
      cropTab.classList.toggle('is-active', !isPad);
      cropWrap.style.display = isPad ? 'none' : 'flex';
      padWrap.style.display = isPad ? 'flex' : 'none';
      dialog.querySelectorAll('.tm-pe-padonly').forEach(n => { n.style.display = isPad ? '' : 'none'; });
      syncAspectUI();
      if (isPad) {
        destroyCropper();
        renderPad();
      } else {
        initCropper();
      }
    }

    function syncAspectUI() {
      aspectBtns.forEach(({ btn, value }) => {
        const active = (isNaN(value) && isNaN(state.aspect)) || value === state.aspect;
        btn.classList.toggle('is-active', active);
      });
    }

    function applyAspect() {
      if (state.mode === 'crop') {
        if (cropper) cropper.setAspectRatio(state.aspect);
      } else {
        renderPad();
      }
    }

    // --- Cropper ---
    function initCropper() {
      if (cropper) return;
      const Cr = window.Cropper;
      cropper = new Cr(cropImg, {
        viewMode: 1,
        autoCropArea: 1,
        background: true,
        responsive: true,
        aspectRatio: state.aspect,
      });
    }
    function destroyCropper() {
      if (cropper) { cropper.destroy(); cropper = null; }
    }

    // --- pad レンダリング ---
    function renderPad() {
      if (!srcImg.complete || !srcImg.naturalWidth) return;
      const canvas = buildPadCanvas(srcImg, state);
      padWrap.innerHTML = '';
      canvas.classList.add('tm-pe-padcanvas');
      padWrap.appendChild(canvas);
    }

    // --- 適用 / キャンセル ---
    function cleanup() {
      destroyCropper();
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
    }

    closeX.addEventListener('click', cleanup);
    cancelBtn.addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = '処理中…';
      try {
        const canvas = state.mode === 'crop'
          ? cropper.getCroppedCanvas({ maxWidth: MAX_DIM, maxHeight: MAX_DIM, fillColor: '#fff' })
          : buildPadCanvas(srcImg, state);
        const dataUrl = canvas.toDataURL(outputType, 0.92);
        const editedFile = await canvasToFile(canvas, file.name, outputType, getMaxBytes());
        cleanup();
        onApply(editedFile, dataUrl);
      } catch (err) {
        console.error('[tm-photo] 編集適用に失敗:', err);
        alert('画像の編集に失敗しました: ' + err.message);
        applyBtn.disabled = false;
        applyBtn.textContent = 'この内容でアップロード';
      }
    });
  }

  // 余白追加 canvas を生成（contain 配置 + 余白 + 目標比率）
  function buildPadCanvas(img, state) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const mt = ih * state.margins.t / 100, mb = ih * state.margins.b / 100;
    const ml = iw * state.margins.l / 100, mr = iw * state.margins.r / 100;
    const boxW = iw + ml + mr, boxH = ih + mt + mb;
    let finalW = boxW, finalH = boxH;
    if (!isNaN(state.aspect)) {
      if (boxW / boxH < state.aspect) finalW = boxH * state.aspect;
      else finalH = boxW / state.aspect;
    }
    const scale = Math.min(1, MAX_DIM / Math.max(finalW, finalH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(finalW * scale));
    canvas.height = Math.max(1, Math.round(finalH * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const offX = ((finalW - boxW) / 2 + ml) * scale;
    const offY = ((finalH - boxH) / 2 + mt) * scale;
    ctx.drawImage(img, offX, offY, iw * scale, ih * scale);
    return canvas;
  }

  // canvas → File（JPEG は上限超過時に quality を段階的に下げる）
  function canvasToFile(canvas, origName, type, maxBytes) {
    const ext = type === 'image/png' ? 'png' : 'jpg';
    const base = (origName || 'image').replace(/\.[^.]+$/, '') || 'image';
    const name = base + '.' + ext;

    return new Promise((resolve, reject) => {
      let quality = 0.92;
      const attempt = () => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob に失敗しました')); return; }
          if (type === 'image/jpeg' && blob.size > maxBytes && quality > 0.4) {
            quality -= 0.1;
            attempt();
            return;
          }
          resolve(new File([blob], name, { type }));
        }, type, type === 'image/jpeg' ? quality : undefined);
      };
      attempt();
    });
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
    style.textContent = CROPPER_CSS + TM_CSS;
    document.head.appendChild(style);
  }

  // Cropper.js v1.6.2 CSS（@grant none のため CSS はインライン埋め込み）
  const CROPPER_CSS = `
.cropper-container{direction:ltr;font-size:0;line-height:0;position:relative;-ms-touch-action:none;touch-action:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}.cropper-container img{backface-visibility:hidden;display:block;height:100%;image-orientation:0deg;max-height:none!important;max-width:none!important;min-height:0!important;min-width:0!important;width:100%}.cropper-canvas,.cropper-crop-box,.cropper-drag-box,.cropper-modal,.cropper-wrap-box{bottom:0;left:0;position:absolute;right:0;top:0}.cropper-canvas,.cropper-wrap-box{overflow:hidden}.cropper-drag-box{background-color:#fff;opacity:0}.cropper-modal{background-color:#000;opacity:.5}.cropper-view-box{display:block;height:100%;outline:1px solid #39f;outline-color:rgba(51,153,255,.75);overflow:hidden;width:100%}.cropper-dashed{border:0 dashed #eee;display:block;opacity:.5;position:absolute}.cropper-dashed.dashed-h{border-bottom-width:1px;border-top-width:1px;height:33.33333%;left:0;top:33.33333%;width:100%}.cropper-dashed.dashed-v{border-left-width:1px;border-right-width:1px;height:100%;left:33.33333%;top:0;width:33.33333%}.cropper-center{display:block;height:0;left:50%;opacity:.75;position:absolute;top:50%;width:0}.cropper-center:after,.cropper-center:before{background-color:#eee;content:" ";display:block;position:absolute}.cropper-center:before{height:1px;left:-3px;top:0;width:7px}.cropper-center:after{height:7px;left:0;top:-3px;width:1px}.cropper-face,.cropper-line,.cropper-point{display:block;height:100%;opacity:.1;position:absolute;width:100%}.cropper-face{background-color:#fff;left:0;top:0}.cropper-line{background-color:#39f}.cropper-line.line-e{cursor:ew-resize;right:-3px;top:0;width:5px}.cropper-line.line-n{cursor:ns-resize;height:5px;left:0;top:-3px}.cropper-line.line-w{cursor:ew-resize;left:-3px;top:0;width:5px}.cropper-line.line-s{bottom:-3px;cursor:ns-resize;height:5px;left:0}.cropper-point{background-color:#39f;height:5px;opacity:.75;width:5px}.cropper-point.point-e{cursor:ew-resize;margin-top:-3px;right:-3px;top:50%}.cropper-point.point-n{cursor:ns-resize;left:50%;margin-left:-3px;top:-3px}.cropper-point.point-w{cursor:ew-resize;left:-3px;margin-top:-3px;top:50%}.cropper-point.point-s{bottom:-3px;cursor:s-resize;left:50%;margin-left:-3px}.cropper-point.point-ne{cursor:nesw-resize;right:-3px;top:-3px}.cropper-point.point-nw{cursor:nwse-resize;left:-3px;top:-3px}.cropper-point.point-sw{bottom:-3px;cursor:nesw-resize;left:-3px}.cropper-point.point-se{bottom:-3px;cursor:nwse-resize;height:20px;opacity:1;right:-3px;width:20px}@media (min-width:768px){.cropper-point.point-se{height:15px;width:15px}}@media (min-width:992px){.cropper-point.point-se{height:10px;width:10px}}@media (min-width:1200px){.cropper-point.point-se{height:5px;opacity:.75;width:5px}}.cropper-point.point-se:before{background-color:#39f;bottom:-50%;content:" ";display:block;height:200%;opacity:0;position:absolute;right:-50%;width:200%}.cropper-invisible{opacity:0}.cropper-bg{background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAAA3NCSVQICAjb4U/gAAAABlBMVEXMzMz////TjRV2AAAACXBIWXMAAArrAAAK6wGCiw1aAAAAHHRFWHRTb2Z0d2FyZQBBZG9iZSBGaXJld29ya3MgQ1M26LyyjAAAABFJREFUCJlj+M/AgBVhF/0PAH6/D/HkDxOGAAAAAElFTkSuQmCC")}.cropper-hide{display:block;height:0;position:absolute;width:0}.cropper-hidden{display:none!important}.cropper-move{cursor:move}.cropper-crop{cursor:crosshair}.cropper-disabled .cropper-drag-box,.cropper-disabled .cropper-face,.cropper-disabled .cropper-line,.cropper-disabled .cropper-point{cursor:not-allowed}
`;

  const TM_CSS = `
.tm-pe-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;font-size:13px;color:#333}
.tm-pe-dialog{background:#fff;border-radius:8px;width:min(880px,94vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.35);overflow:hidden}
.tm-pe-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e5e5}
.tm-pe-title{font-weight:bold;font-size:15px}
.tm-pe-x{border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:#888;padding:0 4px}
.tm-pe-x:hover{color:#333}
.tm-pe-toolbar{padding:10px 16px;border-bottom:1px solid #eee;display:flex;flex-direction:column;gap:8px}
.tm-pe-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.tm-pe-label{min-width:54px;color:#667;font-weight:bold}
.tm-pe-tab{padding:5px 14px;border:1px solid #5a9fd4;background:#fff;color:#5a9fd4;border-radius:4px;cursor:pointer;font-size:13px}
.tm-pe-tab.is-active{background:#5a9fd4;color:#fff}
.tm-pe-chip{padding:4px 10px;border:1px solid #ccc;background:#fff;color:#555;border-radius:14px;cursor:pointer;font-size:12px}
.tm-pe-chip.is-active{border-color:#5a9fd4;background:#eef4fb;color:#3a7fb4;font-weight:bold}
.tm-pe-color{width:36px;height:24px;border:1px solid #ccc;border-radius:4px;cursor:pointer;padding:0;background:#fff}
.tm-pe-swatch{width:22px;height:22px;border:1px solid #ccc;border-radius:4px;cursor:pointer}
.tm-pe-slider{display:flex;align-items:center;gap:4px}
.tm-pe-slider-lbl{color:#778;width:14px;text-align:center}
.tm-pe-slider input[type=range]{width:80px}
.tm-pe-slider-val{width:22px;text-align:right;color:#556;font-variant-numeric:tabular-nums}
.tm-pe-body{flex:1;min-height:0;background:#f4f4f4;display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto}
.tm-pe-cropwrap{width:100%;max-height:60vh;display:flex;align-items:center;justify-content:center}
.tm-pe-cropimg{max-width:100%;max-height:60vh;display:block}
.tm-pe-padwrap{display:flex;align-items:center;justify-content:center;max-height:60vh;max-width:100%}
.tm-pe-padcanvas{max-width:100%;max-height:60vh;box-shadow:0 0 0 1px #ddd, 0 2px 8px rgba(0,0,0,.15)}
.tm-pe-footer{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #e5e5e5}
.tm-pe-hint{flex:1;color:#999;font-size:12px}
.tm-pe-btn{padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;border:1px solid transparent}
.tm-pe-btn-ghost{background:#fff;border-color:#ccc;color:#666}
.tm-pe-btn-ghost:hover{background:#f5f5f5}
.tm-pe-btn-primary{background:#e8883a;color:#fff}
.tm-pe-btn-primary:hover:not(:disabled){background:#c06820}
.tm-pe-btn-primary:disabled{background:#bbb;cursor:default}
.tm-pe-edit-existing{display:inline-block;padding:2px 10px;font-size:11px;line-height:1.6;color:#fff;background:#5a9fd4;border:none;border-radius:3px;cursor:pointer}
.tm-pe-edit-existing:hover{background:#3a7fb4}
`;

  // ---- 起動（CSS 定数初期化後に実行） ----
  injectStyle();
  waitForHook();
  initSlotEditButtons();
})();
