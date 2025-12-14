export function add3DBuildings(map) {
    if (map.getLayer('add-3d-buildings')) return; // Prevent duplicates

    map.addLayer({
        'id': 'add-3d-buildings',
        'source': 'composite',
        'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'],
        'type': 'fill-extrusion',
        'minzoom': 15,
        'paint': {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.6
        }
    });
}

// TODO: to be replaced to add all layers.
export function addPalaiseauRoads(map) {
    map.addSource('palaiseau-roads', {
        type: 'geojson',
        data: './data/palaiseau_roads.geojson'
    });

    map.addLayer({
        
        'id': 'palaiseau-roads-layer',
        'type': 'line',
        'source': 'palaiseau-roads',
        'layout': { 
            'line-join': 'round', 
            'line-cap': 'round',
            'visibility': 'none'
        },
        'paint': {
            'line-color': '#ff8800',
            'line-width': 3
        }
    });
}


// Walking Network Layer
export function addWalkingNetwork(map) {
    if (map.getSource('walking-network')) return; 

    map.addSource('walking-network', {
        type: 'geojson',
        data: './data/walking_network.geojson'
    });

    map.addLayer({
        'id': 'walking-network-layer',
        'type': 'line',
        'source': 'walking-network',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'none'
        },
        'paint': {
            'line-color': '#4a90e2', 
            'line-width': 2,
            'line-opacity': 0.7
        }
    });
}


// Mobility Infrastructure Layer (Cycleways)
export function addMobilityInfrastructure(map) {
    if (map.getSource('mobility-infrastructure')) return;

    map.addSource('mobility-infrastructure', {
        type: 'geojson',
        data: './data/mobility_infrastructure.geojson'
    });

    map.addLayer({
        'id': 'mobility-infrastructure-layer',
        'type': 'line',
        'source': 'mobility-infrastructure',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'none'
        },
        'paint': {
            'line-color': '#50c878', 
            'line-width': 3,
            'line-opacity': 0.8,
            'line-dasharray': [2, 2] 
        }
    });
}

// Bus Lanes Layer
export function addBusLanes(map) {
    if (map.getSource('bus-lanes')) return;

    map.addSource('bus-lanes', {
        type: 'geojson',
        data: './data/bus_lanes.geojson'
    });

    map.addLayer({
        'id': 'bus-lanes-layer',
        'type': 'line',
        'source': 'bus-lanes',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'none'
        },
        'paint': {
            'line-color': '#BA55D3', // MediumOrchid
            'line-width': 3,
            'line-opacity': 0.8
        }
    });
}


// Amenities Layer (Schools, Hospitals, Libraries, Marketplaces)
export function addAmenities(map) {
    if (map.getSource('amenities')) return;

    map.addSource('amenities', {
        type: 'geojson',
        data: './data/amenities.geojson'
    });

    map.addLayer({
        'id': 'amenities-circle-layer',
        'type': 'circle',
        'source': 'amenities',
        'paint': {
            'circle-radius': [
                'match',
                ['get', 'amenity'],
                'hospital', 8,
                'school', 6,
                'library', 5,
                'marketplace', 7,
                5  
            ],
            'circle-color': [
                'match',
                ['get', 'amenity'],
                'hospital', '#e74c3c',      
                'school', '#f39c12',        
                'library', '#9b59b6',       
                'marketplace', '#27ae60',   
                '#3498db'                   
            ],
            'circle-opacity': 0.8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    map.addLayer({
        'id': 'amenities-label-layer',
        'type': 'symbol',
        'source': 'amenities',
        'layout': {
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-offset': [0, 1.5],
            'text-anchor': 'top'
        },
        'paint': {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1.5
        }
    });
}

// Floorplan Layer
export function addFloorplan(map) {
    if (map.getSource('telecom-floorplan')) return;

    map.addSource('telecom-floorplan', {
        type: 'image',
        url: './data/images.jpg',
        coordinates: [
            [2.19908, 48.71347], // Top Left (Lng, Lat)
            [2.201649, 48.713192], // Top Right
            [2.20142732, 48.712355], // Bottom Right
            [2.1988528, 48.712607]  // Bottom Left
        ]
    });

    map.addLayer({
        'id': 'telecom-floorplan-layer',
        'type': 'raster',
        'source': 'telecom-floorplan',
        'paint': {
            'raster-opacity': 0.8,
            'raster-fade-duration': 0
        }
    });
}