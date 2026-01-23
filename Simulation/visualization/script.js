// Initialize map (centering on the location from test.py)
// (48.713, 2.20)
const map = L.map('map', {
    preferCanvas: true // CRITICAL for performance with 40k+ features
}).setView([48.713, 2.20], 14);

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

const statusDiv = document.getElementById('status');
let allNodes = []; // Store node coordinates for snapping
let nodeIdToLatLng = new Map(); // id -> [lat, lng] for quick lookup (Stage A rendering)

let stageAScheme = null;
let schemeAllLayer = L.layerGroup().addTo(map);
let schemeSelectedLayer = L.layerGroup().addTo(map);
let schemeEndpointsLayer = L.layerGroup().addTo(map);

// Graph Layer for Edges and Nodes
let graphLayer = L.layerGroup().addTo(map);
const showGraphCheckbox = document.getElementById('show-graph-layer');
let nodeDegrees = new Map(); // id -> degree count

if (showGraphCheckbox) {
    showGraphCheckbox.onchange = function() {
        if (this.checked) {
            map.addLayer(graphLayer);
        } else {
            map.removeLayer(graphLayer);
        }
    };
}

const pairSelect = document.getElementById('pair-select');
const showAllCheckbox = document.getElementById('show-all-paths');
const clearSchemeBtn = document.getElementById('btn-clear-scheme');
const schemeMetaDiv = document.getElementById('scheme-meta');
// Stats Elements
const statLength = document.getElementById('stat-length');
const statTurns = document.getElementById('stat-turns');
const statDP = document.getElementById('stat-dp');

// Chart instance
let deviationChart = null;

function updateChart(pairs) {
    const ctx = document.getElementById('deviationChart');
    if (!ctx) return;

    // Sort pairs by kappa descending
    // We clone the array to avoid messing up the original order used by index
    const sortedPairs = [...pairs].sort((a, b) => b.kappa - a.kappa);

    const labels = sortedPairs.map(p => `κ=${p.kappa.toFixed(1)}`);
    const data = sortedPairs.map(p => {
        const selLen = p.selected_metrics?.length || 0;
        const shortLen = p.shortest_path_length || selLen; // Fallback if missing
        if (shortLen === 0) return 0;
        return ((selLen - shortLen) / shortLen) * 100;
    });

    // Color bars based on importance? Optional.
    const backgroundColors = sortedPairs.map(p => `rgba(0, 123, 255, ${0.3 + (p.kappa * 0.7)})`);

    if (deviationChart) {
        deviationChart.destroy();
    }

    deviationChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '% Deviation',
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 0
            }]
        },
        options: {
            scales: {
                x: {
                    display: false // Hide x labels to avoid clutter
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: '% Longer'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y.toFixed(2)}% longer (κ=${sortedPairs[context.dataIndex].kappa.toFixed(2)})`;
                        }
                    }
                },
                legend: {
                    display: false
                }
            }
        }
    });
}




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

// Helper to load GeoJSON
async function loadLayer(url, options) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}`);
        const data = await response.json();
        
        // If these are nodes, store them for snapping
        if (url.includes('nodes')) {
            nodeIdToLatLng = new Map();
            allNodes = data.features.map(f => {
                const lat = f.geometry.coordinates[1]; // GeoJSON is [lng, lat]
                const lng = f.geometry.coordinates[0];
                const id = parseNodeId(f.properties?.osmid) ?? "unknown";
                if (id !== "unknown" && id !== null) nodeIdToLatLng.set(id, [lat, lng]);
                return { lat, lng, id };
            });
        }

        // L.geoJSON(data, options).addTo(map);
        // Add to graphLayer instead of map directly
        L.geoJSON(data, options).addTo(graphLayer);
        
        return data.features.length;
    } catch (e) {
        console.error(e);
        statusDiv.innerHTML += `<br>Error loading ${url}: ${e.message}`;
        return 0;
    }
}

// Load Edges first (so nodes appear on top if rendered sequentially, 
// though canvas ordering depends on insertion)
async function init() {
    
    // Style for Edges
    const edgeOptions = {
        style: function (feature) {
            return {
                color: "#ff3333",
                weight: 2,
                opacity: 0.6
            };
        },
        onEachFeature: function (feature, layer) {
            if (feature.properties) {
                let popupContent = "<b>Edge</b><br>";
                // Show all properties
                for (const [key, value] of Object.entries(feature.properties)) {
                    popupContent += `<b>${key}:</b> ${value}<br>`;
                }
                layer.bindPopup(popupContent);
            }
        }
    };

    // Style for Nodes
    const nodeOptions = {
        filter: function (feature) {
            const coords = feature?.geometry?.coordinates;
            return coords && coords.length >= 2;
        },
        pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, {
                radius: 3,
                fillColor: "#3388ff",
                color: "#000",
                weight: 0,
                opacity: 1,
                fillOpacity: 0.8
            });
        },
        onEachFeature: function (feature, layer) {
            if (feature.properties) {
                let popupContent = "<b>Node</b><br>";
                // Show all properties
                for (const [key, value] of Object.entries(feature.properties)) {
                    popupContent += `<b>${key}:</b> ${value}<br>`;
                }
                layer.bindPopup(popupContent);
            }
        }
    };

    statusDiv.textContent = "Loading edges...";
    // Note: We are fetching from the PARENT directory
    // const edgeCount = await loadLayer('../data/walking_network_edges.geojson', edgeOptions);
    
    // Custom load for edges to count degrees
    let edgeCount = 0;
    try {
        const response = await fetch('../data/walking_network_edges.geojson');
        if (!response.ok) throw new Error(`Failed to fetch edges`);
        const data = await response.json();
        
        nodeDegrees = new Map();
        
        data.features.forEach(f => {
            const u = parseNodeId(f.properties?.u);
            const v = parseNodeId(f.properties?.v);
            if (u !== null) nodeDegrees.set(u, (nodeDegrees.get(u) || 0) + 1);
            if (v !== null) nodeDegrees.set(v, (nodeDegrees.get(v) || 0) + 1);
        });

        L.geoJSON(data, edgeOptions).addTo(graphLayer);
        edgeCount = data.features.length;
    } catch (e) {
        console.error(e);
        statusDiv.innerHTML += `<br>Error loading edges: ${e.message}`;
    }
    
    statusDiv.textContent = `Edges: ${edgeCount}. Loading nodes...`;
    const nodeCount = await loadLayer('../data/walking_network_nodes.geojson', nodeOptions);

    // Load optional override patches (nodes/edges) saved from graph_editor
    let overrideNodeCount = 0;
    let overrideEdgeCount = 0;
    try {
        const [ovNodesRes, ovEdgesRes] = await Promise.all([
            fetch('../data/graph_overrides_nodes.geojson').catch(() => ({ ok: false })),
            fetch('../data/graph_overrides_edges.geojson').catch(() => ({ ok: false }))
        ]);

        if (ovEdgesRes.ok) {
            const ovEdges = await ovEdgesRes.json();
            overrideEdgeCount = ovEdges.features?.length || 0;
            L.geoJSON(ovEdges, {
                style: () => ({ color: "#00a000", weight: 4, opacity: 0.9 }),
                onEachFeature: function (feature, layer) {
                    if (feature.properties) {
                        let popupContent = "<b>Override Edge</b><br>";
                        for (const [key, value] of Object.entries(feature.properties)) {
                            popupContent += `<b>${key}:</b> ${value}<br>`;
                        }
                        layer.bindPopup(popupContent);
                    }
                }
            }).addTo(graphLayer);
        }

        if (ovNodesRes.ok) {
            const ovNodes = await ovNodesRes.json();
            overrideNodeCount = ovNodes.features?.length || 0;

            // Add override nodes to snapping/path lookup (even if we don't draw all of them)
            (ovNodes.features || []).forEach(f => {
                const coords = f.geometry?.coordinates;
                if (!coords || coords.length < 2) return;
                const lat = coords[1];
                const lng = coords[0];
                const id = parseNodeId(f.properties?.id ?? f.properties?.osmid) ?? null;
                if (id === null) return;
                if (!nodeIdToLatLng.has(id)) {
                    nodeIdToLatLng.set(id, [lat, lng]);
                    allNodes.push({ lat, lng, id });
                }
            });

            L.geoJSON(ovNodes, {
                filter: function (feature) {
                    const coords = feature?.geometry?.coordinates;
                    return coords && coords.length >= 2;
                },
                pointToLayer: function (_, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 5,
                        fillColor: "#ffd400",
                        color: "#111",
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 1
                    });
                }
            }).addTo(graphLayer);
        }
    } catch (e) {
        console.warn("Failed to load override patches:", e);
    }

    statusDiv.textContent = `Loaded: ${nodeCount} nodes, ${edgeCount} edges.` +
        (overrideNodeCount || overrideEdgeCount ? ` Overrides: ${overrideNodeCount} nodes, ${overrideEdgeCount} edges.` : "");
}

init();

// --- Add Point Logic ---

let currentMode = null;
let currentIndex = null; // 1-5 for Entrance/POI
const addedFeatures = {
    intersection: L.layerGroup().addTo(map),
    entrance: L.layerGroup().addTo(map),
    poi: L.layerGroup().addTo(map)
};

// Marker Styles
const markerStyles = {
    intersection: { color: 'orange', fillColor: 'orange', fillOpacity: 1, radius: 6 },
    entrance: { color: 'green', fillColor: 'green', fillOpacity: 1, radius: 6 },
    poi: { color: 'purple', fillColor: 'purple', fillOpacity: 1, radius: 6 }
};

function setMode(mode, index = null) {
    // Toggle off if clicking same button
    if (currentMode === mode && currentIndex === index) {
        currentMode = null;
        currentIndex = null;
    } else {
        currentMode = mode;
        currentIndex = index;
    }
    updateUI();
}

function updateUI() {
    // Reset all buttons
    const allBtns = document.querySelectorAll('.buttons button');
    allBtns.forEach(b => b.classList.remove('active'));

    // Highlight active button
    if (currentMode) {
        if (currentMode === 'intersection') {
            document.getElementById('btn-intersection').classList.add('active');
        } else if (currentIndex !== null) {
            const btn = document.getElementById(`btn-${currentMode}-${currentIndex}`);
            if (btn) btn.classList.add('active');
        }
    }
    
    // Update status text
    const statusText = document.getElementById('mode-status');
    let text = `Mode: ${currentMode ? currentMode.charAt(0).toUpperCase() + currentMode.slice(1) : 'None'}`;
    if (currentIndex !== null) {
        // Show the value that will be stored (Reversed: 1->5, 2->4...)
        const storedVal = 6 - currentIndex;
        text += ` (Button ${currentIndex} → Value ${storedVal})`;
    }
    statusText.textContent = text;
}

// Map Click Listener
map.on('click', function(e) {
    if (!currentMode) return;
    if (allNodes.length === 0) {
        alert("Nodes not loaded yet!");
        return;
    }

    const clickedLat = e.latlng.lat;
    const clickedLng = e.latlng.lng;
    
    // Find closest node
    let closestNode = null;
    let minDistance = Infinity;

    // Simple linear search (sufficient for <20k points on click)
    for (const node of allNodes) {
        // Euclidean distance approx is fine for snapping on this scale
        const dist = Math.sqrt(Math.pow(node.lat - clickedLat, 2) + Math.pow(node.lng - clickedLng, 2));
        if (dist < minDistance) {
            minDistance = dist;
            closestNode = node;
        }
    }

    if (closestNode) {
        const type = currentMode;
        const snapLatLng = [closestNode.lat, closestNode.lng];
        
        // Calculate stored value if applicable
        let storedValue = null;
        if (type !== 'intersection' && currentIndex !== null) {
            storedValue = 6 - currentIndex; // Reverse logic: 1->5, 2->4, etc.
        }

        // Create marker at SNAPPED location
        const marker = L.circleMarker(snapLatLng, markerStyles[type]);
        
        // Attach value to the marker object for retrieval later
        marker.customValue = storedValue;

        // Add popup
        let popupText = `<b>${type.charAt(0).toUpperCase() + type.slice(1)}</b><br>`;
        if (storedValue !== null) {
            popupText += `Value: ${storedValue}<br>`;
        }
        popupText += `Snapped to Node<br>Lat: ${closestNode.lat.toFixed(6)}<br>Lng: ${closestNode.lng.toFixed(6)}`;
        
        marker.bindPopup(popupText);
        
        // Add to layer group
        addedFeatures[type].addLayer(marker);
    }
});

// Save Function
function savePoints() {
    const output = {
        intersections: [],
        entrances: [],
        pois: []
    };

    // Helper to extract data from layer group
    function extractData(type) {
        addedFeatures[type].eachLayer(layer => {
            // Parse popup content or store raw latlng
            // Since we snapped, the latlng is the node location.
            // Ideally we need the Node ID. 
            // In the click handler, we bound popup with text, but didn't store ID in the marker options.
            // Let's re-find the ID based on lat/lng or store it in the marker object.
            
            // Re-finding for simplicity (since we have exact coords)
            const lat = layer.getLatLng().lat;
            const lng = layer.getLatLng().lng;
            
            // Find specific node ID (should match exactly if snapped)
            const node = allNodes.find(n => Math.abs(n.lat - lat) < 1e-6 && Math.abs(n.lng - lng) < 1e-6);
            
            const entry = {
                id: node ? node.id : null,
                lat: lat,
                lng: lng
            };

            // Add value if it exists (for entrance/poi)
            if (layer.customValue !== undefined && layer.customValue !== null) {
                entry.value = layer.customValue;
            }

            output[type + 's'].push(entry);
        });
    }

    extractData('intersection');
    extractData('entrance');
    extractData('poi');

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(output, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "selected_points.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// --- Run Stage A Logic ---
const sliders = [
    { id: 'w-local-length', valId: 'w-local-length-val' },
    { id: 'w-local-nodes', valId: 'w-local-nodes-val' },
    { id: 'w-local-angle', valId: 'w-local-angle-val' },
    { id: 'w-global-length', valId: 'w-global-length-val' },
    { id: 'w-global-nodes', valId: 'w-global-nodes-val' }
];

sliders.forEach(s => {
    const el = document.getElementById(s.id);
    const valEl = document.getElementById(s.valId);
    if (el && valEl) {
        el.oninput = function() {
            valEl.textContent = this.value;
        }
    }
});

const runStatusDiv = document.getElementById('run-status');
const runBtn = document.getElementById('btn-run-stage-a');

async function runStageA() {
    if (!runBtn) return;
    
    // Collect values
    const payload = {};
    sliders.forEach(s => {
        const el = document.getElementById(s.id);
        if (el) payload[s.id.replace(/-/g, '_')] = parseFloat(el.value);
    });
    
    runBtn.disabled = true;
    runStatusDiv.textContent = "Running Stage A... (this may take a moment)";
    
    try {
        const response = await fetch('/run-stage-a', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            runStatusDiv.textContent = "Success! Reloading scheme...";
            console.log(data.output);
            // Automatically reload the scheme results
            await loadStageAScheme();
        } else {
            runStatusDiv.textContent = "Error: " + (data.error || "Unknown error");
            console.error(data.error);
        }
    } catch (e) {
        console.error(e);
        runStatusDiv.textContent = "Request failed. Is server.py running?";
    } finally {
        runBtn.disabled = false;
    }
}

// --- Stage A Visualization ---

function clearStageAScheme() {
    schemeAllLayer.clearLayers();
    schemeSelectedLayer.clearLayers();
    schemeEndpointsLayer.clearLayers();
}

function getLatLngsForNodePath(nodePath) {
    const latlngs = [];
    for (const rawId of nodePath) {
        const id = parseNodeId(rawId);
        const ll = nodeIdToLatLng.get(id);
        if (ll) latlngs.push(ll);
    }
    return latlngs;
}

function colorForIndex(i, total) {
    const hue = total > 0 ? Math.round((360 * i) / total) : 200;
    return `hsl(${hue}, 85%, 45%)`;
}

function renderStageAScheme() {
    clearStageAScheme();
    dpLayer.clearLayers(); // Clear DP markers

    if (!stageAScheme || !stageAScheme.pairs) return;

    const pairs = stageAScheme.pairs;

    if (showAllCheckbox.checked) {
        pairs.forEach((p, i) => {
            const latlngs = getLatLngsForNodePath(p.selected_path || []);
            if (latlngs.length < 2) return;
            L.polyline(latlngs, {
                color: "#111",
                weight: 3,
                opacity: 0.35
            }).addTo(schemeAllLayer);
        });
    }

    const idx = Number(pairSelect.value);
    
    // Update Stats Display
    updateStatsDisplay(idx);

    if (!Number.isFinite(idx) || idx < 0 || idx >= pairs.length) return;

    const selected = pairs[idx];
    const latlngs = getLatLngsForNodePath(selected.selected_path || []);
    if (latlngs.length < 2) return;

    L.polyline(latlngs, {
        color: "#111",
        weight: 6,
        opacity: 0.85
    }).addTo(schemeSelectedLayer);

    const start = latlngs[0];
    const end = latlngs[latlngs.length - 1];
    L.circleMarker(start, { radius: 7, color: "#0a7f2e", fillColor: "#0a7f2e", fillOpacity: 1 })
        .bindPopup(`<b>Source</b><br>${selected.source}`)
        .addTo(schemeEndpointsLayer);
    L.circleMarker(end, { radius: 7, color: "#6b2bbd", fillColor: "#6b2bbd", fillOpacity: 1 })
        .bindPopup(`<b>Target</b><br>${selected.target}`)
        .addTo(schemeEndpointsLayer);

    // Visualize Decision Points for selected path
    const pathNodes = selected.selected_path || [];
    pathNodes.forEach(nidRaw => {
        const nid = parseNodeId(nidRaw);
        // Is it a decision point? (Check metadata OR if it is start/end)
        // Note: Start/End are already colored, so maybe skip them or put yellow on top?
        // Let's mark intermediate DPs distinctly.
        if (validDecisionPoints.has(nid) && nid !== parseNodeId(selected.source) && nid !== parseNodeId(selected.target)) {
            const ll = nodeIdToLatLng.get(nid);
            if (ll) {
                L.circleMarker(ll, {
                    radius: 5,
                    color: "black",
                    weight: 1,
                    fillColor: "yellow",
                    fillOpacity: 1
                }).bindPopup(`<b>Decision Point</b><br>${nid}`).addTo(dpLayer);
            }
        }
    });

    map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
}

// Decision Point Layer
let dpLayer = L.layerGroup().addTo(map);
let validDecisionPoints = new Set(); // IDs from metadata

async function loadStageAScheme() {
    if (allNodes.length === 0) {
        schemeMetaDiv.textContent = "Nodes not loaded yet; wait for the map to finish loading.";
        return;
    }

    schemeMetaDiv.textContent = "Loading Stage A scheme...";
    try {
        const [schemeRes, dpRes] = await Promise.all([
            fetch('../data/stageA_scheme.json'),
            fetch('../data/decision_points_metadata.json').catch(() => ({ ok: false })) // Optional load
        ]);

        if (!schemeRes.ok) throw new Error(`Failed to fetch ../data/stageA_scheme.json (${schemeRes.status})`);
        stageAScheme = await schemeRes.json();

        // Process DP metadata
        validDecisionPoints.clear();
        if (dpRes.ok) {
            const dpData = await dpRes.json();
            (dpData.decision_points || []).forEach(dp => {
                if (dp.is_decision_point) validDecisionPoints.add(dp.id);
            });
        }

        const pairs = stageAScheme.pairs || [];
        pairSelect.innerHTML = "";
        pairs.forEach((p, i) => {
            const opt = document.createElement('option');
            const len = p.selected_metrics?.length;
            const lenText = (typeof len === 'number') ? ` (${len.toFixed(1)}m)` : "";
            opt.value = String(i);
            opt.textContent = `${i + 1}: ${p.source} → ${p.target}${lenText}`;
            pairSelect.appendChild(opt);
        });

        pairSelect.disabled = pairs.length === 0;
        showAllCheckbox.disabled = pairs.length === 0;
        clearSchemeBtn.disabled = false;

        const bestCost = stageAScheme.meta?.best_cost;
        const mode = stageAScheme.meta?.edge_key_mode;
        schemeMetaDiv.innerHTML = `<div class="small muted">Pairs: ${pairs.length}${mode ? ` • edge_mode: ${mode}` : ""}${typeof bestCost === 'number' ? ` • best_cost: ${bestCost.toFixed(6)}` : ""}</div>`;

        // --- Calculate Stats ---
        // Global variables for totals to be accessed in render
        window.schemeTotals = { len: 0, ang: 0, dp: 0 };
        // We use the n_nodes calculated by the backend algorithm now
        pairs.forEach(p => {
            const m = p.selected_metrics;
            if (!m) return;
            window.schemeTotals.len += m.length || 0;
            window.schemeTotals.ang += m.angle_sum || 0;
            window.schemeTotals.dp += m.n_nodes || 0;
        });

        updateStatsDisplay(null);
        updateChart(pairs);

        pairSelect.onchange = renderStageAScheme;
        showAllCheckbox.onchange = renderStageAScheme;

        if (pairs.length > 0) {
            pairSelect.value = "0";
            renderStageAScheme();
        } else {
            clearStageAScheme();
        }
    } catch (e) {
        console.error(e);
        schemeMetaDiv.textContent = `Failed to load scheme: ${e.message}`;
        stageAScheme = null;
        clearStageAScheme();
    }
}

function updateStatsDisplay(pairIndex) {
    if (!window.schemeTotals) return;
    
    let pairLen = 0, pairAng = 0, pairDP = 0;
    let showPair = false;

    if (stageAScheme && pairIndex !== null && pairIndex >= 0 && pairIndex < stageAScheme.pairs.length) {
        const p = stageAScheme.pairs[pairIndex];
        const m = p.selected_metrics;
        if (m) {
            pairLen = m.length || 0;
            pairAng = m.angle_sum || 0;
            showPair = true;
            
            // Calculate DP for this pair
            // const entranceIds = new Set(stageAScheme.pairs.map(x => parseNodeId(x.source)));
            // (p.selected_path || []).forEach(nidRaw => {
            //     const nid = parseNodeId(nidRaw);
            //     const deg = nodeDegrees.get(nid) || 0;
            //     if (deg > 2 || entranceIds.has(nid)) {
            //         pairDP++;
            //     }
            // });
            
            // Use the backend metric which respects the metadata filter
            pairDP = m.n_nodes || 0;
        }
    }

    const fmtLen = (val) => `${val.toFixed(1)} m`;
    const fmtAng = (val) => `${(val * 180 / Math.PI).toFixed(0)}°`;
    const fmtDP = (val) => `${val}`;

    if (statLength) statLength.innerHTML = `${fmtLen(window.schemeTotals.len)}` + (showPair ? ` <span class="muted">(${fmtLen(pairLen)})</span>` : "");
    if (statTurns) statTurns.innerHTML = `${fmtAng(window.schemeTotals.ang)}` + (showPair ? ` <span class="muted">(${fmtAng(pairAng)})</span>` : "");
    if (statDP) statDP.innerHTML = `${fmtDP(window.schemeTotals.dp)}` + (showPair ? ` <span class="muted">(${fmtDP(pairDP)})</span>` : "");
}
