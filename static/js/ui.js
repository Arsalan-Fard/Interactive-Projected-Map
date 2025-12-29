import { CONFIG } from './config.js';

let pointA = null;
let pointB = null;
const draggablePlaceholders = new WeakMap();
const shortestPathButtons = { A: null, B: null };
const reachButtons = { walk: null, bike: null, car: null };
const FLOATING_BUTTON_STYLE = {
    position: 'absolute',
    width: 'auto',
    height: 'auto',
    padding: '8px 12px',
    background: 'rgba(0, 0, 0, 0.8)',
    color: 'white',
    border: '1px solid white',
    cursor: 'move',
    zIndex: '1000',
    fontFamily: 'sans-serif',
    fontSize: '14px',
    transform: 'translate(-50%, -50%)',
    userSelect: 'none',
    transition: 'none'
};
const ROUTE_UPDATE_INTERVAL = 250;
const REACH_UPDATE_INTERVAL = 500;
let lastRouteUpdate = 0;
const lastReachUpdate = new Map();

async function getRoute(map) {
    if (!pointA || !pointB) {
        if (map.getSource('route')) {
            map.getSource('route').setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            });
        }
        return;
    }

    try {
        const query = await fetch('/api/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                start: [pointA.lng, pointA.lat],
                end: [pointB.lng, pointB.lat]
            })
        });

        if (!query.ok) {
            console.error("Route request failed");
            return;
        }
        
        const geojson = await query.json();
        
        if (map.getSource('route')) {
            map.getSource('route').setData(geojson);
        } else {
            map.addSource('route', {
                type: 'geojson',
                data: geojson
            });
            
            map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#3887be',
                    'line-width': 5,
                    'line-opacity': 0.75
                }
            });
        }
    } catch (error) {
        console.error("Error fetching route:", error);
    }
}

function getShortestPathButton(label) {
    if (shortestPathButtons[label] && document.contains(shortestPathButtons[label])) {
        return shortestPathButtons[label];
    }
    const buttons = document.querySelectorAll('.draggable-source');
    const found = Array.from(buttons).find(btn => btn.textContent.trim() === label) || null;
    shortestPathButtons[label] = found;
    return found;
}

function isFloatingButton(btn) {
    return btn && btn.parentElement === document.body;
}

function floatDraggableButton(btn, clientX, clientY) {
    if (!btn) return;
    if (!isFloatingButton(btn)) {
        const placeholder = document.createElement('div');
        placeholder.style.flex = '1';
        placeholder.style.height = '100%';
        placeholder.style.visibility = 'hidden';

        draggablePlaceholders.set(btn, placeholder);
        btn.parentNode.insertBefore(placeholder, btn);
        document.body.appendChild(btn);
        Object.assign(btn.style, FLOATING_BUTTON_STYLE);
    }

    btn.style.left = `${clientX}px`;
    btn.style.top = `${clientY}px`;
}

function resetDraggableButton(btn) {
    if (!isFloatingButton(btn)) return;
    const placeholder = draggablePlaceholders.get(btn);
    if (placeholder && placeholder.parentNode) {
        btn.style.cssText = '';
        placeholder.parentNode.replaceChild(btn, placeholder);
        draggablePlaceholders.delete(btn);
    } else {
        btn.style.cssText = '';
    }
}

function maybeUpdateRoute(map) {
    const now = Date.now();
    if (now - lastRouteUpdate < ROUTE_UPDATE_INTERVAL) return;
    lastRouteUpdate = now;
    getRoute(map);
}

function getMaptasticLayer(id) {
    if (!window.maptastic || typeof window.maptastic.getLayout !== 'function') {
        return null;
    }
    const layout = window.maptastic.getLayout();
    if (!Array.isArray(layout)) return null;
    return layout.find(layer => layer.id === id) || null;
}

function screenToQuadUV(x, y, corners) {
    const x0 = corners[0][0], y0 = corners[0][1];
    const x1 = corners[1][0], y1 = corners[1][1];
    const x2 = corners[2][0], y2 = corners[2][1];
    const x3 = corners[3][0], y3 = corners[3][1];

    const dx3 = x0 - x1 + x2 - x3;
    const dy3 = y0 - y1 + y2 - y3;
    const eps = 1e-6;

    if (Math.abs(dx3) < eps && Math.abs(dy3) < eps) {
        const a = x1 - x0;
        const b = x3 - x0;
        const c = y1 - y0;
        const d = y3 - y0;
        const det = a * d - b * c;
        if (Math.abs(det) < eps) return null;
        const rx = x - x0;
        const ry = y - y0;
        const u = (rx * d - b * ry) / det;
        const v = (a * ry - rx * c) / det;
        return { u, v };
    }

    const dx1 = x1 - x2;
    const dy1 = y1 - y2;
    const dx2 = x3 - x2;
    const dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < eps) return null;

    const a13 = (dx3 * dy2 - dx2 * dy3) / det;
    const a23 = (dx1 * dy3 - dx3 * dy1) / det;

    const a11 = x1 - x0 + a13 * x1;
    const a21 = x3 - x0 + a23 * x3;
    const a12 = y1 - y0 + a13 * y1;
    const a22 = y3 - y0 + a23 * y3;

    const m11 = x * a13 - a11;
    const m12 = x * a23 - a21;
    const m21 = y * a13 - a12;
    const m22 = y * a23 - a22;
    const det2 = m11 * m22 - m12 * m21;
    if (Math.abs(det2) < eps) return null;

    const b1 = x0 - x;
    const b2 = y0 - y;
    const u = (b1 * m22 - m12 * b2) / det2;
    const v = (m11 * b2 - m21 * b1) / det2;
    return { u, v };
}

function getMapPointFromScreen(map, clientX, clientY) {
    const mapContainer = map.getContainer();
    const mainContainer = document.getElementById('main_container');
    const layer = getMaptasticLayer('main_container');

    if (layer && Array.isArray(layer.targetPoints) && layer.targetPoints.length === 4 && mainContainer) {
        const uv = screenToQuadUV(clientX, clientY, layer.targetPoints);
        if (!uv) return null;
        const tolerance = 0.02;
        if (uv.u < -tolerance || uv.u > 1 + tolerance || uv.v < -tolerance || uv.v > 1 + tolerance) {
            return null;
        }

        const mainX = uv.u * mainContainer.clientWidth;
        const mainY = uv.v * mainContainer.clientHeight;
        const mapX = mainX - mapContainer.offsetLeft;
        const mapY = mainY - mapContainer.offsetTop;
        if (mapX < 0 || mapY < 0 || mapX > mapContainer.clientWidth || mapY > mapContainer.clientHeight) {
            return null;
        }
        return { x: mapX, y: mapY };
    }

    const mapRect = mapContainer.getBoundingClientRect();
    const x = clientX - mapRect.left;
    const y = clientY - mapRect.top;
    if (x < 0 || y < 0 || x > mapRect.width || y > mapRect.height) {
        return null;
    }
    return { x, y };
}

export function getMapCoordsFromScreen(map, clientX, clientY) {
    const point = getMapPointFromScreen(map, clientX, clientY);
    return point ? map.unproject([point.x, point.y]) : null;
}

export function setShortestPathButtonPosition(map, label, clientX, clientY) {
    const btn = getShortestPathButton(label);
    if (!btn) return false;
    const coords = getMapCoordsFromScreen(map, clientX, clientY);
    if (!coords) return false;

    floatDraggableButton(btn, clientX, clientY);

    if (label === 'A') {
        pointA = coords;
    } else if (label === 'B') {
        pointB = coords;
    } else {
        return false;
    }

    maybeUpdateRoute(map);
    return true;
}

function getReachButton(mode) {
    if (reachButtons[mode] && document.contains(reachButtons[mode])) {
        return reachButtons[mode];
    }
    const idMap = {
        walk: 'btn-isochrone',
        bike: 'btn-isochrone-bike',
        car: 'btn-isochrone-car'
    };
    const btn = document.getElementById(idMap[mode]) || null;
    reachButtons[mode] = btn;
    return btn;
}

function maybeUpdateReach(mode, coords) {
    const now = Date.now();
    const last = lastReachUpdate.get(mode) || 0;
    if (now - last < REACH_UPDATE_INTERVAL) return;
    lastReachUpdate.set(mode, now);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reach-drop', { detail: { mode, coords } }));
    }
}

export function setReachButtonPosition(map, mode, clientX, clientY) {
    const btn = getReachButton(mode);
    if (!btn) return false;
    const coords = getMapCoordsFromScreen(map, clientX, clientY);
    if (!coords) return false;

    floatDraggableButton(btn, clientX, clientY);
    maybeUpdateReach(mode, coords);
    return true;
}

export function resetReachButton(map, mode) {
    const btn = getReachButton(mode);
    if (!btn) return;
    resetDraggableButton(btn);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reach-reset', { detail: { mode } }));
    }
}

export function resetShortestPathButton(map, label) {
    const btn = getShortestPathButton(label);
    if (!btn) return;
    resetDraggableButton(btn);

    let changed = false;
    if (label === 'A') {
        changed = pointA !== null;
        pointA = null;
    } else if (label === 'B') {
        changed = pointB !== null;
        pointB = null;
    }

    if (changed) {
        getRoute(map);
    }
}

function createStickerMarker(map, lngLat, color, typeId, questionId) {
    const sticker = document.createElement('div');
    Object.assign(sticker.style, {
        width: '20px',
        height: '20px',
        backgroundColor: color,
        borderRadius: '50%',
        border: '2px solid white',
        cursor: 'move',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
        userSelect: 'none'
    });

    sticker.dataset.color = color;
    sticker.dataset.typeId = typeId;
    if (questionId) {
        sticker.dataset.questionId = questionId;
    }
    sticker.classList.add('draggable-sticker');

    const marker = new mapboxgl.Marker({ element: sticker, draggable: false })
        .setLngLat(lngLat)
        .addTo(map);

    sticker._marker = marker;

    const syncPosition = () => {
        const pos = marker.getLngLat();
        sticker.dataset.lng = pos.lng;
        sticker.dataset.lat = pos.lat;
    };

    syncPosition();

    let isDraggingSticker = false;
    const dragMoveHandler = (ev) => {
        if (!isDraggingSticker) return;
        const coords = getMapCoordsFromScreen(map, ev.clientX, ev.clientY);
        if (!coords) return;
        marker.setLngLat(coords);
        sticker.dataset.lng = coords.lng;
        sticker.dataset.lat = coords.lat;
    };

    const dragUpHandler = () => {
        if (!isDraggingSticker) return;
        isDraggingSticker = false;
        document.removeEventListener('mousemove', dragMoveHandler);
        document.removeEventListener('mouseup', dragUpHandler);
        if (map && map.dragPan) map.dragPan.enable();
    };

    sticker.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        isDraggingSticker = true;
        if (map && map.dragPan) map.dragPan.disable();
        document.addEventListener('mousemove', dragMoveHandler);
        document.addEventListener('mouseup', dragUpHandler);
    });

    sticker.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        marker.remove();
        console.log(`Removed sticker with color: ${sticker.dataset.color}`);
    });
}

export function initDraggableStickers(map, getQuestionId) {
    const stickerButtons = document.querySelectorAll('.point-btn');

    stickerButtons.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // Create a drag ghost
            const ghost = document.createElement('div');
            const color = btn.dataset.color;

            Object.assign(ghost.style, {
                position: 'absolute',
                left: e.pageX + 'px',
                top: e.pageY + 'px',
                width: '20px',
                height: '20px',
                backgroundColor: color,
                borderRadius: '50%',
                border: '2px solid white',
                cursor: 'move',
                zIndex: '1000',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
                userSelect: 'none'
            });

            document.body.appendChild(ghost);

            let isDragging = true;

            const moveHandler = (ev) => {
                if (!isDragging) return;
                ghost.style.left = ev.pageX + 'px';
                ghost.style.top = ev.pageY + 'px';
            };

            const upHandler = (ev) => {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);

                ghost.remove();
                const coords = getMapCoordsFromScreen(map, ev.clientX, ev.clientY);
                if (!coords) return;
                console.log(`Sticker placed at: [${coords.lng}, ${coords.lat}] with color: ${color}`);
                const questionId = typeof getQuestionId === 'function' ? getQuestionId() : null;
                createStickerMarker(map, coords, color, btn.id, questionId);
            };

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });

        // Add double-click to remove stickers from map
        btn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            // Remove all stickers of this color from the map
            const allStickers = document.querySelectorAll('.draggable-sticker');
            allStickers.forEach(sticker => {
                if (sticker.dataset.color === btn.dataset.color) {
                    if (sticker._marker && typeof sticker._marker.remove === 'function') {
                        sticker._marker.remove();
                    } else {
                        sticker.remove();
                    }
                }
            });
            console.log(`Removed all stickers with color: ${btn.dataset.color}`);
        });
    });
}

export function initLayerToggles(map, activeOverlayIds) {
    const layerMap = {
        'btn-layer-bus': ['bus-lanes-layer'],
        'btn-layer-bike': ['mobility-infrastructure-layer'],
        'btn-layer-walk': ['walking-network-layer'],
        'btn-layer-roads': ['palaiseau-roads-layer'],
        'btn-layer-amenities': ['amenities-circle-layer', 'amenities-label-layer'],
        'btn-layer-floorplan': ['telecom-floorplan-layer']
    };

    Object.keys(layerMap).forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            const layerIds = layerMap[btnId];
            
            // Map button ID back to config ID for initial state check
            const configIdMap = {
                'btn-layer-bus': 'bus-lanes',
                'btn-layer-bike': 'mobility-infrastructure',
                'btn-layer-walk': 'walking-network',
                'btn-layer-roads': 'palaiseau-roads',
                'btn-layer-amenities': 'amenities',
                'btn-layer-floorplan': 'telecom-floorplan'
            };
            const configId = configIdMap[btnId];

            // Set initial state
            if (activeOverlayIds && configId) {
                if (activeOverlayIds.has(configId)) {
                    btn.classList.add('active');
                }
            }

            btn.addEventListener('click', () => {
                const isActive = btn.classList.toggle('active');
                
                layerIds.forEach(id => {
                    if (map.getLayer(id)) {
                        map.setLayoutProperty(id, 'visibility', isActive ? 'visible' : 'none');
                    }
                });
            });
        }
    });
}

function buildEnabledMap(items) {
    const enabledById = new Map();
    (items || []).forEach(item => {
        if (!item || item.id === undefined || item.id === null) return;
        enabledById.set(String(item.id), item.enabled !== false);
    });
    return enabledById;
}

function isItemEnabled(enabledById, id) {
    const key = String(id);
    if (!enabledById.has(key)) return true;
    return enabledById.get(key);
}

export function applyTagConfigVisibility(setupConfig) {
    const tagConfig = setupConfig?.project?.tagConfig;
    if (!tagConfig) return;

    const layerButtonMap = {
        'bus-lanes': 'btn-layer-bus',
        'mobility-infrastructure': 'btn-layer-bike',
        'walking-network': 'btn-layer-walk',
        'palaiseau-roads': 'btn-layer-roads',
        'amenities': 'btn-layer-amenities',
        'telecom-floorplan': 'btn-layer-floorplan'
    };

    const layerItems = tagConfig.layers?.items;
    if (Array.isArray(layerItems) && layerItems.length > 0) {
        const enabledById = buildEnabledMap(layerItems);
        const layersSection = document.getElementById('toolbar-layers');
        let anyVisible = false;
        Object.entries(layerButtonMap).forEach(([layerId, btnId]) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const enabled = isItemEnabled(enabledById, layerId);
            btn.style.display = enabled ? '' : 'none';
            btn.disabled = !enabled;
            if (enabled) anyVisible = true;
        });
        if (layersSection) {
            layersSection.style.display = anyVisible ? '' : 'none';
        }
    }

    const reachItems = tagConfig.reach15?.items;
    if (Array.isArray(reachItems) && reachItems.length > 0) {
        const enabledById = buildEnabledMap(reachItems);
        const reachButtonMap = {
            walk: 'btn-isochrone',
            bike: 'btn-isochrone-bike',
            car: 'btn-isochrone-car'
        };
        const reachSection = document.getElementById('toolbar-reach');
        let anyVisible = false;
        Object.entries(reachButtonMap).forEach(([modeId, btnId]) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const enabled = isItemEnabled(enabledById, modeId);
            btn.style.display = enabled ? '' : 'none';
            btn.disabled = !enabled;
            if (enabled) anyVisible = true;
        });
        if (reachSection) {
            reachSection.style.display = anyVisible ? '' : 'none';
        }
    }

    const shortestItems = tagConfig.shortestPath?.items;
    if (Array.isArray(shortestItems) && shortestItems.length > 0) {
        const enabledById = buildEnabledMap(shortestItems);
        const enabledA = isItemEnabled(enabledById, 'A');
        const enabledB = isItemEnabled(enabledById, 'B');
        const shouldShow = enabledA && enabledB;
        const shortestSection = document.getElementById('toolbar-shortest-path');
        if (shortestSection) {
            shortestSection.style.display = shouldShow ? '' : 'none';
        }
        document.querySelectorAll('#toolbar-shortest-path .draggable-source').forEach(btn => {
            btn.style.display = shouldShow ? '' : 'none';
            btn.disabled = !shouldShow;
        });
    }
}

export function initDraggableItems(map) {
    const sources = document.querySelectorAll('.draggable-source');

    sources.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            floatDraggableButton(btn, e.clientX, e.clientY);
            
            let isDragging = true;
            
            const moveHandler = (ev) => {
                if (!isDragging) return;
                btn.style.left = ev.clientX + 'px';
                btn.style.top = ev.clientY + 'px';
            };
            
            const upHandler = () => {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
                
                // Check for A/B Points
                if (btn.textContent === 'A' || btn.textContent === 'B') {
                    const rect = btn.getBoundingClientRect();
                    // We use the center of the button as the point
                    const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                    // Unproject to map coordinates
                    const coords = getMapCoordsFromScreen(map, center[0], center[1]);
                    if (!coords) return;
                    
                    if (btn.textContent === 'A') {
                        pointA = coords;
                    } else {
                        pointB = coords;
                    }
                    getRoute(map);
                }
            };
            
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });

        btn.addEventListener('dblclick', (e) => {
            const isFloating = isFloatingButton(btn);
            
            if (isFloating) {
                e.preventDefault();
                e.stopPropagation();
                
                resetDraggableButton(btn);

                // Reset A/B Points
                if (btn.textContent === 'A') {
                    pointA = null;
                    getRoute(map);
                } else if (btn.textContent === 'B') {
                    pointB = null;
                    getRoute(map);
                }
            }
        });
    });
}

export function initReachDraggables(map, options = {}) {
    const { onDrop, onReset, buttons } = options;
    const reachButtons = Array.isArray(buttons) && buttons.length > 0
        ? buttons
        : [
            { id: 'btn-isochrone', mode: 'walk' },
            { id: 'btn-isochrone-bike', mode: 'bike' }
        ];

    reachButtons.forEach(({ id, mode }) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            floatDraggableButton(btn, e.clientX, e.clientY);

            let isDragging = true;
            let didMove = false;

            const moveHandler = (ev) => {
                if (!isDragging) return;
                didMove = true;
                btn.style.left = ev.clientX + 'px';
                btn.style.top = ev.clientY + 'px';
            };

            const upHandler = (ev) => {
                if (!isDragging) return;
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);

                if (didMove) {
                    btn.dataset.dragged = '1';
                    setTimeout(() => {
                        delete btn.dataset.dragged;
                    }, 0);
                }

                const rect = btn.getBoundingClientRect();
                const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                const coords = getMapCoordsFromScreen(map, center[0], center[1]);
                if (!coords) return;

                if (typeof onDrop === 'function') {
                    onDrop(mode, coords);
                }
            };

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });

        btn.addEventListener('dblclick', (e) => {
            const isFloating = isFloatingButton(btn);
            if (!isFloating) return;
            e.preventDefault();
            e.stopPropagation();
            resetDraggableButton(btn);
            if (typeof onReset === 'function') {
                onReset(mode);
            }
        });
    });
}
