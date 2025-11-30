# Generates 5 printable AprilTags (tag25h9 family) as PNG files.

import numpy as np
from moms_apriltag import TagGenerator2  
from PIL import Image

TAG_FAMILY = "tag25h9"
TAG_IDS = [0, 1, 2, 3, 4]     # which tags to generate
INNER_SIZE_PX = 1000          # size of the tag itself (without margin)
MARGIN_RATIO = 0.25           # margin around the tag (25% of tag size)

def upscale_tag(tag_binary, inner_size_px):
    """
    Upscale the small binary AprilTag image to a large square image
    using nearest-neighbor so edges stay sharp.
    """
    if tag_binary.max() <= 1:
        tag_binary = (tag_binary * 255).astype(np.uint8)
    else:
        tag_binary = tag_binary.astype(np.uint8)

    h, w = tag_binary.shape
    assert h == w, "Tag image should be square"

    scale = inner_size_px // h
    if scale < 1:
        raise ValueError("INNER_SIZE_PX is too small for this tag resolution")

    upscaled = np.kron(tag_binary, np.ones((scale, scale), dtype=np.uint8))
    upscaled = upscaled[:inner_size_px, :inner_size_px]

    return upscaled

def make_png(tag_array, tag_id, margin_ratio):
    """
    Wrap the upscaled tag in a white margin and save as PNG.
    """
    tag_img = Image.fromarray(tag_array, mode="L")

    margin = int(margin_ratio * tag_img.size[0])
    canvas_size = tag_img.size[0] + 2 * margin

    canvas = Image.new("L", (canvas_size, canvas_size), color=255)
    canvas.paste(tag_img, (margin, margin))

    filename = f"generated_tags/{TAG_FAMILY}_id{tag_id:02d}.png"
    canvas.save(filename, dpi=(300, 300)) 
    print(f"Saved {filename} (size: {canvas_size}x{canvas_size} pixels)")

def main():
    tg = TagGenerator2(TAG_FAMILY)

    for tag_id in TAG_IDS:
        tag_small = tg.generate(tag_id)         
        tag_big = upscale_tag(tag_small, INNER_SIZE_PX)
        make_png(tag_big, tag_id, MARGIN_RATIO) 

if __name__ == "__main__":
    main()
