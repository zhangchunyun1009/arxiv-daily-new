import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { TOPICS } from "../src/topics.mjs";

const API_URL = "https://export.arxiv.org/api/query";
const REQUEST_DELAY_MS = Number(process.env.ARXIV_REQUEST_DELAY_MS || 3500);
const MAX_RESULTS = Number(process.env.ARXIV_MAX_RESULTS || 20);
const REQUEST_TIMEOUT_MS = Number(process.env.ARXIV_REQUEST_TIMEOUT_MS || 20000);
const DATA_DIR = new URL("../public/data/", import.meta.url);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildUrl(query) {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(MAX_RESULTS),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });
  return `${API_URL}?${params.toString()}`;
}

function parseArxivFeed(xmlText, query) {
  if (!xmlText.includes("<feed") || xmlText.includes("Rate exceeded")) {
    throw new Error(`arXiv returned a non-feed response for query: ${query}`);
  }

  const parsed = parser.parse(xmlText);
  const feed = parsed.feed;
  if (!feed) {
    throw new Error(`arXiv response did not contain a feed for query: ${query}`);
  }

  const entries = asArray(feed.entry);
  return entries.map((entry) => {
    const categories = asArray(entry.category).map((category) => category.term).filter(Boolean);
    const authors = asArray(entry.author).map((author) => normalizeText(author.name)).filter(Boolean);
    return {
      id: normalizeText(entry.id),
      title: normalizeText(entry.title),
      summary: normalizeText(entry.summary),
      published: normalizeText(entry.published),
      updated: normalizeText(entry.updated),
      authors,
      categories,
      pdfUrl: asArray(entry.link).find((link) => link.title === "pdf")?.href || ""
    };
  }).filter((paper) => paper.id && paper.title);
}

async function fetchQuery(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(query), {
      signal: controller.signal,
      headers: {
        "User-Agent": "arxiv-daily/1.0 (daily paper digest; contact: site maintainer)"
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`arXiv HTTP ${response.status} for query: ${query}; ${text.slice(0, 120)}`);
    }
    return parseArxivFeed(text, query);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`arXiv request timed out after ${REQUEST_TIMEOUT_MS}ms for query: ${query}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistoricalPaperIds(currentDate) {
  await mkdir(DATA_DIR, { recursive: true });

  const knownByTopic = new Map(TOPICS.map((topic) => [topic.id, new Set()]));
  const files = await readdir(DATA_DIR).catch(() => []);
  const datedFiles = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .filter((file) => file !== `${currentDate}.json`);

  for (const file of datedFiles) {
    const payload = JSON.parse(await readFile(new URL(file, DATA_DIR), "utf8"));
    for (const topic of payload.topics || []) {
      const known = knownByTopic.get(topic.id) || new Set();
      for (const paper of topic.papers || []) {
        if (paper.id) known.add(paper.id);
      }
      knownByTopic.set(topic.id, known);
    }
  }

  return knownByTopic;
}

async function fetchTopic(topic, historicalIds) {
  const seen = new Set();
  const papers = [];
  const errors = [];

  for (const query of topic.queries) {
    try {
      const queryPapers = await fetchQuery(query);
      for (const paper of queryPapers) {
        if (!historicalIds.has(paper.id) && !seen.has(paper.id)) {
          seen.add(paper.id);
          papers.push(paper);
        }
      }
    } catch (error) {
      errors.push({ query, message: error.message });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  papers.sort((a, b) => new Date(b.published) - new Date(a.published));
  return { ...topic, papers, errors };
}

async function main() {
  const date = process.env.ARXIV_DATE || todayInShanghai();
  const topics = [];
  const startedAt = new Date().toISOString();
  const historicalIdsByTopic = await loadHistoricalPaperIds(date);

  for (const topic of TOPICS) {
    console.log(`Fetching ${topic.name}`);
    topics.push(await fetchTopic(topic, historicalIdsByTopic.get(topic.id) || new Set()));
  }

  const failedQueries = topics.flatMap((topic) => topic.errors.map((error) => ({
    topicId: topic.id,
    topicName: topic.name,
    ...error
  })));

  if (failedQueries.length > 0) {
    console.error(JSON.stringify(failedQueries, null, 2));
    throw new Error(`Refusing to write partial data: ${failedQueries.length} arXiv queries failed.`);
  }

  const payload = {
    schemaVersion: 1,
    date,
    generatedAt: new Date().toISOString(),
    startedAt,
    source: "arXiv API",
    maxResultsPerQuery: MAX_RESULTS,
    mode: "incremental",
    historicalPaperCount: [...historicalIdsByTopic.values()].reduce((sum, ids) => sum + ids.size, 0),
    topics: topics.map(({ errors, queries, ...topic }) => topic)
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL(`${date}.json`, DATA_DIR), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(new URL("latest.json", DATA_DIR), `${JSON.stringify(payload, null, 2)}\n`);
  await writeIndex();
  console.log(`Wrote ${date}.json, latest.json, and index.json`);
}

async function writeIndex() {
  const files = await readdir(DATA_DIR);
  const datedFiles = files.filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  const dates = [];

  for (const file of datedFiles) {
    const payload = JSON.parse(await readFile(new URL(file, DATA_DIR), "utf8"));
    dates.push({
      date: payload.date,
      generatedAt: payload.generatedAt,
      topicCount: payload.topics?.length || 0,
      paperCount: (payload.topics || []).reduce((sum, topic) => sum + (topic.papers?.length || 0), 0),
      path: `/data/${file}`
    });
  }

  await writeFile(new URL("index.json", DATA_DIR), `${JSON.stringify({ schemaVersion: 1, dates }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
