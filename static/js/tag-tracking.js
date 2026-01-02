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
    const drawingPrimary = drawingConfig?.items?.[0] || drawingConfig;
    const drawingTagId = Number.isInteger(drawingPrimary?.tagId) ? drawingPrimary.tagId : 6;
    const drawingColorRaw = typeof drawingPrimary?.color === 'string' ? drawingPrimary.color.trim() : '';
    const drawingColor = /^#[0-9a-f]{6}$/i.test(drawingColorRaw) || drawingColorRaw.length > 0
        ? drawingColorRaw
        : '#ff00ff';

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
    Array.from(new Set([5, drawingTagId, 11])).forEach(id => getBlackHole(id));

    const searchOverlay = createSearchOverlay();

    let lastSeenTime = Date.now();
    let isSearchMode = false;
    let searchStartTime = 0;
    let cooldownEndTime = 0;

    let lastTagClickTime = 0;
    let drawingTagLostStart = null;
    let tagDrawingCoordinates = [];
    let lastTagDrawScreenPoint = null;
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
        const source = map.getSource('tag-drawing-source');
        const data = {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: tagDrawingCoordinates
            }
        };

        if (source) {
            source.setData(data);
        } else {
            map.addSource('tag-drawing-source', { type: 'geojson', data: data });
            map.addLayer({
                id: 'tag-drawing-line',
                type: 'line',
                source: 'tag-drawing-source',
                layout: {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                paint: {
                    'line-color': drawingColor,
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });
        }
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

            const hasTag = Array.from(visibleIds).some(id =>
                id === 5
                || id === drawingTagId
                || layerTagIds.has(id)
                || shortestTagIds.has(id)
                || reachTagIds.has(id)
                || toolTagIds.has(id)
                || stickerTagIds.has(id)
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
                leftBound = leftSidebar.getBoundingClientRect().right;
            }
            if (rightSidebar) {
                rightBound = rightSidebar.getBoundingClientRect().left;
            }

            let debugDotVisible = false;

            // Track updated black holes for this frame
            const updatedBlackHoles = new Set();
            let tagAOutsideMap = false;
            let tagBOutsideMap = false;
            const reachOutsideMap = new Map();
            let eraserOutsideMap = false;
            const updatedStickerTags = new Set();

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
                    // We only strictly need it for 5, the drawing tag, and layer tags.
                    const isLayerTag = layerTagIds.has(tagId);
                     
                    if (tagId === 5 || tagId === drawingTagId || isLayerTag) {
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

                // --- Drawing Tag Logic ---
                if (tagId === drawingTagId && isDetected) {
                    if (screenX > leftBound && screenX < rightBound) {
                        drawingTagLostStart = null;
                        if (Date.now() - lastTagClickTime > 200) {
                            const lngLat = getMapCoordsFromScreen(map, screenX, screenY);
                            if (!lngLat) return;
                            const dx = lastTagDrawScreenPoint ? screenX - lastTagDrawScreenPoint.x : 0;
                            const dy = lastTagDrawScreenPoint ? screenY - lastTagDrawScreenPoint.y : 0;
                            const dist2 = dx * dx + dy * dy;
                            if (!lastTagDrawScreenPoint || dist2 >= TAG_DRAW_MIN_DISTANCE_PX * TAG_DRAW_MIN_DISTANCE_PX) {
                                tagDrawingCoordinates.push([lngLat.lng, lngLat.lat]);
                                updateTagDrawingLayer();
                                lastTagDrawScreenPoint = { x: screenX, y: screenY };
                            }
                            lastTagClickTime = Date.now();
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
                if (stickerData) {
                    if (screenX > leftBound && screenX < rightBound) {
                        if (isDetected) {
                            setStickerPosition(map, tagId, stickerData.index, stickerData.color, screenX, screenY);
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
            stickerTagIds.forEach(tagId => {
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

            // Drawing tag lost logic (independent check)
            if (!detectedIds.has(drawingTagId)) {
                if (!drawingTagLostStart) {
                    drawingTagLostStart = Date.now();
                } else if (Date.now() - drawingTagLostStart > 3000) {
                    if (tagDrawingCoordinates.length > 0) {
                        if (tagDrawingCoordinates.length > 1) {
                            const featureId = String(Date.now());
                            const feature = {
                                id: featureId,
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                    type: 'LineString',
                                    coordinates: tagDrawingCoordinates
                                }
                            };
                            if (draw) {
                                draw.add(feature);
                            } else {
                                console.error('Mapbox Draw instance not found!');
                            }
                        }
                        // Reset
                        tagDrawingCoordinates = [];
                        updateTagDrawingLayer();
                        lastTagDrawScreenPoint = null;
                    }
                    drawingTagLostStart = null;
                }
            } else {
                // Drawing tag is present, reset lost timer
                drawingTagLostStart = null;
            }

        } catch (error) {
            console.error('CheckPosition error:', error);
        } finally {
            isCheckingPosition = false;
        }
    }

    const intervalId = setInterval(checkPosition, 30);
    return { stop: () => clearInterval(intervalId) };
}
