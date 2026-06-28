// ============================================================
// 메타 플로깅 대시보드 - 메인 로직
// ============================================================

const CHART_COLORS = {
  accent: "#5EEAD4",
  accentFill: "rgba(94, 234, 212, 0.12)",
  blue: "#60A5FA",
  text: "#8B98A5",
  grid: "rgba(255,255,255,0.05)"
};

Chart.defaults.font.family = "Pretendard, sans-serif";
Chart.defaults.color = CHART_COLORS.text;

// ---------- 실시간 시계 ----------
function updateClock() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("liveClock").textContent = `${y}.${m}.${d} ${hh}:${mm}`;
}
updateClock();
setInterval(updateClock, 1000 * 30);

// ---------- 상단 지표 채우기 ----------
function fillSummaryStats() {
  document.getElementById("statUsers").textContent = SUMMARY_STATS.totalUsers.toLocaleString();
  document.getElementById("statDistance").textContent = SUMMARY_STATS.totalDistanceKm.toLocaleString();
  document.getElementById("statHours").textContent = SUMMARY_STATS.totalActivityHours.toLocaleString();
  document.getElementById("statPhotos").textContent = SUMMARY_STATS.totalPhotos.toLocaleString();
}
fillSummaryStats();

// ---------- 품질 모니터링 카운트 ----------
function fillQualityStats() {
  document.getElementById("qMissingCoords").textContent = QUALITY_STATS.missingCoords;
  document.getElementById("qMissingPhotos").textContent = QUALITY_STATS.missingPhotos;
  document.getElementById("qIncomplete").textContent = QUALITY_STATS.incompleteSessions;
  const gpsNoiseStats = generateGpsNoiseStats();
  document.getElementById("qGpsNoise").textContent = gpsNoiseStats.totalNoiseCount;
}
fillQualityStats();

// ---------- 시간대별 데이터 수집 추이 차트 ----------
let timeSeriesChart;
function renderTimeSeriesChart(range) {
  const { labels, values } = generateTimeSeriesData(range);
  if (timeSeriesChart) {
    timeSeriesChart.data.labels = labels;
    timeSeriesChart.data.datasets[0].data = values;
    timeSeriesChart.update();
    return;
  }
  const ctx = document.getElementById("timeSeriesChart");
  timeSeriesChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "수집 건수",
        data: values,
        borderColor: CHART_COLORS.accent,
        backgroundColor: CHART_COLORS.accentFill,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { grid: { color: CHART_COLORS.grid }, beginAtZero: true }
      }
    }
  });
}

// ---------- 월별 데이터 수거량 차트 ----------
function renderMonthlyChart() {
  const ctx = document.getElementById("monthlyChart");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTHLY_COLLECTION.labels,
      datasets: [{
        label: "수거량",
        data: MONTHLY_COLLECTION.values,
        backgroundColor: CHART_COLORS.blue,
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: CHART_COLORS.grid }, beginAtZero: true }
      }
    }
  });
}

// ---------- 사용자별 현황 차트 (수거량 막대 + 이동거리 추이, 듀얼 축) ----------
let userStatsChart;
function renderUserStatsChart(range) {
  const users = generateUserStats(range);
  const labels = users.map((u) => u.userNo);
  const collected = users.map((u) => u.collected);
  const distance = users.map((u) => u.distance);

  if (userStatsChart) {
    userStatsChart.data.labels = labels;
    userStatsChart.data.datasets[0].data = collected;
    userStatsChart.data.datasets[1].data = distance;
    userStatsChart.update();
    return;
  }

  const ctx = document.getElementById("userStatsChart");
  userStatsChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "수거량(장)",
          data: collected,
          backgroundColor: CHART_COLORS.accent,
          borderRadius: 5,
          yAxisID: "yLeft",
          order: 2
        },
        {
          type: "line",
          label: "이동거리(km)",
          data: distance,
          borderColor: CHART_COLORS.blue,
          backgroundColor: CHART_COLORS.blue,
          tension: 0.3,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: "yRight",
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true }
        }
      },
      scales: {
        x: { grid: { display: false } },
        yLeft: {
          position: "left",
          grid: { color: CHART_COLORS.grid },
          beginAtZero: true,
          title: { display: true, text: "수거량(장)", color: CHART_COLORS.text, font: { size: 11 } }
        },
        yRight: {
          position: "right",
          grid: { display: false },
          beginAtZero: true,
          title: { display: true, text: "이동거리(km)", color: CHART_COLORS.text, font: { size: 11 } }
        }
      }
    }
  });
}

// ---------- 세그먼트 컨트롤 공통 핸들러 ----------
document.querySelectorAll(".seg-control[data-target]").forEach((control) => {
  const target = control.getAttribute("data-target");
  control.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      control.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (target === "timeSeriesChart") {
        renderTimeSeriesChart(btn.dataset.range);
      } else if (target === "userStatsChart") {
        renderUserStatsChart(btn.dataset.range);
      } else if (target === "map") {
        toggleMapType(btn.dataset.maptype);
      }
    });
  });
});

// ---------- 좌측 토글 (영역 켜고 끄기) ----------
document.querySelectorAll(".nav-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    toggle.classList.toggle("active");
    const sectionId = toggle.dataset.section;
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.style.display = toggle.classList.contains("active") ? "" : "none";

    // 지역 현황을 다시 켤 때 Leaflet 크기 재계산
    if (sectionId === "section-region" && toggle.classList.contains("active") && map) {
      setTimeout(() => map.invalidateSize(), 50);
    }
  });
});

// ---------- 품질 모니터링 카드 클릭 → 상세 리스트 모달 ----------
const modalOverlay = document.getElementById("detailModalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalTableBody = document.getElementById("detailTableBody");

const QUALITY_TITLES = {
  missingCoords: "좌표 누락 세션 목록",
  missingPhotos: "사진 미첨부 세션 목록",
  incompleteSessions: "세션 미완료 건 목록",
  gpsNoise: "GPS 노이즈(이상 좌표) 감지 목록"
};

document.querySelectorAll(".quality-card[data-quality]").forEach((card) => {
  card.addEventListener("click", () => {
    const type = card.dataset.quality;
    const list = type === "gpsNoise"
      ? generateGpsNoiseDetailList()
      : generateQualityDetailList(type);
    modalTitle.textContent = QUALITY_TITLES[type];
    modalTableBody.innerHTML = list
      .map(
        (row) => `
        <tr>
          <td class="mono-cell">${row.sessionId}</td>
          <td>${row.userNo}</td>
          <td class="mono-cell">${row.date}</td>
          <td>${row.detail}</td>
        </tr>`
      )
      .join("");
    modalOverlay.classList.add("open");
  });
});

document.getElementById("modalCloseBtn").addEventListener("click", () => {
  modalOverlay.classList.remove("open");
});
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) modalOverlay.classList.remove("open");
});

// ---------- 지역 현황 (Leaflet 히트맵) ----------
let map;
let heatLayer;
let currentMapType = "date";

function initMap() {
  map = L.map("leafletMap", { zoomControl: true, attributionControl: true }).setView([37.5635, 126.99], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  renderHeatmapByDate(document.getElementById("mapDateInput").value);
}

function renderHeatmapByDate(dateStr) {
  const points = generateHeatmapPoints(dateStr);
  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 14, max: 1.0 }).addTo(map);
}

function renderHeatmapByUser(userNo) {
  const points = generateUserHeatmapPoints(userNo);
  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = L.heatLayer(points, { radius: 30, blur: 24, maxZoom: 14, max: 1.0 }).addTo(map);
}

function populateUserSelect() {
  const select = document.getElementById("mapUserSelect");
  const users = generateUserStats("7days");
  select.innerHTML = users.map((u) => `<option value="${u.userNo}">${u.userNo}</option>`).join("");
}

function toggleMapType(type) {
  currentMapType = type;
  const dateInput = document.getElementById("mapDateInput");
  const userSelect = document.getElementById("mapUserSelect");

  if (type === "date") {
    dateInput.style.display = "";
    userSelect.style.display = "none";
    renderHeatmapByDate(dateInput.value);
  } else {
    dateInput.style.display = "none";
    userSelect.style.display = "";
    if (!userSelect.dataset.populated) {
      populateUserSelect();
      userSelect.dataset.populated = "1";
    }
    renderHeatmapByUser(userSelect.value);
  }
}

document.getElementById("mapDateInput").addEventListener("change", (e) => {
  if (currentMapType === "date") renderHeatmapByDate(e.target.value);
});

document.getElementById("mapUserSelect").addEventListener("change", (e) => {
  if (currentMapType === "user") renderHeatmapByUser(e.target.value);
});

// ---------- 초기 렌더링 ----------
renderTimeSeriesChart("today");
renderMonthlyChart();
renderUserStatsChart("today");
initMap();
