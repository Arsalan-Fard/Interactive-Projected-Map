import cv2
import numpy as np
import glob
import os
import json
import random

def pixel_to_coords(x, y, start_lat, start_lon, scale):
    """
    Convert pixel (x, y) to (lon, lat).
    x: column, y: row (y increases downwards)
    scale: degrees per pixel
    """
    lon = start_lon + (x * scale)
    lat = start_lat - (y * scale)
    return [lon, lat]

def process_image_to_geojson(image_path, start_lat, start_lon, scale):
    """
    Reads a path mask image and returns a GeoJSON FeatureCollection of LineStrings.
    """
    print(f"Processing {image_path}...")
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"Warning: Could not read {image_path}")
        return []

    # Find contours
    # RETR_LIST or RETR_EXTERNAL? EXTERNAL is fine for disjoint lines.
    # CHAIN_APPROX_SIMPLE reduces points, CHAIN_APPROX_NONE keeps all.
    # Since we want detail, let's use SIMPLE but it might cut corners. 
    # Let's use SIMPLE to keep file size reasonable, or NONE if it looks jagged.
    contours, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    features = []
    
    for contour in contours:
        # contour is shape (N, 1, 2) -> (x, y)
        if len(contour) < 2:
            continue
            
        points = contour.reshape(-1, 2)
        coords = []
        for x, y in points:
            coords.append(pixel_to_coords(float(x), float(y), start_lat, start_lon, scale))
            
        # If the contour is closed, it duplicates start/end.
        # For thin skeletons, contours often trace the perimeter (A->B->A).
        # We'll just plot the perimeter. It will look like a line.
        
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            },
            "properties": {}
        }
        features.append(feature)
        
    return features

def generate_html(color_layers, start_lat, start_lon):
    """
    Generates the HTML content with Mapbox GL JS.
    color_layers: dict { 'red': feature_list, 'blue': feature_list, ... }
    """
    
    # Prepare GeoJSON sources
    sources_js = ""
    layers_js = ""
    
    # Map 'black' to a dark gray for visibility on dark maps, or keep black.
    # Mapbox color names or hex codes.
    color_map = {
        'black': '#000000',
        'red': '#FF0000',
        'green': '#00FF00',
        'blue': '#0000FF',
        'blue_gray': '#6699CC',
        'pink_purple': '#DA70D6',
        'red_orange': '#FF4500',
        'yellow_green': '#9ACD32'
    }
    
    for color_name, features in color_layers.items():
        if not features:
            continue
            
        safe_name = color_name.replace(" ", "_")
        geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        
        sources_js += f"""
            map.addSource('{safe_name}-source', {{
                'type': 'geojson',
                'data': {json.dumps(geojson)}
            }});
        """
        
        display_color = color_map.get(color_name, '#FFFFFF')
        if color_name == 'black':
            display_color = '#333333' # Slightly lighter than pure black for visibility
            
        layers_js += f"""
            map.addLayer({{
                'id': '{safe_name}-layer',
                'type': 'line',
                'source': '{safe_name}-source',
                'layout': {{
                    'line-join': 'round',
                    'line-cap': 'round'
                }},
                'paint': {{
                    'line-color': '{display_color}',
                    'line-width': 3
                }}
            }});
        """

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Detected Paths Map</title>
<meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.js"></script>
<style>
body {{ margin: 0; padding: 0; }}
#map {{ position: absolute; top: 0; bottom: 0; width: 100%; }}
#menu {{
    position: absolute;
    background: #fff;
    padding: 10px;
    font-family: 'Open Sans', sans-serif;
    top: 10px;
    left: 10px;
    border-radius: 3px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}}
</style>
</head>
<body>
<div id="map"></div>
<div id="menu">
    <b>Instructions:</b><br>
    1. Open this file in a text editor.<br>
    2. Replace 'YOUR_MAPBOX_ACCESS_TOKEN' with your actual token.<br>
    3. Save and reload.<br>
    <br>
    <b>Detected Layers:</b><br>
    {', '.join(color_layers.keys())}
</div>
<script>
	// TO MAKE THIS WORK:
    // Replace the string below with your valid Mapbox Access Token.
    // It usually starts with 'pk.'
	mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';
    
    const map = new mapboxgl.Map({{
        container: 'map',
        // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
        style: 'mapbox://styles/mapbox/light-v11', 
        center: [{start_lon}, {start_lat}],
        zoom: 16
    }});

    map.on('load', () => {{
        {sources_js}
        {layers_js}
    }});
</script>

</body>
</html>
"""
    return html

def main():
    # Settings
    # Random start location (or fixed). Let's pick a nice park.
    # Golden Gate Park, SF: 37.7694, -122.4862
    START_LAT = 37.7694
    START_LON = -122.4862
    
    # Scale: approx 0.5 meter per pixel?
    # 1 degree lat ~= 111km = 111,000m
    # 1 meter ~= 1/111000 ~= 0.000009 degrees
    SCALE = 0.00001 
    
    # Find files
    files = glob.glob("path_*.png")
    # Exclude the result summary image if it matches the pattern
    if "path_detection_results.png" in files:
        files.remove("path_detection_results.png")
        
    color_layers = {}
    
    print(f"Found {len(files)} path images.")
    
    for f in files:
        # extract color name: path_red.png -> red
        basename = os.path.basename(f)
        color_name = basename.replace("path_", "").replace(".png", "")
        
        features = process_image_to_geojson(f, START_LAT, START_LON, SCALE)
        if features:
            color_layers[color_name] = features
            print(f"  - {color_name}: {len(features)} line segments")
            
    if not color_layers:
        print("No paths processed. Check if path_*.png files exist.")
        return

    # Generate HTML
    html_content = generate_html(color_layers, START_LAT, START_LON)
    
    output_file = "map.html"
    with open(output_file, "w") as f:
        f.write(html_content)
        
    print(f"\nMap generated: {output_file}")
    print("Don't forget to insert your Mapbox Access Token in the HTML file!")

if __name__ == "__main__":
    main()
