// MetaPlogging API 연결 및 대시보드용 데이터 가공
const API_BASE_URL = (window.METAPLOGGING_CONFIG?.apiBaseUrl || "http://203.234.62.117:8000/api").replace(/\/$/, "");
const TOKEN_KEY = "metaplogging_dashboard_tokens";

const dashboardData = {
  summary: { totalUsers: 0, totalDistanceKm: 0, totalActivityHours: 0, totalTrash: 0 },
  leaderboard: [],
  sessions: [],
  details: [],
  trashPoints: [],
  quality: { missingCoords: [], missingPhotos: [], incompleteSessions: [], gpsNoise: [] }
};

function getTokens() {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY)) || {}; } catch { return {}; }
}

function setTokens(payload) {
  const current = getTokens();
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
    accessToken: payload.access_token || current.accessToken,
    refreshToken: payload.refresh_token || current.refreshToken
  }));
}

function clearTokens() { sessionStorage.removeItem(TOKEN_KEY); }
function hasSession() { return Boolean(getTokens().accessToken); }

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function refreshAccessToken() {
  const { refreshToken } = getTokens();
  if (!refreshToken) return false;
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) return false;
  setTokens(await response.json());
  return true;
}

async function apiFetch(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  const { accessToken } = getTokens();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error(location.protocol === "https:" && API_BASE_URL.startsWith("http:")
      ? "HTTPS 페이지에서는 HTTP API가 차단됩니다. HTTPS 프록시가 필요합니다."
      : `API 서버에 연결할 수 없습니다: ${error.message}`);
  }

  if (response.status === 401 && retry && await refreshAccessToken()) {
    return apiFetch(path, options, false);
  }
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(body?.detail || `API 요청 실패 (${response.status})`);
  return body;
}

async function login(username, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(body?.detail || "로그인에 실패했습니다.");
  setTokens(body);
  return body;
}

async function fetchAllSessions() {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    const page = await apiFetch(`/tracking/sessions?limit=100&offset=${offset}`);
    result.push(...page);
    if (page.length < 100) return result;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

function trashCount(items = []) {
  const levels = { little: 5, moderate: 20, a_lot: 40 };
  return items.reduce((sum, item) => sum + (item.amount?.count ?? levels[item.amount?.level] ?? 0), 0);
}

function qualityRow(session, detail) {
  return {
    sessionId: session.id,
    userNo: `#${String(session.user_id).slice(0, 8)}`,
    date: new Date(session.started_at).toLocaleDateString("ko-KR"),
    detail
  };
}

async function loadDashboardData() {
  const [summary, leaderboard, sessions] = await Promise.all([
    apiFetch("/users/stats/summary"),
    apiFetch("/users/stats/leaderboard?sort_by=distance&limit=100"),
    fetchAllSessions()
  ]);

  const details = await mapWithConcurrency(sessions, 6, async (session) => {
    const [detail, points] = await Promise.all([
      apiFetch(`/tracking/sessions/${encodeURIComponent(session.id)}`),
      apiFetch(`/tracking/sessions/${encodeURIComponent(session.id)}/trash-points`)
    ]);
    return { ...detail, trashPoints: points };
  });

  dashboardData.summary = {
    totalUsers: summary.total_users,
    totalDistanceKm: summary.total_distance_meters / 1000,
    totalActivityHours: leaderboard.items.reduce((sum, user) => sum + user.total_duration_seconds, 0) / 3600,
    totalTrash: summary.total_trash_count
  };
  dashboardData.leaderboard = leaderboard.items;
  dashboardData.sessions = sessions;
  dashboardData.details = details;
  dashboardData.trashPoints = details.flatMap((detail) => detail.trashPoints.map((point) => ({
    ...point, sessionId: detail.id, userId: detail.user_id
  })));

  dashboardData.quality.missingCoords = details
    .filter((detail) => !detail.points?.length)
    .map((detail) => qualityRow(detail, "GPS 좌표 없음"));
  dashboardData.quality.missingPhotos = details
    .filter((detail) => !detail.photos?.length)
    .map((detail) => qualityRow(detail, "사진 미첨부"));
  dashboardData.quality.incompleteSessions = details
    .filter((detail) => detail.status !== "completed")
    .map((detail) => qualityRow(detail, `현재 상태: ${detail.status}`));
  dashboardData.quality.gpsNoise = buildGpsNoiseRows(details, qualityRow);
  return dashboardData;
}

function rangeStart(range) {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = range === "7days" ? 6 : 29;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

function generateTimeSeriesData(range) {
  const now = new Date();
  if (range === "today") {
    const labels = Array.from({ length: 24 }, (_, hour) => `${hour}시`);
    const values = Array(24).fill(0);
    dashboardData.trashPoints.forEach((point) => {
      const date = new Date(point.recorded_at);
      if (date >= rangeStart(range)) values[date.getHours()] += 1;
    });
    return { labels, values };
  }
  const days = range === "7days" ? 7 : 30;
  const dates = Array.from({ length: days }, (_, index) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index));
    return d;
  });
  const key = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const counts = new Map(dates.map((date) => [key(date), 0]));
  dashboardData.trashPoints.forEach((point) => {
    const date = new Date(point.recorded_at);
    const k = key(date);
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  });
  return {
    labels: dates.map((date) => `${date.getMonth() + 1}/${date.getDate()}`),
    values: dates.map((date) => counts.get(key(date)))
  };
}

function getMonthlyCollection() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - (5 - index), 1));
  const key = (date) => `${date.getFullYear()}-${date.getMonth()}`;
  const counts = new Map(months.map((date) => [key(date), 0]));
  dashboardData.trashPoints.forEach((point) => {
    const date = new Date(point.recorded_at);
    const k = key(date);
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  });
  return {
    labels: months.map((date) => `${date.getMonth() + 1}월`),
    values: months.map((date) => counts.get(key(date)))
  };
}

function generateUserStats() {
  return dashboardData.leaderboard.map((user) => ({
    userNo: `#${String(user.user_id).slice(0, 8)}`,
    userId: user.user_id,
    collected: user.total_trash_count,
    distance: Math.round(user.total_distance_meters / 100) / 10
  }));
}

function getMapUsers() {
  const users = new Map();
  dashboardData.details.forEach((detail) => users.set(detail.user_id, `#${String(detail.user_id).slice(0, 8)}`));
  return [...users].map(([userId, userNo]) => ({ userId, userNo }));
}

function generateHeatmapPoints(dateKey) {
  return dashboardData.trashPoints
    .filter((point) => !dateKey || point.recorded_at.slice(0, 10) === dateKey)
    .map((point) => [point.lat, point.lng, 1]);
}

function generateUserHeatmapPoints(userId) {
  return dashboardData.trashPoints
    .filter((point) => point.userId === userId)
    .map((point) => [point.lat, point.lng, 1]);
}

function getQualityDetailList(type) { return dashboardData.quality[type] || []; }
