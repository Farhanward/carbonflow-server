import fs from "node:fs/promises";
import path from "node:path";

const token = must("TELEGRAM_BOT_TOKEN");
const anthropicKey = must("ANTHROPIC_API_KEY");
const allowedChatId = String(process.env.TELEGRAM_ALLOWED_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "").trim();
const stateFile = process.env.BOT_STATE_FILE || "/data/state.json";
const defaultModel = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const suggestedModels = [
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
];

const telegramBase = `https://api.telegram.org/bot${token}`;
const systemPrompt = `
أنت كلودي — المساعد الذكي الخاص لـ CarbonFlow Tech.
تعمل داخل السيرفر الخاص بالمالك فرحان (Telegram: Faro1988).

مهامك:
- مراقبة السيرفر والموقع والتطبيقات
- الإجابة على أسئلة المالك عن الأعمال والتقنية
- إبلاغ حالة الخدمات عند الطلب
- المساعدة في قرارات المنتجات والنشر

المنتجات المدارة:
• GrowBox Pro — 149 ر.س/شهر (Tauri + Rust)
• CarbonFlow Server — 250 ر.س/شهر (Docker self-hosted)
• CarbonLedger — 100 ر.س/شهر (محاسبة مطاعم)
• CarbonQueue — 180 ر.س/شهر (طوابير عيادات + SMS)
• CarbonMind AI — 490 ر.س/شهر (مساعد مستندات + OpenAI)

البنية التحتية:
• الموقع: https://www.carbonflows.store (Cloudflare Workers)
• GitHub: https://github.com/Farhanward
• السيرفر: Docker Compose على Linux
• الدفع: Tap Payments (مدى، فيزا، Apple Pay، Samsung Pay)

تحدث بالعربية دائماً. كن مختصراً وعملياً. لا تنفّذ أوامر مدمّرة.
`.trim();

let offset = 0;
let state = await loadState();

function must(name) {
  const value = process.env[name];
  if (!value) { console.error(`${name} is required`); process.exit(1); }
  return value;
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(stateFile, "utf8")); }
  catch { return { chats: {} }; }
}

async function saveState() {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

function chatState(chatId) {
  const key = String(chatId);
  state.chats[key] ||= { model: defaultModel, messages: [] };
  return state.chats[key];
}

function isAllowed(chatId) {
  return !allowedChatId || String(chatId) === allowedChatId;
}

async function telegram(method, payload) {
  const response = await fetch(`${telegramBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Telegram ${method}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function sendMessage(chatId, text, extra = {}) {
  for (const chunk of splitText(text)) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
      ...extra,
    });
  }
}

function splitText(text) {
  const value = String(text || "").trim() || "تم.";
  const chunks = [];
  for (let i = 0; i < value.length; i += 3900) chunks.push(value.slice(i, i + 3900));
  return chunks;
}

function modelKeyboard() {
  return {
    inline_keyboard: suggestedModels.map((m) => [{ text: m, callback_data: `model:${m}` }]),
  };
}

async function askClaude(chatId, userText) {
  const session = chatState(chatId);
  session.messages.push({ role: "user", content: userText });
  session.messages = session.messages.slice(-20);
  await saveState();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: session.model || defaultModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: session.messages,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Claude API: ${response.status} ${body?.error?.message || JSON.stringify(body)}`);
  }

  const answer = body.content?.[0]?.text?.trim() || "لم يصل رد من Claude.";
  session.messages.push({ role: "assistant", content: answer });
  session.messages = session.messages.slice(-20);
  await saveState();
  return answer;
}

async function handleCommand(chatId, text) {
  const session = chatState(chatId);
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  if (cmd === "/start" || cmd === "/help") {
    await sendMessage(chatId,
      `👋 أنا *كلودي* — مساعد CarbonFlow الذكي على سيرفرك\n\n` +
      `الأوامر:\n` +
      `/status — حالة الخدمات\n` +
      `/model — النموذج الحالي\n` +
      `/models — اختيار نموذج\n` +
      `/reset — مسح المحادثة\n\n` +
      `النموذج الحالي: ${session.model || defaultModel}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  if (cmd === "/status") {
    const checks = await Promise.allSettled([
      fetch("https://www.carbonflows.store").then((r) => `${r.status}`),
      fetch(`${telegramBase}/getMe`).then((r) => r.ok ? "✅" : "❌"),
    ]);
    const site = checks[0].status === "fulfilled" ? `✅ HTTP ${checks[0].value}` : "❌ غير متاح";
    const bot  = checks[1].status === "fulfilled" ? checks[1].value : "❌";
    await sendMessage(chatId,
      `📊 *حالة النظام*\n\n🌐 الموقع: ${site}\n🤖 البوت: ${bot}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  if (cmd === "/model") {
    if (!arg) {
      await sendMessage(chatId, `النموذج الحالي: \`${session.model || defaultModel}\`\nاستخدم /models للتغيير.`, { parse_mode: "Markdown" });
      return true;
    }
    session.model = arg.trim();
    session.messages = [];
    await saveState();
    await sendMessage(chatId, `✅ تم اختيار: \`${session.model}\``, { parse_mode: "Markdown" });
    return true;
  }

  if (cmd === "/models") {
    await sendMessage(chatId, "اختر نموذج Claude:", { reply_markup: modelKeyboard() });
    return true;
  }

  if (cmd === "/reset") {
    session.messages = [];
    await saveState();
    await sendMessage(chatId, "✅ تم مسح سياق المحادثة.");
    return true;
  }

  return false;
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;

  if (!isAllowed(chatId)) {
    await sendMessage(chatId, "⛔ هذا البوت خاص.");
    return;
  }

  const text = message.text || "";
  if (!text.trim()) {
    await sendMessage(chatId, "أرسل رسالة نصية.");
    return;
  }

  if (text.startsWith("/") && await handleCommand(chatId, text)) return;

  await telegram("sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    const answer = await askClaude(chatId, text);
    await sendMessage(chatId, answer);
  } catch (err) {
    console.error(err);
    await sendMessage(chatId, `⚠️ خطأ: ${err.message}`);
  }
}

async function handleCallback(cb) {
  await telegram("answerCallbackQuery", { callback_query_id: cb.id });
  const chatId = cb.message?.chat?.id;
  if (!chatId || !isAllowed(chatId)) return;
  if (cb.data?.startsWith("model:")) {
    const session = chatState(chatId);
    session.model = cb.data.slice("model:".length);
    session.messages = [];
    await saveState();
    await sendMessage(chatId, `✅ تم اختيار: \`${session.model}\``, { parse_mode: "Markdown" });
  }
}

async function poll() {
  while (true) {
    try {
      const result = await telegram("getUpdates", {
        timeout: 45,
        offset,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of result.result || []) {
        offset = Math.max(offset, update.update_id + 1);
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (err) {
      console.error("poll error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

console.log("كلودي — CarbonFlow Claude Agent بدأ");
console.log(`Chat مسموح: ${allowedChatId || "الكل"}`);
console.log(`النموذج الافتراضي: ${defaultModel}`);

await telegram("deleteWebhook", { drop_pending_updates: false });
await telegram("setMyCommands", {
  commands: [
    { command: "start",  description: "بدء المحادثة" },
    { command: "status", description: "حالة السيرفر والموقع" },
    { command: "model",  description: "عرض النموذج الحالي" },
    { command: "models", description: "اختيار نموذج Claude" },
    { command: "reset",  description: "مسح سياق المحادثة" },
  ],
});

await poll();
