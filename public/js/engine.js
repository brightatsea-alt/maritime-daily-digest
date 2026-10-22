/* FormFill engine — parses source documents to text, and opens form templates as
 * editable "slots" so that only text values change and the original file format
 * (docx / xlsx / pptx / hwpx / hwp / pdf-form / txt …) is preserved byte-for-byte
 * everywhere else.
 *
 * Works in the browser (globals JSZip, CFB, pako, PDFLib, pdfjsLib) and in Node
 * (call FormFill.setDeps({...}) with the same libraries plus DOMParser/XMLSerializer).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormFill = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const g = (n) => { try { const v = (0, eval)(`typeof ${n} !== 'undefined' ? ${n} : null`); return v; } catch (e) { return null; } };
  const deps = { JSZip: g('JSZip'), CFB: g('CFB'), pako: g('pako'), PDFLib: g('PDFLib'), pdfjsLib: g('pdfjsLib'), DOMParser: g('DOMParser'), XMLSerializer: g('XMLSerializer') };
  function setDeps(d) { Object.assign(deps, d); }

  // ───────────────────────── helpers ─────────────────────────
  const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

  function decodeText(bytes) {
    // BOM detection, then UTF-8 (strict) → EUC-KR fallback
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { try { return new TextDecoder('euc-kr').decode(bytes); } catch (e2) { return new TextDecoder('utf-8').decode(bytes); } }
  }

  function parseXml(str) {
    const doc = new deps.DOMParser().parseFromString(str, 'application/xml');
    const err = doc.getElementsByTagName('parsererror');
    if (err && err.length) throw new Error('XML parse error');
    return doc;
  }
  function serializeXml(doc, original) {
    let out = new deps.XMLSerializer().serializeToString(doc);
    if (!/^\s*<\?xml/.test(out)) {
      const m = original.match(/^\s*<\?xml[^>]*\?>/);
      out = (m ? m[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>') + '\n' + out;
    }
    return out;
  }
  // namespace-agnostic local-name matching
  const ln = (el) => el.localName || el.nodeName.replace(/^.*:/, '');
  function descendants(el, local) {
    const out = [];
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1) { if (ln(c) === local) out.push(c); walk(c); }
      }
    })(el);
    return out;
  }
  function children(el, local) {
    const out = [];
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!local || ln(c) === local)) out.push(c);
    return out;
  }
  function closest(el, local, stopAt) {
    let n = el.parentNode;
    while (n && n.nodeType === 1 && n !== stopAt) { if (ln(n) === local) return n; n = n.parentNode; }
    return null;
  }
  const textOf = (el) => (el.textContent || '');
  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  // ───────────────────────── SOURCE TEXT EXTRACTION ─────────────────────────
  async function extractText(file) {
    const ext = extOf(file.name);
    const bytes = file.bytes;
    switch (ext) {
      case 'docx': case 'dotx': return await extractDocx(bytes);
      case 'xlsx': case 'xlsm': return await extractXlsx(bytes);
      case 'pptx': return await extractPptx(bytes);
      case 'hwpx': return await extractHwpx(bytes);
      case 'hwp': return extractHwp(bytes);
      case 'pdf': return await extractPdf(bytes);
      case 'eml': return extractEml(decodeText(bytes));
      case 'msg': return extractMsg(bytes);
      case 'html': case 'htm': return htmlToText(decodeText(bytes));
      case 'json': case 'csv': case 'tsv': case 'txt': case 'md': case 'log': case 'xml': case 'ini': case 'yaml': case 'yml':
      default:
        if (isZip(bytes)) {
          // unknown OOXML-ish zip: dump all xml text
          const zip = await deps.JSZip.loadAsync(bytes); let out = '';
          for (const n of Object.keys(zip.files)) if (/\.xml$/i.test(n)) out += xmlText(await zip.file(n).async('string')) + '\n';
          return out;
        }
        return decodeText(bytes);
    }
  }
  const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
  const xmlText = (xml) => xml.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/[ \t]+/g, ' ').trim();

  async function extractDocx(bytes) {
    const zip = await deps.JSZip.loadAsync(bytes);
    const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
    let out = [];
    for (const p of parts) {
      const doc = parseXml(await zip.file(p).async('string'));
      out.push(linearizeBlock(doc.documentElement, 'w', null).view);
    }
    return out.join('\n');
  }
  async function extractPptx(bytes) {
    const zip = await deps.JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)/)[1] - +b.match(/(\d+)/)[1]);
    let out = [];
    for (const s of slides) {
      const doc = parseXml(await zip.file(s).async('string'));
      out.push(`--- ${s.replace('ppt/slides/', '')} ---`);
      out.push(linearizeBlock(doc.documentElement, 'a', null).view);
    }
    return out.join('\n');
  }
  async function extractHwpx(bytes) {
    const zip = await deps.JSZip.loadAsync(bytes);
    const secs = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort();
    let out = [];
    for (const s of secs) { const doc = parseXml(await zip.file(s).async('string')); out.push(linearizeBlock(doc.documentElement, 'hp', null).view); }
    return out.join('\n');
  }
  async function extractXlsx(bytes) {
    const t = await openXlsx(bytes); return t.view;
  }
  function extractHwp(bytes) { return openHwp(bytes).view; }

  async function extractPdf(bytes) {
    if (!deps.pdfjsLib) throw new Error('PDF 텍스트 추출 라이브러리(pdf.js)가 없습니다.');
    const pdf = await deps.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    let out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i); const tc = await page.getTextContent();
      let line = '', lastY = null;
      for (const it of tc.items) {
        const y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
        line += it.str + (it.hasEOL ? '' : ' '); lastY = y;
      }
      out.push(line); out.push(`--- page ${i} end ---`);
    }
    // also AcroForm values
    try {
      const PDFLib = deps.PDFLib; if (PDFLib) {
        const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const fields = doc.getForm().getFields();
        if (fields.length) { out.push('--- form fields ---'); for (const f of fields) { let v = ''; try { v = f.getText ? f.getText() : f.isChecked ? (f.isChecked() ? '☑' : '☐') : f.getSelected ? String(f.getSelected()) : ''; } catch (e) {} out.push(`${f.getName()}: ${v || ''}`); } }
      }
    } catch (e) {}
    return out.join('\n');
  }

  function htmlToText(html) {
    return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<td[^>]*>/gi, ' | ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // RFC822 .eml
  function extractEml(raw) {
    const idx = raw.search(/\r?\n\r?\n/); const head = idx < 0 ? raw : raw.slice(0, idx); const body = idx < 0 ? '' : raw.slice(idx).replace(/^\r?\n\r?\n/, '');
    const hdr = parseHeaders(head);
    const parts = []; mimeParts(hdr, body, parts);
    const plain = parts.filter((p) => p.type.startsWith('text/plain')); const html = parts.filter((p) => p.type.startsWith('text/html'));
    const text = plain.length ? plain.map((p) => p.text).join('\n') : html.length ? html.map((p) => htmlToText(p.text)).join('\n') : body;
    const dh = (k) => decodeMimeWord(hdr[k] || '');
    return `From: ${dh('from')}\nTo: ${dh('to')}\nCc: ${dh('cc')}\nDate: ${hdr['date'] || ''}\nSubject: ${dh('subject')}\n\n${text.trim()}`;
  }
  function parseHeaders(head) {
    const h = {}; let last = null;
    for (const line of head.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && last) h[last] += ' ' + line.trim();
      else { const m = line.match(/^([\w-]+):\s*(.*)$/); if (m) { last = m[1].toLowerCase(); h[last] = m[2]; } }
    }
    return h;
  }
  function mimeParts(hdr, body, out) {
    const ct = (hdr['content-type'] || 'text/plain').toLowerCase();
    const bm = ct.match(/boundary="?([^";]+)"?/);
    if (ct.startsWith('multipart/') && bm) {
      const segs = body.split(new RegExp('\\r?\\n?--' + bm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?\\r?\\n?'));
      for (const seg of segs.slice(1)) {
        if (!seg.trim()) continue;
        const i = seg.search(/\r?\n\r?\n/); if (i < 0) continue;
        mimeParts(parseHeaders(seg.slice(0, i)), seg.slice(i).replace(/^\r?\n\r?\n/, ''), out);
      }
      return;
    }
    if (ct.startsWith('text/')) {
      const enc = (hdr['content-transfer-encoding'] || '').toLowerCase().trim();
      const cs = (ct.match(/charset="?([^";]+)"?/) || [, 'utf-8'])[1];
      let bytes;
      if (enc === 'base64') bytes = b64ToBytes(body.replace(/\s+/g, ''));
      else if (enc === 'quoted-printable') bytes = qpToBytes(body);
      else bytes = new TextEncoder().encode(body);
      let text; try { text = new TextDecoder(cs).decode(bytes); } catch (e) { text = decodeText(bytes); }
      out.push({ type: ct, text });
    }
  }
  function b64ToBytes(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function qpToBytes(s) {
    s = s.replace(/=\r?\n/g, ''); const out = [];
    for (let i = 0; i < s.length; i++) { if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else out.push(s.charCodeAt(i) & 0xff); }
    return new Uint8Array(out);
  }
  function decodeMimeWord(s) {
    return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, e, d) => {
      try { const bytes = e.toUpperCase() === 'B' ? b64ToBytes(d) : qpToBytes(d.replace(/_/g, ' ')); return new TextDecoder(cs).decode(bytes); } catch (x) { return m; }
    });
  }
  // Outlook .msg (CFB)
  function extractMsg(bytes) {
    const cfb = deps.CFB.read(bytes, { type: 'buffer' });
    const get = (tag) => {
      const e = cfb.FileIndex.find((f, i) => cfb.FullPaths[i].toLowerCase().endsWith(`__substg1.0_${tag}001f`.toLowerCase()) && !cfb.FullPaths[i].includes('__recip') && !cfb.FullPaths[i].includes('__attach'));
      if (e) return new TextDecoder('utf-16le').decode(new Uint8Array(e.content));
      const e8 = cfb.FileIndex.find((f, i) => cfb.FullPaths[i].toLowerCase().endsWith(`__substg1.0_${tag}001e`.toLowerCase()) && !cfb.FullPaths[i].includes('__recip'));
      return e8 ? decodeText(new Uint8Array(e8.content)) : '';
    };
    let body = get('1000');
    if (!body) { const h = get('1013'); if (h) body = htmlToText(h); }
    return `From: ${get('0C1A')} <${get('5D01') || get('0C1F')}>\nTo: ${get('0E04')}\nCc: ${get('0E03')}\nSubject: ${get('0037')}\n\n${body.trim()}`;
  }

  // ───────────────────────── GENERIC XML (docx / pptx / hwpx) ─────────────────────────
  // Linearize a document element into a human-readable view with slot markers,
  // collecting paragraph slots. prefix: 'w' (docx) | 'a' (pptx) | 'hp' (hwpx)
  const CFG = {
    w: { p: 'p', t: 't', r: 'r', tbl: 'tbl', tr: 'tr', tc: 'tc', skip: ['pPr', 'rPr', 'instrText', 'delText'] },
    a: { p: 'p', t: 't', r: 'r', tbl: 'tbl', tr: 'tr', tc: 'tc', skip: ['pPr', 'rPr'] },
    hp: { p: 'p', t: 't', r: 'run', tbl: 'tbl', tr: 'tr', tc: 'tc', skip: ['linesegarray', 'secPr', 'ctrl'] },
  };
  function paraText(p, cfg) {
    // text of own runs only (not nested paragraphs)
    let s = '';
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const l = ln(c);
        if (l === cfg.p && c !== p) continue;                 // nested paragraph (textbox / table)
        if (l === cfg.tbl) continue;                          // hwpx table lives inside a p
        if (cfg.skip.includes(l)) continue;
        if (l === cfg.t) { s += textOf(c); continue; }
        if (l === 'tab') { s += '\t'; continue; }
        if (l === 'br' || l === 'lineBreak') { s += '\n'; continue; }
        walk(c);
      }
    })(p);
    return s;
  }
  function linearizeBlock(rootEl, prefix, slots, idBase) {
    const cfg = CFG[prefix]; const lines = []; slots = slots || null; let counter = 0;
    const mk = (p) => {
      const text = paraText(p, cfg);
      if (!slots) return text;
      const id = `${idBase}${counter++}`;
      slots.push({ id, el: p, text, prefix });
      return `[#${id}]${text.replace(/\n/g, '⏎')}`;
    };
    (function walk(n, depth) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const l = ln(c);
        if (l === cfg.tbl) {
          lines.push('  '.repeat(depth) + '<TABLE>');
          for (const tr of children(c, cfg.tr)) {
            const cells = children(tr, cfg.tc).map((tc) => {
              const sub = []; (function cw(m) { for (let k = m.firstChild; k; k = k.nextSibling) { if (k.nodeType !== 1) continue; const kl = ln(k); if (kl === cfg.p) { sub.push(mk(k)); const inner = descendants(k, cfg.tbl); for (const tb of inner) { const w = linearizeBlock({ firstChild: tb, nextSibling: null }, prefix, slots, idBase); } } else if (kl === cfg.tbl) { sub.push(innerTable(k)); } else cw(k); } })(tc);
              return sub.join(' / ');
            });
            lines.push('  '.repeat(depth) + '| ' + cells.join(' | ') + ' |');
          }
          lines.push('  '.repeat(depth) + '</TABLE>');
          continue;
        }
        if (l === cfg.p) {
          lines.push('  '.repeat(depth) + mk(c));
          // hwpx: tables are children of hp:p → handled when walking into p children
          if (prefix === 'hp') { for (const k of children(c)) { if (ln(k) === 'tbl' || descendants(k, 'tbl').length) walk(k, depth + 1); } }
          else if (descendants(c, cfg.p).length) walk(c, depth + 1); // textboxes inside runs
          continue;
        }
        if (cfg.skip.includes(l)) continue;
        if (prefix === 'a' && l === 'sp') { const nm = (descendants(c, 'cNvPr')[0] || {}).getAttribute; lines.push('  '.repeat(depth) + `[shape ${nm ? descendants(c, 'cNvPr')[0].getAttribute('name') : ''}]`); }
        walk(c, depth);
      }
    })(rootEl, 0);
    function innerTable(tbl) { const sub = []; const saved = lines.length; walk({ firstChild: tbl, nextSibling: null }, 0); const got = lines.splice(saved); return got.join(' ⏎ '); }
    return { view: lines.filter((x) => x.trim()).join('\n'), count: counter };
  }

  // Apply new text to a paragraph element, keeping formatting of the first run.
  function setParaText(p, prefix, text, doc) {
    const cfg = CFG[prefix];
    const ownT = descendants(p, cfg.t).filter((t) => closest(t, cfg.p, p.parentNode) === p);
    const ns = (el) => el.namespaceURI;
    const q = (el, local) => (el.prefix ? el.prefix + ':' : '') + local;
    const lines = String(text).split(/\r?\n/);
    let first;
    if (ownT.length) {
      first = ownT[0];
      // remove the other text nodes (and their now-empty runs)
      for (const t of ownT.slice(1)) {
        const r = t.parentNode; t.parentNode.removeChild(t);
        if (r && ln(r) === cfg.r) { const left = children(r).filter((k) => !['rPr', 'rPr'].includes(ln(k))); if (!left.length) r.parentNode.removeChild(r); }
      }
      // remove breaks/tabs in other runs of this paragraph (we re-create line breaks below)
      for (const b of descendants(p, 'br').concat(descendants(p, 'lineBreak'))) if (closest(b, cfg.p, p.parentNode) === p && b.parentNode !== first) b.parentNode.removeChild(b);
    } else {
      // create a run + text node
      let run = children(p, cfg.r)[0];
      if (!run) {
        run = doc.createElementNS(ns(p), q(p, cfg.r));
        if (prefix === 'hp') run.setAttribute('charPrIDRef', '0');
        // copy paragraph-mark run properties (docx) so the new text matches the cell font
        if (prefix === 'w' || prefix === 'a') { const pPr = children(p, 'pPr')[0]; const rPr = pPr && children(pPr, 'rPr')[0]; if (rPr) run.appendChild(rPr.cloneNode(true)); }
        // insert after pPr (docx/pptx) or at the end (hwpx — before linesegarray)
        const pPr = children(p, 'pPr')[0];
        if (pPr && pPr.nextSibling) p.insertBefore(run, pPr.nextSibling); else if (pPr) p.appendChild(run); else if (prefix === 'hp') { const lsa = children(p, 'linesegarray')[0]; lsa ? p.insertBefore(run, lsa) : p.appendChild(run); } else p.appendChild(run);
      }
      first = doc.createElementNS(ns(p), q(p, cfg.t));
      if (prefix === 'hp') { run.appendChild(first); } else { const lastRPr = children(run, 'rPr')[0]; run.appendChild(first); }
    }
    // write text (with line breaks)
    while (first.firstChild) first.removeChild(first.firstChild);
    if (prefix === 'w') {
      first.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      first.appendChild(doc.createTextNode(lines[0]));
      const run = first.parentNode; let after = first;
      for (const l of lines.slice(1)) {
        const br = doc.createElementNS(ns(p), q(p, 'br')); run.insertBefore(br, after.nextSibling);
        const t = doc.createElementNS(ns(p), q(p, 't')); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.appendChild(doc.createTextNode(l)); run.insertBefore(t, br.nextSibling); after = t;
      }
    } else if (prefix === 'a') {
      first.appendChild(doc.createTextNode(lines[0]));
      const run = first.parentNode; let after = run;
      for (const l of lines.slice(1)) {
        const br = doc.createElementNS(ns(p), q(p, 'br')); const rPr = children(run, 'rPr')[0]; if (rPr) br.appendChild(rPr.cloneNode(true));
        const r2 = run.cloneNode(true); for (const t of children(r2, 't')) { while (t.firstChild) t.removeChild(t.firstChild); t.appendChild(doc.createTextNode(l)); }
        run.parentNode.insertBefore(br, after.nextSibling); run.parentNode.insertBefore(r2, br.nextSibling); after = r2;
      }
    } else { // hwpx: <hp:t>text<hp:lineBreak/>text</hp:t>
      lines.forEach((l, i) => { if (i) first.appendChild(doc.createElementNS(ns(p), q(p, 'lineBreak'))); first.appendChild(doc.createTextNode(l)); });
    }
  }

  async function openOoxml(bytes, kind) {
    const zip = await deps.JSZip.loadAsync(bytes);
    let parts, prefix;
    if (kind === 'docx') { prefix = 'w'; parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b))); }
    else if (kind === 'pptx') { prefix = 'a'; parts = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)/)[1] - +b.match(/(\d+)/)[1]); }
    else { prefix = 'hp'; parts = Object.keys(zip.files).filter((n) => /^Contents\/(section\d+|header)\.xml$/.test(n)).sort(); }
    const docs = []; const slots = []; const views = [];
    for (let i = 0; i < parts.length; i++) {
      const xml = await zip.file(parts[i]).async('string'); const doc = parseXml(xml);
      const base = parts.length > 1 ? `${i}_` : '';
      const before = slots.length;
      const { view } = linearizeBlock(doc.documentElement, prefix, slots, base);
      docs.push({ path: parts[i], doc, xml });
      if (parts.length > 1) views.push(`===== ${parts[i]} =====`);
      views.push(view);
    }
    const slotMap = Object.fromEntries(slots.map((s) => [s.id, s]));
    return {
      kind, slots: slots.map(({ id, text }) => ({ id, text })), view: views.join('\n'),
      async apply(edits) {
        const touched = new Set();
        for (const [id, val] of Object.entries(edits)) {
          const s = slotMap[id]; if (!s || val == null) continue;
          const d = docs.find((x) => x.doc === s.el.ownerDocument);
          setParaText(s.el, prefix, String(val), s.el.ownerDocument); touched.add(d);
        }
        for (const d of touched) zip.file(d.path, serializeXml(d.doc, d.xml));
        return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: kind === 'hwpx' ? 'application/hwp+zip' : undefined });
      },
    };
  }

  // ───────────────────────── XLSX ─────────────────────────
  const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const numToCol = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const splitRef = (r) => { const m = r.match(/^([A-Z]+)(\d+)$/); return m ? { col: m[1], row: +m[2], c: colToNum(m[1]) } : null; };

  async function openXlsx(bytes) {
    const zip = await deps.JSZip.loadAsync(bytes);
    const wb = parseXml(await zip.file('xl/workbook.xml').async('string'));
    const rels = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    const relMap = {}; for (const r of descendants(rels.documentElement, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    let shared = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const ss = parseXml(await zip.file('xl/sharedStrings.xml').async('string'));
      shared = children(ss.documentElement, 'si').map((si) => descendants(si, 't').map(textOf).join(''));
    }
    const sheets = [];
    const sheetEls = descendants(wb.documentElement, 'sheet');
    for (let si = 0; si < sheetEls.length; si++) {
      const el = sheetEls[si];
      const rid = el.getAttribute('r:id') || Array.from(el.attributes).find((a) => a.localName === 'id' && a.namespaceURI && a.namespaceURI.includes('relationships'))?.value;
      let target = relMap[rid]; if (!target) continue; target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
      if (!zip.file(target)) continue;
      const xml = await zip.file(target).async('string'); const doc = parseXml(xml);
      const sheetData = descendants(doc.documentElement, 'sheetData')[0];
      const merges = descendants(doc.documentElement, 'mergeCell').map((m) => m.getAttribute('ref'));
      const rows = [];
      for (const row of children(sheetData, 'row')) {
        const r = +row.getAttribute('r'); const cells = [];
        for (const c of children(row, 'c')) {
          const ref = c.getAttribute('r'); const t = c.getAttribute('t'); const v = children(c, 'v')[0]; const f = children(c, 'f')[0];
          let text = '';
          if (t === 's' && v) text = shared[+textOf(v)] || '';
          else if (t === 'inlineStr') text = descendants(c, 't').map(textOf).join('');
          else if (v) text = textOf(v);
          cells.push({ ref, text, formula: !!f, el: c });
        }
        rows.push({ r, el: row, cells });
      }
      sheets.push({ idx: si, name: el.getAttribute('name'), path: target, doc, xml, rows, merges, sheetData });
    }
    // view + slots
    const lines = []; const slots = [];
    for (const sh of sheets) {
      lines.push(`===== SHEET ${sh.idx} "${sh.name}" (id prefix S${sh.idx}!) =====`);
      if (sh.merges.length) lines.push('merged: ' + sh.merges.join(', ') + '  (write only to the top-left cell of a merge)');
      // used column range
      let maxC = 0; for (const row of sh.rows) for (const c of row.cells) { const s = splitRef(c.ref); if (s && s.c > maxC) maxC = s.c; }
      let maxR = 0; for (const row of sh.rows) if (row.r > maxR) maxR = row.r;
      const byRow = new Map(sh.rows.map((r) => [r.r, r]));
      const mergedInner = new Set();
      for (const m of sh.merges) { const [a, b] = m.split(':').map(splitRef); if (!a || !b) continue; for (let rr = a.row; rr <= b.row; rr++) for (let cc = a.c; cc <= b.c; cc++) if (!(rr === a.row && cc === a.c)) mergedInner.add(numToCol(cc) + rr); }
      for (let rr = 1; rr <= maxR; rr++) {
        const row = byRow.get(rr); const parts = [];
        const cellMap = new Map((row ? row.cells : []).map((c) => [c.ref, c]));
        let any = false;
        for (let cc = 1; cc <= maxC; cc++) {
          const ref = numToCol(cc) + rr; if (mergedInner.has(ref)) continue;
          const c = cellMap.get(ref);
          const id = `S${sh.idx}!${ref}`;
          if (c && c.formula) { parts.push(`${ref}=〔formula〕`); continue; }
          const text = c ? c.text : '';
          if (text) any = true;
          slots.push({ id, text, sheet: sh, ref, el: c ? c.el : null });
          parts.push(`${ref}=${JSON.stringify(text)}`);
        }
        if (row || any) lines.push(`R${rr}: ` + parts.join('  '));
      }
    }
    const slotMap = Object.fromEntries(slots.map((s) => [s.id, s]));
    return {
      kind: 'xlsx', slots: slots.map(({ id, text }) => ({ id, text })), view: lines.join('\n'),
      async apply(edits) {
        const touched = new Set();
        for (const [id, val] of Object.entries(edits)) {
          if (val == null) continue;
          let s = slotMap[id];
          if (!s) { // allow a brand-new ref like S0!H40
            const m = id.match(/^S(\d+)!([A-Z]+\d+)$/); const sh = m && sheets[+m[1]]; if (!sh) continue;
            const row = sh.rows.find((r) => r.r === splitRef(m[2]).row); const ex = row && row.cells.find((x) => x.ref === m[2]);
            if (ex && ex.formula) continue;
            s = { sheet: sh, ref: m[2], el: ex ? ex.el : null };
          }
          const sh = s.sheet; const doc = sh.doc; const nsURI = doc.documentElement.namespaceURI;
          let c = s.el;
          if (c && children(c, 'f').length) continue;   // never overwrite formulas
          if (!c) c = ensureCell(sh, s.ref, doc, nsURI);
          // clear value children
          for (const k of children(c)) if (['v', 'is', 'f'].includes(ln(k))) c.removeChild(k);
          const str = String(val);
          if (/^-?\d+(\.\d+)?$/.test(str.trim()) && str.trim().length < 16) {
            c.removeAttribute('t'); const v = doc.createElementNS(nsURI, 'v'); v.appendChild(doc.createTextNode(str.trim())); c.appendChild(v);
          } else {
            c.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(nsURI, 'is'); const t = doc.createElementNS(nsURI, 't'); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.appendChild(doc.createTextNode(str)); is.appendChild(t); c.appendChild(is);
          }
          touched.add(sh);
        }
        for (const sh of touched) zip.file(sh.path, serializeXml(sh.doc, sh.xml));
        if (touched.size && zip.file('xl/calcChain.xml') === null) { /* nothing */ }
        return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      },
    };
  }
  function ensureCell(sh, ref, doc, nsURI) {
    const { row: rr, c: cc } = splitRef(ref);
    let row = sh.rows.find((r) => r.r === rr);
    if (!row) {
      const el = doc.createElementNS(nsURI, 'row'); el.setAttribute('r', String(rr));
      const after = sh.rows.filter((r) => r.r < rr).pop();
      if (after) sh.sheetData.insertBefore(el, after.el.nextSibling); else sh.sheetData.insertBefore(el, sh.sheetData.firstChild);
      row = { r: rr, el, cells: [] }; sh.rows.push(row); sh.rows.sort((a, b) => a.r - b.r);
    }
    const c = doc.createElementNS(nsURI, 'c'); c.setAttribute('r', ref);
    // borrow style from the cell above/below in the same column if present (keeps borders in forms)
    const nb = sh.rows.map((r) => r.cells.find((x) => x.ref === numToCol(cc) + r.r)).filter(Boolean).sort((a, b) => Math.abs(splitRef(a.ref).row - rr) - Math.abs(splitRef(b.ref).row - rr))[0];
    if (nb && nb.el.getAttribute('s')) c.setAttribute('s', nb.el.getAttribute('s'));
    const next = row.cells.find((x) => splitRef(x.ref).c > cc);
    if (next) row.el.insertBefore(c, next.el); else row.el.appendChild(c);
    row.cells.push({ ref, text: '', formula: false, el: c }); row.cells.sort((a, b) => splitRef(a.ref).c - splitRef(b.ref).c);
    return c;
  }

  // ───────────────────────── HWP 5.0 (binary) ─────────────────────────
  const HWP = { PARA_HEADER: 66, PARA_TEXT: 67, PARA_CHAR_SHAPE: 68, PARA_LINE_SEG: 69, CTRL_HEADER: 71, LIST_HEADER: 72 };
  const CTRL_EXT = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);  // 8 code units
  const CTRL_INLINE = new Set([4, 5, 6, 7, 8, 9, 19, 20]);                        // 8 code units
  function readRecords(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); const recs = []; let i = 0;
    while (i + 4 <= buf.length) {
      const h = dv.getUint32(i, true); const tag = h & 0x3ff, level = (h >> 10) & 0x3ff; let size = (h >> 20) & 0xfff; i += 4;
      if (size === 0xfff) { size = dv.getUint32(i, true); i += 4; }
      recs.push({ tag, level, payload: buf.subarray(i, i + size) }); i += size;
    }
    return recs;
  }
  function writeRecords(recs) {
    let total = 0; for (const r of recs) total += 4 + (r.payload.length >= 0xfff ? 4 : 0) + r.payload.length;
    const out = new Uint8Array(total); const dv = new DataView(out.buffer); let i = 0;
    for (const r of recs) {
      const sz = r.payload.length;
      if (sz < 0xfff) { dv.setUint32(i, (sz << 20) | (r.level << 10) | r.tag, true); i += 4; }
      else { dv.setUint32(i, (0xfff << 20) | (r.level << 10) | r.tag, true); i += 4; dv.setUint32(i, sz, true); i += 4; }
      out.set(r.payload, i); i += sz;
    }
    return out;
  }
  // Parse PARA_TEXT payload into chunks: {kind:'text', s} | {kind:'ctrl', bytes}
  function parseParaText(p) {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength); const chunks = []; let i = 0; let cur = '';
    const flush = () => { if (cur) { chunks.push({ kind: 'text', s: cur }); cur = ''; } };
    while (i + 2 <= p.length) {
      const c = dv.getUint16(i, true);
      if (c < 32) {
        if (CTRL_EXT.has(c) || CTRL_INLINE.has(c)) { flush(); chunks.push({ kind: 'ctrl', code: c, bytes: p.slice(i, i + 16) }); i += 16; continue; }
        if (c === 13) { flush(); chunks.push({ kind: 'end' }); i += 2; continue; }
        if (c === 10) { cur += '\n'; i += 2; continue; }
        if (c === 9) { cur += '\t'; i += 2; continue; }
        if (c === 24) { cur += '-'; i += 2; continue; } if (c === 30 || c === 31) { cur += ' '; i += 2; continue; }
        i += 2; continue; // other 1-unit control
      }
      cur += String.fromCharCode(c); i += 2;
    }
    flush(); return chunks;
  }
  function hwpStreams(bytes) {
    const cfb = deps.CFB.read(bytes, { type: 'buffer' });
    const fh = deps.CFB.find(cfb, 'Root Entry/FileHeader') || deps.CFB.find(cfb, '/FileHeader');
    if (!fh) throw new Error('HWP FileHeader가 없습니다 (HWP 5.0 형식이 아닙니다).');
    const hdr = new Uint8Array(fh.content); const flags = new DataView(hdr.buffer, hdr.byteOffset).getUint32(36, true);
    if (flags & 2) throw new Error('암호가 걸린 HWP 파일은 처리할 수 없습니다.');
    if (flags & 4) throw new Error('배포용(배포 문서) HWP 파일은 처리할 수 없습니다. 일반 저장된 HWP를 올려주세요.');
    const compressed = !!(flags & 1);
    const secs = cfb.FullPaths.map((p, i) => ({ p, i })).filter((x) => /BodyText\/Section\d+$/.test(x.p)).sort((a, b) => +a.p.match(/(\d+)$/)[1] - +b.p.match(/(\d+)$/)[1]);
    return { cfb, compressed, secs };
  }
  function openHwp(bytes) {
    const { cfb, compressed, secs } = hwpStreams(bytes);
    const lines = []; const slots = []; const sections = [];
    for (const s of secs) {
      const entry = cfb.FileIndex[s.i]; let raw = new Uint8Array(entry.content);
      if (compressed) raw = deps.pako.inflateRaw(raw);
      const recs = readRecords(raw);
      // walk records; collect paragraphs
      let cellCtx = null; const ctrlStack = [];
      for (let k = 0; k < recs.length; k++) {
        const r = recs[k];
        if (r.tag === HWP.CTRL_HEADER) { const id = String.fromCharCode(r.payload[3], r.payload[2], r.payload[1], r.payload[0]); ctrlStack[r.level] = id; if (id === 'tbl ') lines.push('<TABLE>'); }
        if (r.tag === HWP.LIST_HEADER) {
          const parentCtrl = ctrlStack[r.level - 1];
          if (parentCtrl === 'tbl ' && r.payload.length >= 12) { const dv = new DataView(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength); const off = r.payload.length === 30 ? 6 : 8; cellCtx = { row: dv.getUint16(off + 2, true), col: dv.getUint16(off, true), level: r.level }; }
          else cellCtx = null;
        }
        if (r.tag === HWP.PARA_HEADER) {
          const id = `${secs.length > 1 ? s.p.match(/(\d+)$/)[1] + '_' : ''}${k}`;
          let textRec = null, csRec = null, lsRec = null;
          for (let j = k + 1; j < recs.length && recs[j].level > r.level; j++) { if (recs[j].level !== r.level + 1) continue; if (recs[j].tag === HWP.PARA_TEXT) textRec = j; else if (recs[j].tag === HWP.PARA_CHAR_SHAPE) csRec = j; else if (recs[j].tag === HWP.PARA_LINE_SEG) lsRec = j; else break; }
          const chunks = textRec != null ? parseParaText(recs[textRec].payload) : [];
          const text = chunks.filter((c) => c.kind === 'text').map((c) => c.s).join('');
          const inCell = cellCtx && r.level === cellCtx.level;
          slots.push({ id, text, sec: s, k, textRec, csRec, lsRec, chunks });
          lines.push((inCell ? `  [r${cellCtx.row}c${cellCtx.col}] ` : '') + `[#${id}]${text.replace(/\n/g, '⏎')}`);
        }
      }
      sections.push({ s, recs, entry });
    }
    const slotMap = Object.fromEntries(slots.map((x) => [x.id, x]));
    return {
      kind: 'hwp', slots: slots.map(({ id, text }) => ({ id, text })), view: lines.join('\n'),
      async apply(edits) {
        const bySec = new Map();
        for (const [id, val] of Object.entries(edits)) { const sl = slotMap[id]; if (!sl || val == null) continue; if (!bySec.has(sl.sec)) bySec.set(sl.sec, []); bySec.get(sl.sec).push({ sl, val: String(val) }); }
        for (const sec of sections) {
          const list = bySec.get(sec.s); if (!list) continue;
          const drop = new Set(); const replace = new Map();
          for (const { sl, val } of list) {
            const hdr = sec.recs[sl.k]; const hp = new Uint8Array(hdr.payload); const dv = new DataView(hp.buffer, hp.byteOffset, hp.byteLength);
            // build new text: keep control sequences (tables, fields…) in front, then text, then paragraph end
            const ctrls = sl.chunks.filter((c) => c.kind === 'ctrl');
            const units = []; for (const c of ctrls) units.push(c.bytes);
            const textUnits = []; for (const ch of val.replace(/\r/g, '')) { const code = ch.charCodeAt(0); textUnits.push(ch === '\n' ? 10 : ch === '\t' ? 9 : code); }
            const nUnits = ctrls.length * 8 + textUnits.length + 1;
            const tp = new Uint8Array(nUnits * 2); const tdv = new DataView(tp.buffer); let o = 0;
            for (const u of units) { tp.set(u, o); o += 16; }
            for (const u of textUnits) { tdv.setUint16(o, u, true); o += 2; }
            tdv.setUint16(o, 13, true);
            // header: nchars (keep bit31), charshapes=1, linesegs=1
            const flag = dv.getUint32(0, true) & 0x80000000; dv.setUint32(0, flag | nUnits, true);
            if (hp.length >= 18) { dv.setUint16(12, 1, true); dv.setUint16(16, 1, true); }
            hdr.payload = hp;
            const lvl = hdr.level + 1;
            // char shape: first pair, pos 0
            let cs = new Uint8Array(8); if (sl.csRec != null) cs.set(sec.recs[sl.csRec].payload.subarray(0, 8)); new DataView(cs.buffer).setUint32(0, 0, true);
            // line seg: first seg, chpos 0
            let ls = new Uint8Array(36); if (sl.lsRec != null) ls.set(sec.recs[sl.lsRec].payload.subarray(0, 36)); new DataView(ls.buffer).setUint32(0, 0, true);
            const newRecs = [{ tag: HWP.PARA_TEXT, level: lvl, payload: tp }, { tag: HWP.PARA_CHAR_SHAPE, level: lvl, payload: cs }, { tag: HWP.PARA_LINE_SEG, level: lvl, payload: ls }];
            for (const j of [sl.textRec, sl.csRec, sl.lsRec]) if (j != null) drop.add(j);
            replace.set(sl.k, newRecs);
          }
          const out = [];
          for (let k = 0; k < sec.recs.length; k++) { if (drop.has(k)) continue; out.push(sec.recs[k]); if (replace.has(k)) out.push(...replace.get(k)); }
          let bin = writeRecords(out); if (compressed) bin = deps.pako.deflateRaw(bin);
          sec.entry.content = bin; sec.entry.size = bin.length;
        }
        // PrvText (preview) is left as-is; Hangul regenerates it on save.
        return new Uint8Array(deps.CFB.write(cfb, { type: 'buffer' }));
      },
    };
  }

  // ───────────────────────── PDF (AcroForm) ─────────────────────────
  async function openPdfForm(bytes) {
    const { PDFDocument } = deps.PDFLib;
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = doc.getForm(); const fields = form.getFields();
    if (!fields.length) throw new Error('이 PDF에는 입력 가능한 폼 필드(AcroForm)가 없습니다. 입력 필드가 있는 PDF만 채울 수 있습니다. (일반 PDF는 Word/HWP 원본으로 작업해 주세요)');
    const slots = []; const lines = ['PDF form fields (id = field name):'];
    for (const f of fields) {
      const type = f.constructor.name.replace('PDF', ''); let v = '';
      try { if (f.getText) v = f.getText() || ''; else if (f.isChecked) v = f.isChecked() ? 'true' : 'false'; else if (f.getSelected) v = [].concat(f.getSelected()).join(', '); } catch (e) {}
      let opts = ''; try { if (f.getOptions) opts = ' options=' + JSON.stringify(f.getOptions()); } catch (e) {}
      slots.push({ id: f.getName(), text: v }); lines.push(`[#${f.getName()}] (${type}${opts}) ${v}`);
    }
    return {
      kind: 'pdf', slots, view: lines.join('\n'),
      async apply(edits) {
        for (const [id, val] of Object.entries(edits)) {
          let f; try { f = form.getField(id); } catch (e) { continue; } if (!f || val == null) continue;
          const v = String(val);
          try {
            if (f.setText) f.setText(v);
            else if (f.check) { /^(true|yes|y|1|☑|■|v|o|예|체크)$/i.test(v.trim()) ? f.check() : f.uncheck(); }
            else if (f.select) f.select(v);
          } catch (e) {}
        }
        try { form.updateFieldAppearances(); } catch (e) {}
        return await doc.save();
      },
    };
  }

  // ───────────────────────── plain text ─────────────────────────
  function openPlain(bytes, name) {
    const text = decodeText(bytes);
    return {
      kind: 'text', slots: [{ id: 'DOC', text }], view: `[#DOC] (entire document — return the complete filled text as the value of "DOC")\n${text}`,
      async apply(edits) { const t = edits.DOC != null ? String(edits.DOC) : text; return new TextEncoder().encode(t); },
    };
  }

  async function openTemplate(file) {
    const ext = extOf(file.name); const bytes = file.bytes;
    switch (ext) {
      case 'docx': case 'dotx': case 'docm': return await openOoxml(bytes, 'docx');
      case 'pptx': return await openOoxml(bytes, 'pptx');
      case 'hwpx': return await openOoxml(bytes, 'hwpx');
      case 'xlsx': case 'xlsm': return await openXlsx(bytes);
      case 'hwp': return openHwp(bytes);
      case 'pdf': return await openPdfForm(bytes);
      case 'doc': case 'xls': case 'ppt': throw new Error(`.${ext} (구형 바이너리 형식)은 지원하지 않습니다. .${ext}x 로 저장한 뒤 올려주세요.`);
      default: return openPlain(bytes, file.name);
    }
  }

  return { setDeps, extractText, openTemplate, decodeText, extOf };
});
