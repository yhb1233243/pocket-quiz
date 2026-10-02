# Pocket Quiz

## AI 驱动的本地化技术面试训练工具

Pocket Quiz 是一个面向 Java、Python、大模型与后端开发者的面试训练站。

它把本地 Markdown 题库变成一个可以真正“刷起来”的学习系统：你可以逐题作答、口头模拟面试、让 AI 分析答案、记录掌握情况，并按照复习节奏重新巩固薄弱知识点。

项目运行在自己的电脑上，支持手机通过局域网访问，也可以打包成单个 HTML 文件离线使用。

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/Dependencies-None-2ea44f?style=flat-square" alt="No dependencies">
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JavaScript">
  <img src="https://img.shields.io/badge/License-Apache%202.0-2563eb?style=flat-square" alt="Apache 2.0">
</p>

## 适合谁

- 正在准备 Java 后端、架构师或全栈开发岗位面试的人
- 想把 Obsidian、Markdown 或个人笔记变成可交互题库的人
- 希望练习“开口回答”，而不是只看答案的人
- 需要在电脑和手机之间切换学习设备的人
- 不想安装 Node.js、数据库或一堆第三方依赖的人

## 核心能力

### 1. 从本地 Markdown 题库开始

题库文件放在本地，项目负责解析和展示。内置支持：

- Java 核心语法、集合、并发、JVM、MySQL、Redis、Kafka、Spring 等
- 数据结构与算法
- Python 与大模型算法相关题目
- 自己维护的 Markdown 题库

支持三种常用题目格式：

- `h1`：以 `# 1. 题目` 切分
- `h2`：以 `## 1. 题目` 切分
- `flashcard`：使用 `问题::答案` 创建闪卡

答案中的本地图片也可以直接展示；`#### 背会` 或 `#### 口诀` 内容会作为精简版答案，用于背题模式。

### 2. 面试模式与背题模式

- **刷题模式**：先看问题，自己思考或作答后再查看答案
- **背题模式**：直接显示结构化答案，快速过一遍知识点
- **不会、掌握、收藏**：给题目添加状态，后续按条件筛选
- **今日待复习**：只查看当前需要复习的题目

### 3. 口头作答与 AI 评价

可以直接在浏览器中录音作答，再将回答交给 AI 进行分析。AI 助教可以帮助整理：

- 面试时应该如何开口
- 核心原理和关键流程
- 易错点与可能的追问
- 适合短时间复习的速记版本

AI 接口采用 OpenAI 兼容协议，可以在页面中配置接口地址、API Key 和模型。项目不会强制绑定某一家模型服务。

### 4. AI 生成答案参考图

对于 JVM、并发、Redis、消息队列、分布式等适合图解的题目，可以调用图像模型生成答案参考图。

使用流程：

1. 在“答案图片模型”中填写图片接口和模型
2. 点击“生成答案图”
3. 预览图片，确认后保存为本题参考图
4. 在答案区域查看，点击图片可放大

在线版的图片保存在 `data/generated/`，离线版使用浏览器 IndexedDB 保存。

### 5. 间隔复习

项目会记录每道题的学习状态，并按照 `0 / 1 / 3 / 7 / 14` 天的复习间隔安排后续复习，帮助把“看过”变成“记住”。

### 6. 在线与离线两种方式

**在线版**适合电脑和手机协同使用：

- Python 标准库启动，无需安装第三方依赖
- 同一 Wi-Fi 下手机可以直接访问
- 进度和生成图片保存在服务端
- 支持本地 Markdown 图片和题库

**离线版**适合没有网络时使用：

- 一条命令生成单个 HTML 文件
- 题库和图片会内嵌到文件中
- 双击即可打开，不需要启动服务器
- 进度和参考图保存在浏览器本地

## 快速开始

### 启动在线版

```bash
python server.py
```

打开终端打印的地址：

```text
本机：   http://127.0.0.1:8765
局域网： http://192.168.x.x:8765
```

手机和电脑连接同一个 Wi-Fi 后，使用手机浏览器打开局域网地址即可。

如果 Windows 防火墙弹出提示，请允许 Python 在当前网络中通信。

### 生成离线版

```bash
python build_static.py
```

命令会生成 `面试刷题-离线版.html`，双击即可使用。

## 接入自己的题库

复制配置文件：

```bash
copy config.example.json config.json
copy topics.example.json topics.json
```

在 `config.json` 中指定题库目录：

```json
{
  "bank_dir": "E:/MyNotes/InterviewQuestions",
  "port": 8765,
  "password": ""
}
```

在 `topics.json` 中配置专题、模块和文件：

```json
[
  {
    "topic": "Java 基础",
    "files": [
      {
        "module": "语言基础",
        "file": "Java语言.md",
        "parse": "h1"
      }
    ]
  }
]
```

如果通过局域网分享，建议在 `config.json` 中设置 `password`。

## 项目结构

```text
server.py            在线版服务端
build_static.py      离线单文件打包器
static/              前端页面、样式与脚本
bank/                示例题库与公开题库
topics.json          当前加载的题库清单
config.example.json  服务端配置示例
curated_answers.json 人工整理的答案补充
data/                运行时进度与生成图片，不提交到 Git
```

## 技术栈

- Python 标准库：`http.server`、`socketserver`、`threading`、`json`、`pathlib`
- 原生 HTML、CSS、JavaScript，无前端构建流程
- Markdown 题库解析与本地媒体服务
- LocalStorage 保存配置，IndexedDB 保存离线图片
- OpenAI 兼容接口：文本模型、语音模型与图像模型

## 题库与许可证

程序代码与原创示例题库使用 Apache-2.0，详见 [LICENSE](LICENSE)。

仓库中的部分题库属于已确认获得公开再分发授权的内容，题库授权范围与代码许可证分开，详见 [BANK-NOTICE.md](BANK-NOTICE.md)。

如果 Pocket Quiz 对你的面试准备有帮助，欢迎 Star、反馈问题或贡献题库格式改进。
