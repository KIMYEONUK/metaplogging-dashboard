// ============================================================
// MetaPlogging 대시보드 - 더미 데이터
// 실제 DB 연동 전까지 사용하는 샘플 데이터
// 추후 35번 서버 API 연동 시 이 파일의 함수들을 fetch()로 교체
// ============================================================

// 시드 기반 랜덤 (매번 같은 모양의 그래프가 나오도록)
function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// ---------- 상단 지표 (전체 데이터 수집 현황) ----------
const SUMMARY_STATS = {
  totalUsers: 1284,
  totalDistanceKm: 18420,
  totalActivityHours: 9870,
  totalPhotos: 42150
};

// ---------- 시간대별 데이터 수집 추이 ----------
function generateTimeSeriesData(range) {
  // range: 'today' | '7days' | '30days'
  const configs = {
    today: { points: 24, labelFn: (i) => `${i}시` },
    "7days": { points: 7, labelFn: (i) => ["월", "화", "수", "목", "금", "토", "일"][i] },
    "30days": { points: 30, labelFn: (i) => `${i + 1}일` }
  };
  const cfg = configs[range];
  const labels = [];
  const values = [];
  for (let i = 0; i < cfg.points; i++) {
    labels.push(cfg.labelFn(i));
    const base = range === "today"
      ? 20 + Math.sin(i / 3) * 15 + seededRandom(i + 1) * 10
      : range === "7days"
      ? 80 + Math.sin(i) * 30 + seededRandom(i + 10) * 20
      : 60 + Math.sin(i / 4) * 25 + seededRandom(i + 20) * 15;
    values.push(Math.max(0, Math.round(base)));
  }
  return { labels, values };
}

// ---------- 월별 데이터 수거량 ----------
const MONTHLY_COLLECTION = {
  labels: ["1월", "2월", "3월", "4월", "5월", "6월"],
  values: [1820, 2340, 3120, 3680, 4250, 3960]
};

// ---------- 사용자별 현황 (수거량 + 이동거리) ----------
function generateUserStats(range) {
  // range: 'today' | '7days'
  const count = 18; // 활동한 사용자 수
  const users = [];
  for (let i = 1; i <= count; i++) {
    const seed = range === "today" ? i : i + 100;
    const collected = Math.round(15 + seededRandom(seed) * 85);
    const distance = Math.round((1 + seededRandom(seed + 50) * 8) * 10) / 10;
    users.push({ userNo: `#${1000 + i}`, collected, distance });
  }
  // 수거량 순 정렬
  users.sort((a, b) => b.collected - a.collected);
  return users;
}

// ---------- 지역 현황 (히트맵 좌표) ----------
// 서울 시내 임의 좌표 클러스터 (실제 GPS 데이터 들어오면 교체)
function generateHeatmapPoints(dateKey) {
  const clusters = [
    { lat: 37.5665, lng: 126.978, weight: 1.0 },   // 시청
    { lat: 37.5512, lng: 126.9882, weight: 0.8 },  // 남산
    { lat: 37.5219, lng: 127.1265, weight: 0.6 },  // 잠실
    { lat: 37.5796, lng: 126.977, weight: 0.7 },   // 경복궁
    { lat: 37.5443, lng: 127.0557, weight: 0.5 }   // 성수
  ];
  const points = [];
  const seedOffset = dateKey ? dateKey.length * 7 : 0;
  clusters.forEach((c, ci) => {
    const num = Math.round(8 + seededRandom(ci + seedOffset) * 12);
    for (let i = 0; i < num; i++) {
      const jitter = 0.012;
      points.push([
        c.lat + (seededRandom(ci * 100 + i + seedOffset) - 0.5) * jitter,
        c.lng + (seededRandom(ci * 100 + i + 50 + seedOffset) - 0.5) * jitter,
        c.weight
      ]);
    }
  });
  return points;
}

// 사람별 히트맵 (특정 유저 1명의 활동 좌표만)
function generateUserHeatmapPoints(userNo) {
  const seed = parseInt(userNo.replace("#", ""), 10) || 1;
  const baseClusters = [
    { lat: 37.5665, lng: 126.978 },
    { lat: 37.5512, lng: 126.9882 },
    { lat: 37.5219, lng: 127.1265 }
  ];
  const cluster = baseClusters[seed % baseClusters.length];
  const points = [];
  const num = 6 + Math.round(seededRandom(seed) * 10);
  for (let i = 0; i < num; i++) {
    const jitter = 0.01;
    points.push([
      cluster.lat + (seededRandom(seed * 10 + i) - 0.5) * jitter,
      cluster.lng + (seededRandom(seed * 10 + i + 5) - 0.5) * jitter,
      0.8
    ]);
  }
  return points;
}

// ---------- 품질 모니터링 ----------
const QUALITY_STATS = {
  missingCoords: 8,      // 좌표 누락 세션
  missingPhotos: 15,     // 사진 미첨부 세션
  incompleteSessions: 21 // 세션 미완료 건
  // GPS 노이즈 탐지: 어려움 선택 - 추후 구현
  // DB 무결성 검증: 어려움 선택 - 추후 구현
};

// 품질 모니터링 클릭 시 리스트업되는 상세 데이터
function generateQualityDetailList(type) {
  // type: 'missingCoords' | 'missingPhotos' | 'incompleteSessions'
  const counts = { missingCoords: 8, missingPhotos: 15, incompleteSessions: 21 };
  const count = counts[type];
  const list = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(2026, 5, Math.max(1, 11 - (i % 10)));
    const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    list.push({
      sessionId: `SES-${10000 + i}`,
      userNo: `#${1000 + (i % 18) + 1}`,
      date: dateStr,
      detail:
        type === "missingCoords"
          ? "좌표 일부 누락"
          : type === "missingPhotos"
          ? "사진 미첨부"
          : "활동 종료 처리 안 됨"
    });
  }
  return list;
}
