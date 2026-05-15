# Arxiv 论文速递

这个版本把论文抓取从浏览器端移到了服务端脚本：

- `scripts/fetch-arxiv.mjs` 每天按研究方向请求 arXiv API。
- 请求之间默认等待 3.5 秒，避免触发 arXiv 限流。
- 任意 query 失败时不会写入 `latest.json`，避免把错误缓存成“0 篇论文”。
- 前端只读取 `public/data/latest.json`，所有访客看到同一份数据。

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
3. 校验生成的 `public/data/latest.json`。
4. 把 `public/data/*.json` 提交回仓库。

如果 Vercel 项目连接了这个 GitHub 仓库，新的数据提交会触发一次重新部署。

## 调整方向

研究方向和检索式在 `src/topics.mjs`。每个方向需要稳定的 `id`，历史数据会用这个 `id` 关联，不再用容易错位的数组下标。
