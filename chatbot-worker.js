/* Maritime Daily Digest chatbot backend (Cloudflare Worker)
   POST /parse  {q, lang}            -> question understanding (Haiku): intent, concepts (KR+EN synonyms), sections, date range
   POST /rerank {q, lang, items}     -> relevance order of up to 60 candidate headlines (Haiku)
   POST /web    {q, lang}            -> reliable-source web search, only when the user presses the button (Haiku + web_search)
   Settings → Variables and Secrets:  CLAUDE_API_KEY (Secret, entered by the owner)
   Optional: CLAUDE_MODEL (default claude-haiku-5-5), WEB_DAILY_LIMIT (default 50), API_DAILY_LIMIT (default 3000)
   Optional KV binding named LIMITS for exact daily counters (otherwise best-effort per instance). Nothing is stored about users. */
const ORIGINS = ["https://brightatsea-alt.github.io"];
const SECTIONS = "TOP ACC PSC PCTC WW EE DIG TECH HR HSEQ KR INS PNI VET CLASS COMM GEO TW HOT SYS SMGR";
const DOMAINS = ["imo.org","safety4sea.com","gcaptain.com","hellenicshippingnews.com","maritime-executive.com","splash247.com",
  "lloydslist.com","tradewindsnews.com","rivieramm.com","seatrade-maritime.com","shipmanagementinternational.com","parismou.org",
  "tokyo-mou.org","uscg.mil","emsa.europa.eu","dnv.com","lr.org","classnk.or.jp","krs.co.kr","ics-shipping.org","bimco.org",
  "ocimf.org","rightship.com","gard.no","skuld.com","nepia.com","ukpandi.com","westpandi.com","mof.go.kr","ksg.co.kr",
  "shippingnewsnet.com","haesanews.com","kmi.re.kr","porttechnology.org","offshore-energy.biz","marinelink.com"];

const PARSE_SYS = `You turn a user's question to a maritime news site (Maritime Daily Digest) into a search plan. Today is {TODAY}.
Return ONLY JSON: {"intent":"news|about|howto|personal|offtopic","concepts":[["kr term","en term","synonym",...],...],"sections":["CODE"],"from":"YYYY-MM-DD"|null,"to":"YYYY-MM-DD"|null,"rewrite":"short search phrase"}
Rules:
- intent "personal" for personal questions or anything asking for or containing personal data (names+contacts, addresses, accounts, the user's or assistant's private life). "offtopic" for non-maritime topics. "about" = purpose of the site. "howto" = how to use the site/tabs.
- concepts: 1-4 key ideas the article MUST be about. Each concept is a list of 3-10 lowercase surface forms: Korean and English words, abbreviations, inflections, close synonyms (e.g. ["출항정지","억류","detention","detained","detain"]). Drop filler words (뉴스, 알려줘, 최근, latest, news).
- sections from: ${SECTIONS} (ACC accidents, PSC port state control, PCTC car carriers, WW Wallenius Wilhelmsen/EUKOR, EE energy/emissions, DIG digital, TECH technical, HR marine HR, HSEQ safety/quality, KR Korea, INS insurance, PNI P&I clubs, VET vetting, CLASS class societies, COMM commercial/chartering, GEO geopolitics, SYS systems/apps, SMGR ship managers). Only if clearly implied.
- from/to only when the question states a period ("지난주", "10월", "last 3 months").`;

const RERANK_SYS = `Rank news headlines by how well they answer the user's question to a maritime news site. Return ONLY JSON {"order":[ids most relevant first],"drop":[ids clearly irrelevant]}. Keep every id that is at least loosely relevant in "order".`;

const WEB_SYS = {
  KR: "당신은 Maritime Daily Digest(해운·선박관리 뉴스 사이트)의 도우미입니다. 해사 관련 질문에만 답하고, 개인정보·개인적인 질문·해사와 무관한 질문은 정중히 거절합니다. 웹 검색으로 신뢰할 수 있는 해사 매체·기관의 최신 기사를 찾아, 관련 뉴스를 최대한 많이 '날짜 · 매체 — 한 줄 요약' 형식의 목록으로 보여 주세요. 확인되지 않은 내용은 추측하지 말고, 한국어로 답하세요.",
  EN: "You are the assistant of Maritime Daily Digest, a shipping and ship-management news site. Answer only maritime questions; politely refuse personal questions, personal data and unrelated topics. Use web search on reliable maritime outlets and authorities and list as many relevant recent stories as possible as 'date · outlet — one-line summary'. Do not guess. Answer in English."
};

let mem = { day: "", api: 0, web: 0, ip: {} };
function today() { return new Date().toISOString().slice(0, 10); }
async function count(env, kind, limit) {
  const d = today();
  if (env.LIMITS) {
    const k = kind + ":" + d; const n = parseInt((await env.LIMITS.get(k)) || "0", 10);
    if (n >= limit) return false;
    await env.LIMITS.put(k, String(n + 1), { expirationTtl: 172800 }); return true;
  }
  if (mem.day !== d) mem = { day: d, api: 0, web: 0, ip: {} };
  if (mem[kind] >= limit) return false; mem[kind]++; return true;
}
function ipOk(req) { // per-instance burst guard: 20 requests per minute per IP
  const ip = req.headers.get("CF-Connecting-IP") || "x", m = Math.floor(Date.now() / 60000), k = ip + ":" + m;
  mem.ip[k] = (mem.ip[k] || 0) + 1; return mem.ip[k] <= 20;
}
function hdr(origin) {
  return { "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0], "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
}
const out = (o, origin, status = 200) => new Response(JSON.stringify(o), { status, headers: hdr(origin) });
function json(text) { const m = (text || "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (e) { return null; } }

async function claude(env, body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ model: env.CLAUDE_MODEL || "claude-haiku-5-5" }, body))
  });
  if (!r.ok) throw new Error("upstream " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}
const textOf = (d) => (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: hdr(origin) });
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "GET" && (path === "" || path === "/health")) return out({ ok: true, key: !!env.CLAUDE_API_KEY }, origin);
    if (req.method !== "POST") return out({ error: "POST only" }, origin, 405);
    if (!ORIGINS.includes(origin)) return out({ error: "origin" }, origin, 403);
    if (!env.CLAUDE_API_KEY) return out({ error: "no key" }, origin, 503);
    if (!ipOk(req)) return out({ error: "rate" }, origin, 429);
    let b = {}; try { b = await req.json(); } catch (e) {}
    const q = String(b.q || "").slice(0, 300).trim(), lang = b.lang === "EN" ? "EN" : "KR";
    if (!q) return out({ error: "empty" }, origin, 400);
    try {
      if (path === "/parse") {
        if (!(await count(env, "api", +(env.API_DAILY_LIMIT || 3000)))) return out({ error: "daily" }, origin, 429);
        const d = await claude(env, { max_tokens: 400, system: PARSE_SYS.replace("{TODAY}", today()), messages: [{ role: "user", content: q }] });
        const p = json(textOf(d)) || {};
        const concepts = (Array.isArray(p.concepts) ? p.concepts : []).slice(0, 4)
          .map((c) => (Array.isArray(c) ? c : [c]).map((t) => String(t).toLowerCase().trim()).filter((t) => t && t.length <= 40).slice(0, 12)).filter((c) => c.length);
        return out({ intent: p.intent || "news", concepts, sections: (p.sections || []).filter((s) => SECTIONS.split(" ").includes(s)),
          from: p.from || null, to: p.to || null, rewrite: String(p.rewrite || "").slice(0, 120) }, origin);
      }
      if (path === "/rerank") {
        if (!(await count(env, "api", +(env.API_DAILY_LIMIT || 3000)))) return out({ error: "daily" }, origin, 429);
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x) => ({ id: +x.id, t: String(x.t || "").slice(0, 160) }));
        if (!items.length) return out({ order: [] }, origin);
        const list = items.map((x) => x.id + ": " + x.t).join("\n");
        const d = await claude(env, { max_tokens: 500, system: RERANK_SYS, messages: [{ role: "user", content: "Question: " + q + "\n\nHeadlines:\n" + list }] });
        const p = json(textOf(d)) || {}, ids = new Set(items.map((x) => x.id));
        return out({ order: (p.order || []).map(Number).filter((i) => ids.has(i)), drop: (p.drop || []).map(Number).filter((i) => ids.has(i)) }, origin);
      }
      if (path === "/web") {
        if (!(await count(env, "web", +(env.WEB_DAILY_LIMIT || 50)))) return out({ error: "daily" }, origin, 429);
        const d = await claude(env, { max_tokens: 1500, system: WEB_SYS[lang],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_domains: DOMAINS }],
          messages: [{ role: "user", content: q }] });
        let answer = "", sources = [], seen = {};
        for (const blk of d.content || []) {
          if (blk.type === "text") { answer += blk.text; for (const c of blk.citations || []) if (c.url && !seen[c.url]) { seen[c.url] = 1; sources.push({ title: c.title || c.url, url: c.url }); } }
          if (blk.type === "web_search_tool_result" && Array.isArray(blk.content)) for (const s of blk.content) if (s.url && !seen[s.url]) { seen[s.url] = 1; sources.push({ title: s.title || s.url, url: s.url }); }
        }
        return out({ answer: answer.trim(), sources: sources.slice(0, 25) }, origin);
      }
      return out({ error: "not found" }, origin, 404);
    } catch (e) {
      return out({ error: String(e.message || e).slice(0, 200) }, origin, 502);
    }
  }
};
