# lib 目录结构

插件核心逻辑模块，按功能分类：

```
lib/
├── agent/          Agent 运行时、工具、MCP、Shell、浏览器
│   ├── agent-runtime.mjs
│   ├── agent-browser.mjs
│   ├── agent-browser-use.mjs
│   ├── agent-shell.mjs
│   ├── agent-qq.mjs
│   ├── agent-bilibili.mjs
│   ├── agent-cookies.mjs
│   ├── mcp-client.mjs
│   ├── skills.mjs
│   └── process-run.mjs
├── bili/           Bilibili API 与扫码登录
│   ├── bili-auth.mjs
│   ├── bili-chat-login.mjs
│   ├── bili-api-gateway.mjs
│   └── bili-api-catalog.mjs
├── napcat/         NapCat QQ API 目录与网关
│   ├── napcat-api-gateway.mjs
│   └── napcat-api-catalog.mjs
├── maisaka/        MaiBot 伪人引擎（Planner、记忆、表达、黑话）
│   ├── maisaka-fakehuman.mjs
│   ├── maisaka-planner-loop.mjs
│   ├── maisaka-store.mjs
│   ├── fakehuman-burst.mjs
│   ├── behavior-observer.mjs
│   ├── emoji-prompts.mjs
│   ├── expression-library.mjs
│   └── slang-library.mjs
├── emoji/          表情库、小黄脸、VLM 选表情
│   ├── emoji-manager.mjs
│   ├── emoji-library.mjs
│   ├── emoji-grid-select.mjs
│   └── qq-face.mjs
├── storage/        SQLite 记忆库与用户资料
│   ├── sqlite-db.mjs
│   ├── sqlite-setup.mjs
│   └── user-profiles.mjs
├── skillhub/       SkillHub / Node 环境探测与部署
│   ├── skillhub-cli.mjs
│   ├── skillhub-env.mjs
│   ├── skillhub-setup.mjs
│   └── skillhub-node-probe.mjs
├── core/           通用：消息、搜索、画图、更新
│   ├── cq-message.mjs
│   ├── messages.mjs
│   ├── media-files.mjs
│   ├── plugin-reload.mjs
│   ├── self-update.mjs
│   ├── github-mirrors.mjs
│   ├── smart-search.mjs
│   ├── draw-bot.mjs
│   └── image-gen.mjs
└── scripts/        辅助脚本（Python 等）
    └── browser/
        └── browser_use_runner.py
```

## 引用约定

- 跨目录引用使用相对路径，如 `../storage/sqlite-db.mjs`
- 入口 `index.mjs` 从 `./lib/<category>/<file>.mjs` 导入
- 重组脚本：`scripts/reorganize-lib.mjs`（一次性迁移用）
