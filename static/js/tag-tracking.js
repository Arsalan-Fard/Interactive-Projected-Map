import { getMapCoordsFromScreen, setShortestPathButtonPosition, resetShortestPathButton } from './ui.js';

const SEARCH_DELAY = 1000; // Wait 1s before going black
const BLACK_SCREEN_DURATION = 1000; // Stay black for 1s
const COOLDOWN_DURATION = 2000; // Show map for 2s before trying again

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

    const debugDot = createDebugDot();
    const blackHole5 = createBlackHole(5);
    const blackHole6 = createBlackHole(6);
    const blackHole11 = createBlackHole(11);
    const searchOverlay = createSearchOverlay();

    let lastSeenTime = Date.now();
    let isSearchMode = false;
    let searchStartTime = 0;
    let cooldownEndTime = 0;

    let lastTagClickTime = 0;
    let tag6LostStart = null;
    let tagDrawingCoordinates = [];

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
                    'line-color': '#FF0000',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });
        }
    }

    async function checkPosition() {
        try {
            const now = Date.now();
            const response = await fetch('http://localhost:5000/api/position');

            if (!response.ok) {
                return;
            }

            const data = await response.json();

            // data.tags is a dictionary keyed by tag id with normalized positions.
            const detectedTags = data.tags || {};
            const tagIds = Object.keys(detectedTags).map(Number);
            const hasTag = tagIds.includes(5) || tagIds.includes(6) || tagIds.includes(7) || tagIds.includes(8) || tagIds.includes(11);

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

            // Flags to track if we updated black holes this frame
            let updatedBlackHole5 = false;
            let updatedBlackHole6 = false;
            let updatedBlackHole11 = false;
            let tag7OutsideMap = false;
            let tag8OutsideMap = false;

            for (const key in detectedTags) {
                const tag = detectedTags[key];
                const tagId = tag.id;
                const coords = getScreenCoordinates(tag.x, tag.y);
                const screenX = coords.x;
                const screenY = coords.y;

                // Show Debug Dot for at least one tag
                debugDot.style.left = `${screenX}px`;
                debugDot.style.top = `${screenY}px`;
                debugDotVisible = true;

                if (setupConfig.project.tuiMode) {
                    if (tagId === 5) {
                        blackHole5.style.left = `${screenX}px`;
                        blackHole5.style.top = `${screenY}px`;
                        blackHole5.style.display = 'block';
                        updatedBlackHole5 = true;
                    } else if (tagId === 6) {
                        blackHole6.style.left = `${screenX}px`;
                        blackHole6.style.top = `${screenY}px`;
                        blackHole6.style.display = 'block';
                        updatedBlackHole6 = true;
                    } else if (tagId === 11) {
                        blackHole11.style.left = `${screenX}px`;
                        blackHole11.style.top = `${screenY}px`;
                        blackHole11.style.display = 'block';
                        updatedBlackHole11 = true;
                    }
                }

                // --- Tag 5 Logic (Map Styles) ---
                if (tagId === 5) {
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

                // --- Tag 6 Logic (Drawing) ---
                if (tagId === 6) {
                    if (screenX > leftBound && screenX < rightBound) {
                        tag6LostStart = null;
                        if (Date.now() - lastTagClickTime > 200) {
                            const lngLat = getMapCoordsFromScreen(map, screenX, screenY);
                            if (!lngLat) return;

                            tagDrawingCoordinates.push([lngLat.lng, lngLat.lat]);
                            updateTagDrawingLayer();
                            lastTagClickTime = Date.now();
                        }
                    }
                }

                // --- Tag 7/8 Logic (Shortest Path A/B) ---
                if (tagId === 7 || tagId === 8) {
                    if (screenX > leftBound && screenX < rightBound) {
                        const label = tagId === 7 ? 'A' : 'B';
                        setShortestPathButtonPosition(map, label, screenX, screenY);
                    } else if (tagId === 7) {
                        tag7OutsideMap = true;
                    } else {
                        tag8OutsideMap = true;
                    }
                }

                // --- Tag 11 Logic (Layers Section) ---
                if (tagId === 11) {
                    const roadsBtn = document.getElementById('btn-layer-roads');
                    // Find the Layers section using one of its buttons
                    const referenceBtn = document.getElementById('btn-layer-bus');
                    const layersSection = referenceBtn ? referenceBtn.closest('.toolbar-section') : null;
                    console.log('here');
                    if (layersSection && roadsBtn) {
                        const rect = layersSection.getBoundingClientRect();
                        
                        // Check if tag is inside the Layers section
                        const isInside = (
                            screenX >= rect.left &&
                            screenX <= rect.right &&
                            screenY >= rect.top &&
                            screenY <= rect.bottom
                        );

                        const isActive = roadsBtn.classList.contains('active');

                        if (isInside) {
                            if (!isActive) roadsBtn.click();
                        } else {
                            if (isActive) roadsBtn.click();
                        }
                    }
                }
            }

            if (tag7OutsideMap) {
                resetShortestPathButton(map, 'A');
            }
            if (tag8OutsideMap) {
                resetShortestPathButton(map, 'B');
            }

            debugDot.style.display = debugDotVisible ? 'block' : 'none';

            // Hide black holes if not updated (tag lost) or not in TUI mode
            if (!updatedBlackHole5) blackHole5.style.display = 'none';
            if (!updatedBlackHole6) blackHole6.style.display = 'none';
            if (!updatedBlackHole11) blackHole11.style.display = 'none';

            // Tag 6 Lost Logic (Independent check)
            if (!detectedTags['6']) {
                if (!tag6LostStart) {
                    tag6LostStart = Date.now();
                } else if (Date.now() - tag6LostStart > 3000) {
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
                                console.log('Feature added to mapbox-draw. Total features:', draw.getAll().features.length);
                            } else {
                                console.error('Mapbox Draw instance not found!');
                            }
                        }
                        // Reset
                        tagDrawingCoordinates = [];
                        updateTagDrawingLayer();
                    }
                    tag6LostStart = null;
                }
            } else {
                // Tag 6 is present, reset lost timer
                tag6LostStart = null;
            }

        } catch (error) {
            console.error('CheckPosition error:', error);
        }
    }

    const intervalId = setInterval(checkPosition, 100);
    return { stop: () => clearInterval(intervalId) };
}
