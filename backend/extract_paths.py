"""
Path Detection for Multi-colored Lines with Varying Width and Lighting
Uses ridge detection first, then classifies by hue (better for faint lines)
Fixed for: BLACK, RED, BLUE, GREEN lines
"""

import cv2
import numpy as np
import os
from skimage.filters import meijering
from skimage.morphology import skeletonize, remove_small_objects, disk
from skimage import img_as_float
import matplotlib.pyplot as plt


def load_and_preprocess(image_path):
    """Load image and convert to different color spaces"""
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img_rgb, img_hsv, img_gray


def apply_ridge_detection(img_gray, sigmas=range(1, 6), threshold=0.1, margin=15):
    """Apply ridge detection using Meijering filter for line structures"""
    img_float = img_as_float(img_gray)
    img_inverted = 1 - img_float
    ridges = meijering(img_inverted, sigmas=sigmas, black_ridges=False)
    ridges_norm = (ridges - ridges.min()) / (ridges.max() - ridges.min() + 1e-8)
    ridge_mask = ridges_norm > threshold
    
    # Remove border artifacts (set margin pixels to False)
    if margin > 0:
        ridge_mask[:margin, :] = False  # top
        ridge_mask[-margin:, :] = False  # bottom
        ridge_mask[:, :margin] = False  # left
        ridge_mask[:, -margin:] = False  # right
    
    return ridges_norm, ridge_mask


def classify_by_hue_and_saturation(img_hsv, ridge_mask):
    """
    Classify ridge pixels by their hue and saturation values.
    
    OpenCV HSV: H is 0-180, S is 0-255, V is 0-255
    
    For BLACK: Low value (dark pixels), regardless of hue
    For RED: Hue wraps around 0/180 (roughly 0-12 and 165-180), high saturation
    For GREEN: Hue around 40-90, high saturation
    For BLUE: Hue around 90-135, high saturation
    """
    hue = img_hsv[:, :, 0]
    sat = img_hsv[:, :, 1]
    val = img_hsv[:, :, 2]
    
    masks = {}
    
    # BLACK: Dark pixels (low value) - this is the key distinguishing feature
    masks['black'] = ridge_mask & (val < 120)
    
    # For colored lines: not black AND higher saturation
    colored_mask = ridge_mask & (val >= 100) & (sat >= 50)
    
    # RED: Hue wraps around 0/180 (roughly 0-12 and 165-180)
    masks['red'] = colored_mask & ((hue < 12) | (hue >= 165))
    
    # GREEN: Hue around 35-90
    masks['green'] = colored_mask & (hue >= 35) & (hue < 90)
    
    # BLUE: Hue around 90-140
    masks['blue'] = colored_mask & (hue >= 90) & (hue < 140)
    
    # Convert to uint8
    for color_name in masks:
        masks[color_name] = masks[color_name].astype(np.uint8) * 255
    
    return masks


def clean_masks(masks, min_size=50):
    """Clean up masks with morphological operations"""
    cleaned = {}
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    
    for color_name, mask in masks.items():
        # Morphological cleanup
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        
        # Remove small objects
        mask_bool = mask.astype(bool)
        if mask_bool.sum() > 0:
            mask_bool = remove_small_objects(mask_bool, min_size=min_size)
        cleaned[color_name] = (mask_bool.astype(np.uint8) * 255)
    
    return cleaned


def skeletonize_paths(masks):
    """Skeletonize paths to get single-pixel-wide lines"""
    skeletons = {}
    for color_name, mask in masks.items():
        if mask.max() > 0:
            skel = skeletonize(mask > 0)
            skeletons[color_name] = (skel * 255).astype(np.uint8)
        else:
            skeletons[color_name] = mask
    return skeletons


def prune_small_components(skel, min_pixels=60):
    """Remove tiny connected components from a skeleton mask."""
    if skel.max() == 0:
        return skel
    labels_count, labels = cv2.connectedComponents((skel > 0).astype(np.uint8))
    if labels_count <= 1:
        return skel

    kept = np.zeros_like(skel)
    for label_id in range(1, labels_count):
        if (labels == label_id).sum() >= min_pixels:
            kept[labels == label_id] = 255
    return kept


def suppress_overlapping_paths(
    skeletons,
    primary_color='blue',
    secondary_color='black',
    radius=12,
    min_overlap_ratio=0.2,
    min_remaining_pixels=50
):
    """
    Suppress a secondary path if it mostly overlaps the primary path.
    Removes overlapping pixels from the secondary and optionally drops tiny remnants.
    """
    primary = skeletons.get(primary_color)
    secondary = skeletons.get(secondary_color)
    if primary is None or secondary is None:
        return skeletons
    if primary.max() == 0 or secondary.max() == 0:
        return skeletons

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
    )
    primary_dilated = cv2.dilate(primary, kernel, iterations=1)
    overlap = (secondary > 0) & (primary_dilated > 0)

    secondary_count = (secondary > 0).sum()
    overlap_ratio = overlap.sum() / max(1, secondary_count)

    if overlap_ratio >= min_overlap_ratio:
        cleaned = secondary.copy()
        cleaned[overlap] = 0
        if (cleaned > 0).sum() < min_remaining_pixels:
            cleaned[:] = 0
        updated = dict(skeletons)
        updated[secondary_color] = cleaned
        return updated

    return skeletons


def create_visualization(img_rgb, ridges_norm, color_masks, skeletons):
    """Create comprehensive visualization of results"""
    fig, axes = plt.subplots(2, 3, figsize=(16, 11))
    
    # Visualization colors (bright versions for display)
    color_map = {
        'black': [50, 50, 50],      # Dark gray for visibility
        'red': [255, 0, 0],
        'green': [0, 200, 0],
        'blue': [0, 100, 255],
    }
    
    # Original image
    axes[0, 0].imshow(img_rgb)
    axes[0, 0].set_title('Original Image', fontsize=12)
    axes[0, 0].axis('off')
    
    # Ridge detection result
    axes[0, 1].imshow(ridges_norm, cmap='hot')
    axes[0, 1].set_title('Ridge Detection (Meijering Filter)', fontsize=12)
    axes[0, 1].axis('off')
    
    # Combined color masks
    combined_colors = np.zeros((*img_rgb.shape[:2], 3), dtype=np.uint8)
    for color_name, mask in color_masks.items():
        if color_name in color_map:
            combined_colors[mask > 0] = color_map[color_name]
    axes[0, 2].imshow(combined_colors)
    axes[0, 2].set_title('Color Classification (Ridge + Hue/Sat)', fontsize=12)
    axes[0, 2].axis('off')
    
    # Skeletonized paths
    skeleton_combined = np.zeros((*img_rgb.shape[:2], 3), dtype=np.uint8)
    for color_name, skel in skeletons.items():
        if color_name in color_map:
            skeleton_combined[skel > 0] = color_map[color_name]
    axes[1, 0].imshow(skeleton_combined)
    axes[1, 0].set_title('Skeletonized Paths', fontsize=12)
    axes[1, 0].axis('off')
    
    # Overlay on original
    overlay = img_rgb.copy()
    for color_name, skel in skeletons.items():
        if color_name in color_map:
            dilated_skel = cv2.dilate(skel, disk(2), iterations=1)
            overlay[dilated_skel > 0] = color_map[color_name]
    axes[1, 1].imshow(overlay)
    axes[1, 1].set_title('Detected Paths Overlay', fontsize=12)
    axes[1, 1].axis('off')
    
    # Individual masks summary
    axes[1, 2].axis('off')
    summary = "Detected pixels per color:\n\n"
    for color_name, mask in color_masks.items():
        count = (mask > 0).sum()
        summary += f"{color_name}: {count} px\n"
    axes[1, 2].text(0.1, 0.5, summary, fontsize=14, verticalalignment='center')
    axes[1, 2].set_title('Summary', fontsize=12)
    
    plt.tight_layout()
    return fig


def main(image_path):
    """Main processing pipeline"""
    print("Loading and preprocessing image...")
    img_rgb, img_hsv, img_gray = load_and_preprocess(image_path)
    
    print("Applying ridge detection...")
    ridges_norm, ridge_mask = apply_ridge_detection(img_gray)
    
    print("Classifying lines by hue and saturation...")
    color_masks = classify_by_hue_and_saturation(img_hsv, ridge_mask)
    
    print("Cleaning masks...")
    color_masks = clean_masks(color_masks)
    
    print("Skeletonizing paths...")
    skeletons = skeletonize_paths(color_masks)

    print("Suppressing overlapping paths (black vs blue)...")
    skeletons = suppress_overlapping_paths(
        skeletons,
        primary_color='blue',
        secondary_color='black',
        radius=12,
        min_overlap_ratio=0.2,
        min_remaining_pixels=50
    )

    print("Pruning tiny skeleton components...")
    MIN_SKELETON_PIXELS = 60
    for color_name, skel in list(skeletons.items()):
        skeletons[color_name] = prune_small_components(
            skel,
            min_pixels=MIN_SKELETON_PIXELS
        )

    print("Creating visualization...")
    fig = create_visualization(img_rgb, ridges_norm, color_masks, skeletons)
    
    # Save results
    output_path = 'path_detection_results.png'
    fig.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    print(f"Results saved to: {output_path}")
    
    # Save individual masks
    print("\nSaving individual path masks...")
    for color_name, skel in skeletons.items():
        mask_path = f'path_{color_name}.png'
        if skel.max() > 0:
            cv2.imwrite(mask_path, skel)
            print(f"  - {color_name}: {mask_path}")
        elif os.path.exists(mask_path):
            os.remove(mask_path)
            print(f"  - {color_name}: removed empty mask {mask_path}")
    
    plt.close('all')
    return color_masks, skeletons, ridges_norm


if __name__ == "__main__":
    image_path = "image_pre.png"
    color_masks, skeletons, ridges = main(image_path)
    print("\nDone!")
