import cv2
import numpy as np

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


def detect_circles_in_bgr_image(
    img: np.ndarray,
    *,
    sticker_colors_hex: list[str] | None = None,
    min_dist: int = 30,
    min_radius: int = 10,
    max_radius: int = 50,
    blur_kernel: tuple[int, int] = (9, 9),
    blur_sigma: float = 2.0,
    hough_dp: float = 1.0,
    hough_param1: float = 50.0,
    hough_param2: float = 30.0,
) -> list[dict]:
    if img is None or not hasattr(img, "shape"):
        return []

    palette_hex = None
    palette_rgb: list[tuple[int, int, int]] = []
    if sticker_colors_hex:
        normalized = [_normalize_hex_color(c) for c in sticker_colors_hex]
        palette_hex = [c for c in normalized if c]
        for c in palette_hex:
            rgb = _hex_to_rgb(c)
            if rgb is not None:
                palette_rgb.append(rgb)
        if not palette_rgb:
            palette_hex = None

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

        # Sample a small patch around the center for robustness.
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
        if palette_rgb:
            sticker_index, distance = _map_rgb_to_palette_index(r, g, b, palette_rgb)
            mapped_color = palette_hex[sticker_index] if palette_hex and sticker_index < len(palette_hex) else None
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


def detect_circles(image_path, *, sticker_colors_hex: list[str] | None = None):
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Could not load image from {image_path}")
        return [], None

    detected = detect_circles_in_bgr_image(img, sticker_colors_hex=sticker_colors_hex)
    return detected, img

def map_to_color(r, g, b):
    """Map RGB values to one of: black, red, green, blue"""
    
    # Define target colors in RGB
    colors = {
        'black': (0, 0, 0),
        'red': (255, 0, 0),
        'green': (0, 255, 0),
        'blue': (0, 0, 255)
    }
    
    # Calculate distance to each color
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
        'black': (0, 0, 0),
        'red': (0, 0, 255),
        'green': (0, 255, 0),
        'blue': (255, 0, 0)
    }
    
    for c in circles:
        x, y, r = c['x'], c['y'], c['radius']
        color = color_bgr[c['color']]
        
        # Draw circle outline
        cv2.circle(result, (x, y), r + 5, color, 3)
        
        # Draw center point
        cv2.circle(result, (x, y), 3, color, -1)
        
        # Add label
        cv2.putText(result, f"{c['color']} ({x},{y})", 
                    (x - 40, y - r - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    
    cv2.imwrite(output_path, result)
    print(f"Visualization saved to {output_path}")

if __name__ == "__main__":
    image_path = "input.png"
    output_path = "circles_detected.png"
    
    circles, img = detect_circles(image_path)
    
    print(f"\nDetected {len(circles)} circles:\n")
    print("-" * 50)
    
    for i, c in enumerate(circles, 1):
        print(f"Circle {i}:")
        print(f"  Location: ({c['x']}, {c['y']})")
        print(f"  Mapped Color: {c['color']}")
        print(f"  Original BGR: {c['bgr']}")
        print()
    
    visualize_results(img, circles, output_path)
