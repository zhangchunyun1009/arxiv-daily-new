const INDEX_URL = "/data/index.json";
const LATEST_URL = "/data/latest.json";
const FAVORITES_KEY = "arxiv_favorites";
const READ_KEY = "arxiv_read";
const HOME_TOPIC_KEY = "arxiv_home_topic";

const state = {
  index: null,
  dataByDate: new Map(),
  selectedDate: null,
  activeTopicId: null,
  searchQuery: "",
  favoritesOnly: false,
  unreadOnly: false,
  sidebarOpen: true
};

const el = {
  headerDate: document.querySelector("#header-date"),
  dateList: document.querySelector("#date-list"),
  tabs: document.querySelector("#tabs"),
  status: document.querySelector("#status"),
  papers: document.querySelector("#papers-container"),
  search: document.querySelector("#search-input"),
  refresh: document.querySelector("#refresh-toggle"),
  favorites: document.querySelector("#favorites-toggle"),
  unread: document.querySelector("#unread-toggle"),
  sidebar: document.querySelector("#sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle")
};

function readSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSet(key, values) {
  localStorage.setItem(key, JSON.stringify([...values]));
}

function getHomeTopicId() {
  return localStorage.getItem(HOME_TOPIC_KEY) || "";
}

function setHomeTopicId(topicId) {
  if (getHomeTopicId() === topicId) {
    localStorage.removeItem(HOME_TOPIC_KEY);
  } else {
    localStorage.setItem(HOME_TOPIC_KEY, topicId);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatPublished(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function currentData() {
  return state.dataByDate.get(state.selectedDate);
}

function currentTopic() {
  const data = currentData();
  return data?.topics.find((topic) => topic.id === state.activeTopicId) || data?.topics[0];
}

function showStatus(message, kind = "") {
  el.status.innerHTML = `<div class="status-icon">🌱</div><div>${escapeHtml(message)}</div>`;
  el.status.className = `status-box show ${kind}`.trim();
  el.papers.innerHTML = "";
}

function clearStatus() {
  el.status.className = "status-box";
  el.status.textContent = "";
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadDate(date) {
  if (state.dataByDate.has(date)) return state.dataByDate.get(date);
  const item = state.index.dates.find((entry) => entry.date === date);
  const data = await fetchJson(item?.path || LATEST_URL);
  state.dataByDate.set(data.date, data);
  return data;
}

function renderHeader() {
  const data = currentData();
  const generated = data?.generatedAt
    ? ` · 生成于 ${new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}`
    : " · 等待首次自动抓取";
  el.headerDate.textContent = `${state.selectedDate || todayLocal()}${generated}`;
}

function renderDates() {
  const today = todayLocal();
  el.dateList.innerHTML = state.index.dates.map((entry) => {
    const active = entry.date === state.selectedDate ? " active" : "";
    const isToday = entry.date === today ? " today" : "";
    return `
      <button class="date-item${active}${isToday}" type="button" data-date="${escapeHtml(entry.date)}">
        <span class="date-dot"></span>
        <span>${escapeHtml(entry.date)}</span>
      </button>
    `;
  }).join("");
}

function renderTabs() {
  const data = currentData();
  if (!data) {
    el.tabs.innerHTML = "";
    return;
  }

  const homeTopicId = getHomeTopicId();
  el.tabs.innerHTML = data.topics.map((topic) => {
    const active = topic.id === state.activeTopicId ? " active" : "";
    const home = topic.id === homeTopicId ? " is-home" : "";
    return `
      <button class="tab${active}" type="button" data-topic-id="${escapeHtml(topic.id)}">
        ${escapeHtml(topic.name)}
        <span class="tab-badge">${topic.papers.length}</span>
        <span class="tab-star${home}" data-home-topic-id="${escapeHtml(topic.id)}" title="${home ? "取消默认方向" : "设为默认方向"}">★</span>
      </button>
    `;
  }).join("");
}

function allPapersForDate() {
  const data = currentData();
  return data.topics.flatMap((topic) => topic.papers.map((paper) => ({
    ...paper,
    topicName: topic.name
  })));
}

function filteredPapers() {
  const topic = currentTopic();
  const favorites = readSet(FAVORITES_KEY);
  const reads = readSet(READ_KEY);
  const query = state.searchQuery.toLowerCase();
  const base = state.favoritesOnly ? allPapersForDate() : (topic?.papers || []);

  return base.filter((paper) => {
    if (state.favoritesOnly && !favorites.has(paper.id)) return false;
    if (state.unreadOnly && reads.has(paper.id)) return false;
    if (!query) return true;
    return [
      paper.title,
      paper.summary,
      paper.authors?.join(" "),
      paper.categories?.join(" "),
      paper.topicName
    ].join(" ").toLowerCase().includes(query);
  });
}

function renderPapers() {
  const data = currentData();
  const topic = currentTopic();
  if (!data) return;

  el.favorites.classList.toggle("active", state.favoritesOnly);
  el.unread.classList.toggle("active", state.unreadOnly);

  if (!data.generatedAt) {
    showStatus("当前还没有真实抓取的数据。GitHub Actions 第一次运行成功后，这里会显示每日论文。", "warning");
    return;
  }

  const papers = filteredPapers();
  if (papers.length === 0) {
    showStatus("暂无匹配论文。");
    return;
  }

  clearStatus();
  const favorites = readSet(FAVORITES_KEY);
  const reads = readSet(READ_KEY);
  const label = state.favoritesOnly ? "⭐ 收藏论文" : `🍀 ${state.selectedDate} · ${topic.name}`;

  const cards = papers.map((paper) => {
    const favorite = favorites.has(paper.id);
    const read = reads.has(paper.id);
    const topicTag = state.favoritesOnly ? `<span>${escapeHtml(paper.topicName)}</span>` : "";
    const categories = (paper.categories || []).slice(0, 4).map((category) => (
      `<span class="category-tag">${escapeHtml(category)}</span>`
    )).join("");

    return `
      <article class="paper${read ? " read" : ""}">
        <div class="paper-header">
          <h2 class="paper-title">
            <a href="${escapeHtml(paper.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.title)}</a>
          </h2>
          <div class="paper-actions">
            <button class="paper-action-btn${favorite ? " active" : ""}" data-action="favorite" data-id="${escapeHtml(paper.id)}" title="${favorite ? "取消收藏" : "收藏"}">⭐</button>
            <button class="paper-action-btn${read ? " read-active" : ""}" data-action="read" data-id="${escapeHtml(paper.id)}" title="${read ? "标为未读" : "标为已读"}">✓</button>
          </div>
        </div>
        <div class="paper-meta">
          <span>${escapeHtml(formatPublished(paper.published))}</span>
          ${topicTag}
          ${categories}
        </div>
        <p class="paper-authors"><strong>Authors: </strong>${escapeHtml((paper.authors || []).join(", "))}</p>
        <div class="paper-abstract">${escapeHtml(paper.summary)}</div>
      </article>
    `;
  }).join("");

  el.papers.innerHTML = `<div class="paper-count">${label} · 共 ${papers.length} 篇</div>${cards}`;
}

function render() {
  renderHeader();
  renderDates();
  renderTabs();
  renderPapers();
}

async function selectDate(date) {
  showStatus("正在加载论文数据...");
  const data = await loadDate(date);
  const homeTopicId = getHomeTopicId();
  state.selectedDate = data.date;
  state.activeTopicId = data.topics.some((topic) => topic.id === homeTopicId)
    ? homeTopicId
    : data.topics[0]?.id || null;
  state.favoritesOnly = false;
  render();
}

async function init() {
  try {
    state.index = await fetchJson(INDEX_URL);
    if (!state.index.dates?.length) {
      const latest = await fetchJson(LATEST_URL);
      state.index = {
        schemaVersion: 1,
        dates: [{ date: latest.date, path: LATEST_URL }]
      };
      state.dataByDate.set(latest.date, latest);
    }
    await selectDate(state.index.dates[0].date);
  } catch (error) {
    showStatus(`数据加载失败：${error.message}`, "warning");
  }
}

el.dateList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  await selectDate(button.dataset.date);
});

el.tabs.addEventListener("click", (event) => {
  const star = event.target.closest("[data-home-topic-id]");
  if (star) {
    event.stopPropagation();
    setHomeTopicId(star.dataset.homeTopicId);
    state.activeTopicId = star.dataset.homeTopicId;
    state.favoritesOnly = false;
    render();
    return;
  }

  const button = event.target.closest("[data-topic-id]");
  if (!button) return;
  state.activeTopicId = button.dataset.topicId;
  state.favoritesOnly = false;
  render();
});

el.papers.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const key = button.dataset.action === "favorite" ? FAVORITES_KEY : READ_KEY;
  const values = readSet(key);
  if (values.has(button.dataset.id)) values.delete(button.dataset.id);
  else values.add(button.dataset.id);
  writeSet(key, values);
  renderPapers();
});

el.search.addEventListener("input", (event) => {
  state.searchQuery = event.target.value.trim();
  renderPapers();
});

el.refresh.addEventListener("click", async () => {
  el.refresh.disabled = true;
  const originalText = el.refresh.textContent;
  el.refresh.textContent = "⏳ 已提交更新...";
  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    showStatus("已触发后台更新。GitHub Actions 跑完并重新部署后，刷新页面即可看到新增论文。");
  } catch (error) {
    showStatus(`触发更新失败：${error.message}`, "warning");
  } finally {
    el.refresh.disabled = false;
    el.refresh.textContent = originalText;
  }
});

el.favorites.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  renderPapers();
});

el.unread.addEventListener("click", () => {
  state.unreadOnly = !state.unreadOnly;
  renderPapers();
});

el.sidebarToggle.addEventListener("click", () => {
  state.sidebarOpen = !state.sidebarOpen;
  el.sidebar.classList.toggle("collapsed", !state.sidebarOpen);
});

init();
