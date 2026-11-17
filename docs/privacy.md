# 私人离线版本

本版为 `0.85.1-privacy.1`，直接基于上游 v0.85.1（`8b4fddd59d386d69611902d85d805e352a80aee6`），迁移旧私人提交 `b52694e813b4a265ad50b4c55c2e9bebefb98061` 的隐私修改。旧版本由 `backup/pre-022-rc3-20261117` 保留。

已删除 npm 更新查询及路由/提示、DeepSeek API Key 和登录账号余额整链、赞助推荐 JSON（含 gh-proxy 镜像）及远程图标。保留上游上下文、子代理、命令、文件和总览统计功能。价格计算沿用新版 host 数据面，唯一价格源为 `src/host/modelPrices.json`；快照与旧私人版本完全相同，来源 `@opencode-ai/models@0.0.87/snapshot`，原始生成时间 `2026-09-27T05:30:14.484Z`。不再依赖该 SDK，不刷新目录；未知模型不编造价格，估算不等于账单。

已删除 prepare，构建不执行价格生成或下载。提交的 `lib/index.js`、`lib/index.d.ts`、`lib/client.js` 为人工构建产物，固定 Fork SHA 安装不需要安装脚本。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check
```

目标宿主为私人 DSH 0.2.2-rc.3。本轮不写正式 profile、会话或模型配置。新版 overview-cache.v1.json 是宿主数据目录中的本地派生缓存；实际挂载时可能重折叠旧缓存。

这里的离线价格与外联删除不阻断用户主动使用配置的模型服务、点击链接，也不修改宿主 MarkdownText 对日志自带远程图片的显示行为。此版本不宣称整个 DSH 零联网。
