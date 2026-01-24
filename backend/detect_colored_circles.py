import cv2
import numpy as np

def _to_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_detection_item(item: dict, palette_len: int) -> dict | None:
    if not isinstance(item, dict):
        return None

    x = _to_int(item.get('x', item.get('cx', 0)), 0)
    y = _to_int(item.get('y', item.get('cy', 0)), 0)
    radius = _to_int(item.get('radius', item.get('r', 0)), 0)

    sticker_index = item.get('stickerIndex', item.get('sticker_index', None))
    try:
        sticker_index = int(sticker_index) if sticker_index is not None else None
    except (TypeError, ValueError):
        sticker_index = None

    if sticker_index is not None and palette_len and (sticker_index < 0 or sticker_index >= palette_len):
        sticker_index = None

    color = item.get('color', item.get('colour', None))
    if color is not None and not isinstance(color, str):
        color = str(color)

    distance = item.get('distance', None)
    try:
        distance = int(distance) if distance is not None else None
    except (TypeError, ValueError):
        distance = None

    bgr = item.get('bgr', None)
    if isinstance(bgr, (list, tuple)) and len(bgr) == 3:
        bgr = (_to_int(bgr[0], 0), _to_int(bgr[1], 0), _to_int(bgr[2], 0))
    else:
        bgr = None

    normalized = {
        'x': x,
        'y': y,
        'radius': radius,
        'stickerIndex': sticker_index,
        'color': color,
        'distance': distance,
        'bgr': bgr
    }

    # Preserve extra diagnostics if present.
    for key in ('circularity', 'area'):
        if key in item:
            normalized[key] = item[key]

    return normalized


def _normalize_hex_color(value: str) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.startswith('#'):
        raw = raw[1:]
    if len(raw) == 3 and all(c in '0123456789abcdefABCDEF' for c in raw):
        raw = ''.join([c * 2 for c in raw])
    if len(raw) != 6 or not all(c in '0123456789abcdefABCDEF' for c in raw):
        return None
    return f"#{raw.lower()}"


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    normalized = _normalize_hex_color(hex_color)
    if not normalized:
        return None
    r = int(normalized[1:3], 16)
    g = int(normalized[3:5], 16)
    b = int(normalized[5:7], 16)
    return (r, g, b)


def _rgb_to_hsv_range(r: int, g: int, b: int, hue_tolerance: int = 15, sat_min: int = 80, val_min: int = 80) -> tuple[np.ndarray, np.ndarray] | None:
    """Convert RGB to HSV range for color detection."""
    # Create a 1x1 pixel image to convert
    pixel = np.uint8([[[b, g, r]]])  # BGR format for OpenCV
    hsv_pixel = cv2.cvtColor(pixel, cv2.COLOR_BGR2HSV)
    h, s, v = hsv_pixel[0, 0]
    
    # Handle red specially (wraps around 0/180 in HSV)
    # For other colors, create a range around the hue
    lower = np.array([max(0, h - hue_tolerance), sat_min, val_min])
    upper = np.array([min(179, h + hue_tolerance), 255, 255])
    
    return lower, upper


def _is_red_color(r: int, g: int, b: int) -> bool:
    """Check if RGB color is predominantly red."""
    return r > 150 and r > g * 1.5 and r > b * 1.5


def _is_green_color(r: int, g: int, b: int) -> bool:
    """Check if RGB color is predominantly green."""
    return g > 150 and g > r * 1.5 and g > b * 1.5


def _is_blue_color(r: int, g: int, b: int) -> bool:
    """Check if RGB color is predominantly blue."""
    return b > 150 and b > r * 1.5 and b > g * 1.5


def _is_black_color(r: int, g: int, b: int) -> bool:
    """Check if RGB color is predominantly black."""
    return r < 60 and g < 60 and b < 60


def _map_rgb_to_palette_index(r: int, g: int, b: int, palette_rgb: list[tuple[int, int, int]]) -> tuple[int, int]:
    min_dist = 2**31 - 1
    min_idx = 0
    for idx, (tr, tg, tb) in enumerate(palette_rgb):
        dr = r - tr
        dg = g - tg
        db = b - tb
        dist = dr * dr + dg * dg + db * db
        if dist < min_dist:
            min_dist = dist
            min_idx = idx
    return min_idx, min_dist


def _get_hsv_ranges_for_color(r: int, g: int, b: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """Get HSV ranges for detecting a specific color. Returns list of (lower, upper) tuples."""
    ranges = []
    
    if _is_red_color(r, g, b):
        # Red wraps around in HSV, need two ranges
        ranges.append((np.array([0, 100, 100]), np.array([10, 255, 255])))
        ranges.append((np.array([160, 100, 100]), np.array([180, 255, 255])))
    elif _is_green_color(r, g, b):
        ranges.append((np.array([35, 80, 80]), np.array([85, 255, 255])))
    elif _is_blue_color(r, g, b):
        ranges.append((np.array([90, 80, 80]), np.array([130, 255, 255])))
    elif _is_black_color(r, g, b):
        # Black: low value, any hue/saturation
        ranges.append((np.array([0, 0, 0]), np.array([180, 255, 60])))
    else:
        # Generic color - compute HSV range
        result = _rgb_to_hsv_range(r, g, b)
        if result:
            ranges.append(result)
    
    return ranges


def detect_circles_by_color(
    img: np.ndarray,
    palette_rgb: list[tuple[int, int, int]],
    palette_hex: list[str],
    *,
    min_radius: int = 5,
    max_radius: int = 100,
    min_area: int = 300,
    min_circularity: float = 0.65,
) -> list[dict]:
    """Detect circles using HSV color segmentation."""
    detected = []
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    height, width = img.shape[:2]
    
    for idx, (r, g, b) in enumerate(palette_rgb):
        hsv_ranges = _get_hsv_ranges_for_color(r, g, b)
        if not hsv_ranges:
            continue
        
        # Combine all masks for this color
        mask = None
        for lower, upper in hsv_ranges:
            current_mask = cv2.inRange(hsv, lower, upper)
            if mask is None:
                mask = current_mask
            else:
                mask = mask | current_mask
        
        if mask is None:
            continue
        
        # Clean up mask
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue
            
            # Fit minimum enclosing circle
            (x, y), radius = cv2.minEnclosingCircle(cnt)
            x, y, radius = int(x), int(y), int(radius)
            
            if radius < min_radius or radius > max_radius:
                continue
            
            # Check circularity
            perimeter = cv2.arcLength(cnt, True)
            if perimeter > 0:
                circularity = 4 * np.pi * area / (perimeter ** 2)
            else:
                continue
            
            if circularity < min_circularity:
                continue
            
            # Bounds check
            if x < 0 or y < 0 or x >= width or y >= height:
                continue
            
            # Sample actual color from image center
            x0 = max(0, x - 2)
            x1 = min(width, x + 3)
            y0 = max(0, y - 2)
            y1 = min(height, y + 3)
            patch = img[y0:y1, x0:x1]
            bgr = patch.reshape(-1, 3).mean(axis=0)
            actual_b, actual_g, actual_r = int(bgr[0]), int(bgr[1]), int(bgr[2])
            
            # Calculate distance to expected color
            dr = actual_r - r
            dg = actual_g - g
            db = actual_b - b
            distance = dr * dr + dg * dg + db * db
            
            detected.append({
                'x': x,
                'y': y,
                'radius': radius,
                'stickerIndex': idx,
                'color': palette_hex[idx] if idx < len(palette_hex) else None,
                'distance': distance,
                'bgr': (actual_b, actual_g, actual_r),
                'circularity': circularity,
                'area': area,
            })
    
    return detected


def detect_circles_by_hough(
    img: np.ndarray,
    palette_rgb: list[tuple[int, int, int]] | None,
    palette_hex: list[str] | None,
    *,
    min_dist: int = 30,
    min_radius: int = 10,
    max_radius: int = 50,
    blur_kernel: tuple[int, int] = (9, 9),
    blur_sigma: float = 2.0,
    hough_dp: float = 1.0,
    hough_param1: float = 50.0,
    hough_param2: float = 30.0,
) -> list[dict]:
    """Detect circles using Hough Circle Transform (fallback method)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, blur_kernel, blur_sigma)

    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=hough_dp,
        minDist=min_dist,
        param1=hough_param1,
        param2=hough_param2,
        minRadius=min_radius,
        maxRadius=max_radius
    )

    detected: list[dict] = []
    if circles is None:
        return detected

    circles = np.uint16(np.around(circles))
    height, width = img.shape[:2]

    for circle in circles[0, :]:
        x, y, radius = int(circle[0]), int(circle[1]), int(circle[2])
        if x < 0 or y < 0 or x >= width or y >= height:
            continue

        x0 = max(0, x - 2)
        x1 = min(width, x + 3)
        y0 = max(0, y - 2)
        y1 = min(height, y + 3)
        patch = img[y0:y1, x0:x1]
        bgr = patch.reshape(-1, 3).mean(axis=0)
        b, g, r = (int(bgr[0]), int(bgr[1]), int(bgr[2]))

        sticker_index = None
        mapped_color = None
        distance = None
        if palette_rgb and palette_hex:
            sticker_index, distance = _map_rgb_to_palette_index(r, g, b, palette_rgb)
            mapped_color = palette_hex[sticker_index] if sticker_index < len(palette_hex) else None
        else:
            mapped_color = map_to_color(r, g, b)

        detected.append({
            'x': x,
            'y': y,
            'radius': radius,
            'stickerIndex': sticker_index,
            'color': mapped_color,
            'distance': distance,
            'bgr': (b, g, r)
        })

    return detected


def detect_circles_in_bgr_image(
    img: np.ndarray,
    *,
    sticker_colors_hex: list[str] | None = None,
    min_dist: int = 30,
    min_radius: int = 30,
    max_radius: int = 100,
    min_area: int = 1000,
    min_circularity: float = 0.70,
    blur_kernel: tuple[int, int] = (9, 9),
    blur_sigma: float = 2.0,
    hough_dp: float = 1.0,
    hough_param1: float = 50.0,
    hough_param2: float = 30.0,
    use_color_detection: bool = True,
    use_hough_fallback: bool = True,
) -> list[dict]:
    """
    Detect colored circle markers in an image.
    
    Primary method: HSV color segmentation (works well for filled colored circles)
    Fallback method: Hough Circle Transform (works for edge-defined circles)
    
    Args:
        img: BGR image as numpy array
        sticker_colors_hex: List of hex colors to detect (e.g., ['#ff0000', '#00ff00'])
                           If None, uses default palette: red, green, blue (no black)
        min_dist: Minimum distance between circles (Hough)
        min_radius: Minimum circle radius
        max_radius: Maximum circle radius
        min_area: Minimum contour area (color detection)
        min_circularity: Minimum circularity 0-1 (color detection)
        use_color_detection: Use HSV color segmentation (recommended for filled circles)
        use_hough_fallback: Fall back to Hough if color detection finds nothing
    
    Returns:
        List of detected circles with x, y, radius, color, etc.
    """
    if img is None or not hasattr(img, "shape"):
        return []

    # Build palette
    palette_hex: list[str] = []
    palette_rgb: list[tuple[int, int, int]] = []
    
    if sticker_colors_hex:
        for c in sticker_colors_hex:
            normalized = _normalize_hex_color(c)
            if normalized:
                rgb = _hex_to_rgb(normalized)
                if rgb:
                    palette_hex.append(normalized)
                    palette_rgb.append(rgb)
    
    # Default palette: red, green, blue (no black - too many false positives)
    if not palette_rgb:
        palette_hex = ['#ff0000', '#00ff00', '#0000ff']
        palette_rgb = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]

    detected: list[dict] = []
    
    # Primary: Color-based detection
    if use_color_detection:
        detected = detect_circles_by_color(
            img, palette_rgb, palette_hex,
            min_radius=min_radius,
            max_radius=max_radius,
            min_area=min_area,
            min_circularity=min_circularity,
        )
    
    # Fallback: Hough Circle Transform
    if not detected and use_hough_fallback:
        detected = detect_circles_by_hough(
            img, palette_rgb, palette_hex,
            min_dist=min_dist,
            min_radius=min_radius,
            max_radius=max_radius,
            blur_kernel=blur_kernel,
            blur_sigma=blur_sigma,
            hough_dp=hough_dp,
            hough_param1=hough_param1,
            hough_param2=hough_param2,
        )

    # Normalize output contract for the rest of the app (camera.py + survey.js).
    palette_len = len(palette_hex) if palette_hex else 0
    normalized = []
    for item in detected or []:
        fixed = _normalize_detection_item(item, palette_len)
        if fixed is not None:
            normalized.append(fixed)

    return normalized


def detect_circles(image_path, *, sticker_colors_hex: list[str] | None = None):
    """Load image and detect circles."""
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Could not load image from {image_path}")
        return [], None

    detected = detect_circles_in_bgr_image(img, sticker_colors_hex=sticker_colors_hex)
    return detected, img


def map_to_color(r, g, b):
    """Map RGB values to one of: black, red, green, blue"""
    colors = {
        'black': (0, 0, 0),
        'red': (255, 0, 0),
        'green': (0, 255, 0),
        'blue': (0, 0, 255)
    }
    
    min_dist = float('inf')
    closest_color = 'black'
    
    for name, (tr, tg, tb) in colors.items():
        dist = np.sqrt((r - tr)**2 + (g - tg)**2 + (b - tb)**2)
        if dist < min_dist:
            min_dist = dist
            closest_color = name
    
    return closest_color


def visualize_results(img, circles, output_path):
    """Draw detected circles on image with their mapped colors"""
    result = img.copy()
    
    # Color mapping for visualization (BGR format)
    color_bgr = {
        '#000000': (0, 0, 0),
        '#ff0000': (0, 0, 255),
        '#00ff00': (0, 255, 0),
        '#0000ff': (255, 0, 0),
        'black': (0, 0, 0),
        'red': (0, 0, 255),
        'green': (0, 255, 0),
        'blue': (255, 0, 0)
    }
    
    for c in circles:
        x, y, r = c['x'], c['y'], c['radius']
        color_key = c.get('color', 'red')
        color = color_bgr.get(color_key, (0, 255, 255))  # Yellow as default
        
        # Draw circle outline
        cv2.circle(result, (x, y), r + 5, color, 3)
        
        # Draw center point
        cv2.circle(result, (x, y), 3, color, -1)
        
        # Add label
        label = f"{color_key} ({x},{y})"
        cv2.putText(result, label, 
                    (x - 40, y - r - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    
    cv2.imwrite(output_path, result)
    print(f"Visualization saved to {output_path}")


if __name__ == "__main__":
    image_path = "input.png"
    output_path = "circles_detected.png"
    
    # You can specify custom sticker colors:
    # circles, img = detect_circles(image_path, sticker_colors_hex=['#ff0000', '#00ff00', '#0000ff'])
    
    circles, img = detect_circles(image_path)
    
    print(f"\nDetected {len(circles)} circles:\n")
    print("-" * 50)
    
    for i, c in enumerate(circles, 1):
        print(f"Circle {i}:")
        print(f"  Location: ({c['x']}, {c['y']})")
        print(f"  Radius: {c['radius']}")
        print(f"  Mapped Color: {c['color']}")
        print(f"  Sticker Index: {c.get('stickerIndex')}")
        print(f"  Original BGR: {c['bgr']}")
        if 'circularity' in c:
            print(f"  Circularity: {c['circularity']:.2f}")
        print()
    
    if img is not None and circles:
        visualize_results(img, circles, output_path)
