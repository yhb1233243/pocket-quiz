const $ = (id) => document.getElementById(id);

const AI_KEY_STORE = "quiz-ai-key-v1";
const AI_BASE_STORE = "quiz-ai-base-v1";
const AI_SPEECH_STORE = "quiz-ai-speech-v1";
const AI_SPEECH_BASE_STORE = "quiz-ai-speech-base-v1";
const AI_SPEECH_KEY_STORE = "quiz-ai-speech-key-v1";
const AI_IMAGE_STORE = "quiz-ai-image-v1";
const AI_IMAGE_BASE_STORE = "quiz-ai-image-base-v1";
const AI_IMAGE_KEY_STORE = "quiz-ai-image-key-v1";
const ORAL_ANSWER_STORE = "quiz-oral-answer-v1";
const OFFLINE_MODE = false;

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
  recorder: null,
  recordChunks: [],
  recordStartedAt: 0,
  recordTimer: null,
  evaluating: false,
  imageBusy: false,
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
    if (f === "due") return dueReview(r);
    return true;
  });
}

function dueReview(item) {
  const at = Number(item.nextReviewAt || 0);
  return at > 0 && at <= Date.now();
}

function renderStats() {
  const all = state.list;
  const due = all.filter((q) => dueReview(rec(q.id))).length;
  const seen = all.filter((q) => rec(q.id).seen).length;
  const mastered = all.filter((q) => rec(q.id).mastered).length;
  const wrong = all.filter((q) => rec(q.id).wrong).length;
  const starred = all.filter((q) => rec(q.id).starred).length;
  $("stats").innerHTML = `
    <div>范围总题数：<b>${all.length}</b></div>
    <div>已看：<b>${seen}</b> · 掌握：<b>${mastered}</b></div>
    <div>不会/错题：<b>${wrong}</b> · 收藏：<b>${starred}</b></div>
    <div>今天待复习：<b>${due}</b></div>
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

// 设置弹窗显隐
function toggleSettings(open) {
  $("settings-overlay").hidden = !open;
  if (open) {
    toggleSidebar(false);
    toggleAI(false);
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
  resetAnswerPanel();

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
  renderReferenceImage(q.id);

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

function referenceImageSrc(ref) {
  if (typeof ref === "string") return ref;
  return ref?.src || ref?.url || ref?.dataUrl || "";
}

function safeImageSrc(src) {
  return /^(data:image\/(?:png|jpeg|webp);base64,|https?:\/\/|\/media\/)/i.test(String(src || "")) ? String(src) : "";
}

let lightboxEl = null;
function openLightbox(src) {
  if (!lightboxEl) {
    lightboxEl = document.createElement("div");
    lightboxEl.className = "image-lightbox";
    lightboxEl.innerHTML = '<img alt="大图预览">';
    lightboxEl.addEventListener("click", () => lightboxEl.classList.remove("open"));
    document.body.appendChild(lightboxEl);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") lightboxEl.classList.remove("open"); });
  }
  lightboxEl.querySelector("img").src = src;
  lightboxEl.classList.add("open");
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("quiz-reference-images-v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("images");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveOfflineImage(qid, dataUrl) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").put(dataUrl, String(qid)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
async function loadOfflineImage(qid) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => { const tx = db.transaction("images", "readonly"); const req = tx.objectStore("images").get(String(qid)); req.onsuccess = () => resolve(req.result || ""); req.onerror = () => reject(req.error); });
}
function deleteOfflineImage(qid) {
  return openImageDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").delete(String(qid)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }));
}
async function resolveReferenceImage(ref, qid) {
  const raw = referenceImageSrc(ref);
  return raw === `idb:${qid}` ? loadOfflineImage(qid).catch(() => "") : raw;
}

async function renderReferenceImage(qid) {
  const ref = rec(qid).referenceImage;
  if (!ref) return;
  const src = safeImageSrc(await resolveReferenceImage(ref, qid));
  if (!src || state.current?.id !== qid) return;
  $("answer").insertAdjacentHTML("afterbegin", `<section class="answer-reference-image"><div class="answer-reference-title"><span>🖼️ 已保存的答案参考图</span><button type="button" class="reference-image-remove" data-remove-image>移除</button></div><img src="${escapeHtml(src)}" alt="这道题的答案参考图" loading="lazy"></section>`);
  $("answer").querySelector("[data-remove-image]").onclick = removeReferenceImage;
  $("answer").querySelector(".answer-reference-image img").onclick = (event) => openLightbox(event.currentTarget.src);
}

async function removeReferenceImage(event) {
  const section = event.currentTarget.closest(".answer-reference-image");
  const qid = state.current?.id;
  if (section == null || qid == null) return;
  if (!confirm("确定删除这道题已保存的参考图吗？")) return;
  try {
    if (OFFLINE_MODE) await deleteOfflineImage(qid);
    await saveProgress({ question: { id: qid, referenceImage: null, referenceImageAt: null } });
    section.remove();
  } catch (error) {
    alert("删除失败：" + error.message);
  }
}

function aiApiKey() {
  return localStorage.getItem(AI_KEY_STORE) || "";
}

function aiBaseUrl() {
  return (localStorage.getItem(AI_BASE_STORE) || "").trim().replace(/\/+$/, "");
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

function aiSpeechModel() {
  return (localStorage.getItem(AI_SPEECH_STORE) || "qwen3-asr-flash").trim();
}

function aiSpeechBaseUrl() {
  return (localStorage.getItem(AI_SPEECH_BASE_STORE) || "").trim().replace(/\/+$/, "");
}

function aiSpeechKey() {
  return localStorage.getItem(AI_SPEECH_KEY_STORE) || "";
}

function speechAuth() {
  return {
    key: aiSpeechKey() || aiApiKey(),
    base: aiSpeechBaseUrl() || effectiveBaseURL(providerForModel()),
  };
}

function updateSpeechUI() {
  const el = $("ai-speech-status");
  const key = aiSpeechKey();
  el.classList.toggle("ok", !!key);
  el.classList.toggle("err", false);
  if (key) {
    el.textContent = `语音 Key 已保存：${key.slice(0, 7)}…${key.slice(-4)}`;
    $("ai-speech-key-input").placeholder = "已配置（输入新值可覆盖）";
  } else {
    el.textContent = "留空则转写使用上方大模型的地址和 Key";
    $("ai-speech-key-input").placeholder = "语音 API Key（留空用上方）";
  }
}

function saveSpeechConfig() {
  const model = ($("ai-speech-model-input").value || "").trim();
  if (model) localStorage.setItem(AI_SPEECH_STORE, model);
  else localStorage.removeItem(AI_SPEECH_STORE);
  const base = ($("ai-speech-base-input").value || "").trim().replace(/\/+$/, "");
  if (base) localStorage.setItem(AI_SPEECH_BASE_STORE, base);
  else localStorage.removeItem(AI_SPEECH_BASE_STORE);
  const key = ($("ai-speech-key-input").value || "").trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
  if (key) {
    localStorage.setItem(AI_SPEECH_KEY_STORE, key);
    $("ai-speech-key-input").value = "";
  }
  updateSpeechUI();
}

function clearSpeechConfig() {
  localStorage.removeItem(AI_SPEECH_STORE);
  localStorage.removeItem(AI_SPEECH_BASE_STORE);
  localStorage.removeItem(AI_SPEECH_KEY_STORE);
  $("ai-speech-model-input").value = "";
  $("ai-speech-base-input").value = "";
  $("ai-speech-key-input").value = "";
  updateSpeechUI();
}

function imageModel() { return (localStorage.getItem(AI_IMAGE_STORE) || "gpt-image-2").trim(); }
function imageBaseUrl() { return (localStorage.getItem(AI_IMAGE_BASE_STORE) || "").trim().replace(/\/+$/, ""); }
function imageApiKey() { return localStorage.getItem(AI_IMAGE_KEY_STORE) || aiApiKey(); }
function imageAuth() { return { key: imageApiKey(), base: imageBaseUrl() || effectiveBaseURL(providerForModel()) }; }
function updateImageUI(text) {
  const el = $("ai-image-status");
  const key = localStorage.getItem(AI_IMAGE_KEY_STORE);
  el.classList.toggle("ok", !!key || !!aiApiKey());
  el.classList.toggle("err", false);
  el.textContent = text || (key ? `图片 Key 已保存：${key.slice(0, 7)}…${key.slice(-4)}` : "留空则使用上方大模型地址和 Key");
}
function saveImageConfig() {
  const model = ($("ai-image-model-input").value || "").trim();
  const base = ($("ai-image-base-input").value || "").trim().replace(/\/+$/, "");
  const key = ($("ai-image-key-input").value || "").trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
  if (model) localStorage.setItem(AI_IMAGE_STORE, model); else localStorage.removeItem(AI_IMAGE_STORE);
  if (base) localStorage.setItem(AI_IMAGE_BASE_STORE, base); else localStorage.removeItem(AI_IMAGE_BASE_STORE);
  if (key) { localStorage.setItem(AI_IMAGE_KEY_STORE, key); $("ai-image-key-input").value = ""; }
  updateImageUI("✅ 图片模型配置已保存");
}
function clearImageConfig() {
  localStorage.removeItem(AI_IMAGE_STORE); localStorage.removeItem(AI_IMAGE_BASE_STORE); localStorage.removeItem(AI_IMAGE_KEY_STORE);
  $("ai-image-model-input").value = ""; $("ai-image-base-input").value = ""; $("ai-image-key-input").value = ""; updateImageUI();
}

function setRecordStatus(text, error = false) {
  const el = $("record-status");
  el.textContent = text;
  el.classList.toggle("err", error);
}

function oralAnswerEnabled() {
  return (localStorage.getItem(ORAL_ANSWER_STORE) ?? "1") !== "0";
}

function applyOralAnswerSetting() {
  const enabled = oralAnswerEnabled();
  document.body.classList.toggle("oral-off", !enabled);
  const toggle = $("oral-answer-toggle");
  if (toggle) toggle.checked = enabled;
}

function resetAnswerPanel() {
  stopRecording(true);
  $("answer-transcript").value = "";
  $("answer-feedback").hidden = true;
  $("answer-feedback").innerHTML = "";
  $("record-time").textContent = "";
  setRecordStatus("最多 3 分钟，不保存原始音频");
  $("evaluate-answer").disabled = false;
}

function recordingMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function updateRecordClock() {
  if (!state.recordStartedAt) return;
  const seconds = Math.floor((Date.now() - state.recordStartedAt) / 1000);
  $("record-time").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function toggleRecording() {
  if (state.recorder) {
    state.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setRecordStatus("当前浏览器不支持录音，请直接输入文字", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = recordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recorder = recorder;
    state.recordChunks = [];
    state.discardRecording = false;
    state.recordStartedAt = Date.now();
    $("record-btn").textContent = "⏹ 结束录音";
    $("record-btn").classList.add("recording");
    setRecordStatus("正在录音…再次点击结束");
    state.recordTimer = setInterval(updateRecordClock, 250);
    recorder.ondataavailable = (event) => { if (event.data.size) state.recordChunks.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(state.recordTimer);
      state.recordTimer = null;
      state.recorder = null;
      $("record-btn").textContent = "🎙 开始录音";
      $("record-btn").classList.remove("recording");
      const discard = state.discardRecording;
      const blob = new Blob(state.recordChunks, { type: recorder.mimeType || "audio/webm" });
      state.recordChunks = [];
      state.discardRecording = false;
      state.recordStartedAt = 0;
      if (discard) return;
      if (!blob.size) return setRecordStatus("没有录到声音，请重试", true);
      await transcribeAudio(blob);
    };
    recorder.onerror = () => setRecordStatus("录音失败，请检查麦克风权限", true);
    recorder.start();
    setTimeout(() => { if (state.recorder === recorder) recorder.stop(); }, 180000);
  } catch (error) {
    setRecordStatus("无法使用麦克风：请允许浏览器访问麦克风", true);
  }
}

function stopRecording(silent = false) {
  if (!state.recorder) return;
  if (silent) state.discardRecording = true;
  state.recorder.stop();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function responseText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.output?.text ?? data?.output?.output?.sentence?.text ?? "";
  if (Array.isArray(content)) return content.map((part) => part.text || part.content || "").join("");
  return String(content || "").trim();
}

async function transcribeAudio(blob) {
  const { key, base } = speechAuth();
  if (!key || !base) {
    setRecordStatus("请先保存语音或大模型的接口地址和 API Key", true);
    return;
  }
  setRecordStatus("正在调用阿里语音模型转写…");
  try {
    const dataUrl = await blobToDataUrl(blob);
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiSpeechModel(),
        messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: dataUrl } }] }],
        stream: false,
        asr_options: { language: "zh", enable_itn: false },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
    const text = responseText(data);
    if (!text) throw new Error("语音模型没有返回文字");
    $("answer-transcript").value = text;
    setRecordStatus("转写完成，可以修改文字后提交评价");
  } catch (error) {
    setRecordStatus(`转写失败：${error.message}`, true);
  }
}

function parseJsonResponse(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) : null; } catch { return null; }
}

function feedbackHtml(feedback, raw) {
  if (!feedback) return `<div class="feedback-raw">${md(raw || "AI 没有返回有效评价")}</div>`;
  const list = (items) => Array.isArray(items) && items.length ? `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "<p>暂无</p>";
  return `<div class="feedback-summary"><b>本次判断：${escapeHtml(feedback.result || "部分掌握")}</b>${feedback.score != null ? ` · ${escapeHtml(feedback.score)}/100` : ""}</div>` +
    `<div class="feedback-grid"><div><b>说得好的地方</b>${list(feedback.covered)}</div><div><b>需要补充</b>${list(feedback.missing)}</div><div><b>技术问题</b>${list(feedback.incorrect)}</div><div><b>表达问题</b>${list(feedback.expression)}</div></div>` +
    `<div class="feedback-next"><b>下一次练习：</b>${escapeHtml(feedback.nextAction || "重新回答一次，先说结论再补原理")}</div>` +
    `<div class="feedback-result-actions"><button data-answer-result="mastered">✓ 掌握</button><button data-answer-result="partial">△ 部分掌握</button><button data-answer-result="wrong">✕ 还不会</button></div>`;
}

async function evaluateAnswer() {
  const answer = $("answer-transcript").value.trim();
  if (!answer || !state.current || state.evaluating) return;
  if (!aiApiKey()) { toggleAI(true); updateKeyUI("err", "请先保存 API Key"); return; }
  const prov = providerForModel();
  const base = effectiveBaseURL(prov);
  if (!base) { setRecordStatus("请先填写接口地址并保存", true); return; }
  state.evaluating = true;
  $("evaluate-answer").disabled = true;
  $("answer-feedback").hidden = false;
  $("answer-feedback").innerHTML = "<p>AI 正在评价你的回答…</p>";
  if (!state.revealed) reveal();
  const q = state.current;
  const prompt = `请评价下面这次面试回答，只返回 JSON，不要 Markdown 代码块。JSON 字段必须是 result（mastered/partial/wrong）、score（0-100）、covered（字符串数组）、missing（字符串数组）、incorrect（字符串数组）、expression（字符串数组）、nextAction（字符串）。不要因为措辞不同而扣分，重点检查技术准确性、关键点覆盖和面试表达。\n题目：${q.title}\n参考答案：${(q.answer || "").slice(0, 6000)}\n用户回答：${answer}`;
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + aiApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: prov?.model || prov?.key || state.model, messages: [{ role: "user", content: prompt }], stream: false, temperature: 0.2 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
    const raw = responseText(data);
    const feedback = parseJsonResponse(raw);
    $("answer-feedback").innerHTML = feedbackHtml(feedback, raw);
    const attempts = (rec(q.id).answerAttempts || []).slice();
    attempts.push({ createdAt: Date.now(), answer, result: feedback?.result || "partial", feedback: feedback || { raw } });
    await saveProgress({ question: { id: q.id, answerAttempts: attempts } });
  } catch (error) {
    $("answer-feedback").innerHTML = `<p class="feedback-error">评价失败：${escapeHtml(error.message)}</p>`;
  } finally {
    state.evaluating = false;
    $("evaluate-answer").disabled = false;
  }
}

async function saveAnswerResult(result) {
  if (!state.current) return;
  const qid = state.current.id;
  const item = rec(qid);
  const attempts = (item.answerAttempts || []).slice();
  if (!attempts.length) return;
  const last = { ...attempts[attempts.length - 1], result };
  attempts[attempts.length - 1] = last;
  const level = Number(item.reviewLevel || 0);
  const nextLevel = result === "mastered" ? Math.min(level + 1, 4) : result === "partial" ? level : 0;
  const days = [0, 1, 3, 7, 14][nextLevel];
  await saveProgress({ question: { id: qid, answerAttempts: attempts, reviewLevel: nextLevel, nextReviewAt: Date.now() + days * 86400000, mastered: result === "mastered", wrong: result === "wrong" } });
  $("answer-feedback").querySelectorAll("[data-answer-result]").forEach((button) => button.disabled = true);
  setRecordStatus(`已记录：${result === "mastered" ? "掌握" : result === "partial" ? "部分掌握" : "还不会"}，${days ? `${days} 天后复习` : "今天再练一次"}`);
  updateButtonStates(qid);
  renderStats();
}

function providerForModel(model = state.model) {
  return state.providers.find((p) => p.key === model) || state.providers[0] || null;
}

function effectiveBaseURL(prov = providerForModel()) {
  return aiBaseUrl() || (prov && prov.baseURL) || "";
}

function renderModelOptions() {
  for (const id of ["model-select", "m-model-select"]) {
    const select = $(id);
    select.replaceChildren(...state.providers.map((p) => {
      const option = document.createElement("option");
      option.value = p.key;
      option.textContent = p.key;
      option.selected = p.key === state.model;
      return option;
    }));
  }
  const ready = state.providers.filter((p) => p.model).length;
  $("ai-status").textContent = ready
    ? `✅ ${ready} 个模型`
    : "⏳ 保存 Key 后获取模型列表";
}

function normalizeModelList(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data || payload?.models || payload?.result || [];
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object") return "";
    return String(item.id || item.name || item.model || "").trim();
  }).filter(Boolean))];
}

async function refreshModelsFromApi(showStatus = false, preferredModel = state.model) {
  const key = aiApiKey();
  const base = aiBaseUrl() || providerForModel()?.baseURL;
  if (!key || !base) return false;
  if (showStatus) updateKeyUI("none", "正在获取模型列表…");
  try {
    const res = await fetch(base.replace(/\/$/, "") + "/models", {
      headers: { "Authorization": "Bearer " + key },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = normalizeModelList(await res.json());
    if (!models.length) throw new Error("接口没有返回模型");
    state.providers = models.map((model) => ({ key: model, model, baseURL: base }));
    state.model = models.includes(preferredModel) ? preferredModel : models[0];
    renderModelOptions();
    await saveProgress({ session: { model: state.model } });
    if (showStatus) updateKeyUI("ok", `✅ Key 有效，已获取 ${models.length} 个模型`);
    return true;
  } catch (e) {
    if (showStatus) updateKeyUI("err", `❌ 模型列表获取失败：${e.message}`);
    return false;
  }
}

async function saveApiKey() {
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
  const baseVal = ($("ai-base-input").value || "").trim().replace(/\/+$/, "");
  if (baseVal) localStorage.setItem(AI_BASE_STORE, baseVal);
  else localStorage.removeItem(AI_BASE_STORE);
  updateKeyUI();
  await refreshModelsFromApi(true);
}

function clearApiKey() {
  localStorage.removeItem(AI_KEY_STORE);
  localStorage.removeItem(AI_BASE_STORE);
  $("ai-key-input").value = "";
  $("ai-base-input").value = "";
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
  const prov = providerForModel();
  if (!prov) {
    updateKeyUI("err", "没有可用模型");
    return;
  }
  try {
    await refreshModelsFromApi(true);
  } catch (e) {
    updateKeyUI("err", "❌ 网络错误，请检查本机能否访问外网");
  }
}

let sceneBusy = false;


function imagePrompt(q) {
  return `Create a high-quality educational technical diagram for a Chinese Java backend interview question.
Use simplified Chinese labels only. Explain the mechanism visually, not as a poster full of paragraphs.
Use clear modules, arrows, containers, timelines or data structures when relevant. Keep labels short and legible.
Prefer a clean dark technical documentation style, high contrast, generous spacing, no decorative characters, no watermark, no English unless it is an unavoidable API/class name.
The image must be simple and easy to understand at a glance: prioritize clarity over completeness, use the fewest elements needed, large readable text, and leave nothing that requires puzzling out.
The image must be useful as an answer reference: show the key flow, why it works, important conditions or exceptions, and the main comparison if the question compares concepts.
Question: ${q.title}
Interview answer: ${(q.answer || "").slice(0, 7000)}
Interview oral version: ${(q.oral || "").slice(0, 1800)}
Core principle: ${(q.reason || "").slice(0, 2200)}
Pitfalls: ${(q.pit || "").slice(0, 1800)}`;
}

function imageEndpoint(base) {
  return /\/images\/generations$/i.test(base) ? base : base + "/images/generations";
}

function extractImageResult(data) {
  const first = data?.data?.[0] || data?.images?.[0] || data?.output?.[0] || data?.result?.[0];
  if (typeof first === "string") return { src: first };
  if (!first || typeof first !== "object") return null;
  const b64 = first.b64_json || first.base64 || first.base64Image || first.image;
  const url = first.url || first.uri || first.image_url;
  if (b64) return { src: String(b64).startsWith("data:") ? String(b64) : `data:image/png;base64,${b64}` };
  return url ? { src: String(url) } : null;
}

async function imageToDataUrl(src) {
  if (String(src).startsWith("data:image/")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`图片下载失败：HTTP ${res.status}`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(res.blob());
  });
}

async function saveGeneratedReference(qid, src, button) {
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const dataUrl = await imageToDataUrl(src);
    let reference;
    if (OFFLINE_MODE) {
      await saveOfflineImage(qid, dataUrl);
      reference = `idb:${qid}`;
    } else {
      const res = await fetch("/api/generated-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: qid, dataUrl }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      reference = data.url;
    }
    await saveProgress({ question: { id: qid, referenceImage: reference, referenceImageAt: Date.now() } });
    button.textContent = "✅ 已保存为本题参考图";
    button.classList.add("saved");
    if (state.current?.id === qid) renderReferenceImage(qid);
  } catch (error) {
    button.disabled = false;
    button.textContent = `保存失败：${error.message}`;
  }
}

function mountGeneratedImage(box, image, qid) {
  const src = safeImageSrc(image.src);
  if (!src) throw new Error("图片接口没有返回可用图片");
  box.innerHTML = `<div class="image-generation-card"><div class="image-generation-title">🖼️ 答案参考图预览</div><img class="generated-answer-image" src="${escapeHtml(src)}" alt="AI 生成的答案参考图"><p class="image-generation-tip">确认图片中的技术结构和文字无误后，再保存为本题答案参考。</p><div class="image-generation-actions"><button type="button" class="btn-primary" data-image-save>保存为本题参考图</button><button type="button" class="ghost-btn" data-image-regenerate>重新生成</button></div></div>`;
  box.querySelector("[data-image-save]").onclick = (event) => saveGeneratedReference(qid, image.src, event.currentTarget);
  box.querySelector("[data-image-regenerate]").onclick = () => explainScene();
  box.querySelector(".generated-answer-image").onclick = (event) => openLightbox(event.currentTarget.src);
}

async function explainScene() {
  if (!state.current || sceneBusy) return;
  toggleAI(true);
  const auth = imageAuth();
  if (!auth.key) {
    updateImageUI("请先配置图片 API Key");
    $("ai-image-key-input").focus();
    return;
  }
  if (!auth.base) {
    updateImageUI("请先填写图片接口地址");
    return;
  }
  sceneBusy = true;
  const q = state.current;
  const ask = "生成这道题的答案参考图";
  addMsg("user", ask);
  state.chat.push({ role: "user", content: ask });
  const box = addMsg("assistant", "正在生成答案参考图…");
  try {
    const res = await fetch(imageEndpoint(auth.base), {
      method: "POST",
      headers: { "Authorization": "Bearer " + auth.key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: imageModel(), prompt: imagePrompt(q), size: "1536x1024", quality: "high", response_format: "b64_json" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
    const image = extractImageResult(data);
    if (!image) throw new Error("图片接口没有返回图片，请把 GPT Image 2 的返回示例发给我");
    mountGeneratedImage(box, image, q.id);
    state.chat.push({ role: "assistant", content: "已生成答案参考图，等待确认保存。" });
  } catch (error) {
    box.classList.add("err");
    box.textContent = "答案图生成失败：" + error.message;
  } finally {
    sceneBusy = false;
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
  const prov = state.providers.find((p) => p.key === activeModel) || providerForModel(activeModel);
  const base = effectiveBaseURL(prov);
  if (!base) {
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

  const modelName = prov?.model || prov?.key || activeModel;
  const tryFetch = async () => {
    try {
      return { ok: true, res: await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + aiApiKey(),
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
        },
        body: JSON.stringify({ model: modelName, messages, stream: true, temperature: 0.4 }),
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

  $("ai-status").textContent = state.providers.some((p) => p.model)
    ? `✅ ${state.providers.length} 个模型 · ${meta.total} 题`
    : `⏳ 保存 Key 获取模型列表 · ${meta.total} 题`;

  // 填充桌面和移动端模型选择器
  const savedModel = (progress.session || {}).model;
  if (savedModel) state.model = savedModel;
  renderModelOptions();

  fillTopics();
  const sess = progress.session || {};
  if (sess.topic) $("topic-select").value = sess.topic;
  fillModules();
  if (sess.module) $("module-select").value = sess.module;
  if (sess.filter) $("filter-select").value = sess.filter;
  $("shuffle").checked = !!sess.shuffle;
  applyOralAnswerSetting();
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
  $("btn-open-ai-desktop").onclick = () => toggleAI(true);
  $("btn-close-ai").onclick = () => toggleAI(false);
  $("ai-backdrop").onclick = () => toggleAI(false);

  // 设置弹窗
  $("btn-open-settings").onclick = () => toggleSettings(true);
  $("btn-close-settings").onclick = () => toggleSettings(false);
  $("settings-overlay").addEventListener("mousedown", (e) => {
    if (e.target === $("settings-overlay")) toggleSettings(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("settings-overlay").hidden) toggleSettings(false);
  });

  // 口头作答开关
  $("oral-answer-toggle").onchange = (e) => {
    localStorage.setItem(ORAL_ANSWER_STORE, e.target.checked ? "1" : "0");
    if (!e.target.checked) stopRecording(true);
    applyOralAnswerSetting();
  };

  // Key 设置
  $("ai-key-save").onclick = () => saveApiKey();
  $("ai-key-clear").onclick = () => clearApiKey();
  $("ai-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveApiKey(); }
  });
  $("ai-speech-model-input").value = localStorage.getItem(AI_SPEECH_STORE) || "";
  $("ai-speech-base-input").value = aiSpeechBaseUrl();
  $("ai-speech-save").onclick = saveSpeechConfig;
  $("ai-speech-clear").onclick = clearSpeechConfig;
  $("ai-speech-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveSpeechConfig(); }
  });
  updateSpeechUI();
  $("ai-image-model-input").value = localStorage.getItem(AI_IMAGE_STORE) || "";
  $("ai-image-base-input").value = imageBaseUrl();
  $("ai-image-save").onclick = saveImageConfig;
  $("ai-image-clear").onclick = clearImageConfig;
  $("ai-image-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveImageConfig(); }
  });
  updateImageUI();
  $("record-btn").onclick = toggleRecording;
  $("clear-transcript").onclick = () => { $("answer-transcript").value = ""; $("answer-feedback").hidden = true; };
  $("evaluate-answer").onclick = evaluateAnswer;
  $("answer-feedback").onclick = (e) => {
    const result = e.target.closest("[data-answer-result]")?.dataset.answerResult;
    if (result) saveAnswerResult(result);
  };
  $("ai-key-status").onclick = () => testApiKey();
  $("ai-key-status").style.cursor = "pointer";
  $("ai-key-status").title = "点击测试 Key 是否有效";
  $("ai-base-input").value = aiBaseUrl();
  updateKeyUI();
  if (aiApiKey()) refreshModelsFromApi();

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
    if (btn.dataset.prompt) btn.onclick = () => askAI(btn.dataset.prompt);
  });
  $("scene-explain").onclick = explainScene;

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
    if (e.key === "Escape") { toggleAI(false); return; }
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
