#!/usr/bin/env python3
"""읽기 전용 SSH 세션으로 MetaPlogging DB 스냅샷을 갱신한다."""

from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


HOST = "203.234.62.117"
PORT = "8080"
USER = "metaplogging-db-guest"
OUTPUT = Path(__file__).with_name("db-snapshot.js")

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
