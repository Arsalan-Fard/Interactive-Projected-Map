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
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': {
            'line-color': '#ff8800',
            'line-width': 3
        }
    });
}