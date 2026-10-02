# -*- coding: utf-8 -*-
"""Build a single-file offline HTML quiz app from the current bank."""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def build():
    cfg = server.load_json(server.CONFIG_PATH, {})
    topics_cfg = server.load_topics()
    if not server.TOPICS_PATH.exists():
        bank = server.ROOT / "bank" / "sample"
    else:
        bank = server.resolve_path(cfg.get("bank_dir") or "")
    curated = server.load_json(server.CURATED_PATH, {})
    questions, topics = server.load_bank(bank, curated, topics_cfg)
    media_roots = [bank]
    for _, files in topics_cfg:
        for _, _, _, override in files:
            if override:
                root = server.resolve_path(override)
                if root not in media_roots:
                    media_roots.append(root)
    ai = server.load_ai_from_opencode(cfg)
    registry = ai.get("registry") or {}

    # Inline /media/ images as data URIs
    media_cache = {}

    def inline_media(m):
        src = m.group(2).strip()
        if not src.startswith("/media/"):
            return m.group(0)
        rel = src[len("/media/"):]
        if rel not in media_cache:
            media_cache[rel] = ""
            for root in media_roots:
                f = root / rel
                if not f.is_file():
                    continue
                try:
                    data = f.read_bytes()
                    ext = f.suffix.lower().lstrip(".")
                    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                            "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}.get(ext, "application/octet-stream")
                    media_cache[rel] = f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
                    break
                except OSError:
                    continue
        tok = media_cache[rel]
        return f"![{m.group(1)}]({tok})" if tok else ""

    slim = []
    for q in questions:
        slim.append({
            "id": q["id"], "topic": q["topic"], "module": q["module"], "num": q["num"],
            "title": q["title"], "answer": q["answer"], "recite": q["recite"],
            "oral": q["oral"], "reason": q["reason"], "pit": q["pit"],
            "starred_src": q["starred_src"],
        })
    for q in slim:
        q["answer"] = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", inline_media, q["answer"])

    ai_conf = [{"key": k, "baseURL": v["baseURL"], "model": v["model"]} for k, v in registry.items()]
    if not ai_conf and ai.get("baseURL"):
        ai_conf.append({"key": "discover", "baseURL": ai["baseURL"].rstrip("/"), "model": ""})
    if not any(c["key"] == ai.get("model") for c in ai_conf) and ai.get("model"):
        ai_conf.insert(0, {"key": ai["model"], "baseURL": ai.get("baseURL", "").rstrip("/"), "model": ai.get("model")})

    data_js = ("window.QUIZ_DATA = " + json.dumps(
        {"topics": topics, "questions": slim}, ensure_ascii=False, separators=(",", ":")) + ";\n"
        "window.QUIZ_AI = " + json.dumps(
            {"default": ai.get("model") or (ai_conf[0]["key"] if ai_conf else ""), "providers": ai_conf},
            ensure_ascii=False, separators=(",", ":")) + ";")

    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    html = TEMPLATE.replace("/*__CSS__*/", css).replace("/*__DATA__*/", data_js)

    out = ROOT / "面试刷题-离线版.html"
    out.write_text(html, encoding="utf-8")
    n_img = sum(1 for v in media_cache.values() if v)
    print(f"OK: {len(slim)} questions, {n_img} images inlined, {len(ai_conf)} AI models, {out.name} = {out.stat().st_size / 1048576:.1f} MB")


TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>面试刷题助手 · 离线版</title>
<meta name="theme-color" content="#090d16">
<style>
/*__CSS__*/
</style>
</head>
<body>
<header class="mobile-navbar">
  <button class="icon-btn" id="btn-open-sidebar" aria-label="打开题库目录与筛选">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
  </button>
  <div class="mobile-title-wrap">
    <span class="m-topic-name" id="m-crumb-topic">Java 核心</span>
    <span class="m-counter-badge" id="m-crumb-counter">1/1</span>
  </div>
  <div class="mobile-nav-tools">
    <button class="m-mode-btn" id="m-toggle-mode" title="点击在刷题和背题模式间切换">
      <span id="m-mode-icon">✍️</span>
      <span id="m-mode-text">刷题</span>
    </button>
    <button class="m-ai-btn" id="btn-open-ai" title="打开 AI 面试官讲解">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7z"/><circle cx="9" cy="14" r="1.5" fill="#0b0f17"/><circle cx="15" cy="14" r="1.5" fill="#0b0f17"/></svg>
      <span>AI</span>
    </button>
  </div>
</header>

<div class="backdrop" id="sidebar-backdrop"></div>
<div class="backdrop" id="ai-backdrop"></div>

<div id="app">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-top">
      <div class="brand">
        <div class="brand-sub">FULLSTACK &amp; AI AGENT</div>
        <h1>面试刷题助手</h1>
        <p id="ai-status">离线版 · 数据在本机</p>
      </div>
      <button class="close-icon-btn mobile-only" id="btn-close-sidebar" aria-label="关闭侧边栏">✕</button>
    </div>
    <div class="sidebar-group">
      <div class="group-title">学习模式</div>
      <div class="mode-segmented" role="tablist">
        <button id="mode-practice" class="active" data-mode="practice">✍️ 刷题模式</button>
        <button id="mode-memorize" data-mode="memorize">📖 背题模式</button>
      </div>
    </div>
    <div class="sidebar-group">
      <div class="group-title">题库范围</div>
      <label class="field-item"><span class="field-label">知识专题</span><select id="topic-select"></select></label>
      <label class="field-item"><span class="field-label">细分模块</span><select id="module-select"></select></label>
      <label class="field-item">
        <span class="field-label">题目筛选</span>
        <select id="filter-select">
          <option value="all">全部题目</option>
          <option value="unseen">未看题目</option>
          <option value="seen">已看题目</option>
          <option value="wrong">✕ 错题 / 不会</option>
          <option value="mastered">✓ 已掌握</option>
          <option value="starred">★ 收藏题目</option>
          <option value="core">🔥 核心必背题</option>
          <option value="due">📅 今天待复习</option>
        </select>
      </label>
      <label class="check-item"><input type="checkbox" id="shuffle"><span>随机乱序出题</span></label>
    </div>
    <div class="sidebar-group">
      <div class="group-title">大模型</div>
      <label class="field-item"><span class="field-label">对话模型</span><select id="model-select"></select></label>
      <select id="m-model-select" hidden></select>
      <div class="ai-key-setting" id="ai-key-setting">
        <div class="ai-key-row">
          <input type="text" id="ai-base-input" placeholder="接口地址（选填）" autocomplete="off" spellcheck="false">
        </div>
        <div class="ai-key-row">
          <input type="password" id="ai-key-input" placeholder="API Key（sk- 开头）" autocomplete="off" spellcheck="false">
          <button type="button" id="ai-key-save">保存</button>
          <button type="button" id="ai-key-clear" title="清除已保存的 Key">清除</button>
        </div>
        <div class="ai-key-status" id="ai-key-status">未配置 Key，AI 助教不可用</div>
      </div>
    </div>
    <div class="sidebar-group">
      <div class="group-title">语音模型</div>
      <div class="ai-key-setting">
        <div class="ai-key-row"><input type="text" id="ai-speech-base-input" placeholder="语音接口地址（留空用上方大模型）" autocomplete="off" spellcheck="false"></div>
        <div class="ai-key-row"><input type="text" id="ai-speech-model-input" placeholder="转写模型，默认 qwen3-asr-flash" autocomplete="off" spellcheck="false"></div>
        <div class="ai-key-row">
          <input type="password" id="ai-speech-key-input" placeholder="语音 API Key（留空用上方）" autocomplete="off" spellcheck="false">
          <button type="button" id="ai-speech-save">保存</button>
          <button type="button" id="ai-speech-clear" title="清除语音配置">清除</button>
        </div>
        <div class="ai-key-status" id="ai-speech-status">留空则转写使用上方大模型的地址和 Key</div>
      </div>
    </div>
    <div class="sidebar-group">
      <div class="group-title">答案图片模型</div>
      <div class="ai-key-setting">
        <div class="ai-key-row"><input type="text" id="ai-image-base-input" placeholder="图片接口地址（如 https://api.openai.com/v1）" autocomplete="off" spellcheck="false"></div>
        <div class="ai-key-row"><input type="text" id="ai-image-model-input" placeholder="图片模型，如 gpt-image-2" autocomplete="off" spellcheck="false"></div>
        <div class="ai-key-row"><input type="password" id="ai-image-key-input" placeholder="图片 API Key（留空用上方）" autocomplete="off" spellcheck="false"><button type="button" id="ai-image-save">保存</button><button type="button" id="ai-image-clear" title="清除图片配置">清除</button></div>
        <div class="ai-key-status" id="ai-image-status">留空则使用上方大模型地址和 Key</div>
      </div>
    </div>
    <div class="sidebar-group">
      <div class="group-title">复习统计</div>
      <div class="stats-box" id="stats"></div>
    </div>
    <button class="danger-outline-btn" id="reset-progress">清空本机刷题进度</button>
  </aside>

  <main class="main" id="main-area">
    <header class="desktop-topbar desktop-only">
      <div class="crumb-text" id="crumb"></div>
      <div class="desktop-top-tools">
        <button class="ghost-btn" id="btn-open-ai-desktop" type="button">🤖 AI 助教</button>
        <button class="ghost-btn" id="jump-prev">上一题</button>
        <button class="ghost-btn" id="jump-next">下一题</button>
      </div>
    </header>
    <div class="top-progress-track"><div class="top-progress-fill" id="bar"></div></div>
    <section class="card question-card" id="question-card">
      <div class="card-header-meta">
        <div class="tag-list">
          <span class="tag-topic" id="tag-topic"></span>
          <span class="tag-module" id="tag-module"></span>
          <span class="tag-core" id="q-core-tag" style="display:none;">核心高频</span>
        </div>
        <span class="question-seq" id="q-meta">1/1</span>
      </div>
      <h2 class="question-title" id="q-title">加载中...</h2>
      <div class="answer-container" id="answer-wrap">
        <div class="oral-answer-box" id="oral-answer-box">
          <div class="oral-answer-head"><div><div class="k">🎙️ 口头作答</div><div class="oral-answer-tip">先用自己的话回答，再让 AI 指出遗漏和表达问题。</div></div><span class="record-time" id="record-time"></span></div>
          <div class="oral-answer-actions"><button type="button" class="record-btn" id="record-btn">🎙 开始录音</button><span class="record-status" id="record-status">最多 3 分钟，不保存原始音频</span></div>
          <textarea id="answer-transcript" class="answer-transcript" rows="5" placeholder="录音转写结果会出现在这里，也可以直接输入或修改…"></textarea>
          <div class="transcript-actions"><button type="button" class="ghost-btn" id="clear-transcript">清空</button><button type="button" class="btn-primary" id="evaluate-answer">提交 AI 评价</button></div>
          <div class="answer-feedback" id="answer-feedback" hidden></div>
        </div>
        <div class="practice-think-box" id="practice-think-box">
          <div class="think-badge">🤔 先思考</div>
          <p class="think-lead">试着在脑中组织 1~2 句核心要点，像在面试现场一样回答。</p>
          <button class="action-reveal-btn" id="reveal-btn">💡 点击揭晓答案</button>
          <span class="think-subtip">也可点击底栏「揭晓答案」或按键盘空格</span>
        </div>
        <article class="answer-content" id="answer"></article>
      </div>
      <div class="desktop-card-actions desktop-only">
        <button id="btn-wrong" class="btn-state state-wrong">✕ 标记不会</button>
        <button id="btn-star" class="btn-state state-star">★ 收藏</button>
        <button id="btn-master" class="btn-state state-master">✓ 掌握</button>
        <button id="btn-next" class="btn-primary">下一题 →</button>
      </div>
      <p class="keyboard-tip desktop-only">快捷键：← 上一题 · → 下一题 · 空格 揭晓 · 1 掌握 · 2 不会 · 3 收藏</p>
    </section>
  </main>

  <nav class="mobile-dock" id="mobile-bottom-bar">
    <button class="dock-btn dock-wrong" id="m-btn-wrong"><span class="dock-icon">✕</span><span class="dock-txt">不会</span></button>
    <button class="dock-btn dock-star" id="m-btn-star"><span class="dock-icon">★</span><span class="dock-txt">收藏</span></button>
    <button class="dock-btn dock-master" id="m-btn-master"><span class="dock-icon">✓</span><span class="dock-txt">掌握</span></button>
    <button class="dock-primary-btn" id="m-btn-next"><span id="m-next-label">下一题</span><span class="dock-arrow">→</span></button>
  </nav>

  <aside class="ai-pane" id="ai-pane">
    <div class="ai-pane-header">
      <div class="ai-header-left">
        <h3>🤖 AI 面试助教</h3>
        <span class="ai-sub">离线版 · 直连 API</span>
      </div>
      <button class="close-icon-btn" id="btn-close-ai" aria-label="关闭 AI 助教">✕</button>
    </div>

    <div class="quick-prompts-row">
      <button data-prompt="请按面试口语讲这道题：先怎么开口，再讲核心原理，最后给 2 个可能追问。">🗣️ 面试口语</button>
      <button data-prompt="请用大白话把这道题讲懂：假设我是完全不懂的新手。禁止堆术语；每个术语第一次出现都先用生活例子解释；多用「打个比方」「你可以把它想成」；先讲它解决什么问题，再讲它怎么工作，最后用 3 句话总结。">💬 大白话讲懂</button>
      <button data-prompt="把这题浓缩为 30 秒能背完的骨架口诀。">⚡ 30秒速记</button>
      <button data-prompt="面试官顺着这道题接下来最可能追问什么？给我标准答法。">🎯 高频追问</button>
      <button data-prompt="对照参考答案，指出这道题最容易踩坑或说错的雷区。">⚠️ 避坑防错</button>
       <button type="button" id="scene-explain">🖼️ 生成答案图</button>
    </div>

    <div id="chat" class="chat-stream-box"></div>

    <form id="chat-form" class="chat-input-bar">
      <textarea id="chat-input" rows="1" placeholder="追问这道题细节...（如：源码底层怎么写的？）"></textarea>
      <button type="submit" id="chat-send-btn">发送</button>
    </form>
  </aside>
</div>

<script>
/*__DATA__*/
</script>
<script>
const $ = (id) => document.getElementById(id);
const LS_KEY = "quiz-offline-progress-v1";
const QUIZ = window.QUIZ_DATA;
const AI = window.QUIZ_AI || { default: "", providers: [] };
const AI_KEY_STORE = "quiz-offline-ai-key-v1";
const AI_BASE_STORE = "quiz-offline-ai-base-v1";
const AI_SPEECH_STORE = "quiz-offline-ai-speech-v1";
const AI_SPEECH_BASE_STORE = "quiz-offline-ai-speech-base-v1";
const AI_SPEECH_KEY_STORE = "quiz-offline-ai-speech-key-v1";
const AI_IMAGE_STORE = "quiz-offline-ai-image-v1";
const AI_IMAGE_BASE_STORE = "quiz-offline-ai-image-base-v1";
const AI_IMAGE_KEY_STORE = "quiz-offline-ai-image-key-v1";
const OFFLINE_MODE = true;

const state = {
  topics: [],
  list: [],
  progress: { questions: {}, session: {} },
  current: null,
  index: 0,
  mode: "practice",
  revealed: false,
  chat: [],
  model: AI.default,
  recorder: null,
  recordChunks: [],
  recordTimer: null,
  evaluating: false,
  imageBusy: false,
};

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function loadList() {
  const topic = $("topic-select").value;
  const module = $("module-select").value;
  state.list = QUIZ.questions.filter((q) =>
    (!topic || topic === "全部" || q.topic === topic) && (!module || q.module === module));
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

function toggleSidebar(open) {
  $("sidebar").classList.toggle("active", open);
  $("sidebar-backdrop").classList.toggle("active", open);
}

function show(i) {
  const pool = filtered();
  if (!pool.length) {
    applyFilterIndex();
    return;
  }
  state.index = (i + pool.length) % pool.length;
  const q = pool[state.index];
  state.current = q;
  state.revealed = state.mode === "memorize" || !!rec(q.id).revealed;
  state.chat = [];
  $("chat").innerHTML = "";
  resetAnswerPanel();

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

  updateButtonStates(q.id);

  const parts = [];
  if (q.oral) parts.push(`<div class="oral"><div class="k">🗣️ 面试怎么开口</div>${md(q.oral)}</div>`);
  if (q.reason) parts.push(`<div class="reason"><div class="k">⚡ 核心原理解析</div>${md(q.reason)}</div>`);
  if (q.pit) parts.push(`<div class="pit"><div class="k">⚠️ 易错点与连环追问</div>${md(q.pit)}</div>`);
  if (q.recite) parts.push(`<div class="reason"><div class="k">🎯 核心速记口诀</div>${md(q.recite)}</div>`);
  parts.push(`<div class="reason"><div class="k">📖 完整考点与源码解析</div>${md(q.answer)}</div>`);
  $("answer").innerHTML = parts.join("");
  renderReferenceImage(q.id);

  const card = $("question-card");
  card.classList.toggle("practice", state.mode === "practice");
  card.classList.toggle("revealed", state.revealed);
  updateMobileNextButton();

  $("main-area").scrollTo({ top: 0, behavior: "smooth" });

  saveProgress({
    session: sessionPayload(q.id),
    question: { id: q.id, visit: true, seen: true, lastSeen: Date.now() },
  });
  renderStats();
}

function updateButtonStates(qid) {
  const r = rec(qid);
  $("btn-wrong").classList.toggle("active-wrong", !!r.wrong);
  $("btn-wrong").textContent = r.wrong ? "✕ 不会 (已标)" : "✕ 标记不会";
  $("btn-master").classList.toggle("active-master", !!r.mastered);
  $("btn-master").textContent = r.mastered ? "✓ 已掌握" : "✓ 掌握";
  $("btn-star").classList.toggle("active-star", !!r.starred);
  $("btn-star").textContent = r.starred ? "★ 已收藏" : "★ 收藏";
  $("m-btn-wrong").classList.toggle("active", !!r.wrong);
  $("m-btn-master").classList.toggle("active", !!r.mastered);
  $("m-btn-star").classList.toggle("active", !!r.starred);
}

function updateMobileNextButton() {
  $("m-next-label").textContent = (state.mode === "practice" && !state.revealed) ? "揭晓答案" : "下一题";
}

function sessionPayload(lastId) {
  return {
    mode: state.mode,
    topic: $("topic-select").value,
    module: $("module-select").value,
    filter: $("filter-select").value,
    shuffle: $("shuffle").checked,
    lastId,
  };
}

function saveProgress(payload) {
  if (payload.session) Object.assign(state.progress.session, payload.session);
  if (payload.question && payload.question.id != null) {
    const qid = String(payload.question.id);
    const cur = state.progress.questions[qid] || {};
    const patch = { ...payload.question };
    delete patch.id;
    for (const k of ["seen", "mastered", "wrong", "starred", "revealed"]) {
      if (k in patch) patch[k] = !!patch[k];
    }
    if (patch.seen) {
      cur.visits = (cur.visits || 0) + 1;
      cur.lastSeen = patch.lastSeen || cur.lastSeen;
    }
    const merged = { ...cur, ...patch, seen: cur.seen || patch.seen };
    if (patch.mastered) merged.wrong = false;
    if (patch.wrong) merged.mastered = false;
    state.progress.questions[qid] = merged;
  }
  if (payload.reset === "progress") {
    state.progress.questions = {};
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.progress));
  } catch (e) {
    console.warn("localStorage 写入失败", e);
  }
}

function setMode(mode) {
  state.mode = mode;
  $("mode-practice").classList.toggle("active", mode === "practice");
  $("mode-memorize").classList.toggle("active", mode === "memorize");
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

function mark(flag) {
  if (!state.current) return;
  const cur = rec(state.current.id);
  const patch = { id: state.current.id, seen: true };
  patch[flag] = !cur[flag];
  saveProgress({ question: patch });
  updateButtonStates(state.current.id);
  renderStats();
}

function initTouchGestures() {
  let sx = 0, sy = 0;
  document.addEventListener("touchstart", (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 55 && Math.abs(dy) < 60) {
      show(dx < 0 ? state.index + 1 : state.index - 1);
    }
  }, { passive: true });
}

// ---------- AI 助教 ----------
function aiApiKey() {
  return localStorage.getItem(AI_KEY_STORE) || "";
}

function aiBaseUrl() {
  return (localStorage.getItem(AI_BASE_STORE) || "").trim().replace(/\/+$/, "");
}

function aiSpeechModel() { return (localStorage.getItem(AI_SPEECH_STORE) || "qwen3-asr-flash").trim(); }
function aiSpeechBaseUrl() { return (localStorage.getItem(AI_SPEECH_BASE_STORE) || "").trim().replace(/\/+$/, ""); }
function aiSpeechKey() { return localStorage.getItem(AI_SPEECH_KEY_STORE) || ""; }
function speechAuth() { return { key: aiSpeechKey() || aiApiKey(), base: aiSpeechBaseUrl() || effectiveBaseURL(providerForModel()) }; }
function updateSpeechUI() { const el = $("ai-speech-status"); const key = aiSpeechKey(); el.classList.toggle("ok", !!key); el.classList.toggle("err", false); if (key) { el.textContent = `语音 Key 已保存：${key.slice(0, 7)}…${key.slice(-4)}`; $("ai-speech-key-input").placeholder = "已配置（输入新值可覆盖）"; } else { el.textContent = "留空则转写使用上方大模型的地址和 Key"; $("ai-speech-key-input").placeholder = "语音 API Key（留空用上方）"; } }
function saveSpeechConfig() { const model = ($("ai-speech-model-input").value || "").trim(); if (model) localStorage.setItem(AI_SPEECH_STORE, model); else localStorage.removeItem(AI_SPEECH_STORE); const base = ($("ai-speech-base-input").value || "").trim().replace(/\/+$/, ""); if (base) localStorage.setItem(AI_SPEECH_BASE_STORE, base); else localStorage.removeItem(AI_SPEECH_BASE_STORE); const key = ($("ai-speech-key-input").value || "").trim().replace(/^["'`\s]+|["'`\s]+$/g, ""); if (key) { localStorage.setItem(AI_SPEECH_KEY_STORE, key); $("ai-speech-key-input").value = ""; } updateSpeechUI(); }
function clearSpeechConfig() { localStorage.removeItem(AI_SPEECH_STORE); localStorage.removeItem(AI_SPEECH_BASE_STORE); localStorage.removeItem(AI_SPEECH_KEY_STORE); $("ai-speech-model-input").value = ""; $("ai-speech-base-input").value = ""; $("ai-speech-key-input").value = ""; updateSpeechUI(); }
function imageModel() { return (localStorage.getItem(AI_IMAGE_STORE) || "gpt-image-2").trim(); }
function imageBaseUrl() { return (localStorage.getItem(AI_IMAGE_BASE_STORE) || "").trim().replace(/\/+$/, ""); }
function imageApiKey() { return localStorage.getItem(AI_IMAGE_KEY_STORE) || aiApiKey(); }
function imageAuth() { return { key: imageApiKey(), base: imageBaseUrl() || effectiveBaseURL(providerForModel()) }; }
function updateImageUI(text) { const el = $("ai-image-status"); const key = localStorage.getItem(AI_IMAGE_KEY_STORE); el.classList.toggle("ok", !!key || !!aiApiKey()); el.classList.toggle("err", false); el.textContent = text || (key ? `图片 Key 已保存：${key.slice(0, 7)}…${key.slice(-4)}` : "留空则使用上方大模型地址和 Key"); }
function saveImageConfig() { const model = ($("ai-image-model-input").value || "").trim(); const base = ($("ai-image-base-input").value || "").trim().replace(/\/+$/, ""); const key = ($("ai-image-key-input").value || "").trim().replace(/^["'`\s]+|["'`\s]+$/g, ""); if (model) localStorage.setItem(AI_IMAGE_STORE, model); else localStorage.removeItem(AI_IMAGE_STORE); if (base) localStorage.setItem(AI_IMAGE_BASE_STORE, base); else localStorage.removeItem(AI_IMAGE_BASE_STORE); if (key) { localStorage.setItem(AI_IMAGE_KEY_STORE, key); $("ai-image-key-input").value = ""; } updateImageUI("✅ 图片模型配置已保存"); }
function clearImageConfig() { localStorage.removeItem(AI_IMAGE_STORE); localStorage.removeItem(AI_IMAGE_BASE_STORE); localStorage.removeItem(AI_IMAGE_KEY_STORE); $("ai-image-model-input").value = ""; $("ai-image-base-input").value = ""; $("ai-image-key-input").value = ""; updateImageUI(); }
function setRecordStatus(text, error = false) { $("record-status").textContent = text; $("record-status").classList.toggle("err", error); }
function resetAnswerPanel() { stopRecording(true); $("answer-transcript").value = ""; $("answer-feedback").hidden = true; $("answer-feedback").innerHTML = ""; $("record-time").textContent = ""; setRecordStatus("最多 3 分钟，不保存原始音频"); $("evaluate-answer").disabled = false; }
function recordingMimeType() { return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ""; }
function updateRecordClock() { if (!state.recordStartedAt) return; const s = Math.floor((Date.now() - state.recordStartedAt) / 1000); $("record-time").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
async function toggleRecording() {
  if (state.recorder) return state.recorder.stop();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setRecordStatus("当前浏览器不支持录音，请直接输入文字", true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = recordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recorder = recorder; state.recordChunks = []; state.discardRecording = false; state.recordStartedAt = Date.now(); $("record-btn").textContent = "⏹ 结束录音"; $("record-btn").classList.add("recording"); setRecordStatus("正在录音…再次点击结束"); state.recordTimer = setInterval(updateRecordClock, 250);
    recorder.ondataavailable = (e) => { if (e.data.size) state.recordChunks.push(e.data); };
    recorder.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); clearInterval(state.recordTimer); state.recordTimer = null; state.recorder = null; $("record-btn").textContent = "🎙 开始录音"; $("record-btn").classList.remove("recording"); const discard = state.discardRecording; const blob = new Blob(state.recordChunks, { type: recorder.mimeType || "audio/webm" }); state.recordChunks = []; state.discardRecording = false; state.recordStartedAt = 0; if (discard) return; if (blob.size) await transcribeAudio(blob); else setRecordStatus("没有录到声音，请重试", true); };
    recorder.onerror = () => setRecordStatus("录音失败，请检查麦克风权限", true); recorder.start(); setTimeout(() => { if (state.recorder === recorder) recorder.stop(); }, 180000);
  } catch { setRecordStatus("无法使用麦克风：请允许浏览器访问麦克风", true); }
}
function stopRecording(silent = false) { if (state.recorder) { if (silent) state.discardRecording = true; state.recorder.stop(); } }
function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); }); }
function responseText(data) { const c = data?.choices?.[0]?.message?.content ?? data?.output?.text ?? data?.output?.output?.sentence?.text ?? ""; return Array.isArray(c) ? c.map((p) => p.text || p.content || "").join("") : String(c || "").trim(); }
async function transcribeAudio(blob) {
  const auth = speechAuth(); const base = auth.base; if (!auth.key || !base) return setRecordStatus("请先保存语音或大模型的接口地址和 API Key", true); setRecordStatus("正在调用阿里语音模型转写…");
  try { const res = await fetch(base + "/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + auth.key, "Content-Type": "application/json" }, body: JSON.stringify({ model: aiSpeechModel(), messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: await blobToDataUrl(blob) } }] }], stream: false, asr_options: { language: "zh", enable_itn: false } }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`); const text = responseText(data); if (!text) throw new Error("语音模型没有返回文字"); $("answer-transcript").value = text; setRecordStatus("转写完成，可以修改文字后提交评价"); } catch (e) { setRecordStatus(`转写失败：${e.message}`, true); }
}
function parseJsonResponse(text) { const c = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim(); try { return JSON.parse(c); } catch {} const m = c.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }
function feedbackHtml(f, raw) { if (!f) return `<div class="feedback-raw">${md(raw || "AI 没有返回有效评价")}</div>`; const list = (a) => Array.isArray(a) && a.length ? `<ul>${a.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "<p>暂无</p>"; return `<div class="feedback-summary"><b>本次判断：${escapeHtml(f.result || "部分掌握")}</b>${f.score != null ? ` · ${escapeHtml(f.score)}/100` : ""}</div><div class="feedback-grid"><div><b>说得好的地方</b>${list(f.covered)}</div><div><b>需要补充</b>${list(f.missing)}</div><div><b>技术问题</b>${list(f.incorrect)}</div><div><b>表达问题</b>${list(f.expression)}</div></div><div class="feedback-next"><b>下一次练习：</b>${escapeHtml(f.nextAction || "重新回答一次，先说结论再补原理")}</div><div class="feedback-result-actions"><button data-answer-result="mastered">✓ 掌握</button><button data-answer-result="partial">△ 部分掌握</button><button data-answer-result="wrong">✕ 还不会</button></div>`; }
async function evaluateAnswer() {
  const answer = $("answer-transcript").value.trim(); if (!answer || !state.current || state.evaluating) return; const prov = providerForModel(); const base = effectiveBaseURL(prov); if (!aiApiKey() || !base) return setRecordStatus("请先填写接口地址并保存 API Key", true); state.evaluating = true; $("evaluate-answer").disabled = true; $("answer-feedback").hidden = false; $("answer-feedback").innerHTML = "<p>AI 正在评价你的回答…</p>"; if (!state.revealed) reveal(); const q = state.current; const prompt = `请评价下面这次面试回答，只返回 JSON，不要 Markdown 代码块。JSON 字段必须是 result（mastered/partial/wrong）、score（0-100）、covered（字符串数组）、missing（字符串数组）、incorrect（字符串数组）、expression（字符串数组）、nextAction（字符串）。不要因为措辞不同而扣分，重点检查技术准确性、关键点覆盖和面试表达。\n题目：${q.title}\n参考答案：${(q.answer || "").slice(0, 6000)}\n用户回答：${answer}`;
  try { const res = await fetch(base + "/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + aiApiKey(), "Content-Type": "application/json" }, body: JSON.stringify({ model: prov?.model || prov?.key || state.model, messages: [{ role: "user", content: prompt }], stream: false, temperature: 0.2 }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`); const raw = responseText(data); const feedback = parseJsonResponse(raw); $("answer-feedback").innerHTML = feedbackHtml(feedback, raw); const attempts = (rec(q.id).answerAttempts || []).slice(); attempts.push({ createdAt: Date.now(), answer, result: feedback?.result || "partial", feedback: feedback || { raw } }); saveProgress({ question: { id: q.id, answerAttempts: attempts } }); } catch (e) { $("answer-feedback").innerHTML = `<p class="feedback-error">评价失败：${escapeHtml(e.message)}</p>`; } finally { state.evaluating = false; $("evaluate-answer").disabled = false; }
}
function saveAnswerResult(result) { if (!state.current) return; const qid = state.current.id, item = rec(qid), attempts = (item.answerAttempts || []).slice(); if (!attempts.length) return; attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], result }; const level = Number(item.reviewLevel || 0), nextLevel = result === "mastered" ? Math.min(level + 1, 4) : result === "partial" ? level : 0, days = [0, 1, 3, 7, 14][nextLevel]; saveProgress({ question: { id: qid, answerAttempts: attempts, reviewLevel: nextLevel, nextReviewAt: Date.now() + days * 86400000, mastered: result === "mastered", wrong: result === "wrong" } }); $("answer-feedback").querySelectorAll("[data-answer-result]").forEach((b) => b.disabled = true); setRecordStatus(`已记录：${result === "mastered" ? "掌握" : result === "partial" ? "部分掌握" : "还不会"}，${days ? `${days} 天后复习` : "今天再练一次"}`); updateButtonStates(qid); renderStats(); }

function refreshKeyStatus(state_, text) {
  const el = $("ai-key-status");
  el.classList.toggle("ok", state_ === "ok");
  el.classList.toggle("err", state_ === "err");
  if (text !== undefined) el.textContent = text;
}

function updateKeyUI() {
  const key = aiApiKey();
  if (!key) {
    refreshKeyStatus("none", "未配置 Key，AI 助教不可用");
    $("ai-key-input").value = "";
    $("ai-key-input").placeholder = "API Key（sk- 开头）";
  } else {
    refreshKeyStatus("ok", `已保存：${key.slice(0, 7)}…${key.slice(-4)}（本机浏览器存储）`);
    $("ai-key-input").placeholder = "已配置（输入新值可覆盖）";
  }
}

function providerForModel(model = state.model) {
  return AI.providers.find((p) => p.key === model) || AI.providers[0] || null;
}

function effectiveBaseURL(prov = providerForModel()) {
  return aiBaseUrl() || (prov && prov.baseURL) || "";
}

function renderModelOptions() {
  for (const id of ["model-select", "m-model-select"]) {
    const select = $(id);
    select.replaceChildren(...AI.providers.map((p) => {
      const option = document.createElement("option");
      option.value = p.key;
      option.textContent = p.key;
      option.selected = p.key === state.model;
      return option;
    }));
  }
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
  if (showStatus) refreshKeyStatus("none", "正在获取模型列表…");
  try {
    const res = await fetch(base.replace(/\/$/, "") + "/models", {
      headers: { "Authorization": "Bearer " + key },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = normalizeModelList(await res.json());
    if (!models.length) throw new Error("接口没有返回模型");
    AI.providers = models.map((model) => ({ key: model, model, baseURL: base }));
    state.model = models.includes(preferredModel) ? preferredModel : models[0];
    renderModelOptions();
    saveProgress({ session: { model: state.model } });
    if (showStatus) refreshKeyStatus("ok", `✅ Key 有效，已获取 ${models.length} 个模型`);
    return true;
  } catch (e) {
    if (showStatus) refreshKeyStatus("err", `❌ 模型列表获取失败：${e.message}`);
    return false;
  }
}

async function saveApiKey() {
  const val = ($("ai-key-input").value || "").trim();
  if (!val) {
    refreshKeyStatus("err", "输入为空。请粘贴 sk- 开头的完整 Key");
    $("ai-key-input").focus();
    return;
  }
  const clean = val.replace(/^["'`\s]+|["'`\s]+$/g, "");
  if (!clean.startsWith("sk-")) {
    refreshKeyStatus("err", "格式可疑：Key 应以 sk- 开头（已按去除首尾引号/空格保存，若仍失败请检查）");
  }
  localStorage.setItem(AI_KEY_STORE, clean);
  $("ai-key-input").value = "";
  const baseVal = ($("ai-base-input").value || "").trim().replace(/\/+$/, "");
  if (baseVal) localStorage.setItem(AI_BASE_STORE, baseVal);
  else localStorage.removeItem(AI_BASE_STORE);
  updateKeyUI();
  addMsg("assistant", "✅ API Key 已保存到本机，可以开始提问了。");
  await refreshModelsFromApi(true);
}

function clearApiKey() {
  localStorage.removeItem(AI_KEY_STORE);
  localStorage.removeItem(AI_BASE_STORE);
  $("ai-key-input").value = "";
  $("ai-base-input").value = "";
  updateKeyUI();
}

async function testApiKey() {
  const key = aiApiKey();
  if (!key) {
    refreshKeyStatus("err", "请先保存 Key 再测试");
    return;
  }
  refreshKeyStatus("none", "测试中…");
  const prov = providerForModel();
  if (!prov && !aiBaseUrl()) {
    refreshKeyStatus("err", "没有可用的 API 配置");
    return;
  }
  try {
    await refreshModelsFromApi(true);
  } catch (e) {
    refreshKeyStatus("err", "❌ 网络错误（手机需联网才能用 AI）");
  }
}

function toggleAI(open) {
  $("ai-pane").classList.toggle("active", open);
  $("ai-backdrop").classList.toggle("active", open);
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

function renderChatMd(el, text) {
  el.innerHTML = md(text);
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
function saveOfflineImage(qid, dataUrl) { return openImageDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").put(dataUrl, String(qid)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); })); }
function loadOfflineImage(qid) { return openImageDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction("images", "readonly"); const req = tx.objectStore("images").get(String(qid)); req.onsuccess = () => resolve(req.result || ""); req.onerror = () => reject(req.error); })); }
function deleteOfflineImage(qid) { return openImageDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").delete(String(qid)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); })); }
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
    await deleteOfflineImage(qid);
    await saveProgress({ question: { id: qid, referenceImage: null, referenceImageAt: null } });
    section.remove();
  } catch (error) {
    alert("删除失败：" + error.message);
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
function imageEndpoint(base) { return /\/images\/generations$/i.test(base) ? base : base + "/images/generations"; }
function extractImageResult(data) {
  const first = data?.data?.[0] || data?.images?.[0] || data?.output?.[0] || data?.result?.[0];
  if (typeof first === "string") return { src: first };
  if (!first || typeof first !== "object") return null;
  const b64 = first.b64_json || first.base64 || first.base64Image || first.image;
  const url = first.url || first.uri || first.image_url;
  if (b64) return { src: String(b64).startsWith("data:") ? String(b64) : `data:image/png;base64,${b64}` };
  return url ? { src: String(url) } : null;
}
function imageToDataUrl(src) {
  if (String(src).startsWith("data:image/")) return Promise.resolve(src);
  return fetch(src).then((res) => { if (!res.ok) throw new Error(`图片下载失败：HTTP ${res.status}`); return res.blob(); }).then((blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }));
}
async function saveGeneratedReference(qid, src, button) {
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const dataUrl = await imageToDataUrl(src);
    await saveOfflineImage(qid, dataUrl);
    await saveProgress({ question: { id: qid, referenceImage: `idb:${qid}`, referenceImageAt: Date.now() } });
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
  if (!auth.key) { updateImageUI("请先配置图片 API Key"); $("ai-image-key-input").focus(); return; }
  if (!auth.base) { updateImageUI("请先填写图片接口地址"); return; }
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
  if (!aiApiKey()) {
    toggleAI(true);
    refreshKeyStatus("err", "请先在下方输入 API Key 并保存，然后再提问");
    $("ai-key-input").focus();
    return;
  }
  const prov = providerForModel();
  const base = effectiveBaseURL(prov);
  const modelName = prov?.model || prov?.key || state.model;
  if (!base) {
    addMsg("user", message);
    addMsg("assistant", "没有可用模型，请先填写接口地址并保存", true);
    return;
  }
  addMsg("user", message);
  const box = addMsg("assistant", "AI 面试导师正在组织思路…");
  const history = state.chat.slice();
  state.chat.push({ role: "user", content: message });

  const system = (
    "你是资深技术面试官兼教练。用中文、口语化、分点回答。" +
    "优先讲能直接开口的答案，再补原理和追问坑点。" +
    "不要编造题库没有的绝对数字；不确定就标明是常见面试口径。" +
    "当前题目与参考答案如下，可引用但不要照抄堆砌。\n\n" +
    `专题：${state.current.topic} / ${state.current.module}\n` +
    `题目：${state.current.title}\n` +
    `精修口语：${state.current.oral || "（无）"}\n` +
    `参考答案：\n${(state.current.answer || "").slice(0, 6000)}`
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

  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + aiApiKey(),
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
      },
      body: JSON.stringify({ model: modelName, messages, stream: true, temperature: 0.4 }),
    });
    if (!res.ok) {
      let msg = "AI 访问失败（HTTP " + res.status + "）";
      try {
        const errObj = await res.json();
        msg = errObj.error?.message || errObj.message || msg;
      } catch {}
      if (/1010/i.test(String(msg))) msg = "Cloudflare 1010：该供应商拦截了请求，请换一个模型重试";
      box.classList.add("err");
      box.textContent = msg;
      return;
    }
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream")) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "（空响应）";
      state.chat.push({ role: "assistant", content: text });
      renderChatMd(box, text);
      return;
    }
    const reader = res.body.getReader();
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
    paint(true);
    state.chat.push({ role: "assistant", content: out });
  } catch (e) {
    box.classList.add("err");
    box.textContent = "网络错误（AI 接口需联网）。手机离线时无法使用 AI 助教，其余功能不受影响。" + String(e);
  }
}

function askApiKey() {
  toggleAI(true);
  $("ai-key-input").focus();
}

async function boot() {
  state.topics = QUIZ.topics || [];
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) state.progress = JSON.parse(saved);
  } catch (e) {}
  if (!state.progress.questions) state.progress.questions = {};
  if (!state.progress.session) state.progress.session = {};

  $("ai-status").textContent = `离线版 · ${QUIZ.questions.length} 题${aiApiKey() ? " · AI 已配置" : ""}`;
  const savedModel = state.progress.session.model;
  if (savedModel) state.model = savedModel;
  renderModelOptions();

  fillTopics();
  const sess = state.progress.session;
  if (sess.topic) $("topic-select").value = sess.topic;
  fillModules();
  if (sess.module) $("module-select").value = sess.module;
  if (sess.filter) $("filter-select").value = sess.filter;
  $("shuffle").checked = !!sess.shuffle;
  state.mode = sess.mode === "memorize" ? "memorize" : "practice";
  setMode(state.mode);

  loadList();
  applyFilterIndex();
  show(state.index);

  $("btn-open-sidebar").onclick = () => toggleSidebar(true);
  $("btn-close-sidebar").onclick = () => toggleSidebar(false);
  $("sidebar-backdrop").onclick = () => toggleSidebar(false);

  $("btn-open-ai").onclick = () => toggleAI(true);
  $("btn-open-ai-desktop").onclick = () => toggleAI(true);
  $("btn-close-ai").onclick = () => toggleAI(false);
  $("ai-backdrop").onclick = () => toggleAI(false);

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
  $("model-select").onchange = (e) => {
    state.model = e.target.value;
    $("m-model-select").value = e.target.value;
    saveProgress({ session: { model: state.model } });
  };
  $("m-model-select").onchange = (e) => {
    state.model = e.target.value;
    $("model-select").value = e.target.value;
    saveProgress({ session: { model: state.model } });
  };

  $("m-toggle-mode").onclick = () => setMode(state.mode === "practice" ? "memorize" : "practice");

  $("topic-select").onchange = () => { fillModules(); loadList(); show(0); toggleSidebar(false); };
  $("module-select").onchange = () => { loadList(); show(0); toggleSidebar(false); };
  $("filter-select").onchange = () => { show(0); toggleSidebar(false); };
  $("shuffle").onchange = () => { loadList(); show(0); };

  $("mode-practice").onclick = () => { setMode("practice"); toggleSidebar(false); };
  $("mode-memorize").onclick = () => { setMode("memorize"); toggleSidebar(false); };

  $("jump-prev").onclick = () => show(state.index - 1);
  $("jump-next").onclick = () => show(state.index + 1);
  $("btn-next").onclick = () => show(state.index + 1);
  $("reveal-btn").onclick = reveal;

  $("m-btn-wrong").onclick = () => mark("wrong");
  $("m-btn-master").onclick = () => mark("mastered");
  $("m-btn-star").onclick = () => mark("starred");
  $("m-btn-next").onclick = () => {
    if (state.mode === "practice" && !state.revealed) reveal();
    else show(state.index + 1);
  };

  $("btn-master").onclick = () => mark("mastered");
  $("btn-wrong").onclick = () => mark("wrong");
  $("btn-star").onclick = () => mark("starred");

  $("reset-progress").onclick = () => {
    if (!confirm("确定要清空本机的刷题记录吗？（题库本身不会删除）")) return;
    saveProgress({ reset: "progress" });
    renderStats();
    show(state.index);
    toggleSidebar(false);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { toggleAI(false); return; }
    if (e.target.matches("textarea, input, select")) return;
    if (e.key === "ArrowRight") show(state.index + 1);
    if (e.key === "ArrowLeft") show(state.index - 1);
    if (e.key === " ") {
      e.preventDefault();
      if (state.mode === "practice" && !state.revealed) reveal();
      else show(state.index + 1);
    }
    if (e.key === "1") mark("mastered");
    if (e.key === "2") mark("wrong");
    if (e.key === "3") mark("starred");
  });

  initTouchGestures();
}

boot().catch((e) => {
  $("q-title").textContent = "页面初始化遇到错误";
  $("answer").textContent = String(e);
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
