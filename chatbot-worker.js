/* Optional web-search backend for the Maritime Daily Digest chatbot (Cloudflare Worker).
   Not used by the site until it is deployed and its URL is put in index.html:
     <script>window.MDD_CHAT_API = "https://<your-worker>.workers.dev";</script>
   Setup (Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy):
     Settings → Variables and Secrets:
       CLAUDE_API_KEY  (Secret)  — your Anthropic API key, entered by you
       CLAUDE_MODEL    (Text, optional) — default below
   The worker only answers maritime questions, searches only the reliable domains listed below,
   refuses personal questions and never stores requests. */
const ORIGIN = "https://brightatsea-alt.github.io";
const DOMAINS = ["imo.org","safety4sea.com","gcaptain.com","hellenicshippingnews.com","maritime-executive.com","splash247.com",
  "lloydslist.com","tradewindsnews.com","rivieramm.com","seatrade-maritime.com","shipmanagementinternational.com","parismou.org",
  "tokyo-mou.org","uscg.mil","emsa.europa.eu","dnv.com","lr.org","classnk.or.jp","krs.co.kr","ics-shipping.org","bimco.org",
  "intercargo.org","ocimf.org","rightship.com","gard.no","skuld.com","nepia.com","ukpandi.com","westpandi.com","britanniapandi.com",
  "mof.go.kr","ksg.co.kr","shippingnewsnet.com","haesanews.com","kmi.re.kr"];
const SYSTEM = {
  KR: "당신은 Maritime Daily Digest(해운·선박관리 일일 뉴스 사이트)의 도우미입니다. 해운·해사·선박관리 관련 질문에만 답합니다. 개인정보나 개인적인 질문, 해사와 무관한 질문에는 정중히 거절합니다. 반드시 웹 검색으로 신뢰할 수 있는 해사 매체·기관 자료를 찾아 최신 기사 위주로 관련 뉴스를 최대한 많이 나열하고(날짜·매체·한 줄 요약), 확인되지 않은 내용은 추측하지 마세요. 한국어로 간결하게 답하세요.",
  EN: "You are the assistant of Maritime Daily Digest, a daily shipping and ship-management news site. Answer only maritime, shipping and ship-management questions. Politely refuse personal questions, requests for personal data and unrelated topics. Always use web search on reliable maritime outlets and authorities, list as many relevant recent stories as you can (date, outlet, one-line summary), and do not guess. Answer concisely in English."
};
const cors = (o) => ({ "Access-Control-Allow-Origin": o === ORIGIN ? ORIGIN : ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8" });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors(origin) });
    if (origin && origin !== ORIGIN) return new Response(JSON.stringify({ error: "origin" }), { status: 403, headers: cors(origin) });
    let q = "", lang = "KR";
    try { const j = await req.json(); q = String(j.q || "").slice(0, 300); lang = j.lang === "EN" ? "EN" : "KR"; } catch (e) {}
    if (!q.trim()) return new Response(JSON.stringify({ error: "empty" }), { status: 400, headers: cors(origin) });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 1500, system: SYSTEM[lang],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4, allowed_domains: DOMAINS }],
        messages: [{ role: "user", content: q }]
      })
    });
    if (!r.ok) return new Response(JSON.stringify({ error: "upstream " + r.status }), { status: 502, headers: cors(origin) });
    const data = await r.json();
    let answer = "", sources = [], seen = {};
    for (const b of data.content || []) {
      if (b.type === "text") {
        answer += b.text;
        for (const c of b.citations || []) if (c.url && !seen[c.url]) { seen[c.url] = 1; sources.push({ title: c.title || c.url, url: c.url }); }
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const s of b.content) if (s.url && !seen[s.url]) { seen[s.url] = 1; sources.push({ title: s.title || s.url, url: s.url }); }
      }
    }
    return new Response(JSON.stringify({ answer: answer.trim(), sources: sources.slice(0, 25) }), { headers: cors(origin) });
  }
};
