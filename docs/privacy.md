# 私人离线版本

本分支基于上游 v0.77.0（`8e6555a840993a0e090dd7116d262588006e9360`），私人版本为 `0.77.1-privacy.1`。

已删除 npm 新版本查询及其界面、DeepSeek 余额查询路由及凭据读取、余额胶囊与相关废弃测试。上下文分析、`/context`、子代理关系、附件、本地价格估算保留；不改写分析算法。

价格只来自固定开发依赖 `@opencode-ai/models@0.0.87` 的本地 snapshot，不使用 SDK 网络客户端。原始快照生成时间为 `2026-09-27T05:30:14.484Z`；`src/client/modelPrices.json` 同时记录提取时间。构建先执行 `scripts/generate-prices.mjs`，只提取 cost 的 input/output/cache_read/cache_write 和 canonical_model_id。不启动价格网络请求或定时重试，未知模型保持无价格，估算不等于账单。

已移除 prepare/husky 自动安装钩子。提交中的 `lib/index.js`、`lib/index.d.ts`、`lib/client.js` 是手动构建的可审查产物，固定 Fork SHA 安装不依赖安装期执行脚本。

```sh
export PNPM_CONFIG_STORE_DIR=/Users/aelith/Library/pnpm/store/v11
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check
```

这里的联网减少不影响用户主动使用配置的模型服务，也不阻断点击仓库或价格说明链接。尚未在实际私人 rc.3 profile 挂载验收，原有版本兼容矩阵不代表 rc.3 实机验证。

本地验证：定向价格、成本、总览、插件信息和路由测试通过；全量 lint/typecheck/coverage 通过，176 文件、2699 测试通过，148 源文件覆盖率均为100%。68项宿主兼容矩阵测试因默认宿主检出目录不存在而跳过，未将其作为 rc.3 兼容证据。
