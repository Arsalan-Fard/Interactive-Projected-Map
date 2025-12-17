import osmnx as ox
import os


location = (48.713, 2.20)  # IP Paris Coordinate
distance = 4000  # Distance in meters

os.makedirs("data", exist_ok=True)


G_walk = ox.graph_from_point(location, dist=distance, network_type="walk")
nodes_walk, edges_walk = ox.graph_to_gdfs(G_walk)

cols_walk = [c for c in ["highway", "name", "oneway", "lanes", "maxspeed", "surface", "width", "geometry"]
             if c in edges_walk.columns]
edges_walk = edges_walk[cols_walk] if cols_walk else edges_walk
edges_walk.to_file("data/walking_network.geojson", driver="GeoJSON")
print(f"Saved {len(edges_walk)} walking network edges")

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
    print(f"Saved {len(mobility_infra)} mobility infrastructure")
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
    amenities.to_file("data/amenities.geojson", driver="GeoJSON")
    print(f"Saved {len(amenities)} amenities")
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
        bus_lanes.to_file("data/bus_lanes.geojson", driver="GeoJSON")
        print(f"Saved {len(bus_lanes)} of bus infrastructure.")
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
    
    bus_stops.to_file("data/bus_stops.geojson", driver="GeoJSON")
    print(f"Saved {len(bus_stops)} bus stops")

except Exception as e:
    print(f"   Warning: Could not fetch bus stops: {e}")
