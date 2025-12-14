from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
import osmnx as ox
import networkx as nx
import json
import os
import time

# Initialize Flask app
# static_folder='.' allows serving files from the current directory
# static_url_path='' makes them available at the root URL (e.g. /src/main.js)
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# --- OSMnx Service Logic ---

# Load graph once at startup (this is slow, ~5-10 seconds)
print("Loading walking network graph from OSMnx...")
# Using a try-except block to handle potential loading errors gracefully or retry
try:
    G = ox.graph_from_place("Palaiseau, France", network_type="walk")
    print(f"Graph loaded! {len(G.nodes)} nodes, {len(G.edges)} edges")
except Exception as e:
    print(f"Error loading graph: {e}")
    G = None

def get_isochrone(lat, lon, distance_meters):
    """
    Calculate isochrone (reachable area) from a point.
    """
    if G is None:
        return None
        
    try:
        # Find nearest node in the graph
        node = ox.nearest_nodes(G, lon, lat)

        # Get subgraph of reachable nodes within distance
        subgraph = nx.ego_graph(G, node, radius=distance_meters, distance="length")

        # Convert to GeoDataFrame (nodes only)
        nodes_gdf = ox.graph_to_gdfs(subgraph, edges=False)

        # Convert to GeoJSON
        geojson = json.loads(nodes_gdf.to_json())

        return geojson
    except Exception as e:
        print(f"Error calculating isochrone: {e}")
        return None

@app.route('/api/isochrone', methods=['POST'])
def calculate_isochrone():
    """
    API endpoint to calculate isochrone.
    """
    try:
        data = request.json
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
        distance = int(data.get('distance', 500))  # Default 500m

        # Validate inputs
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return jsonify({"error": "Invalid coordinates"}), 400

        if not (10 <= distance <= 5000):
            return jsonify({"error": "Distance must be between 10 and 5000 meters"}), 400

        # Calculate isochrone
        isochrone = get_isochrone(lat, lon, distance)

        if isochrone is None:
            return jsonify({"error": "Failed to calculate isochrone"}), 500

        return jsonify(isochrone)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/route', methods=['POST'])
def get_route():
    """Calculate shortest path using OSMnx."""
    if G is None:
        return jsonify({'error': 'Graph not loaded'}), 500

    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        start = data.get('start') # [lng, lat]
        end = data.get('end')     # [lng, lat]

        if not start or not end:
            return jsonify({'error': 'Missing start or end coordinates'}), 400

        # Find nearest nodes
        # osmnx.distance.nearest_nodes takes (G, X, Y) -> (G, lng, lat)
        orig_node = ox.nearest_nodes(G, start[0], start[1])
        dest_node = ox.nearest_nodes(G, end[0], end[1])

        # Calculate shortest path
        route_nodes = nx.shortest_path(G, orig_node, dest_node, weight='length')

        # Convert to coordinates
        route_coords = []
        for node in route_nodes:
            # G.nodes[node] contains 'x' and 'y'
            point = G.nodes[node]
            route_coords.append([point['x'], point['y']])

        return jsonify({
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': route_coords
            }
        })

    except Exception as e:
        print(f"Routing error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_geojson', methods=['POST'])
def save_geojson():
    """Save GeoJSON data to a file."""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        geojson = data.get('geojson')
        filename = data.get('filename')

        if not geojson:
            return jsonify({'error': 'Missing geojson data'}), 400
            
        if not filename:
            filename = f"stickers_{int(time.time())}.geojson"
            
        # Ensure filename is safe (basic check)
        filename = os.path.basename(filename)
        
        # Ensure data directory exists
        data_dir = os.path.join(os.path.dirname(__file__), 'data', 'inputs')
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
            
        filepath = os.path.join(data_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(geojson, f, indent=2)
            
        print(f"Saved GeoJSON to {filepath}")
        return jsonify({'status': 'success', 'filepath': filepath})

    except Exception as e:
        print(f"Error saving GeoJSON: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "graph_nodes": len(G.nodes) if G else 0,
        "graph_edges": len(G.edges) if G else 0
    })


# --- Static File Serving (Must come AFTER API routes) ---

@app.route('/')
def index():
    """Serve the main entry point."""
    return send_from_directory('.', 'index.html')

@app.route('/app')
def app_page():
    """Serve the app.html page if needed."""
    return send_from_directory('.', 'app.html')

@app.route('/<path:path>')
def serve_file(path):
    """Serve any other static file."""
    if os.path.exists(path):
        return send_from_directory('.', path)
    return jsonify({"error": "File not found"}), 404

if __name__ == '__main__':
    port = 8000
    print(f"Server starting on http://localhost:{port}")
    # debug=True allows auto-reload on file changes
    app.run(host='0.0.0.0', port=port, debug=True)