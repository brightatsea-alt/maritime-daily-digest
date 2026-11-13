/* Maritime Daily Digest — chatbot (bottom-right button + right sidebar)
   - Default Korean, KR/EN toggle inside the panel
   - Explains purpose and how to use the site
   - Searches every archived edition and every topic tab, lists all related news
   - Nothing found -> asks the optional web endpoint (window.MDD_CHAT_API), otherwise shows reliable-site searches
   - Personal data and personal questions are refused */
(function(){
"use strict";
if(window.__mddChat) return; window.__mddChat = true;

var API = window.MDD_CHAT_API || "";          // optional: Cloudflare Worker URL (see chatbot-worker.js)
var PAGE = 30;                                // results per page in the panel
var lang = "KR";
try{ var sv = localStorage.getItem("mddChatLang"); if(sv==="EN"||sv==="KR") lang = sv; }catch(e){}

/* ---------- labels ---------- */
var CATN = {TOP:["Top News","Top News"],ACC:["사고","Accidents"],PSC:["PSC","PSC"],PCTC:["PCTC","PCTC"],WW:["Wallenius","Wallenius"],EE:["에너지효율","Energy"],DIG:["디지털","Digital"],TECH:["기술팀","Technical"],HR:["Marine HR","Marine HR"],HSEQ:["HSEQ","HSEQ"],KR:["한국해운","Korea"],INS:["P&I·H&M 보험","Insurance"],PNI:["P&I 클럽","P&I Clubs"],VET:["Vetting","Vetting"],CLASS:["선급","Class"],COMM:["커머셜·용선","Commercial"],GEO:["지리이슈","Geo Issue"],TW:["TradeWinds","TradeWinds"],HOT:["LL 핫토픽","LL Hot Topics"],SYS:["System & App","System & App"],SMGR:["선박관리사","Ship Manager"]};
var TABN = {WALWIL:["Wallenius 탭","Wallenius tab"],SHIPMGR:["선박관리사 벤치마크 탭","Ship manager benchmark tab"],KOREA:["한국 해사동향 탭","Korea maritime tab"],HRLEAD:["Marine HR·리더십·소통 탭","Marine HR & leadership tab"],HROFFICE:["HR·리더십·소통 탭","HR & leadership tab"],TONNAGE:["선복량·건조량 탭","Tonnage tab"]};
var TABFILE = {WALWIL:"walwil.js",SHIPMGR:"shipmgr.js",KOREA:"korea.js",HRLEAD:"hrlead.js",HROFFICE:"hroffice.js",TONNAGE:"tonnage.js"};

var TX = {
 KR:{title:"다이제스트 도우미",sub:"사이트 뉴스·사용법 안내",ph:"예: PSC 출항정지 뉴스, 자동차선 화재, 사용법",send:"보내기",close:"닫기",open:"챗봇 열기",
  hello:"안녕하세요. Maritime Daily Digest 도우미입니다. 지난 모든 호와 주제별 탭에서 관련 뉴스를 찾아 최대한 모두 보여드리고, 사이트의 목적과 사용 방법도 안내합니다. 개인정보나 개인적인 질문에는 답하지 않습니다.",
  chips:["이 사이트의 목적","사용 방법","오늘의 주요 뉴스","PSC 출항정지","자동차선 화재","사이버 보안","EU ETS·FuelEU","선원 리더십"],
  loading:"전체 아카이브를 불러오는 중… ",found:function(n,q){return "‘"+q+"’ 관련 뉴스 "+n+"건을 찾았습니다 (최근 순·관련도 순).";},
  partial:"모든 단어를 함께 포함한 기사가 없어, 일부 단어가 들어간 기사를 보여드립니다.",
  more:function(n){return "더 보기 (+"+n+")";},orig:"원문",
  none:function(q){return "사이트의 지난 호와 탭에서 ‘"+q+"’ 관련 기사를 찾지 못했습니다.";},
  webwait:"신뢰할 수 있는 해사 매체에서 찾는 중…",weberr:"외부 검색에 실패했습니다. 아래 신뢰 매체에서 직접 확인해 주세요.",
  ext:"신뢰할 수 있는 사이트에서 찾아보기",extnote:"아래 링크는 해당 매체의 검색 결과를 새 창으로 엽니다.",
  websrc:"출처",privacy:"이 챗봇은 사이트의 해사 뉴스와 사용 방법에 대해서만 답합니다. 개인정보(이름·연락처·주소·계좌 등)나 개인적인 질문에는 답하지 않습니다. 입력하신 개인정보는 저장하거나 전송하지 않았습니다.",
  empty:"질문을 입력해 주세요.",latest:function(d,n){return d+" 최신 호의 주요 뉴스입니다 (전체 "+n+"건 중 Top News·사고 우선).";}},
 EN:{title:"Digest assistant",sub:"Site news and how-to",ph:"e.g. PSC detention news, car carrier fire, how to use",send:"Send",close:"Close",open:"Open chatbot",
  hello:"Hello. I am the Maritime Daily Digest assistant. I search every past edition and topic tab and list as many related stories as I can find, and I explain what the site is for and how to use it. I do not answer personal questions or handle personal data.",
  chips:["Purpose of this site","How to use","Today's top news","PSC detention","Car carrier fire","Cyber security","EU ETS / FuelEU","Seafarer leadership"],
  loading:"Loading the full archive… ",found:function(n,q){return n+" stories found for “"+q+"” (by relevance, newest first).";},
  partial:"No story contains every word, so stories matching some of the words are shown.",
  more:function(n){return "Show more (+"+n+")";},orig:"Source",
  none:function(q){return "No story about “"+q+"” was found in the past editions or tabs.";},
  webwait:"Searching reliable maritime sources…",weberr:"The web search failed. Please check the reliable sources below.",
  ext:"Look it up on reliable sites",extnote:"Each link opens that outlet's search results in a new window.",
  websrc:"Sources",privacy:"This assistant only answers about the site's maritime news and how to use it. It does not answer personal questions or handle personal data (names, contacts, addresses, accounts, etc.). Nothing you typed was stored or sent.",
  empty:"Please type a question.",latest:function(d,n){return "Top stories from the latest edition, "+d+" ("+n+" items in total; Top News and accidents first).";}}
};

var ABOUT = {
 KR:'<b>Maritime Daily Digest는?</b><br>해운·선박관리 실무자를 위한 일일 해사 뉴스 포털입니다. 사고·PSC·자동차선(PCTC)·에너지효율·디지털·기술·Marine HR·HSEQ·보험·Vetting·선급·커머셜·지정학 등 <b>21개 분야</b>의 주요 기사를 매일 모아 <b>한글·영문 요약</b>과 <b>선박관리사 관점의 시사점</b>(사고는 원인·교훈)으로 정리합니다.<br><br><b>목적</b><ul><li>매일 아침 10~15분 안에 업계 흐름을 파악</li><li>사고·규제·PSC 동향을 현장 조치와 교육 자료로 연결</li><li>선복량·전망·벤치마크로 중장기 판단 근거 마련</li></ul>모든 기사는 원문 링크를 함께 제공합니다.',
 EN:'<b>What is Maritime Daily Digest?</b><br>A daily maritime news portal for shipping and ship-management professionals. Every day it gathers key stories in <b>21 sections</b> (accidents, PSC, car carriers, energy efficiency, digital, technical, marine HR, HSEQ, insurance, vetting, class, commercial, geopolitics and more) and summarises them in <b>Korean and English</b> with <b>implications for ship managers</b> (cause and lessons for accidents).<br><br><b>Purpose</b><ul><li>Catch up on the industry in 10–15 minutes a day</li><li>Turn accident, regulatory and PSC news into onboard actions and training material</li><li>Support longer-term decisions with tonnage, forecast and benchmark tabs</li></ul>Every story links to its original source.'
};
var HOWTO = {
 KR:'<b>사용 방법</b><ol><li><b>상단 탭</b><ul><li>📰 일일 다이제스트 — 그날의 21개 분야 뉴스</li><li>🟦 Wallenius — Wallenius Wilhelmsen·EUKOR·노르웨이 현지 뉴스</li><li>🔭 선박관리사 벤치마크 — 세계 선박관리사의 이니셔티브·툴·행사</li><li>📊 선복량·건조량 / 🔮 Forecast — 선대 규모와 선종별 전망</li><li>🇰🇷 한국 해사동향 — 공고·행사·지원정책</li><li>⚓ Marine HR·리더십·소통 / 💼 HR·리더십·소통 — 해상·육상 리더십과 협업</li></ul></li><li><b>분야 칩</b>(사고·PSC·PCTC…)을 누르면 해당 분야의 지난 기사까지 모아 볼 수 있습니다.</li><li><b>날짜 선택</b>으로 지난 호를 엽니다. 상단 <b>검색창</b>은 지금 보고 있는 화면 안에서 찾습니다.</li><li><b>🌐 KR/EN</b> 버튼으로 사이트 언어를 바꿉니다.</li><li>제목을 누르면 <b>원문</b>으로 이동합니다.</li><li>이 <b>챗봇</b>은 모든 지난 호와 탭을 한꺼번에 검색합니다. 예: “PSC 출항정지”, “자동차선 화재”, “사이버”, “EU ETS”.</li></ol>',
 EN:'<b>How to use</b><ol><li><b>Top tabs</b><ul><li>📰 Daily digest — the day\'s news in 21 sections</li><li>🟦 Wallenius — Wallenius Wilhelmsen, EUKOR and Norwegian local news</li><li>🔭 Ship manager benchmark — initiatives, tools and events of leading ship managers</li><li>📊 Tonnage / 🔮 Forecast — fleet size and outlook by ship type</li><li>🇰🇷 Korea maritime — notices, events and support schemes</li><li>⚓ Marine HR & leadership / 💼 HR & leadership — sea and shore leadership and collaboration</li></ul></li><li>Click a <b>section chip</b> (Accidents, PSC, PCTC…) to see that section\'s past stories too.</li><li>Use the <b>date selector</b> for past editions. The <b>search box</b> at the top filters the current screen.</li><li>Switch the site language with <b>🌐 KR/EN</b>.</li><li>Click a headline to open the <b>original article</b>.</li><li>This <b>chatbot</b> searches all past editions and tabs at once, e.g. "PSC detention", "car carrier fire", "cyber", "EU ETS".</li></ol>'
};

/* ---------- reliable sites for fallback ---------- */
function extLinks(q){
 var e = encodeURIComponent(q), g = function(site){ return "https://www.google.com/search?q="+e+"+site%3A"+site; };
 return [
  ["Google News", lang==="KR" ? "https://news.google.com/search?q="+e+"&hl=ko&gl=KR&ceid=KR:ko" : "https://news.google.com/search?q="+e+"&hl=en-US&gl=US&ceid=US:en"],
  ["IMO", g("imo.org")],["SAFETY4SEA", g("safety4sea.com")],["gCaptain", g("gcaptain.com")],
  ["Hellenic Shipping News", g("hellenicshippingnews.com")],["The Maritime Executive", g("maritime-executive.com")],
  ["Splash247", g("splash247.com")],["Lloyd's List", g("lloydslist.com")],["Paris MoU / Tokyo MoU", "https://www.google.com/search?q="+e+"+site%3Aparismou.org+OR+site%3Atokyo-mou.org"],
  ["한국해운신문 (KSG)", g("ksg.co.kr")],["해양수산부", g("mof.go.kr")]
 ];
}

/* ---------- privacy guard ---------- */
var PII = [/[\w.+-]+@[\w-]+\.[\w.]+/, /(\+?\d{1,3}[\s-]?)?0?1[016789][\s-]?\d{3,4}[\s-]?\d{4}/, /\d{6}\s*-\s*[1-4]\d{6}/, /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/];
var PERSONAL = [
 /주민(등록)?번호|여권\s*번호|계좌\s*번호|카드\s*번호|비밀\s*번호|패스워드|password|passport|credit\s*card|bank\s*account|social\s*security/i,
 /(내|나의|제|저의|너의|네|당신의?)\s*(이름|나이|주소|집|전화|연락처|핸드폰|휴대폰|번호|이메일|메일주소|연봉|월급|가족|애인|여자\s*친구|남자\s*친구|건강|기분|성격|취미)/,
 /너는?\s*누구|넌\s*누구|사랑해|심심해|외로워|우울해|연애|데이트|결혼\s*(해|할|했)|몇\s*살/,
 /\b(my|your)\s+(name|age|address|phone|number|email|salary|family|girlfriend|boyfriend|health|mood|hobby)\b|who\s+are\s+you|are\s+you\s+(single|married|human)|i\s+love\s+you|i\s*'?m\s+(lonely|bored|sad)/i,
 /(전화번호|연락처|집\s*주소|이메일\s*주소|개인\s*정보).*(알려|찾아|뭐|무엇|어디)|(phone\s*number|home\s*address|e-?mail\s*address|personal\s*(data|info)).*(of|for)/i
];
function isPersonal(q){ return PII.some(function(r){return r.test(q);}) || PERSONAL.some(function(r){return r.test(q);}); }

/* ---------- intents ---------- */
var RX_ABOUT = /목적|무슨\s*사이트|어떤\s*사이트|사이트\s*소개|뭐\s*하는|purpose|what\s+is\s+this|about\s+(this\s+)?site|what\s+does\s+this/i;
var RX_HOW = /사용\s*법|사용\s*방법|이용\s*방법|어떻게\s*(써|쓰|사용|이용|보)|도움말|탭\s*설명|기능|how\s+to\s+use|how\s+do\s+i|\bhelp\b|features|tabs?\b/i;
var RX_LATEST = /^(오늘|최신|최근|today|latest|헤드라인|주요)\s*(의|호|자)?\s*(주요|top)?\s*(뉴스|기사|헤드라인|news|stories|headlines)?\s*(는|은|좀|보여줘|알려줘|\?)*$|오늘의\s*주요\s*뉴스|today'?s\s+top\s+news/i;

/* ---------- search ---------- */
var STOP = "뉴스 기사 관련 관한 대한 대해 대해서 알려줘 알려 주세요 찾아줘 찾아 보여줘 보여 있어 있나 있나요 있는지 최근 최신 요즘 내용 정리 정리해줘 좀 무엇 뭐 뭐가 어떤 어떻게 및 그리고 news article articles about related on of the a an for to in show me find latest recent any is are what".split(" ");
var PART = /(으로|에서|에게|까지|부터|이랑|하고|이란|이나|은|는|이|가|을|를|에|의|로|와|과|도|만|랑)$/;
var SYN = [
 ["psc","항만국통제","항만국","port state control"],["출항정지","detention","detained","detain","억류"],["결함","deficiency","deficiencies","지적"],
 ["pctc","pcc","자동차선","자동차운반선","car carrier","car carriers","ro-ro","roro","vehicle carrier"],["화재","fire","fires","blaze"],
 ["전기차","ev","evs","electric vehicle","electric vehicles","배터리","battery","lithium","리튬"],["사고","accident","incident","casualty","사망","fatal","fatality"],
 ["충돌","collision","collided"],["좌초","grounding","grounded","aground"],["침몰","sank","sinking","capsized","전복"],
 ["사이버","cyber","cybersecurity","cyber-attack","cyberattack","해킹","hacking","hacker","hackers","ransomware","랜섬웨어","phishing","피싱","malware","악성코드"],["gnss","gps","spoofing","jamming","교란","위성항법"],
 ["탄소","carbon","co2","배출","emission","emissions","ghg","온실가스","탈탄소","decarbonisation","decarbonization"],
 ["ets","eu ets","배출권"],["fueleu","fuel eu","fueleu maritime"],["cii","eexi"],["imo","국제해사기구"],["넷제로","net-zero","net zero","nzf","mepc"],
 ["메탄올","methanol"],["암모니아","ammonia"],["lng","액화천연가스"],["수소","hydrogen"],["이중연료","dual-fuel","dual fuel"],
 ["선원","seafarer","seafarers","crew","crews","선원들"],["리더십","leadership","leader","leaders"],["교육","training","훈련","drill","drills"],
 ["심리적 안전","psychological safety","speak up","speak-up"],["협업","collaboration","teamwork"],
 ["보험","insurance","insurer","underwriting"],["p&i","pi club","p&i club","피앤아이"],["선급","class","classification","dnv","abs","lr","kr","bv","classnk"],
 ["벤팅","vetting","rightship","sire","risq","oci","ocimf"],["용선","charter","charterer","chartering","운임","freight","rates"],
 ["신조","newbuild","newbuilding","newbuildings","발주","order","orders","orderbook","수주"],["해체","scrap","scrapping","recycling","demolition","재활용"],
 ["홍해","red sea","후티","houthi","houthis"],["호르무즈","hormuz","페르시아만","persian gulf","이란","iran"],["흑해","black sea","우크라이나","ukraine","russia","러시아"],
 ["제재","sanction","sanctions","shadow fleet","그림자 선단","dark fleet"],["관세","tariff","tariffs","입항료","port fee","port fees","ustr"],
 ["항만","port","ports","terminal","터미널"],["북극항로","arctic","northern sea route","nsr"],["자율운항","autonomous","mass","자율"],
 ["ai","인공지능","artificial intelligence","llm"],["디지털","digital","digitalisation","digitalization","플랫폼","platform"],
 ["선박관리","ship management","shipmanagement","ship manager","ship managers","선박관리사","관리사"],["월레니우스","wallenius","wilhelmsen","walwil","ww","eukor","유코"],
 ["한국","korea","korean","국내"],["해양수산부","mof","해수부"],["중국","china","chinese"],["일본","japan","japanese"],["미국","us","usa","united states","uscg","미 해안경비대"],
 ["벌크","bulk","bulker","bulkers","dry bulk","건화물"],["탱커","tanker","tankers","유조선"],["컨테이너","container","containership","boxship"],
 ["선복량","fleet","tonnage","capacity"],["전망","forecast","outlook","전망치"],["감사","audit","심사","inspection","검사"],["ism","안전관리"],["mlc","노동협약"],
 ["밸러스트","ballast","bwm","bwms"],["스크러버","scrubber","scrubbers"],["해적","piracy","pirates","무장강도","armed robbery"],
 ["피로","fatigue","휴식시간","rest hours"],["정신건강","mental health","wellbeing","well-being","복지","welfare"],["급여","wage","wages","임금","salary"]
];
var SYNMAP = {}; SYN.forEach(function(g){ g.forEach(function(w){ SYNMAP[w] = g; }); });
var CODEWORDS = {}; Object.keys(CATN).forEach(function(c){ CODEWORDS[CATN[c][0].toLowerCase()] = c; CODEWORDS[CATN[c][1].toLowerCase()] = c; CODEWORDS[c.toLowerCase()] = c; });

function norm(s){ return (s||"").toLowerCase(); }
function groupsOf(q){
 var s = " "+norm(q).replace(/[“”"'‘’?!.,·…:;()\[\]{}<>~]/g," ")+" ", groups = [], used = {};
 // multi-word synonyms first
 SYN.forEach(function(g){ g.forEach(function(w){ if(w.indexOf(" ")>0 && s.indexOf(" "+w+" ")>=0 && !used[g[0]]){ used[g[0]]=1; groups.push({terms:g,code:null,label:w}); s = s.split(" "+w+" ").join(" "); } }); });
 s.split(/\s+/).forEach(function(t){
  if(!t) return; if(STOP.indexOf(t)>=0) return;
  var b = t; if(/[가-힣]/.test(b) && b.length>2) b = b.replace(PART,""); if(STOP.indexOf(b)>=0 || !b) return;
  var g = SYNMAP[b] || SYNMAP[t];
  if(g){ if(used[g[0]]) return; used[g[0]]=1; groups.push({terms:g,code:CODEWORDS[b]||null,label:b}); return; }
  if(b.length<2 && !/[가-힣]/.test(b)) return;
  groups.push({terms:[b],code:CODEWORDS[b]||null,label:b});
 });
 return groups;
}
function matchTerm(text, term){
 if(/^[a-z0-9&+\- ]+$/.test(term) && term.length<=4){ // short latin terms: word boundary
  return new RegExp("(^|[^a-z0-9])"+term.replace(/[.*+?^${}()|[\]\\&]/g,"\\$&")+"([^a-z0-9]|$)").test(text);
 }
 return text.indexOf(term)>=0;
}

/* ---------- data loading ---------- */
var corpus = null, loadingP = null;
function loadScript(src){ return new Promise(function(res){ var s=document.createElement("script"); s.src=src; s.onload=function(){res(true);}; s.onerror=function(){res(false);}; document.head.appendChild(s); }); }
function loadAll(progress){
 if(corpus) return Promise.resolve(corpus);
 if(loadingP) return loadingP;
 var man = window.DIGEST_MANIFEST || []; window.DIGEST_ARCHIVE = window.DIGEST_ARCHIVE || {};
 var need = man.filter(function(d){ return !window.DIGEST_ARCHIVE[d]; }), done = man.length-need.length, total = man.length + Object.keys(TABFILE).length;
 var tick = function(){ done++; if(progress) progress(done,total); };
 var jobs = need.map(function(d){ return loadScript("digest-"+d+".js").then(tick); });
 Object.keys(TABFILE).forEach(function(k){ if(window[k]){ tick(); } else jobs.push(loadScript(TABFILE[k]).then(tick)); });
 loadingP = Promise.all(jobs).then(function(){ corpus = build(); return corpus; });
 return loadingP;
}
function build(){
 var out = [], seen = {};
 var push = function(it, src){
  var url = it.url || it.link || "", key = (url || "") + "|" + (it.title||it.k||"");
  if(seen[key]) return; seen[key]=1;
  var kt = it.title || it.k || "", et = it.eTitle || it.e || "";
  var ks = it.kSum || it.kFig || "", es = it.eSum || it.eFig || "";
  var ki = it.kImp || it.kLes || "", ei = it.eImp || it.eLes || "";
  out.push({date:it.date||src.date||"", code:it.code||"", src:it.src||it.org||it.orgEN||"", url:url, kt:kt, et:et, ks:ks, es:es, ki:ki, ei:ei, tab:src.tab||"",
   hay:norm([kt,et,ks,es,ki,ei,it.kCause,it.eCause,it.src,it.org,it.orgEN,it.tag,it.tagEN].join(" ")), head:norm(kt+" "+et)});
 };
 var A = window.DIGEST_ARCHIVE || {};
 Object.keys(A).forEach(function(d){ var dg = A[d]; if(!dg||!dg.sections) return; dg.sections.forEach(function(s){ (s.items||[]).forEach(function(it){ if(!it.code) it.code = s.code; push(it,{date:d}); }); }); });
 Object.keys(TABFILE).forEach(function(k){ var T = window[k]; if(!T) return;
  (T.groups||[]).forEach(function(g){ (g.items||[]).forEach(function(it){ push(it,{tab:k,date:it.date||T.updated}); }); });
  (T.top||[]).forEach(function(it){ push({date:it.date,title:it.k,eTitle:it.e,url:it.url,tag:it.tag,tagEN:it.tagEN,src:it.src},{tab:k}); });
 });
 return out;
}
function search(q){
 var gs = groupsOf(q); if(!gs.length) return {groups:gs, hits:[], partial:false};
 var score = function(r, g){
  if(g.code && r.code===g.code) return 2;
  for(var i=0;i<g.terms.length;i++){ var t=g.terms[i]; if(matchTerm(r.head,t)) return 3; }
  for(var j=0;j<g.terms.length;j++){ if(matchTerm(r.hay,g.terms[j])) return 1; }
  return 0;
 };
 var all = [], some = [];
 corpus.forEach(function(r){ var tot=0, hit=0; gs.forEach(function(g){ var s=score(r,g); if(s){hit++; tot+=s;} }); if(hit===gs.length) all.push({r:r,s:tot}); else if(hit>0) some.push({r:r,s:tot+hit*2,h:hit}); });
 var sorter = function(a,b){ return (b.s-a.s) || (b.r.date>a.r.date?1:b.r.date<a.r.date?-1:0); };
 if(all.length) return {groups:gs, hits:all.sort(sorter).map(function(x){return x.r;}), partial:false};
 some = some.filter(function(x){ return gs.length<3 || x.h>=2; });
 return {groups:gs, hits:some.sort(function(a,b){ return (b.h-a.h)||sorter(a,b); }).map(function(x){return x.r;}), partial:some.length>0};
}

/* ---------- UI ---------- */
var css = ''
+'#mddcBtn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;background:#1F4E79;color:#fff;box-shadow:0 6px 20px rgba(15,40,70,.35);cursor:pointer;z-index:9998;display:flex;align-items:center;justify-content:center;transition:transform .15s}'
+'#mddcBtn:hover{transform:scale(1.06)}#mddcBtn svg{width:28px;height:28px}'
+'#mddcPanel{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:min(480px,100vw);background:#fff;color:#1b2533;box-shadow:-8px 0 28px rgba(15,40,70,.22);z-index:9999;display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s ease;font-family:inherit}'
+'#mddcPanel.on{transform:none}'
+'.mddc-h{display:flex;align-items:center;gap:10px;padding:14px 14px 12px 16px;background:#1F4E79;color:#fff}'
+'.mddc-h .t{flex:1;min-width:0}.mddc-h b{display:block;font-size:16px}.mddc-h span{font-size:12px;opacity:.85}'
+'.mddc-lg{display:flex;border:1px solid rgba(255,255,255,.6);border-radius:16px;overflow:hidden}.mddc-lg button{background:transparent;color:#fff;border:0;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer}.mddc-lg button.on{background:#fff;color:#1F4E79}'
+'.mddc-x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}'
+'.mddc-b{flex:1;overflow-y:auto;padding:14px;background:#f5f7fa;display:flex;flex-direction:column;gap:10px}'
+'.mddc-m{max-width:100%;padding:10px 12px;border-radius:12px;font-size:14px;line-height:1.55;word-break:break-word}'
+'.mddc-m.bot{background:#fff;border:1px solid #e4e8ef;align-self:stretch}.mddc-m.me{background:#1F4E79;color:#fff;align-self:flex-end;max-width:85%}'
+'.mddc-m ul,.mddc-m ol{margin:6px 0 0 18px;padding:0}.mddc-m li{margin:3px 0}'
+'.mddc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.mddc-chips button{border:1px solid #c9d6e6;background:#eef3f9;color:#1F4E79;border-radius:14px;padding:5px 10px;font-size:12.5px;cursor:pointer}'
+'.mddc-r{border-top:1px solid #eef1f5;padding:9px 0 8px}.mddc-r:first-of-type{border-top:0}'
+'.mddc-r .mt{font-size:11.5px;color:#6b7a8c;margin-bottom:2px}.mddc-r .mt i{font-style:normal;background:#eef3f9;color:#1F4E79;border-radius:8px;padding:1px 6px;margin-right:4px}'
+'.mddc-r a.tt{font-weight:700;color:#1b2533;text-decoration:none;font-size:13.5px}.mddc-r a.tt:hover{text-decoration:underline;color:#1F4E79}'
+'.mddc-r .sm{font-size:12.5px;color:#46546a;margin-top:3px}'
+'.mddc-more{margin-top:8px;width:100%;border:1px solid #c9d6e6;background:#fff;color:#1F4E79;border-radius:8px;padding:7px;cursor:pointer;font-weight:700}'
+'.mddc-ext a{display:inline-block;margin:3px 4px 3px 0;padding:4px 9px;border-radius:12px;background:#fff7ec;border:1px solid #f1d3a8;color:#8a4b00;text-decoration:none;font-size:12.5px}'
+'.mddc-note{font-size:12px;color:#6b7a8c}.mddc-warn{background:#fff4f4;border-color:#f3c9c9}'
+'.mddc-f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e4e8ef;background:#fff}'
+'.mddc-f textarea{flex:1;resize:none;border:1px solid #cfd8e3;border-radius:10px;padding:9px 10px;font:inherit;font-size:14px;height:42px;max-height:110px}'
+'.mddc-f button{border:0;background:#1F4E79;color:#fff;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer}'
+'@media (max-width:640px){#mddcBtn{right:14px;bottom:14px;width:52px;height:52px}}'
+'@media (prefers-color-scheme:dark){#mddcPanel{background:#151b24;color:#e6edf5}.mddc-b{background:#0f141b}.mddc-m.bot{background:#1b2330;border-color:#2a3546}.mddc-r a.tt{color:#e6edf5}.mddc-r .sm{color:#b3c0d0}.mddc-r{border-color:#2a3546}.mddc-f{background:#151b24;border-color:#2a3546}.mddc-f textarea{background:#0f141b;color:#e6edf5;border-color:#2a3546}.mddc-more{background:#1b2330}}';
var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

var btn = document.createElement("button"); btn.id = "mddcBtn";
btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
var panel = document.createElement("aside"); panel.id = "mddcPanel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-hidden","true");
panel.innerHTML = '<div class="mddc-h"><div class="t"><b id="mddcT"></b><span id="mddcS"></span></div><div class="mddc-lg"><button id="mddcKR">KR</button><button id="mddcEN">EN</button></div><button class="mddc-x" id="mddcX">×</button></div>'
 +'<div class="mddc-b" id="mddcBody"></div>'
 +'<div class="mddc-f"><textarea id="mddcIn" rows="1" maxlength="300"></textarea><button id="mddcGo"></button></div>';
document.body.appendChild(btn); document.body.appendChild(panel);
var body = panel.querySelector("#mddcBody"), input = panel.querySelector("#mddcIn");

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }
function cut(s,n){ s = s||""; return s.length>n ? s.slice(0,n).replace(/\s+\S*$/,"")+"…" : s; }
function T(){ return TX[lang]; }
function paint(){
 panel.querySelector("#mddcT").textContent = T().title; panel.querySelector("#mddcS").textContent = T().sub;
 panel.querySelector("#mddcGo").textContent = T().send; panel.querySelector("#mddcX").title = T().close;
 btn.title = T().open; btn.setAttribute("aria-label", T().open); input.placeholder = T().ph;
 panel.querySelector("#mddcKR").classList.toggle("on", lang==="KR"); panel.querySelector("#mddcEN").classList.toggle("on", lang==="EN");
}
function add(html, who, cls){ var d=document.createElement("div"); d.className="mddc-m "+(who||"bot")+(cls?" "+cls:""); d.innerHTML=html; body.appendChild(d); body.scrollTop = body.scrollHeight; return d; }
function chips(list){ return '<div class="mddc-chips">'+list.map(function(c){return '<button type="button" data-q="'+esc(c)+'">'+esc(c)+'</button>';}).join("")+'</div>'; }
function welcome(){ body.innerHTML=""; add(esc(T().hello)+chips(T().chips)); }

function label(r){
 if(r.tab) return TABN[r.tab] ? TABN[r.tab][lang==="KR"?0:1] : r.tab;
 return CATN[r.code] ? CATN[r.code][lang==="KR"?0:1] : (r.code||"");
}
function rowHTML(r){
 var ttl = lang==="KR" ? (r.kt||r.et) : (r.et||r.kt), sm = lang==="KR" ? (r.ks||r.es||r.ki) : (r.es||r.ks||r.ei);
 var a = r.url ? '<a class="tt" href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(ttl)+' ↗</a>' : '<span class="tt" style="font-weight:700">'+esc(ttl)+'</span>';
 return '<div class="mddc-r"><div class="mt"><i>'+esc(label(r))+'</i>'+esc(r.date)+(r.src?' · '+esc(r.src):'')+'</div>'+a+(sm?'<div class="sm">'+esc(cut(sm,170))+'</div>':'')+'</div>';
}
function listInto(box, rows){
 var shown = 0;
 var more = function(){
  var html = rows.slice(shown, shown+PAGE).map(rowHTML).join(""); shown += PAGE;
  var old = box.querySelector(".mddc-more"); if(old) old.remove();
  box.insertAdjacentHTML("beforeend", html);
  if(shown < rows.length){ var b=document.createElement("button"); b.className="mddc-more"; b.textContent=T().more(rows.length-shown); b.onclick=more; box.appendChild(b); }
 };
 more();
}
function extHTML(q){
 return '<div class="mddc-ext"><b>'+esc(T().ext)+'</b><div class="mddc-note">'+esc(T().extnote)+'</div>'
  + extLinks(q).map(function(l){ return '<a href="'+esc(l[1])+'" target="_blank" rel="noopener">'+esc(l[0])+' ↗</a>'; }).join("") + '</div>';
}
function askWeb(q, box){
 if(!API){ box.insertAdjacentHTML("beforeend", extHTML(q)); body.scrollTop = body.scrollHeight; return; }
 var w = document.createElement("div"); w.className="mddc-note"; w.textContent = T().webwait; box.appendChild(w);
 fetch(API, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({q:q, lang:lang})})
  .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
  .then(function(j){
   w.remove();
   var html = '<div style="margin-top:6px">'+esc(j.answer||"").replace(/\n/g,"<br>")+'</div>';
   if(j.sources && j.sources.length) html += '<div class="mddc-note" style="margin-top:8px"><b>'+esc(T().websrc)+'</b></div>'
     + j.sources.map(function(s){ return '<div class="mddc-r"><a class="tt" href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.title||s.url)+' ↗</a></div>'; }).join("");
   box.insertAdjacentHTML("beforeend", html + extHTML(q)); body.scrollTop = body.scrollHeight;
  })
  .catch(function(){ w.textContent = T().weberr; box.insertAdjacentHTML("beforeend", extHTML(q)); });
}

function answer(q){
 q = (q||"").trim(); if(!q){ add(esc(T().empty)); return; }
 if(isPersonal(q)){ add(esc("•••"), "me"); add(esc(T().privacy), "bot", "mddc-warn"); return; }
 add(esc(q), "me");
 if(RX_ABOUT.test(q) && !RX_HOW.test(q)){ add(ABOUT[lang]+chips([T().chips[1],T().chips[2]])); return; }
 if(RX_HOW.test(q)){ add(HOWTO[lang]+chips([T().chips[0],T().chips[2]])); return; }
 var box = add('<span class="mddc-note">'+esc(T().loading)+'</span>');
 loadAll(function(d,t){ var n=box.querySelector(".mddc-note"); if(n) n.textContent = T().loading + d + "/" + t; }).then(function(){
  box.innerHTML = "";
  if(RX_LATEST.test(q)){
   var man = window.DIGEST_MANIFEST||[], d0 = man[0], dg = (window.DIGEST_ARCHIVE||{})[d0];
   if(dg){ var rows = corpus.filter(function(r){ return r.date && !r.tab && dg.sections.some(function(s){ return (s.items||[]).some(function(it){ return (it.url||"")===r.url && (it.title||"")===r.kt; }); }); });
    var pri = {TOP:0,ACC:1,PSC:2,PCTC:3}; rows.sort(function(a,b){ return ((pri[a.code]==null?9:pri[a.code])-(pri[b.code]==null?9:pri[b.code])); });
    box.insertAdjacentHTML("beforeend", '<div><b>'+esc(T().latest(d0, rows.length))+'</b></div>'); listInto(box, rows); body.scrollTop = body.scrollHeight; return; }
  }
  var res = search(q);
  if(res.hits.length){
   box.insertAdjacentHTML("beforeend", '<div><b>'+esc(T().found(res.hits.length, q))+'</b>'+(res.partial?'<div class="mddc-note">'+esc(T().partial)+'</div>':'')+'</div>');
   listInto(box, res.hits);
   if(res.partial || res.hits.length < 3) box.insertAdjacentHTML("beforeend", extHTML(q));
  } else {
   box.insertAdjacentHTML("beforeend", '<div><b>'+esc(T().none(q))+'</b></div>');
   askWeb(q, box);
  }
  body.scrollTop = body.scrollHeight;
 });
}

function open(){ panel.classList.add("on"); panel.setAttribute("aria-hidden","false"); btn.style.display="none"; if(!body.children.length) welcome(); setTimeout(function(){ input.focus(); }, 230); loadAll(); }
function close(){ panel.classList.remove("on"); panel.setAttribute("aria-hidden","true"); btn.style.display=""; }
function setL(l){ lang = l; try{ localStorage.setItem("mddChatLang", l); }catch(e){} paint(); welcome(); }

btn.addEventListener("click", open);
panel.querySelector("#mddcX").addEventListener("click", close);
panel.querySelector("#mddcKR").addEventListener("click", function(){ setL("KR"); });
panel.querySelector("#mddcEN").addEventListener("click", function(){ setL("EN"); });
panel.querySelector("#mddcGo").addEventListener("click", function(){ var v=input.value; input.value=""; answer(v); });
input.addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); var v=input.value; input.value=""; answer(v); } });
body.addEventListener("click", function(e){ var b = e.target.closest("button[data-q]"); if(b) answer(b.getAttribute("data-q")); });
document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.classList.contains("on")) close(); });
paint();
window.MDDChat = {open:open, close:close, ask:function(q){ open(); answer(q); }};
})();
