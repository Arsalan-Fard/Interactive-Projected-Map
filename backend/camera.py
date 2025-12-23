"""Webcam/Phone AprilTag (25h9) detector using OpenCV's aruco module with Flask API."""
import sys
import threading
import logging
from typing import Optional, Union

import cv2
import numpy as np
from cv2 import aruco
from flask import Flask, jsonify
from flask_cors import CORS


position_lock = threading.Lock()
# relative position (0.0 to 1.0) inside the map formed by ids 1,2,3,4
current_position = {"x": 0.0, "y": 0.0, "valid": False, "detected_ids": []}

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

def build_detector():
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_APRILTAG_25h9)

    if hasattr(aruco, "ArucoDetector"):
        print(1)
        params = aruco.DetectorParameters()
        # Permissive Detector Configuration for noisy/distorted tags
        params.aprilTagQuadDecimate = .1      # Blur out small noise (small lines)
        params.aprilTagQuadSigma = 0.8         # Smoothing
        params.aprilTagMaxLineFitMse = 10.0    # Allow wobbly borders (standard is 10.0)
        params.aprilTagMinWhiteBlackDiff = 0   # Allow low contrast (standard is 5). Acts as "lower decision margin".
        return aruco.ArucoDetector(dictionary, params), None
    print(2)
    params = aruco.DetectorParameters_create()
    # Permissive Detector Configuration for noisy/distorted tags
    params.aprilTagQuadDecimate = 2.0      # Blur out small noise (small lines)
    params.aprilTagQuadSigma = 0.8         # Smoothing
    params.aprilTagMaxLineFitMse = 20.0    # Allow wobbly borders (standard is 10.0)
    params.aprilTagMinWhiteBlackDiff = 1   # Allow low contrast (standard is 5). Acts as "lower decision margin".
    return None, (dictionary, params)


def find_closest_corner(corners_a, corners_b):
    min_dist = float('inf')
    best_a = None
    best_b = None
    
    for pa in corners_a:
        for pb in corners_b:
            d = np.linalg.norm(pa - pb)
            if d < min_dist:
                min_dist = d
                best_a = pa
                best_b = pb
    
    return best_a, best_b, min_dist


def detect_and_display(cap: cv2.VideoCapture, detector, legacy_params: Optional[tuple]):
    window_name = "AprilTag 25h9 Detector"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    # --- TWEAK IMAGE PARAMETERS HERE ---
    ENABLE_IMAGE_ENHANCEMENTS = False  # Set to False to see original image

    adj_contrast   = 0.5   # > 1.0 increases contrast
    adj_brightness = 90     # > 0 increases brightness
    adj_saturation = 1.6     # > 1.0 increases saturation
    adj_gamma      = 0.5     # < 1.0 brightens shadows

    # Pre-calculate gamma table
    invGamma = 1.0 / adj_gamma
    gamma_table = np.array([((i / 255.0) ** invGamma) * 255 for i in np.arange(0, 256)]).astype("uint8")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Failed to read from camera/stream. Exiting.")
            break

        if ENABLE_IMAGE_ENHANCEMENTS:
            # 1. Apply Contrast & Brightness
            frame = cv2.convertScaleAbs(frame, alpha=adj_contrast, beta=adj_brightness)

            # 2. Apply Gamma Correction
            if adj_gamma != 1.0:
                frame = cv2.LUT(frame, gamma_table)

            # 3. Apply Saturation
            if adj_saturation != 1.0:
                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                s = hsv[:, :, 1].astype("float32") * adj_saturation
                hsv[:, :, 1] = np.clip(s, 0, 255).astype("uint8")
                frame = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if detector is not None:
            corners, ids, _ = detector.detectMarkers(gray)
        else:
            dictionary, params = legacy_params
            corners, ids, _ = aruco.detectMarkers(gray, dictionary, parameters=params)

        centers = {}
        all_corners_dict = {}
        
        found_position = False
        px, py = 0.0, 0.0

        if ids is not None and len(ids) > 0:
            aruco.drawDetectedMarkers(frame, corners, ids)
            
            # Flatten ids for easier iteration
            ids_flat = ids.flatten()
            
            for i, marker_id in enumerate(ids_flat):
                marker_corners = corners[i][0] 
                all_corners_dict[marker_id] = marker_corners
                
                # Calculate center
                cx = int((marker_corners[0][0] + marker_corners[2][0]) / 2.0)
                cy = int((marker_corners[0][1] + marker_corners[2][1]) / 2.0)

                centers[marker_id] = (cx, cy)
                
                # Draw ID
                cv2.putText(
                    frame,
                    f"ID: {marker_id}",
                    (int(marker_corners[0][0]), int(marker_corners[0][1]) - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.9,
                    (0, 255, 0),
                    2,
                    cv2.LINE_AA,
                )


            
            boundary_ids = [1, 2, 3, 4]
            trackable_ids = [5, 6] # Prioritize 5, then 6
            tracked_id = None

            for tid in trackable_ids:
                if tid in all_corners_dict:
                    tracked_id = tid
                    break

            if tracked_id is not None:
                corners_tracked = all_corners_dict[tracked_id]
                
                # Store the closest corners of boundary markers to the tracked marker
                closest_boundary_corners = {}
                
                # Draw distances to boundary corners
                y_offset = 40
                for corner_id in boundary_ids:
                    if corner_id in all_corners_dict:
                        target_corners = all_corners_dict[corner_id]
                        
                        # Find closest corners between tracked marker and this boundary marker
                        p_tracked_best, pt_best, min_dist = find_closest_corner(corners_tracked, target_corners)
                        
                        # Store the closest corner of the boundary marker to the tracked marker
                        closest_boundary_corners[corner_id] = pt_best
                
                # DEBUG: Print status
                found_boundaries = list(closest_boundary_corners.keys())
                missing_boundaries = [bid for bid in boundary_ids if bid not in closest_boundary_corners]
                
                if missing_boundaries:
                     print(f"Tracking ID {tracked_id}. Missing boundaries: {missing_boundaries}. Found: {found_boundaries}")
                else:
                     # print(f"Tracking ID {tracked_id}. All boundaries found.")
                     pass

                # Calculate Perspective Transform if all boundary markers are present
                if all(cid in closest_boundary_corners for cid in boundary_ids):
                    src_pts = np.array([
                        closest_boundary_corners[1],
                        closest_boundary_corners[2],
                        closest_boundary_corners[3],
                        closest_boundary_corners[4]
                    ], dtype="float32")

                    dst_pts = np.array([
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1]
                    ], dtype="float32")

                    M = cv2.getPerspectiveTransform(src_pts, dst_pts)

                    tracked_center = np.array(centers[tracked_id], dtype="float32")
                    
                    pts = np.array([[tracked_center]], dtype="float32")
                    pts_transformed = cv2.perspectiveTransform(pts, M)
                    
                    px = pts_transformed[0][0][0]
                    py = pts_transformed[0][0][1]
                    
                    found_position = True
                    
                    # Calculate distances to each corner
                    d1 = np.linalg.norm(tracked_center - closest_boundary_corners[1])
                    d2 = np.linalg.norm(tracked_center - closest_boundary_corners[2])
                    d3 = np.linalg.norm(tracked_center - closest_boundary_corners[3])
                    d4 = np.linalg.norm(tracked_center - closest_boundary_corners[4])
                                        
                    for corner_id in boundary_ids:
                        if corner_id in closest_boundary_corners:
                            cv2.line(frame, centers[tracked_id], 
                                     (int(closest_boundary_corners[corner_id][0]), int(closest_boundary_corners[corner_id][1])), 
                                     (255, 0, 0), 2)

            else:
                 # print("No trackable tag (5 or 6) found.")
                 pass

        else:
            cv2.putText(
                frame,
                "No AprilTag detected",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 0, 255),
                2,
                cv2.LINE_AA,
            )

        with position_lock:
            if found_position:
                current_position["x"] = float(px)
                current_position["y"] = float(py)
                current_position["distances"] = {
                    "d1": float(d1),
                    "d2": float(d2),
                    "d3": float(d3),
                    "d4": float(d4)
                }
                current_position["id"] = tracked_id
                current_position["valid"] = True
            else:
                current_position["valid"] = False
            
            # Update detected IDs list
            current_position["detected_ids"] = [int(i) for i in ids.flatten()] if ids is not None else []

        cv2.imshow(window_name, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):  # q or ESC to exit
            break


def main(source: Union[int, str] = 0):
    """
    source can be:
      - int: webcam index (0, 1, ...)
      - str: URL of IP camera stream (e.g. 'http://192.168.1.23:8080/video')
    """
    t = threading.Thread(target=run_flask_server, daemon=True)
    t.start()

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"Could not open video source: {source}")
        return 1

    detector, legacy_params = build_detector()
    try:
        detect_and_display(cap, detector, legacy_params)
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        try:
            src: Union[int, str] = int(arg)
        except ValueError:
            src = arg
    else:
        src = 0

    raise SystemExit(main(src))