"""AprilTag detector with Flask API (pupil_apriltags) and confidence display."""
import argparse
import json
import logging
import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from pupil_apriltags import Detector

position_lock = threading.Lock()
# relative position (0.0 to 1.0) inside the map formed by ids 1,2,3,4
current_position = {"tags": {}, "detected_ids": []}

frame_lock = threading.Lock()
latest_frame: Optional[np.ndarray] = None

calibration_lock = threading.Lock()
latest_boundary_src_pts: Optional[np.ndarray] = None  # float32 shape (4, 2) for ids [1,2,3,4]
latest_calibration_updated_at: float = 0.0

CAPTURE_DIR = Path(__file__).resolve().parent / "cache" / "captures"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
CORS(app)


@app.route('/api/position', methods=['GET'])
def get_position():
    with position_lock:
        return jsonify(current_position)


def _safe_component(value: str) -> str:
    if not isinstance(value, str):
        return "unknown"
    value = value.strip()
    if not value:
        return "unknown"
    value = re.sub(r"[^a-zA-Z0-9._-]+", "_", value)
    return value[:80] if value else "unknown"


@app.route('/api/capture-circles', methods=['POST'])
def capture_circles():
    payload = request.get_json(silent=True) or {}
    sticker_colors = payload.get('stickerColors') or payload.get('colors') or []
    try:
        warp_width = payload.get('warpWidth')
        warp_height = payload.get('warpHeight')
        warp_size = payload.get('warpSize')

        if warp_width is None and warp_height is None and warp_size is None:
            warp_width = 1920
            warp_height = 1080
        elif warp_size is not None and warp_width is None and warp_height is None:
            warp_width = int(warp_size)
            warp_height = int(warp_size)
        else:
            warp_width = int(warp_width or 1920)
            warp_height = int(warp_height or 1080)
    except (TypeError, ValueError):
        warp_width = 1920
        warp_height = 1080

    warp_width = max(128, min(4096, int(warp_width)))
    warp_height = max(128, min(4096, int(warp_height)))

    project_id = _safe_component(payload.get('projectId') or "")
    from_question_id = _safe_component(payload.get('fromQuestionId') or payload.get('questionId') or "")

    with frame_lock:
        frame = None if latest_frame is None else latest_frame.copy()

    with calibration_lock:
        src_pts = None if latest_boundary_src_pts is None else latest_boundary_src_pts.copy()
        calib_updated_at = float(latest_calibration_updated_at or 0.0)

    if frame is None:
        return jsonify({"ok": False, "error": "no_frame"}), 503
    if src_pts is None or src_pts.shape != (4, 2):
        return jsonify({"ok": False, "error": "no_calibration"}), 503

    dst_pts = np.array([[0, 0], [warp_width - 1, 0], [warp_width - 1, warp_height - 1], [0, warp_height - 1]], dtype="float32")
    H = cv2.getPerspectiveTransform(src_pts.astype("float32"), dst_pts)
    warped = cv2.warpPerspective(frame, H, (warp_width, warp_height))

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    base = f"{timestamp}__{project_id}__{from_question_id}".strip("_")
    image_path = CAPTURE_DIR / f"{base}.png"
    cv2.imwrite(str(image_path), warped)

    # Debug convenience: keep a stable filename for quick manual inspection / scripts.
    input_path = CAPTURE_DIR / "input.png"
    try:
        cv2.imwrite(str(input_path), warped)
    except Exception:
        pass

    from detect_colored_circles import detect_circles_in_bgr_image

    circles = detect_circles_in_bgr_image(warped, sticker_colors_hex=sticker_colors)
    denom_x = float(max(1, warp_width - 1))
    denom_y = float(max(1, warp_height - 1))
    denom_r = float(max(1, max(warp_width, warp_height) - 1))
    normalized = []
    for c in circles:
        x = int(c.get("x", 0))
        y = int(c.get("y", 0))
        normalized.append({
            "nx": float(x) / denom_x,
            "ny": float(y) / denom_y,
            "radius": float(c.get("radius", 0)) / denom_r,
            "stickerIndex": c.get("stickerIndex", None),
            "color": c.get("color", None),
            "distance": c.get("distance", None),
            "bgr": c.get("bgr", None)
        })

    json_path = CAPTURE_DIR / f"{base}.json"
    try:
        json_path.write_text(json.dumps({
            "capturedAt": timestamp,
            "projectId": payload.get("projectId", None),
            "fromQuestionId": payload.get("fromQuestionId", None),
            "fromQuestionIndex": payload.get("fromQuestionIndex", None),
            "toQuestionId": payload.get("toQuestionId", None),
            "toQuestionIndex": payload.get("toQuestionIndex", None),
            "warpWidth": warp_width,
            "warpHeight": warp_height,
            "calibrationUpdatedAt": calib_updated_at,
            "circles": normalized
        }, indent=2), encoding="utf-8")
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "capturedAt": timestamp,
        "warpWidth": warp_width,
        "warpHeight": warp_height,
        "calibrationUpdatedAt": calib_updated_at,
        "captureFile": image_path.name,
        "circles": normalized
    })


def run_flask_server():
    # Suppress Flask/Werkzeug request logs
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)

    print("Starting Flask API on http://localhost:5000/api/position (and /api/capture-circles)")
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)


def parse_source(value: str) -> Union[int, str]:
    try:
        return int(value)
    except ValueError:
        return value


def build_detector(args) -> Detector:
    return Detector(
        families=args.family,
        nthreads=args.threads,
        quad_decimate=args.quad_decimate,
        quad_sigma=args.quad_sigma,
        refine_edges=args.refine_edges
    )


def draw_detection(frame, det, min_margin: float):
    corners = det.corners.astype(int)
    center = tuple(det.center.astype(int))
    margin = float(det.decision_margin)
    color = (0, 200, 0) if margin >= min_margin else (0, 0, 255)

    cv2.polylines(frame, [corners], isClosed=True, color=color, thickness=2)
    cv2.circle(frame, center, 3, color, -1)
    label = f"id:{det.tag_id} m:{margin:.1f}"
    label_pos = (corners[0][0], max(0, corners[0][1] - 10))
    cv2.putText(frame, label, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)


class LatestFrame:
    def __init__(self, cap: cv2.VideoCapture):
        self.cap = cap
        self.lock = threading.Lock()
        self.frame = None
        self.running = False
        self.thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return self

    def _run(self):
        while self.running:
            ok, frame = self.cap.read()
            if not ok:
                with self.lock:
                    self.frame = None
                time.sleep(0.01)
                continue
            with self.lock:
                self.frame = frame

    def read(self):
        with self.lock:
            if self.frame is None:
                return False, None
            return True, self.frame.copy()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=1)


def detect_and_display(cap: cv2.VideoCapture, detector: Detector, args):
    global latest_frame, latest_boundary_src_pts, latest_calibration_updated_at
    window_name = "AprilTag 36h11 Detector"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    boundary_ids = [1, 2, 3, 4]
    min_margin = max(0.0, args.min_margin)
    frame_source = LatestFrame(cap).start()

    boundary_centers_cache: dict[int, np.ndarray] = {}
    boundary_corners_cache: dict[int, np.ndarray] = {}
    boundary_best_corner_cache: dict[int, np.ndarray] = {}
    perspective_M: Optional[np.ndarray] = None

    while True:
        ok, frame = frame_source.read()
        if not ok:
            time.sleep(0.01)
            continue

        with frame_lock:
            latest_frame = frame.copy()

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detector.detect(gray, estimate_tag_pose=False)

        centers = {}
        all_corners_dict = {}
        margins = {}
        found_tags = {}
        detected_ids = []

        for det in detections:
            tag_id = int(det.tag_id)
            detected_ids.append(tag_id)
            all_corners_dict[tag_id] = det.corners
            centers[tag_id] = det.center
            margins[tag_id] = float(det.decision_margin)
            draw_detection(frame, det, min_margin)

        for cid in boundary_ids:
            margin = margins.get(cid)
            if margin is None:
                continue

            should_update = (
                (margin >= min_margin)
                or (cid not in boundary_centers_cache)
                or (cid not in boundary_corners_cache)
            )
            if should_update and cid in centers:
                boundary_centers_cache[cid] = centers[cid]
            if should_update and cid in all_corners_dict:
                boundary_corners_cache[cid] = all_corners_dict[cid]

        if len(boundary_centers_cache) >= 2 and boundary_corners_cache:
            group_center = np.mean(np.stack(list(boundary_centers_cache.values())), axis=0)
            for cid, c_corners in boundary_corners_cache.items():
                best_corner = None
                min_dist = float("inf")
                for pt in c_corners:
                    dist = float(np.linalg.norm(pt - group_center))
                    if dist < min_dist:
                        min_dist = dist
                        best_corner = pt
                if best_corner is not None:
                    boundary_best_corner_cache[cid] = best_corner

        if all(cid in boundary_best_corner_cache for cid in boundary_ids):
            src_pts = np.array([boundary_best_corner_cache[cid] for cid in boundary_ids], dtype="float32")
            dst_pts = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype="float32")
            perspective_M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            with calibration_lock:
                latest_boundary_src_pts = src_pts.copy()
                latest_calibration_updated_at = time.time()

        if perspective_M is not None:
            for det in detections:
                tag_id = int(det.tag_id)
                if tag_id in boundary_ids:
                    continue
                if args.filter and det.decision_margin < min_margin:
                    continue

                tracked_center = np.array([[det.center]], dtype="float32")
                pts_transformed = cv2.perspectiveTransform(tracked_center, perspective_M)
                px = float(pts_transformed[0][0][0])
                py = float(pts_transformed[0][0][1])
                found_tags[str(tag_id)] = {
                    "x": px,
                    "y": py,
                    "id": tag_id,
                    "margin": float(det.decision_margin),
                }

        with position_lock:
            current_position["tags"] = found_tags
            current_position["detected_ids"] = detected_ids

        overlay = (
            f"min margin: {min_margin:.1f}  "
            f"boundary: {len(boundary_best_corner_cache)}/4  "
            f"([ / ] to adjust, q to quit)"
        )
        cv2.putText(frame, overlay, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        cv2.imshow(window_name, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        if key == ord("["):
            min_margin = max(0.0, min_margin - 1.0)
        if key == ord("]"):
            min_margin += 1.0

    frame_source.stop()
    cap.release()
    cv2.destroyAllWindows()


def main() -> int:
    parser = argparse.ArgumentParser(description="AprilTag detector with confidence display")
    parser.add_argument("--source", default="0", help="Camera index or stream URL")
    parser.add_argument("--family", default="tag36h11", help="Tag family")
    parser.add_argument("--min-margin", type=float, default=20.0, help="Decision margin threshold")
    parser.add_argument("--filter", action="store_true", help="Hide detections below threshold")
    parser.add_argument("--threads", type=int, default=2, help="Detector threads")
    parser.add_argument("--quad-decimate", type=float, default=1.0, help="Decimation factor")
    parser.add_argument("--quad-sigma", type=float, default=0.0, help="Gaussian blur sigma")
    parser.add_argument("--refine-edges", action="store_true", help="Refine edges")
    args = parser.parse_args()

    source = parse_source(args.source)
    detector = build_detector(args)

    server_thread = threading.Thread(target=run_flask_server, daemon=True)
    server_thread.start()

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Could not open video source: {source}")
        return 1
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    try:
        detect_and_display(cap, detector, args)
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
