# Arxiv 论文速递

这个版本保留原来的产品结构和视觉风格：左侧是每天的历史记录，搜索框下面是研究方向，页面只展示已经生成好的每日数据。

## 数据更新逻辑

- `scripts/fetch-arxiv.mjs` 每天按研究方向请求 arXiv API。
- 请求之间默认等待 3.5 秒，避免触发 arXiv 限流。
- 任意 query 失败时不会写入数据，避免把错误缓存成“0 篇论文”。
- 默认使用“滚动窗口 + 增量去重”模式：脚本抓取上次成功更新到本次运行之间 submitted 的论文，并默认向前重叠 2 小时防止 arXiv 索引延迟；同时读取 `public/data/YYYY-MM-DD.json` 历史文件，按研究方向过滤掉已经出现过的论文。
- `public/data/index.json` 维护左侧历史日期列表。
- `public/data/latest.json` 指向最近一次成功生成的数据，便于前端快速加载。

## 本地运行

```bash
npm install
npm run fetch
npm run dev
```

如果当前 IP 被 arXiv 限流，`npm run fetch` 会失败并保留旧数据，这是预期行为。

## 每日更新

`.github/workflows/update-papers.yml` 会在每天北京时间 08:30 运行：

1. 安装依赖。
2. 执行 `npm run fetch`。
3. 校验 `public/data/latest.json` 和 `public/data/index.json`。
4. 把 `public/data/*.json` 提交回仓库。

如果 Vercel 项目连接了这个 GitHub 仓库，新的数据提交会触发一次重新部署。

## 手动更新按钮

页面里的“刷新今日数据”按钮会触发 GitHub Actions 手动运行一次同样的更新流程。因为浏览器不能安全地直接写 GitHub 仓库，这个按钮通过 Vercel Serverless Function 调用 GitHub API。

在 Vercel 项目里需要配置环境变量：

- `GITHUB_DISPATCH_TOKEN`：GitHub fine-grained token，需要允许当前仓库的 Actions workflow dispatch。
- `GITHUB_REPO_OWNER`：默认 `zhangchunyun1009`。
- `GITHUB_REPO_NAME`：默认 `arxiv-daily-new`。
- `GITHUB_WORKFLOW_ID`：默认 `update-papers.yml`。
- `GITHUB_WORKFLOW_BRANCH`：默认 `main`。

配置完环境变量后，需要重新部署一次 Vercel 项目。按钮触发后，GitHub Actions 跑完、提交数据、Vercel 自动重新部署，页面刷新后就能看到新增论文。

## 调整方向

研究方向和检索式在 `src/topics.mjs`。每个方向需要稳定的 `id`，历史数据会用这个 `id` 做增量去重，不再用容易错位的数组下标。
