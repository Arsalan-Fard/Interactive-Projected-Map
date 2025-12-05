"""Webcam/Phone AprilTag (25h9) detector using OpenCV's aruco module with Flask API."""
import sys
import threading
from typing import Optional, Union

import cv2
import numpy as np
from cv2 import aruco
from flask import Flask, jsonify
from flask_cors import CORS


position_lock = threading.Lock()
# relative position (0.0 to 1.0) inside the map formed by ids 1,2,3,4
current_position = {"x": 0.0, "y": 0.0, "valid": False}

app = Flask(__name__)
CORS(app)  

@app.route('/api/position', methods=['GET'])
def get_position():
    """Return the latest calculated relative position."""
    with position_lock:
        return jsonify(current_position)

def run_flask_server():
    """Run the Flask server in a separate thread."""
    print("Starting Flask API on http://localhost:5000/api/position")
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)

def build_detector():
    """Create an ArUco/AprilTag detector."""
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_APRILTAG_25h9)

    if hasattr(aruco, "ArucoDetector"):
        params = aruco.DetectorParameters()
        return aruco.ArucoDetector(dictionary, params), None

    params = aruco.DetectorParameters_create()
    return None, (dictionary, params)


def find_closest_corner(corners_a, corners_b):
    """
    Find the closest corner of marker A to any corner of marker B.
    Returns (closest_corner_of_a, closest_corner_of_b, distance).
    """
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

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Failed to read from camera/stream. Exiting.")
            break

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
                
                # # Draw ID
                # cv2.putText(
                #     frame,
                #     f"ID: {marker_id}",
                #     (int(marker_corners[0][0]), int(marker_corners[0][1]) - 10),
                #     cv2.FONT_HERSHEY_SIMPLEX,
                #     0.9,
                #     (0, 255, 0),
                #     2,
                #     cv2.LINE_AA,
                # )

            # Logic for distances and relative position
            # New Boundary: 0, 1, 2, 3
            # New Tracked: 4 (and 5 reserved)
            
            tracked_id = 4
            boundary_ids = [0, 1, 2, 3]

            if tracked_id in all_corners_dict:
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
                        

                # Calculate Perspective Transform if all boundary markers are present
                if all(cid in closest_boundary_corners for cid in boundary_ids):
                    # Source points: closest corners of boundary markers to tracked marker
                    # Assumed Order: TL, TR, BR, BL (IDs 0, 1, 2, 3)
                    src_pts = np.array([
                        closest_boundary_corners[0],
                        closest_boundary_corners[1],
                        closest_boundary_corners[2],
                        closest_boundary_corners[3]
                    ], dtype="float32")

                    # Destination points: Unit square
                    dst_pts = np.array([
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1]
                    ], dtype="float32")

                    M = cv2.getPerspectiveTransform(src_pts, dst_pts)

                    # Find the closest corner of tracked marker to ANY of the boundary markers
                    # This is the point we transform
                    min_overall_dist = float('inf')
                    closest_corner_of_tracked = None
                    
                    for corner_id in boundary_ids:
                        target_corners = all_corners_dict[corner_id]
                        p_tracked_best, _, dist = find_closest_corner(corners_tracked, target_corners)
                        if dist < min_overall_dist:
                            min_overall_dist = dist
                            closest_corner_of_tracked = p_tracked_best
                    
                    # Transform the closest corner of tracked marker
                    if closest_corner_of_tracked is not None:
                        pts = np.array([[closest_corner_of_tracked]], dtype="float32")
                        pts_transformed = cv2.perspectiveTransform(pts, M)
                        
                        px = pts_transformed[0][0][0]
                        py = pts_transformed[0][0][1]
                        
                        found_position = True
                        
                        # Draw a circle on the corner being tracked
                        # cv2.circle(frame, 
                        #            (int(closest_corner_of_tracked[0]), int(closest_corner_of_tracked[1])), 
                        #            8, (0, 0, 255), -1)
                        

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
                current_position["id"] = tracked_id
                current_position["valid"] = True
            else:
                current_position["valid"] = False

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