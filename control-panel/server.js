import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

const app = express();
const PORT = Number(process.env.PORT || 8088);
const ENV_FILE = process.env.ENV_FILE || "/opt/carbonflow/compose/.env";
const STACK_DIR = process.env.STACK_DIR || "/opt/carbonflow/compose";
const CP_USER = process.env.CONTROL_PANEL_USER || "admin";
const CP_PASS = process.env.CONTROL_PANEL_PASSWORD || "";
const VAULT = process.env.VAULT_ROOT || "/vault";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "phi3:mini";

const sections = {
  connectivity: ["DOMAIN","CLOUDFLARED_TOKEN","CF_API_TOKEN","CF_ZONE_ID","MOYASAR_API_KEY","TAP_SECRET_KEY"],
  email: ["SUPPORT_EMAIL","SYSTEM_EMAIL","SMTP_HOST","SMTP_PORT","SMTP_TLS","SMTP_USER","SMTP_PASSWORD","SMTP_FROM","EMAIL_AUDIT_LOG","CREDENTIAL_RECOVERY_EMAIL"],
  releases: ["RELEASE_WEBHOOK_SECRET","RELEASE_API_TOKEN","GITHUB_DEPLOY_PUBLIC_KEY","GITHUB_WEBHOOK_ALLOWED_REPO"],
  ai: ["OLLAMA_MODEL","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","N8N_ENCRYPTION_KEY","N8N_BASIC_AUTH_USER","N8N_BASIC_AUTH_PASSWORD","N8N_API_KEY"],
  telemetry: ["TELEMETRY_TOKEN"],
  control: ["CONTROL_PANEL_USER","CONTROL_PANEL_PASSWORD"]
};
const allowedKeys = Object.values(sections).flat();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  if (!CP_PASS || CP_PASS.startsWith("change_me"))
    return res.status(503).send("Set CONTROL_PANEL_PASSWORD in .env first.");
  const header = req.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="CarbonFlow Control"');
    return res.status(401).send("Authentication required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (decoded.slice(0, idx) !== CP_USER || decoded.slice(idx + 1) !== CP_PASS) {
    res.set("WWW-Authenticate", 'Basic realm="CarbonFlow Control"');
    return res.status(401).send("Authentication required");
  }
  next();
});

const esc = v => String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

async function readEnv() {
  const text = await fs.readFile(ENV_FILE, "utf8");
  const lines = text.split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    values[line.slice(0, i)] = line.slice(i + 1);
  }
  return { lines, values };
}

async function writeEnv(updates) {
  const { lines, values } = await readEnv();
  const next = { ...values };
  for (const k of allowedKeys)
    if (Object.prototype.hasOwnProperty.call(updates, k))
      next[k] = String(updates[k] || "").replace(/\r?\n/g, "");
  const seen = new Set();
  const out = lines.map(line => {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) return line;
    const k = line.slice(0, line.indexOf("="));
    if (!allowedKeys.includes(k)) return line;
    seen.add(k);
    return `${k}=${next[k] ?? ""}`;
  });
  for (const k of allowedKeys)
    if (!seen.has(k) && Object.prototype.hasOwnProperty.call(next, k))
      out.push(`${k}=${next[k]}`);
  await fs.writeFile(ENV_FILE, out.join("\n"), { mode: 0o600 });
}

function exec(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env: process.env });
    let out = "";
    child.stdout.on("data", d => out += d);
    child.stderr.on("data", d => out += d);
    child.on("close", code => resolve({ code, out }));
  });
}

async function safeRead(file, fb = "") {
  try { return await fs.readFile(file, "utf8"); } catch { return fb; }
}

function ollamaReq(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: "ollama", port: 11434, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, resolve);
    req.on("error", reject);
    req.write(data); req.end();
  });
}

function totpReq() {
  return new Promise(resolve => {
    http.get({ host: "localhost", port: 9999, path: "/totp" }, res => {
      let d = ""; res.on("data", x => d += x);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0f1e;--surface:#111827;--border:#1e293b;--text:#f1f5f9;--muted:#64748b;--green:#22c55e;--red:#ef4444;--blue:#3b82f6;--yellow:#f59e0b;--accent:#10b981}
body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;direction:rtl}
a{color:var(--accent);text-decoration:none}
nav{background:#060d1a;border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:4px;position:sticky;top:0;z-index:100;flex-wrap:wrap}
nav .brand{font-weight:700;color:var(--accent);font-size:1.1rem;padding:14px 12px 14px 0;border-left:1px solid var(--border);margin-left:8px;white-space:nowrap}
nav a.nav-link{color:var(--muted);padding:14px 12px;display:block;font-size:.9rem;border-bottom:2px solid transparent;transition:.15s}
nav a.nav-link:hover,nav a.nav-link.active{color:var(--text);border-bottom-color:var(--accent)}
main{max-width:1200px;margin:0 auto;padding:24px 20px}
h1{font-size:1.5rem;margin-bottom:20px}
h2{font-size:.85rem;margin-bottom:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px}
.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:16px}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.svc{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dot.up{background:var(--green);box-shadow:0 0 5px var(--green)}
.dot.down{background:var(--red)}
.svc-name{font-weight:600;font-size:.85rem;flex:1}
.svc-sub{font-size:.72rem;color:var(--muted);margin-top:1px}
label{display:block;margin:10px 0;color:var(--muted);font-size:.85rem}
label span{display:block;margin-bottom:3px}
input,select,textarea{width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:#060d1a;color:var(--text);font-size:.85rem;font-family:inherit}
input:focus,textarea:focus{outline:none;border-color:var(--accent)}
.btn{padding:8px 14px;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:.85rem;transition:.15s}
.btn-primary{background:var(--accent);color:#022c22}
.btn-primary:hover{opacity:.88}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted)}
.btn-ghost:hover{border-color:var(--accent);color:var(--text)}
.btn-sm{padding:4px 9px;font-size:.75rem}
pre{background:#060d1a;border:1px solid var(--border);border-radius:6px;padding:12px;overflow:auto;max-height:340px;font-size:.78rem;white-space:pre-wrap;color:#94a3b8}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
.stat-v{font-size:1.8rem;font-weight:700;color:var(--accent)}
.stat-l{font-size:.75rem;color:var(--muted);margin-top:3px}
.totp-w{background:linear-gradient(135deg,#0f2027,#203a43);border:1px solid var(--accent);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;margin-bottom:16px}
.totp-c{font-size:2rem;font-weight:700;letter-spacing:.18em;color:var(--accent);font-variant-numeric:tabular-nums}
.totp-bar{flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.totp-fill{height:100%;background:var(--accent);transition:width 1s linear}
#chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 140px);min-height:480px}
#chat-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:78%;padding:11px 15px;border-radius:10px;line-height:1.65;font-size:.88rem;white-space:pre-wrap}
.msg.user{align-self:flex-start;background:#1e3a5f;border-bottom-left-radius:2px}
.msg.ai{align-self:flex-end;background:#14261a;border-bottom-right-radius:2px}
@keyframes blink{50%{opacity:0}}
.typing::after{content:"▋";animation:blink .7s step-end infinite}
#chat-row{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--surface);border-radius:0 0 10px 10px}
#chat-in{flex:1;resize:none;height:50px}
`;

function nav(active) {
  const links = [["/","🏠 الرئيسية"],["/chat","💬 محادثة AI"],["/config","⚙️ الإعدادات"],["/email","📧 البريد"],["/releases","📦 الإصدارات"],["/telemetry","📊 المراقبة"],["/credentials","🔑 بيانات الدخول"]];
  return `<nav><div class="brand">⚡ CarbonFlow</div>${links.map(([h,l])=>`<a href="${h}" class="nav-link${active===h?" active":""}">${l}</a>`).join("")}</nav>`;
}

function layout(active, body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CarbonFlow Control</title><style>${CSS}</style></head><body>${nav(active)}<main>${body}</main></body></html>`;
}

function inputRow(key, val) {
  const sens = /PASSWORD|TOKEN|KEY|SECRET/.test(key);
  return `<label><span>${esc(key)}</span><input name="${esc(key)}" type="${sens?"password":"text"}" value="${esc(val||"")}" autocomplete="off"></label>`;
}

// ── API ────────────────────────────────────────────────────────────────────────
app.get("/api/status", async (_req, res) => {
  const [ps, mem, load, df] = await Promise.all([
    exec("docker",["ps","-a","--format",'{"n":"{{.Names}}","s":"{{.Status}}"}']),
    exec("sh",["-c","free -m | awk '/Mem/{print $2,$3}'"]),
    exec("sh",["-c","cat /proc/loadavg"]),
    exec("sh",["-c","df -m /vault | tail -1 | awk '{print $2,$3}'"]),
  ]);
  const containers = ps.out.trim().split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
  const [mt,mu] = mem.out.trim().split(" ").map(Number);
  const [dt,du] = df.out.trim().split(" ").map(Number);
  res.json({ containers, mem:{total:mt,used:mu,pct:Math.round(mu/mt*100)}, load:load.out.trim().split(" ")[0], disk:{total:dt,used:du,pct:Math.round(du/dt*100)} });
});

app.get("/api/totp", async (_req, res) => {
  const t = await totpReq();
  res.json(t || { code:"------", expires_in:0, account:"" });
});

app.get("/api/logs/:svc", async (req, res) => {
  const { out } = await exec("docker",["logs","--tail","100",req.params.svc.replace(/[^a-z0-9_-]/gi,"")]);
  res.type("text").send(out);
});

app.post("/api/svc/:action/:name", async (req, res) => {
  const { action, name } = req.params;
  const safe = name.replace(/[^a-z0-9_-]/gi,"");
  const base = ["compose","-f",`${STACK_DIR}/docker-compose.yml`,"--env-file",ENV_FILE];
  const cmds = { restart:[...base,"restart",safe], stop:[...base,"stop",safe], start:[...base,"up","-d",safe] };
  if (!cmds[action]) return res.status(400).json({error:"bad action"});
  const { code, out } = await exec("docker", cmds[action]);
  res.json({ code, out });
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)||!messages.length) return res.status(400).json({error:"messages required"});
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("X-Accel-Buffering","no");
  let ollamaRes;
  try {
    ollamaRes = await ollamaReq("/api/chat",{ model:process.env.OLLAMA_MODEL||OLLAMA_MODEL, messages, stream:true });
  } catch(e) {
    res.write(`data: ${JSON.stringify({error:"Ollama غير متاح: "+e.message})}\n\n`);
    return res.end();
  }
  ollamaRes.on("data", chunk => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      try {
        const o = JSON.parse(line);
        if (o.message?.content) res.write(`data: ${JSON.stringify({token:o.message.content})}\n\n`);
        if (o.done) res.write(`data: ${JSON.stringify({done:true})}\n\n`);
      } catch {}
    }
  });
  ollamaRes.on("end", () => res.end());
  ollamaRes.on("error", () => res.end());
});

// ── HTML pages ─────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.type("html").send(layout("/", `
<h1>🏠 لوحة التحكم الرئيسية</h1>
<div class="totp-w">
  <div>
    <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px">رمز TOTP · <span id="t-acc" style="color:var(--accent)"></span></div>
    <div class="totp-c" id="t-code">••••••</div>
  </div>
  <div style="flex:1">
    <div class="totp-bar"><div class="totp-fill" id="t-bar" style="width:100%"></div></div>
    <div style="font-size:.7rem;color:var(--muted);margin-top:4px">ينتهي خلال <span id="t-exp">--</span> ث</div>
  </div>
  <button class="btn btn-ghost btn-sm" onclick="copyTotp(this)">نسخ</button>
</div>
<div class="grid-4">
  <div class="stat"><div class="stat-v" id="s-ram">--</div><div class="stat-l">RAM</div></div>
  <div class="stat"><div class="stat-v" id="s-load">--</div><div class="stat-l">CPU Load</div></div>
  <div class="stat"><div class="stat-v" id="s-disk">--</div><div class="stat-l">Vault Disk</div></div>
  <div class="stat"><div class="stat-v" id="s-up">--</div><div class="stat-l">خدمات نشطة</div></div>
</div>
<div class="card">
  <h2>حالة الخدمات</h2>
  <div class="grid-3" id="svc-grid"><div style="color:var(--muted);font-size:.85rem">جارٍ التحميل...</div></div>
</div>
<div class="card">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <h2 style="margin:0">سجلات</h2>
    <select id="log-sel" style="flex:1;max-width:220px"></select>
    <button class="btn btn-ghost btn-sm" onclick="loadLogs()">عرض</button>
  </div>
  <pre id="log-out">اختر خدمة لعرض السجلات</pre>
</div>
<script>
const META={
  'carbonflow-n8n':{l:'n8n AI Agent',i:'🤖'},
  'carbonflow-ollama':{l:'Ollama LLM',i:'🧠'},
  'carbonflow-control-panel':{l:'Control Panel',i:'⚡'},
  'carbonflow-litecart':{l:'LiteCart Shop',i:'🛒'},
  'carbonflow-litecart-db':{l:'LiteCart DB',i:'🗄️'},
  'carbonflow-npm':{l:'Nginx Proxy Mgr',i:'🔀'},
  'carbonflow-npm-db':{l:'NPM Database',i:'🗄️'},
  'carbonflow-cloudflared':{l:'CF Tunnel',i:'☁️'},
  'carbonflow-crowdsec':{l:'CrowdSec WAF',i:'🛡️'},
  'carbonflow-release-api':{l:'Release API',i:'📦'},
  'carbonflow-telemetry-api':{l:'Telemetry API',i:'📊'},
};
async function refresh(){
  const d=await fetch('/api/status').then(r=>r.json()).catch(()=>null);
  if(!d)return;
  document.getElementById('s-ram').textContent=d.mem.pct+'%';
  document.getElementById('s-load').textContent=d.load;
  document.getElementById('s-disk').textContent=d.disk.pct+'%';
  const up=d.containers.filter(c=>c.s.startsWith('Up')).length;
  document.getElementById('s-up').textContent=up+'/'+d.containers.length;
  const g=document.getElementById('svc-grid');
  const sel=document.getElementById('log-sel');
  const prev=sel.value;
  g.innerHTML=''; sel.innerHTML='';
  d.containers.forEach(c=>{
    const m=META[c.n]||{l:c.n,i:'📦'};
    const up=c.s.startsWith('Up');
    g.innerHTML+=\`<div class="svc">
      <div class="dot \${up?'up':'down'}"></div>
      <div style="flex:1"><div class="svc-name">\${m.i} \${m.l}</div><div class="svc-sub">\${c.s.split('(')[0].trim()}</div></div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" title="إعادة تشغيل" onclick="svc('restart','\${c.n}')">↺</button>
        <button class="btn btn-ghost btn-sm" title="\${up?'إيقاف':'تشغيل'}" onclick="svc('\${up?'stop':'start'}','\${c.n}')">\${up?'⏹':'▶'}</button>
      </div></div>\`;
    sel.innerHTML+=\`<option value="\${c.n}">\${m.l}</option>\`;
  });
  if(prev)sel.value=prev;
}
async function svc(action,name){
  document.getElementById('log-out').textContent='جارٍ التنفيذ...';
  const r=await fetch(\`/api/svc/\${action}/\${name}\`,{method:'POST'}).then(r=>r.json());
  document.getElementById('log-out').textContent=r.out||'تم';
  setTimeout(refresh,2000);
}
async function loadLogs(){
  const n=document.getElementById('log-sel').value;
  if(!n)return;
  document.getElementById('log-out').textContent='جارٍ التحميل...';
  const t=await fetch('/api/logs/'+n).then(r=>r.text());
  const el=document.getElementById('log-out');
  el.textContent=t; el.scrollTop=el.scrollHeight;
}
async function refreshTotp(){
  const d=await fetch('/api/totp').then(r=>r.json()).catch(()=>null);
  if(!d)return;
  document.getElementById('t-code').textContent=d.code;
  document.getElementById('t-acc').textContent=d.account||'';
  document.getElementById('t-exp').textContent=d.expires_in;
  const pct=d.expires_in/30*100;
  const bar=document.getElementById('t-bar');
  bar.style.width=pct+'%';
  bar.style.background=d.expires_in<=8?'var(--red)':'var(--accent)';
}
function copyTotp(btn){
  navigator.clipboard.writeText(document.getElementById('t-code').textContent)
    .then(()=>{btn.textContent='✓ تم';setTimeout(()=>btn.textContent='نسخ',2000)});
}
refresh(); refreshTotp();
setInterval(refresh,15000); setInterval(refreshTotp,5000);
</script>`));
});

app.get("/chat", (_req, res) => {
  res.type("html").send(layout("/chat", `
<div id="chat-wrap" class="card" style="padding:0;overflow:hidden">
  <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
    <span style="font-size:1.3rem">🧠</span>
    <div style="flex:1"><div style="font-weight:600;font-size:.95rem">CarbonFlow AI</div><div style="font-size:.72rem;color:var(--muted)">Ollama · ${esc(OLLAMA_MODEL)}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="clearChat()">🗑 مسح</button>
  </div>
  <div id="chat-msgs">
    <div class="msg ai">مرحباً! أنا مساعد CarbonFlow الذكي. كيف يمكنني مساعدتك اليوم؟</div>
  </div>
  <div id="chat-row">
    <button class="btn btn-primary btn-sm" onclick="sendChat()" id="send-btn" style="white-space:nowrap">إرسال</button>
    <textarea id="chat-in" placeholder="اكتب رسالتك... (Enter للإرسال، Shift+Enter لسطر جديد)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
  </div>
</div>
<script>
let hist=[], busy=false;
const msgs=()=>document.getElementById('chat-msgs');
const scrollBot=()=>{const el=msgs();el.scrollTop=el.scrollHeight;};
function clearChat(){hist=[];msgs().innerHTML='<div class="msg ai">محادثة جديدة. كيف يمكنني مساعدتك؟</div>';}
async function sendChat(){
  if(busy)return;
  const inp=document.getElementById('chat-in');
  const txt=inp.value.trim();
  if(!txt)return;
  inp.value=''; busy=true;
  document.getElementById('send-btn').disabled=true;
  const uDiv=document.createElement('div'); uDiv.className='msg user'; uDiv.textContent=txt; msgs().appendChild(uDiv); scrollBot();
  hist.push({role:'user',content:txt});
  const aDiv=document.createElement('div'); aDiv.className='msg ai';
  const sp=document.createElement('span'); sp.className='typing'; aDiv.appendChild(sp); msgs().appendChild(aDiv); scrollBot();
  let full='';
  try{
    const resp=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:hist})});
    const reader=resp.body.getReader(); const dec=new TextDecoder(); let buf='';
    while(true){
      const {done,value}=await reader.read(); if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\\n'); buf=lines.pop();
      for(const ln of lines){
        if(!ln.startsWith('data: '))continue;
        const d=JSON.parse(ln.slice(6));
        if(d.token){full+=d.token;sp.className='';sp.textContent=full;scrollBot();}
        if(d.error){sp.className='';sp.textContent='⚠️ '+d.error;}
      }
    }
  }catch(e){sp.className='';sp.textContent='⚠️ خطأ: '+e.message;}
  hist.push({role:'assistant',content:full});
  busy=false; document.getElementById('send-btn').disabled=false;
  document.getElementById('chat-in').focus();
}
</script>`));
});

app.get("/config", async (_req, res) => {
  const { values } = await readEnv();
  const sectionLabels = {connectivity:"🌐 الاتصال والبنية",email:"📧 البريد الإلكتروني",releases:"📦 الإصدارات CI/CD",ai:"🤖 الذكاء الاصطناعي",telemetry:"📊 التتبع",control:"🔒 لوحة التحكم"};
  const tabs = Object.entries(sections).map(([k,keys])=>
    `<div class="card"><h2>${sectionLabels[k]||k}</h2>${keys.map(k=>inputRow(k,values[k])).join("")}</div>`
  ).join("");
  res.type("html").send(layout("/config",`
<h1>⚙️ الإعدادات</h1>
<form method="post" action="/tokens">${tabs}
<div style="position:sticky;bottom:0;padding:12px 0;background:var(--bg);border-top:1px solid var(--border)">
<button class="btn btn-primary">💾 حفظ جميع الإعدادات</button></div></form>`));
});

app.get("/email", async (_req, res) => {
  const { values } = await readEnv();
  const audit = await safeRead(values.EMAIL_AUDIT_LOG||"/vault/mail/mail-audit.log","لا توجد سجلات.");
  res.type("html").send(layout("/email",`
<h1>📧 محرك البريد</h1>
<div class="card"><h2>إعدادات SMTP · Resend.com</h2>
<form method="post" action="/tokens">${sections.email.map(k=>inputRow(k,values[k])).join("")}
<button class="btn btn-primary" style="margin-top:10px">حفظ</button></form></div>
<div class="card"><h2>سجل البريد</h2><pre>${esc(audit.slice(-5000))}</pre></div>`));
});

app.get("/releases", async (_req, res) => {
  const { values } = await readEnv();
  const tree = await (async()=>{
    const rows=[];
    async function walk(dir,lv){
      if(lv>3)return;
      let e=[]; try{e=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
      for(const x of e.slice(0,60)){
        rows.push(path.join(dir,x.name).replace(VAULT,"/vault"));
        if(x.isDirectory())await walk(path.join(dir,x.name),lv+1);
      }
    }
    await walk(path.join(VAULT,"products"),0);
    return rows.join("\n");
  })();
  res.type("html").send(layout("/releases",`
<h1>📦 مدير الإصدارات</h1>
<div class="card"><h2>إعدادات CI/CD</h2>
<form method="post" action="/tokens">${sections.releases.map(k=>inputRow(k,values[k])).join("")}
<button class="btn btn-primary" style="margin-top:10px">حفظ</button></form></div>
<div class="card"><h2>Webhook Endpoint</h2>
<pre>POST https://${esc(values.DOMAIN||"carbonflows.store")}/api/webhooks/github
Header: x-carbonflow-signature: sha256=&lt;hmac&gt;</pre></div>
<div class="card"><h2>المنتجات المنشورة</h2><pre>${esc(tree||"لا توجد إصدارات منشورة.")}</pre></div>`));
});

app.get("/telemetry", async (_req, res) => {
  const [zram,df,ps,nets] = await Promise.all([
    exec("zramctl",[]),
    exec("df",["-h","/"]),
    exec("docker",["ps","-a","--format","table {{.Names}}\\t{{.Status}}\\t{{.Image}}"]),
    exec("docker",["network","ls"]),
  ]);
  const { values } = await readEnv();
  res.type("html").send(layout("/telemetry",`
<h1>📊 مراقبة النظام</h1>
<div class="card"><h2>إعدادات Telemetry</h2>
<form method="post" action="/tokens">${sections.telemetry.map(k=>inputRow(k,values[k])).join("")}
<button class="btn btn-primary" style="margin-top:10px">حفظ</button></form></div>
<div class="grid-2">
<div class="card"><h2>ZRAM</h2><pre>${esc(zram.out||"غير متاح.")}</pre></div>
<div class="card"><h2>القرص الرئيسي</h2><pre>${esc(df.out)}</pre></div>
</div>
<div class="card"><h2>الكونتينرات</h2><pre>${esc(ps.out)}</pre></div>
<div class="card"><h2>Docker Networks</h2><pre>${esc(nets.out)}</pre></div>
<div class="card"><h2>إعادة تشغيل الـ Stack</h2>
<form method="post" action="/restart"><button class="btn btn-ghost">↺ إعادة تشغيل جميع الخدمات</button></form></div>`));
});

app.get("/credentials", async (_req, res) => {
  const creds = await safeRead(path.join(VAULT,"credentials","carbonflow-credentials.txt"),"لم يُنشأ الملف بعد.");
  const adminCreds = await safeRead(path.join(VAULT,"secrets","admin_creds.env"),"");
  const sent = await safeRead(path.join(VAULT,"mail","carbonflow-credentials.sent"),"");
  res.type("html").send(layout("/credentials",`
<h1>🔑 بيانات الدخول</h1>
${adminCreds?`<div class="card"><h2>بيانات الإدارة</h2><pre>${esc(adminCreds)}</pre></div>`:""}
<div class="card"><h2>ملف الاستعادة</h2><pre>${esc(creds)}</pre>
<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
<form method="get" action="/credentials.txt"><button class="btn btn-ghost">⬇ تنزيل</button></form>
<form method="post" action="/credentials/send"><button class="btn btn-primary">📨 إرسال بريد الاستعادة</button></form>
</div></div>
${sent?`<div class="card"><h2>حالة الإرسال</h2><pre>آخر إرسال ناجح: ${esc(sent.trim())}</pre></div>`:""}`));
});

// ── POST routes ────────────────────────────────────────────────────────────────
app.post("/tokens", async (req, res) => {
  await writeEnv(req.body);
  res.redirect(req.get("referer") || "/config");
});

app.post("/restart", async (_req, res) => {
  const { out } = await exec("docker",["compose","-f",`${STACK_DIR}/docker-compose.yml`,"--env-file",ENV_FILE,"up","-d"]);
  res.type("text").send(out);
});

app.post("/validate", async (_req, res) => {
  const { out } = await exec("sh",["/scripts/validate-edge.sh"]);
  res.type("text").send(out);
});

app.post("/toggle-ai", async (_req, res) => {
  const ps = await exec("docker",["compose","-f",`${STACK_DIR}/docker-compose.yml`,"--env-file",ENV_FILE,"ps","--status","running","--services"]);
  const running = ps.out.split(/\r?\n/).filter(Boolean);
  const stop = running.includes("ollama")||running.includes("n8n");
  const args = stop
    ? ["compose","-f",`${STACK_DIR}/docker-compose.yml`,"--env-file",ENV_FILE,"stop","ollama","n8n"]
    : ["compose","-f",`${STACK_DIR}/docker-compose.yml`,"--env-file",ENV_FILE,"up","-d","ollama","n8n"];
  const { out } = await exec("docker", args);
  res.type("text").send(`action: ${stop?"stop":"start"}\n${out}`);
});

app.get("/credentials.txt", async (_req, res) => {
  const t = await safeRead(path.join(VAULT,"credentials","carbonflow-credentials.txt"),"not found");
  res.set("Content-Disposition","attachment; filename=carbonflow-credentials.txt");
  res.type("text").send(t);
});

app.post("/credentials/send", async (_req, res) => {
  const { values } = await readEnv();
  const recipient = values.CREDENTIAL_RECOVERY_EMAIL || "far7an.o88@gmail.com";
  const creds = await safeRead(path.join(VAULT,"credentials","carbonflow-credentials.txt"),"");
  const mailFile = "/tmp/cf-creds.eml";
  await fs.writeFile(mailFile,[
    `To: ${recipient}`,`From: ${values.SMTP_FROM||"noreply@carbonflows.store"}`,
    "Subject: CarbonFlow Credentials","Content-Type: text/plain; charset=UTF-8","",creds
  ].join("\n"),{mode:0o600});
  const args = ["--url",`smtp://${values.SMTP_HOST}:${values.SMTP_PORT||587}`,
    "--mail-from",values.SMTP_USER,"--mail-rcpt",recipient,
    "--user",`${values.SMTP_USER}:${values.SMTP_PASSWORD}`,
    "--upload-file",mailFile,"--max-time","60"];
  if((values.SMTP_TLS||"YES")!=="NO") args.splice(2,0,"--ssl-reqd");
  const { code, out } = await exec("curl",args);
  res.type("text").send(code===0?`✅ أُرسل إلى ${recipient}`:`❌ فشل الإرسال:\n${out}`);
});

app.listen(PORT, "0.0.0.0");
