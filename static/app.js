const $ = (id) => document.getElementById(id);

const AI_KEY_STORE = "quiz-ai-key-v1";

const state = {
  topics: [],
  list: [],
  progress: { questions: {}, session: {} },
  current: null,
  index: 0,
  mode: "practice",
  revealed: false,
  chat: [],
  model: "",
  providers: [],
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s) {
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '<img src="$1" alt="" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

function md(text) {
  if (!text) return "";
  let s = String(text).replace(/\r\n/g, "\n");
  const fences = [];
  s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = fences.length;
    fences.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code).replace(/\n$/, "")}</code></pre>`);
    return `\n\n%%FENCE${i}%%\n\n`;
  });
  s = escapeHtml(s);
  s = s.replace(/%%FENCE(\d+)%%/g, (_, i) => fences[Number(i)]);

  const lines = s.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("<pre>")) {
      const buf = [line];
      while (i + 1 < lines.length && !buf[buf.length - 1].includes("</pre>")) {
        i++;
        buf.push(lines[i]);
      }
      out.push(buf.join("\n"));
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      const lv = Math.min(hm[1].length, 4);
      const tag = lv <= 2 ? "h3" : "h4";
      out.push(`<${tag}>${inlineMd(hm[2])}</${tag}>`);
      i++;
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(lines[i].replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
        i++;
      }
      const head = rows[0] || [];
      const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c)));
      let html = "<table><thead><tr>" + head.map((c) => `<th>${inlineMd(c)}</th>`).join("") + "</tr></thead><tbody>";
      html += body.map((r) => "<tr>" + r.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>").join("");
      html += "</tbody></table>";
      out.push(html);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\s*[-*•]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (/^\s*&gt;\s?/.test(line)) {
      const quotes = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quotes.push(inlineMd(lines[i].replace(/^\s*&gt;\s?/, "")));
        i++;
      }
      out.push(`<blockquote>${quotes.join("<br>")}</blockquote>`);
      continue;
    }
    const para = [inlineMd(line)];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|&gt;\s?|\|)/.test(lines[i]) && !lines[i].startsWith("<pre>")) {
      para.push(inlineMd(lines[i]));
      i++;
    }
    out.push(`<p>${para.join("<br>")}</p>`);
  }
  return out.join("");
}

function renderChatMd(el, text) {
  el.innerHTML = md(text);
}

function rec(id) {
  return state.progress.questions[String(id)] || {};
}

function filtered() {
  const f = $("filter-select").value;
  return state.list.filter((q) => {
    const r = rec(q.id);
    if (f === "unseen") return !r.seen;
    if (f === "seen") return !!r.seen;
    if (f === "wrong") return !!r.wrong;
    if (f === "mastered") return !!r.mastered;
    if (f === "starred") return !!r.starred;
    if (f === "core") return !!q.starred_src;
    return true;
  });
}

function renderStats() {
  const all = state.list;
  const seen = all.filter((q) => rec(q.id).seen).length;
  const mastered = all.filter((q) => rec(q.id).mastered).length;
  const wrong = all.filter((q) => rec(q.id).wrong).length;
  const starred = all.filter((q) => rec(q.id).starred).length;
  $("stats").innerHTML = `
    <div>范围总题数：<b>${all.length}</b></div>
    <div>已看：<b>${seen}</b> · 掌握：<b>${mastered}</b></div>
    <div>不会/错题：<b>${wrong}</b> · 收藏：<b>${starred}</b></div>
  `;
}

function fillTopics() {
  const sel = $("topic-select");
  sel.innerHTML = `<option value="全部">全部分类</option>` + state.topics.map((t) =>
    `<option value="${t.name}">${t.name}（${t.count}）</option>`
  ).join("");
}

function fillModules() {
  const topic = $("topic-select").value;
  const sel = $("module-select");
  const t = state.topics.find((x) => x.name === topic);
  sel.innerHTML = `<option value="">全部专题</option>` + (t ? t.modules.map((m) =>
    `<option value="${m.name}">${m.name}（${m.count}）</option>`
  ).join("") : "");
}

async function loadList() {
  const topic = $("topic-select").value;
  const module = $("module-select").value;
  const qs = new URLSearchParams({ topic, module });
  const res = await fetch("/api/questions?" + qs);
  const data = await res.json();
  state.list = data.items || [];
  if ($("shuffle").checked) {
    for (let i = state.list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.list[i], state.list[j]] = [state.list[j], state.list[i]];
    }
  }
  renderStats();
}

function applyFilterIndex() {
  const pool = filtered();
  if (!pool.length) {
    state.current = null;
    $("q-title").textContent = "此分类或筛选下暂无题目";
    $("tag-topic").textContent = "空";
    $("tag-module").textContent = "无匹配";
    $("q-core-tag").style.display = "none";
    $("q-meta").textContent = "0/0";
    $("m-crumb-counter").textContent = "0/0";
    $("answer").innerHTML = "";
    $("bar").style.width = "0";
    return pool;
  }
  const lastId = state.progress.session.lastId;
  const found = pool.findIndex((q) => q.id === lastId);
  state.index = found >= 0 ? found : 0;
  return pool;
}

// 侧边栏抽屉显隐
function toggleSidebar(open) {
  const sb = $("sidebar");
  const bd = $("sidebar-backdrop");
  if (open) {
    sb.classList.add("active");
    bd.classList.add("active");
  } else {
    sb.classList.remove("active");
    bd.classList.remove("active");
  }
}

// AI 抽屉面板显隐
function toggleAI(open) {
  const ai = $("ai-pane");
  const bd = $("ai-backdrop");
  if (open) {
    ai.classList.add("active");
    bd.classList.add("active");
  } else {
    ai.classList.remove("active");
    bd.classList.remove("active");
  }
}

async function show(i) {
  const pool = filtered();
  if (!pool.length) {
    applyFilterIndex();
    return;
  }
  state.index = (i + pool.length) % pool.length;
  const brief = pool[state.index];
  const q = await (await fetch("/api/question/" + brief.id)).json();
  state.current = q;
  state.revealed = state.mode === "memorize" || !!rec(q.id).revealed;
  state.chat = [];
  $("chat").innerHTML = "";

  // 题目与元信息
  $("q-title").textContent = q.title;
  $("tag-topic").textContent = q.topic;
  $("tag-module").textContent = q.module;
  $("q-core-tag").style.display = q.starred_src ? "inline-block" : "none";

  const counterStr = `${state.index + 1}/${pool.length}`;
  $("q-meta").textContent = counterStr;
  $("m-crumb-topic").textContent = q.module || q.topic;
  $("m-crumb-counter").textContent = counterStr;
  $("crumb").textContent = `${state.mode === "memorize" ? "📖 背题模式" : "✍️ 刷题模式"} · ${q.topic} · ${q.module}`;
  $("bar").style.width = ((state.index + 1) / pool.length * 100) + "%";

  // 更新各种按钮状态
  updateButtonStates(q.id);

  // 渲染答案各段落
  const parts = [];
  if (q.oral) parts.push(`<div class="oral"><div class="k">🗣️ 面试怎么开口</div>${md(q.oral)}</div>`);
  if (q.reason) parts.push(`<div class="reason"><div class="k">⚡ 核心原理解析</div>${md(q.reason)}</div>`);
  if (q.pit) parts.push(`<div class="pit"><div class="k">⚠️ 易错点与连环追问</div>${md(q.pit)}</div>`);
  if (q.recite) parts.push(`<div class="reason"><div class="k">🎯 核心速记口诀</div>${md(q.recite)}</div>`);
  parts.push(`<div class="reason"><div class="k">📖 完整考点与源码解析</div>${md(q.answer)}</div>`);
  $("answer").innerHTML = parts.join("");

  // 卡片状态样式
  const card = $("question-card");
  card.classList.toggle("practice", state.mode === "practice");
  card.classList.toggle("revealed", state.revealed);
  updateMobileNextButton();

  // 平滑置顶当前题目滚动
  $("main-area").scrollTo({ top: 0, behavior: "smooth" });

  await saveProgress({
    session: sessionPayload(q.id),
    question: { id: q.id, visit: true, lastSeen: Date.now() },
  });
  renderStats();
}

function updateButtonStates(qid) {
  const r = rec(qid);

  // 桌面端状态
  $("btn-wrong").classList.toggle("active-wrong", !!r.wrong);
  $("btn-wrong").textContent = r.wrong ? "✕ 不会 (已标)" : "✕ 标记不会";
  $("btn-master").classList.toggle("active-master", !!r.mastered);
  $("btn-master").textContent = r.mastered ? "✓ 已掌握" : "✓ 掌握";
  $("btn-star").classList.toggle("active-star", !!r.starred);
  $("btn-star").textContent = r.starred ? "★ 已收藏" : "★ 收藏";

  // 移动端状态
  $("m-btn-wrong").classList.toggle("active", !!r.wrong);
  $("m-btn-master").classList.toggle("active", !!r.mastered);
  $("m-btn-star").classList.toggle("active", !!r.starred);
}

function updateMobileNextButton() {
  const nextLabel = $("m-next-label");
  if (state.mode === "practice" && !state.revealed) {
    nextLabel.textContent = "揭晓答案";
  } else {
    nextLabel.textContent = "下一题";
  }
}

function sessionPayload(lastId) {
  return {
    mode: state.mode,
    topic: $("topic-select").value,
    module: $("module-select").value,
    filter: $("filter-select").value,
    shuffle: $("shuffle").checked,
    model: state.model,
    lastId,
  };
}

async function saveProgress(payload) {
  const res = await fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  state.progress = await res.json();
}

function setMode(mode) {
  state.mode = mode;
  $("mode-practice").classList.toggle("active", mode === "practice");
  $("mode-memorize").classList.toggle("active", mode === "memorize");

  // 移动端顶部状态
  const isPractice = mode === "practice";
  $("m-toggle-mode").classList.toggle("active", isPractice);
  $("m-mode-icon").textContent = isPractice ? "✍️" : "📖";
  $("m-mode-text").textContent = isPractice ? "刷题" : "背题";

  if (state.current) {
    state.revealed = mode === "memorize";
    const card = $("question-card");
    card.classList.toggle("practice", isPractice);
    card.classList.toggle("revealed", state.revealed);
    updateMobileNextButton();
    saveProgress({ session: sessionPayload(state.current.id) });
  }
}

function reveal() {
  state.revealed = true;
  $("question-card").classList.add("revealed");
  updateMobileNextButton();
  if (state.current) {
    saveProgress({ question: { id: state.current.id, revealed: true, seen: true } });
  }
}

async function mark(flag) {
  if (!state.current) return;
  const cur = rec(state.current.id);
  const patch = { id: state.current.id, seen: true };
  patch[flag] = !cur[flag];
  if (flag === "mastered" && patch.mastered) patch.wrong = false;
  if (flag === "wrong" && patch.wrong) patch.mastered = false;
  await saveProgress({ question: patch });
  updateButtonStates(state.current.id);
  renderStats();
}

function addMsg(role, text, asMarkdown = false) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (asMarkdown) el.innerHTML = md(text);
  else el.textContent = text;
  $("chat").appendChild(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

function aiApiKey() {
  return localStorage.getItem(AI_KEY_STORE) || "";
}

function updateKeyUI(kind, text) {
  const el = $("ai-key-status");
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
  const key = aiApiKey();
  if (text !== undefined) {
    el.textContent = text;
  } else if (!key) {
    el.textContent = "未配置 Key，AI 助教不可用（Key 只存本机浏览器，服务器不保存）";
  } else {
    el.textContent = `已保存：${key.slice(0, 7)}…${key.slice(-4)}（本机浏览器存储）`;
    $("ai-key-input").placeholder = "已配置（输入新值可覆盖）";
  }
}

function saveApiKey() {
  const val = ($("ai-key-input").value || "").trim();
  if (!val) {
    updateKeyUI("err", "输入为空。请粘贴 sk- 开头的完整 Key");
    $("ai-key-input").focus();
    return;
  }
  const clean = val.replace(/^["'`\s]+|["'`\s]+$/g, "");
  if (!clean.startsWith("sk-")) {
    updateKeyUI("err", "格式可疑：Key 应以 sk- 开头（已保存，若仍失败请检查是否复制完整）");
  }
  localStorage.setItem(AI_KEY_STORE, clean);
  $("ai-key-input").value = "";
  updateKeyUI();
}

function clearApiKey() {
  localStorage.removeItem(AI_KEY_STORE);
  $("ai-key-input").value = "";
  $("ai-key-input").placeholder = "API Key（sk- 开头）";
  updateKeyUI();
}

async function testApiKey() {
  const key = aiApiKey();
  if (!key) {
    updateKeyUI("err", "请先保存 Key 再测试");
    return;
  }
  updateKeyUI("none", "测试中…");
  const prov = state.providers.find((p) => p.key === state.model) || state.providers[0];
  if (!prov) {
    updateKeyUI("err", "没有可用模型");
    return;
  }
  try {
    const res = await fetch(prov.baseURL + "/models", { headers: { "Authorization": "Bearer " + key } });
    if (res.ok) updateKeyUI("ok", `✅ Key 有效（${prov.key} 可用）`);
    else if (res.status === 401) updateKeyUI("err", "❌ Key 无效或已过期（401）");
    else updateKeyUI("err", `❌ HTTP ${res.status}，可能是网络或供应商问题`);
  } catch (e) {
    updateKeyUI("err", "❌ 网络错误，请检查本机能否访问外网");
  }
}

async function askAI(message) {
  if (!state.current) return;
  toggleAI(true);
  if (!aiApiKey()) {
    updateKeyUI("err", "请先在下方输入 API Key 并保存，然后再提问");
    $("ai-key-input").focus();
    return;
  }
  addMsg("user", message);
  const box = addMsg("assistant", "AI 面试导师正在组织思路…");
  const history = state.chat.slice();
  state.chat.push({ role: "user", content: message });
  const activeModel = $("m-model-select").value || $("model-select").value || state.model;
  const prov = state.providers.find((p) => p.key === activeModel) || state.providers[0];
  if (!prov || !prov.baseURL) {
    box.classList.add("err");
    box.textContent = "没有可用模型，请刷新页面重试";
    return;
  }

  const q = state.current;
  const system = (
    "你是资深技术面试官兼教练。用中文、口语化、分点回答。" +
    "优先讲能直接开口的答案，再补原理和追问坑点。" +
    "不要编造题库没有的绝对数字；不确定就标明是常见面试口径。" +
    "当前题目与参考答案如下，可引用但不要照抄堆砌。\n\n" +
    `专题：${q.topic} / ${q.module}\n` +
    `题目：${q.title}\n` +
    `精修口语：${q.oral || "（无）"}\n` +
    `参考答案：\n${(q.answer || "").slice(0, 6000)}`
  );
  const messages = [{ role: "system", content: system }];
  for (const turn of history.slice(-8)) {
    const role = turn.role;
    const content = (turn.content || "").trim();
    if ((role === "user" || role === "assistant") && content) {
      messages.push({ role, content });
    }
  }
  messages.push({ role: "user", content: message || "请按面试口语给我讲这道题：先开口答案，再原理，再可能的追问。" });

  const tryFetch = async () => {
    try {
      return { ok: true, res: await fetch(prov.baseURL + "/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + aiApiKey(),
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
        },
        body: JSON.stringify({ model: prov.model, messages, stream: true, temperature: 0.4 }),
      }) };
    } catch (e) {
      return { ok: false, err: e };
    }
  };

  let { ok, res, err } = await tryFetch();
  if (!ok) {
    box.textContent = "连接中断，正在自动重试…";
    await new Promise((r) => setTimeout(r, 1200));
    ({ ok, res, err } = await tryFetch());
    if (!ok) {
      box.classList.add("err");
      box.textContent = "网络错误（本机需能访问外网 API）。" + String(err);
      return;
    }
  }
  try {
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || (!ctype.includes("text/event-stream") && !ctype.includes("application/json"))) {
      const raw = await res.text();
      let msg = res.statusText;
      try {
        const errObj = JSON.parse(raw);
        msg = errObj.error?.message || errObj.message || msg;
      } catch {
        if (/error code:\s*1010/i.test(raw)) msg = "Cloudflare 1010：该供应商把请求当成爬虫拦截了，请换模型或刷新后重试";
        else if (raw) msg = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
      }
      box.classList.add("err");
      box.textContent = msg || "AI 访问失败，请检查 API Key";
      return;
    }
    let stream = res;
    if (!ctype.includes("text/event-stream")) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "（空响应）";
      state.chat.push({ role: "assistant", content: text });
      renderChatMd(box, text);
      return;
    }
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    let lastPaint = 0;
    const paint = (force = false) => {
      const now = Date.now();
      if (!force && now - lastPaint < 50) return;
      lastPaint = now;
      renderChatMd(box, out);
      $("chat").scrollTop = $("chat").scrollHeight;
    };
    box.innerHTML = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const piece = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
          if (piece) {
            out += piece;
            paint();
          }
        } catch {}
      }
    }
    if (!out) box.textContent = "AI 没有返回文字，请重试";
    else paint(true);
    state.chat.push({ role: "assistant", content: out });
  } catch (e) {
    box.classList.add("err");
    box.textContent = "请求出错: " + String(e);
  }
}

// 触控手势滑动切题
function initTouchGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  const area = $("main-area");

  area.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  area.addEventListener("touchend", (e) => {
    if (e.target.closest("textarea, select, button, input")) return;
    const deltaX = e.changedTouches[0].screenX - touchStartX;
    const deltaY = e.changedTouches[0].screenY - touchStartY;
    // 水平划动阈值 55px，垂直位移 < 60px
    if (Math.abs(deltaX) > 55 && Math.abs(deltaY) < 60) {
      if (deltaX < 0) {
        // 向左滑动 -> 下一题
        show(state.index + 1);
      } else {
        // 向右滑动 -> 上一题
        show(state.index - 1);
      }
    }
  }, { passive: true });
}

function showLogin() {
  $("login-overlay").hidden = false;
  $("login-password").focus();
}

async function tryLogin(e) {
  e.preventDefault();
  const pw = $("login-password").value;
  $("login-err").hidden = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      location.reload();
      return;
    }
  } catch {}
  $("login-err").hidden = false;
}

async function boot() {
  $("login-form").onsubmit = tryLogin;
  const metaRes = await fetch("/api/meta");
  if (metaRes.status === 401) {
    showLogin();
    return;
  }
  const meta = await metaRes.json();
  const progress = await fetch("/api/progress").then((r) => r.json());
  state.topics = meta.topics || [];
  state.progress = progress;
  state.providers = meta.providers || [];
  state.model = meta.model || "";

  $("ai-status").textContent = `✅ ${state.providers.length} 个模型 · ${meta.total} 题`;

  // 填充桌面和移动端模型选择器
  const savedModel = (progress.session || {}).model;
  if (savedModel && state.providers.some((p) => p.key === savedModel)) {
    state.model = savedModel;
  }
  const modelOptions = state.providers.map((p) =>
    `<option value="${p.key}" ${p.key === state.model ? "selected" : ""}>${p.key}</option>`
  ).join("");
  $("model-select").innerHTML = modelOptions;
  $("m-model-select").innerHTML = modelOptions;

  fillTopics();
  const sess = progress.session || {};
  if (sess.topic) $("topic-select").value = sess.topic;
  fillModules();
  if (sess.module) $("module-select").value = sess.module;
  if (sess.filter) $("filter-select").value = sess.filter;
  $("shuffle").checked = !!sess.shuffle;
  state.mode = sess.mode === "memorize" ? "memorize" : "practice";
  setMode(state.mode);

  await loadList();
  applyFilterIndex();
  await show(state.index);

  // 抽屉与遮罩绑定
  $("btn-open-sidebar").onclick = () => toggleSidebar(true);
  $("btn-close-sidebar").onclick = () => toggleSidebar(false);
  $("sidebar-backdrop").onclick = () => toggleSidebar(false);

  $("btn-open-ai").onclick = () => toggleAI(true);
  $("btn-close-ai").onclick = () => toggleAI(false);
  $("ai-backdrop").onclick = () => toggleAI(false);

  // Key 设置
  $("ai-key-save").onclick = () => saveApiKey();
  $("ai-key-clear").onclick = () => clearApiKey();
  $("ai-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveApiKey(); }
  });
  $("ai-key-status").onclick = () => testApiKey();
  $("ai-key-status").style.cursor = "pointer";
  $("ai-key-status").title = "点击测试 Key 是否有效";
  updateKeyUI();

  // 移动端顶部模式切换
  $("m-toggle-mode").onclick = () => {
    setMode(state.mode === "practice" ? "memorize" : "practice");
  };

  // 分类与筛选变更
  $("topic-select").onchange = async () => {
    fillModules();
    await loadList();
    await show(0);
    toggleSidebar(false);
  };
  $("module-select").onchange = async () => {
    await loadList();
    await show(0);
    toggleSidebar(false);
  };
  $("filter-select").onchange = async () => {
    await show(0);
    toggleSidebar(false);
  };
  $("shuffle").onchange = async () => {
    await loadList();
    await show(0);
  };

  // 模式切换
  $("mode-practice").onclick = () => { setMode("practice"); toggleSidebar(false); };
  $("mode-memorize").onclick = () => { setMode("memorize"); toggleSidebar(false); };

  // 切题与揭晓
  $("jump-prev").onclick = () => show(state.index - 1);
  $("jump-next").onclick = () => show(state.index + 1);
  $("btn-next").onclick = () => show(state.index + 1);
  $("reveal-btn").onclick = reveal;

  // 移动端底部按钮
  $("m-btn-wrong").onclick = () => mark("wrong");
  $("m-btn-master").onclick = () => mark("mastered");
  $("m-btn-star").onclick = () => mark("starred");
  $("m-btn-next").onclick = () => {
    if (state.mode === "practice" && !state.revealed) {
      reveal();
    } else {
      show(state.index + 1);
    }
  };

  // 桌面端卡片按钮
  $("btn-master").onclick = () => mark("mastered");
  $("btn-wrong").onclick = () => mark("wrong");
  $("btn-star").onclick = () => mark("starred");

  // 清空记录
  $("reset-progress").onclick = async () => {
    if (!confirm("确定要清空本地的刷题记录吗？（题库本身不会删除）")) return;
    await saveProgress({ reset: "progress" });
    renderStats();
    await show(state.index);
    toggleSidebar(false);
  };

  // AI 问答表单
  $("chat-form").onsubmit = (e) => {
    e.preventDefault();
    const msg = $("chat-input").value.trim();
    if (!msg) return;
    $("chat-input").value = "";
    askAI(msg);
  };

  document.querySelectorAll(".quick-prompts-row button").forEach((btn) => {
    btn.onclick = () => askAI(btn.dataset.prompt);
  });

  // 模型选择器同步并持久化
  $("model-select").onchange = (e) => {
    state.model = e.target.value;
    $("m-model-select").value = e.target.value;
    saveProgress({ session: sessionPayload(state.current ? state.current.id : null) });
  };
  $("m-model-select").onchange = (e) => {
    state.model = e.target.value;
    $("model-select").value = e.target.value;
    saveProgress({ session: sessionPayload(state.current ? state.current.id : null) });
  };

  // 键盘快捷键 (针对桌面和外接键盘)
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("textarea, input, select")) return;
    if (e.key === "ArrowRight") show(state.index + 1);
    if (e.key === "ArrowLeft") show(state.index - 1);
    if (e.key === " ") {
      e.preventDefault();
      if (state.mode === "practice" && !state.revealed) {
        reveal();
      } else {
        show(state.index + 1);
      }
    }
    if (e.key === "1") mark("mastered");
    if (e.key === "2") mark("wrong");
    if (e.key === "3") mark("starred");
  });

  // 初始化手势
  initTouchGestures();
}

boot().catch((e) => {
  $("q-title").textContent = "页面初始化遇到错误";
  $("answer").textContent = String(e);
});
