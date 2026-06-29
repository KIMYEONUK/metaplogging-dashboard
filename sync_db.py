#!/usr/bin/env python3
"""읽기 전용 SSH 세션으로 MetaPlogging DB 스냅샷을 갱신한다."""

from __future__ import annotations

import getpass
import json
import os
from collections import Counter, defaultdict
from pathlib import Path
import stat
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


HOST = "203.234.62.117"
PORT = "8080"
USER = "metaplogging-db-guest"
OUTPUT = Path(__file__).with_name("db-snapshot.js")
CACHE_PATH = Path(__file__).with_name("geocode-cache.json")
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_USER_AGENT = "MetaPloggingDashboard/1.0 (+https://kimyeonuk.github.io/metaplogging-dashboard/)"

SQL = r"""
\pset format unaligned
\pset tuples_only on
\pset pager off
\echo __METAPLOGGING_DATA_START__
SELECT json_build_object(
  'generatedAt', now(),
  'summary', json_build_object(
    'totalUsers', (SELECT count(*) FROM users),
    'totalSessions', (SELECT count(*) FROM tracking_sessions),
    'totalDistanceKm', (SELECT round(coalesce(sum(distance_meters), 0)::numeric / 1000, 1) FROM tracking_sessions),
    'totalActivityHours', (SELECT round(coalesce(sum(duration_seconds), 0)::numeric / 3600, 1) FROM tracking_sessions),
    'totalPhotos', (SELECT count(*) FROM session_photos)
  ),
  'sessions', coalesce((
    SELECT json_agg(json_build_object(
      'id', s.id,
      'userId', s.user_id,
      'status', s.status,
      'startedAt', s.started_at,
      'endedAt', s.ended_at,
      'durationSeconds', coalesce(s.duration_seconds, 0),
      'distanceMeters', coalesce(s.distance_meters, 0),
      'district', coalesce((
        SELECT nullif(split_part(trim(coalesce(p.road_address, p.address)), ' ', 2), '')
        FROM places p WHERE p.id = s.place_id
      ), '미지정')
    ) ORDER BY s.started_at)
    FROM tracking_sessions s
  ), '[]'::json),
  'photos', coalesce((
    SELECT json_agg(json_build_object(
      'id', p.id,
      'sessionId', p.session_id,
      'lat', p.lat,
      'lng', p.lng,
      'takenAt', coalesce(p.taken_at, p.created_at)
    ) ORDER BY coalesce(p.taken_at, p.created_at))
    FROM session_photos p
  ), '[]'::json),
  'points', coalesce((
    SELECT json_agg(json_build_object(
      'sessionId', p.session_id,
      'lat', p.lat,
      'lng', p.lng,
      'recordedAt', p.recorded_at
    ) ORDER BY p.session_id, p.recorded_at)
    FROM tracking_points p
  ), '[]'::json)
);
\echo __METAPLOGGING_DATA_END__
\q
"""


def coord_key(lat: float, lng: float) -> str:
    """외부 전송과 캐시에 사용하는 약 100m 정밀도의 좌표 키."""
    return f"{float(lat):.3f},{float(lng):.3f}"


def load_geocode_cache() -> dict[str, str]:
    if not CACHE_PATH.exists():
        return {}
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_geocode_cache(cache: dict[str, str]) -> None:
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def reverse_geocode_district(lat: float, lng: float) -> str | None:
    query = urlencode({
        "lat": f"{lat:.3f}",
        "lon": f"{lng:.3f}",
        "format": "jsonv2",
        "accept-language": "ko",
        "zoom": "10",
    })
    request = Request(
        f"{NOMINATIM_URL}?{query}",
        headers={"User-Agent": NOMINATIM_USER_AGENT, "Referer": "https://kimyeonuk.github.io/"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            address = json.load(response).get("address", {})
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None
    return (
        address.get("borough")
        or address.get("city_district")
        or address.get("suburb")
        or address.get("county")
        or address.get("city")
    )


def enrich_session_districts(snapshot: dict) -> None:
    """사진 좌표가 없으면 같은 세션의 대표 GPS 좌표로 지역을 보완."""
    photos = [
        photo for photo in snapshot.get("photos", [])
        if photo.get("lat") is not None and photo.get("lng") is not None
    ]
    photo_session_ids = {
        photo["sessionId"] for photo in snapshot.get("photos", [])
    }
    point_keys_by_session: dict[str, list[str]] = defaultdict(list)
    for point in snapshot.get("points", []):
        if point["sessionId"] in photo_session_ids:
            point_keys_by_session[point["sessionId"]].append(
                coord_key(point["lat"], point["lng"])
            )

    photo_keys_by_session: dict[str, list[str]] = defaultdict(list)
    for photo in photos:
        photo_keys_by_session[photo["sessionId"]].append(
            coord_key(photo["lat"], photo["lng"])
        )

    # 사진 위치를 우선하고, 사진 위치가 없을 때만 해당 활동의 GPS 최빈 좌표를 쓴다.
    location_keys_by_session: dict[str, list[str]] = {}
    for session_id in photo_session_ids:
        if photo_keys_by_session.get(session_id):
            location_keys_by_session[session_id] = photo_keys_by_session[session_id]
        elif point_keys_by_session.get(session_id):
            representative = Counter(point_keys_by_session[session_id]).most_common(1)[0][0]
            location_keys_by_session[session_id] = [representative]

    cache = load_geocode_cache()
    unique_coords = {}
    for keys in location_keys_by_session.values():
        for key in keys:
            lat_text, lng_text = key.split(",")
            unique_coords[key] = (float(lat_text), float(lng_text))

    missing = [key for key in unique_coords if key not in cache]
    if missing:
        print(f"새 위치 {len(missing)}개를 시·군·구로 변환합니다.")
    for index, key in enumerate(missing, 1):
        lat, lng = unique_coords[key]
        district = reverse_geocode_district(lat, lng)
        if district:
            cache[key] = district
            save_geocode_cache(cache)
        print(f"지역 변환 {index}/{len(missing)}")
        if index < len(missing):
            time.sleep(1.1)

    districts_by_session: dict[str, list[str]] = defaultdict(list)
    for session_id, keys in location_keys_by_session.items():
        for key in keys:
            district = cache.get(key)
            if district:
                districts_by_session[session_id].append(district)

    for session in snapshot.get("sessions", []):
        if session.get("district") and session["district"] != "미지정":
            continue
        districts = districts_by_session.get(session["id"], [])
        if districts:
            session["district"] = Counter(districts).most_common(1)[0][0]


def make_public_snapshot(snapshot: dict) -> dict:
    """개인 식별자를 제거하고 위치 정밀도를 낮춘 공개용 데이터로 변환한다."""
    sessions = snapshot.get("sessions", [])
    user_ids = sorted({session["userId"] for session in sessions})
    user_aliases = {user_id: f"USR-{index:04d}" for index, user_id in enumerate(user_ids, 1)}
    session_aliases = {session["id"]: f"SES-{index:05d}" for index, session in enumerate(sessions, 1)}

    public_sessions = [{
        **session,
        "id": session_aliases[session["id"]],
        "userId": user_aliases[session["userId"]],
    } for session in sessions]

    public_photos = []
    for index, photo in enumerate(snapshot.get("photos", []), 1):
        public_photos.append({
            "id": f"PHOTO-{index:05d}",
            "sessionId": session_aliases.get(photo["sessionId"], "SES-UNKNOWN"),
            "lat": round(float(photo["lat"]), 3) if photo.get("lat") is not None else None,
            "lng": round(float(photo["lng"]), 3) if photo.get("lng") is not None else None,
            "takenAt": photo.get("takenAt"),
        })

    public_points = [{
        "sessionId": session_aliases.get(point["sessionId"], "SES-UNKNOWN"),
        "lat": round(float(point["lat"]), 3),
        "lng": round(float(point["lng"]), 3),
        "recordedAt": point["recordedAt"],
    } for point in snapshot.get("points", [])]

    return {
        "generatedAt": snapshot["generatedAt"],
        "summary": snapshot["summary"],
        "sessions": public_sessions,
        "photos": public_photos,
        "points": public_points,
        "privacy": "Identifiers anonymized; coordinates rounded to 3 decimals.",
    }


def main() -> None:
    password = getpass.getpass("DB 비밀번호: ")
    if not password:
        raise SystemExit("비밀번호가 입력되지 않았습니다.")

    askpass_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", prefix="metaplogging-askpass-", suffix=".sh", delete=False) as helper:
            helper.write("#!/bin/sh\nprintf '%s\\n' \"$METAPLOGGING_DB_PASSWORD\"\n")
            askpass_path = Path(helper.name)
        askpass_path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)

        env = os.environ.copy()
        env.update({
            "DISPLAY": ":0",
            "SSH_ASKPASS_REQUIRE": "force",
            "SSH_ASKPASS": str(askpass_path),
            "METAPLOGGING_DB_PASSWORD": password,
        })
        command = [
            "ssh", "-T",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            "-o", "NumberOfPasswordPrompts=1",
            "-o", "ConnectTimeout=15",
            "-p", PORT,
            f"{USER}@{HOST}",
        ]
        # SSH 인증과 자동 실행된 psql이 같은 기존 비밀번호를 각각 사용한다.
        try:
            result = subprocess.run(
                command,
                input=f"{password}\n{SQL}",
                text=True,
                capture_output=True,
                env=env,
                timeout=120,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise SystemExit("갱신 실패: DB 서버 응답 시간이 초과되었습니다. 잠시 후 다시 실행해 주세요.") from error
        start_marker = "__METAPLOGGING_DATA_START__"
        end_marker = "__METAPLOGGING_DATA_END__"
        if result.returncode != 0 or start_marker not in result.stdout or end_marker not in result.stdout:
            message = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "DB 응답을 확인할 수 없습니다."
            raise SystemExit(f"갱신 실패: {message}")

        payload = result.stdout.split(start_marker, 1)[1].split(end_marker, 1)[0].strip()
        snapshot = json.loads(payload)
        enrich_session_districts(snapshot)
        public_snapshot = make_public_snapshot(snapshot)
        serialized = json.dumps(public_snapshot, ensure_ascii=False, separators=(",", ":"))
        OUTPUT.write_text(
            "// 익명화된 읽기 전용 DB 통계 스냅샷입니다.\n"
            f"window.METAPLOGGING_SNAPSHOT = {serialized};\n",
            encoding="utf-8",
        )
        summary = snapshot["summary"]
        print(f"갱신 완료: 사용자 {summary['totalUsers']}명, 세션 {summary['totalSessions']}건, 사진 {summary['totalPhotos']}장")
        print(f"생성 파일: {OUTPUT}")
    finally:
        password = ""
        if askpass_path:
            askpass_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
