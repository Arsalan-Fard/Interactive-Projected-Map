"""AprilTag detector with Flask API (pupil_apriltags) and confidence display."""
import argparse
import logging
import sys
import threading
import time
from typing import Union

import cv2
import numpy as np
from flask import Flask, Response, jsonify
from flask_cors import CORS
from pupil_apriltags import Detector

position_lock = threading.Lock()
# relative position (0.0 to 1.0) inside the map formed by ids 1,2,3,4
current_position = {"tags": {}, "detected_ids": []}

canvas_lock = threading.Lock()
drawing_canvas = None
drawing_canvas_draw_id = 5

app = Flask(__name__)
CORS(app)


@app.route('/api/position', methods=['GET'])
def get_position():
    with position_lock:
        return jsonify(current_position)

@app.route('/api/canvas.png', methods=['GET'])
def get_canvas_png():
    with canvas_lock:
        if drawing_canvas is None:
            return ("", 404)
        ok, buf = cv2.imencode(".png", drawing_canvas)
    if not ok:
        return ("", 500)
    resp = Response(buf.tobytes(), mimetype="image/png")
    resp.headers["X-Draw-Tag-Id"] = str(drawing_canvas_draw_id)
    return resp


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

def build_canvas(size: int) -> np.ndarray:
    size = int(size)
    size = max(64, size)
    canvas = np.full((size, size, 3), 255, dtype=np.uint8)
    border_color = (200, 200, 200)
    cv2.rectangle(canvas, (0, 0), (size - 1, size - 1), border_color, 2)
    cv2.putText(canvas, "1", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (50, 50, 50), 2)
    cv2.putText(canvas, "2", (size - 28, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (50, 50, 50), 2)
    cv2.putText(canvas, "3", (size - 28, size - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (50, 50, 50), 2)
    cv2.putText(canvas, "4", (8, size - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (50, 50, 50), 2)
    return canvas


def detect_and_display(cap: cv2.VideoCapture, detector: Detector, args):
    window_name = "AprilTag 36h11 Detector"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    canvas_window = f"Canvas (draw id {args.draw_id})"
    cv2.namedWindow(canvas_window, cv2.WINDOW_NORMAL)
    canvas_size = int(args.canvas_size)
    cv2.resizeWindow(canvas_window, canvas_size, canvas_size)

    boundary_ids = [1, 2, 3, 4]
    min_margin = max(0.0, args.min_margin)
    draw_calib_margin = 0.12
    draw_calib_targets = {
        1: (draw_calib_margin, draw_calib_margin),
        2: (1.0 - draw_calib_margin, draw_calib_margin),
        3: (1.0 - draw_calib_margin, 1.0 - draw_calib_margin),
        4: (draw_calib_margin, 1.0 - draw_calib_margin),
    }
    frame_source = LatestFrame(cap).start()

    global drawing_canvas
    with canvas_lock:
        drawing_canvas = build_canvas(args.canvas_size)
    prev_draw_pt = None
    calibrated_M = None
    calibrated_at = None
    id5_calib_pts = {}
    id5_calib_M = None
    id5_calib_updated = None

    while True:
        ok, frame = frame_source.read()
        if not ok:
            time.sleep(0.01)
            continue

        draw_tag_center = None
        draw_tag_margin = None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detector.detect(gray, estimate_tag_pose=False)

        centers = {}
        all_corners_dict = {}
        found_tags = {}
        detected_ids = []
        draw_pos_norm = None
        M_to_use = None
        calibration_state = "none"

        for det in detections:
            tag_id = int(det.tag_id)
            detected_ids.append(tag_id)
            all_corners_dict[tag_id] = det.corners
            centers[tag_id] = det.center
            if tag_id == int(args.draw_id):
                draw_tag_center = det.center
                draw_tag_margin = float(det.decision_margin)
            draw_detection(frame, det, min_margin)

        if all(cid in centers for cid in boundary_ids):
            src_pts = np.array([centers[cid] for cid in boundary_ids], dtype="float32")
            dst_pts = np.array([
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ], dtype="float32")

            M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            calibrated_M = M
            calibrated_at = time.time()
            M_to_use = M
            calibration_state = "live"
        elif calibrated_M is not None and not args.no_hold_calibration:
            M_to_use = calibrated_M
            calibration_state = "hold"

        if M_to_use is not None:
            for det in detections:
                tag_id = int(det.tag_id)
                if tag_id in boundary_ids:
                    continue
                if args.filter and det.decision_margin < min_margin:
                    continue

                tracked_center = np.array([[det.center]], dtype="float32")
                pts_transformed = cv2.perspectiveTransform(tracked_center, M_to_use)
                px = float(pts_transformed[0][0][0])
                py = float(pts_transformed[0][0][1])
                if tag_id == int(args.draw_id) and id5_calib_M is not None:
                    pt = np.array([[[px, py]]], dtype="float32")
                    corrected = cv2.perspectiveTransform(pt, id5_calib_M)
                    px = float(corrected[0][0][0])
                    py = float(corrected[0][0][1])
                margin = float(det.decision_margin)
                found_tags[str(tag_id)] = {
                    "x": px,
                    "y": py,
                    "id": tag_id,
                    "margin": margin
                }
                if tag_id == int(args.draw_id) and margin >= min_margin:
                    draw_pos_norm = (px, py)

        if draw_pos_norm is not None:
            px, py = draw_pos_norm
            if 0.0 <= px <= 1.0 and 0.0 <= py <= 1.0:
                cur_pt = (int(px * (canvas_size - 1)), int(py * (canvas_size - 1)))
                with canvas_lock:
                    if prev_draw_pt is not None:
                        cv2.line(drawing_canvas, prev_draw_pt, cur_pt, (0, 0, 0), int(args.line_thickness))
                    else:
                        cv2.circle(drawing_canvas, cur_pt, int(args.line_thickness), (0, 0, 0), -1)
                prev_draw_pt = cur_pt
            else:
                prev_draw_pt = None
        else:
            prev_draw_pt = None

        with position_lock:
            current_position["tags"] = found_tags
            current_position["detected_ids"] = detected_ids
            current_position["calibration"] = {
                "state": calibration_state,
                "updated_at": calibrated_at
            }

        if calibrated_at is not None:
            calib_age = time.time() - calibrated_at
            calib_text = f"{calibration_state} ({calib_age:.1f}s)"
        else:
            calib_text = calibration_state
        if id5_calib_M is None:
            draw_calib_text = f"{len(id5_calib_pts)}/4"
        else:
            draw_calib_text = "ok"
        overlay = (
            f"min margin: {min_margin:.1f}  calib: {calib_text}  draw calib: {draw_calib_text}  "
            "([ / ] adjust, 1-4 capture draw, c clear, r reset calib, q quit)"
        )
        cv2.putText(frame, overlay, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        cv2.imshow(window_name, frame)
        with canvas_lock:
            canvas_view = drawing_canvas.copy()
        for cid, (tx, ty) in draw_calib_targets.items():
            target_px = (int(tx * (canvas_size - 1)), int(ty * (canvas_size - 1)))
            cv2.circle(canvas_view, target_px, 6, (30, 30, 200), -1)
            cv2.putText(
                canvas_view,
                str(cid),
                (target_px[0] + 8, target_px[1] - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (30, 30, 200),
                2,
            )
        if prev_draw_pt is not None:
            cv2.circle(canvas_view, prev_draw_pt, 6, (0, 0, 255), -1)
        cv2.imshow(canvas_window, canvas_view)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        if key == ord("["):
            min_margin = max(0.0, min_margin - 1.0)
        if key == ord("]"):
            min_margin += 1.0
        if key == ord("c"):
            with canvas_lock:
                drawing_canvas = build_canvas(args.canvas_size)
            prev_draw_pt = None
        if key == ord("r"):
            calibrated_M = None
            calibrated_at = None
            prev_draw_pt = None
        if key in (ord("1"), ord("2"), ord("3"), ord("4")):
            corner_id = int(chr(key))
            if M_to_use is None or draw_tag_center is None:
                print("Draw calibration needs boundary tags 1-4 and the draw tag visible.")
            elif draw_tag_margin is not None and draw_tag_margin < min_margin:
                print("Draw calibration needs the draw tag above min margin.")
            else:
                target_norm = draw_calib_targets.get(corner_id)
                if target_norm is None:
                    print(f"Unknown draw calibration target {corner_id}.")
                else:
                    src_pt = np.array([[draw_tag_center]], dtype="float32")
                    dst_pt = cv2.perspectiveTransform(src_pt, M_to_use)
                    px = float(dst_pt[0][0][0])
                    py = float(dst_pt[0][0][1])
                    id5_calib_pts[corner_id] = (px, py)
                    if len(id5_calib_pts) == 4:
                        src_pts = np.array([id5_calib_pts[cid] for cid in boundary_ids], dtype="float32")
                        dst_pts = np.array([draw_calib_targets[cid] for cid in boundary_ids], dtype="float32")
                        id5_calib_M = cv2.getPerspectiveTransform(src_pts, dst_pts)
                        id5_calib_updated = time.time()
                    print(f"Captured draw calibration corner {corner_id}: ({px:.3f}, {py:.3f})")

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
    parser.add_argument("--draw-id", type=int, default=5, help="Tag id used for drawing on the canvas")
    parser.add_argument("--canvas-size", type=int, default=800, help="Canvas size in pixels")
    parser.add_argument("--line-thickness", type=int, default=2, help="Canvas line thickness")
    parser.add_argument("--no-hold-calibration", action="store_true", help="Require tags 1-4 to be visible every frame")
    args = parser.parse_args()

    global drawing_canvas_draw_id
    drawing_canvas_draw_id = int(args.draw_id)

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
