# ✦ 剪影 · 灵感收藏站

一个托管在 GitHub Pages 上的**私人灵感收藏站**。收纳名句、奇思、杂思、剪影美图，任何设备浏览器随时读写，数据永久保存在你自己的私有仓库里。

**架构**：公开仓库 `diary` 只托管前端页面（零数据）；私有仓库 `diary-data` 存全部内容。页面谁都能打开，但没有你的 Token 就看不到任何数据。

## 快速开始

1. 打开页面（自动按设备分流到桌面版 / 移动版）
2. 粘贴你的 **Fine-grained Token**（见下方创建步骤）
3. 点「进入」，写第一条灵感吧 ✦

## 创建 Token（只需一次）

> 步骤在页面登录界面也内嵌了，跟着点即可。

1. 打开 **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. 点 **Generate new token**
3. **Token name** 随意，**Expiration** 自选有效期
4. **Repository access** 选 **Only select repositories**，勾选 **`diary-data`**
5. **Permissions → Repository permissions → Contents** 设为 **Read and write**
6. 点 **Generate new token**，复制 `github_pat_...` 开头的令牌

> ⚠️ 令牌只显示一次，复制后立即粘贴进页面。Token 只存在你自己的浏览器 localStorage 里，不会上传到任何服务器。

## 使用

- **类型**：杂思 ✦ / 名句 ❝ / 奇思 ✧ / 美图 ◉（右上角或底部筛选）
- **标签**：写的时候用逗号/回车添加，点卡片上的标签可筛选
- **配图**：支持多图，手机可拍照；上传前自动压缩控制仓库体积
- **编辑/删除**：卡片右上角 `⋯`
- **搜索 / 月份**：顶部栏

## 数据文件

每条记录 = 一个 markdown 文件，存在你的私有仓库 `diary-data`：

```
data/2026/2026-08-01-143502.md     ← 一条灵感
data/2026/images/xxx-1.jpg         ← 配图
```

```markdown
---
type: quote          # note杂思 / quote名句 / idea奇思 / collection美图
tags: [灵感, 美学]
source: 尼采
---
当你凝视深渊，深渊也在凝视你。

![图](images/2026-08-01-143502-1.jpg)
```

直接在 GitHub 网页上手动编辑这些 `.md` 文件，刷新页面即可看到变化 —— Git 是唯一数据源，永久版本化。

## 本地开发

```
diary/
├── index.html          # 桌面版（自动分流：手机访问跳移动版）
├── index-mobile.html   # 移动版
├── assets/
│   ├── css/            # desktop.css / mobile.css（玻璃拟态）
│   └── js/
│       ├── common.js   # 类型表 / frontmatter / markdown渲染 / 图片压缩
│       ├── api.js      # 数据层（唯一与 GitHub API 打交道的地方）
│       ├── app-desktop.js
│       └── app-mobile.js
```

本地直接双击 `index.html` 即可预览（无需服务器）。

## 未来扩展

数据层与界面层已分离。加新东西：

- **新内容类型**：`common.js` 的 `TYPES` 表加一行，界面自动出现新标签
- **新数据字段**：`buildFrontmatter` 加一个字段，markdown 文件向前兼容
- **换存储后端**：只改 `api.js`，界面层无感
- **新视图**（日历/时间轴/导出/AI 摘要）：复用 `api.js` 的方法即可
