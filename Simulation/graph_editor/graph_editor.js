// Graph editor: add snapped nodes (no edge editing yet)

const DEFAULT_VIEW = { center: [48.713, 2.20], zoom: 14 };

const WALKING_NETWORK_SOURCES = {
    edges: [
        '/static/data/walking_network.geojson',
        '../../static/data/walking_network.geojson'
    ],
    nodes: [
        '/static/data/walking_nodes.geojson',
        '../../static/data/walking_nodes.geojson'
    ],
    overridesNodes: [
        '/static/data/graph_overrides_nodes.geojson',
        '../../static/data/graph_overrides_nodes.geojson',
        '../data/graph_overrides_nodes.geojson'
    ],
    overridesEdges: [
        '/static/data/graph_overrides_edges.geojson',
        '../../static/data/graph_overrides_edges.geojson',
        '../data/graph_overrides_edges.geojson'
    ]
};

const map = L.map('map', { preferCanvas: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

const statusDiv = document.getElementById('status');
const snapInfoDiv = document.getElementById('snap-info');
const patchCountSpan = document.getElementById('patch-count');
const patchEdgesCountSpan = document.getElementById('patch-edges-count');

const showGraphCheckbox = document.getElementById('show-graph-layer');
const snapTolInput = document.getElementById('snap-tol');
const snapTolVal = document.getElementById('snap-tol-val');

const btnAddNode = document.getElementById('btn-add-node');
const btnAddEdge = document.getElementById('btn-add-edge');
const modeStatusDiv = document.getElementById('mode-status');

const btnUndo = document.getElementById('btn-undo');
const btnClear = document.getElementById('btn-clear');
const btnSave = document.getElementById('btn-save');
const btnExport = document.getElementById('btn-export');
const btnExportEdges = document.getElementById('btn-export-edges');

// Layers
const graphLayer = L.layerGroup().addTo(map);
const patchLayer = L.layerGroup().addTo(map);
let snapPreviewLayer = L.layerGroup().addTo(map);

showGraphCheckbox.onchange = function() {
    if (this.checked) map.addLayer(graphLayer);
    else map.removeLayer(graphLayer);
};

snapTolInput.oninput = function() {
    snapTolVal.textContent = this.value;
};

function parseNodeId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const asNum = Number(trimmed);
        if (Number.isFinite(asNum)) return asNum;
        return trimmed;
    }
    return value;
}

// Snap data
let baseNodes = []; // {id, lat, lng, x, y}
let edgeSegments = []; // {a:{x,y}, b:{x,y}, u, v, key, osmid, featureIndex, segmentIndex}

// Patch nodes
let nextNewNodeId = -1;
let patchNodes = []; // {id, lat, lng, snapped:{...}}
let patchMarkers = []; // Leaflet markers in same order

// Patch edges
let patchEdges = []; // GeoJSON features
let patchEdgePolylines = []; // Leaflet polylines in same order

// Mode
let mode = 'add_node'; // 'add_node' | 'add_edge'
let pendingEdgeStart = null; // {id, latlng}
let pendingEdgePreview = null; // Leaflet polyline

function setStatus(text) {
    statusDiv.textContent = text;
}

function setSnapInfo(text) {
    snapInfoDiv.textContent = text || '';
}

async function fetchFirstOkJson(urls, label) {
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                lastError = new Error(`Failed to fetch ${label} from ${url} (${res.status})`);
                continue;
            }
            return await res.json();
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error(`Failed to fetch ${label}`);
}

function updatePatchCount() {
    patchCountSpan.textContent = String(patchNodes.length);
}

function updatePatchEdgesCount() {
    patchEdgesCountSpan.textContent = String(patchEdges.length);
}

function clearSnapPreview() {
    snapPreviewLayer.clearLayers();
}

function metersToSq(m) {
    return m * m;
}

function distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq === 0) return { x: a.x, y: a.y, t: 0 };
    let t = (apx * abx + apy * aby) / abLenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: a.x + t * abx, y: a.y + t * aby, t };
}

function projectLatLng(latlng) {
    // Leaflet uses EPSG:3857 meters for CRS projection.
    return L.CRS.EPSG3857.project(latlng);
}

function unprojectPoint(point) {
    return L.CRS.EPSG3857.unproject(point);
}

function snapToGraph(latlng) {
    const tolM = Number(snapTolInput.value);
    const tolSq = metersToSq(tolM);
    const p = projectLatLng(latlng);

    // 1) Prefer snapping to existing node within tolerance
    let bestNode = null;
    let bestNodeDistSq = Infinity;
    for (const n of baseNodes) {
        const d2 = distSq(p, n);
        if (d2 < bestNodeDistSq) {
            bestNodeDistSq = d2;
            bestNode = n;
        }
    }
    if (bestNode && bestNodeDistSq <= tolSq) {
        return {
            snappedLatLng: L.latLng(bestNode.lat, bestNode.lng),
            kind: 'node',
            snapDistM: Math.sqrt(bestNodeDistSq),
            nodeId: bestNode.id
        };
    }

    // 2) Otherwise snap to closest point on any edge segment within tolerance
    let bestSeg = null;
    let bestSegDistSq = Infinity;
    let bestClosest = null;
    for (const seg of edgeSegments) {
        const closest = closestPointOnSegment(p, seg.a, seg.b);
        const d2 = distSq(p, closest);
        if (d2 < bestSegDistSq) {
            bestSegDistSq = d2;
            bestSeg = seg;
            bestClosest = closest;
        }
    }
    if (bestSeg && bestSegDistSq <= tolSq && bestClosest) {
        const snappedLatLng = unprojectPoint(L.point(bestClosest.x, bestClosest.y));
        return {
            snappedLatLng,
            kind: 'edge',
            snapDistM: Math.sqrt(bestSegDistSq),
            edge: {
                u: bestSeg.u,
                v: bestSeg.v,
                key: bestSeg.key,
                osmid: bestSeg.osmid,
                featureIndex: bestSeg.featureIndex,
                segmentIndex: bestSeg.segmentIndex,
                t: bestClosest.t
            }
        };
    }

    return null;
}

function snapToNearestNode(latlng) {
    const tolM = Number(snapTolInput.value);
    const tolSq = metersToSq(tolM);
    const p = projectLatLng(latlng);

    let best = null;
    let bestDistSq = Infinity;

    // base nodes
    for (const n of baseNodes) {
        const d2 = distSq(p, n);
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            best = { id: n.id, latlng: L.latLng(n.lat, n.lng), kind: 'base' };
        }
    }

    // patch nodes
    for (const n of patchNodes) {
        const pt = projectLatLng(L.latLng(n.lat, n.lng));
        const d2 = distSq(p, pt);
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            best = { id: n.id, latlng: L.latLng(n.lat, n.lng), kind: 'patch' };
        }
    }

    if (!best || bestDistSq > tolSq) return null;
    return { ...best, snapDistM: Math.sqrt(bestDistSq) };
}

function addPatchNode(result) {
    const id = nextNewNodeId;
    nextNewNodeId -= 1;

    const { snappedLatLng, kind, snapDistM } = result;
    const props = {
        id,
        snapped_kind: kind,
        snap_dist_m: snapDistM
    };
    if (kind === 'node') {
        props.snapped_node_id = result.nodeId;
    } else if (kind === 'edge') {
        props.edge_u = result.edge.u;
        props.edge_v = result.edge.v;
        props.edge_key = result.edge.key;
        props.edge_osmid = result.edge.osmid;
        props.edge_feature_index = result.edge.featureIndex;
        props.edge_segment_index = result.edge.segmentIndex;
        props.edge_segment_t = result.edge.t;
    }

    patchNodes.push({
        id,
        lat: snappedLatLng.lat,
        lng: snappedLatLng.lng,
        properties: props
    });

    const marker = L.circleMarker(snappedLatLng, {
        radius: 6,
        color: '#111',
        weight: 1,
        fillColor: '#ffd400',
        fillOpacity: 1
    }).addTo(patchLayer);
    marker.bindPopup(`<b>New Node</b><br>id: ${id}<br>snapped: ${kind}<br>dist: ${snapDistM.toFixed(2)} m`);
    patchMarkers.push(marker);

    updatePatchCount();
}

function exportOverridesGeoJSON() {
    const featureCollection = {
        type: 'FeatureCollection',
        features: patchNodes.map(n => ({
            type: 'Feature',
            properties: n.properties,
            geometry: {
                type: 'Point',
                coordinates: [n.lng, n.lat]
            }
        }))
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph_overrides_nodes.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportOverrideEdgesGeoJSON() {
    const featureCollection = {
        type: 'FeatureCollection',
        features: patchEdges
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph_overrides_edges.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setMode(nextMode) {
    mode = nextMode;
    btnAddNode.classList.toggle('active', mode === 'add_node');
    btnAddEdge.classList.toggle('active', mode === 'add_edge');
    pendingEdgeStart = null;
    if (pendingEdgePreview) {
        map.removeLayer(pendingEdgePreview);
        pendingEdgePreview = null;
    }
    clearSnapPreview();
    setSnapInfo('');
    modeStatusDiv.textContent = mode === 'add_node' ? 'Mode: Add Node' : 'Mode: Add Edge';
}

btnAddNode.onclick = () => setMode('add_node');
btnAddEdge.onclick = () => setMode('add_edge');

btnUndo.onclick = function() {
    // Undo priority: cancel pending edge start, otherwise undo last edge, otherwise undo last node
    if (pendingEdgeStart) {
        pendingEdgeStart = null;
        if (pendingEdgePreview) {
            map.removeLayer(pendingEdgePreview);
            pendingEdgePreview = null;
        }
        setSnapInfo('Canceled edge start.');
        return;
    }

    if (patchEdges.length > 0) {
        patchEdges.pop();
        const poly = patchEdgePolylines.pop();
        if (poly) patchLayer.removeLayer(poly);
        updatePatchEdgesCount();
        setSnapInfo('Undid last edge.');
        return;
    }

    if (patchNodes.length > 0) {
        patchNodes.pop();
        const marker = patchMarkers.pop();
        if (marker) patchLayer.removeLayer(marker);
        updatePatchCount();
        setSnapInfo('Undid last node.');
    }
};

btnClear.onclick = function() {
    patchNodes = [];
    patchMarkers = [];
    patchEdges = [];
    patchEdgePolylines = [];
    patchLayer.clearLayers();
    nextNewNodeId = -1;
    pendingEdgeStart = null;
    if (pendingEdgePreview) {
        map.removeLayer(pendingEdgePreview);
        pendingEdgePreview = null;
    }
    updatePatchCount();
    updatePatchEdgesCount();
    setSnapInfo('Cleared patch nodes.');
};

btnSave.onclick = async function() {
    setStatus('Saving...');
    setSnapInfo('Sending data to server...');

    const nodesFC = {
        type: 'FeatureCollection',
        features: patchNodes.map(n => ({
            type: 'Feature',
            properties: n.properties,
            geometry: {
                type: 'Point',
                coordinates: [n.lng, n.lat]
            }
        }))
    };

    const edgesFC = {
        type: 'FeatureCollection',
        features: patchEdges
    };

    try {
        const res = await fetch('/save-overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodes: nodesFC, edges: edgesFC })
        });

        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
                setSnapInfo('Successfully saved changes to server!');
                setStatus('Saved.');
            } else {
                setSnapInfo(`Server error: ${data.message || 'Unknown error'}`);
                setStatus('Error.');
            }
        } else {
            setSnapInfo(`HTTP error: ${res.status}`);
            setStatus('Error.');
        }
    } catch (e) {
        console.error(e);
        setSnapInfo(`Network error: ${e.message}`);
        setStatus('Error.');
    }
};

btnExport.onclick = function() {
    exportOverridesGeoJSON();
    setSnapInfo('Exported graph_overrides_nodes.geojson');
};

btnExportEdges.onclick = function() {
    exportOverrideEdgesGeoJSON();
    setSnapInfo('Exported graph_overrides_edges.geojson');
};

map.on('click', (e) => {
    clearSnapPreview();
    if (mode === 'add_node') {
        const result = snapToGraph(e.latlng);
        if (!result) {
            setSnapInfo('No snap target within tolerance.');
            return;
        }

        // Preview: show snapped point and (if edge) the segment it snapped to
        L.circleMarker(result.snappedLatLng, {
            radius: 4,
            color: '#000',
            weight: 1,
            fillColor: '#00ff99',
            fillOpacity: 1
        }).addTo(snapPreviewLayer);

        if (result.kind === 'edge') {
            // Find that exact segment and highlight it
            const seg = edgeSegments.find(s =>
                s.u === result.edge.u &&
                s.v === result.edge.v &&
                s.key === result.edge.key &&
                s.featureIndex === result.edge.featureIndex &&
                s.segmentIndex === result.edge.segmentIndex
            );
            if (seg) {
                const aLatLng = unprojectPoint(L.point(seg.a.x, seg.a.y));
                const bLatLng = unprojectPoint(L.point(seg.b.x, seg.b.y));
                L.polyline([aLatLng, bLatLng], { color: '#00ff99', weight: 4, opacity: 0.9 }).addTo(snapPreviewLayer);
            }
        }

        addPatchNode(result);

        if (result.kind === 'node') {
            setSnapInfo(`Added node snapped to existing node ${result.nodeId} (${result.snapDistM.toFixed(2)} m).`);
        } else {
            setSnapInfo(`Added node snapped to edge u=${result.edge.u} v=${result.edge.v} (${result.snapDistM.toFixed(2)} m).`);
        }
        return;
    }

    // add_edge mode: only snap to nodes
    const nodeSnap = snapToNearestNode(e.latlng);
    if (!nodeSnap) {
        setSnapInfo('Click closer to a node to select it.');
        return;
    }

    L.circleMarker(nodeSnap.latlng, {
        radius: 5,
        color: '#000',
        weight: 1,
        fillColor: '#00ff99',
        fillOpacity: 1
    }).addTo(snapPreviewLayer);

    if (!pendingEdgeStart) {
        pendingEdgeStart = { id: nodeSnap.id, latlng: nodeSnap.latlng };
        setSnapInfo(`Edge start set to node ${nodeSnap.id}. Now click an end node.`);
        return;
    }

    const u = pendingEdgeStart.id;
    const v = nodeSnap.id;
    if (u === v) {
        setSnapInfo('End node is the same as start; pick a different node.');
        return;
    }

    const start = pendingEdgeStart.latlng;
    const end = nodeSnap.latlng;
    const lengthM = map.distance(start, end);

    let edgeId = `manual:${Date.now()}`;
    try {
        if (crypto?.randomUUID) edgeId = `manual:${crypto.randomUUID()}`;
    } catch {
        // ignore
    }

    const feature = {
        type: 'Feature',
        properties: {
            u,
            v,
            key: 0,
            osmid: edgeId,
            highway: 'footway',
            oneway: false,
            length: lengthM
        },
        geometry: {
            type: 'LineString',
            coordinates: [
                [start.lng, start.lat],
                [end.lng, end.lat]
            ]
        }
    };
    patchEdges.push(feature);

    const poly = L.polyline([start, end], { color: '#00a000', weight: 4, opacity: 0.9 }).addTo(patchLayer);
    poly.bindPopup(`<b>New Edge</b><br>u: ${u}<br>v: ${v}<br>length: ${lengthM.toFixed(1)} m`);
    patchEdgePolylines.push(poly);
    updatePatchEdgesCount();

    pendingEdgeStart = null;
    setSnapInfo(`Added edge ${u} → ${v} (${lengthM.toFixed(1)} m).`);
});

async function loadBaseGraph() {
    setStatus('Loading edges...');
    const [edges, nodes] = await Promise.all([
        fetchFirstOkJson(WALKING_NETWORK_SOURCES.edges, 'edges'),
        fetchFirstOkJson(WALKING_NETWORK_SOURCES.nodes, 'nodes')
    ]);

    // Render edges
    const edgeLayer = L.geoJSON(edges, {
        style: () => ({ color: '#ff3333', weight: 2, opacity: 0.6 })
    }).addTo(graphLayer);

    // Render nodes lightly (visual reference)
    const nodeLayer = L.geoJSON(nodes, {
        filter: (feature) => {
            const coords = feature?.geometry?.coordinates;
            return coords && coords.length >= 2;
        },
        pointToLayer: (_, latlng) => L.circleMarker(latlng, {
            radius: 2,
            fillColor: '#3388ff',
            color: '#000',
            weight: 0,
            opacity: 1,
            fillOpacity: 0.7
        })
    }).addTo(graphLayer);

    // Build snap caches
    setStatus('Building snap index...');
    baseNodes = (nodes.features || []).map(f => {
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        const id = parseNodeId(f.properties?.osmid);
        const pt = projectLatLng(L.latLng(lat, lng));
        return { id, lat, lng, x: pt.x, y: pt.y };
    });

    edgeSegments = [];
    const feats = edges.features || [];
    feats.forEach((f, featureIndex) => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const props = f.properties || {};
        const u = parseNodeId(props.u);
        const v = parseNodeId(props.v);
        const key = parseNodeId(props.key);
        const osmid = props.osmid ?? null;

        const projected = coords.map(([lon, lat]) => {
            const pt = projectLatLng(L.latLng(lat, lon));
            return { x: pt.x, y: pt.y };
        });

        for (let i = 0; i < projected.length - 1; i++) {
            edgeSegments.push({
                a: projected[i],
                b: projected[i + 1],
                u,
                v,
                key,
                osmid,
                featureIndex,
                segmentIndex: i
            });
        }
    });

    // Fit map to edges layer
    const bounds = edgeLayer.getBounds();
    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
    }

    setStatus(`Loaded base graph: ${baseNodes.length} nodes, ${feats.length} edges.`);
    
    await loadOverrides();
}

async function loadOverrides() {
    setStatus('Loading overrides...');
    
    // Load Nodes
    try {
        const data = await fetchFirstOkJson(WALKING_NETWORK_SOURCES.overridesNodes, 'override nodes');
        if (data.features) {
            for (const f of data.features) {
                    const coords = f.geometry.coordinates;
                    const props = f.properties;
                    const lat = coords[1];
                    const lng = coords[0];
                    const id = props.id;

                    // Update ID counter so we don't collide
                    if (typeof id === 'number' && id <= nextNewNodeId) {
                        nextNewNodeId = id - 1;
                    }

                    patchNodes.push({
                        id,
                        lat,
                        lng,
                        properties: props
                    });

                    const marker = L.circleMarker([lat, lng], {
                        radius: 6,
                        color: '#111',
                        weight: 1,
                        fillColor: '#ffd400',
                        fillOpacity: 1
                    }).addTo(patchLayer);
                    
                    const kind = props.snapped_kind || '?';
                    const dist = props.snap_dist_m !== undefined ? props.snap_dist_m.toFixed(2) : '?';
                    marker.bindPopup(`<b>Loaded Node</b><br>id: ${id}<br>snapped: ${kind}<br>dist: ${dist} m`);
                    patchMarkers.push(marker);
            }
            updatePatchCount();
        }
    } catch (e) {
        console.log('No existing override nodes found or error loading them.', e);
    }

    // Load Edges
    try {
        const data = await fetchFirstOkJson(WALKING_NETWORK_SOURCES.overridesEdges, 'override edges');
        if (data.features) {
            for (const f of data.features) {
                    patchEdges.push(f);
                    const coords = f.geometry.coordinates; // [[lng, lat], ...]
                    const latlngs = coords.map(c => [c[1], c[0]]);

                    const poly = L.polyline(latlngs, { color: '#00a000', weight: 4, opacity: 0.9 }).addTo(patchLayer);
                    const length = f.properties.length !== undefined ? f.properties.length.toFixed(1) : '?';
                    poly.bindPopup(`<b>Loaded Edge</b><br>u: ${f.properties.u}<br>v: ${f.properties.v}<br>length: ${length} m`);
                    patchEdgePolylines.push(poly);
            }
            updatePatchEdgesCount();
        }
    } catch (e) {
        console.log('No existing override edges found or error loading them.', e);
    }

    setStatus('Ready.');
}

loadBaseGraph().catch((e) => {
    console.error(e);
    setStatus(`Error: ${e.message}`);
});

updatePatchCount();
updatePatchEdgesCount();
setMode('add_node');
