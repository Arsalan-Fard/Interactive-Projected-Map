import {
    getMapCoordsFromScreen,
    setShortestPathButtonPosition,
    resetShortestPathButton,
    setReachButtonPosition,
    resetReachButton,
    setEraserButtonPosition,
    resetEraserButton,
    setStickerPosition,
    removeStickerMarker
} from './ui.js';

const SEARCH_DELAY = 1000; // Wait 1s before going black
const BLACK_SCREEN_DURATION = 1000; // Stay black for 1s
const COOLDOWN_DURATION = 2000; // Show map for 2s before trying again
const HIT_THRESHOLD = 2;
const MISS_THRESHOLD = 5;
const TAG_DRAW_MIN_DISTANCE_PX = 10;
const TAG_SETTINGS_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
    '#F8B739',
    '#E74C3C'
];

function createDebugDot() {
    const debugDot = document.createElement('div');
    Object.assign(debugDot.style, {
        position: 'absolute',
        width: '20px',
        height: '20px',
        backgroundColor: 'red',
        borderRadius: '50%',
        zIndex: '9999',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        display: 'none',
        left: '0%',
        top: '0%'
    });
    document.body.appendChild(debugDot);
    return debugDot;
}

function createBlackHole(id) {
    const bh = document.createElement('div');
    Object.assign(bh.style, {
        position: 'absolute',
        width: '60px',
        height: '60px',
        backgroundColor: 'black',
        borderRadius: '50%',
        zIndex: '9997', // Above map
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        display: 'none',
        left: '0%',
        top: '0%'
    });
    bh.id = `black-hole-${id}`;
    document.body.appendChild(bh);
    return bh;
}

function createSearchOverlay() {
    const searchOverlay = document.createElement('div');
    Object.assign(searchOverlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'black',
        zIndex: '10000', // Very high z-index to cover everything
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'monospace',
        pointerEvents: 'none' // Let clicks pass through if needed, though hidden
    });
    searchOverlay.textContent = 'Searching for tags...';
    document.body.appendChild(searchOverlay);
    return searchOverlay;
}

export function initTagTracking({ map, setupConfig, draw }) {
    if (!map) return null;

    const drawingConfig = setupConfig?.project?.drawingConfig || {};
    const rawDrawingItems = Array.isArray(drawingConfig)
        ? drawingConfig
        : (Array.isArray(drawingConfig.items) ? drawingConfig.items : [drawingConfig]);

    const drawingToolByTagId = new Map();
    rawDrawingItems.forEach(item => {
        if (!Number.isInteger(item?.tagId)) return;
        if (drawingToolByTagId.has(item.tagId)) return;
        drawingToolByTagId.set(item.tagId, {
            tagId: item.tagId,
            label: typeof item?.label === 'string' ? item.label : '',
            color: typeof item?.color === 'string' ? item.color.trim() : '#ff00ff'
        });
    });
    if (drawingToolByTagId.size === 0) {
        drawingToolByTagId.set(6, { tagId: 6, label: 'drawing line', color: '#ff00ff' });
    }

    const drawingTagIds = new Set(drawingToolByTagId.keys());
    const drawingStateByTagId = new Map(); // tagId -> { coordinates, lastScreenPoint, lastSampleTime, lostStart }
    const finalizedDrawingFeatures = []; // List of finished lines (still rendered with custom colors)
    const TM_SOURCE_KEY = 'tm_source';
    const TM_SOURCE_TAG = 'tag';

    const DRAW_SOURCE_ID = 'tag-drawing-source';
    const DRAW_LAYER_ID = 'tag-drawing-lines';
    const DRAW_GLOW_LAYER_ID = 'tag-drawing-lines-glow';
    const DRAW_SAMPLE_INTERVAL_MS = 200;
    const DRAW_LOST_TIMEOUT_MS = 3000;

    const finishedDrawingQueue = [];
    let lastDrawCommitTime = 0;
    const DRAW_COMMIT_INTERVAL_MS = 250;

    const debugEnabled = (() => {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.get('debug') === '1' || window.localStorage?.getItem('tm_debug') === '1';
        } catch {
            return false;
        }
    })();

    let lastTagDrawingData = null;

    if (debugEnabled) {
        const root = globalThis.__tmDebug || (globalThis.__tmDebug = {});
        root.tagTracking = {
            dumpTagDrawing() {
                const summary = (lastTagDrawingData?.features || []).map(f => ({
                    tagId: f?.properties?.tagId,
                    color: f?.properties?.color,
                    tmSource: f?.properties?.[TM_SOURCE_KEY],
                    points: Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates.length : 0
                }));
                console.log('[tm debug] tag drawing features', summary);
                try {
                    console.log('[tm debug] layer paint (glow)', map.getPaintProperty?.(DRAW_GLOW_LAYER_ID, 'line-color'));
                    console.log('[tm debug] layer paint (glow blur)', map.getPaintProperty?.(DRAW_GLOW_LAYER_ID, 'line-blur'));
                    console.log('[tm debug] layer paint (line)', map.getPaintProperty?.(DRAW_LAYER_ID, 'line-color'));
                } catch (error) {
                    console.warn('[tm debug] paint property read failed', error);
                }
            },
            setTagGlowBlur(value) {
                try {
                    map.setPaintProperty?.(DRAW_GLOW_LAYER_ID, 'line-blur', value);
                    console.log('[tm debug] set glow blur', value);
                } catch (error) {
                    console.warn('[tm debug] set glow blur failed', error);
                }
            },
            excludeFromDrawLayers() {
                try {
                    excludeTagDrawingsFromDrawLineLayers();
                    console.log('[tm debug] applied draw-layer exclusion filter');
                } catch (error) {
                    console.warn('[tm debug] draw-layer exclusion failed', error);
                }
            }
        };
    }

    function getDrawingState(tagId) {
        const existing = drawingStateByTagId.get(tagId);
        if (existing) return existing;
        const created = {
            coordinates: [],
            lastScreenPoint: null,
            lastSampleTime: 0,
            lostStart: null
        };
        drawingStateByTagId.set(tagId, created);
        return created;
    }

    const debugDot = createDebugDot();
    const blackHoles = {}; // Map to store black hole elements by ID
    const tagStates = new Map(); // tagId -> { hits, misses, visible, x, y }

    function getBlackHole(id) {
        if (!blackHoles[id]) {
            blackHoles[id] = createBlackHole(id);
        }
        return blackHoles[id];
    }

    // Initialize special black holes
    Array.from(new Set([5, ...drawingTagIds, 11])).forEach(id => getBlackHole(id));

    const searchOverlay = createSearchOverlay();

    let lastSeenTime = Date.now();
    let isSearchMode = false;
    let searchStartTime = 0;
    let cooldownEndTime = 0;

    let isCheckingPosition = false;

    function updateTagStates(detectedTags) {
        const detectedIds = new Set();

        Object.values(detectedTags || {}).forEach(tag => {
            const tagId = Number(tag?.id);
            if (!Number.isFinite(tagId)) return;
            detectedIds.add(tagId);
            let state = tagStates.get(tagId);
            if (!state) {
                state = { hits: 0, misses: 0, visible: false, x: 0, y: 0 };
                tagStates.set(tagId, state);
            }
            state.hits += 1;
            state.misses = 0;
            state.x = Number(tag.x);
            state.y = Number(tag.y);
            if (!state.visible && state.hits >= HIT_THRESHOLD) {
                state.visible = true;
            }
        });

        const toDelete = [];
        tagStates.forEach((state, id) => {
            if (!detectedIds.has(id)) {
                state.hits = 0;
                state.misses += 1;
                if (state.visible && state.misses >= MISS_THRESHOLD) {
                    state.visible = false;
                }
            }
            if (!state.visible && state.misses >= MISS_THRESHOLD * 2) {
                toDelete.push(id);
            }
        });
        toDelete.forEach(id => tagStates.delete(id));

        const visibleIds = new Set();
        tagStates.forEach((state, id) => {
            if (state.visible) visibleIds.add(id);
        });

        return { detectedIds, visibleIds };
    }

    function updateTagDrawingLayer() {
        if (!map.isStyleLoaded()) return;
        const source = map.getSource(DRAW_SOURCE_ID);
        const features = [];

        finalizedDrawingFeatures.forEach(feature => {
            if (!feature) return;
            features.push(feature);
        });

        drawingStateByTagId.forEach((state, tagId) => {
            const coords = state?.coordinates;
            if (!Array.isArray(coords) || coords.length === 0) return;
            const tool = drawingToolByTagId.get(tagId) || { tagId, label: '', color: '#ff00ff' };
            features.push({
                type: 'Feature',
                properties: {
                    tagId,
                    label: tool.label || '',
                    color: tool.color || '#ff00ff',
                    [TM_SOURCE_KEY]: TM_SOURCE_TAG
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coords
                }
            });
        });

        const data = { type: 'FeatureCollection', features };
        lastTagDrawingData = data;

        const ensureLayers = () => {
            if (!map.getLayer(DRAW_GLOW_LAYER_ID)) {
                map.addLayer({
                    id: DRAW_GLOW_LAYER_ID,
                    type: 'line',
                    source: DRAW_SOURCE_ID,
                    layout: {
                        'line-cap': 'round',
                        'line-join': 'round'
                    },
                    paint: {
                        'line-color': ['coalesce', ['get', 'color'], '#ff00ff'],
                        'line-width': 14,
                        'line-opacity': 0.5,
                        'line-blur': 6
                    }
                });
            }

            if (!map.getLayer(DRAW_LAYER_ID)) {
                map.addLayer(
                    {
                        id: DRAW_LAYER_ID,
                        type: 'line',
                        source: DRAW_SOURCE_ID,
                        layout: {
                            'line-cap': 'round',
                            'line-join': 'round'
                        },
                        paint: {
                            'line-color': ['coalesce', ['get', 'color'], '#ff00ff'],
                            'line-width': 4,
                            'line-opacity': 0.85
                        }
                    },
                    undefined
                );
            }
        };

        if (source) {
            source.setData(data);
            ensureLayers();
            return;
        }

        map.addSource(DRAW_SOURCE_ID, { type: 'geojson', data });
        ensureLayers();
    }

    function flushFinishedDrawings(now) {
        if (!draw) return;
        if (finishedDrawingQueue.length === 0) return;
        if (now - lastDrawCommitTime < DRAW_COMMIT_INTERVAL_MS) return;
        const next = finishedDrawingQueue.shift();
        try {
            draw.add(next);
        } catch (error) {
            console.error('Failed to add drawing to Mapbox Draw', error);
        }
        lastDrawCommitTime = now;
    }

    function excludeTagDrawingsFromDrawLineLayers() {
        if (!map?.getStyle || !map?.getLayer || !map?.setFilter) return;
        const style = map.getStyle();
        const layers = style?.layers || [];
        const excludeExpr = ['!=', TM_SOURCE_KEY, TM_SOURCE_TAG];

        layers.forEach(layer => {
            const id = layer?.id;
            if (typeof id !== 'string') return;
            if (!id.startsWith('gl-draw-line')) return;

            const current = map.getFilter(id);
            if (!current) {
                map.setFilter(id, excludeExpr);
                return;
            }
            map.setFilter(id, ['all', current, excludeExpr]);
        });
    }

    if (map?.on) {
        map.on('style.load', () => {
            excludeTagDrawingsFromDrawLineLayers();
            updateTagDrawingLayer();
        });
    }

    if (map?.isStyleLoaded?.()) {
        excludeTagDrawingsFromDrawLineLayers();
        updateTagDrawingLayer();
    }

    async function checkPosition() {
        if (isCheckingPosition) return;
        isCheckingPosition = true;
        try {
            const now = Date.now();
            const response = await fetch('http://localhost:5000/api/position');

            if (!response.ok) {
                return;
            }

            const data = await response.json();

            // data.tags is a dictionary keyed by tag id with normalized positions.
            const detectedTags = data.tags || {};
            const { detectedIds, visibleIds } = updateTagStates(detectedTags);
            
            // Check if any significant tag is present to reset search mode
            // We include dynamic layer + shortest-path tags in this check
            let layerTags = [];
            if (setupConfig?.project?.tagConfig?.layers?.items) {
                 layerTags = setupConfig.project.tagConfig.layers.items
                    .map(item => item.tagId)
                    .filter(id => Number.isInteger(id));
            }
            const layerTagIds = new Set(layerTags);

            const shortestItems = setupConfig?.project?.tagConfig?.shortestPath?.items;
            const shortestTagIds = new Set();
            let shortestTagA = null;
            let shortestTagB = null;
            if (Array.isArray(shortestItems)) {
                shortestItems.forEach(item => {
                    if (!item || item.enabled === false) return;
                    if (!Number.isInteger(item.tagId)) return;
                    if (item.id === 'A') {
                        shortestTagA = item.tagId;
                        shortestTagIds.add(item.tagId);
                    } else if (item.id === 'B') {
                        shortestTagB = item.tagId;
                        shortestTagIds.add(item.tagId);
                    }
                });
            }

            const reachItems = setupConfig?.project?.tagConfig?.reach15?.items;
            const reachTagMap = new Map();
            const reachTagIds = new Set();
            if (Array.isArray(reachItems)) {
                reachItems.forEach(item => {
                    if (!item || item.enabled === false) return;
                    if (!Number.isInteger(item.tagId)) return;
                    if (!item.id) return;
                    reachTagMap.set(item.tagId, item.id);
                    reachTagIds.add(item.tagId);
                });
            }

            const toolItems = setupConfig?.project?.tagConfig?.tools?.items;
            const toolTagIds = new Set();
            let eraserTagId = null;
            if (Array.isArray(toolItems)) {
                toolItems.forEach(item => {
                    if (!item || item.enabled === false) return;
                    if (!Number.isInteger(item.tagId)) return;
                    toolTagIds.add(item.tagId);
                    if (item.id === 'eraser') {
                        eraserTagId = item.tagId;
                    }
                });
            }

            // Collect sticker tags
            const stickerTags = setupConfig?.project?.stickerConfig?.tags || [];
            const stickerColors = setupConfig?.project?.stickerConfig?.colors || [];
            const stickerTagMap = new Map(); // tagId -> { index, color }
            const stickerTagIds = new Set();
            stickerTags.forEach((tagId, index) => {
                if (Number.isInteger(tagId)) {
                    stickerTagMap.set(tagId, { index, color: stickerColors[index] || '#cccccc' });
                    stickerTagIds.add(tagId);
                }
            });

            const tagSettingsConfig = setupConfig?.project?.tagSettings || {};
            const tagSettingsItems = Array.isArray(tagSettingsConfig.items) ? tagSettingsConfig.items : [];
            const tagSettingsCount = Number.isInteger(tagSettingsConfig.count)
                ? tagSettingsConfig.count
                : tagSettingsItems.length;
            const tagSettingsPalette = stickerColors.length ? stickerColors : TAG_SETTINGS_COLORS;
            const tagSettingsTagMap = new Map(); // tagId -> { index, color }
            const tagSettingsTagIds = new Set();
            tagSettingsItems.slice(0, tagSettingsCount).forEach((item, index) => {
                if (!Number.isInteger(item?.tagId)) return;
                if (tagSettingsTagMap.has(item.tagId)) return;
                const color = tagSettingsPalette[index % tagSettingsPalette.length] || '#cccccc';
                tagSettingsTagMap.set(item.tagId, { index, color });
                tagSettingsTagIds.add(item.tagId);
            });

            const hasTag = Array.from(visibleIds).some(id =>
                id === 5
                || drawingTagIds.has(id)
                || layerTagIds.has(id)
                || shortestTagIds.has(id)
                || reachTagIds.has(id)
                || toolTagIds.has(id)
                || stickerTagIds.has(id)
                || tagSettingsTagIds.has(id)
            );

            if (hasTag) {
                lastSeenTime = now;
                if (isSearchMode) {
                    isSearchMode = false;
                    searchOverlay.style.display = 'none';
                }
            }

            // State Machine for Search Mode (Only if TUI Mode is enabled)
            if (setupConfig.project.tuiMode) {
                if (!hasTag && now > cooldownEndTime) {
                    const timeSinceLastSeen = now - lastSeenTime;
                    if (!isSearchMode) {
                        if (timeSinceLastSeen > SEARCH_DELAY) {
                            isSearchMode = true;
                            searchStartTime = now;
                            searchOverlay.style.display = 'flex';
                            searchOverlay.textContent = 'Tag not found. Searching...';
                        }
                    } else {
                        const timeInSearch = now - searchStartTime;
                        if (timeInSearch > BLACK_SCREEN_DURATION) {
                            isSearchMode = false;
                            searchOverlay.style.display = 'none';
                            cooldownEndTime = now + COOLDOWN_DURATION;
                            lastSeenTime = now;
                        }
                    }
                } else if (now < cooldownEndTime) {
                    if (isSearchMode) {
                        isSearchMode = false;
                        searchOverlay.style.display = 'none';
                    }
                }
            } else {
                if (isSearchMode) {
                    isSearchMode = false;
                    searchOverlay.style.display = 'none';
                }
            }

            const debugIds = document.getElementById('debug-ids');
            if (debugIds) {
                const idsList = data.detected_ids ? data.detected_ids.join(', ') : '-';
                debugIds.textContent = `IDs: ${idsList}`;
            }

            // Helper to project normalized (0-1) coordinates to screen pixels
            function getScreenCoordinates(nx, ny) {
                let corners = null;
                if (window.maptastic) {
                    const layout = window.maptastic.getLayout();
                    const layer = layout.find(l => l.id === 'main_container');
                    if (layer && layer.targetPoints) {
                        corners = layer.targetPoints; // [TL, TR, BR, BL]
                    }
                }

                if (corners) {
                    const u = nx;
                    const v = ny;

                    const x0 = corners[0][0], y0 = corners[0][1];
                    const x1 = corners[1][0], y1 = corners[1][1];
                    const x2 = corners[2][0], y2 = corners[2][1];
                    const x3 = corners[3][0], y3 = corners[3][1];

                    let projX, projY;

                    const dx3 = x0 - x1 + x2 - x3;
                    const dy3 = y0 - y1 + y2 - y3;

                    if (Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6) {
                        // Affine
                        projX = x0 + (x1 - x0) * u + (x3 - x0) * v;
                        projY = y0 + (y1 - y0) * u + (y3 - y0) * v;
                    } else {
                        // Projective
                        const dx1 = x1 - x2;
                        const dy1 = y1 - y2;
                        const dx2 = x3 - x2;
                        const dy2 = y3 - y2;

                        const det = dx1 * dy2 - dx2 * dy1;
                        const a13 = (dx3 * dy2 - dx2 * dy3) / det;
                        const a23 = (dx1 * dy3 - dx3 * dy1) / det;

                        const a11 = x1 - x0 + a13 * x1;
                        const a21 = x3 - x0 + a23 * x3;
                        const a12 = y1 - y0 + a13 * y1;
                        const a22 = y3 - y0 + a23 * y3;

                        const den = (a13 * u + a23 * v + 1);
                        projX = (a11 * u + a21 * v + x0) / den;
                        projY = (a12 * u + a22 * v + y0) / den;
                    }
                    return { x: projX, y: projY, projected: true, corners: corners };
                } else {
                    return { x: nx * window.innerWidth, y: ny * window.innerHeight, projected: false, corners: null };
                }
            }

            // Process detected tags
            const leftSidebar = document.getElementById('left-sidebar');
            const rightSidebar = document.getElementById('right-sidebar');
            let leftBound = 0;
            let rightBound = window.innerWidth;
            if (leftSidebar) {
                const rect = leftSidebar.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.right)) {
                    leftBound = rect.right;
                }
            }
            if (rightSidebar) {
                const rect = rightSidebar.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.left)) {
                    rightBound = rect.left;
                }
            }

            let debugDotVisible = false;

            // Track updated black holes for this frame
            const updatedBlackHoles = new Set();
            let tagAOutsideMap = false;
            let tagBOutsideMap = false;
            const reachOutsideMap = new Map();
            let eraserOutsideMap = false;
            const updatedStickerTags = new Set();
            let drawingLayerDirty = false;

            for (const tagId of visibleIds) {
                const state = tagStates.get(tagId);
                if (!state || !Number.isFinite(state.x) || !Number.isFinite(state.y)) {
                    continue;
                }
                const coords = getScreenCoordinates(state.x, state.y);
                const screenX = coords.x;
                const screenY = coords.y;
                const isDetected = detectedIds.has(tagId);

                // Show Debug Dot for at least one tag
                if (isDetected) {
                    debugDot.style.left = `${screenX}px`;
                    debugDot.style.top = `${screenY}px`;
                    debugDotVisible = true;
                }

                if (setupConfig.project.tuiMode) {
                    // Update generic black hole for any detected tag (if needed by logic)
                    // We only strictly need it for 5, drawing tags, and layer tags.
                    const isLayerTag = layerTagIds.has(tagId);
                     
                    if (tagId === 5 || drawingTagIds.has(tagId) || isLayerTag) {
                        const bh = getBlackHole(tagId);
                        bh.style.left = `${screenX}px`;
                        bh.style.top = `${screenY}px`;
                        bh.style.display = 'block';
                        updatedBlackHoles.add(tagId);
                    }
                }

                // --- Tag 5 Logic (Map Styles) ---
                if (tagId === 5 && isDetected) {
                    const element = document.elementFromPoint(screenX, screenY);
                    const mapStylesSection = document.querySelector('#right-sidebar .toolbar-section:first-child .section-content');
                    const sidebar = document.getElementById('right-sidebar');

                    if (mapStylesSection && sidebar) {
                        const styleRect = mapStylesSection.getBoundingClientRect();
                        const sidebarRect = sidebar.getBoundingClientRect();
                        const margin = 20;

                        const inHorz = screenX >= (sidebarRect.left - margin) && screenX <= (sidebarRect.right + margin);
                        const inVert = screenY <= (styleRect.bottom + margin);

                        if (inHorz && inVert) {
                            const centerX = styleRect.left + styleRect.width / 2;
                            const centerY = styleRect.top + styleRect.height / 2;
                            let targetBtnId = null;

                            if (screenY < centerY) {
                                if (screenX < centerX) targetBtnId = 'btn-light';
                                else targetBtnId = 'btn-dark';
                            } else {
                                if (screenX < centerX) targetBtnId = 'btn-streets';
                                else targetBtnId = 'btn-satellite';
                            }

                            if (targetBtnId) {
                                const btn = document.getElementById(targetBtnId);
                                if (btn && !btn.classList.contains('active')) {
                                    btn.click();
                                }
                            }
                        }
                    }

                    if (element) {
                        const button = element.closest('button');
                        const layerButtons = ['btn-layer-bus', 'btn-layer-bike', 'btn-layer-walk', 'btn-layer-roads'];
                        if (button && layerButtons.includes(button.id)) {
                            const btnRect = button.getBoundingClientRect();
                            const isRightHalf = screenX > (btnRect.left + btnRect.width / 2);
                            const isActive = button.classList.contains('active');
                            if (isRightHalf && !isActive) button.click();
                            else if (!isRightHalf && isActive) button.click();
                        }
                    }
                }

                // --- Drawing Tags Logic ---
                if (drawingTagIds.has(tagId) && isDetected) {
                    if (screenX > leftBound && screenX < rightBound) {
                        const drawingState = getDrawingState(tagId);
                        drawingState.lostStart = null;
                        if (now - drawingState.lastSampleTime > DRAW_SAMPLE_INTERVAL_MS) {
                            const lngLat = getMapCoordsFromScreen(map, screenX, screenY);
                            if (!lngLat) return;
                            const dx = drawingState.lastScreenPoint ? screenX - drawingState.lastScreenPoint.x : 0;
                            const dy = drawingState.lastScreenPoint ? screenY - drawingState.lastScreenPoint.y : 0;
                            const dist2 = dx * dx + dy * dy;
                            if (!drawingState.lastScreenPoint || dist2 >= TAG_DRAW_MIN_DISTANCE_PX * TAG_DRAW_MIN_DISTANCE_PX) {
                                drawingState.coordinates.push([lngLat.lng, lngLat.lat]);
                                drawingState.lastScreenPoint = { x: screenX, y: screenY };
                                drawingLayerDirty = true;
                            }
                            drawingState.lastSampleTime = now;
                        }
                    }
                }

                // --- Shortest Path A/B Logic ---
                const shortestLabel = tagId === shortestTagA ? 'A' : (tagId === shortestTagB ? 'B' : null);
                if (shortestLabel) {
                    if (isDetected && screenX > leftBound && screenX < rightBound) {
                        setShortestPathButtonPosition(map, shortestLabel, screenX, screenY);
                    } else if (isDetected && shortestLabel === 'A') {
                        tagAOutsideMap = true;
                    } else if (isDetected) {
                        tagBOutsideMap = true;
                    }
                }

                // --- 15-Minute Reach Logic ---
                const reachMode = reachTagMap.get(tagId);
                if (reachMode) {
                    if (isDetected && screenX > leftBound && screenX < rightBound) {
                        setReachButtonPosition(map, reachMode, screenX, screenY);
                    } else if (isDetected) {
                        reachOutsideMap.set(reachMode, true);
                    }
                }

                // --- Eraser Logic ---
                if (eraserTagId !== null && tagId === eraserTagId) {
                    if (isDetected && screenX > leftBound && screenX < rightBound) {
                        setEraserButtonPosition(map, draw, screenX, screenY);
                    } else if (isDetected) {
                        eraserOutsideMap = true;
                    }
                }

                // --- Sticker Logic ---
                const stickerData = stickerTagMap.get(tagId);
                const tagSettingsData = tagSettingsTagMap.get(tagId);
                const activeData = stickerData || tagSettingsData;
                if (activeData) {
                    if (screenX > leftBound && screenX < rightBound) {
                        if (isDetected) {
                            setStickerPosition(map, tagId, activeData.index, activeData.color, screenX, screenY);
                        }
                        updatedStickerTags.add(tagId);
                    }
                }

                // --- Dynamic Layer Logic ---
                // Debug log to see what we are working with

                if (setupConfig?.project?.tagConfig?.layers?.items) {
                     setupConfig.project.tagConfig.layers.items.forEach(layerItem => {
                        if (layerItem.tagId === tagId && isDetected) {
                            const buttonMap = {
                                'palaiseau-roads': 'btn-layer-roads',
                                'walking-network': 'btn-layer-walk',
                                'mobility-infrastructure': 'btn-layer-bike',
                                'bus-lanes': 'btn-layer-bus',
                                'amenities': 'btn-layer-amenities',
                                'telecom-floorplan': 'btn-layer-floorplan'
                            };

                            const btnId = buttonMap[layerItem.id];
                            if (!btnId) {
                                console.warn('No button mapped for layer:', layerItem.id);
                                return;
                            }

                            const btn = document.getElementById(btnId);
                            const layersSection = document.getElementById('toolbar-layers');

                            if (layersSection && btn) {
                                const rect = layersSection.getBoundingClientRect();
                                const isInside = (
                                    screenX >= rect.left &&
                                    screenX <= rect.right &&
                                    screenY >= rect.top &&
                                    screenY <= rect.bottom
                                );


                                const isActive = btn.classList.contains('active');

                                if (isInside) {
                                    if (!isActive) {
                                        btn.click();
                                    }
                                } else {
                                    if (isActive) {
                                        btn.click();
                                    }
                                }
                            } else {
                                console.error('Layers section or button not found in DOM');
                            }
                        }
                     });
                } else {
                    console.log('No layer config found in setupConfig');
                }
            }

            if (tagAOutsideMap) {
                resetShortestPathButton(map, 'A');
            }
            if (tagBOutsideMap) {
                resetShortestPathButton(map, 'B');
            }
            if (reachOutsideMap.size > 0) {
                reachOutsideMap.forEach((isOutside, mode) => {
                    if (isOutside) {
                        resetReachButton(map, mode);
                    }
                });
            }
            if (eraserOutsideMap) {
                resetEraserButton();
            }

            // Remove sticker markers that were not updated this frame
            const allStickerTags = new Set([...stickerTagIds, ...tagSettingsTagIds]);
            allStickerTags.forEach(tagId => {
                if (!updatedStickerTags.has(tagId)) {
                    removeStickerMarker(tagId);
                }
            });

            debugDot.style.display = debugDotVisible ? 'block' : 'none';

            // Hide black holes that were not updated this frame
            Object.keys(blackHoles).forEach(id => {
                const numId = parseInt(id, 10);
                if (!updatedBlackHoles.has(numId)) {
                    blackHoles[id].style.display = 'none';
                }
            });

            // Finalize drawings when their tags are lost for long enough
            drawingTagIds.forEach(tagId => {
                const drawingState = getDrawingState(tagId);
                const coords = drawingState?.coordinates;
                if (!Array.isArray(coords) || coords.length === 0) {
                    drawingState.lostStart = null;
                    return;
                }

                if (detectedIds.has(tagId)) {
                    drawingState.lostStart = null;
                    return;
                }

                if (!drawingState.lostStart) {
                    drawingState.lostStart = now;
                    return;
                }

                if (now - drawingState.lostStart <= DRAW_LOST_TIMEOUT_MS) {
                    return;
                }

                if (coords.length > 1) {
                    const tool = drawingToolByTagId.get(tagId) || { tagId, label: '', color: '#ff00ff' };
                    const feature = {
                        id: `${tagId}-${Date.now()}`,
                        type: 'Feature',
                        properties: {
                            tagId,
                            label: tool.label || '',
                            color: tool.color || '#ff00ff',
                            [TM_SOURCE_KEY]: TM_SOURCE_TAG
                        },
                        geometry: {
                            type: 'LineString',
                            coordinates: coords
                        }
                    };
                    finalizedDrawingFeatures.push(feature);
                    finishedDrawingQueue.push(feature);
                }

                drawingState.coordinates = [];
                drawingState.lastScreenPoint = null;
                drawingState.lastSampleTime = 0;
                drawingState.lostStart = null;
                drawingLayerDirty = true;
            });

            if (drawingLayerDirty) {
                updateTagDrawingLayer();
            }
            flushFinishedDrawings(now);

        } catch (error) {
            console.error('CheckPosition error:', error);
        } finally {
            isCheckingPosition = false;
        }
    }

    const intervalId = setInterval(checkPosition, 30);
    return { stop: () => clearInterval(intervalId) };
}
