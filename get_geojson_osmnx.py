import osmnx as ox
import os

location = (48.7133, 2.2089)  # IP Paris Coordinate
distance = 4000  # Distance in meters

os.makedirs("data", exist_ok=True)

print("Fetching OpenStreetMap data...")

print("1. Fetching walking network...")
G_walk = ox.graph_from_point(location, dist=distance, network_type="walk")
nodes_walk, edges_walk = ox.graph_to_gdfs(G_walk)

cols_walk = [c for c in ["highway", "name", "oneway", "lanes", "maxspeed", "surface", "width", "geometry"]
             if c in edges_walk.columns]
edges_walk = edges_walk[cols_walk] if cols_walk else edges_walk
edges_walk.to_file("data/walking_network.geojson", driver="GeoJSON")
print(f"   Saved {len(edges_walk)} walking network edges to data/walking_network.geojson")

print("2. Fetching mobility infrastructure (cycleways)...")
try:
    mobility_infra = ox.features_from_point(
        location,
        dist=distance,
        tags={"cycleway": True, "highway": ["cycleway", "path"]}
    )
    cols_mobility = [c for c in ["cycleway", "highway", "name", "surface", "width", "lit", "geometry"]
                     if c in mobility_infra.columns]
    mobility_infra = mobility_infra[cols_mobility] if cols_mobility else mobility_infra
    mobility_infra.to_file("data/mobility_infrastructure.geojson", driver="GeoJSON")
    print(f"   Saved {len(mobility_infra)} mobility infrastructure features to data/mobility_infrastructure.geojson")
except Exception as e:
    print(f"   Warning: Could not fetch mobility infrastructure: {e}")

print("3. Fetching amenities...")
try:
    amenities = ox.features_from_point(
        location,
        dist=distance,
        tags={"amenity": ["school", "hospital", "marketplace", "library"]}
    )
    cols_amenities = [c for c in ["amenity", "name", "addr:street", "addr:housenumber", "geometry"]
                      if c in amenities.columns]
    amenities = amenities[cols_amenities] if cols_amenities else amenities
    amenities.to_file("data/amenities.geojson", driver="GeoJSON")
    print(f"   Saved {len(amenities)} amenities to data/amenities.geojson")
except Exception as e:
    print(f"   Warning: Could not fetch amenities: {e}")

