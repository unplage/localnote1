# 仿素记日记 — 本地记事本 PWA

单文件 PWA 笔记应用，数据全部存储在浏览器 IndexedDB 中，无需联网，无需后端。

**在线体验**: https://unplage.github.io/localnote1/

---

## 功能

- 笔记 CRUD（标题、正文、分类、时间戳）
- 分类管理（名称、颜色、图标、排序）
- 全量搜索（标题 + 正文 + 分类名）
- 暗色主题
- 自动保存（可配置间隔）
- 导入/导出 JSON
- 导入/导出 Markdown（含分类信息）
- 清除所有数据
- PWA 离线支持

---

## 项目结构

```
localnote/
├── index.html      # 主应用（HTML + CSS + JS ~1200 行单文件）
├── manifest.json   # PWA 清单
├── sw.js           # Service Worker（离线缓存）
├── clear.html      # PWA 缓存清理工具
├── icons/          # 应用图标（icon.svg 为矢量源文件，其余为生成位图）
├── favicon.ico     # 标签页图标
└── tools/
    └── make_icons.py  # 由 icons/icon.svg 重新生成全部图标
```

---

## 架构

### 数据层 (`DBManager`)
- **数据库**: `<应用路径>::SimpleNotesDB` (IndexedDB, v2)，按部署路径隔离，不同 PWA 互不共享
- **存储**: `notes` / `categories` / `settings` 三个 object store
- **索引**: `notes.category`（非唯一）、`notes.updatedAt`（非唯一）

### 核心类 (`App`)
- 单一 ES6 class 管理所有 UI 和业务逻辑
- 模块划分：DOM 引用 → 初始化 → 分类管理 → 笔记列表 → 编辑器 → 导入导出 → 全局事件 → 辅助方法

---

## 本地使用

直接用浏览器打开 `index.html`，或启动 HTTP 服务：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

---

## 技术要点

- **零构建**: 单文件 HTML，无构建工具、无 npm 依赖
- **外部依赖**: 仅 Font Awesome 6.4.0（CDN），需要网络加载图标
- **离线使用**: Service Worker 使用 Network First 策略，首次访问后支持离线
- **数据安全**: 所有笔记存储在浏览器本地，支持导出 JSON/Markdown 备份

---

## 许可

MIT
