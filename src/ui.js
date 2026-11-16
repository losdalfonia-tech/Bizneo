// HTML del panel. Todo inline: el Worker sirve estas páginas tal cual.

const CSS = `
:root{--bg:#eef2f7;--card:#fff;--line:#e6eaf1;--text:#111827;--muted:#6b7280;--soft:#9aa3b2;
--accent:#6366f1;--accent2:#4f46e5;--ok:#10b981;--okbg:#ecfdf5;--warn:#f59e0b;--warnbg:#fffbeb;--err:#ef4444;--errbg:#fef2f2;
--hero1:#141633;--hero2:#2a2466;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d14;--card:#141824;--line:#232a3a;--text:#e5e7eb;--muted:#9ca3af;--soft:#6b7280;--okbg:#0d2a22;--warnbg:#2a2210;--errbg:#2a1214}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent2)}button{font:inherit;cursor:pointer}
.top{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.top-in{max-width:1440px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px}
.who b{display:block;font-size:17px;font-weight:600}.who span{color:var(--soft);font-size:14px}
.sp{flex:1}
.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:7px 14px;background:var(--card);color:var(--muted);font-size:14px;white-space:nowrap;text-decoration:none}
.chip b{color:var(--text);font-weight:600}
.chip.ok{background:var(--okbg);border-color:#a7f3d0;color:#047857}.chip.ok b{color:#047857}
.chip.warn{background:var(--warnbg);border-color:#fde68a;color:#b45309}.chip.warn b{color:#b45309}
.chip.err{background:var(--errbg);border-color:#fecaca;color:#b91c1c}.chip.err b{color:#b91c1c}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
.link{color:var(--soft);text-decoration:none;font-size:14px;padding:6px 4px}.link:hover{color:var(--text)}
main{max-width:1440px;margin:0 auto;padding:28px 24px 60px;display:grid;gap:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 26px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.card-h h2{margin:0;font-size:18px;font-weight:600}.card-h small{color:var(--soft);font-size:14px}
.card-b{padding:22px 26px}
.hero{background:radial-gradient(120% 140% at 50% 0%,var(--hero2) 0%,var(--hero1) 70%);color:#fff;border-radius:22px;padding:28px 34px 32px;box-shadow:0 18px 40px -18px rgba(30,27,75,.55)}
.hero-top{display:flex;justify-content:space-between;align-items:center}
.state{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px}
.state .dot{width:9px;height:9px;color:#34d399}.state.pausa .dot{color:#fbbf24}.state.pendiente .dot,.state.libre .dot,.state.terminada .dot{color:#94a3b8}
.badge{background:rgba(255,255,255,.1);border:0;color:#e5e7ff;border-radius:999px;padding:6px 14px;font-weight:600;font-size:15px}
.badge:hover{background:rgba(255,255,255,.18)}
.timer{font-family:var(--mono);font-weight:700;font-size:clamp(56px,9vw,92px);letter-spacing:.02em;text-align:center;margin:22px 0 8px;font-variant-numeric:tabular-nums}
.sub{text-align:center;color:#a5a8d6;font-size:17px}
.bar{height:4px;background:rgba(255,255,255,.12);border-radius:4px;margin:38px 0 34px;overflow:hidden}
.bar i{display:block;height:100%;background:#818cf8;border-radius:4px;transition:width .6s}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.steps.n2{grid-template-columns:repeat(2,1fr)}main>*,.grid2>*,.week li>*{min-width:0}
.step{position:relative;padding-left:6px}
.step:not(:last-child):after{content:"";position:absolute;top:10px;left:80px;right:10px;height:1px;background:rgba(255,255,255,.12)}
.step label{display:block;font-size:13px;letter-spacing:.03em;color:#8b8fbf;text-transform:uppercase}
.step span{font-family:var(--mono);font-size:17px;display:block;margin-top:6px;color:#9ca0cf;font-style:italic}
.step.done label{color:#c7c9ee}.step.done span{color:#fff;font-weight:700;font-style:normal}
.step.next span{color:#c7d2fe}
.sync{width:100%;margin-top:30px;background:transparent;border:1px solid rgba(255,255,255,.14);color:#c7c9ee;border-radius:12px;padding:13px;font-size:17px}
.sync:hover{background:rgba(255,255,255,.05)}
.row{display:flex;gap:18px;align-items:flex-start}
.check{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--okbg);color:#059669;font-size:20px;flex:none}
.check.wait{background:#eef2ff;color:var(--accent2)}.check.err{background:var(--errbg);color:var(--err)}.check.off{background:var(--bg);color:var(--soft)}
.msg b{font-size:17px;font-weight:600;display:block}.msg p{margin:4px 0 0;color:var(--muted)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;align-items:center}
.btn{text-decoration:none;display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:9px 16px;font-weight:500}
.btn:hover{border-color:#c7cbe0}.btn.primary{background:var(--accent2);border-color:var(--accent2);color:#fff}.btn.primary:hover{background:#4338ca}
.btn.danger{color:var(--err)}.btn:disabled{opacity:.5;cursor:default}
.sep{border-top:1px solid var(--line);margin:22px 0 18px}
.err-banner{background:var(--errbg);border:1px solid #fecaca;color:#991b1b;border-radius:12px;padding:12px 16px;margin-bottom:18px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
input[type=time],input[type=text],input[type=number],input[type=date],input[type=password],input[type=email],select,textarea{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
textarea{width:100%;font-family:var(--mono);font-size:13px;min-height:70px;resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.week{list-style:none;margin:0;padding:0}
.week li{display:grid;grid-template-columns:150px 1fr auto;gap:14px;align-items:center;padding:16px 26px;border-top:1px solid var(--line)}
.week li:first-child{border-top:0}.week li.today{background:#f5f7ff}
@media (prefers-color-scheme:dark){.week li.today{background:#181d33}}
.wd b{color:var(--accent2);font-weight:600;font-size:17px}.wd small{display:block;color:var(--soft);font-size:13px}
.tag{font-size:11px;font-weight:700;background:#eef2ff;color:var(--accent2);border-radius:6px;padding:2px 7px;margin-left:6px;vertical-align:2px}
.times{font-family:var(--mono);font-size:14px;color:var(--soft);display:flex;gap:10px;flex-wrap:wrap}.times b{color:var(--text)}
.st{font-size:14px;font-weight:500;color:var(--soft);text-align:right}.st.en-curso{color:var(--ok)}.st.pausa{color:var(--warn)}.st.terminada{color:var(--text)}
.cal-nav{display:flex;align-items:center;gap:14px}.cal-nav button{border:0;background:none;color:var(--muted);font-size:18px;padding:2px 8px}
.cal-help{color:var(--muted);font-size:14px;margin:0 0 14px}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.cal .h{font-size:12px;text-align:center;color:var(--soft);font-weight:600;padding-bottom:4px}
.cal .d{aspect-ratio:1.15;border-radius:10px;border:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:14px;color:var(--text);padding:0}
.cal .d .i{font-size:15px;line-height:1}.cal .d.past{opacity:.45;cursor:default}.cal .d.today{border-color:var(--accent);box-shadow:0 0 0 2px #c7d2fe}
.cal .d.libre{background:var(--bg);color:var(--soft)}.cal .d.ovr{border-style:solid;border-color:#a5b4fc}
.cal .d:not(.past):hover{border-color:var(--accent)}
.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-top:14px}
.log{list-style:none;margin:0;padding:0;max-height:340px;overflow:auto}
.log li{display:flex;gap:14px;padding:10px 26px;border-top:1px solid var(--line);font-size:14px}
.log li:first-child{border-top:0}.log time{font-family:var(--mono);color:var(--soft);white-space:nowrap}
.log .ok{color:#059669}.log .error{color:var(--err)}.log .warn{color:var(--warn)}.log .info{color:var(--accent2)}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:20;max-width:90vw}
.toast.show{opacity:1}
.form{display:grid;gap:16px}.form label{display:grid;gap:6px;font-size:14px;color:var(--muted)}.form label>span{font-weight:500;color:var(--text)}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.fields input,.fields select{width:100%;min-width:0}
.hint{font-size:13px;color:var(--soft)}
.act{border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:10px}
.act-h{display:flex;gap:10px;align-items:center}.act-h b{min-width:80px}.act-h input{flex:1}
.sched{border-collapse:collapse;width:100%;min-width:640px}.sched th{text-align:left;font-size:13px;color:var(--soft);font-weight:600;padding:6px}.sched td{padding:4px 6px;border-top:1px solid var(--line)}
.diag{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-family:var(--mono);font-size:13px;white-space:pre-wrap;margin:0}
code{font-family:var(--mono);font-size:13px;background:var(--bg);padding:1px 5px;border-radius:5px}
ol.howto{margin:0;padding-left:20px;color:var(--muted);display:grid;gap:6px}
.login{min-height:100vh;display:grid;place-items:center;padding:16px}
.login form{width:min(380px,100%);display:grid;gap:14px;padding:32px}
@media (max-width:900px){.grid2{grid-template-columns:1fr}.steps,.steps.n2{grid-template-columns:repeat(2,1fr);row-gap:20px}.step:after{display:none}
.week li{grid-template-columns:1fr auto;padding:14px 18px}.week .times{grid-column:1/-1;order:3}
.top-in,main{padding-left:16px;padding-right:16px}.hero{padding:22px 18px 24px}.card-h,.card-b{padding-left:18px;padding-right:18px}}
`;

const page = (title, body, script = "") => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⏰</text></svg>">
<style>${CSS}</style></head><body>${body}<div class="toast" id="toast"></div>
<script>${COMMON}${script}</script></body></html>`;

const COMMON = `
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),3200)}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 if(r.status===401){location.href="/";throw new Error("auth")}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||j.reason||("Error "+r.status));return j}
const fmtHM=min=>{const h=Math.floor(min/60),m=min%60;return h+"h"+(m?" "+String(m).padStart(2,"0")+"m":"")};
const toMin=s=>{const[a,b]=s.split(":").map(Number);return a*60+b};
const fromMin=m=>{m=((Math.round(m)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")};
function header(cfg){
 const p=cfg.profile||{},s=cfg.schedule,b=cfg.bizneo;
 const wd=(new Date().getDay()+6)%7+1,h=s.days[wd];
 let cls="err",txt="sin sesión";
 if(b.hasCookie){const d=b.cookieExpiresAt?Math.floor((Date.parse(b.cookieExpiresAt)-Date.now())/864e5):null;
  if(d===null){cls="ok";txt="activa"}else if(d<0){cls="err";txt="caducada"}else{cls=d<=(cfg.alerts?.daysBefore??5)?"warn":"ok";txt=d+" d"}}
 $("#avatar").textContent=(p.name||"?")[0].toUpperCase();
 $("#name").textContent=p.name||"Configura tu nombre";$("#email").textContent=p.email?"avisos a "+p.email:"email de avisos en Ajustes";
 $("#horario").innerHTML='🕘 Hoy <b>'+(h&&s.workdays.includes(wd)?h.entrada+'–'+h.salida+(h.pausa?' · comida '+h.pausa:''):'libre')+'</b>';
 $("#dry").style.display=b.dryRun?"":"none";
 const ses=$("#sesion");ses.className="chip "+cls;ses.innerHTML='<span class="dot"></span> Sesión Bizneo <b>'+txt+'</b>';
}
const HEADER_HTML='<header class="top"><div class="top-in"><div class="avatar" id="avatar">·</div><div class="who"><b id="name">…</b><span id="email"></span></div><div class="sp"></div>'+
 '<span class="chip warn" id="dry" style="display:none">🧪 <b>Modo prueba</b></span><a class="chip" id="horario" href="/me/ajustes#horario">…</a><a class="chip" id="sesion" href="/me/ajustes#bizneo">…</a>'+
 '<a class="link" id="navlink" href="/me/ajustes">Ajustes</a><a class="link" href="/logout">Cerrar sesión</a></div></header>';
document.body.insertAdjacentHTML("afterbegin",HEADER_HTML);
`;

export const loginPage = (error = "") => page("Fichaje Bizneo", `
<div class="login"><form class="card" method="post" action="/login">
  <div style="display:flex;gap:12px;align-items:center"><div class="avatar">⏰</div><div><b style="font-size:18px">Fichaje automático</b><div class="hint">Panel personal de Bizneo HR</div></div></div>
  ${error ? `<div class="err-banner">${error}</div>` : ""}
  <label class="form"><span>Contraseña del panel</span><input type="password" name="password" autofocus required></label>
  <button class="btn primary">Entrar</button>
</form></div>`, `document.querySelector(".top").remove()`);

export const dashboardPage = () => page("Fichaje Bizneo", `
<main>
  <section class="hero">
    <div class="hero-top"><div class="state" id="state"><span class="dot"></span><span id="stateTxt">Cargando…</span></div>
      <button class="badge" id="modeBadge" title="Cambiar el modo de hoy">…</button></div>
    <div class="timer" id="timer">00:00:00</div>
    <div class="sub" id="sub">&nbsp;</div>
    <div class="bar"><i id="bar" style="width:0"></i></div>
    <div class="steps" id="steps"></div>
    <button class="sync" id="syncBtn">↻ Sincronizar estado con Bizneo</button>
  </section>

  <section class="card"><div class="card-h"><h2>Fichaje de hoy</h2><small id="todayInfo"></small></div>
    <div class="card-b" id="today"></div></section>

  <div class="grid2">
    <section class="card"><div class="card-h"><h2>Esta semana</h2><small id="weekTotal"></small></div><ul class="week" id="week"></ul></section>
    <section class="card"><div class="card-h"><h2>Calendario</h2>
      <div class="cal-nav"><button id="prev" aria-label="Mes anterior">‹</button><b id="monthName"></b><button id="next" aria-label="Mes siguiente">›</button></div></div>
      <div class="card-b"><p class="cal-help">Toca un <b>día futuro</b> para alternar: 🏢 oficina → 🏠 casa → 🌴 libre. Los festivos y vacaciones de Bizneo se saltan solos; 🌴 es para días libres que no estén en Bizneo.</p>
      <div class="cal" id="cal"></div>
      <div class="legend"><span>🏢 oficina (presencial)</span><span>🏠 casa (teletrabajo)</span><span>🌴 libre: no se ficha</span><span>borde azul = elegido a mano</span></div></div>
    </section>
  </div>

  <section class="card"><div class="card-h"><h2>Actividad</h2><small>últimos fichajes y avisos</small></div><ul class="log" id="log"></ul></section>
</main>`, `
const ICON={oficina:"🏢",casa:"🏠",libre:"🌴",auto:""};
const LABEL={entrada:"Iniciar",pausa:"Pausar",retorno:"Reanudar",salida:"Finalizar"};
const DOW=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const MONTHS=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
let S=null,month=null,loadedAt=0;

async function load(){try{S=await api("/api/state"+(month?"?month="+month:""));loadedAt=Date.now();month=S.month;render()}catch(e){if(e.message!=="auth")toast(e.message)}}
async function act(path,body,okMsg){try{await api(path,body);if(okMsg)toast(okMsg)}catch(e){toast("⚠ "+e.message)}await load()}
async function actMsg(path,body){try{const r=await api(path,body);toast(r.msg||"Hecho")}catch(e){toast("⚠ "+e.message)}await load()}

function render(){
 const t=S.today,s=S.config.schedule;header(S.config);
 const stTxt={"en curso":"En curso",pausa:"En pausa",terminada:"Jornada terminada",pendiente:"Pendiente de iniciar",libre:"Día libre"}[t.status];
 $("#state").className="state "+t.status.replace(" ","-");$("#stateTxt").textContent=stTxt;
 $("#modeBadge").textContent={oficina:"🏢 Oficina",casa:"🏠 Teletrabajo",libre:"🌴 Día libre"}[t.mode]+(t.override!=="auto"?" ·":"");
 $("#modeBadge").disabled=!!t.actual.entrada;
 const p=t.plan||{};
 $("#todayInfo").textContent=p.entrada?"Plan: "+p.entrada+(p.pausa?" · comida "+p.pausa+"–"+p.retorno:"")+" · fin "+p.salida:"";
 const steps=["entrada","pausa","retorno","salida"].filter(k=>p[k]);
 $("#steps").className="steps n"+steps.length;
 $("#steps").innerHTML=steps.map(k=>{const a=t.actual[k],p=t.plan&&t.plan[k];
  const sk=t.skipped[k];
  return '<div class="step '+(a?"done":t.next===k?"next":"")+'"'+(sk?' title="'+esc(sk)+'"':'')+'><label>'+LABEL[k]+'</label><span>'+(a?a:t.simulated[k]?"🧪 "+t.simulated[k]:sk?"omitido":p?"≈ "+p:"—")+'</span></div>'}).join("");
 renderToday();renderWeek();renderCal();renderLog();tickTimer();
}

function tickTimer(){if(!S)return;const t=S.today,a=t.actualIso||{};
 let ms=t.workedMs;const running=a.entrada&&!a.salida&&!(a.pausa&&!a.retorno);
 if(running)ms+=Date.now()-loadedAt;
 const sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),x=sec%60;
 $("#timer").textContent=[h,m,x].map(n=>String(n).padStart(2,"0")).join(":");
 const goal=(t.goalMin||1)*60000,pct=Math.min(100,Math.floor(ms/goal*100));
 $("#sub").textContent=t.goalMin?pct+"% · objetivo "+fmtHM(t.goalMin)+(t.bizneoMin!=null?" · total del día según Bizneo":""):"";$("#bar").style.width=(t.goalMin?pct:0)+"%";
}
setInterval(tickTimer,1000);

function renderToday(){
 const t=S.today,el=$("#today"),err=t.lastError;let h="";
 if(err)h+='<div class="err-banner"><span>⚠ No se pudo fichar la <b>'+esc(err.step)+'</b>: '+esc(err.msg)+(err.kind==="session"?' — <a href="/me/ajustes#bizneo">renueva la sesión</a>':"")+'</span><button class="btn" data-act="retry" data-step="'+esc(err.step)+'">Reintentar</button></div>';
 const row=(icon,cls,title,text)=>'<div class="row"><div class="check '+cls+'">'+icon+'</div><div class="msg"><b>'+title+'</b><p>'+text+'</p></div></div>';
 const now=new Date();const hm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
 const markForm=step=>'<span class="hint">¿Ya fichaste en Bizneo?</span><input type="time" id="markTime" value="'+hm+'"><button class="btn" data-act="mark" data-step="'+step+'">Registrar '+LABEL[step].toLowerCase()+'</button>';
 if(S.config.bizneo.dryRun)h+='<div class="err-banner" style="background:var(--warnbg);border-color:#fde68a;color:#92400e"><span>🧪 <b>Modo prueba</b>: se comprueba todo pero no se envía nada a Bizneo. Desactívalo en <a href="/me/ajustes#bizneo">Ajustes</a> cuando el registro cuadre.</span></div>';
 if(t.status==="libre"){h+=row("🌴","off","Hoy no se ficha",t.offReason?"Bizneo marca hoy como "+esc(t.offReason)+".":"Día libre. Si al final trabajas, cambia el modo con el botón de arriba.")}
 else if(t.status==="pendiente"&&t.skipped.entrada){h+=row("!","err","No se ha iniciado la jornada",esc(t.skipped.entrada))+
   '<div class="actions"><button class="btn primary" data-act="punch" data-step="entrada">Iniciar ahora</button>'+markForm("entrada")+'</div>'}
 else if(t.status==="pendiente"){h+=row("⏳","wait","Se iniciará sola a las ≈ "+t.plan.entrada,(t.plan.pausa?"Pausa ≈ "+t.plan.pausa+", reanudar ≈ "+t.plan.retorno+" y finalizar ≈ ":"Finalizar ≈ ")+t.plan.salida+". Antes de cada paso se comprueba en Bizneo que no esté ya hecho.")+
   '<div class="actions"><button class="btn primary" data-act="punch" data-step="entrada">Iniciar ya</button><button class="btn" data-act="replan">Otro desfase al azar</button>'+markForm("entrada")+'</div>'}
 else if(t.status==="pausa"){h+=row("☕","wait","En pausa desde las "+t.actual.pausa,"Se reanudará sola a las ≈ "+t.plan.retorno+".")+
   '<div class="actions"><button class="btn primary" data-act="punch" data-step="retorno">Reanudar ahora</button></div>'}
 else if(t.status==="en curso"){h+=row("✓","","Iniciada a las "+t.actual.entrada,"No tienes que hacer nada más: "+(t.next==="pausa"?"la pausa de comida (≈ "+t.plan.pausa+") y el final (≈ "+t.plan.salida+") se fichan solos.":"se finalizará sola a las ≈ "+t.plan.salida+"."))+
   '<div class="sep"></div><a href="#" data-act="finish">¿Te vas antes? Finalizar ahora</a>'+(t.next==="pausa"?' &nbsp;·&nbsp; <a href="#" data-act="punch" data-step="pausa">Pausar para comer ya</a>':"")}
 else if(t.status==="terminada"){h+=row("✓","","Jornada finalizada a las "+(t.actual.salida||"—"),"Has trabajado "+fmtHM(Math.round(t.workedMs/60000))+". ¡Hasta mañana!")+
   '<div class="sep"></div><a href="#" data-act="unmark" data-step="salida">Deshacer la salida en el panel</a>'}
 el.innerHTML=h;
}

function renderWeek(){let tot=0;
 $("#week").innerHTML=S.week.map((d,i)=>{const today=d.date===S.today.date;tot+=d.workedMs||0;
  const dd=new Date(d.date+"T12:00:00Z"),label=dd.getUTCDate()+" "+MONTHS[dd.getUTCMonth()].slice(0,3).toLowerCase();
  const a=d.actual||{},p=d.plan||{};const cell=k=>a[k]?"<b>"+a[k]+"</b>":(d.skipped&&d.skipped[k])?"omitido":(d.date>=S.today.date&&p[k]&&d.mode!=="libre"?"≈"+p[k]:"--:--");
  const st=d.status==="sin datos"?"—":d.status;
  return '<li class="'+(today?"today":"")+'"><div class="wd"><b>'+DOW[i]+'</b> '+(ICON[d.mode]||"")+(today?'<span class="tag">HOY</span>':"")+'<small>'+label+'</small></div>'+
   '<div class="times">'+(d.mode==="libre"?(d.offReason||"día libre"):["entrada","pausa","retorno","salida"].filter(k=>p[k]||a[k]).map(cell).join(" · "))+'</div><div class="st '+st.replace(" ","-")+'">'+esc(st)+'</div></li>'}).join("");
 $("#weekTotal").textContent=tot?fmtHM(Math.round(tot/60000))+" trabajadas":"";
}

function renderCal(){const [y,m]=S.month.split("-").map(Number);$("#monthName").textContent=MONTHS[m-1]+" "+y;
 let h=["L","M","X","J","V","S","D"].map(x=>'<div class="h">'+x+'</div>').join("");
 h+='<div></div>'.repeat(S.calendar[0].weekday-1);
 for(const d of S.calendar){const past=d.date<S.today.date,isToday=d.date===S.today.date;
  h+='<button class="d '+d.mode+(past?" past":"")+(isToday?" today":"")+(d.override!=="auto"?" ovr":"")+'" data-date="'+d.date+'" '+(past?"disabled":"")+' title="'+d.mode+(d.override==="auto"?" (automático)":"")+'">'+
   '<span>'+Number(d.date.slice(8))+'</span><span class="i">'+(ICON[d.mode]||"")+'</span></button>'}
 $("#cal").innerHTML=h;
}

function renderLog(){$("#log").innerHTML=S.log.length?S.log.map(l=>{const d=new Date(l.at);
 return '<li><time>'+d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit"})+" "+d.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})+'</time><span class="'+l.type+'">'+({ok:"✓",error:"✗",warn:"!",info:"•"}[l.type]||"•")+'</span><span>'+esc(l.msg)+(l.source==="auto"?' <span class="hint">(automático)</span>':"")+'</span></li>'}).join(""):'<li class="hint">Sin actividad todavía.</li>'}

document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(b){e.preventDefault();const a=b.dataset.act,step=b.dataset.step;b.disabled=true;
 if(a==="punch"||a==="retry")actMsg("/api/punch",{step});
 else if(a==="finish"){if(confirm("¿Finalizar ahora la jornada en Bizneo?"))actMsg("/api/finish",{});else b.disabled=false}
 else if(a==="mark")act("/api/mark",{step,time:$("#markTime").value},"Registrado");
 else if(a==="unmark")act("/api/unmark",{step},"Deshecho en el panel (Bizneo no se modifica)");
 else if(a==="replan")act("/api/replan",{},"Nueva hora de entrada");return}
 const d=e.target.closest(".cal .d");if(d&&!d.disabled)act("/api/calendar",{date:d.dataset.date});
});
$("#modeBadge").onclick=()=>act("/api/today-mode",{});
$("#syncBtn").onclick=async e=>{e.target.disabled=true;await actMsg("/api/sync",{});e.target.disabled=false};
$("#prev").onclick=()=>{const[y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-2,1));month=d.toISOString().slice(0,7);load()};
$("#next").onclick=()=>{const[y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m,1));month=d.toISOString().slice(0,7);load()};
load();setInterval(load,60000);
`);

export const settingsPage = () => page("Ajustes · Fichaje Bizneo", `
<main style="max-width:980px">
  <section class="card" id="perfil"><div class="card-h"><h2>Perfil y avisos</h2><small id="mailInfo"></small></div><div class="card-b form">
    <div class="fields"><label><span>Nombre</span><input type="text" id="p_name"></label>
      <label><span>Email para avisos</span><input type="email" id="p_email"></label>
      <label><span>Avisar cuando falten (días)</span><input type="number" id="a_days" min="0" max="30"><small class="hint">para que caduque la cookie</small></label></div>
    <p class="hint">Se avisa por correo si falla un fichaje, si un paso no se hace (por ejemplo, el cronómetro no estaba como se esperaba), si la sesión caduca y antes de que caduque la cookie.</p>
    <div class="actions"><button class="btn" id="mailBtn">Enviar correo de prueba</button></div>
  </div></section>

  <section class="card" id="horario"><div class="card-h"><h2>Horario</h2><small>zona horaria Europe/Madrid</small></div><div class="card-b form">
    <div style="overflow-x:auto"><table class="sched"><thead><tr><th>Día</th><th>Modo</th><th>Iniciar</th><th>Pausar</th><th>Reanudar</th><th>Finalizar</th><th>Objetivo</th></tr></thead><tbody id="days"></tbody></table></div>
    <p class="hint">Deja <b>Pausar</b> y <b>Reanudar</b> vacíos para jornada continua. 🏢 oficina = presencial · 🏠 casa = teletrabajo (es la opción del cronómetro de Bizneo) · 🌴 libre = no se ficha.</p>
    <div class="fields"><label><span>Desfase aleatorio (0 a N min)</span><input type="number" id="s_jitter" min="0" max="30">
      <small class="hint">el mismo para iniciar y finalizar (la jornada dura lo mismo); la comida tiene el suyo</small></label></div>
  </div></section>

  <section class="card" id="bizneo"><div class="card-h"><h2>Sesión de Bizneo</h2><small id="sesInfo"></small></div><div class="card-b form">
    <label><span>URL de tu Bizneo</span><input type="text" id="b_base" placeholder="https://tuempresa.bizneohr.com"></label>
    <label><span>Cookies de sesión</span><textarea id="b_cookie" placeholder="_hcmex_key=SFMyNTY…; device_id=…   (déjalo vacío para conservar la actual)"></textarea>
      <small class="hint">Sólo se guarda si Bizneo la acepta. Se guarda en tu Worker (KV) y nunca se muestra de vuelta. Si Bizneo la renueva, se actualiza sola.</small></label>
    <div class="fields"><label><span>Caduca el</span><input type="date" id="b_exp"><small class="hint">se rellena solo si Bizneo indica la fecha</small></label>
      <label><span>Modo</span><select id="b_dry"><option value="1">🧪 Prueba (no envía nada)</option><option value="0">✅ Real (ficha en Bizneo)</option></select></label>
      <label><span>Opción de pausa</span><input type="text" id="b_pause" placeholder="Comida"><small class="hint">texto de la opción del desplegable "Pausar"</small></label></div>
    <div class="actions"><button class="btn" id="testBtn">Guardar y diagnosticar</button><button class="btn danger" id="clearBtn">Borrar cookie</button></div>
    <pre id="diag" class="diag" hidden></pre>
    <details><summary style="cursor:pointer;font-weight:500">Cómo copiar las cookies</summary><ol class="howto" style="margin-top:10px">
      <li>Entra en Bizneo con tu usuario en Chrome o Edge.</li>
      <li>Pulsa <b>F12 → Application → Cookies →</b> la dirección de tu Bizneo.</li>
      <li>Copia el valor de <code>_hcmex_key</code> y de <code>device_id</code> (doble clic en <i>Value</i>).</li>
      <li>Pégalos aquí así: <code>_hcmex_key=VALOR; device_id=VALOR</code></li>
    </ol></details>
  </div></section>

  <div class="actions" style="justify-content:flex-end"><a class="btn" href="/me/dashboard">Volver</a><button class="btn primary" id="saveBtn">Guardar cambios</button></div>
</main>`, `
const DOW=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
let C;
$("#navlink").textContent="Panel";$("#navlink").href="/me/dashboard";
const goal=(e,s,p,r)=>{if(!e||!s)return"—";let m=toMin(s)-toMin(e);if(p&&r)m-=toMin(r)-toMin(p);return m>0?fmtHM(m):"—"};
function rowGoal(tr){const v=k=>$("[data-k="+k+"]",tr).value;$(".goal",tr).textContent=goal(v("entrada"),v("salida"),v("pausa"),v("retorno"))}
async function load(){const st=await api("/api/state");C=st.config;header(C);const s=C.schedule,b=C.bizneo;
 $("#p_name").value=C.profile.name;$("#p_email").value=C.profile.email;$("#a_days").value=C.alerts.daysBefore;
 $("#mailInfo").textContent=C.mail?"Resend configurado":"falta el secreto RESEND_API_KEY";
 $("#s_jitter").value=s.jitterMin;
 $("#days").innerHTML=DOW.map((d,i)=>{const n=i+1,h=s.days[n]||{},m=s.workdays.includes(n)?(s.defaultModes[n]||"casa"):"libre";
  const t=k=>'<td><input type="time" data-k="'+k+'" value="'+esc(h[k]||"")+'"></td>';
  return '<tr data-wd="'+n+'"><td><b>'+d+'</b></td><td><select data-k="mode">'+[["oficina","🏢 oficina"],["casa","🏠 casa"],["libre","🌴 libre"]].map(([v,l])=>'<option value="'+v+'"'+(v===m?" selected":"")+'>'+l+'</option>').join("")+'</select></td>'+
   t("entrada")+t("pausa")+t("retorno")+t("salida")+'<td class="goal hint"></td></tr>'}).join("");
 document.querySelectorAll("#days tr").forEach(tr=>{rowGoal(tr);tr.oninput=()=>rowGoal(tr)});
 $("#b_base").value=b.baseUrl;$("#b_dry").value=b.dryRun?"1":"0";$("#b_pause").value=b.pauseLabel||"";
 $("#b_exp").value=b.cookieExpiresAt?b.cookieExpiresAt.slice(0,10):"";
 $("#sesInfo").textContent=b.hasCookie?("cookie guardada"+(b.cookieSavedAt?" el "+new Date(b.cookieSavedAt).toLocaleDateString("es-ES"):"")):"sin cookie";
}
function collect(){const days={},modes={};
 document.querySelectorAll("#days tr").forEach(tr=>{const n=tr.dataset.wd,v=k=>$("[data-k="+k+"]",tr).value;
  modes[n]=v("mode");if(v("entrada")&&v("salida"))days[n]={entrada:v("entrada"),salida:v("salida"),pausa:v("pausa"),retorno:v("retorno")};
  else if(v("mode")!=="libre")throw new Error(DOW[n-1]+": faltan las horas de iniciar y finalizar")});
 return{profile:{name:$("#p_name").value,email:$("#p_email").value},alerts:{daysBefore:+$("#a_days").value},
  schedule:{jitterMin:+$("#s_jitter").value,days,defaultModes:modes},
  bizneo:{baseUrl:$("#b_base").value,cookie:$("#b_cookie").value,cookieExpiresAt:$("#b_exp").value||null,dryRun:$("#b_dry").value==="1",pauseLabel:$("#b_pause").value}}}
async function save(){await api("/api/config",collect());$("#b_cookie").value=""}
$("#saveBtn").onclick=async()=>{try{await save();toast("Guardado");load()}catch(e){toast("⚠ "+e.message)}};
$("#testBtn").onclick=async e=>{e.target.disabled=true;const out=$("#diag");out.hidden=false;out.textContent="Comprobando…";
 try{await save();const d=await api("/api/test-action",{});
  out.textContent=["✓ Sesión válida","Cronómetro: "+d.stateTxt+(d.startedAt?" desde "+new Date(d.startedAt).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}):""),
   "Registrado hoy: "+(d.registeredMin!=null?fmtHM(d.registeredMin):"?"),"Petición del botón: "+d.request,"Token CSRF: "+(d.csrf?"encontrado":"NO encontrado"),
   "Opciones oficina/casa: "+(d.kinds.join(", ")||"—"),"Opciones de pausa: "+(d.pauses.join(" | ")||"(sólo aparecen con el cronómetro en marcha)"),
   "Hoy en el calendario: "+(d.today?d.today.classes.join(" ")+(d.today.off?" → NO se ficha":" → laborable"):"NO encontrado (no se ficharía)")].join("\\n");
  load()}catch(err){out.textContent="✗ "+err.message}e.target.disabled=false};
$("#mailBtn").onclick=async()=>{try{await save();await api("/api/test-mail",{});toast("Correo enviado: revisa tu bandeja")}catch(e){toast("⚠ "+e.message)}};
$("#clearBtn").onclick=async()=>{if(!confirm("¿Borrar la cookie de Bizneo guardada?"))return;await api("/api/config",{bizneo:{clearCookie:true}});toast("Cookie borrada");load()};
load().then(()=>{if(location.hash)document.querySelector(location.hash)?.scrollIntoView()});
`);
