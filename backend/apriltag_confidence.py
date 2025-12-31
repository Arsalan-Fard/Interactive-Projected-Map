"""
Quick AprilTag confidence viewer using pupil_apriltags.
Shows decision margin per detection and lets you adjust threshold at runtime.
"""
import argparse
import sys

try:
    import cv2
except ImportError as exc:
    raise SystemExit(f"OpenCV is required: {exc}")

try:
    from pupil_apriltags import Detector
except ImportError as exc:
    raise SystemExit(
        "pupil_apriltags is required. Install with: pip install pupil-apriltags"
    ) from exc


def parse_source(value):
    try:
        return int(value)
    except ValueError:
        return value


def build_detector(args):
    return Detector(
        families=args.family,
        nthreads=args.threads,
        quad_decimate=args.quad_decimate,
        quad_sigma=args.quad_sigma,
        refine_edges=args.refine_edges,
    )


def draw_detection(frame, det, min_margin):
    corners = det.corners.astype(int)
    center = tuple(det.center.astype(int))
    margin = float(det.decision_margin)
    color = (0, 200, 0) if margin >= min_margin else (0, 0, 255)

    cv2.polylines(frame, [corners], isClosed=True, color=color, thickness=2)
    cv2.circle(frame, center, 3, color, -1)

    label = f"id:{det.tag_id} m:{margin:.1f}"
    label_pos = (corners[0][0], max(0, corners[0][1] - 10))
    cv2.putText(frame, label, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)


def main():
    parser = argparse.ArgumentParser(description="AprilTag confidence viewer")
    parser.add_argument("--source", default="0", help="Camera index or stream URL")
    parser.add_argument("--family", default="tag36h11", help="Tag family")
    parser.add_argument("--min-margin", type=float, default=20.0, help="Decision margin threshold")
    parser.add_argument("--filter", action="store_true", help="Hide detections below threshold")
    parser.add_argument("--threads", type=int, default=2, help="Detector threads")
    parser.add_argument("--quad-decimate", type=float, default=1.0, help="Decimation factor")
    parser.add_argument("--quad-sigma", type=float, default=0.0, help="Gaussian blur sigma")
    parser.add_argument("--refine-edges", action="store_true", help="Refine edges")
    args = parser.parse_args()

    min_margin = max(0.0, args.min_margin)
    source = parse_source(args.source)
    detector = build_detector(args)

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Could not open video source: {source}")

    window_name = "AprilTag Confidence"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detector.detect(gray, estimate_tag_pose=False)

        for det in detections:
            if args.filter and det.decision_margin < min_margin:
                continue
            draw_detection(frame, det, min_margin)

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

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    sys.exit(main())
