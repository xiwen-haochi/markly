<div align="center">

# ✨ Markly — 智链收藏

**Smart Bookmark, Local First.**

一个纯本地的智能书签管理浏览器扩展，支持 AI 内容提取，数据完全属于你。


</div>

---

## 为什么选择 Markly？

大多数书签工具要么功能简陋，要么需要注册账号、上传数据到云端。**Markly 不同**——它将所有数据存储在你的浏览器本地（IndexedDB），零服务器，零追踪，同时提供 AI 驱动的智能摘要和标签能力。

## 核心特性

| 特性 | 说明 |
|:---|:---|
| 🔒 **纯本地存储** | 数据保存在浏览器 IndexedDB，无需注册账号，不上传任何服务器 |
| 📄 **智能提取** | 自动抓取页面标题、正文摘要、关键词标签 |
| 🤖 **AI 提取** | 接入 OpenAI / DeepSeek / Ollama 等 API |
| 🖼️ **图片分析** | 可选开启视觉模型，提取页面关键图片辅助 AI 分析 |
| 🔍 **全文搜索** | 名称、标题、URL、标签、智能标签、摘要——全字段联合搜索 |
| 🏷️ **双标签体系** | 手动标签 + AI 智能标签分开管理，互不干扰 |
| 📊 **标签分组** | 按标签聚合浏览，快速发现同类收藏 |
| 📥 **导入/导出** | 支持 Edge 和 Chrome 收藏夹的导入与导出，无痛切换，便于迁移和整合书签 |
| 📈 **Token 追踪** | 实时显示每次 AI 调用消耗，累计用量统计 |
| 🌧️ **Raindrop.io 同步** | 拉取时以 Raindrop 为准覆盖本地，本地编辑自动同步回 Raindrop，本地删除不影响云端 |
| 🌙 **深色模式** | 支持浅色/深色主题切换，毛玻璃 + 天青色设计风格 |
| 📋 **多视图** | 卡片/列表视图自由切换 |
| 📌 **置顶与排序** | 支持书签置顶、时间正/倒序 |
| 📖 **稍后阅读** | 标记书签为“稍后阅读”，管理阅读进度 |
| 🔗 **死链检测** | 自动检测书签链接是否失效 |


## 快速开始

### 安装

```bash
git clone https://github.com/xiwen-haochi/markly.git
```

1. 打开浏览器扩展管理页面
   - Chrome → `chrome://extensions/`
   - Edge → `edge://extensions/`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目中的 `extension/` 目录

### 使用

1. 浏览任意网页，点击工具栏中的 Markly 图标
2. 点击 **+** 展开添加面板（URL 自动填充）
3. 点击 **提取摘要** 自动获取标题和正文摘要
4. 或点击 **✨ AI 提取** 生成高质量摘要 + 智能标签
5. 可手动添加或编辑标签，点击 **保存收藏**

### 配置 AI（可选）

点击导航栏 ⚙ 设置按钮 → 填入以下信息 → 保存

| 配置项 | 示例 |
|:---|:---|
| API 地址 | `https://api.openai.com/v1` |
| API Key | `sk-...` |
| 模型名称 | `gpt-4o-mini` |

兼容所有 OpenAI Chat Completions 格式的 API：

- **OpenAI** — `https://api.openai.com/v1`
- **DeepSeek** — `https://api.deepseek.com/v1`
- **Ollama** — `http://localhost:11434/v1`
- 其他兼容服务均可使用

> 🔐 API 密钥仅保存在浏览器本地 `chrome.storage.local`，绝不外传。

### 配置 Raindrop.io 同步（可选）

点击导航栏 ⚙ 设置按钮 → 找到 Raindrop.io 配置区域 → 填入以下信息 → 保存

| 配置项 | 说明 |
|:---|:---|
| Test Token | 在 [Raindrop.io 设置](https://app.raindrop.io/settings/integrations) 中创建 |
| Collection ID | 收藏集 ID，留空为全部书签（默认 0） |
| 保存时同步 | 开启后新保存的书签自动推送到 Raindrop |

**同步规则：**

- **拉取**：Raindrop 为源，相同 URL 以 Raindrop 为准覆盖本地，Raindrop 中不存在的本地书签将被删除
- **本地编辑**：修改已关联 Raindrop 的书签时，自动同步回 Raindrop
- **本地删除**：仅删除本地数据，不影响 Raindrop 云端书签

## 项目结构

```
markly/
├── extension/
│   ├── manifest.json       # Chrome 扩展清单 (Manifest V3)
│   ├── popup.html          # 弹出页面结构
│   ├── popup.css           # Apple HIG 风格样式表
│   ├── popup.js            # 核心逻辑 (~1200 行)
│   └── icons/              # 扩展图标 (16/48/128px)
├── .gitignore
├── LICENSE
└── README.md
```

**技术栈：** 原生 JavaScript · IndexedDB · Chrome Manifest V3 · DOMParser · OpenAI API · Raindrop.io API

## 数据安全

- 所有书签数据存储在浏览器本地 IndexedDB，与浏览器配置文件绑定
- AI 配置（API 地址、密钥）存储在 `chrome.storage.local`
- 扩展不包含任何远程数据收集、统计或追踪代码
- 支持 CSV 导出备份，随时迁移你的数据

## License

[MIT](LICENSE) © 2026
