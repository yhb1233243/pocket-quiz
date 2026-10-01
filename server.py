# -*- coding: utf-8 -*-
"""LAN interview quiz server. Stdlib only."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import socket
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
PROGRESS_PATH = ROOT / "data" / "progress.json"
CURATED_PATH = ROOT / "curated_answers.json"
TOPICS_PATH = ROOT / "topics.json"
STATIC_DIR = ROOT / "static"

SAMPLE_TOPICS = [
    ("Java 语言", [
        ("语言基础", "Java语言.md", "h1", None),
    ]),
    ("计算机基础", [
        ("速记闪卡", "概念闪卡.md", "flashcard", None),
    ]),
]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

progress_lock = threading.Lock()
STATE: dict[str, Any] = {
    "questions": [],
    "topics": [],
    "curated": {},
    "config": {},
    "ai": {},
}


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def auth_token(password: str) -> str:
    return hmac.new(password.encode("utf-8"), b"quiz-auth-v1", hashlib.sha256).hexdigest()


def check_password(cfg: dict, supplied: str) -> bool:
    expect = str(cfg.get("password") or "")
    if not expect:
        return True
    return hmac.compare_digest(str(supplied or ""), expect)


def load_ai_from_opencode(cfg: dict) -> dict:
    ai = dict(cfg.get("ai") or {})

    # Explicit providers list from config: [{"key": "a6:xxx", "baseURL": ..., "model": ...}]
    # No apiKey anywhere — the browser supplies its own key from localStorage.
    explicit = [p for p in (ai.get("providers") or []) if isinstance(p, dict) and p.get("baseURL")]
    if explicit:
        registry = {}
        for p in explicit:
            key = str(p.get("key") or p.get("name") or "discover")
            registry[key] = {
                "baseURL": str(p["baseURL"]).rstrip("/"),
                "model": str(p.get("model") or ""),
            }
        ai["registry"] = registry
        ai["models"] = list(registry.keys())
        default = ai.get("model")
        if default not in registry:
            default = ai["models"][0]
        ai["model"] = default
        return ai

    oc_path = Path(ai.get("opencodeConfig") or "")
    providers: dict[str, dict] = {}
    if oc_path.exists():
        oc = load_json(oc_path, {})
        providers = oc.get("provider") or {}
    provider_name = ai.get("provider") or "a6"

    # Multi-provider registry: {"a6:glm-5.3": {baseURL, apiKey, model}, ...}
    registry: dict[str, dict] = {}

    # Allow-list config to reorder/alias providers (optional, from config.json ai.providers)
    wanted = ai.get("providers") or list(providers.keys())
    for pname in wanted:
        block = providers.get(pname)
        if not block:
            continue
        options = block.get("options") or {}
        base = (options.get("baseURL") or "").rstrip("/")
        key = options.get("apiKey") or ""
        if not base or not key:
            continue
        for mname in (block.get("models") or {}):
            full_key = f"{pname}:{mname}"
            registry[full_key] = {"baseURL": base, "apiKey": key, "model": mname}

    # Backward compat: single provider settings
    block = providers.get(provider_name) or {}
    options = block.get("options") or {}
    if not ai.get("apiKey"):
        ai["apiKey"] = options.get("apiKey") or ""
    if not ai.get("baseURL"):
        ai["baseURL"] = options.get("baseURL") or ""
    models = list((block.get("models") or {}).keys())
    if models and not ai.get("models"):
        ai["models"] = models
    if models and (not ai.get("model") or ai["model"] not in models):
        ai["model"] = models[0]

    ai.setdefault("baseURL", "")
    ai.setdefault("model", "")
    ai.setdefault("models", [])

    # Ensure default single-provider entry exists in registry
    default_key = f"{provider_name}:{ai.get('model')}"
    if registry:
        if default_key not in registry:
            # fall back to first key
            default_key = next(iter(registry))
        ai["model"] = default_key
        ai["models"] = list(registry.keys())
    elif ai.get("model"):
        registry[default_key] = {"baseURL": ai["baseURL"], "apiKey": ai["apiKey"], "model": ai["model"]}
        ai["model"] = default_key
        ai["models"] = [default_key]
    ai["registry"] = registry
    return ai


def split_questions_h1(md_text: str):
    text = re.sub(r"\A---\n.*?\n---\n", "", md_text, flags=re.S)
    parts = re.split(r"(?m)^# (\d+)\. ", text)
    out = []
    for i in range(1, len(parts) - 1, 2):
        num, rest = parts[i], parts[i + 1]
        lines = rest.split("\n")
        title = lines[0].strip()
        body = "\n".join(lines[1:])
        if title:
            out.append((num, title, body))
    return out


def split_questions_h2(md_text: str):
    text = re.sub(r"\A---\n.*?\n---\n", "", md_text, flags=re.S)
    pattern = re.compile(r"^##\s+(\d+)\\?[\-\.、]\s*([^\n\r]+)", re.M)
    matches = list(pattern.finditer(text))
    out = []
    for i, m in enumerate(matches):
        num = m.group(1)
        title = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        out.append((num, title, body))
    return out


def split_questions_flashcards(md_text: str):
    text = re.sub(r"\A---\n.*?\n---\n", "", md_text, flags=re.S)
    lines = text.split("\n")
    out = []
    num = 0
    current_sec = ""
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith("## "):
            current_sec = s[3:].strip()
            continue
        if s.startswith("# "):
            continue
        if "::" in s:
            num += 1
            parts = s.split("::", 1)
            q = parts[0].strip()
            a = parts[1].strip()
            body = f"> **【{current_sec}】**\n\n{a}" if current_sec else a
            out.append((str(num), q, body))
    return out


def rewrite_images(body: str) -> str:
    def repl(m):
        alt, src = m.group(1), m.group(2).strip()
        if src.startswith("http"):
            return m.group(0)
        src = src.replace("\\", "/")
        if src.startswith("./"):
            src = src[2:]
        return f"![{alt}](/media/{src})"

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", repl, body)


def extract_recite(body: str) -> str:
    m = re.search(r"(?im)^#{2,6}\s*(?:\d+(?:[\.\?]\d+)*)?\s*(?:背会|背记|口诀)[：:\s]*\n([\s\S]*?)(?=\n#{2,6}\s|\Z)", body)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return ""


def resolve_path(p) -> Path:
    path = Path(p)
    return path if path.is_absolute() else (ROOT / path)


def load_topics() -> list:
    if TOPICS_PATH.exists():
        data = load_json(TOPICS_PATH, [])
        topics = []
        for t in data or []:
            name = t.get("topic")
            files = [
                (f.get("module"), f.get("file"), f.get("parse", "h1"), f.get("base"))
                for f in (t.get("files") or [])
            ]
            if name and files:
                topics.append((name, files))
        if topics:
            return topics
    return SAMPLE_TOPICS


def load_bank(bank_dir: Path, curated: dict, topics_cfg: list | None = None) -> tuple[list[dict], list[dict]]:
    questions = []
    topic_meta = []
    qid = 0
    for topic, files in (topics_cfg or load_topics()):
        topic_count = 0
        modules = []
        for module, rel, p_type, base_override in files:
            base = resolve_path(base_override) if base_override else bank_dir
            path = base / rel
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            if p_type == "h1":
                items = split_questions_h1(text)
            elif p_type == "h2":
                items = split_questions_h2(text)
            elif p_type == "flashcard":
                items = split_questions_flashcards(text)
            else:
                items = []

            modules.append({"name": module, "count": len(items)})
            topic_count += len(items)
            for num, title, body in items:
                qid += 1
                key = title
                curated_hit = curated.get(key) or curated.get(f"{module}::{title}")
                body = rewrite_images(body.strip())
                questions.append({
                    "id": qid,
                    "topic": topic,
                    "module": module,
                    "num": num,
                    "title": title,
                    "answer": body,
                    "recite": extract_recite(body),
                    "oral": (curated_hit or {}).get("oral") or "",
                    "reason": (curated_hit or {}).get("reason") or "",
                    "pit": (curated_hit or {}).get("pit") or "",
                    "kind": "dsa" if topic == "数据结构与算法" else "theory",
                    "starred_src": bool(curated_hit),
                })
        if topic_count:
            topic_meta.append({"name": topic, "count": topic_count, "modules": modules})
    return questions, topic_meta


def default_progress(n: int) -> dict:
    return {
        "questions": {},
        "session": {
            "mode": "practice",
            "topic": "全部",
            "module": "",
            "filter": "all",
            "index": 0,
            "shuffle": False,
        },
    }


def read_progress(n: int) -> dict:
    with progress_lock:
        data = load_json(PROGRESS_PATH, None)
        if not isinstance(data, dict):
            data = default_progress(n)
        data.setdefault("questions", {})
        data.setdefault("session", default_progress(n)["session"])
        return data


def write_progress(data: dict) -> dict:
    PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with progress_lock:
        PROGRESS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def lan_ips() -> list[str]:
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip not in ips and not ip.startswith("127."):
            ips.insert(0, ip)
    except Exception:
        pass
    return ips


def merge_progress_item(old: dict, patch: dict) -> dict:
    item = dict(old or {})
    for k in ("seen", "mastered", "wrong", "starred", "revealed"):
        if k in patch:
            item[k] = bool(patch[k])
    if patch.get("seen") or patch.get("visit"):
        item["seen"] = True
        item["visits"] = int(item.get("visits") or 0) + 1
        item["lastSeen"] = patch.get("lastSeen") or item.get("lastSeen")
    if "note" in patch:
        item["note"] = patch["note"]
    if "answerAttempts" in patch and isinstance(patch["answerAttempts"], list):
        item["answerAttempts"] = patch["answerAttempts"][-20:]
    for key in ("nextReviewAt", "reviewLevel"):
        if key in patch:
            try:
                item[key] = int(patch[key])
            except (TypeError, ValueError):
                pass
    return item


def summarize_upstream_error(code: int, body: str) -> str:
    text = (body or "").strip()
    if text.startswith("{") or text.startswith("["):
        try:
            obj = json.loads(text)
            if isinstance(obj, dict):
                err = obj.get("error") or obj.get("message") or obj.get("msg")
                if isinstance(err, dict):
                    err = err.get("message") or err.get("code") or json.dumps(err, ensure_ascii=False)
                if err:
                    return f"上游 {code}: {err}"
        except Exception:
            pass
    low = text.lower()
    if "error code: 1010" in low or "error 1010" in low:
        return "上游 Cloudflare 1010：请求被当成爬虫拦截。已自动补浏览器 User-Agent，请刷新后重试；若仍失败，换一个供应商或检查该模型额度。"
    if "just a moment" in low or "attention required" in low or "cf-ray" in low:
        return f"上游 {code}：Cloudflare 拦截了该供应商接口，可先换 a6 模型。"
    snippet = re.sub(r"<[^>]+>", " ", text)
    snippet = re.sub(r"\s+", " ", snippet).strip()[:240]
    return f"上游 {code}: {snippet or '空响应'}"


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _authorized(self) -> bool:
        expect = str(STATE["config"].get("password") or "")
        if not expect:
            return True
        cookies = self.headers.get("Cookie") or ""
        token = auth_token(expect)
        for part in cookies.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "auth_token" and hmac.compare_digest(v, token):
                return True
        return False

    def _reject_auth(self):
        self._json(401, {"error": "unauthorized"})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path in ("/", "/index.html"):
            self._send_file(STATIC_DIR / "index.html")
            return
        if (path.startswith("/api/") or path.startswith("/media/")) and not self._authorized():
            self._reject_auth()
            return
        if path.startswith("/api/"):
            self.handle_api_get(path, parse_qs(parsed.query))
            return
        if path.startswith("/media/"):
            rel = path[len("/media/"):]
            for root in STATE.get("media_roots", []):
                target = (root / rel).resolve()
                if str(target).startswith(str(root.resolve())) and target.is_file():
                    self._send_file(target)
                    return
            self._json(404, {"error": "image not found"})
            return
        static_target = (STATIC_DIR / path.lstrip("/")).resolve()
        if str(static_target).startswith(str(STATIC_DIR.resolve())) and static_target.is_file():
            self._send_file(static_target)
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/login":
            payload = self._read_json()
            pw = str(payload.get("password") or "")
            if check_password(STATE["config"], pw):
                token = auth_token(str(STATE["config"].get("password") or ""))
                self._send(200, b'{"ok": true}', "application/json; charset=utf-8", {
                    "Set-Cookie": f"auth_token={token}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax",
                })
            else:
                self._json(401, {"error": "wrong password"})
            return
        if path == "/api/logout":
            self._send(200, b'{"ok": true}', "application/json; charset=utf-8", {
                "Set-Cookie": "auth_token=; HttpOnly; Path=/; Max-Age=0",
            })
            return
        if not self._authorized():
            self._reject_auth()
            return
        if path == "/api/progress":
            payload = self._read_json()
            data = read_progress(len(STATE["questions"]))
            if "session" in payload and isinstance(payload["session"], dict):
                data["session"].update(payload["session"])
            if "question" in payload and isinstance(payload["question"], dict):
                qid = str(payload["question"].get("id"))
                data["questions"][qid] = merge_progress_item(data["questions"].get(qid, {}), payload["question"])
            if payload.get("reset") == "progress":
                data["questions"] = {}
            write_progress(data)
            self._json(200, data)
            return
        if path == "/api/ai":
            self.handle_ai(self._read_json())
            return
        self._json(404, {"error": "not found"})

    def handle_api_get(self, path: str, qs: dict):
        if path == "/api/meta":
            progress = read_progress(len(STATE["questions"]))
            registry = STATE["ai"].get("registry") or {}
            providers = [
                {"key": k, "baseURL": v.get("baseURL"), "model": v.get("model")}
                for k, v in registry.items()
            ]
            if not providers and STATE["ai"].get("baseURL"):
                providers = [{
                    "key": "discover",
                    "baseURL": STATE["ai"]["baseURL"],
                    "model": "",
                }]
            self._json(200, {
                "topics": STATE["topics"],
                "total": len(STATE["questions"]),
                "models": [p["key"] for p in providers],
                "model": STATE["ai"].get("model"),
                "providers": providers,
                "aiReady": bool(providers),
                "session": progress.get("session"),
            })
            return
        if path == "/api/questions":
            topic = (qs.get("topic") or [""])[0]
            module = (qs.get("module") or [""])[0]
            items = []
            for q in STATE["questions"]:
                if topic and topic not in ("全部", "all") and q["topic"] != topic:
                    continue
                if module and q["module"] != module:
                    continue
                items.append({
                    "id": q["id"],
                    "topic": q["topic"],
                    "module": q["module"],
                    "num": q["num"],
                    "title": q["title"],
                    "kind": q["kind"],
                    "starred_src": q["starred_src"],
                })
            self._json(200, {"items": items, "total": len(items)})
            return
        if path.startswith("/api/question/"):
            try:
                qid = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self._json(400, {"error": "bad id"})
                return
            q = next((x for x in STATE["questions"] if x["id"] == qid), None)
            if not q:
                self._json(404, {"error": "question not found"})
                return
            self._json(200, q)
            return
        if path == "/api/progress":
            self._json(200, read_progress(len(STATE["questions"])))
            return
        self._json(404, {"error": "not found"})

    def handle_ai(self, payload: dict):
        ai = STATE["ai"]
        registry = ai.get("registry") or {}
        qid = payload.get("id")
        q = next((x for x in STATE["questions"] if x["id"] == qid), None)
        user_msg = (payload.get("message") or "").strip()
        history = payload.get("history") or []
        model = payload.get("model") or ai.get("model")
        target = registry.get(model)
        if target is None:
            # tolerate bare model id falling back to default provider
            for k, v in registry.items():
                if k.rsplit(":", 1)[-1] == model:
                    target = v
                    break
        if target is None:
            target = {"baseURL": ai.get("baseURL", "").rstrip("/"), "apiKey": ai.get("apiKey", ""), "model": model}
        if not target.get("apiKey"):
            self._json(500, {"error": "未读取到 API Key，请检查 opencode.json"})
            return
        if not q:
            self._json(404, {"error": "question not found"})
            return

        system = (
            "你是资深技术面试官兼教练。用中文、口语化、分点回答。"
            "优先讲能直接开口的答案，再补原理和追问坑点。"
            "不要编造题库没有的绝对数字；不确定就标明是常见面试口径。"
            "当前题目与参考答案如下，可引用但不要照抄堆砌。\n\n"
            f"专题：{q['topic']} / {q['module']}\n"
            f"题目：{q['title']}\n"
            f"精修口语：{q.get('oral') or '（无）'}\n"
            f"参考答案：\n{q['answer'][:6000]}"
        )
        messages = [{"role": "system", "content": system}]
        for turn in history[-8:]:
            role = turn.get("role")
            content = (turn.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_msg or "请按面试口语给我讲这道题：先开口答案，再原理，再可能的追问。"})

        body = json.dumps({
            "model": target["model"],
            "messages": messages,
            "stream": True,
            "temperature": 0.4,
        }).encode("utf-8")
        req = urllib.request.Request(
            target["baseURL"].rstrip("/") + "/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {target['apiKey']}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream, application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.close_connection = True
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                while True:
                    line = resp.readline()
                    if not line:
                        break
                    self.wfile.write(line)
                    self.wfile.flush()
                self.wfile.flush()
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")
            self._json(e.code, {"error": summarize_upstream_error(e.code, err)})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _send_file(self, path: Path):
        data = path.read_bytes()
        ctype = MIME.get(path.suffix.lower(), "application/octet-stream")
        extra = {}
        if path.suffix.lower() in {".html", ".js", ".css"}:
            extra["Cache-Control"] = "no-store"
        self._send(200, data, ctype, extra)


def main():
    cfg = load_json(CONFIG_PATH, {})
    topics_cfg = load_topics()
    using_sample = not TOPICS_PATH.exists()
    if using_sample:
        bank = ROOT / "bank" / "sample"
    else:
        bank = resolve_path(cfg.get("bank_dir") or "")
        if not bank.exists():
            raise SystemExit(f"题库目录不存在: {bank}")
    curated = load_json(CURATED_PATH, {})
    questions, topics = load_bank(bank, curated, topics_cfg)
    STATE["questions"] = questions
    STATE["topics"] = topics
    STATE["curated"] = curated
    STATE["config"] = cfg
    STATE["ai"] = load_ai_from_opencode(cfg)
    roots = [bank]
    for _, files in topics_cfg:
        for _, _, _, override in files:
            if override:
                r = resolve_path(override)
                if r not in roots:
                    roots.append(r)
    STATE["media_roots"] = roots
    PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PROGRESS_PATH.exists():
        write_progress(default_progress(len(questions)))

    host = cfg.get("host") or "0.0.0.0"
    port = int(cfg.get("port") or 8765)
    httpd = ThreadingHTTPServer((host, port), Handler)
    ips = lan_ips()
    print(f"题库已加载 {len(questions)} 题")
    print(f"本机:  http://127.0.0.1:{port}")
    for ip in ips:
        print(f"局域网: http://{ip}:{port}")
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        httpd.server_close()


if __name__ == "__main__":
    main()
