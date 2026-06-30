// sync_db.py가 만든 실제 DB 스냅샷을 대시보드 형식으로 가공합니다.
const DB_SNAPSHOT = window.METAPLOGGING_SNAPSHOT || {
  generatedAt: null,
  summary: { totalUsers: 0, totalSessions: 0, totalDistanceKm: 0, totalActivityHours: 0, totalPhotos: 0 },
  sessions: [], photos: [], pointSessionIds: [],
  gpsNoise: { speedLimitKmh: 20, totalNoiseCount: 0, items: [] }
};
const USING_REAL_DATA = Boolean(DB_SNAPSHOT.generatedAt);

const SUMMARY_STATS = {
  totalUsers: Number(DB_SNAPSHOT.summary.totalUsers || 0),
  totalDistanceKm: Number(DB_SNAPSHOT.summary.totalDistanceKm || 0),
  totalActivityHours: Number(DB_SNAPSHOT.summary.totalActivityHours || 0),
  totalPhotos: Number(DB_SNAPSHOT.summary.totalPhotos || 0)
};

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rangeStart(range) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "7days") start.setDate(start.getDate() - 6);
  if (range === "30days") start.setDate(start.getDate() - 29);
  return start;
}

function generateTimeSeriesData(range) {
  const photos = DB_SNAPSHOT.photos || [];
  if (range === "today") {
    const values = Array(24).fill(0);
    const today = dateKey(new Date());
    photos.forEach((photo) => {
      if (dateKey(photo.takenAt) === today) values[new Date(photo.takenAt).getHours()] += 1;
    });
    return { labels: Array.from({ length: 24 }, (_, hour) => `${hour}시`), values };
  }
  const count = range === "7days" ? 7 : 30;
  const dates = Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (count - 1 - index));
    return date;
  });
  const valuesByDate = new Map(dates.map((date) => [dateKey(date), 0]));
  photos.forEach((photo) => {
    const key = dateKey(photo.takenAt);
    if (valuesByDate.has(key)) valuesByDate.set(key, valuesByDate.get(key) + 1);
  });
  return {
    labels: dates.map((date) => `${date.getMonth() + 1}/${date.getDate()}`),
    values: dates.map((date) => valuesByDate.get(dateKey(date)))
  };
}

function buildMonthlyCollection() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - (5 - index), 1));
  const monthKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${date.getMonth()}`;
  };
  const values = new Map(months.map((date) => [monthKey(date), 0]));
  (DB_SNAPSHOT.photos || []).forEach((photo) => {
    const key = monthKey(photo.takenAt);
    if (values.has(key)) values.set(key, values.get(key) + 1);
  });
  return {
    labels: months.map((date) => `${date.getMonth() + 1}월`),
    values: months.map((date) => values.get(monthKey(date)))
  };
}
const MONTHLY_COLLECTION = buildMonthlyCollection();

function userNumber(userId) { return `#${String(userId).slice(0, 8)}`; }

function generateUserStats(range) {
  const start = rangeStart(range);
  const sessions = (DB_SNAPSHOT.sessions || []).filter((session) => new Date(session.startedAt) >= start);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const collectedByUser = new Map();
  const sessionUser = new Map(sessions.map((session) => [session.id, session.userId]));
  (DB_SNAPSHOT.photos || []).forEach((photo) => {
    if (!sessionIds.has(photo.sessionId)) return;
    const userId = sessionUser.get(photo.sessionId);
    collectedByUser.set(userId, (collectedByUser.get(userId) || 0) + 1);
  });
  const byUser = new Map();
  sessions.forEach((session) => {
    const current = byUser.get(session.userId) || { userId: session.userId, collected: 0, distance: 0 };
    current.distance += Number(session.distanceMeters || 0) / 1000;
    current.collected = collectedByUser.get(session.userId) || 0;
    byUser.set(session.userId, current);
  });
  return [...byUser.values()]
    .map((user) => ({ ...user, userNo: userNumber(user.userId), distance: Math.round(user.distance * 10) / 10 }))
    .sort((a, b) => b.collected - a.collected || b.distance - a.distance);
}

function sessionForPhoto(photo) {
  return (DB_SNAPSHOT.sessions || []).find((session) => session.id === photo.sessionId);
}

function generateHeatmapPoints(selectedDate) {
  return (DB_SNAPSHOT.photos || [])
    .filter((photo) => photo.lat != null && photo.lng != null && (!selectedDate || dateKey(photo.takenAt) === selectedDate))
    .map((photo) => [Number(photo.lat), Number(photo.lng), 1]);
}

function generateUserHeatmapPoints(userNo) {
  return (DB_SNAPSHOT.photos || [])
    .filter((photo) => {
      const session = sessionForPhoto(photo);
      return session && userNumber(session.userId) === userNo && photo.lat != null && photo.lng != null;
    })
    .map((photo) => [Number(photo.lat), Number(photo.lng), 1]);
}

function qualityRow(session, detail) {
  return {
    sessionId: session.id,
    userNo: userNumber(session.userId),
    date: new Date(session.startedAt).toLocaleDateString("ko-KR"),
    detail
  };
}

function buildQualityLists() {
  const pointsBySession = new Set(DB_SNAPSHOT.pointSessionIds || []);
  const photosBySession = new Set((DB_SNAPSHOT.photos || []).map((photo) => photo.sessionId));
  const sessions = DB_SNAPSHOT.sessions || [];
  return {
    missingCoords: sessions.filter((session) => !pointsBySession.has(session.id)).map((session) => qualityRow(session, "GPS 좌표 없음")),
    missingPhotos: sessions.filter((session) => !photosBySession.has(session.id)).map((session) => qualityRow(session, "사진 미첨부")),
    incompleteSessions: sessions.filter((session) => session.status !== "completed").map((session) => qualityRow(session, `현재 상태: ${session.status}`))
  };
}
const QUALITY_LISTS = buildQualityLists();
const QUALITY_STATS = {
  missingCoords: QUALITY_LISTS.missingCoords.length,
  missingPhotos: QUALITY_LISTS.missingPhotos.length,
  incompleteSessions: QUALITY_LISTS.incompleteSessions.length
};

function generateQualityDetailList(type) { return QUALITY_LISTS[type] || []; }

function getLatestDataDate() {
  const dates = (DB_SNAPSHOT.photos || []).map((photo) => new Date(photo.takenAt)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return "";
  return dateKey(new Date(Math.max(...dates)));
}
