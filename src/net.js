/* socket + RPC com fallback local */
let sock=null, token="", onMsg=null, wantJoin=[];
export function setToken(t){ token=t; }
export function isOpen(){ return sock && sock.readyState===1; }
export function rawRpc(method, obj){
  if(!isOpen()) throw new Error("offline");
  return sock.rpc[method](JSON.stringify(obj)).then(r=>{
    const s = typeof r === "string" ? r : new TextDecoder().decode(r);
    return JSON.parse(s);
  });
}

export async function ensureSocket(cb){
  onMsg=cb;
  try{
    sock = root.createServerSocket();
    sock.binaryType="arraybuffer";
    sock.addEventListener("message", ev=>{
      try{
        const s = typeof ev.data==="string"?ev.data:new TextDecoder().decode(ev.data);
        const m=JSON.parse(s); if(m&&m.k) onMsg&&onMsg(m);
      }catch(e){}
    });
    await sock.opened;
    // entra nas salas pendentes
    for(const r of wantJoin){ try{ await sock.rpc.join(JSON.stringify({room:r})); }catch(e){} }
    const st=document.getElementById("srvStat"); if(st) st.innerHTML=`● servidor <b style="color:var(--ok)">online</b>`;
  }catch(e){ sock=null; }
  return sock;
}
export function join(room){
  if(!room) return;
  if(!wantJoin.includes(room)) wantJoin.push(room);
  if(isOpen()){ sock.rpc.join(JSON.stringify({room})).catch(()=>{}); }
}
export async function rpc(method, obj){
  if(!isOpen()) throw new Error("offline");
  const payload = JSON.stringify({token, ...(obj||{})});
  const raw = await sock.rpc[method](payload);
  const s = typeof raw==="string"?raw:new TextDecoder().decode(raw);
  return JSON.parse(s);
}
