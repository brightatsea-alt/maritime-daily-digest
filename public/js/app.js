/* FormFill UI — 5 independent rows, each: sources (left) → template (right) */
(() => {
  'use strict';
  const ROWS = 5;
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const $ = (sel, el = document) => el.querySelector(sel);
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const toast = (msg, ms = 3500) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), ms); };
  const readBytes = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(file); });
  const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const icon = (ext) => ({ docx: '📄', dotx: '📄', hwp: '📝', hwpx: '📝', xlsx: '📊', xlsm: '📊', pptx: '📽', pdf: '📕', eml: '✉', msg: '✉', txt: '📃', md: '📃', text: '✎', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼' }[ext] || '📎');

  // ── server status / password ──
  const apiKeyHeader = () => { const k = sessionStorage.getItem('ff_key'); return k ? { 'x-app-key': k } : {}; };
  async function checkServer() {
    const pill = $('#apiStatus');
    try {
      const r = await fetch('/api/fill', { headers: apiKeyHeader() }); const j = await r.json();
      if (j.needsPassword) { $('#btnPw').hidden = false; if (!sessionStorage.getItem('ff_key')) askPassword(); }
      pill.textContent = j.hasKey ? `서버 연결됨 · ${j.model}` : 'CLAUDE_API_KEY 미설정'; pill.className = 'pill ' + (j.hasKey ? 'ok' : 'bad');
    } catch (e) { pill.textContent = '서버 함수 없음 (로컬 미리보기)'; pill.className = 'pill bad'; }
  }
  function askPassword() { const k = prompt('접속 비밀번호를 입력하세요'); if (k != null) { sessionStorage.setItem('ff_key', k); checkServer(); } }
  $('#btnPw').onclick = askPassword;
  $('#btnReset').onclick = () => { if (confirm('모든 자료와 서식을 지우고 초기화할까요?')) location.reload(); };

  // ── rows ──
  const rows = [];
  const main = $('#rows'); const tpl = $('#rowTpl');
  for (let i = 0; i < ROWS; i++) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    $('.row-no', node).textContent = i + 1; $('.n', node).textContent = i + 1;
    node.querySelectorAll('input[name="__LANG__"]').forEach((r) => (r.name = 'lang' + i));
    main.appendChild(node);
    rows.push(makeRow(node, i));
  }

  function makeRow(el, idx) {
    const st = { el, idx, sources: [], template: null, tpl: null, edits: null, result: null, busy: false };
    const srcDrop = $('.src-drop', el), srcInput = $('.src-input', el), srcList = $('.src-list', el), srcSum = $('.src-sum', el);
    const tplDrop = $('.tpl-drop', el), tplInput = $('.tpl-input', el), tplInfo = $('.tpl-info', el);
    const btnFill = $('.btn-fill', el), btnDl = $('.btn-download', el), btnRe = $('.btn-reapply', el);
    const prog = $('.progress', el), result = $('.result', el), state = $('.row-state', el);

    // drag & drop wiring
    function wireDrop(zone, input, onFiles) {
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
      input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
      zone.addEventListener('drop', (e) => onFiles([...e.dataTransfer.files]));
    }
    wireDrop(srcDrop, srcInput, addSourceFiles);
    wireDrop(tplDrop, tplInput, (files) => files[0] && setTemplate(files[0]));
    // paste into the whole left pane also works for files
    $('.pane.left', el).addEventListener('paste', (e) => { const files = [...(e.clipboardData.files || [])]; if (files.length) { e.preventDefault(); addSourceFiles(files); } });

    $('.priority-text', el).addEventListener('input', updateButtons);
    $('.btn-add-text', el).onclick = () => {
      const ta = $('.paste-text', el); const text = ta.value.trim(); if (!text) return;
      st.sources.push({ id: Date.now() + Math.random(), name: `붙인 텍스트 ${st.sources.filter((s) => s.kind === 'text').length + 1}`, kind: 'text', ext: 'text', text, size: text.length });
      ta.value = ''; renderSources();
    };

    async function addSourceFiles(files) {
      for (const f of files) {
        const ext = FormFill.extOf(f.name);
        const item = { id: Date.now() + Math.random(), name: f.name, ext, size: f.size, kind: 'file', text: '', status: '읽는 중…' };
        st.sources.push(item); renderSources();
        try {
          const bytes = await readBytes(f);
          if (IMG_EXT.includes(ext)) {
            if (bytes.length > 4.5 * 1048576) throw new Error('이미지는 4.5MB 이하만 가능합니다');
            item.kind = 'image'; item.b64 = toB64(bytes); item.media = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`; item.status = '이미지 (Claude가 직접 읽음)';
          } else {
            item.text = await FormFill.extractText({ name: f.name, bytes });
            item.status = `${item.text.length.toLocaleString()}자 추출`;
            if (!item.text.trim()) { item.status = '텍스트 없음 (스캔 PDF/이미지 기반일 수 있음)'; item.warn = true; }
          }
        } catch (e) { item.err = true; item.status = '읽기 실패: ' + (e.message || e); }
        renderSources();
      }
    }
    function renderSources() {
      srcList.innerHTML = '';
      for (const s of st.sources) {
        const li = document.createElement('li'); if (s.err) li.classList.add('err');
        li.innerHTML = `<span class="ic">${icon(s.ext)}</span><span class="nm" title="${s.name}">${s.name}</span><span class="sz">${s.kind === 'text' ? s.size.toLocaleString() + '자' : fmtSize(s.size)}${s.status ? ' · ' + s.status : ''}</span><button class="rm" title="제거">✕</button>`;
        $('.rm', li).onclick = () => { st.sources = st.sources.filter((x) => x !== s); renderSources(); };
        srcList.appendChild(li);
      }
      const n = st.sources.filter((s) => !s.err).length; const chars = st.sources.reduce((a, s) => a + (s.text ? s.text.length : 0), 0);
      srcSum.textContent = n ? `자료 ${n}건 · 텍스트 ${chars.toLocaleString()}자 ${st.sources.some((s) => s.kind === 'image') ? '· 이미지 포함' : ''}` : '';
      updateButtons();
    }

    async function setTemplate(file) {
      tplInfo.hidden = false; $('.tpl-name', tplInfo).textContent = file.name; $('.tpl-meta', tplInfo).textContent = '서식 분석 중…';
      st.template = null; st.tpl = null; st.edits = null; st.result = null; result.hidden = true; btnDl.hidden = true; btnRe.hidden = true;
      try {
        const bytes = await readBytes(file);
        const t = await FormFill.openTemplate({ name: file.name, bytes });
        st.template = { name: file.name, bytes }; st.tpl = t;
        const blanks = t.slots.filter((s) => !s.text.trim()).length;
        $('.tpl-meta', tplInfo).textContent = `${t.kind.toUpperCase()} · 편집 가능 단위 ${t.slots.length.toLocaleString()}개 (빈칸 ${blanks}) · ${fmtSize(bytes.length)}`;
        $('.tpl-view pre', tplInfo).textContent = t.view;
      } catch (e) { $('.tpl-meta', tplInfo).textContent = '⚠ ' + (e.message || e); }
      updateButtons();
    }

    function updateButtons() {
      const ready = st.tpl && (st.sources.some((s) => !s.err && (s.text || s.kind === 'image')) || $('.priority-text', el).value.trim()) && !st.busy;
      btnFill.disabled = !ready;
      btnFill.textContent = st.edits ? '▶ 추가 자료 반영해서 다시 채우기' : '▶ 자료로 서식 채우기';
      state.textContent = st.busy ? '처리 중…' : st.result ? '완료 — 다운로드 가능' : st.tpl ? (ready ? '준비됨' : '자료를 추가하세요') : st.sources.length ? '서식을 올리세요' : '';
    }
    function setProgress(msg) { if (msg) { prog.hidden = false; $('.msg', prog).textContent = msg; } else prog.hidden = true; }

    btnFill.onclick = async () => {
      if (!st.tpl) return; st.busy = true; updateButtons(); setProgress('Claude가 자료를 읽고 서식 항목을 찾는 중…');
      try {
        const payload = {
          kind: st.tpl.kind, view: st.tpl.view,
          sources: st.sources.filter((s) => s.text && !s.err).map((s) => ({ name: s.name, text: s.text })),
          images: st.sources.filter((s) => s.kind === 'image').map((s) => ({ name: s.name, media_type: s.media, data: s.b64 })),
          hint: $('.hint-text', el).value.trim(), previous: st.edits || null,
          priority: $('.priority-text', el).value.trim(),
          lang: ($('.lang input:checked', el) || {}).value || 'auto',
        };
        const r = await fetch('/api/fill', { method: 'POST', headers: { 'content-type': 'application/json', ...apiKeyHeader() }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        st.edits = j.edits || {}; st.unresolved = j.unresolved || []; st.notes = j.notes || '';
        setProgress('서식에 값을 기입하는 중…');
        await buildResult();
        renderResult();
        toast(`작업 ${idx + 1}: ${Object.keys(st.edits).length}개 항목 기입 완료`);
      } catch (e) { toast('실패: ' + (e.message || e), 6000); }
      st.busy = false; setProgress(null); updateButtons();
    };

    async function buildResult() {
      // always apply onto the pristine original so the format never degrades across re-runs
      const fresh = await FormFill.openTemplate({ name: st.template.name, bytes: st.template.bytes.slice() });
      st.result = await fresh.apply(st.edits);
      try { const filled = await FormFill.openTemplate({ name: st.template.name, bytes: st.result.slice() }); $('.preview pre', result).textContent = filled.view.replace(/\[#[^\]]+\]/g, ''); } catch (e) { $('.preview pre', result).textContent = '(미리보기 불가)'; }
      btnDl.hidden = false; btnRe.hidden = false;
    }
    function renderResult() {
      result.hidden = false;
      $('.notes', result).textContent = st.notes || '';
      const un = $('.unresolved', result);
      un.innerHTML = st.unresolved && st.unresolved.length ? `자료에서 찾지 못한 항목 ${st.unresolved.length}건<ul>${st.unresolved.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : '';
      const tb = $('.edits tbody', result); tb.innerHTML = '';
      const slotText = Object.fromEntries(st.tpl.slots.map((s) => [s.id, s.text]));
      const ids = Object.keys(st.edits);
      $('.edits .cnt', result).textContent = ids.length + '건';
      for (const id of ids) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="id">${esc(id)}</td><td class="old" title="${esc(slotText[id] || '')}">${esc(slotText[id] || '(빈칸)')}</td><td class="new"><textarea rows="1"></textarea></td>`;
        const ta = $('textarea', tr); ta.value = st.edits[id]; ta.oninput = () => { st.edits[id] = ta.value; btnRe.disabled = false; };
        tb.appendChild(tr);
      }
    }
    btnRe.onclick = async () => { setProgress('수정값 반영 중…'); try { await buildResult(); toast('수정값을 반영했습니다. 다운로드하세요.'); } catch (e) { toast('실패: ' + e.message, 6000); } setProgress(null); };
    btnDl.onclick = () => {
      if (!st.result) return;
      const ext = FormFill.extOf(st.template.name); const base = st.template.name.replace(/\.[^.]+$/, '');
      const blob = new Blob([st.result], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${base}_filled.${ext}`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    };
    return st;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.addEventListener('beforeunload', (e) => { if (rows.some((r) => r.sources.length || r.tpl)) { e.preventDefault(); e.returnValue = ''; } });
  checkServer();
})();
