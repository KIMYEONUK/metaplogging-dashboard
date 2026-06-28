const CHART_COLORS = {
  accent: "#5EEAD4", accentFill: "rgba(94, 234, 212, 0.12)",
  blue: "#60A5FA", text: "#8B98A5", grid: "rgba(255,255,255,0.05)"
};
Chart.defaults.font.family = "Pretendard, sans-serif";
Chart.defaults.color = CHART_COLORS.text;

let timeSeriesChart;
let monthlyChart;
let userStatsChart;
let map;
let heatLayer;
let currentMapType = "date";

function updateClock() {
  const now = new Date();
  document.getElementById("liveClock").textContent = now.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function setConnectionStatus(text, state = "idle") {
  const element = document.getElementById("connectionStatus");
  element.textContent = text;
  element.dataset.state = state;
}

function showError(message) {
  const banner = document.getElementById("errorBanner");
  banner.textContent = message;
  banner.hidden = false;
}

function clearError() { document.getElementById("errorBanner").hidden = true; }

function fillSummaryStats() {
  const stats = dashboardData.summary;
  document.getElementById("statUsers").textContent = stats.totalUsers.toLocaleString();
  document.getElementById("statDistance").textContent = Math.round(stats.totalDistanceKm).toLocaleString();
  document.getElementById("statHours").textContent = Math.round(stats.totalActivityHours).toLocaleString();
  document.getElementById("statPhotos").textContent = stats.totalTrash.toLocaleString();
}

function fillQualityStats() {
  document.getElementById("qMissingCoords").textContent = dashboardData.quality.missingCoords.length;
  document.getElementById("qMissingPhotos").textContent = dashboardData.quality.missingPhotos.length;
  document.getElementById("qIncomplete").textContent = dashboardData.quality.incompleteSessions.length;
  document.getElementById("qGpsNoise").textContent = dashboardData.quality.gpsNoise.length;
}

function renderTimeSeriesChart(range) {
  const { labels, values } = generateTimeSeriesData(range);
  if (timeSeriesChart) {
    timeSeriesChart.data.labels = labels;
    timeSeriesChart.data.datasets[0].data = values;
    timeSeriesChart.update();
    return;
  }
  timeSeriesChart = new Chart(document.getElementById("timeSeriesChart"), {
    type: "line",
    data: { labels, datasets: [{ label: "쓰레기 지점 수", data: values, borderColor: CHART_COLORS.accent,
      backgroundColor: CHART_COLORS.accentFill, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: CHART_COLORS.grid }, beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function renderMonthlyChart() {
  const { labels, values } = getMonthlyCollection();
  if (monthlyChart) {
    monthlyChart.data.labels = labels;
    monthlyChart.data.datasets[0].data = values;
    monthlyChart.update();
    return;
  }
  monthlyChart = new Chart(document.getElementById("monthlyChart"), {
    type: "bar",
    data: { labels, datasets: [{ label: "쓰레기 지점 수", data: values, backgroundColor: CHART_COLORS.blue, borderRadius: 6, maxBarThickness: 36 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: CHART_COLORS.grid }, beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

function renderUserStatsChart() {
  const users = generateUserStats();
  const labels = users.map((user) => user.userNo);
  const collected = users.map((user) => user.collected);
  const distance = users.map((user) => user.distance);
  if (userStatsChart) {
    userStatsChart.data.labels = labels;
    userStatsChart.data.datasets[0].data = collected;
    userStatsChart.data.datasets[1].data = distance;
    userStatsChart.update();
    return;
  }
  userStatsChart = new Chart(document.getElementById("userStatsChart"), {
    data: { labels, datasets: [
      { type: "bar", label: "수거량(개)", data: collected, backgroundColor: CHART_COLORS.accent, borderRadius: 5, yAxisID: "yLeft", order: 2 },
      { type: "line", label: "이동거리(km)", data: distance, borderColor: CHART_COLORS.blue, tension: 0.3,
        pointRadius: 3, borderWidth: 2, yAxisID: "yRight", order: 1 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "top", align: "end", labels: { usePointStyle: true } } },
      scales: {
        x: { grid: { display: false } },
        yLeft: { position: "left", grid: { color: CHART_COLORS.grid }, beginAtZero: true, ticks: { precision: 0 } },
        yRight: { position: "right", grid: { display: false }, beginAtZero: true }
      } }
  });
}

function initMap() {
  map = L.map("leafletMap").setView([37.5635, 126.99], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19
  }).addTo(map);
}

function renderHeat(points) {
  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 14, max: 1 }).addTo(map);
  if (points.length) map.fitBounds(points.map(([lat, lng]) => [lat, lng]), { padding: [30, 30], maxZoom: 14 });
}

function renderHeatmapByDate(date) { renderHeat(generateHeatmapPoints(date)); }
function renderHeatmapByUser(userId) { renderHeat(generateUserHeatmapPoints(userId)); }

function populateUserSelect() {
  const select = document.getElementById("mapUserSelect");
  select.innerHTML = getMapUsers().map((user) => `<option value="${user.userId}">${user.userNo}</option>`).join("");
}

function toggleMapType(type) {
  currentMapType = type;
  const dateInput = document.getElementById("mapDateInput");
  const userSelect = document.getElementById("mapUserSelect");
  dateInput.style.display = type === "date" ? "" : "none";
  userSelect.style.display = type === "user" ? "" : "none";
  if (type === "date") renderHeatmapByDate(dateInput.value);
  else { populateUserSelect(); renderHeatmapByUser(userSelect.value || ""); }
}

function renderAll() {
  fillSummaryStats();
  fillQualityStats();
  renderTimeSeriesChart(document.querySelector('[data-target="timeSeriesChart"] .active').dataset.range);
  renderMonthlyChart();
  renderUserStatsChart();
  populateUserSelect();
  renderHeatmapByDate(document.getElementById("mapDateInput").value);
}

async function refreshDashboard() {
  clearError();
  setConnectionStatus("데이터 동기화 중", "loading");
  try {
    await loadDashboardData();
    renderAll();
    setConnectionStatus("API 연결됨", "online");
    document.getElementById("authOverlay").classList.remove("open");
  } catch (error) {
    if (/401|인증|token|credentials/i.test(error.message)) clearTokens();
    setConnectionStatus("연결 오류", "error");
    showError(error.message);
    if (!hasSession()) document.getElementById("authOverlay").classList.add("open");
  }
}

document.querySelectorAll(".seg-control[data-target]").forEach((control) => {
  control.querySelectorAll(".seg-btn").forEach((button) => button.addEventListener("click", () => {
    control.querySelectorAll(".seg-btn").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    if (control.dataset.target === "timeSeriesChart") renderTimeSeriesChart(button.dataset.range);
    if (control.dataset.target === "map") toggleMapType(button.dataset.maptype);
  }));
});

document.querySelectorAll(".nav-toggle").forEach((toggle) => toggle.addEventListener("click", () => {
  toggle.classList.toggle("active");
  const section = document.getElementById(toggle.dataset.section);
  if (section) section.style.display = toggle.classList.contains("active") ? "" : "none";
  if (toggle.dataset.section === "section-region" && map) setTimeout(() => map.invalidateSize(), 50);
}));

const modalOverlay = document.getElementById("detailModalOverlay");
document.querySelectorAll(".quality-card[data-quality]").forEach((card) => card.addEventListener("click", () => {
  const titles = { missingCoords: "좌표 누락 세션 목록", missingPhotos: "사진 미첨부 세션 목록",
    incompleteSessions: "세션 미완료 건 목록", gpsNoise: "GPS 노이즈 감지 목록" };
  document.getElementById("modalTitle").textContent = titles[card.dataset.quality];
  const rows = getQualityDetailList(card.dataset.quality);
  document.getElementById("detailTableBody").innerHTML = rows.length ? rows.map((row) => `<tr>
    <td class="mono-cell">${row.sessionId}</td><td>${row.userNo}</td><td>${row.date}</td><td>${row.detail}</td></tr>`).join("")
    : '<tr><td colspan="4" class="empty-cell">해당 항목이 없습니다.</td></tr>';
  modalOverlay.classList.add("open");
}));
document.getElementById("modalCloseBtn").addEventListener("click", () => modalOverlay.classList.remove("open"));
modalOverlay.addEventListener("click", (event) => { if (event.target === modalOverlay) modalOverlay.classList.remove("open"); });

document.getElementById("mapDateInput").value = new Date().toISOString().slice(0, 10);
document.getElementById("mapDateInput").addEventListener("change", (event) => renderHeatmapByDate(event.target.value));
document.getElementById("mapUserSelect").addEventListener("change", (event) => renderHeatmapByUser(event.target.value));
document.getElementById("refreshBtn").addEventListener("click", refreshDashboard);
document.getElementById("logoutBtn").addEventListener("click", () => {
  clearTokens();
  setConnectionStatus("로그인 필요", "idle");
  document.getElementById("authOverlay").classList.add("open");
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const error = document.getElementById("loginError");
  button.disabled = true;
  error.textContent = "";
  try {
    await login(document.getElementById("loginUsername").value.trim(), document.getElementById("loginPassword").value);
    document.getElementById("loginPassword").value = "";
    await refreshDashboard();
  } catch (loginError) { error.textContent = loginError.message; }
  finally { button.disabled = false; }
});

updateClock();
setInterval(updateClock, 30000);
initMap();
if (hasSession()) refreshDashboard();
else document.getElementById("authOverlay").classList.add("open");
