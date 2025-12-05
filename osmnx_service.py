"""Flask service for calculating isochrones using OSMnx."""
import osmnx as ox
import networkx as nx
from flask import Flask, jsonify, request
from flask_cors import CORS
import json

app = Flask(__name__)
CORS(app)

# Load graph once at startup (this is slow, ~5-10 seconds)
print("Loading walking network graph from OSMnx...")
G = ox.graph_from_place("Palaiseau, France", network_type="walk")
print(f"Graph loaded! {len(G.nodes)} nodes, {len(G.edges)} edges")

def get_isochrone(lat, lon, distance_meters):
    """
    Calculate isochrone (reachable area) from a point.

    Args:
        lat: Latitude of starting point
        lon: Longitude of starting point
        distance_meters: Maximum walking distance in meters

    Returns:
        GeoJSON FeatureCollection of reachable nodes
    """
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

    Expects JSON body:
    {
        "lat": 48.7133,
        "lon": 2.2089,
        "distance": 500
    }
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "graph_nodes": len(G.nodes),
        "graph_edges": len(G.edges)
    })

if __name__ == '__main__':
    print("Starting isochrone service on http://localhost:5001")
    print("Use POST /api/isochrone with {lat, lon, distance} to calculate isochrones")
    app.run(host='127.0.0.1', port=5001, debug=False)