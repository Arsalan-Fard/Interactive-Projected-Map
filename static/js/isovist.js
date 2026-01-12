import { compute, convertToSegments, breakIntersections } from '/Isovist-VGA/visibility-polygon.esm.js';

const DEFAULT_MAX_DISTANCE_METERS = 300;
const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };

export function initIsovist(map, options = {}) {
    if (!map) return null;

    const defaultCenter = Array.isArray(options.center)
        ? options.center
        : [map.getCenter().lng, map.getCenter().lat];

    const state = {
        viewCoord: [...defaultCenter],
        maxDistanceMeters: Number.isFinite(options.maxDistanceMeters)
            ? options.maxDistanceMeters
            : DEFAULT_MAX_DISTANCE_METERS,
        enabled: false
    };

    let buildingLayerId = null;

    const layerIds = {
        obstaclesFill: 'isovist-obstacles-fill',
        obstaclesLine: 'isovist-obstacles-line',
        isovistFill: 'isovist-fill',
        isovistLine: 'isovist-line',
        viewpointDot: 'isovist-viewpoint-dot'
    };

    const sourceIds = {
        obstacles: 'isovist-obstacles',
        isovist: 'isovist',
        viewpoint: 'isovist-viewpoint'
    };

    function getButton() {
        return document.getElementById('btn-layer-isovist');
    }

    function setButtonActive(active) {
        const btn = getButton();
        if (btn) {
            btn.classList.toggle('active', !!active);
        }
    }

    function setLayerVisibility(visible) {
        const visibility = visible ? 'visible' : 'none';
        Object.values(layerIds).forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', visibility);
            }
        });
    }

    function ensureSources() {
        if (!map.getSource(sourceIds.obstacles)) {
            map.addSource(sourceIds.obstacles, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
        }
        if (!map.getSource(sourceIds.isovist)) {
            map.addSource(sourceIds.isovist, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
        }
        if (!map.getSource(sourceIds.viewpoint)) {
            map.addSource(sourceIds.viewpoint, { type: 'geojson', data: pointFeature(state.viewCoord) });
        }
    }

    function ensureLayers() {
        ensureSources();

        if (!map.getLayer(layerIds.obstaclesFill)) {
            map.addLayer({
                id: layerIds.obstaclesFill,
                type: 'fill',
                source: sourceIds.obstacles,
                paint: {
                    'fill-color': '#2b3a4a',
                    'fill-opacity': 0.35
                }
            });
        }

        if (!map.getLayer(layerIds.obstaclesLine)) {
            map.addLayer({
                id: layerIds.obstaclesLine,
                type: 'line',
                source: sourceIds.obstacles,
                paint: {
                    'line-color': '#0f1114',
                    'line-width': 2
                }
            });
        }

        if (!map.getLayer(layerIds.isovistFill)) {
            map.addLayer({
                id: layerIds.isovistFill,
                type: 'fill',
                source: sourceIds.isovist,
                paint: {
                    'fill-color': '#2aa4f4',
                    'fill-opacity': 0.3
                }
            });
        }

        if (!map.getLayer(layerIds.isovistLine)) {
            map.addLayer({
                id: layerIds.isovistLine,
                type: 'line',
                source: sourceIds.isovist,
                paint: {
                    'line-color': '#2aa4f4',
                    'line-width': 2
                }
            });
        }

        if (!map.getLayer(layerIds.viewpointDot)) {
            map.addLayer({
                id: layerIds.viewpointDot,
                type: 'circle',
                source: sourceIds.viewpoint,
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#f4b400',
                    'circle-stroke-color': '#1c1c1c',
                    'circle-stroke-width': 2
                }
            });
        }

        setLayerVisibility(state.enabled);
    }

    function updateIsovist() {
        if (!state.enabled) return;
        if (!map.isStyleLoaded()) return;

        const isovistSource = map.getSource(sourceIds.isovist);
        const viewpointSource = map.getSource(sourceIds.viewpoint);
        const obstaclesSource = map.getSource(sourceIds.obstacles);
        if (!isovistSource || !viewpointSource || !obstaclesSource) return;

        if (!buildingLayerId) {
            buildingLayerId = findBuildingLayerId(map);
        }

        const origin = map.project(state.viewCoord);
        const maxDistancePx = metersToPixels(state.maxDistanceMeters, state.viewCoord[1], map.getZoom());
        const obstacleData = collectObstacleData(map, buildingLayerId, origin, maxDistancePx);

        obstaclesSource.setData({
            type: 'FeatureCollection',
            features: obstacleData.features
        });

        const boundaryPolygon = buildBoundaryPolygon(origin, maxDistancePx);
        const polygons = [boundaryPolygon, ...obstacleData.polygons];
        const segments = breakIntersections(convertToSegments(polygons));
        const visibility = compute([origin.x, origin.y], segments);

        if (!visibility.length) return;

        const coordinates = visibility.map(point => {
            const lngLat = map.unproject([point[0], point[1]]);
            return [lngLat.lng, lngLat.lat];
        });
        coordinates.push(coordinates[0]);

        isovistSource.setData({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            },
            properties: {}
        });

        viewpointSource.setData(pointFeature(state.viewCoord));
    }

    function activateAt(lngLat) {
        if (!lngLat) return;
        state.viewCoord = [lngLat.lng, lngLat.lat];
        state.enabled = true;
        setButtonActive(true);
        if (map.isStyleLoaded()) {
            ensureLayers();
            updateIsovist();
        } else {
            map.once('load', () => {
                ensureLayers();
                updateIsovist();
            });
        }
    }

    function deactivate() {
        state.enabled = false;
        setButtonActive(false);
        setLayerVisibility(false);
    }

    if (map.isStyleLoaded()) {
        ensureLayers();
    } else {
        map.once('load', () => {
            ensureLayers();
            updateIsovist();
        });
    }

    map.on('style.load', () => {
        buildingLayerId = null;
        ensureLayers();
        updateIsovist();
    });

    map.on('moveend', () => {
        updateIsovist();
    });

    window.addEventListener('isovist-drop', (event) => {
        const coords = event?.detail?.coords;
        if (!coords) return;
        activateAt(coords);
    });

    window.addEventListener('isovist-reset', () => {
        deactivate();
    });

    const btn = getButton();
    if (btn) {
        btn.addEventListener('click', () => {
            if (btn.dataset.dragged) return;
            setTimeout(() => {
                const enabled = btn.classList.contains('active');
                state.enabled = enabled;
                if (map.isStyleLoaded()) {
                    ensureLayers();
                    setLayerVisibility(enabled);
                    if (enabled) {
                        updateIsovist();
                    }
                }
            }, 0);
        });
    }

    return {
        updateIsovist,
        setViewCoord(lngLat) {
            if (!lngLat) return;
            state.viewCoord = [lngLat.lng, lngLat.lat];
            updateIsovist();
        },
        setEnabled(enabled) {
            state.enabled = !!enabled;
            setButtonActive(state.enabled);
            setLayerVisibility(state.enabled);
            if (state.enabled) updateIsovist();
        }
    };
}

function findBuildingLayerId(mapInstance) {
    const layers = mapInstance.getStyle()?.layers || [];
    const bySourceLayer = layers.find(layer => layer['source-layer'] === 'building' && layer.type === 'fill')
        || layers.find(layer => layer['source-layer'] === 'building' && layer.type === 'fill-extrusion')
        || layers.find(layer => layer['source-layer'] === 'building');
    if (bySourceLayer) {
        return bySourceLayer.id;
    }
    const byId = layers.find(layer => layer.id && layer.id.toLowerCase().includes('building'));
    return byId ? byId.id : null;
}

function collectObstacleData(map, buildingLayerId, originPoint, radiusPx) {
    if (!buildingLayerId) {
        return { polygons: [], features: [] };
    }

    const bbox = [
        [originPoint.x - radiusPx, originPoint.y - radiusPx],
        [originPoint.x + radiusPx, originPoint.y + radiusPx]
    ];
    const rawFeatures = map.queryRenderedFeatures(bbox, { layers: [buildingLayerId] });
    const polygons = [];
    const features = [];
    let fallbackIndex = 0;

    rawFeatures.forEach(feature => {
        const geometry = feature.geometry;
        if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
            return;
        }

        const key = feature.id ?? feature.properties?.osm_id ?? feature.properties?.id;
        const projectedPolygons = geometryToPolygons(geometry, map);
        projectedPolygons.forEach(polygon => {
            if (polygon.length >= 3) {
                polygons.push(polygon);
            }
        });

        features.push({
            type: 'Feature',
            properties: {
                id: key ?? `building-${fallbackIndex++}`
            },
            geometry
        });
    });

    return { polygons, features };
}

function geometryToPolygons(geometry, mapInstance) {
    if (geometry.type === 'Polygon') {
        const ring = geometry.coordinates[0] || [];
        const projected = projectRing(ring, mapInstance);
        return projected.length >= 3 ? [projected] : [];
    }

    if (geometry.type === 'MultiPolygon') {
        const polygons = [];
        geometry.coordinates.forEach(polygon => {
            const ring = polygon[0] || [];
            const projected = projectRing(ring, mapInstance);
            if (projected.length >= 3) {
                polygons.push(projected);
            }
        });
        return polygons;
    }

    return [];
}

function projectRing(ring, mapInstance) {
    const points = ring.map(coord => {
        const projected = mapInstance.project(coord);
        return [projected.x, projected.y];
    });

    if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first[0] === last[0] && first[1] === last[1]) {
            points.pop();
        }
    }

    return points;
}

function buildBoundaryPolygon(originPoint, radiusPx) {
    return [
        [originPoint.x - radiusPx, originPoint.y - radiusPx],
        [originPoint.x + radiusPx, originPoint.y - radiusPx],
        [originPoint.x + radiusPx, originPoint.y + radiusPx],
        [originPoint.x - radiusPx, originPoint.y + radiusPx]
    ];
}

function metersToPixels(meters, latitude, zoom) {
    const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom);
    return meters / metersPerPixel;
}

function pointFeature(coord) {
    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: coord
        },
        properties: {}
    };
}
