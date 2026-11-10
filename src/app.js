/* NEXUS Launcher — cliente */
import * as Client from "./net.js";

const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>[...r.querySelectorAll(s)];
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const DEF_GAMES = [
  {id:"star-velocity", name:"Star Velocity", desc:"Corrida de naves multiplayer — lobby, personagens, loja e emotes. 🚀", play:"https://teclucascode.github.io/star-velocity/", repo:"https://github.com/teclucascode/star-velocity", cover:"src/images/star-velocity-cover.jpg", cat:"Corrida", by:"teclucascode"},
  {id:"stick-arena", name:"Stick Arena", desc:"Batalha 2D de stickmen — 4 classes • 20 armas • 5 arenas • 4 modos. Do Lucas! ⚔️", play:"https://teclucascode.github.io/stick-arena/", repo:"https://github.com/teclucascode/stick-arena", cover:"src/images/stick-arena-cover.jpg", cat:"Multiplayer", by:"teclucascode"},
  {id:"neon-clicker", name:"Neon Clicker", desc:"Clicker incremental demo com save na nuvem e XP. Feito para testar a launcher.", play:"src/games/neon-clicker.html", repo:"", cover:"", cat:"Demo", by:"NEXUS", builtIn:true},
  {id:"mini-snake", name:"Mini Snake", desc:"Snake clássico em canvas. Bate recorde e ganha XP.", play:"src/games/mini-snake.html", repo:"", cover:"", cat:"Demo", by:"NEXUS", builtIn:true},
];

// URLs "src/..." -> absoluta resolvida pelo baseURI (é onde o Perchance serve os arquivos; o iframe carrega cross-origin e fala via postMessage)
export function gameUrl(g){
  const p = g.play || "";
  if(/^(?:\.\/)?src\//.test(p)){ try{ let b=document.baseURI; if(!b.endsWith("/")) b+="/"; return new URL(p.replace(/^\.\//,""), b).href; }catch(e){} }
  return p;
}

export const S = {
  user:null, token:localStorage.nexus_token||"",
  view:"biblio", games:[], chatRoom:"global", chatCache:{},
  invites:[], online:[], current:null, playSec:0, playTimer:null,
  serverOk:false, ghUser:"", filter:"", cat:"Todas", sort:"padrao",
  favs: JSON.parse(localStorage.nexus_favs||"[]"),
  recent: JSON.parse(localStorage.nexus_recent||"{}"),
  installPrompt:null, topCache:null, session:null,
};

/* 🔊 bipes simples (level-up, convite, clique) */
let AC=null;
export function beep(freq=660, dur=0.12, type="sine", vol=0.15){
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(), g=AC.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g); g.connect(AC.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime+dur);
    o.stop(AC.currentTime+dur);
  }catch(e){}
}

export function levelOf(xp){ return Math.floor(Math.sqrt((xp||0)/100))+1; }
export function xpForLevel(lv){ return 100*(lv-1)*(lv-1); }
export function xpProgress(xp){
  const lv=levelOf(xp), cur=xpForLevel(lv), nxt=xpForLevel(lv+1);
  return {lv, pct: nxt===cur?100:Math.min(100,Math.round((xp-cur)/(nxt-cur)*100)), cur, nxt};
}

export async function boot(){
  renderShell();
  await Client.ensureSocket(onServerMsg);
  // tenta sessão salva
  if(S.token){
    const me = await Client.rpc("me",{token:S.token}).catch(()=>null);
    if(me && me.ok){ setUser(me.user, S.token); }
    else { S.token=""; localStorage.removeItem("nexus_token"); }
  }
  if(!S.user){
    const g = localStorage.nexus_guest ? JSON.parse(localStorage.nexus_guest) : null;
    if(g) setUser(g, "");
  }
  await refreshGames();
  if(!S.user) showAuth();
  else showMain();
  setInterval(tickPresence, 30000);
  setInterval(pollInvites, 12000);
  window.addEventListener("message", onGameMessage);
  window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); S.installPrompt=e; paintInstall(); });
}
export function paintInstall(){
  const b=$("#installBtn"); if(!b) return;
  b.hidden = !S.installPrompt;
}

function setUser(u, token){
  S.user = u;
  if(token){ S.token=token; localStorage.nexus_token=token; }
  Client.setToken(S.token);
  localStorage.nexus_guest = JSON.stringify({...u, token:undefined});
  try{ root.kv.launcher.set("profile", u); }catch(e){}
}

export function logout(){
  if(S.token) Client.rpc("logout",{token:S.token}).catch(()=>{});
  S.user=null; S.token=""; Client.setToken("");
  localStorage.removeItem("nexus_token"); localStorage.removeItem("nexus_guest");
  stopPlayTimer(); showAuth();
}

/* ---------- shell ---------- */
function renderShell(){
  document.getElementById("app").innerHTML = `
  <aside id="side">
    <div class="brand"><div class="logo">◈</div><div>NEXUS<small>GAME LAUNCHER</small></div></div>
    <div id="profCard"></div>
    <div class="side-sec">MENU</div>
    <nav class="nav" id="nav">
      <button data-v="biblio"><span class="ico">🎮</span>Biblioteca</button>
      <button data-v="rank"><span class="ico">🏆</span>Ranking</button>
      <button data-v="add"><span class="ico">＋</span>Adicionar jogo</button>
      <button data-v="github"><span class="ico">🐙</span>GitHub</button>
      <button data-v="perfil"><span class="ico">👤</span>Perfil & XP</button>
      <button data-v="contas"><span class="ico">🔗</span>Contas</button>
      <button data-v="chat"><span class="ico">💬</span>Chat <span id="chatBadge"></span></button>
      <button data-v="amigos"><span class="ico">✉️</span>Convites <span id="invBadge"></span></button>
      <button data-v="saves"><span class="ico">💾</span>Salvamentos</button>
      <button data-v="ajuda"><span class="ico">❓</span>Como funciona</button>
    </nav>
    <button class="btn small" id="installBtn" hidden style="margin-top:6px">📲 Instalar app</button>
    <div style="flex:1"></div>
    <div class="side-sec">SESSÃO</div>
    <div style="display:flex;gap:8px">
      <button class="btn ghost small" id="logoutBtn" style="flex:1">Sair</button>
      <button class="btn ghost small" id="menuMobile" style="display:none">☰</button>
    </div>
    <div class="small mut" id="srvStat">● conectando…</div>
  </aside>
  <main id="main">
    <header id="top">
      <button class="btn ghost small" id="hamb" style="display:none">☰</button>
      <b id="viewTitle">Biblioteca</b>
      <input id="search" type="text" placeholder="🔎 buscar jogo…" style="max-width:260px;margin-left:auto">
      <span class="pill" id="onlinePill" title="jogadores online">● 0</span>
    </header>
    <div id="view"></div>
  </main>
  <div class="toast" id="toasts"></div>`;
  $("#nav").addEventListener("click",e=>{
    const b=e.target.closest("button"); if(!b) return;
    S.view=b.dataset.v; showMain();
  });
  $("#logoutBtn").onclick=logout;
  $("#installBtn").onclick=async()=>{
    if(!S.installPrompt) return;
    S.installPrompt.prompt();
    try{ await S.installPrompt.userChoice; }catch(e){}
    S.installPrompt=null; paintInstall();
  };
  paintInstall();
  $("#search").oninput=e=>{S.filter=e.target.value.toLowerCase(); if(S.view==="biblio")renderBiblio();};
  $("#hamb").onclick=()=>{const s=$("#side"); s.style.display=s.style.display==="flex"?"none":"flex"; s.style.position="fixed"; s.style.zIndex=50; s.style.height="100vh";};
  if(innerWidth<900){$("#hamb").style.display="";$("#side").style.display="none";$("#side").style.flex="none";}
}
function showMobileNav(){ const s=$("#side"); if(!s) return; if(innerWidth<900){s.style.display="none";} else {s.style.display=""; s.style.position="";} const h=$("#hamb"); if(h) h.style.display = innerWidth<900 ? "" : "none"; }

export function showAuth(){
  $("#side").style.display="none";
  $("#main").style.display="none";
  let w=$("#authWrap"); if(!w){ w=document.createElement("div"); w.id="authWrap"; document.body.appendChild(w); }
  w.hidden=false;
  w.innerHTML=`
  <div id="authCard">
    <div class="hero">
      <div style="font-size:44px">◈</div>
      <h1 style="margin:0">NEXUS Launcher</h1>
      <p class="mut" style="color:#cdd6f4">Sua conta de jogador: biblioteca, saves na nuvem, XP, chat e convites. Adicione seus jogos do <b>GitHub</b> e jogue sem perder progresso.</p>
      <div class="kv">
        <div class="stat"><b>☁️</b><span>saves na nuvem</span></div>
        <div class="stat"><b>⚡</b><span>XP + níveis</span></div>
        <div class="stat"><b>💬</b><span>chat + convites</span></div>
      </div>
      <p class="small" style="color:#9fb0d8">Dica: depois de publicar no GitHub Pages, cole a URL em “Adicionar jogo”.</p>
    </div>
    <div class="form">
      <h2 style="margin:0">Criar ou conectar conta</h2>
      <p class="mut small">Conta salva no servidor — entre de qualquer dispositivo e continue de onde parou.</p>
      <div class="tabs">
        <button class="btn small" id="tLogin">Entrar</button>
        <button class="btn ghost small" id="tReg">Criar conta</button>
        <button class="btn ghost small" id="tGuest">Convidado</button>
      </div>
      <div id="authForm"></div>
      <p class="small mut" id="authMsg"></p>
      <p class="small mut">Sem senha real! Use um apelido + senha só para esta launcher (dados de demonstração).</p>
    </div>
  </div>`;
  const f=msg=>{$("#authMsg").innerHTML=msg||"";};
  const loginForm=()=>{ $("#authForm").innerHTML=`
    <label class="small mut">Usuário (3–16, letras/números)</label><input id="aU" type="text" placeholder="ex: darkplayer" autocomplete="username">
    <div style="height:8px"></div><label class="small mut">Senha</label><input id="aP" type="password" placeholder="••••••" autocomplete="current-password">
    <div style="height:12px"></div><button class="btn" id="aGo" style="width:100%">Entrar →</button>`;
    $("#aGo").onclick=async()=>{
      const u=$("#aU").value.trim(), p=$("#aP").value; if(!u||!p) return f("Preencha usuário e senha.");
      f(`<span class="loading"></span> entrando…`);
      const r=await Client.rpc("login",{u,p}).catch(e=>({ok:false,err:String(e.message||e)}));
      if(r.ok){ setUser(r.user,r.token); w.hidden=true; $("#side").style.display=""; $("#main").style.display=""; showMain(); toast(`Bem-vindo, ${esc(r.user.d)}!`); }
      else f("❌ "+esc(r.err||"falha no login"));
    };};
  const regForm=()=>{ $("#authForm").innerHTML=`
    <label class="small mut">Usuário</label><input id="aU" type="text" placeholder="ex: darkplayer">
    <div style="height:8px"></div><label class="small mut">Nome de exibição</label><input id="aD" type="text" placeholder="ex: Dark Player">
    <div style="height:8px"></div><label class="small mut">Senha</label><input id="aP" type="password" placeholder="mín. 4 letras">
    <div style="height:12px"></div><button class="btn" id="aGo" style="width:100%">Criar conta ✨</button>`;
    $("#aGo").onclick=async()=>{
      const u=$("#aU").value.trim(), p=$("#aP").value, d=$("#aD").value.trim()||u;
      if(u.length<3) return f("Usuário muito curto.");
      f(`<span class="loading"></span> criando…`);
      const r=await Client.rpc("register",{u,p,d}).catch(e=>({ok:false,err:String(e.message||e)}));
      if(r.ok){ setUser(r.user,r.token); w.hidden=true; $("#side").style.display=""; $("#main").style.display=""; showMain(); toast(`Conta criada! +50 XP de boas-vindas ⚡`); }
      else f("❌ "+esc(r.err||"falha no cadastro"));
    };};
  $("#tLogin").onclick=()=>{loginForm();}; $("#tReg").onclick=()=>{regForm();};
  $("#tGuest").onclick=()=>{
    const g={u:"guest"+Math.floor(Math.random()*9000+1000), d:"Convidado", a:"🧙", xp:0, play:0};
    setUser(g,""); w.hidden=true; $("#side").style.display=""; $("#main").style.display=""; showMain();
    toast("Modo convidado — progresso só neste aparelho.");
  };
  loginForm();
}

export function showMain(){
  $("#authWrap") && ($("#authWrap").hidden=true);
  $("#side").style.display=""; $("#main").style.display="";
  paintProfile(); paintNav();
  ({biblio:renderBiblio, rank:renderRank, add:renderAdd, github:renderGithub, perfil:renderPerfil,
    contas:renderContas, chat:renderChat, amigos:renderAmigos, saves:renderSaves, ajuda:renderAjuda}[S.view]||renderBiblio)();
  showMobileNav(); paintInstall();
}
function paintNav(){ $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===S.view));
  $("#viewTitle").textContent={biblio:"Biblioteca",rank:"Ranking 🏆",add:"Adicionar jogo",github:"Conectar GitHub",perfil:"Perfil & XP",contas:"Contas 🔗",chat:"Chat",amigos:"Convites",saves:"Salvamentos",ajuda:"Como funciona"}[S.view]||"";
  const n=S.invites.filter(i=>i.st===0).length;
  $("#invBadge").textContent=n?`(${n})`:"";
}
function paintProfile(){
  const u=S.user||{d:"—",a:"🙂",xp:0};
  const {lv,pct}=xpProgress(u.xp||0);
  $("#profCard").innerHTML=`<div class="av">${esc(u.a||"🎮")}</div>
    <div style="flex:1;min-width:0"><b>${esc(u.d||u.u)}</b><div class="small mut">@${esc(u.u||"")} · Nv ${lv}</div>
    <div class="xpbar"><i style="width:${pct}%"></i></div>
    <div class="small mut">${u.xp||0} XP</div></div>`;
  $("#srvStat").innerHTML = S.serverOk ? `● servidor <b style="color:var(--ok)">online</b>` : `● modo <b style="color:var(--warn)">local</b> (servidor fora)`;
}
export function toast(html, ms=4200){
  const t=document.createElement("div"); t.innerHTML=html;
  $("#toasts").appendChild(t); setTimeout(()=>t.remove(), ms);
}

/* ---------- jogos ---------- */
export async function refreshGames(){
  let server=[];
  try{ const r=await Client.rpc("listGames",{}); if(r&&r.ok) server=r.games; S.serverOk=true; }catch(e){ S.serverOk=false; }
  let local=[]; try{ local=await root.kv.launcher.get("games")||[]; }catch(e){ try{local=JSON.parse(localStorage.nexus_games||"[]");}catch(_){} }
  const map=new Map();
  [...DEF_GAMES, ...server, ...local].forEach(g=>{ if(g&&g.id&&!map.has(g.id)){
    if(typeof g.play==="string") g.play=g.play.replace(/^\.\/src\//,"src/");
    map.set(g.id,g); } });
  S.games=[...map.values()];
  paintProfile();
}
/* capas: http direto; src/... via fetch->blob (funciona no preview e publicado) */
export function paintCovers(scope){
  if(!scope||!scope.querySelectorAll) return;
  scope.querySelectorAll("[data-cover]").forEach(el=>{
    const c=el.getAttribute("data-cover"); if(!c) return;
    if(/^https?:\/\//.test(c)||c.startsWith("data:")||c.startsWith("blob:")){ el.style.backgroundImage=`url("${c}")`; return; }
    fetch(c).then(r=>{ if(!r.ok) throw 0; return r.blob(); }).then(b=>{
      if(document.contains(el)) el.style.backgroundImage=`url("${URL.createObjectURL(b)}")`;
    }).catch(()=>{});
  });
}
export function isFav(gid){ return S.favs.includes(gid); }
export function toggleFav(gid){
  S.favs = isFav(gid) ? S.favs.filter(f=>f!==gid) : [...S.favs, gid];
  try{ localStorage.nexus_favs=JSON.stringify(S.favs); }catch(e){}
  beep(isFav(gid)?880:440, .08); 
}
function gameCard(g){
  const xp = saveXP(g.id);
  const fav = isFav(g.id);
  return `<div class="gcard" data-id="${esc(g.id)}">
    <div class="cover" data-cover="${esc(g.cover||"")}"><button class="favBtn" title="Favoritar">${fav?"⭐":"☆"}</button>${g.builtIn?"🕹️":"🎮"}</div>
    <div class="meta"><h3>${esc(g.name)}</h3><p>${esc(g.desc||"")}</p>
    <div class="row"><span class="pill">${esc(g.cat||"Jogo")}</span><span class="small mut">${xp?`⚡${xp} XP`:``}</span></div>
    <div class="row"><button class="btn small playBtn">▶ Jogar</button>
    <button class="btn ghost small detBtn">Detalhes</button></div></div></div>`;
}
function saveXP(gid){ try{ return (JSON.parse(localStorage["nexus_xp_"+gid]||"0"))|0; }catch(e){ return 0; } }

function sortedGames(list){
  const l=[...list];
  if(S.sort==="az") l.sort((a,b)=>a.name.localeCompare(b.name));
  else if(S.sort==="xp") l.sort((a,b)=>(saveXP(b.id)||0)-(saveXP(a.id)||0));
  else if(S.sort==="fav") l.sort((a,b)=>(isFav(b.id)?1:0)-(isFav(a.id)?1:0));
  return l;
}

export function renderBiblio(){
  const cats=["Todas",...new Set(S.games.map(g=>g.cat||"Jogo"))];
  const feat=S.games.find(g=>g.id==="stick-arena")||S.games.find(g=>g.cover);
  let list=S.games.filter(g=>
      (S.cat==="Todas"||(g.cat||"Jogo")===S.cat) &&
      (!S.filter||(g.name+" "+(g.desc||"")).toLowerCase().includes(S.filter))
    );
  list=sortedGames(list);
  const recentIds=Object.entries(S.recent).sort((a,b)=>b[1]-a[1]).slice(0,4).map(e=>e[0])
    .map(id=>S.games.find(g=>g.id===id)).filter(Boolean);
  $("#view").innerHTML=`
  ${feat?`<div class="hero" data-cover="${esc(feat.cover||"")}">
    <div class="heroTxt"><span class="pill">⭐ DESTAQUE</span>
    <h2>${esc(feat.name)}</h2><p>${esc(feat.desc||"")}</p>
    <div style="display:flex;gap:8px"><button class="btn" id="heroPlay">▶ Jogar agora</button>
    <button class="btn ghost" id="heroRank">🏆 Ranking</button></div></div>
  </div>`:""}
  ${recentIds.length?`<div class="side-sec" style="margin-top:14px">🕘 CONTINUAR JOGANDO</div>
  <div class="grid" id="recentRow" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${recentIds.map(gameCard).join("")}</div>`:""}
  <div class="toolbar" style="margin-top:14px">
    <select id="catSel" style="max-width:150px">${cats.map(c=>`<option ${S.cat===c?"selected":""}>${esc(c)}</option>`).join("")}</select>
    <select id="sortSel" style="max-width:150px">
      <option value="padrao" ${S.sort==="padrao"?"selected":""}>📦 Padrão</option>
      <option value="az" ${S.sort==="az"?"selected":""}>🔤 A–Z</option>
      <option value="xp" ${S.sort==="xp"?"selected":""}>⚡ Mais XP</option>
      <option value="fav" ${S.sort==="fav"?"selected":""}>⭐ Favoritos</option>
    </select>
    <button class="btn small" id="newBtn">＋ Adicionar jogo</button>
    <button class="btn ghost small" id="ghBtn">🐙 GitHub</button>
    <span class="mut small">${list.length} jogos</span>
  </div>
  <div class="grid" id="gg">${list.map(gameCard).join("")||`<div class="card">Nenhum jogo. Adicione um pelo GitHub! 👆</div>`}</div>
  <div class="card" style="margin-top:14px"><b>💡 Como colocar seus jogos do GitHub aqui?</b>
  <div class="small mut">1) Publique o jogo com GitHub Pages (Settings → Pages → Deploy from branch). 2) Copie a URL <code>https://SEUUSER.github.io/SEUREPO</code>. 3) Clique em <b>Adicionar jogo</b> e cole. Pronto — vira um card jogável com save + XP.</div></div>`;
  $("#catSel").onchange=e=>{S.cat=e.target.value; renderBiblio();};
  $("#sortSel").onchange=e=>{S.sort=e.target.value; renderBiblio();};
  $("#newBtn").onclick=()=>{S.view="add"; showMain();};
  $("#ghBtn").onclick=()=>{S.view="github"; showMain();};
  const hero=$(".hero"); if(hero){
    $("#heroPlay").onclick=()=>openGame(feat);
    $("#heroRank").onclick=()=>{S.view="rank"; showMain();};
  }
  bindCards($("#view"));
  paintCovers($("#view"));
}
function bindCards(scope){
  $$(".gcard", scope).forEach(c=>{
    const g=S.games.find(x=>x.id===c.dataset.id); if(!g) return;
    const fav=c.querySelector(".favBtn");
    if(fav) fav.onclick=ev=>{ev.stopPropagation(); toggleFav(g.id); renderBiblio();};
    c.querySelector(".playBtn").onclick=ev=>{ev.stopPropagation(); openGame(g);};
    c.querySelector(".detBtn").onclick=ev=>{ev.stopPropagation(); openDetail(g);};
    c.onclick=()=>openDetail(g);
  });
}

function openDetail(g){
  $("#view").innerHTML=`<button class="btn ghost small" id="backBtn">← voltar</button>
  <div class="card" style="margin-top:10px;display:grid;grid-template-columns:220px 1fr;gap:16px">
    <div data-cover="${esc(g.cover||"")}" style="font-size:90px;background:#222c52 center/cover;border-radius:12px;display:grid;place-items:center;min-height:180px;">🎮</div>
    <div><h2 style="margin:0">${esc(g.name)}</h2>
    <p class="mut">${esc(g.desc||"")}</p>
    <p class="small">Categoria: <span class="pill">${esc(g.cat||"Jogo")}</span> · por <b>${esc(g.by||"você")}</b></p>
    ${g.repo?`<p class="small">🔗 Repo: <a href="${esc(g.repo)}" target="_blank">${esc(g.repo)}</a></p>`:""}
    ${g.play?`<p class="small">▶️ URL: <code>${esc(g.play)}</code></p>`:""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn" id="playBtn">▶ Jogar agora</button>
      <button class="btn ghost" id="invBtn">✉️ Convidar amigo</button>
      <button class="btn ghost" id="chatBtn">💬 Chat do jogo</button>
    </div>
    <div id="savesPrev" class="small mut" style="margin-top:10px"></div></div>
  </div>`;
  $("#backBtn").onclick=renderBiblio;
  $("#playBtn").onclick=()=>openGame(g);
  $("#chatBtn").onclick=()=>{S.chatRoom="game:"+g.id; S.view="chat"; showMain();};
  $("#invBtn").onclick=()=>inviteDialog(g);
  paintCovers($("#view"));
  loadSavesPreview(g);
}
async function loadSavesPreview(g){
  const el=$("#savesPrev"); if(!el) return;
  const s=await getSaves(g.id);
  const n=Object.keys(s||{}).length;
  el.textContent=n?`💾 ${n} slot(s) com salvamento.`:`💾 Nenhum save ainda — jogue e salve seu progresso!`;
}

/* ---------- jogar ---------- */
export function openGame(g){
  S.current=g; S.playSec=0; stopPlayTimer();
  try{ S.recent[g.id]=Date.now();
    const keys=Object.entries(S.recent).sort((a,b)=>b[1]-a[1]).slice(0,12);
    S.recent=Object.fromEntries(keys); localStorage.nexus_recent=JSON.stringify(S.recent);
  }catch(e){}
  $("#view").innerHTML=`
  <button class="btn ghost small" id="backBtn">← biblioteca</button>
  <div class="kv" style="margin-top:10px">
    <div class="stat"><b>${esc(g.name)}</b><span>${esc(g.cat||"")}</span></div>
    <div class="stat"><b id="playTime">00:00</b><span>tempo de sessão</span></div>
    <div class="stat"><b id="sessXP">+0</b><span>XP da sessão</span></div>
  </div>
  <div id="playWrap"><iframe id="gameFrame" ${/^(\.\/)?src\//.test(g.play||"") ? "" : `src="${esc(gameUrl(g))}"`} allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe></div>
  <div class="toolbar" style="margin-top:10px">
    <button class="btn small" id="fsBtn">⛶ Tela cheia</button>
    <button class="btn ghost small" id="saveBtn">💾 Salvar progresso</button>
    <button class="btn ghost small" id="loadBtn">📂 Carregar</button>
    <button class="btn ghost small" id="xpBtn">⚡ +5 XP (marco)</button>
    <span class="small mut">Jogando ganha XP automaticamente (≈2 XP/min). Saves ficam na nuvem ☁️ <span id="playLoad">⏳ carregando jogo…</span> · <span id="sessInfo">🎫 …</span></span>
  </div>
  <div class="card"><b>💾 Saves — ${esc(g.name)}</b><div id="slotList"></div>
  <div class="small mut">Jogos integrados (demos) salvam sozinhos. Jogos externos: use o botão salvar ou o save interno do jogo + cole aqui.</div></div>`;
  $("#backBtn").onclick=()=>{stopPlayTimer(); renderBiblio();};
  $("#fsBtn").onclick=()=>{const f=$("#gameFrame"); f.requestFullscreen&&f.requestFullscreen();};
  $("#saveBtn").onclick=()=>saveDialog(g);
  $("#loadBtn").onclick=()=>loadDialog(g);
  $("#xpBtn").onclick=()=>addXP(5,"marco em "+g.name);
  paintSlots(g);
  // jogos embutidos (src/...) vão via srcdoc: fetch (passa pelo SW) + injeta — funciona no preview e publicado
  if(/^(\.\/)?src\//.test(g.play||"")){
    fetch((g.play||"").replace(/^\.\//,"")).then(r=>{ if(!r.ok) throw 0; return r.text(); }).then(html=>{
      const f=$("#gameFrame"); if(f && S.current===g){ f.removeAttribute("src"); f.srcdoc=html;
        const t=$("#playLoad"); if(t) t.textContent="✔ jogo carregado e conectado"; }
    }).catch(()=>{ const t=$("#playLoad"); if(t) t.textContent="⚠️ falha ao carregar — verifique após salvar"; });
  } else {
    const t=$("#playLoad"); if(t) t.textContent="✔ jogo externo carregado";
  }
  mintSession(g);
  S.playTimer=setInterval(()=>{
    S.playSec++;
    const m=String(Math.floor(S.playSec/60)).padStart(2,"0"), s=String(S.playSec%60).padStart(2,"0");
    const el=$("#playTime"); if(el) el.textContent=`${m}:${s}`;
    paintSess();
    // XP a cada minuto
    if(S.playSec%60===0){ addXP(2,"tempo de jogo",g.id,true); const x=$("#sessXP"); if(x) x.textContent="+"+(parseInt(x.textContent.slice(1))||0)+2; }
    // heartbeat a cada 30s
    if(S.playSec%30===0 && S.token) Client.rpc("heartbeat",{token:S.token,addSec:30,gid:g.id}).catch(()=>{});
  },1000);
  Client.rpc("heartbeat",{token:S.token,gid:g.id}).catch(()=>{});
}
function stopPlayTimer(){ if(S.playTimer){clearInterval(S.playTimer); S.playTimer=null;} }
async function paintSlots(g){
  const el=$("#slotList"); if(!el) return;
  const s=await getSaves(g.id);
  el.innerHTML=[1,2,3].map(n=>{
    const v=s[n]; return `<div class="saveRow"><b>Slot ${n}</b>
    <span class="small mut" style="flex:1">${v?`${esc(String(v.data).slice(0,80))}… · ${new Date(v.ts).toLocaleString()}`:"— vazio —"}</span>
    <button class="btn ghost small" data-a="save" data-n="${n}">Salvar</button>
    <button class="btn ghost small" data-a="load" data-n="${n}" ${v?"":"disabled"}>Ler</button></div>`;
  }).join("");
  el.onclick=e=>{
    const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.a==="save") saveDialog(g, +b.dataset.n);
    else loadDialog(g, +b.dataset.n);
  };
}

/* saves */
async function getSaves(gid){
  if(S.token){ try{ const r=await Client.rpc("mySaves",{token:S.token}); if(r&&r.ok) return r.saves[gid]||{}; }catch(e){} }
  try{ return JSON.parse(localStorage["nexus_save_"+gid]||"{}"); }catch(e){ return {}; }
}
function saveDialog(g, preset=1){
  const d=document.createElement("dialog"); d.innerHTML=`
    <h3>💾 Salvar — ${esc(g.name)}</h3>
    <label class="small mut">Slot</label><select id="slotSel"><option>1</option><option>2</option><option>3</option></select>
    <div style="height:8px"></div><label class="small mut">Dados do save (texto/JSON do jogo)</label>
    <textarea id="saveTxt" rows="4" placeholder='ex: {"fase":5,"moedas":120}'></textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ok">Salvar ☁️</button><button class="btn ghost" id="cx">Cancelar</button></div>`;
  document.body.appendChild(d); d.showModal(); d.querySelector("#slotSel").value=String(preset);
  d.querySelector("#cx").onclick=()=>{d.close(); d.remove();};
  d.querySelector("#ok").onclick=async()=>{
    const slot=+d.querySelector("#slotSel").value, data=d.querySelector("#saveTxt").value||"(vazio)";
    if(S.token){ const r=await Client.rpc("saveSlot",{token:S.token,gid:g.id,slot,data}).catch(e=>({ok:false,err:String(e)})); if(!r.ok){toast("❌ "+esc(r.err)); return;} }
    const all=await getSaves(g.id); all[slot]={data,ts:Date.now()}; localStorage["nexus_save_"+g.id]=JSON.stringify(all);
    toast(`💾 Salvo no slot ${slot} (nuvem + local)`); addXP(3,"save guardado"); d.close(); d.remove(); paintSlots(g);
  };
}
async function loadDialog(g, preset){
  const s=await getSaves(g.id);
  const slots=preset?[preset]:[1,2,3].filter(n=>s[n]);
  if(!slots.length) return toast("Nenhum save para carregar.");
  const pick = preset || (slots.length===1?slots[0]:+prompt("Slots com save: "+slots.join(", ")+"\nDigite o slot:","1"));
  const v=(await getSaves(g.id))[pick]; if(!v) return toast("Slot vazio.");
  // envia para o jogo via postMessage
  const f=$("#gameFrame");
  if(f&&f.contentWindow){ try{ f.contentWindow.postMessage({nexus:"load",slot:pick,data:v.data},"*"); }catch(e){} }
  prompt("📂 Save do slot "+pick+" (copie para usar no jogo):", String(v.data).slice(0,2000));
}
function onGameMessage(ev){
  const m=ev.data; if(!m||m.nexus==null&&m.nexus===undefined) return; if(typeof m!=="object"||!m.nexus) return;
  const g=S.current; if(!g) return;
  if(m.nexus==="save"){ (async()=>{
    if(S.token) await Client.rpc("saveSlot",{token:S.token,gid:g.id,slot:m.slot||1,data:String(m.data||"")}).catch(()=>{});
    const all=await getSaves(g.id); all[m.slot||1]={data:String(m.data||""),ts:Date.now()}; localStorage["nexus_save_"+g.id]=JSON.stringify(all);
    toast(`💾 Save automático (${esc(g.name)} slot ${m.slot||1})`); addXP(2,"save automático");
  })();}
  if(m.nexus==="xp" && (+m.amount||0)>=1){ addXP(Math.min(50,Math.max(1,+m.amount||1)), m.reason||("jogo "+g.name), g.id); }
  if(m.nexus==="ready"){ const t=document.querySelector("#playLoad"); if(t) t.textContent="✔ jogo carregado e conectado"; sendIdentity(); }
  if(m.nexus==="getIdentity"){ sendIdentity(); }
}

/* 🎫 sessão + identidade para o jogo */
export async function mintSession(g){
  S.session=null; paintSess();
  if(!g) return;
  if(!S.token){ sendIdentity(); paintSess(); return; }
  try{
    const r=await Client.rpc("session",{token:S.token,gid:g.id});
    if(r&&r.ok && S.current===g){ S.session={token:r.token,exp:r.exp,gid:g.id}; sendIdentity(); }
  }catch(e){}
  paintSess();
}
export function sendIdentity(){
  const f=$("#gameFrame"); if(!f||!f.contentWindow||!S.current) return;
  const u=S.user||{};
  const links=u.links||{};
  const link=links[S.current.id]||null;
  try{ f.contentWindow.postMessage({nexus:"identity",
    ok:!!S.token, guest:!S.token,
    id:u.nid||"", user:u.u||"", display:u.d||"", avatar:u.a||"",
    link:link, exp:S.session&&S.session.gid===S.current.id?S.session.exp:0,
    session:S.session&&S.session.gid===S.current.id?S.session.token:""}, "*"); }catch(e){}
}
export function paintSess(){
  const el=$("#sessInfo"); if(!el) return;
  if(!S.session||S.session.gid!==(S.current&&S.current.id)){ el.textContent = S.token ? "🎫 gerando sessão…" : "🎫 modo convidado"; return; }
  const ms=S.session.exp-Date.now();
  if(ms<=0){ el.innerHTML=`🎫 sessão vencida · <a href="#" id="renSess">renovar</a>`;
    const b=$("#renSess"); if(b) b.onclick=e=>{e.preventDefault(); mintSession(S.current);}; return; }
  const m=Math.floor(ms/60000), s=Math.floor(ms%60000/1000);
  el.textContent=`🎫 sessão ${m}:${String(s).padStart(2,"0")}`;
}

/* XP */
export async function addXP(amount, reason="", gid="", silent=false){
  amount=Math.max(1,Math.min(500,+amount||0));
  const before=levelOf(S.user?.xp||0);
  if(S.token){ try{ const r=await Client.rpc("addXP",{token:S.token,amount,reason}); if(r&&r.ok&&S.user){S.user.xp=r.xp; paintProfile();} }catch(e){ localXP(amount);} }
  else localXP(amount);
  if(gid){ try{localStorage["nexus_xp_"+gid]=String((+localStorage["nexus_xp_"+gid]||0)+amount);}catch(e){} }
  const after=levelOf(S.user?.xp||0);
  if(after>before && !silent){ levelUp(after); }
  else if(!silent){ /* toast pequeno */ }
  function localXP(a){ if(!S.user)return; S.user.xp=(S.user.xp||0)+a; localStorage.nexus_guest=JSON.stringify(S.user); paintProfile(); }
}
function levelUp(lv){
  beep(523,.12); setTimeout(()=>beep(659,.12),130); setTimeout(()=>beep(784,.2),260);
  const d=document.createElement("div"); d.className="lvlpop";
  d.innerHTML=`<div>🎉 NÍVEL ${lv}! ⚡</div>`; document.body.appendChild(d);
  setTimeout(()=>d.remove(),2200); toast(`⚡ Subiu para o nível <b>${lv}</b>!`);
}

/* ---------- adicionar jogo ---------- */
export function renderAdd(){
  $("#view").innerHTML=`<div class="card" style="max-width:640px">
  <h2 style="margin-top:0">＋ Adicionar jogo do GitHub</h2>
  <p class="mut small">Cole a URL jogável (GitHub Pages) e o repositório. O jogo vira um card na sua biblioteca e ganha saves + XP.</p>
  <label class="small mut">Nome do jogo *</label><input id="gName" type="text" placeholder="Ex: Minha Aventura Pixel">
  <div style="height:8px"></div><label class="small mut">URL jogável * (https://… — GitHub Pages, itch.io, etc)</label><input id="gPlay" type="url" placeholder="https://seuuser.github.io/seujogo">
  <div style="height:8px"></div><label class="small mut">Repositório GitHub (opcional)</label><input id="gRepo" type="url" placeholder="https://github.com/seuuser/seujogo">
  <div style="height:8px"></div><label class="small mut">Capa (URL da imagem, opcional)</label><input id="gCover" type="url" placeholder="https://…/capa.png">
  <div style="height:8px"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
  <div><label class="small mut">Categoria</label><select id="gCat"><option>Ação</option><option>Aventura</option><option>RPG</option><option>Puzzle</option><option>Corrida</option><option>Terror</option><option>Multiplayer</option><option>Demo</option><option>Outro</option></select></div>
  <div><label class="small mut">Descrição</label><input id="gDesc" type="text" placeholder="Uma frase sobre o jogo"></div></div>
  <div style="height:12px"></div><button class="btn" id="gAdd" style="width:100%">Adicionar à biblioteca 🚀</button>
  <p class="small mut" id="gMsg"></p>
  <hr style="border-color:var(--line)"><b>📦 Publicando seu jogo no GitHub Pages?</b>
  <ol class="small mut"><li>No repo do jogo: <b>Settings → Pages → Deploy from a branch → main + /(root)</b>.</li>
  <li>Coloque um <code>index.html</code> jogável na raiz do repo.</li><li>Aguarde 1–2 min e use a URL <code>https://SEUUSER.github.io/SEUREPO</code> aqui.</li></ol></div>`;
  $("#gAdd").onclick=async()=>{
    const game={name:$("#gName").value.trim(), play:$("#gPlay").value.trim(), repo:$("#gRepo").value.trim(),
      cover:$("#gCover").value.trim(), cat:$("#gCat").value, desc:$("#gDesc").value.trim()};
    if(!game.name||!game.play) return $("#gMsg").textContent="⚠️ Preencha nome e URL jogável.";
    if(!/^https?:\/\//.test(game.play)) return $("#gMsg").textContent="⚠️ URL jogável precisa começar com http(s)://";
    $("#gMsg").innerHTML=`<span class="loading"></span> salvando…`;
    const id="g"+Date.now().toString(36)+Math.floor(Math.random()*999);
    const rec={id,...game,by:S.user?.u||"você",ts:Date.now()};
    let ok=false;
    if(S.token){ try{ const r=await Client.rpc("addGame",{token:S.token,game:rec}); ok=r&&r.ok; if(!ok) $("#gMsg").textContent="❌ "+(r.err||"erro"); }catch(e){} }
    // sempre espelha local
    try{ const l=JSON.parse(localStorage.nexus_games||"[]"); l.unshift(rec); localStorage.nexus_games=JSON.stringify(l); try{await root.kv.launcher.set("games",l);}catch(e){} }catch(e){}
    if(S.token&&!ok){ /* ficou só local */ }
    await refreshGames(); S.view="biblio"; showMain(); toast(`🚀 <b>${esc(game.name)}</b> adicionado!`); addXP(10,"adicionou jogo");
  };
}

/* ---------- github ---------- */
export function renderGithub(){
  $("#view").innerHTML=`<div class="card" style="max-width:720px">
  <h2 style="margin-top:0">🐙 Conectar GitHub</h2>
  <p class="mut small">Digite seu usuário do GitHub para listar repositórios e adicionar com 1 clique. Para jogar, o repo precisa de GitHub Pages ativo (ou use a URL do itch.io).</p>
  <div style="display:flex;gap:8px"><input id="ghU" type="text" placeholder="seu-user-github" value="${esc(S.ghUser)}"><button class="btn" id="ghGo">Buscar repos</button></div>
  <p class="small mut">Ou conecte pelo token/URL direta em “Adicionar jogo”.</p>
  <div id="ghList" style="margin-top:10px"></div></div>`;
  $("#ghGo").onclick=async()=>{
    const u=$("#ghU").value.trim(); if(!u) return; S.ghUser=u;
    $("#ghList").innerHTML=`<span class="loading"></span> buscando @${esc(u)}…`;
    try{
      const r=await fetch(`https://api.github.com/users/${encodeURIComponent(u)}/repos?per_page=100&sort=updated`);
      if(!r.ok) throw new Error("usuário não encontrado");
      const repos=await r.json();
      if(!repos.length){ $("#ghList").innerHTML="Nenhum repo público."; return; }
      $("#ghList").innerHTML=repos.map(p=>`
        <div class="saveRow"><b style="flex:1">📦 ${esc(p.name)}<br><span class="small mut">${esc(p.description||"")}</span></b>
        <a class="btn ghost small" href="${esc(p.html_url)}" target="_blank">Repo</a>
        <button class="btn small" data-r="${esc(p.name)}" data-h="${esc(p.homepage||"")}">＋ Biblioteca</button></div>`).join("")+
        `<p class="small mut">Dica: ative Pages no repo para gerar a URL jogável automaticamente (<code>https://U.github.io/REPO</code>).</p>`;
      $("#ghList").onclick=async e=>{
        const b=e.target.closest("button"); if(!b) return;
        const repo=b.dataset.r, home=b.dataset.h;
        const play = home && home.startsWith("http") ? home : `https://${u}.github.io/${repo}`;
        const rec={id:"g"+Date.now().toString(36), name:repo, play, repo:`https://github.com/${u}/${repo}`, cover:"", cat:"GitHub", desc:"Importado do GitHub @"+u, by:S.user?.u||u, ts:Date.now()};
        if(S.token){ try{ await Client.rpc("addGame",{token:S.token,game:rec}); }catch(err){} }
        try{ const l=JSON.parse(localStorage.nexus_games||"[]"); l.unshift(rec); localStorage.nexus_games=JSON.stringify(l);}catch(err){}
        await refreshGames(); toast(`🚀 <b>${esc(repo)}</b> adicionado! Teste o ▶ Jogar — se der 404, ative o Pages no repo.`); S.view="biblio"; showMain();
      };
    }catch(err){ $("#ghList").innerHTML="❌ "+esc(err.message||"erro de rede"); }
  };
}

/* ---------- perfil ---------- */
export function renderPerfil(){
  const u=S.user||{xp:0}; const {lv,pct,cur,nxt}=xpProgress(u.xp||0);
  const avs=["🎮","🧙","🐉","🦊","🤖","👾","🐱","⚔️","🧝","👻"];
  $("#view").innerHTML=`<div class="grid" style="grid-template-columns:320px 1fr">
  <div class="card" style="text-align:center"><div style="font-size:64px">${esc(u.a||"🎮")}</div>
    <h2 style="margin:4px 0">${esc(u.d||u.u)}</h2><div class="mut small">@${esc(u.u||"")} · Nível ${lv}</div>
    ${u.nid?`<div class="pill" style="display:inline-block;margin-top:6px">🪪 ${esc(u.nid)}</div>`:""}
    <div class="xpbar"><i style="width:${pct}%"></i></div>
    <div class="small mut">${u.xp||0} XP · faltam ${(nxt-(u.xp||0))} para Nv ${lv+1}</div>
    <div style="height:10px"></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
    ${avs.map(a=>`<button class="btn ghost small avPick" style="${a===(u.a||"")?"border-color:var(--acc2)":""}">${a}</button>`).join("")}</div>
    <div style="height:10px"></div><input id="dName" type="text" value="${esc(u.d||"")}" placeholder="Nome de exibição">
    <div style="height:8px"></div><button class="btn small" id="saveP" style="width:100%">Salvar perfil</button>
    <div style="height:8px"></div><button class="btn ghost small" id="dailyBtn" style="width:100%">🎁 Resgatar +25 XP diários</button>
    <p class="small mut" id="rankPos"><span class="loading"></span> buscando posição…</p></div>
  <div class="card"><h3>⚡ Como ganhar XP</h3>
    <ul class="small"><li>⏱️ Jogar: <b>+2 XP/min</b> automático</li><li>💾 Salvar progresso: <b>+3 XP</b></li>
    <li>🚀 Adicionar jogo: <b>+10 XP</b></li><li>💬 Conversar: <b>+1 XP</b> por mensagem (limite diário)</li>
    <li>🎖️ Marcos no jogo (botão +5 XP ou API do jogo)</li></ul>
    <div class="kv"><div class="stat"><b>${lv}</b><span>nível</span></div>
    <div class="stat"><b>${u.xp||0}</b><span>XP total</span></div>
    <div class="stat"><b>${S.games.length}</b><span>jogos</span></div>
    <div class="stat"><b>${Math.floor((u.play||0)/60)}m</b><span>jogado</span></div></div>
    <h3>🎖️ Conquistas</h3><div id="ach"></div></div></div>`;
  $$(".avPick").forEach(b=>b.onclick=()=>{S.user.a=b.textContent; renderPerfil();});
  $("#saveP").onclick=async()=>{
    S.user.d=$("#dName").value.trim()||S.user.d;
    if(S.token){ try{await Client.rpc("updateProfile",{token:S.token,d:S.user.d,a:S.user.a});}catch(e){} }
    localStorage.nexus_guest=JSON.stringify(S.user); paintProfile(); toast("Perfil salvo ✔");
  };
  const ach=[
    [(u.xp||0)>=50,"🌱 Novato","50 XP"],
    [(u.xp||0)>=300,"⚔️ Veterano","300 XP"],
    [(u.xp||0)>=1000,"🐉 Lenda","1000 XP"],
    [S.games.length>=3,"📚 Colecionador","3+ jogos"],
  ];
  $("#ach").innerHTML=ach.map(([ok,t,d])=>`<div class="saveRow"><b>${ok?"✅":"🔒"} ${t}</b><span class="small mut" style="margin-left:auto">${d}</span></div>`).join("");
  $("#dailyBtn").onclick=async()=>{
    if(!S.token) return toast("Entre com sua conta para resgatar 🎁");
    const r=await Client.rpc("daily",{token:S.token}).catch(e=>({ok:false,err:String(e)}));
    if(r&&r.ok){ S.user.xp=r.xp; paintProfile(); renderPerfil(); toast(`🎁 +${r.amt} XP resgatados! Volte amanhã!`); beep(880,.15); beep(1174,.2); }
    else toast("❌ "+esc(r.err||"falha"));
  };
  (async()=>{
    try{
      const r=await Client.rpc("top",{}); const el=$("#rankPos"); if(!el) return;
      if(r&&r.ok){
        const i=r.top.findIndex(p=>S.user&&p.u===(S.user.u||"").toLowerCase());
        el.innerHTML=i>=0?`🏆 Você está em <b>#${i+1}</b> de ${r.total} jogadores! <a href="#" id="goRank">ver ranking</a>`
          :`🏆 ${r.total} jogadores no ranking. <a href="#" id="goRank">ver ranking</a>`;
        const a=$("#goRank"); if(a) a.onclick=e=>{e.preventDefault(); S.view="rank"; showMain();};
      } else el.textContent="🏆 Ranking indisponível (modo local)";
    }catch(e){ const el=$("#rankPos"); if(el) el.textContent="🏆 Ranking indisponível (modo local)"; }
  })();
}

/* ---------- ranking ---------- */
export async function renderRank(){
  $("#view").innerHTML=`<div class="card" style="max-width:640px"><h2 style="margin-top:0">🏆 Ranking de XP</h2>
  <div id="rankList"><span class="loading"></span> carregando…</div></div>`;
  try{
    const r=await Client.rpc("top",{});
    if(!r||!r.ok) throw 0;
    const medal=["🥇","🥈","🥉"];
    $("#rankList").innerHTML=r.top.map((p,i)=>`
      <div class="saveRow" ${S.user&&p.u===(S.user.u||"").toLowerCase()?'style="border-color:var(--acc2)"':""}>
      <b>${medal[i]||("#"+(i+1))} ${esc(p.a||"🎮")} ${esc(p.d)}</b>
      <span class="small mut">@${esc(p.u)}</span>
      <b style="margin-left:auto">⚡${p.xp}</b></div>`).join("")+
      `<p class="small mut">${r.total} jogadores · jogue, salve e resgate o daily para subir!</p>`;
  }catch(e){ $("#rankList").innerHTML=`<p class="mut">Ranking indisponível no modo local. Entre com sua conta! ⚡</p>`; }
}

/* ---------- contas: NEXUS ID + vínculos + sessão ---------- */
export async function renderContas(){
  const u=S.user||{};
  const links=u.links||{};
  const gids=Object.keys(links);
  $("#view").innerHTML=`<div class="card" style="max-width:680px"><h2 style="margin-top:0">🔗 Contas</h2>
  ${S.token?`
  <div class="idcard"><div><div class="small mut">SEU NEXUS ID</div>
    <b class="nid">${esc(u.nid||"gerando…")}</b><br>
    <span class="small mut">Passe pros amigos: convites aceitam @usuário ou NEXUS ID.</span></div>
    <button class="btn small" id="copyId">Copiar</button></div>
  <h3>🎮 Contas dos jogos</h3>
  <p class="small mut">Vincule seu nick em cada jogo — ele é enviado automaticamente ao abrir o jogo.</p>
  <div id="linkList">${gids.length?gids.map(gid=>{
    const g=S.games.find(x=>x.id===gid); const L=links[gid];
    return `<div class="saveRow"><b>🎮 ${esc(g?g.name:gid)}</b>
    <span style="flex:1">como <b>${esc(L.name)}</b>${L.tag?` <span class="small mut">[${esc(L.tag)}]</span>`:""}</span>
    <button class="btn ghost small unlk" data-g="${esc(gid)}">Desvincular</button></div>`;
  }).join(""):`<p class="mut">Nenhuma conta vinculada ainda.</p>`}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
    <select id="lkGame">${S.games.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select>
    <input id="lkName" type="text" maxlength="24" placeholder="Seu nick nesse jogo">
  </div>
  <div style="height:8px"></div><input id="lkTag" type="text" maxlength="24" placeholder="ID/clã no jogo (opcional)">
  <div style="height:8px"></div><button class="btn" id="lkAdd" style="width:100%">Vincular conta 🔗</button>
  <h3>🎫 Sessão de jogo</h3><div id="sessBox"></div>
  `:`<p class="mut">Entre com sua conta para ter NEXUS ID e vincular contas dos jogos. 🔑</p>`}
  </div>`;
  if(!S.token) return;
  const cp=$("#copyId");
  if(cp) cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(u.nid||""); toast("NEXUS ID copiado! 📋"); }
    catch(e){ prompt("Copie seu NEXUS ID:", u.nid||""); } };
  paintSessBox();
  $("#lkAdd").onclick=async()=>{
    const gid=$("#lkGame").value, name=$("#lkName").value.trim(), tag=$("#lkTag").value.trim();
    if(!name) return toast("Digite seu nick no jogo.");
    const r=await Client.rpc("link",{token:S.token,gid,name,tag}).catch(e=>({ok:false,err:String(e)}));
    if(r&&r.ok){ S.user.links=r.links; try{localStorage.nexus_guest=JSON.stringify(S.user);}catch(e){} renderContas(); toast(`🔗 <b>${esc(name)}</b> vinculado!`); beep(880,.1); }
    else toast("❌ "+esc(r.err||"falha"));
  };
  $$("#linkList .unlk").forEach(b=>b.onclick=async()=>{
    const r=await Client.rpc("unlink",{token:S.token,gid:b.dataset.g}).catch(()=>null);
    if(r&&r.ok){ S.user.links=r.links; renderContas(); toast("Conta desvinculada."); }
  });
}
export function paintSessBox(){
  const el=$("#sessBox"); if(!el) return;
  const s=S.session;
  if(!s||s.exp<=Date.now()){
    el.innerHTML=`<p class="mut">Nenhuma sessão ativa. Abra um jogo (▶ Jogar) para gerar uma válida por 60 min. ⏱️</p>`;
    return;
  }
  const g=S.games.find(x=>x.id===s.gid);
  const left=Math.max(0,s.exp-Date.now()), m=Math.floor(left/60000), sec=Math.floor(left%60000/1000);
  el.innerHTML=`<div class="saveRow"><b>🎮 ${esc(g?g.name:s.gid)}</b>
    <span class="small mut">vale por <b id="sessCount">${m}:${String(sec).padStart(2,"0")}</b></span>
    <button class="btn ghost small" id="sessRen">Renovar</button></div>
    <p class="small mut">Enquanto joga, o jogo recebe sua identidade (NEXUS ID + nick vinculado) automaticamente.</p>`;
  $("#sessRen").onclick=async()=>{
    const r=await Client.rpc("session",{token:S.token,gid:s.gid}).catch(()=>null);
    if(r&&r.ok){ S.session={token:r.token,exp:r.exp,gid:s.gid}; sendIdentity(); paintSessBox(); toast("🎫 Sessão renovada! +60 min"); }
  };
}

/* ---------- chat ---------- */
export function renderChat(){
  const rooms=[["global","🌍 Global"],...S.games.slice(0,12).map(g=>["game:"+g.id,"🎮 "+g.name])];
  $("#view").innerHTML=`<div id="chatLayout"><div id="chatBox">
    <div class="toolbar" style="padding:10px 12px 0"><select id="roomSel" style="max-width:260px">
    ${rooms.map(([v,t])=>`<option value="${esc(v)}" ${S.chatRoom===v?"selected":""}>${esc(t)}</option>`).join("")}</select>
    <span class="small mut">+1 XP por mensagem</span></div>
    <div id="chatMsgs"></div>
    <form id="chatForm"><input id="chatIn" type="text" placeholder="Escreva… (Enter envia)" maxlength="280" autocomplete="off"><button class="btn">➤</button></form>
  </div><div id="onlinePanel"><b>🟢 Online (<span id="onN">0</span>)</b><div id="onList"></div>
  <hr style="border-color:var(--line)"><b>✉️ Convidar</b><p class="small mut">Vá em Biblioteca → Detalhes → Convidar amigo.</p></div></div>`;
  $("#roomSel").onchange=e=>{S.chatRoom=e.target.value; loadChat(); Client.join(S.chatRoom);};
  $("#chatForm").onsubmit=async e=>{
    e.preventDefault(); const t=$("#chatIn").value.trim(); if(!t) return; $("#chatIn").value="";
    pushMsg({u:S.user?.u||"voce",d:S.user?.d||"Você",a:S.user?.a||"🎮",t,ts:Date.now(),mine:true});
    if(S.token){ const r=await Client.rpc("chatSend",{token:S.token,room:S.chatRoom,text:t}).catch(()=>null); if(r&&r.ok&&S.user){S.user.xp=r.xp; paintProfile();} }
  };
  Client.join(S.chatRoom); loadChat(); loadOnline();
}
async function loadChat(){
  const box=$("#chatMsgs"); if(!box) return; box.innerHTML=`<span class="loading"></span> carregando…`;
  let msgs=[];
  if(S.token){ try{ const r=await Client.rpc("chatGet",{room:S.chatRoom,limit:60}); if(r&&r.ok) msgs=r.msgs; }catch(e){} }
  msgs=[...(S.chatCache[S.chatRoom]||[]),...msgs].slice(-60);
  box.innerHTML=msgs.map(m=>`<div class="msg"><b>${esc(m.a||"")} ${esc(m.d||m.u)}</b><span class="t">${new Date(m.ts).toLocaleTimeString()}</span><br>${esc(m.t)}</div>`).join("")||`<p class="mut">Seja o primeiro a falar aqui! 👋</p>`;
  box.scrollTop=box.scrollHeight;
}
function pushMsg(m){
  const room=m.room||S.chatRoom;
  const arr=(S.chatCache[room]=S.chatCache[room]||[]);
  const last=arr[arr.length-1];
  if(last && last.u===m.u && last.t===m.t && Math.abs((m.ts||0)-(last.ts||0))<8000) return; // eco da própria msg
  arr.push(m);
  const box=$("#chatMsgs"); if(!box) return;
  const d=document.createElement("div"); d.className="msg";
  d.innerHTML=`<b>${esc(m.a||"")} ${esc(m.d||m.u)}</b><span class="t">${new Date(m.ts).toLocaleTimeString()}</span><br>${esc(m.t)}`;
  box.appendChild(d); box.scrollTop=box.scrollHeight;
}
async function loadOnline(){
  try{ const r=await Client.rpc("online",{}); if(r&&r.ok){S.online=r.users; $("#onN")&&($("#onN").textContent=r.users.length); $("#onlinePill")&&($("#onlinePill").textContent=`● ${r.users.length}`);
    const l=$("#onList"); if(l) l.innerHTML=r.users.slice(0,40).map(u=>`<div class="userRow"><span class="dot"></span><span style="flex:1">${esc(u.a||"🎮")} <b>${esc(u.d||u.u)}</b><br><span class="small mut">${esc(u.playing?"▶ "+(S.games.find(g=>g.id===u.playing)?.name||u.playing):"online")}</span></span>${S.user&&u.u!==(S.user.u||"").toLowerCase()?`<button class="btn ghost small invU" data-u="${esc(u.u)}" data-d="${esc(u.d||u.u)}">✉️</button>`:""}</div>`).join("");
    $$("#onList .invU").forEach(b=>b.onclick=()=>quickInvite(b.dataset.u, b.dataset.d));}}catch(e){}
}
function onServerMsg(m){
  if(m.k==="chat"){ pushMsg(m); }
  if(m.k==="invite" && S.user && m.to===S.user.u.toLowerCase()){
    beep(740,.12); setTimeout(()=>beep(988,.15),140);
    toast(`✉️ Convite de <b>${esc(m.fromD)}</b> para <b>${esc(m.gameName)}</b>! <button class="btn small" onclick="document.querySelector('#nav button[data-v=amigos]').click()">Ver</button>`);
    pollInvites();
  }
}

function quickInvite(toU, toD){
  const g=S.current||S.games.find(x=>x.id==="stick-arena")||S.games[0];
  if(!g) return toast("Sem jogos para convidar.");
  const d=document.createElement("dialog"); d.innerHTML=`<h3>✉️ Convidar ${esc(toD)}</h3>
  <p class="small">Jogo: <b>${esc(g.name)}</b></p>
  <input id="iMsg" type="text" value="Bora jogar ${esc(g.name)} comigo?" maxlength="120">
  <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ok">Enviar</button><button class="btn ghost" id="cx">Fechar</button></div>`;
  document.body.appendChild(d); d.showModal();
  d.querySelector("#cx").onclick=()=>{d.close();d.remove();};
  d.querySelector("#ok").onclick=async()=>{
    const r=await Client.rpc("inviteSend",{token:S.token,to:toU,gid:g.id,msg:d.querySelector("#iMsg").value}).catch(e=>({ok:false,err:String(e)}));
    if(r&&r.ok){toast(`✉️ Convite enviado para <b>${esc(toD)}</b>!`); beep(990,.1); d.close(); d.remove();}
    else toast("❌ "+esc(r.err||"falha"));
  };
}
function inviteDialog(g){
  const d=document.createElement("dialog"); d.innerHTML=`<h3>✉️ Convidar para ${esc(g.name)}</h3>
  <label class="small mut">Usuário do amigo, @nome ou NEXUS ID (ex: NX-AB12CD)</label><input id="iTo" type="text" placeholder="nome de usuário ou NX-…">
  <div style="height:8px"></div><label class="small mut">Mensagem</label><input id="iMsg" type="text" value="Bora jogar ${esc(g.name)} comigo?" maxlength="120">
  <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ok">Enviar convite</button><button class="btn ghost" id="cx">Fechar</button></div>`;
  document.body.appendChild(d); d.showModal();
  d.querySelector("#cx").onclick=()=>{d.close();d.remove();};
  d.querySelector("#ok").onclick=async()=>{
    const to=d.querySelector("#iTo").value.trim(); if(!to) return;
    const r=await Client.rpc("inviteSend",{token:S.token,to,gid:g.id,msg:d.querySelector("#iMsg").value}).catch(e=>({ok:false,err:String(e)}));
    if(r&&r.ok){toast(`✉️ Convite enviado para <b>${esc(to)}</b>!`); d.close(); d.remove();}
    else toast("❌ "+esc(r.err||"sem servidor — convide pelo link da página"));
  };
}
export async function renderAmigos(){
  $("#view").innerHTML=`<div class="card" style="max-width:680px"><h2 style="margin-top:0">✉️ Convites de jogo</h2>
  <div id="invList"><span class="loading"></span> carregando…</div>
  <hr style="border-color:var(--line)"><h3>🔗 Chamar sem conta?</h3>
  <p class="small mut">Compartilhe o link da launcher + nome do jogo. Quando o amigo entrar, combinem pelo chat global. Convites com notificação exigem login no servidor.</p></div>`;
  await pollInvites(true);
}
async function pollInvites(force=false){
  if(!S.token) return;
  try{
    const r=await Client.rpc("inviteList",{token:S.token}); if(!r||!r.ok) return;
    S.invites=r.invites||[];
    const pend=S.invites.filter(i=>i.st===0).length;
    const b=$("#invBadge"); if(b) b.textContent=pend?`(${pend})`:"";
    if(S.view==="amigos"||force){
      const el=$("#invList"); if(!el) return;
      const pendL=S.invites.filter(i=>i.st===0), old=S.invites.filter(i=>i.st!==0).slice(0,10);
      el.innerHTML=(pendL.length?pendL.map(i=>`<div class="invite"><b>✉️ ${esc(i.fromD||i.from)}</b> convidou você para <b>${esc(i.gameName||i.gid)}</b><br>
        <span class="small">“${esc(i.msg||"")}” · ${new Date(i.ts).toLocaleString()}</span><br>
        <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" data-a="1" data-id="${i.id}">Aceitar ▶</button>
        <button class="btn ghost small" data-a="0" data-id="${i.id}">Recusar</button></div></div>`).join(""):`<p class="mut">Nenhum convite pendente. 🎈</p>`)
        +(old.length?`<h4>Anteriores</h4>`+old.map(i=>`<div class="small mut">${i.st===1?"✅":"❌"} ${esc(i.from)} → ${esc(i.gameName||i.gid)} (${new Date(i.ts).toLocaleString()})</div>`).join(""):"");
      el.onclick=async e=>{
        const btn=e.target.closest("button"); if(!btn) return;
        const id=+btn.dataset.id, accept=btn.dataset.a==="1";
        const rr=await Client.rpc("inviteRespond",{token:S.token,id,accept}).catch(()=>null);
        if(accept){
          const inv=S.invites.find(x=>x.id===id);
          const g=S.games.find(x=>x.id===(inv&&inv.gid));
          await pollInvites(true);
          if(g) openGame(g); else toast("Jogo do convite não está na sua biblioteca — peça a URL ao amigo!");
        } else await pollInvites(true);
      };
    }
  }catch(e){}
}

/* ---------- saves geral ---------- */
export async function renderSaves(){
  $("#view").innerHTML=`<div class="card" style="max-width:720px"><h2 style="margin-top:0">💾 Meus salvamentos</h2><div id="allS"><span class="loading"></span></div></div>`;
  let data={};
  if(S.token){ try{ const r=await Client.rpc("mySaves",{token:S.token}); if(r&&r.ok) data=r.saves; }catch(e){} }
  // mescla local
  S.games.forEach(g=>{ try{ const l=JSON.parse(localStorage["nexus_save_"+g.id]||"null"); if(l&&Object.keys(l).length&&!data[g.id]) data[g.id]=l; }catch(e){} });
  const ids=Object.keys(data);
  $("#allS").innerHTML=ids.length?ids.map(gid=>{
    const g=S.games.find(x=>x.id===gid)||{name:gid};
    return `<h4>🎮 ${esc(g.name)}</h4>`+Object.entries(data[gid]).map(([slot,v])=>`<div class="saveRow"><b>Slot ${slot}</b><span class="small mut" style="flex:1">${esc(String(v.data).slice(0,100))}…</span><span class="small mut">${new Date(v.ts).toLocaleString()}</span></div>`).join("");
  }).join(""):`<p class="mut">Nenhum save ainda. Jogue algo e salve! 💾</p>`;
}

export function renderAjuda(){
  $("#view").innerHTML=`<div class="card" style="max-width:720px"><h2>❓ Como funciona a NEXUS</h2>
  <ol><li><b>Conta:</b> crie sua conta (ou entre). Ela guarda XP, saves e jogos no servidor — acesse de qualquer PC/celular sem perder progresso. Sem login, fica modo local.</li>
  <li><b>GitHub:</b> publique seu jogo com <b>GitHub Pages</b> e adicione a URL em “Adicionar jogo”. A aba GitHub lista seus repos automaticamente.</li>
  <li><b>Saves:</b> cada jogo tem 3 slots na nuvem ☁️ + cópia local. Jogos integrados salvam sozinhos; externos usam o botão 💾.</li>
  <li><b>XP:</b> jogar, salvar e adicionar jogos dá XP e níveis. Aparece no perfil.</li>
  <li><b>Chat:</b> global + sala por jogo, em tempo real.</li>
  <li><b>Convites:</b> chame um usuário pelo nome → ele recebe na hora e entra no mesmo jogo.</li></ol>
  <h3>🔌 Integrar MEU jogo (GitHub) com saves/XP automáticos</h3>
  <p class="small">No seu jogo, use <code>postMessage</code> para a launcher:</p>
  <pre class="small" style="background:#000;padding:10px;border-radius:8px;overflow:auto">// salvar (slot 1..3)
parent.postMessage({nexus:"save", slot:1, data: JSON.stringify({fase:3, moedas:99})}, "*");
// dar XP
parent.postMessage({nexus:"xp", amount:5, reason:"passou de fase"}, "*");
// receber load: window.addEventListener("message", e=>{ if(e.data?.nexus==="load") carregar(e.data.data); });
// identidade NEXUS (ID + nick vinculado + sessão de 60min):
parent.postMessage({nexus:"getIdentity"}, "*");
window.addEventListener("message", e=>{
  const m=e.data; if(!m||m.nexus!=="identity"||!m.ok) return;
  // m.id (ex "NX-AB12CD"), m.display, m.avatar,
  // m.link = {name:"nick no jogo", tag} ou null,
  // m.exp = quando a sessão expira (ms), m.session = token
  entrarComo(m.display, m.link && m.link.name);
});
</pre>
  <h3>📤 Publicar esta launcher no GitHub</h3>
  <p class="small mut">Salve o generator, baixe os arquivos (index.html + src/) e suba num repo GitHub com Pages ativado. O multiplayer (chat/saves/XP em nuvem) só funciona aqui no Perchance (servidor); no GitHub Pages ela roda em <b>modo local</b> automático (conta de convidado + localStorage). Para nuvem própria no GitHub, conecte um backend (ex: Firebase/Supabase) — peça que eu gero o código.</p></div>`;
}

async function tickPresence(){
  if(S.token && S.user){ try{ await Client.rpc("heartbeat",{token:S.token, addSec:0, gid:S.current?.id||""}); await loadOnline(); }catch(e){} }
}
