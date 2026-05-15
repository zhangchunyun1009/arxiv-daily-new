const DATA_URL = "/data/latest.json";
const FAVORITES_KEY = "arxiv_favorites";
const READ_KEY = "arxiv_read";

const state = {
  data: null,
  activeTopicId: null,
  query: "",
  favoritesOnly: false,
  unreadOnly: false
};

const elements = {
  dataDate: document.querySelector("#data-date"),
  generatedAt: document.querySelector("#generated-at"),
  topicList: document.querySelector("#topic-list"),
  paperList: document.querySelector("#paper-list"),
  status: document.querySelector("#status"),
  searchInput: document.querySelector("#search-input"),
  favoritesToggle: document.querySelector("#favorites-toggle"),
  unreadToggle: document.querySelector("#unread-toggle")
};

function readSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSet(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatGeneratedAt(value) {
  if (!value) return "尚未生成真实数据";
  return `生成于 ${new Date(value).toLocaleString("zh-CN", { hour12: false })}`;
}

function activeTopic() {
  return state.data?.topics.find((topic) => topic.id === state.activeTopicId) || state.data?.topics[0];
}

function allPapers() {
  return state.data.topics.flatMap((topic) => topic.papers.map((paper) => ({ ...paper, topicName: topic.name })));
}

function filteredPapers() {
  const favorites = readSet(FAVORITES_KEY);
  const reads = readSet(READ_KEY);
  const source = state.favoritesOnly ? allPapers() : activeTopic().papers;
  const query = state.query.toLowerCase();

  return source.filter((paper) => {
    if (state.favoritesOnly && !favorites.has(paper.id)) return false;
    if (state.unreadOnly && reads.has(paper.id)) return false;
    if (!query) return true;
    return [
      paper.title,
      paper.summary,
      paper.authors?.join(" "),
      paper.categories?.join(" ")
    ].join(" ").toLowerCase().includes(query);
  });
}

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status show ${kind}`.trim();
  elements.paperList.innerHTML = "";
}

function clearStatus() {
  elements.status.className = "status";
  elements.status.textContent = "";
}

function renderTopics() {
  const topicButtons = state.data.topics.map((topic) => {
    const active = topic.id === state.activeTopicId ? " active" : "";
    return `
      <button class="topic-button${active}" type="button" data-topic-id="${escapeHtml(topic.id)}">
        <span>${escapeHtml(topic.name)}</span>
        <span class="count">${topic.papers.length}</span>
      </button>
    `;
  }).join("");
  elements.topicList.innerHTML = topicButtons;
}

function renderPapers() {
  const topic = activeTopic();
  const papers = filteredPapers();
  const favorites = readSet(FAVORITES_KEY);
  const reads = readSet(READ_KEY);

  elements.favoritesToggle.classList.toggle("active", state.favoritesOnly);
  elements.unreadToggle.classList.toggle("active", state.unreadOnly);

  if (!state.data.generatedAt) {
    setStatus("当前仓库里还没有真实抓取的数据。部署后由 GitHub Actions 每天生成 public/data/latest.json。", "warning");
    renderTopics();
    return;
  }

  clearStatus();

  if (papers.length === 0) {
    const label = state.favoritesOnly ? "收藏列表" : topic.name;
    setStatus(`${label} 下没有匹配论文。`);
    return;
  }

  const label = state.favoritesOnly ? "收藏论文" : `${topic.name}`;
  const rows = papers.map((paper) => {
    const isFavorite = favorites.has(paper.id);
    const isRead = reads.has(paper.id);
    const categories = (paper.categories || []).slice(0, 4).map((category) => (
      `<span>${escapeHtml(category)}</span>`
    )).join("");
    const topicChip = state.favoritesOnly && paper.topicName ? `<span>${escapeHtml(paper.topicName)}</span>` : "";
    return `
      <article class="paper-card${isRead ? " read" : ""}">
        <div class="paper-head">
          <h2 class="paper-title">
            <a href="${escapeHtml(paper.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.title)}</a>
          </h2>
          <div class="paper-actions">
            <button class="icon-button${isFavorite ? " active" : ""}" type="button" data-action="favorite" data-id="${escapeHtml(paper.id)}" title="${isFavorite ? "取消收藏" : "收藏"}">★</button>
            <button class="icon-button${isRead ? " read-active" : ""}" type="button" data-action="read" data-id="${escapeHtml(paper.id)}" title="${isRead ? "标为未读" : "标为已读"}">✓</button>
          </div>
        </div>
        <div class="meta">
          <span>${escapeHtml(formatDate(paper.published))}</span>
          ${topicChip}
          ${categories}
        </div>
        <p class="authors"><strong>Authors:</strong> ${escapeHtml((paper.authors || []).join(", "))}</p>
        <div class="abstract">${escapeHtml(paper.summary)}</div>
      </article>
    `;
  }).join("");

  elements.paperList.innerHTML = `
    <div class="paper-summary">${escapeHtml(label)} · 共 ${papers.length} 篇</div>
    ${rows}
  `;
}

function render() {
  elements.dataDate.textContent = state.data.date;
  elements.generatedAt.textContent = formatGeneratedAt(state.data.generatedAt);
  renderTopics();
  renderPapers();
}

async function loadData() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.activeTopicId = state.data.topics[0]?.id;
    render();
  } catch (error) {
    setStatus(`数据加载失败：${error.message}`, "warning");
  }
}

elements.topicList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic-id]");
  if (!button) return;
  state.activeTopicId = button.dataset.topicId;
  state.favoritesOnly = false;
  render();
});

elements.paperList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const key = button.dataset.action === "favorite" ? FAVORITES_KEY : READ_KEY;
  const values = readSet(key);
  if (values.has(button.dataset.id)) values.delete(button.dataset.id);
  else values.add(button.dataset.id);
  writeSet(key, values);
  renderPapers();
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderPapers();
});

elements.favoritesToggle.addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly;
  renderPapers();
});

elements.unreadToggle.addEventListener("click", () => {
  state.unreadOnly = !state.unreadOnly;
  renderPapers();
});

loadData();
