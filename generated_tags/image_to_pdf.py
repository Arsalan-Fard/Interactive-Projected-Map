from PIL import Image
import os

def create_pdf_grid():
    # Configuration
    output_filename = "tags_grid3.pdf"
    # Generate filenames for id00 to id11
    image_files = [f"tag36h11_id{i:02d}.png" for i in range(50)]
    
    # A4 size at 300 DPI (approximate)
    # Width: 8.27 inch * 300 dpi = 2481
    # Height: 11.7 inch * 300 dpi = 3510
    a4_width = 2480
    a4_height = 3508
    
    # Grid configuration
    cols = 5
    rows = 10
    
    # Margins
    margin = 100
    
    # Calculate available space
    usable_width = a4_width - (2 * margin)
    usable_height = a4_height - (2 * margin)
    
    cell_width = usable_width // cols
    cell_height = usable_height // rows
    
    # Determine image size to fit in cell (keeping square aspect ratio)
    # Subtracting a small padding between images
    padding = 20
    image_display_size = min(cell_width, cell_height) - padding
    
    # Create white canvas
    canvas = Image.new('RGB', (a4_width, a4_height), 'white')
    
    print(f"Generating PDF with {len(image_files)} images...")
    
    for i, filename in enumerate(image_files):
        if not os.path.exists(filename):
            print(f"Error: {filename} not found.")
            continue
            
        try:
            img = Image.open(filename)
            
            # Resize image high quality
            img_resized = img.resize((image_display_size, image_display_size), Image.Resampling.LANCZOS)
            
            # Calculate grid position
            col = i % cols
            row = i // cols
            
            # Calculate pixel coordinates (centering image in its cell)
            x = margin + (col * cell_width) + (cell_width - image_display_size) // 2
            y = margin + (row * cell_height) + (cell_height - image_display_size) // 2
            
            canvas.paste(img_resized, (x, y))
            print(f"Added {filename} at pos ({col}, {row})")
            
        except Exception as e:
            print(f"Failed to process {filename}: {e}")

    # Save
    canvas.save(output_filename, "PDF", resolution=300.0)
    print(f"Successfully created {output_filename}")

if __name__ == "__main__":
    create_pdf_grid()
