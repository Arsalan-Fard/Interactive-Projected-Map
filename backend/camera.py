"""AprilTag detector with Flask API (pupil_apriltags) and confidence display."""
import argparse
import logging
import sys
import threading
import time
from typing import Union

import cv2
import numpy as np
from flask import Flask, jsonify
from flask_cors import CORS
from pupil_apriltags import Detector

position_lock = threading.Lock()
# relative position (0.0 to 1.0) inside the map formed by ids 1,2,3,4
current_position = {"tags": {}, "detected_ids": []}

app = Flask(__name__)
CORS(app)


@app.route('/api/position', methods=['GET'])
def get_position():
    with position_lock:
        return jsonify(current_position)


def run_flask_server():
    # Suppress Flask/Werkzeug request logs
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)

    print("Starting Flask API on http://localhost:5000/api/position")
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
    window_name = "AprilTag 36h11 Detector"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    boundary_ids = [1, 2, 3, 4]
    min_margin = max(0.0, args.min_margin)
    frame_source = LatestFrame(cap).start()

    while True:
        ok, frame = frame_source.read()
        if not ok:
            time.sleep(0.01)
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detector.detect(gray, estimate_tag_pose=False)

        centers = {}
        all_corners_dict = {}
        found_tags = {}
        detected_ids = []

        for det in detections:
            tag_id = int(det.tag_id)
            detected_ids.append(tag_id)
            all_corners_dict[tag_id] = det.corners
            centers[tag_id] = det.center
            draw_detection(frame, det, min_margin)

        if all(cid in centers for cid in boundary_ids):
            group_cx = sum(centers[cid][0] for cid in boundary_ids) / 4.0
            group_cy = sum(centers[cid][1] for cid in boundary_ids) / 4.0
            group_center = np.array([group_cx, group_cy])

            map_src_pts = []
            for cid in boundary_ids:
                c_corners = all_corners_dict[cid]
                best_corner = None
                min_dist = float('inf')
                for pt in c_corners:
                    dist = np.linalg.norm(pt - group_center)
                    if dist < min_dist:
                        min_dist = dist
                        best_corner = pt
                map_src_pts.append(best_corner)

            src_pts = np.array(map_src_pts, dtype="float32")
            dst_pts = np.array([
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ], dtype="float32")

            M = cv2.getPerspectiveTransform(src_pts, dst_pts)

            for det in detections:
                tag_id = int(det.tag_id)
                if tag_id in boundary_ids:
                    continue
                if args.filter and det.decision_margin < min_margin:
                    continue

                tracked_center = np.array([[det.center]], dtype="float32")
                pts_transformed = cv2.perspectiveTransform(tracked_center, M)
                px = float(pts_transformed[0][0][0])
                py = float(pts_transformed[0][0][1])
                found_tags[str(tag_id)] = {
                    "x": px,
                    "y": py,
                    "id": tag_id,
                    "margin": float(det.decision_margin)
                }

        with position_lock:
            current_position["tags"] = found_tags
            current_position["detected_ids"] = detected_ids

        overlay = f"min margin: {min_margin:.1f}  ([ / ] to adjust, q to quit)"
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
