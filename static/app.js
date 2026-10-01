const $ = (id) => document.getElementById(id);

const AI_KEY_STORE = "quiz-ai-key-v1";
const AI_BASE_STORE = "quiz-ai-base-v1";
const AI_SPEECH_STORE = "quiz-ai-speech-v1";
const AI_SPEECH_BASE_STORE = "quiz-ai-speech-base-v1";
const AI_SPEECH_KEY_STORE = "quiz-ai-speech-key-v1";

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
  stopScenePlayback();
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

function setRecordStatus(text, error = false) {
  const el = $("record-status");
  el.textContent = text;
  el.classList.toggle("err", error);
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

let sceneToken = 0;
let sceneOwner = 0;
let sceneTimer = null;
let sceneBusy = false;

function stopScenePlayback() {
  sceneOwner = 0;
  clearTimeout(sceneTimer);
  sceneTimer = null;
}

function scenePrompt(q) {
  const attempt = rec(q.id).answerAttempts?.slice(-1)[0];
  const feedback = attempt?.feedback || {};
  return `你是 Java 面试教练。请把这道题整理成“答案地图”，帮助用户理解机制并在面试中复述。只返回 JSON，不要 Markdown、代码块或额外文字。
输出格式：
{"type":"process|compare|structure|answer","takeaway":"一句话结论","skeleton":["3到5个答题要点"],"nodes":[{"id":"a","label":"节点名"}],"comparisons":[{"left":"概念A","right":"概念B","difference":"关键区别"}],"steps":[{"title":"步骤名","what":"发生了什么","why":"为什么","condition":"关键条件或例外","visible":["a"],"arrows":[{"from":"a","to":"b","label":"条件"}],"focus":["a"]}],"pitfalls":["易错点"],"followups":[{"question":"追问","answer":"答法"}],"checkQuestion":"自测问题","checkAnswer":"自测答案"}
规则：
1. type 按题目选择：流程用 process，横向区别用 compare，状态/结构变化用 structure，行为题或不适合画图用 answer。
2. 流程/结构题 nodes 放全程复用的 2 到 8 个稳定节点；对比题和行为题 nodes 可为空。id 只用小写字母和数字，label 不超过 12 个汉字。每一步 visible 只写当前出现的节点 id，不能改节点含义。
3. steps 输出 3 到 6 步，每步必须有 title、what、why、condition；what 说明发生了什么，why 说明设计原因，condition 只在确有条件或例外时填写。
4. compare 题必须输出 2 到 4 组 comparisons，每组包含 left、right、difference；不适合画图时不要生成 nodes 或箭头。箭头只表达真实关系或先后顺序，不要为了凑图添加箭头。不要发明参考资料中没有的事实。
5. skeleton 是用户可以直接复述的答题骨架；pitfalls 写最容易说错的点；followups 写 2 个高频追问；checkQuestion 只能检查一个关键条件。
6. 这是面试学习卡，不是装饰性动画。优先保留“为什么、条件、例外、复杂度、输入输出”等信息；不适合画图时仍要输出高质量 answer map，nodes 可以是空数组。
题目：${q.title}
面试口语版：${(q.oral || "（无）").slice(0, 1800)}
原理说明：${(q.reason || "（无）").slice(0, 2200)}
易错点与追问：${(q.pit || "（无）").slice(0, 1800)}
完整参考答案：${(q.answer || "").slice(0, 5000)}
${attempt?.answer ? `用户最近一次回答：${attempt.answer.slice(0, 2200)}` : "用户还没有提交回答。"}
${feedback.missing?.length ? `这次回答遗漏：${feedback.missing.join("；")}` : ""}
${feedback.incorrect?.length ? `这次回答可能有误：${feedback.incorrect.join("；")}` : ""}`;
}

function normalizeScene(data) {
  const cleanId = (id) => String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  const nodeMap = new Map();
  const addNode = (node) => {
    const id = cleanId(typeof node === "string" ? node : node?.id);
    const label = String(typeof node === "string" ? node : node?.label || node?.text || "").trim().slice(0, 12);
    if (id && label && !nodeMap.has(id)) nodeMap.set(id, { id, label });
    return id;
  };
  (Array.isArray(data?.nodes) ? data.nodes : Array.isArray(data?.entities) ? data.entities : []).slice(0, 8).forEach(addNode);
  const rawSteps = Array.isArray(data?.steps) ? data.steps.slice(0, 6) : [];
  rawSteps.forEach((step) => (Array.isArray(step.nodes) ? step.nodes : []).forEach(addNode));
  const nodes = [...nodeMap.values()].slice(0, 8);
  const ids = new Set(nodes.map((node) => node.id));
  const clean = rawSteps.map((step) => {
    const rawVisible = Array.isArray(step.visible) ? step.visible : Array.isArray(step.nodes) ? step.nodes : nodes.map((node) => node.id);
    const visible = rawVisible.map((node) => cleanId(typeof node === "string" ? node : node?.id)).filter((id) => ids.has(id));
    const rawArrows = Array.isArray(step.arrows) ? step.arrows : Array.isArray(step.edges) ? step.edges : [];
    const arrows = rawArrows.map((arrow) => ({
      from: cleanId(arrow.from),
      to: cleanId(arrow.to),
      label: String(arrow.label || "").trim().slice(0, 10),
    })).filter((arrow) => ids.has(arrow.from) && ids.has(arrow.to) && arrow.from !== arrow.to && visible.includes(arrow.from) && visible.includes(arrow.to));
    const rawFocus = Array.isArray(step.focus) ? step.focus : Array.isArray(step.highlight) ? step.highlight : [];
    const focus = rawFocus.map(cleanId).filter((id) => ids.has(id) && visible.includes(id));
    return {
      title: String(step.title || step.say || step.caption || "分步讲解").trim().slice(0, 28),
      what: String(step.what || step.say || "").trim().slice(0, 110),
      why: String(step.why || "").trim().slice(0, 110),
      condition: String(step.condition || "").trim().slice(0, 90),
      visible: [...new Set(visible)], arrows, focus,
    };
  }).filter((step) => step.what && (!nodes.length || step.visible.length >= 1));
  if (clean.length < 2) return null;
  return {
    type: ["process", "compare", "structure", "answer"].includes(data?.type) ? data.type : "process",
    takeaway: String(data?.takeaway || "").trim().slice(0, 180),
    skeleton: Array.isArray(data?.skeleton) ? data.skeleton.map((x) => String(x).trim().slice(0, 100)).filter(Boolean).slice(0, 5) : [],
    comparisons: Array.isArray(data?.comparisons) ? data.comparisons.map((x) => ({ left: String(x?.left || "").trim().slice(0, 80), right: String(x?.right || "").trim().slice(0, 80), difference: String(x?.difference || "").trim().slice(0, 160) })).filter((x) => x.left && x.right && x.difference).slice(0, 4) : [],
    nodes, steps: clean,
    pitfalls: Array.isArray(data?.pitfalls) ? data.pitfalls.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 4) : [],
    followups: Array.isArray(data?.followups) ? data.followups.map((x) => ({ question: String(x?.question || "").trim().slice(0, 100), answer: String(x?.answer || "").trim().slice(0, 160) })).filter((x) => x.question && x.answer).slice(0, 3) : [],
    checkQuestion: String(data?.checkQuestion || "").trim().slice(0, 120),
    checkAnswer: String(data?.checkAnswer || "").trim().slice(0, 180),
  };
}

function mountScene(box, scene) {
  const token = ++sceneToken;
  let index = 0;
  let playing = false;
  const { nodes, steps } = scene;
  const hasDiagram = nodes.length > 0 && ["process", "structure"].includes(scene.type);
  const cols = Math.min(3, nodes.length || 1);
  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const pos = {};
  nodes.forEach((node, i) => { pos[node.id] = { x: 16 + (i % cols) * 104, y: 16 + Math.floor(i / cols) * 72 }; });
  const draw = () => {
    const step = steps[index];
    const condition = step.condition ? `<div class="scene-condition"><b>关键条件：</b>${escapeHtml(step.condition)}</div>` : "";
    box.querySelector(".scene-title").textContent = `${index + 1}. ${step.title}`;
    box.querySelector(".scene-what").textContent = step.what;
    box.querySelector(".scene-why").textContent = step.why ? `为什么：${step.why}` : "";
    box.querySelector(".scene-condition").outerHTML = condition || `<div class="scene-condition" hidden></div>`;
    if (!hasDiagram) return;
    const lines = step.arrows.map((arrow) => {
      const a = pos[arrow.from];
      const b = pos[arrow.to];
      const x1 = a.x + 44;
      const y1 = a.y + 20;
      const x2 = b.x + 44;
      const y2 = b.y + 20;
      const label = arrow.label ? `<text class="scene-arrow-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}">${escapeHtml(arrow.label)}</text>` : "";
      return `<line class="scene-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#scene-arrow-${token})"/>${label}`;
    }).join("");
    const visible = new Set(step.visible);
    const focus = new Set(step.focus.length ? step.focus : step.visible);
    const nodeHtml = nodes.map((node) => {
      const p = pos[node.id];
      const shown = visible.has(node.id);
      const on = focus.has(node.id);
      return `<g class="scene-node${shown ? " visible" : ""}${on ? " on" : ""}"><rect x="${p.x}" y="${p.y}" width="88" height="40" rx="8"/><text x="${p.x + 44}" y="${p.y + 20}">${escapeHtml(node.label)}</text></g>`;
    }).join("");
    box.querySelector(".scene-stage").innerHTML = `<defs><marker id="scene-arrow-${token}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#93c5fd"/></marker></defs>${lines}${nodeHtml}`;
    box.querySelector(".scene-play").textContent = playing ? "暂停" : "播放";
    box.querySelector(".scene-count").textContent = `${index + 1}/${steps.length}`;
  };
  const schedule = () => {
    clearTimeout(sceneTimer);
    if (!playing || sceneOwner !== token) return;
    sceneTimer = setTimeout(() => {
      if (sceneOwner !== token || !playing) return;
      index = (index + 1) % steps.length;
      draw();
      schedule();
    }, 2400);
  };
  box.onclick = (event) => {
    const action = event.target.closest("[data-scene]")?.dataset.scene;
    if (!action) return;
    if (action === "prev") index = (index + steps.length - 1) % steps.length;
    if (action === "next") index = (index + 1) % steps.length;
    if (action === "prev" || action === "next") playing = false;
    if (action === "play") {
      playing = !playing;
      if (playing) sceneOwner = token;
    }
    draw();
    schedule();
  };
  const summary = scene.takeaway ? `<div class="scene-takeaway"><b>一句话结论</b><p>${escapeHtml(scene.takeaway)}</p></div>` : "";
  const skeleton = scene.skeleton.length ? `<div class="scene-skeleton"><b>面试答题骨架</b><ol>${scene.skeleton.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>` : "";
  const pitfalls = scene.pitfalls.length ? `<details class="scene-details"><summary>⚠️ 易错点</summary><ul>${scene.pitfalls.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : "";
  const followups = scene.followups.length ? `<details class="scene-details"><summary>🎯 高频追问</summary>${scene.followups.map((item) => `<div class="scene-followup"><b>${escapeHtml(item.question)}</b><p>${escapeHtml(item.answer)}</p></div>`).join("")}</details>` : "";
  const check = scene.checkQuestion ? `<div class="scene-details scene-check"><b>🧠 自测</b><p>${escapeHtml(scene.checkQuestion)}</p><details><summary>显示参考答案</summary><p class="scene-check-answer">${escapeHtml(scene.checkAnswer || "暂无答案")}</p></details></div>` : "";
  const compare = scene.comparisons.length ? `<div class="scene-comparisons">${scene.comparisons.map((item) => `<div class="scene-compare"><div><b>${escapeHtml(item.left)}</b></div><div><b>${escapeHtml(item.right)}</b></div><p>${escapeHtml(item.difference)}</p></div>`).join("")}</div>` : "";
  const diagram = hasDiagram ? `<svg class="scene-stage" viewBox="0 0 328 ${20 + rows * 72}" role="img" aria-label="答案地图"></svg><div class="scene-controls"><button type="button" data-scene="prev">上一步</button><button type="button" class="scene-play" data-scene="play">播放</button><button type="button" data-scene="next">下一步</button><span class="scene-count"></span></div>` : `<div class="scene-no-diagram">这道题更适合用答题骨架和追问练习，不强行画图。</div>`;
  const stepsHtml = hasDiagram ? `<div class="scene-step"><div class="scene-title"></div><div class="scene-what"></div><div class="scene-why"></div><div class="scene-condition" hidden></div>${diagram}</div>` : `<div class="scene-text-steps">${steps.map((step, i) => `<article class="scene-step"><div class="scene-title">${i + 1}. ${escapeHtml(step.title)}</div><div class="scene-what">${escapeHtml(step.what)}</div>${step.why ? `<div class="scene-why">为什么：${escapeHtml(step.why)}</div>` : ""}${step.condition ? `<div class="scene-condition"><b>关键条件：</b>${escapeHtml(step.condition)}</div>` : ""}</article>`).join("")}</div>`;
  box.innerHTML = `<div class="scene-player">${summary}${skeleton}${stepsHtml}${scene.type === "compare" ? compare : ""}${pitfalls}${followups}${check}</div>`;
  if (hasDiagram) draw();
}

async function explainScene() {
  if (!state.current || sceneBusy) return;
  toggleAI(true);
  if (!aiApiKey()) {
    updateKeyUI("err", "请先在下方输入 API Key 并保存，然后再提问");
    $("ai-key-input").focus();
    return;
  }
  const activeModel = $("m-model-select").value || $("model-select").value || state.model;
  const prov = state.providers.find((p) => p.key === activeModel) || providerForModel(activeModel);
  const base = effectiveBaseURL(prov);
  if (!base) {
    updateKeyUI("err", "请先填写接口地址并保存");
    return;
  }
  sceneBusy = true;
  stopScenePlayback();
  const q = state.current;
   const ask = "生成这道题的答案地图";
  addMsg("user", ask);
  state.chat.push({ role: "user", content: ask });
  const box = addMsg("assistant", "正在生成动态讲解…");
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + aiApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: prov?.model || prov?.key || activeModel,
        messages: [{ role: "user", content: scenePrompt(q) }],
        stream: false,
        temperature: 0.2,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
     const scene = normalizeScene(parseJsonResponse(responseText(data)));
     if (!scene) throw new Error("模型没有返回可播放的答案地图");
     mountScene(box, scene);
     state.chat.push({ role: "assistant", content: "答案地图：" + [scene.takeaway, ...scene.skeleton].filter(Boolean).join("；") });
  } catch (error) {
    box.classList.add("err");
    box.textContent = "动态讲解失败：" + error.message;
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
