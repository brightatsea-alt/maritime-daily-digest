// Cloudflare Pages Function — POST /api/fill
// Proxies to the Claude API. Secrets (Pages → Settings → Environment variables):
//   CLAUDE_API_KEY   (required)
//   CLAUDE_MODEL     (optional, default claude-sonnet-5-5)
//   APP_PASSWORD     (optional — if set, the browser must send header x-app-key)

const MAX_SOURCE_CHARS = 220000;   // ~70k tokens of source text per request

export async function onRequestPost({ request, env }) {
  if (env.APP_PASSWORD && request.headers.get('x-app-key') !== env.APP_PASSWORD) return json({ error: '비밀번호가 올바르지 않습니다.' }, 401);
  if (!env.CLAUDE_API_KEY) return json({ error: '서버에 CLAUDE_API_KEY 가 설정되지 않았습니다.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const { kind, view, sources = [], images = [], hint = '', previous = null, priority = '', lang = 'auto' } = body;
  if (!view) return json({ error: 'template view missing' }, 400);

  const sourceText = budgetSources(sources, view, MAX_SOURCE_CHARS);

  const system = `You are a meticulous form-filling assistant for a ship-management office (HSEQ / marine / technical / crewing). You receive (1) a FORM TEMPLATE rendered as text where every editable text unit carries an id, and (2) SOURCE DOCUMENTS. Your job: find every value in the sources that belongs in the form and return the edits.

Output ONLY a JSON object: {"edits": {"<id>": "<new full text of that unit>", ...}, "unresolved": ["<form item you could not fill and why, short>"], "notes": "<one or two short sentences, Korean>"}

Rules
- An id's value REPLACES the entire text of that unit (paragraph / cell / field). So when a label and a blank share one unit (e.g. "선박명: ____" or "신청일: ____년 __월 __일"), return the label with the blank filled ("선박명: MV ASIAN CAPTAIN"). When the blank is its own unit (an empty cell next to a label cell), return only the value.
- Never change labels, headings, instructions, numbering or any text that is not a fill-in. Do not include ids whose text should stay as is.
- Placeholders to fill: empty cells next to labels, underscores, "( )", "[ ]", "□/☐" checkboxes, "YYYY-MM-DD", "○○○", "예:", "해당사항 기재" etc. For checkboxes use the form's own glyph style (□→■, ☐→☑, ( )→(V)).
- Table rows: when the form has repeating rows (e.g. crew list, deficiency list), fill rows top-down, one record per row, in the column order the header indicates. Leave remaining rows empty.
- Language of the values you write: ${{ auto: "keep the form's own language; do not translate values unless the form clearly requires another language", ko: 'write all filled values in Korean (한글); translate English source text into natural Korean, but keep proper nouns such as vessel names, IMO numbers, ports and codes as written', en: 'write all filled values in English; translate Korean source text into clear professional maritime English, keeping proper nouns/codes as written', both: 'write every filled value bilingually as "한글 (English)" — Korean first, then the English in parentheses; for long passages put Korean, then a line break, then English' }[lang] || 'keep the form language'}. Keep the form's formats (dates, units, capitalisation).
- Use ONLY facts from the sources. The PRIORITY INPUT, when present, wins over every other source on conflict. Never invent. If a value is missing, leave it and list it under "unresolved". Partial values are fine when clearly supported.
- Multi-line values: use \\n.
- xlsx templates: ids look like "S0!B3" (sheet!cell). You may also return a cell id that is not listed when it is clearly the right blank cell (e.g. the cell right of a label), but prefer listed ids. Never write into cells marked 〔formula〕. For merged ranges write only to the top-left cell.
- pdf templates: ids are field names; checkboxes take "true"/"false"; choice fields must use one of the listed options.
- text templates: id "DOC" takes the complete filled document text.
${previous ? '- You are RE-RUNNING with additional sources. Keep previously filled values unless the new sources correct them, and add what is newly available.' : ''}
Return JSON only — no markdown fences, no commentary.`;

  const content = [];
  content.push({ type: 'text', text: `## FORM TEMPLATE (kind: ${kind})\n${view}` });
  if (previous) content.push({ type: 'text', text: `## PREVIOUS EDITS (from the last run)\n${JSON.stringify(previous)}` });
  if (priority) content.push({ type: 'text', text: `## PRIORITY INPUT (overrides every other source where they conflict)\n${priority}` });
  if (hint) content.push({ type: 'text', text: `## USER INSTRUCTIONS\n${hint}` });
  content.push({ type: 'text', text: `## SOURCE DOCUMENTS\n${sourceText || '(no text sources)'}` });
  for (const im of images.slice(0, 20)) {
    content.push({ type: 'text', text: `## SOURCE IMAGE: ${im.name}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  content.push({ type: 'text', text: 'Now return the JSON object.' });

  const model = env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 16000, temperature: 0, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) { const t = await res.text(); return json({ error: `Claude API ${res.status}: ${t.slice(0, 500)}` }, 502); }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const parsed = extractJson(text);
  if (!parsed) return json({ error: '모델 응답을 JSON으로 해석할 수 없습니다.', raw: text.slice(0, 2000) }, 502);
  if (!parsed.edits || typeof parsed.edits !== 'object') parsed.edits = {};
  return json({ ...parsed, usage: data.usage, model });
}

export async function onRequestGet({ env }) {
  return json({ ok: true, needsPassword: !!env.APP_PASSWORD, hasKey: !!env.CLAUDE_API_KEY, model: env.CLAUDE_MODEL || 'claude-sonnet-5-5' });
}

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); }

function extractJson(text) {
  text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (e) {}
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch (x) {} }
  return null;
}

// Keep all sources when they fit; otherwise keep the chunks most related to the form's labels.
function budgetSources(sources, view, limit) {
  const blocks = sources.map((s) => `### SOURCE: ${s.name}\n${(s.text || '').trim()}`);
  const total = blocks.reduce((a, b) => a + b.length, 0);
  if (total <= limit) return blocks.join('\n\n');
  const terms = new Set((view.match(/[\p{L}\p{N}]{2,}/gu) || []).map((t) => t.toLowerCase()));
  const chunks = [];
  sources.forEach((s, si) => {
    const t = (s.text || ''); const size = 2500;
    for (let i = 0; i < t.length; i += size) {
      const c = t.slice(i, i + size); let score = 0;
      for (const w of c.match(/[\p{L}\p{N}]{2,}/gu) || []) if (terms.has(w.toLowerCase())) score++;
      chunks.push({ si, i, c, score: score / Math.sqrt(c.length + 1) + (i === 0 ? 0.01 : 0) });
    }
  });
  chunks.sort((a, b) => b.score - a.score);
  const keep = []; let used = 0;
  for (const ch of chunks) { if (used + ch.c.length > limit) break; keep.push(ch); used += ch.c.length; }
  keep.sort((a, b) => a.si - b.si || a.i - b.i);
  let out = '', cur = -1;
  for (const ch of keep) { if (ch.si !== cur) { cur = ch.si; out += `\n\n### SOURCE: ${sources[cur].name} (excerpts)\n`; } out += ch.c + '\n…\n'; }
  return out.trim();
}
