import os

import osmnx as ox


location = (48.713, 2.20)  # IP Paris Coordinate
distance = 4000  # Distance in meters

default_out_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "static", "data")
)
out_dir = os.environ.get("GEOJSON_OUTPUT_DIR", default_out_dir)
os.makedirs(out_dir, exist_ok=True)


G_walk = ox.graph_from_point(location, dist=distance, network_type="walk")
nodes_walk, edges_walk = ox.graph_to_gdfs(G_walk)

cols_walk = [
    c
    for c in ["highway", "name", "oneway", "lanes", "maxspeed", "surface", "width", "geometry"]
    if c in edges_walk.columns
]
edges_walk = edges_walk[cols_walk] if cols_walk else edges_walk
edges_walk.to_file(os.path.join(out_dir, "walking_network.geojson"), driver="GeoJSON")
print(f"Saved {len(edges_walk)} walking network edges to {out_dir}")

# Walking nodes (as points)
nodes_walk = nodes_walk.reset_index()
if "osmid" not in nodes_walk.columns and "index" in nodes_walk.columns:
    nodes_walk = nodes_walk.rename(columns={"index": "osmid"})

cols_walk_nodes = [
    c
    for c in ["osmid", "x", "y", "street_count", "highway", "ref", "geometry"]
    if c in nodes_walk.columns
]
nodes_walk = nodes_walk[cols_walk_nodes] if cols_walk_nodes else nodes_walk
nodes_walk.to_file(os.path.join(out_dir, "walking_nodes.geojson"), driver="GeoJSON")
print(f"Saved {len(nodes_walk)} walking network nodes to {out_dir}")

try:
    mobility_infra = ox.features_from_point(
        location,
        dist=distance,
        tags={"cycleway": True, "highway": ["cycleway", "path"]}
    )
    cols_mobility = [c for c in ["cycleway", "highway", "name", "surface", "width", "lit", "geometry"]
                     if c in mobility_infra.columns]
    mobility_infra = mobility_infra[cols_mobility] if cols_mobility else mobility_infra
    mobility_infra.to_file(os.path.join(out_dir, "mobility_infrastructure.geojson"), driver="GeoJSON")
    print(f"Saved {len(mobility_infra)} mobility infrastructure to {out_dir}")
except Exception as e:
    print(f"Warning: Could not fetch mobility infrastructure: {e}")

try:
    amenities = ox.features_from_point(
        location,
        dist=distance,
        tags={"amenity": ["school", "hospital", "marketplace", "library"]}
    )
    cols_amenities = [c for c in ["amenity", "name", "addr:street", "addr:housenumber", "geometry"]
                      if c in amenities.columns]
    amenities = amenities[cols_amenities] if cols_amenities else amenities
    amenities.to_file(os.path.join(out_dir, "amenities.geojson"), driver="GeoJSON")
    print(f"Saved {len(amenities)} amenities to {out_dir}")
except Exception as e:
    print(f"   Warning: Could not fetch amenities: {e}")




try:
    bus_lanes = ox.features_from_point(
        location,
        dist=distance,
        tags={
            "bus": "yes",              
            "lanes:bus": True,         
            "highway": "bus_guideway"  
        }
    )
    
    if not bus_lanes.empty:
        bus_lanes.to_file(os.path.join(out_dir, "bus_lanes.geojson"), driver="GeoJSON")
        print(f"Saved {len(bus_lanes)} of bus infrastructure to {out_dir}.")
except Exception as e:
    print(f"Warning: Could not fetch bus lanes: {e}")
    
try:
    bus_stops = ox.features_from_point(
        location,
        dist=distance,
        tags={"highway": "bus_stop"}
    )
    
    cols_stops = [c for c in ["name", "highway", "shelter", "bench", "geometry"] 
                  if c in bus_stops.columns]
    
    bus_stops = bus_stops[cols_stops] if cols_stops else bus_stops
    
    bus_stops.to_file(os.path.join(out_dir, "bus_stops.geojson"), driver="GeoJSON")
    print(f"Saved {len(bus_stops)} bus stops to {out_dir}")

except Exception as e:
    print(f"   Warning: Could not fetch bus stops: {e}")
