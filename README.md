# 面试刷题站（Interview Quiz）

局域网单页面试刷题站：读取本地 Markdown 题库，一题一题刷 / 背，进度落盘，AI 讲解走 OpenAI 兼容接口。纯 Python 标准库，零依赖，前端零构建。

> 仓库包含程序代码、原创示例题库，以及项目维护者确认已获得公开再分发授权的面试题库。题库授权范围与代码许可证分开，详见 [BANK-NOTICE.md](BANK-NOTICE.md)。

## 快速开始

```bat
python server.py
```

本机访问 http://127.0.0.1:8765 ，终端会同时打印局域网地址（手机同一 Wi-Fi 可用）。Windows 防火墙需放行对应端口。

首次运行不需要任何配置：仓库内的 `topics.json` 会加载示例题库、Python/大模型题库和 Java 题库。

## 挂自己的题库

1. 复制 `config.example.json` 为 `config.json`，把 `bank_dir` 指向你的题库目录
2. 复制 `topics.example.json` 为 `topics.json`，描述「专题 → 模块 → 文件」的加载清单

`topics.json` 结构：

```json
[
  {
    "topic": "Java 基础",
    "files": [
      { "module": "语言基础", "file": "Java语言.md", "parse": "h1", "base": null }
    ]
  }
]
```

- `parse: h1` —— 以 `# 1. 题目` 一级标题切题
- `parse: h2` —— 以 `## 1-题目` 二级标题切题
- `parse: flashcard` —— 每行 `问题::答案`，`## 小节名` 作为分类前缀
- `base` —— 该模块题库的独立目录（相对仓库根或绝对路径），为空则用 `config.json` 的 `bank_dir`

答案正文支持图片：`![xx](./img/a.png)` 会被改写为 `/media/img/a.png` 并从题库目录读取。
答案中 `#### 背会` / `#### 口诀` 小节会抽出来作为「背题模式」的精简版。

## 用法

- **刷题**：先看题，按空格或点「显示答案」再揭晓
- **背题**：直接出答案
- **不会 / 掌握 / 收藏**：进度存 `data/progress.json`，下次可筛
- **AI 讲解**：口语讲解、30 秒速记、追问；打开 AI 助教后填写 OpenAI 兼容接口地址和 Key，前端会请求该接口的 `/models`，模型下拉框使用接口返回的实时列表。也可以在 `opencode.json` / `config.json` 中配置服务器兜底地址；项目不会默认选择某个供应商

`config.json` 可加 `"password"` 给整个站套一层访问口令（局域网共享时建议设置）。

## 离线单文件版

```bat
python build_static.py
```

把当前题库 + 前端打包成一个可直接双击打开的 HTML（图片 base64 内联）。

## 目录结构

```
server.py            局域网服务端（stdlib only）
build_static.py      离线单文件打包器
static/              前端单页（HTML/CSS/JS，PWA）
bank/sample/         原创示例题库
bank/python-bagu/    Python 题库
bank/llm-algo/       大模型算法题库
bank/java/           Java、MySQL、框架和中间件题库
curated_answers.json 人工整理答案补充
topics.json          当前公开题库清单
topics.example.json  题库清单示例
config.example.json  配置示例
```

## License

程序代码和原创示例题库使用 Apache-2.0，见 [LICENSE](LICENSE)。已授权题库不自动适用 Apache-2.0，其权利与使用范围以 [BANK-NOTICE.md](BANK-NOTICE.md) 及原始授权为准。
