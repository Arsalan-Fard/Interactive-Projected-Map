import argparse
import time
import cv2
import numpy as np

DEFAULT_PREPROCESS_CONFIG = {
    "scale": 1.0,
    "nlm_h": 0.0,
    "nlm_h_color": 0.0,
    "bilateral_d": 7,
    "bilateral_sigma_color": 35.0,
    "bilateral_sigma_space": 35.0,
    "white_sat_max": 60.0,
    "white_val_min": 180.0,
    "white_val_target": 205.0,
    "white_sat_scale": 0.2,
    "line_sat_min": 10.0,
    "line_val_max_for_black": 160.0,
    "black_val_target": 25.0,
    "black_val_strength": 0.5,
    "black_sat_max": 45.0,
    "bg_whiten_strength": 0.4,
    "bg_val_target": 245.0,
    "sat_mask_min": 12.0,
    "sat_val_min": 70.0,
    "sat_mult": 3.0,
    "line_dilate_px": 1,
    "clahe_clip": 0.0,
    "clahe_tile": 8,
    "sharpen_amount": 0.4,
    "sharpen_sigma": 1.0,
}


def get_default_preprocess_config():
    return dict(DEFAULT_PREPROCESS_CONFIG)


def preprocess_image(img, cfg):
    if cfg["scale"] != 1.0:
        h, w = img.shape[:2]
        img = cv2.resize(
            img,
            (int(w * cfg["scale"]), int(h * cfg["scale"])),
            interpolation=cv2.INTER_LANCZOS4,
        )

    if cfg["nlm_h"] > 0:
        img = cv2.fastNlMeansDenoisingColored(
            img,
            None,
            h=cfg["nlm_h"],
            hColor=cfg["nlm_h_color"],
            templateWindowSize=7,
            searchWindowSize=21,
        )

    if cfg["bilateral_d"] > 0:
        img = cv2.bilateralFilter(
            img,
            d=cfg["bilateral_d"],
            sigmaColor=cfg["bilateral_sigma_color"],
            sigmaSpace=cfg["bilateral_sigma_space"],
        )

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = cv2.split(hsv)

    line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
    bg_mask = ~line_mask

    if cfg["bg_whiten_strength"] > 0:
        s[bg_mask] = s[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
        v[bg_mask] = np.clip(
            v[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
            + cfg["bg_val_target"] * cfg["bg_whiten_strength"],
            0,
            255,
        )

    white_mask = (s < cfg["white_sat_max"]) & (v > cfg["white_val_min"])
    s[white_mask] = s[white_mask] * cfg["white_sat_scale"]
    v[white_mask] = np.maximum(v[white_mask], cfg["white_val_target"])

    color_mask = line_mask & (s > cfg["sat_mask_min"]) & (v > cfg["sat_val_min"])
    s[color_mask] = np.clip(s[color_mask] * cfg["sat_mult"], 0, 255)

    if cfg["black_val_strength"] > 0:
        black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
        v[black_mask] = np.clip(
            v[black_mask] * (1.0 - cfg["black_val_strength"])
            + cfg["black_val_target"] * cfg["black_val_strength"],
            0,
            255,
        )

    hsv = cv2.merge([h, s, v]).astype(np.uint8)
    img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    if cfg["clahe_clip"] > 0:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(
            clipLimit=cfg["clahe_clip"],
            tileGridSize=(cfg["clahe_tile"], cfg["clahe_tile"]),
        )
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

    if cfg["sharpen_amount"] > 0:
        blur = cv2.GaussianBlur(img, (0, 0), cfg["sharpen_sigma"])
        img = cv2.addWeighted(
            img,
            1.0 + cfg["sharpen_amount"],
            blur,
            -cfg["sharpen_amount"],
            0,
        )

    if cfg["bg_whiten_strength"] > 0:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        h, s, v = cv2.split(hsv)
        line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
        bg_mask = ~line_mask
        s[bg_mask] = s[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
        v[bg_mask] = np.clip(
            v[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
            + cfg["bg_val_target"] * cfg["bg_whiten_strength"],
            0,
            255,
        )
        if cfg["black_val_strength"] > 0:
            black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
            v[black_mask] = np.clip(
                v[black_mask] * (1.0 - cfg["black_val_strength"])
                + cfg["black_val_target"] * cfg["black_val_strength"],
                0,
                255,
            )
        hsv = cv2.merge([h, s, v]).astype(np.uint8)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    if cfg["line_dilate_px"] > 0:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        h, s, v = cv2.split(hsv)
        line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
        color_mask = line_mask & (s > cfg["sat_mask_min"]) & (v > cfg["sat_val_min"])
        black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
        kernel_size = cfg["line_dilate_px"] * 2 + 1
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
        )
        dilated_color = cv2.dilate(color_mask.astype(np.uint8), kernel, iterations=1).astype(bool)
        dilated_black = cv2.dilate(black_mask.astype(np.uint8), kernel, iterations=1).astype(bool)
        s[dilated_color] = np.clip(s[dilated_color] * cfg["sat_mult"], 0, 255)
        v[dilated_color] = np.maximum(v[dilated_color], cfg["sat_val_min"])
        if cfg["black_val_strength"] > 0:
            v[dilated_black] = np.clip(
                v[dilated_black] * (1.0 - cfg["black_val_strength"])
                + cfg["black_val_target"] * cfg["black_val_strength"],
                0,
                255,
            )
        hsv = cv2.merge([h, s, v]).astype(np.uint8)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    return img


def preprocess_image_with_timings(img, cfg):
    timings = {}
    t0 = time.perf_counter()
    if cfg["scale"] != 1.0:
        t = time.perf_counter()
        h, w = img.shape[:2]
        img = cv2.resize(
            img,
            (int(w * cfg["scale"]), int(h * cfg["scale"])),
            interpolation=cv2.INTER_LANCZOS4,
        )
        timings["scale_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["nlm_h"] > 0:
        t = time.perf_counter()
        img = cv2.fastNlMeansDenoisingColored(
            img,
            None,
            h=cfg["nlm_h"],
            hColor=cfg["nlm_h_color"],
            templateWindowSize=7,
            searchWindowSize=21,
        )
        timings["nlm_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["bilateral_d"] > 0:
        t = time.perf_counter()
        img = cv2.bilateralFilter(
            img,
            d=cfg["bilateral_d"],
            sigmaColor=cfg["bilateral_sigma_color"],
            sigmaSpace=cfg["bilateral_sigma_space"],
        )
        timings["bilateral_ms"] = (time.perf_counter() - t) * 1000.0

    t = time.perf_counter()
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = cv2.split(hsv)

    line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
    bg_mask = ~line_mask

    if cfg["bg_whiten_strength"] > 0:
        s[bg_mask] = s[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
        v[bg_mask] = np.clip(
            v[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
            + cfg["bg_val_target"] * cfg["bg_whiten_strength"],
            0,
            255,
        )

    white_mask = (s < cfg["white_sat_max"]) & (v > cfg["white_val_min"])
    s[white_mask] = s[white_mask] * cfg["white_sat_scale"]
    v[white_mask] = np.maximum(v[white_mask], cfg["white_val_target"])

    color_mask = line_mask & (s > cfg["sat_mask_min"]) & (v > cfg["sat_val_min"])
    s[color_mask] = np.clip(s[color_mask] * cfg["sat_mult"], 0, 255)

    if cfg["black_val_strength"] > 0:
        black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
        v[black_mask] = np.clip(
            v[black_mask] * (1.0 - cfg["black_val_strength"])
            + cfg["black_val_target"] * cfg["black_val_strength"],
            0,
            255,
        )

    hsv = cv2.merge([h, s, v]).astype(np.uint8)
    img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    timings["hsv_adjust_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["clahe_clip"] > 0:
        t = time.perf_counter()
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(
            clipLimit=cfg["clahe_clip"],
            tileGridSize=(cfg["clahe_tile"], cfg["clahe_tile"]),
        )
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
        timings["clahe_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["sharpen_amount"] > 0:
        t = time.perf_counter()
        blur = cv2.GaussianBlur(img, (0, 0), cfg["sharpen_sigma"])
        img = cv2.addWeighted(
            img,
            1.0 + cfg["sharpen_amount"],
            blur,
            -cfg["sharpen_amount"],
            0,
        )
        timings["sharpen_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["bg_whiten_strength"] > 0:
        t = time.perf_counter()
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        h, s, v = cv2.split(hsv)
        line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
        bg_mask = ~line_mask
        s[bg_mask] = s[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
        v[bg_mask] = np.clip(
            v[bg_mask] * (1.0 - cfg["bg_whiten_strength"])
            + cfg["bg_val_target"] * cfg["bg_whiten_strength"],
            0,
            255,
        )
        if cfg["black_val_strength"] > 0:
            black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
            v[black_mask] = np.clip(
                v[black_mask] * (1.0 - cfg["black_val_strength"])
                + cfg["black_val_target"] * cfg["black_val_strength"],
                0,
                255,
            )
        hsv = cv2.merge([h, s, v]).astype(np.uint8)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        timings["bg_whiten2_ms"] = (time.perf_counter() - t) * 1000.0

    if cfg["line_dilate_px"] > 0:
        t = time.perf_counter()
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        h, s, v = cv2.split(hsv)
        line_mask = (s >= cfg["line_sat_min"]) | (v <= cfg["line_val_max_for_black"])
        color_mask = line_mask & (s > cfg["sat_mask_min"]) & (v > cfg["sat_val_min"])
        black_mask = (v <= cfg["line_val_max_for_black"]) & (s <= cfg["black_sat_max"])
        kernel_size = cfg["line_dilate_px"] * 2 + 1
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
        )
        dilated_color = cv2.dilate(color_mask.astype(np.uint8), kernel, iterations=1).astype(bool)
        dilated_black = cv2.dilate(black_mask.astype(np.uint8), kernel, iterations=1).astype(bool)
        s[dilated_color] = np.clip(s[dilated_color] * cfg["sat_mult"], 0, 255)
        v[dilated_color] = np.maximum(v[dilated_color], cfg["sat_val_min"])
        if cfg["black_val_strength"] > 0:
            v[dilated_black] = np.clip(
                v[dilated_black] * (1.0 - cfg["black_val_strength"])
                + cfg["black_val_target"] * cfg["black_val_strength"],
                0,
                255,
            )
        hsv = cv2.merge([h, s, v]).astype(np.uint8)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        timings["line_dilate_ms"] = (time.perf_counter() - t) * 1000.0

    timings["total_ms"] = (time.perf_counter() - t0) * 1000.0
    return img, timings


def parse_args():
    parser = argparse.ArgumentParser(description="Lightweight preprocessing for map lines.")
    parser.add_argument("input", help="Input image path")
    parser.add_argument("output", help="Output image path")
    parser.add_argument(
        "--scale",
        type=float,
        default=2.0,
        help="Upscale factor to reduce pixelation (1.0 disables).",
    )
    parser.add_argument(
        "--nlm-h",
        type=float,
        default=0.0,
        help="Strength of non-local means denoising for luminance.",
    )
    parser.add_argument(
        "--nlm-h-color",
        type=float,
        default=0.0,
        help="Strength of non-local means denoising for color.",
    )
    parser.add_argument(
        "--bilateral-d",
        type=int,
        default=7,
        help="Bilateral filter diameter (0 disables).",
    )
    parser.add_argument(
        "--bilateral-sigma-color",
        type=float,
        default=35.0,
        help="Bilateral filter color sigma (edge preservation).",
    )
    parser.add_argument(
        "--bilateral-sigma-space",
        type=float,
        default=35.0,
        help="Bilateral filter spatial sigma (smoothing extent).",
    )
    parser.add_argument(
        "--white-sat-max",
        type=float,
        default=60.0,
        help="Max saturation to treat a pixel as near-white.",
    )
    parser.add_argument(
        "--white-val-min",
        type=float,
        default=180.0,
        help="Min value to treat a pixel as near-white.",
    )
    parser.add_argument(
        "--white-val-target",
        type=float,
        default=205.0,
        help="Target brightness for near-white pixels.",
    )
    parser.add_argument(
        "--white-sat-scale",
        type=float,
        default=0.2,
        help="Scale factor to reduce saturation on near-white pixels.",
    )
    parser.add_argument(
        "--line-sat-min",
        type=float,
        default=15.0,
        help="Saturation threshold to classify a pixel as a line.",
    )
    parser.add_argument(
        "--line-val-max-for-black",
        type=float,
        default=160.0,
        help="Value threshold to treat dark pixels as black lines.",
    )
    parser.add_argument(
        "--black-val-target",
        type=float,
        default=25.0,
        help="Target brightness for black line pixels.",
    )
    parser.add_argument(
        "--black-val-strength",
        type=float,
        default=0.5,
        help="Strength to pull black lines toward the target brightness.",
    )
    parser.add_argument(
        "--black-sat-max",
        type=float,
        default=45.0,
        help="Max saturation for pixels eligible for black-line darkening.",
    )
    parser.add_argument(
        "--bg-whiten-strength",
        type=float,
        default=0.5,
        help="Strength of background whitening (0 disables, 1 max).",
    )
    parser.add_argument(
        "--bg-val-target",
        type=float,
        default=245.0,
        help="Target brightness for background pixels.",
    )
    parser.add_argument(
        "--sat-mask-min",
        type=float,
        default=20.0,
        help="Min saturation for applying saturation boost.",
    )
    parser.add_argument(
        "--sat-val-min",
        type=float,
        default=90.0,
        help="Min value for applying saturation boost.",
    )
    parser.add_argument(
        "--sat-mult",
        type=float,
        default=3,
        help="Saturation multiplier for line pixels.",
    )
    parser.add_argument(
        "--line-dilate-px",
        type=int,
        default=1,
        help="Radius in pixels to dilate line masks (0 disables).",
    )
    parser.add_argument(
        "--clahe-clip",
        type=float,
        default=0.0,
        help="CLAHE clip limit (0 disables contrast equalization).",
    )
    parser.add_argument(
        "--clahe-tile",
        type=int,
        default=8,
        help="CLAHE tile size (used when --clahe-clip > 0).",
    )
    parser.add_argument(
        "--sharpen-amount",
        type=float,
        default=0.4,
        help="Unsharp mask strength (0 disables).",
    )
    parser.add_argument(
        "--sharpen-sigma",
        type=float,
        default=1.0,
        help="Unsharp mask blur sigma.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    img = cv2.imread(args.input)
    if img is None:
        raise SystemExit(f"Could not read input image: {args.input}")

    cfg = {
        "scale": args.scale,
        "nlm_h": args.nlm_h,
        "nlm_h_color": args.nlm_h_color,
        "bilateral_d": args.bilateral_d,
        "bilateral_sigma_color": args.bilateral_sigma_color,
        "bilateral_sigma_space": args.bilateral_sigma_space,
        "white_sat_max": args.white_sat_max,
        "white_val_min": args.white_val_min,
        "white_val_target": args.white_val_target,
        "white_sat_scale": args.white_sat_scale,
        "line_sat_min": args.line_sat_min,
        "line_val_max_for_black": args.line_val_max_for_black,
        "black_val_target": args.black_val_target,
        "black_val_strength": args.black_val_strength,
        "black_sat_max": args.black_sat_max,
        "bg_whiten_strength": args.bg_whiten_strength,
        "bg_val_target": args.bg_val_target,
        "sat_mask_min": args.sat_mask_min,
        "sat_val_min": args.sat_val_min,
        "sat_mult": args.sat_mult,
        "line_dilate_px": args.line_dilate_px,
        "clahe_clip": args.clahe_clip,
        "clahe_tile": args.clahe_tile,
        "sharpen_amount": args.sharpen_amount,
        "sharpen_sigma": args.sharpen_sigma,
    }

    out = preprocess_image(img, cfg)
    cv2.imwrite(args.output, out)
    print(f"Saved preprocessed image to: {args.output}")


if __name__ == "__main__":
    main()
