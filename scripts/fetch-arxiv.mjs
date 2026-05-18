import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { TOPICS } from "../src/topics.mjs";

const API_URL = "https://export.arxiv.org/api/query";
const REQUEST_DELAY_MS = Number(process.env.ARXIV_REQUEST_DELAY_MS || 3500);
const MAX_RESULTS = Number(process.env.ARXIV_MAX_RESULTS || 100);
const REQUEST_TIMEOUT_MS = Number(process.env.ARXIV_REQUEST_TIMEOUT_MS || 20000);
const WINDOW_OVERLAP_MS = Number(process.env.ARXIV_WINDOW_OVERLAP_HOURS || 2) * 60 * 60 * 1000;
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

function compactUtcDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for arXiv submittedDate range: ${value}`);
  }
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0")
  ].join("");
}

function addSubmittedDateRange(query, windowStart, windowEnd) {
  const start = compactUtcDate(windowStart);
  const end = compactUtcDate(windowEnd);
  return `(${query}) AND submittedDate:[${start} TO ${end}]`;
}

function isWithinWindow(value, windowStart, windowEnd) {
  const time = new Date(value).getTime();
  return time > new Date(windowStart).getTime() && time <= new Date(windowEnd).getTime();
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

async function loadExistingPayload(date) {
  try {
    return JSON.parse(await readFile(new URL(`${date}.json`, DATA_DIR), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadLatestSuccessfulRun() {
  try {
    const latest = JSON.parse(await readFile(new URL("latest.json", DATA_DIR), "utf8"));
    return latest.generatedAt || latest.date;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function withOverlap(value) {
  return new Date(new Date(value).getTime() - WINDOW_OVERLAP_MS).toISOString();
}

async function loadHistoricalPaperIds() {
  await mkdir(DATA_DIR, { recursive: true });

  const knownByTopic = new Map(TOPICS.map((topic) => [topic.id, new Set()]));
  const files = await readdir(DATA_DIR).catch(() => []);
  const datedFiles = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));

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

async function fetchTopic(topic, historicalIds, windowStart, windowEnd) {
  const seen = new Set();
  const papers = [];
  const errors = [];

  for (const query of topic.queries) {
    try {
      const queryPapers = await fetchQuery(addSubmittedDateRange(query, windowStart, windowEnd));
      for (const paper of queryPapers) {
        if (isWithinWindow(paper.published, windowStart, windowEnd) && !historicalIds.has(paper.id) && !seen.has(paper.id)) {
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

function mergeWithExistingTopics(existingPayload, fetchedTopics) {
  const existingByTopic = new Map((existingPayload?.topics || []).map((topic) => [topic.id, topic.papers || []]));

  return fetchedTopics.map(({ errors, queries, ...topic }) => {
    const seen = new Set();
    const papers = [];
    for (const paper of [...(existingByTopic.get(topic.id) || []), ...topic.papers]) {
      if (!seen.has(paper.id)) {
        seen.add(paper.id);
        papers.push(paper);
      }
    }
    papers.sort((a, b) => new Date(b.published) - new Date(a.published));
    return { ...topic, papers };
  });
}

async function main() {
  const date = process.env.ARXIV_DATE || todayInShanghai();
  const windowEnd = process.env.ARXIV_WINDOW_END || new Date().toISOString();
  const lastSuccessfulRun = await loadLatestSuccessfulRun();
  const windowStart = process.env.ARXIV_WINDOW_START
    || (lastSuccessfulRun ? withOverlap(lastSuccessfulRun) : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const topics = [];
  const startedAt = windowEnd;
  const existingPayload = await loadExistingPayload(date);
  const historicalIdsByTopic = await loadHistoricalPaperIds();

  for (const topic of TOPICS) {
    console.log(`Fetching ${topic.name}`);
    topics.push(await fetchTopic(topic, historicalIdsByTopic.get(topic.id) || new Set(), windowStart, windowEnd));
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
    mode: "rolling-window-incremental",
    windowStart,
    windowEnd,
    historicalPaperCount: [...historicalIdsByTopic.values()].reduce((sum, ids) => sum + ids.size, 0),
    topics: mergeWithExistingTopics(existingPayload, topics)
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
