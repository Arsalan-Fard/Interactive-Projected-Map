from flask import Flask, send_from_directory, jsonify, request, render_template, Response
from flask_cors import CORS
import osmnx as ox
import networkx as nx
import json
import os
import time
import shutil

CONFIG_ROOT = os.path.join(os.path.dirname(__file__), 'static', 'data', 'projects')

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# OSMnx Service Logic
print("Loading walking network graph from OSMnx")
try:
    G = ox.graph_from_place("Palaiseau, France", network_type="walk")
    print(f"Walking graph loaded. {len(G.nodes)} nodes")
    
    G_bike = ox.graph_from_place("Palaiseau, France", network_type="bike")
    print(f"Cycling graph loaded. {len(G_bike.nodes)} nodes")
except Exception as e:
    print(f"Error loading graphs: {e}")
    G = None
    G_bike = None

def get_isochrone(lat, lon, distance_meters, mode='walk'):
    graph = G if mode == 'walk' else G_bike
    
    if graph is None:
        return None
    try:
        node = ox.nearest_nodes(graph, lon, lat)
        subgraph = nx.ego_graph(graph, node, radius=distance_meters, distance="length")
        
        if len(subgraph.nodes) < 3:
            return None

        nodes_gdf = ox.graph_to_gdfs(subgraph, edges=False)
        polygon = nodes_gdf.unary_union.convex_hull
        
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"distance": distance_meters, "mode": mode},
                "geometry": json.loads(json.dumps(polygon.__geo_interface__))
            }]
        }
    except Exception as e:
        print(f"Error calculating isochrone: {e}")
        return None

def get_latest_config_path():
    if not os.path.exists(CONFIG_ROOT):
        return None
    latest_path = None
    latest_mtime = 0
    for entry in os.scandir(CONFIG_ROOT):
        if entry.is_dir():
            candidate = os.path.join(entry.path, 'config.json')
            if os.path.exists(candidate):
                mtime = os.path.getmtime(candidate)
                if mtime > latest_mtime:
                    latest_mtime = mtime
                    latest_path = candidate
    return latest_path

def list_projects():
    projects = []
    if not os.path.exists(CONFIG_ROOT):
        return projects
    for entry in os.scandir(CONFIG_ROOT):
        if entry.is_dir():
            cfg_path = os.path.join(entry.path, 'config.json')
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, 'r') as f:
                        cfg = json.load(f)
                    stat = os.stat(cfg_path)
                    projects.append({
                        "id": cfg.get('project', {}).get('id') or entry.name,
                        "name": cfg.get('project', {}).get('name'),
                        "location": cfg.get('project', {}).get('location'),
                        "mapId": cfg.get('project', {}).get('mapId'),
                        "updatedAt": stat.st_mtime
                    })
                except Exception:
                    continue
    return projects

@app.route('/api/isochrone', methods=['POST'])
def calculate_isochrone():
    try:
        data = request.json
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
        distance = int(data.get('distance', 500))
        mode = data.get('mode', 'walk')
        
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return jsonify({"error": "Invalid coordinates"}), 400
        if not (10 <= distance <= 10000):
            return jsonify({"error": "Distance must be between 10 and 10000 meters"}), 400
            
        isochrone = get_isochrone(lat, lon, distance, mode)
        if isochrone is None:
            return jsonify({"error": "Failed to calculate isochrone"}), 500
        return jsonify(isochrone)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/route', methods=['POST'])
def get_route():
    if G is None:
        return jsonify({'error': 'Graph not loaded'}), 500
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        start = data.get('start')
        end = data.get('end')
        if not start or not end:
            return jsonify({'error': 'Missing start or end coordinates'}), 400

        orig_node = ox.nearest_nodes(G, start[0], start[1])
        dest_node = ox.nearest_nodes(G, end[0], end[1])
        route_nodes = nx.shortest_path(G, orig_node, dest_node, weight='length')
        route_coords = []
        for node in route_nodes:
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
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        geojson = data.get('geojson')
        filename = data.get('filename')
        project_id = data.get('projectId')

        if not geojson:
            return jsonify({'error': 'Missing geojson data'}), 400
        if not filename:
            filename = f"stickers_{int(time.time())}.geojson"
        filename = os.path.basename(filename)

        if not project_id:
            latest = get_latest_config_path()
            if latest:
                try:
                    with open(latest, 'r') as f:
                        cfg = json.load(f)
                        project_id = cfg.get('project', {}).get('id')
                except Exception:
                    project_id = None
        if not project_id:
            project_id = 'default-project'

        answers_dir = os.path.join(CONFIG_ROOT, project_id, 'answers')
        os.makedirs(answers_dir, exist_ok=True)
        filepath = os.path.join(answers_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(geojson, f, indent=2)
            
        print(f"Saved GeoJSON to {filepath}")
        return jsonify({'status': 'success', 'filepath': filepath})
    except Exception as e:
        print(f"Error saving GeoJSON: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_responses', methods=['POST'])
def save_responses():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400

        responses = data.get('responses') if isinstance(data, dict) else None
        if responses is None:
            responses = data

        filename = data.get('filename') if isinstance(data, dict) else None
        if not filename:
            filename = f"responses_{int(time.time())}.json"
        filename = os.path.basename(filename)

        project_id = None
        if isinstance(data, dict):
            project_id = data.get('projectId')
        if not project_id and isinstance(responses, dict):
            project_id = responses.get('projectId')

        if not project_id:
            latest = get_latest_config_path()
            if latest:
                try:
                    with open(latest, 'r') as f:
                        cfg = json.load(f)
                        project_id = cfg.get('project', {}).get('id')
                except Exception:
                    project_id = None
        if not project_id:
            project_id = 'default-project'

        answers_dir = os.path.join(CONFIG_ROOT, project_id, 'answers')
        os.makedirs(answers_dir, exist_ok=True)
        filepath = os.path.join(answers_dir, filename)

        with open(filepath, 'w') as f:
            json.dump(responses, f, indent=2)

        print(f"Saved responses to {filepath}")
        return jsonify({'status': 'success', 'filepath': filepath})
    except Exception as e:
        print(f"Error saving responses: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/responses', methods=['GET', 'DELETE'])
def list_responses():
    if request.method == 'DELETE':
        project_id = request.args.get('project')
        filename = request.args.get('filename')
        if not project_id:
            return jsonify({'error': 'Missing project ID'}), 400
        if not filename:
            return jsonify({'error': 'Missing filename'}), 400

        filename = os.path.basename(filename)
        if not filename.endswith('.json'):
            return jsonify({'error': 'Invalid filename'}), 400

        answers_dir = os.path.join(CONFIG_ROOT, project_id, 'answers')
        filepath = os.path.join(answers_dir, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'Response not found'}), 404

        try:
            os.remove(filepath)
            return jsonify({'status': 'deleted', 'filename': filename})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    project_id = request.args.get('project')
    if not project_id:
        latest = get_latest_config_path()
        if latest:
            try:
                with open(latest, 'r') as f:
                    cfg = json.load(f)
                    project_id = cfg.get('project', {}).get('id')
            except Exception:
                project_id = None
    if not project_id:
        project_id = 'default-project'

    answers_dir = os.path.join(CONFIG_ROOT, project_id, 'answers')
    if not os.path.exists(answers_dir):
        return jsonify({'responses': []})

    responses = []
    for entry in os.scandir(answers_dir):
        if not entry.is_file() or not entry.name.endswith('.json'):
            continue
        try:
            with open(entry.path, 'r') as f:
                data = json.load(f)
            if not isinstance(data, dict) or 'answers' not in data:
                continue
            if not data.get('savedAt'):
                data['savedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(entry.stat().st_mtime))
            data['__filename'] = entry.name
            responses.append(data)
        except Exception:
            continue

    responses.sort(key=lambda item: item.get('savedAt', ''), reverse=True)
    return jsonify({'responses': responses})

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "ok",
        "graph_nodes": len(G.nodes) if G else 0,
        "graph_edges": len(G.edges) if G else 0
    })

@app.route('/api/projects', methods=['GET'])
def projects_list():
    """Return list of available projects with metadata."""
    return jsonify(list_projects())

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    """Delete a project and its data."""
    if not project_id:
        return jsonify({"error": "Missing project ID"}), 400
    
    project_dir = os.path.join(CONFIG_ROOT, project_id)
    if not os.path.exists(project_dir):
        return jsonify({"error": "Project not found"}), 404
        
    try:
        shutil.rmtree(project_dir)
        return jsonify({"status": "deleted", "id": project_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/config', methods=['GET', 'POST'])
def config_store():
    if request.method == 'GET':
        project_id = request.args.get('project')
        if project_id:
            cfg_path = os.path.join(CONFIG_ROOT, project_id, 'config.json')
        else:
            cfg_path = get_latest_config_path()

        if cfg_path and os.path.exists(cfg_path):
            try:
                with open(cfg_path, 'r') as f:
                    data = json.load(f)
                return jsonify(data)
            except Exception as e:
                return jsonify({"error": f"Failed to read config: {e}"}), 500
        return jsonify({"error": "Config not found"}), 404

    try:
        payload = request.get_json()
        if not payload:
            return jsonify({"error": "Invalid JSON"}), 400

        config_body = payload.get('config', payload)
        if not isinstance(config_body, dict):
            return jsonify({"error": "Config must be an object"}), 400

        project = config_body.get('project', {})
        project_id = project.get('id')
        if not project_id:
            return jsonify({"error": "Config missing project.id"}), 400

        project_dir = os.path.join(CONFIG_ROOT, project_id)
        os.makedirs(project_dir, exist_ok=True)
        cfg_path = os.path.join(project_dir, 'config.json')
        with open(cfg_path, 'w') as f:
            json.dump(config_body, f, indent=2)

        return jsonify({"status": "saved", "path": cfg_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/static/js/config.js')
def serve_config_js():
    # 1. Try to serve local file (Development)
    local_path = os.path.join(app.root_path, 'static', 'js', 'config.js')
    if os.path.exists(local_path):
        return send_from_directory('static/js', 'config.js')

    # 2. Generate from Environment Variables (Production/Render)
    token = os.environ.get('MAPBOX_ACCESS_TOKEN')
    if not token:
        return "Error: MAPBOX_ACCESS_TOKEN not set", 500

    js_content = f"""
export const CONFIG = {{
    accessToken: '{token}',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [2.2, 48.714],
    zoom: 15,
    pitch: 45,
    bearing: 40
}};
"""
    return Response(js_content, mimetype='application/javascript')

@app.route('/generated_tags/<path:filename>')
def serve_generated_tags(filename):
    tags_dir = os.path.join(app.root_path, 'generated_tags')
    return send_from_directory(tags_dir, filename)

# Static File Serving (Must come AFTER API routes)
@app.route('/')
def index():
    return render_template('setup.html')

@app.route('/app')
def app_page():
    return render_template('app.html')

@app.route('/setup')
def setup_page():
    return render_template('setup.html')

# Catch-all removed in favor of standard static file serving by Flask

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    print(f"Server starting on http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)
