"""Webcam/Phone AprilTag (25h9) detector using OpenCV's aruco module."""
import sys
from typing import Optional, Union

import cv2
from cv2 import aruco


def build_detector():
    """Create an ArUco/AprilTag detector."""
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_APRILTAG_25h9)

    if hasattr(aruco, "ArucoDetector"):
        params = aruco.DetectorParameters()
        return aruco.ArucoDetector(dictionary, params), None

    params = aruco.DetectorParameters_create()
    return None, (dictionary, params)


def detect_and_display(cap: cv2.VideoCapture, detector, legacy_params: Optional[tuple]):
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

        if ids is not None and len(ids) > 0:
            aruco.drawDetectedMarkers(frame, corners, ids)
            for marker_corners, marker_id in zip(corners, ids.flatten()):
                corner = marker_corners[0].astype(int)
                x, y = corner[0]
                cv2.putText(
                    frame,
                    f"ID: {marker_id}",
                    (x, y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.9,
                    (0, 255, 0),
                    2,
                    cv2.LINE_AA,
                )
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

        cv2.imshow("AprilTag 25h9 Detector", frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):  # q or ESC to exit
            break


def main(source: Union[int, str] = 0):
    """
    source can be:
      - int: webcam index (0, 1, ...)
      - str: URL of IP camera stream (e.g. 'http://192.168.1.23:8080/video')
    """
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
            src = arg  # e.g. 'http://192.168.1.23:8080/video'
    else:
        src = 0

    raise SystemExit(main(src))
