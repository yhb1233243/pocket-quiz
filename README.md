# Pocket Quiz | 全栈 AI 智能面试突击站 🚀

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Dependencies-Zero%20(Stdlib%20Only)-success?style=for-the-badge" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20JS%20%2B%20CSS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="Vanilla">
  <img src="https://img.shields.io/badge/AI-OpenAI%20%7C%20Qwen%20%7C%20DeepSeek-8A2BE2?style=for-the-badge" alt="AI Ready">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge" alt="License">
</p>

<p align="center">
  <b>面向架构师与高工的次世代私有化面试助手</b><br>
  本地 Markdown 题库驱动 · 真实口头模拟作答 · 艾宾浩斯科学抗遗忘 · AI 架构图解生成 · 局域网跨端无缝协同
</p>

---

## 🌟 为什么选择 Pocket Quiz？

传统刷题网站要么充满广告与付费墙，要么不支持私人题库；普通 Markdown 笔记又缺乏交互感和复习节奏。

**Pocket Quiz** 专为高强度备战技术面试设计：**无需安装任何依赖（零 pip 安装、前端零 node_modules）**，单命令即可启动。不仅能在 PC 端沉浸式背题，更能在手机或平板上通过局域网秒级同频刷题，甚至支持全量内联打包为单个 HTML 文件断网携带。

---

## 🔥 核心特性矩阵

### 🎙️ 1. 真实面试口语模拟（Oral Simulation）
- **告别哑巴背题**：支持直接语音录入作答（支持阿里 Qwen3-ASR 或浏览器原生语音），还原真实面试开口状态。
- **AI 考官精准评估**：从表达流畅度、核心要点命中率、深度原理解析等维度提供即时打分与连环追问预测。
- **历史作答轨迹追踪**：保留历次作答记录与得分演变，肉眼可见自己的表达能力进化。

### 🖼️ 2. AI 架构解析生图（Visual Diagramming）
- **一图胜千言**：接入 GPT Image 2 等前沿视觉模型，一键为抽象枯燥的技术原理生成极简、直观的高清架构图与流程图。
- **本题参考图持久化**：生成满意后一键固化为本题专属参考图，内嵌在答案首部；支持全屏沉浸式灯箱放大查看。
- **在线/离线双重存储**：在线版自动落地服务端并安全防丢，离线版直接写入浏览器 IndexedDB。

### 🧠 3. 艾宾浩斯智能间隔复习（Spaced Repetition）
- **科学抗遗忘曲线**：内置 0 / 1 / 3 / 7 / 14 天智能阶梯复习算法。
- **今日待复习靶向筛选**：根据记忆衰减曲线动态计算今日复习池，精准打击遗忘临界点，背过就不再忘。

### 🤖 4. 全能 AI 助教生态（AI Mentor）
- **动态模型感知**：填入 OpenAI 兼容 Key 后自动探测可用模型列表（DeepSeek、GPT-4o、Claude、Qwen 等自由切换）。
- **结构化解题方案**：自带「🗣️ 面试怎么开口」、「⚡ 核心原理解析」、「⚠️ 易错点与连环追问」、「🎯 核心速记口诀」四大金牌维度。

### 📦 5. 极致工程美学：零依赖与双模态架构
- **极简服务端**：纯 Python 标准库编写（`http.server` + `socketserver`），无任何第三方三方库负担。
- **工业级数据安全**：原子化写入（Atomic Write）与并发事务加锁，防止多端并发与意外断电造成进度丢失。
- **单文件离线版**：一键打包出包含千道题目、百张高清配图、离线数据库的单个独立 HTML 文件，随时随地随身刷。

---

## ⚡ 极速起步

### 1. 本地启动服务
```bash
python server.py
```
终端会输出本机及局域网访问地址：
```text
======================================================================
  Pocket Quiz 已启动 (无访问密码)
  本机访问:   http://127.0.0.1:8765
  局域网访问: http://192.168.x.x:8765 (手机连接同一 Wi-Fi 直接访问)
======================================================================
```
*手机连入同一 Wi-Fi，用浏览器打开局域网地址即可开始移动端刷题。*

### 2. 导出单文件离线版
```bash
python build_static.py
```
将在当前目录生成 `面试刷题-离线版.html`（所有静态资源、题库、图片已全部转为 Base64/内联脚本），双击即可断网运行，进度由 IndexedDB 自动维护。

---

## ⚙️ 接入专属题库

仓库已内置包含 **Java 全技术栈、算法、Python、大模型算法（LLM/微调/LangChain）** 等海量高质量题库。若想挂载你自己的知识库：

1. 复制 `config.example.json` 为 `config.json`，指定题库目录：
```json
{
  "bank_dir": "E:/MyNotes/InterviewQuestions",
  "port": 8765,
  "password": ""
}
```
2. 复制 `topics.example.json` 为 `topics.json`，定制你的专属分类树：
```json
[
  {
    "topic": "系统架构",
    "files": [
      { "module": "高并发与高可用", "file": "分布式架构.md", "parse": "h1" }
    ]
  }
]
```

### 支持的 Markdown 解析策略
- **`parse: "h1"`**：以一级标题 `# 1. 问题` 切割题目。
- **`parse: "h2"`**：以二级标题 `## 1. 问题` 切割题目。
- **`parse: "flashcard"`**：双冒号闪卡模式，`问题::答案`，快速过知识点。

---

## 🛠️ 技术栈与架构设计

```
[ 终端设备: PC / Mac / iPad / iPhone / Android ]
                        │
                        ▼ (HTTP / WebSocket-less REST)
┌────────────────────────────────────────────────────────┐
│               Python 纯原生标准库服务端                  │
│  - ThreadingHTTPServer (多线程高并发)                   │
│  - Atomic Safe Progress Engine (原子化事务持久层)       │
│  - Media & Generated Image Pipeline (静态与生成图管线)  │
└────────────────────────────────────────────────────────┘
          │                                  │
          ▼                                  ▼
┌──────────────────┐               ┌──────────────────┐
│   本地 Markdown   │               │   大语言/图像模型   │
│   Obsidian 题库   │               │   OpenAI / Qwen  │
└──────────────────┘               └──────────────────┘
```

- **后端**：Python 3.10+ 标准库（`http.server`, `threading`, `json`, `pathlib`）
- **前端**：Vanilla HTML5 / Modern CSS (深色极客主题、CSS 变量、弹性响应式) / 原生 ES6+
- **离线存储**：IndexedDB（图片与重型资源） + LocalStorage（配置与轻量会话）

---

## 📜 开源协议

- **软件代码与原创示例题库**：采用 [Apache-2.0 License](LICENSE)。
- **第三方授权题库**：题库版权与授权范围以 [BANK-NOTICE.md](BANK-NOTICE.md) 为准。

---

<p align="center">
  <b>如果这个项目对你的面试突击有所帮助，欢迎点亮右上角的 ⭐️ Star 支持一下！</b>
</p>
