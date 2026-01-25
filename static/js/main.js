import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { initDraggableItems, initLayerToggles, getMapCoordsFromScreen, applyTagConfigVisibility, initReachDraggables, initDrawEraser, initIsovistDraggable } from './ui.js';
import { initIsovist } from './isovist.js';
import { initSurvey } from './survey.js';
import { initReactions } from './reaction.js';
import { initTagTracking } from './tag-tracking.js';
import { fallbackConfig, loadSetupConfig } from './config-loader.js';
import { initMap } from './map-setup.js';
import { getReadableTextColor } from './color-utils.js';

function getDrawingItems(setupConfig) {
    const drawingConfig = setupConfig?.project?.drawingConfig;
    if (!drawingConfig) return [];
    if (Array.isArray(drawingConfig)) return drawingConfig;
    if (Array.isArray(drawingConfig.items)) return drawingConfig.items;
    if (drawingConfig.label || drawingConfig.color || drawingConfig.tagId !== undefined) {
        return [drawingConfig];
    }
    return [];
}

function getWorkshopBarIndex(bar) {
    if (!bar) return null;
    if (bar.classList.contains('workshop-bar--top')) return 0;
    if (bar.classList.contains('workshop-bar--bottom')) return 1;
    if (bar.classList.contains('workshop-bar--left')) return 2;
    if (bar.classList.contains('workshop-bar--right')) return 3;
    return null;
}

function applyWorkshopDrawingConfig(setupConfig, drawingItems) {
    const items = Array.isArray(drawingItems) ? drawingItems : getDrawingItems(setupConfig);
    const buttons = Array.from(document.querySelectorAll('.workshop-btn[data-draw-mode]'));
    buttons.forEach(btn => {
        const bar = btn.closest('.workshop-bar');
        const index = getWorkshopBarIndex(bar);
        if (index === null) return;
        btn.dataset.drawToolIndex = String(index);
        const item = items[index] || items[0];
        if (item?.label) {
            btn.textContent = item.label;
        }
        if (item?.color) {
            btn.dataset.drawColor = item.color;
        }
    });
}

function applyStickerConfig(setupConfig) {
    const config = setupConfig?.project?.stickerConfig;
    if (!config) return;
    const colors = Array.isArray(config.colors) ? config.colors : [];
    const rawCount = Number.isInteger(config.count) ? config.count : colors.length;
    const count = Math.max(0, rawCount);
    const isWorkshopMode = !!setupConfig?.project?.workshopMode;

    const buttons = Array.from(document.querySelectorAll('.point-btn[data-sticker-index]'));
    buttons.forEach((btn, index) => {
        const rawIndex = Number.parseInt(btn.dataset.stickerIndex, 10);
        const stickerIndex = Number.isFinite(rawIndex) ? rawIndex : index;
        if (stickerIndex >= count) {
            btn.style.display = 'none';
            return;
        }

        const color = colors[stickerIndex] || btn.dataset.color || '#ffffff';
        btn.dataset.color = color;
        btn.style.backgroundColor = color;

        let showSticker = true;
        if (isWorkshopMode) {
            const bar = btn.closest('.workshop-bar');
            if (bar) {
                let group = null;
                if (bar.classList.contains('workshop-bar--top')) {
                    group = 0;
                } else if (bar.classList.contains('workshop-bar--bottom')) {
                    group = 1;
                } else if (bar.classList.contains('workshop-bar--left')) {
                    group = 2;
                } else if (bar.classList.contains('workshop-bar--right')) {
                    group = 3;
                }
                if (group !== null) {
                    showSticker = stickerIndex % 4 === group;
                }
            }
        }

        btn.style.display = showSticker ? '' : 'none';
    });
}

function applyTagSettings(setupConfig) {
    const panel = document.getElementById('tag-settings-panel');
    const list = document.getElementById('tag-settings-list');
    if (!panel || !list) return;

    const tagButtonColor = '#6b7280';
    const config = setupConfig?.project?.tagSettings || {};
    const rawItems = Array.isArray(config.items) ? config.items : [];
    const count = Number.isInteger(config.count) ? config.count : rawItems.length;
    const items = rawItems.slice(0, count);

    if (!items.length) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';
    list.innerHTML = '';

    items.forEach((item, index) => {
        const color = tagButtonColor;
        const labelText = item?.label?.trim() || `Tag ${index + 1}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `tag-setting-btn-${index + 1}`;
        btn.dataset.color = color;
        btn.dataset.label = labelText;
        btn.className = 'point-btn tag-setting-btn w-full px-3 py-2 rounded-md border border-white/15 bg-white/5 text-white/85 text-xs font-semibold text-left cursor-grab active:cursor-grabbing select-none';
        btn.textContent = labelText;
        btn.style.backgroundColor = color;
        btn.style.color = getReadableTextColor(color);

        list.appendChild(btn);
    });
}

async function initApp() {
    const setupConfig = await loadSetupConfig();
    const drawingItems = getDrawingItems(setupConfig);
    let drawLineColor = drawingItems[0]?.color
        || setupConfig?.project?.drawingConfig?.color
        || 'magenta';

    try {
        const params = new URLSearchParams(window.location.search);
        const debugEnabled = params.get('debug') === '1' || window.localStorage?.getItem('tm_debug') === '1';
        if (debugEnabled) {
            const root = globalThis.__tmDebug || (globalThis.__tmDebug = {});
            root.setupConfig = setupConfig;
            root.dumpDrawGlow = (mapInstance) => {
                try {
                    console.log('[tm debug] gl-draw-line-glow paint', mapInstance?.getPaintProperty?.('gl-draw-line-glow', 'line-color'));
                } catch (error) {
                    console.warn('[tm debug] dumpDrawGlow failed', error);
                }
            };
        }
    } catch {
        // ignore
    }

    window.addEventListener('error', (e) => {
        console.error('[error]', e.message, e.filename, e.lineno, e.colno, e.error?.stack);
    });
    window.addEventListener('unhandledrejection', (e) => {
        console.error('[unhandledrejection]', e.reason?.message || e.reason, e.reason?.stack);
    });
    if ('caches' in window) {
        caches.keys()
            .then(keys => console.log('[cache] keys', keys))
            .catch(err => console.error('[cache] keys failed', err));
    }

    if (setupConfig.project.rearProjection) {
        document.body.style.transform = 'scaleX(-1)';
    }

    if (setupConfig.project.tuiMode) {
        document.body.classList.add('tui-mode');
    }
    if (setupConfig.project.workshopMode) {
        document.body.classList.add('workshop-mode');
    }

    applyTagConfigVisibility(setupConfig);
    applyWorkshopDrawingConfig(setupConfig, drawingItems);
    applyStickerConfig(setupConfig);
    applyTagSettings(setupConfig);

    async function refreshTagConfig() {
        try {
            const projectId = setupConfig.project?.id;
            const url = projectId ? `/api/config?project=${encodeURIComponent(projectId)}` : '/api/config';
            const response = await fetch(url);
            if (!response.ok) return;
            const latest = await response.json();
            if (latest?.project?.tagConfig) {
                setupConfig.project.tagConfig = latest.project.tagConfig;
                applyTagConfigVisibility(setupConfig);
            }
        } catch (error) {
            console.warn('Failed to refresh tag config', error);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshTagConfig();
        }
    });
    window.addEventListener('focus', refreshTagConfig);

    let survey = null;
    const { map, overlayState } = initMap({
        setupConfig,
        add3DBuildings,
        loadAndRenderLayer,
        onStyleLoad: () => {
            scheduleDrawLineGlow(map);
            scheduleDrawLineStyle(map, drawLineColor);
            if (survey) {
                survey.onStyleLoad();
            }
        }
    });
    initIsovist(map, { center: setupConfig.map?.center });

    try {
        const params = new URLSearchParams(window.location.search);
        const debugEnabled = params.get('debug') === '1' || window.localStorage?.getItem('tm_debug') === '1';
        if (debugEnabled) {
            const root = globalThis.__tmDebug || (globalThis.__tmDebug = {});
            root.map = map;
        }
    } catch {
        // ignore
    }

    function getClientPointFromEvent(e) {
        const source = e?.originalEvent || e;
        if (source?.touches && source.touches.length) {
            return { x: source.touches[0].clientX, y: source.touches[0].clientY };
        }
        if (source?.changedTouches && source.changedTouches.length) {
            return { x: source.changedTouches[0].clientX, y: source.changedTouches[0].clientY };
        }
        if (typeof source?.clientX === 'number' && typeof source?.clientY === 'number') {
            return { x: source.clientX, y: source.clientY };
        }
        return null;
    }

    function adjustDrawEvent(e) {
        const client = getClientPointFromEvent(e);
        if (!client) {
            console.warn('[draw] no client point', e);
            return e;
        }
        const coords = getMapCoordsFromScreen(map, client.x, client.y);
        if (!coords) {
            console.warn('[draw] no map coords', { client, e });
            return e;
        }
        e.lngLat = coords;
        e.point = map.project(coords);
        if (!e.point) {
            console.warn('[draw] no point after project', { coords, e });
        }
        return e;
    }

    function wrapDrawMode(mode) {
        const wrapped = { ...mode };
        const handlers = [
            'onMouseDown',
            'onMouseMove',
            'onMouseUp',
            'onClick',
            'onTap',
            'onTouchStart',
            'onTouchMove',
            'onTouchEnd'
        ];

        handlers.forEach(handler => {
            if (typeof mode[handler] === 'function') {
                wrapped[handler] = function (state, e) {
                    const adjusted = adjustDrawEvent(e);
                    if (!adjusted?.point) {
                        console.warn('[draw] missing point for', handler, adjusted);
                    }
                    return mode[handler].call(this, state, adjusted);
                };
            }
        });

        return wrapped;
    }

    function buildDrawModes() {
        if (!MapboxDraw?.modes) return null;
        const baseModes = MapboxDraw.modes;
        const wrappedModes = {};
        Object.keys(baseModes).forEach(key => {
            wrappedModes[key] = wrapDrawMode(baseModes[key]);
        });
        return wrappedModes;
    }

    function addDrawLineGlow(mapInstance) {
        if (!mapInstance || typeof mapInstance.getSource !== 'function') return false;
        const sourceId = 'mapbox-gl-draw-cold';
        if (!mapInstance.getSource(sourceId)) return false;
        const layerId = 'gl-draw-line-glow';
        if (mapInstance.getLayer(layerId)) return true;

        const glowLayer = {
            id: layerId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['==', 'meta', 'feature'], ['!=', 'tm_source', 'tag']],
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], ['get', 'user_color'], drawLineColor],
                'line-width': 14,
                'line-opacity': 0.6,
                'line-blur': 6
            }
        };

        let beforeId = null;
        if (mapInstance.getLayer('gl-draw-line-inactive')) {
            beforeId = 'gl-draw-line-inactive';
        } else if (mapInstance.getLayer('gl-draw-line')) {
            beforeId = 'gl-draw-line';
        }
        mapInstance.addLayer(glowLayer, beforeId || undefined);
        return true;
    }

    function scheduleDrawLineGlow(mapInstance) {
        if (addDrawLineGlow(mapInstance)) return;
        const onSourceData = () => {
            if (addDrawLineGlow(mapInstance)) {
                mapInstance.off('sourcedata', onSourceData);
            }
        };
        mapInstance.on('sourcedata', onSourceData);
    }

    function applyDrawLineStyle(mapInstance, fallbackColor) {
        if (!mapInstance?.getLayer || !mapInstance?.setPaintProperty) return false;
        const lineLayers = ['gl-draw-line-inactive', 'gl-draw-line-active', 'gl-draw-line-static', 'gl-draw-line'];
        let applied = false;
        lineLayers.forEach(id => {
            if (!mapInstance.getLayer(id)) return;
            mapInstance.setPaintProperty(id, 'line-color', ['coalesce', ['get', 'color'], ['get', 'user_color'], fallbackColor]);
            applied = true;
        });
        return applied;
    }

    function scheduleDrawLineStyle(mapInstance, fallbackColor) {
        if (applyDrawLineStyle(mapInstance, fallbackColor)) return;
        const onSourceData = () => {
            if (applyDrawLineStyle(mapInstance, fallbackColor)) {
                mapInstance.off('sourcedata', onSourceData);
            }
        };
        mapInstance.on('sourcedata', onSourceData);
    }

    const drawModes = buildDrawModes();
    const draw = new MapboxDraw({
        displayControlsDefault: false,
        userProperties: true,
        ...(drawModes ? { modes: drawModes } : {})
    });
    map.addControl(draw);

    try {
        const params = new URLSearchParams(window.location.search);
        const debugEnabled = params.get('debug') === '1' || window.localStorage?.getItem('tm_debug') === '1';
        if (debugEnabled) {
            const root = globalThis.__tmDebug || (globalThis.__tmDebug = {});
            root.draw = draw;
        }
    } catch {
        // ignore
    }

    initTagTracking({ map, setupConfig, draw });

    const drawButtons = Array.from(document.querySelectorAll('[data-draw-mode]'));
    const TM_SOURCE_KEY = 'tm_source';
    const TM_SOURCE_TAG = 'tag';
    let activeDrawingIndex = 0;

    function getActiveDrawingItem() {
        return drawingItems[activeDrawingIndex] || drawingItems[0] || {};
    }

    function getDrawingColor(item) {
        return typeof item?.color === 'string' ? item.color.trim() : '';
    }

    function updateDrawLineFallback(color) {
        const nextColor = typeof color === 'string' ? color.trim() : '';
        if (!nextColor) return;
        drawLineColor = nextColor;
        applyDrawLineStyle(map, drawLineColor);
        if (map?.getLayer?.('gl-draw-line-glow') && map?.setPaintProperty) {
            map.setPaintProperty('gl-draw-line-glow', 'line-color', ['coalesce', ['get', 'color'], ['get', 'user_color'], drawLineColor]);
        }
    }

    function setActiveDrawingIndex(nextIndex) {
        if (!Number.isFinite(nextIndex)) return false;
        const maxIndex = Math.max(0, drawingItems.length - 1);
        const bounded = Math.max(0, Math.min(maxIndex, nextIndex));
        if (bounded === activeDrawingIndex) return false;
        activeDrawingIndex = bounded;
        updateDrawLineFallback(getDrawingColor(getActiveDrawingItem()));
        return true;
    }

    function setDrawMode(targetMode, requestedToolIndex) {
        const mode = draw.getMode();
        const wantsTool = Number.isFinite(requestedToolIndex);
        const sameTool = !wantsTool || requestedToolIndex === activeDrawingIndex;

        if (wantsTool && requestedToolIndex !== activeDrawingIndex) {
            setActiveDrawingIndex(requestedToolIndex);
        }

        if (mode !== targetMode) {
            draw.changeMode(targetMode);
        } else if (sameTool) {
            draw.changeMode('simple_select');
        }
    }

    function isDrawButtonActive(btn, mode) {
        const targetMode = btn.dataset.drawMode;
        if (targetMode !== mode) return false;
        const rawToolIndex = Number.parseInt(btn.dataset.drawToolIndex, 10);
        if (!Number.isFinite(rawToolIndex)) return true;
        return rawToolIndex === activeDrawingIndex;
    }

    function syncDrawButtons(mode) {
        drawButtons.forEach(btn => {
            btn.classList.toggle('active', isDrawButtonActive(btn, mode));
        });
    }

    drawButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetMode = btn.dataset.drawMode;
            const requestedToolIndex = Number.parseInt(btn.dataset.drawToolIndex, 10);
            const wantsTool = Number.isFinite(requestedToolIndex);
            if (targetMode) {
                const currentMode = draw.getMode();
                const sameMode = currentMode === targetMode;
                const sameTool = !wantsTool || requestedToolIndex === activeDrawingIndex;
                if (sameMode && !sameTool) {
                    if (setActiveDrawingIndex(requestedToolIndex)) {
                        syncDrawButtons(currentMode);
                    }
                    return;
                }
                setDrawMode(targetMode, wantsTool ? requestedToolIndex : undefined);
            }
        });
    });

    map.on('draw.modechange', (e) => {
        console.log('Draw mode changed to:', e.mode);
        syncDrawButtons(e.mode);
    });

    map.on('draw.create', (e) => {
        const features = Array.isArray(e?.features) ? e.features : [];
        if (!features.length) return;
        const activeItem = getActiveDrawingItem();
        const color = typeof activeItem.color === 'string' ? activeItem.color.trim() : '';
        const label = typeof activeItem.label === 'string' ? activeItem.label.trim() : '';
        const toolId = typeof activeItem.id === 'string' ? activeItem.id.trim() : '';
        features.forEach(feature => {
            if (!feature?.id) return;
            if (feature?.properties?.[TM_SOURCE_KEY] === TM_SOURCE_TAG) return;
            if (typeof draw.setFeatureProperty !== 'function') return;
            if (color) draw.setFeatureProperty(feature.id, 'color', color);
            if (label) draw.setFeatureProperty(feature.id, 'label', label);
            if (toolId) draw.setFeatureProperty(feature.id, 'drawingToolId', toolId);
            draw.setFeatureProperty(feature.id, 'drawingToolIndex', activeDrawingIndex);
        });
    });

    const btnWalk = document.getElementById('btn-isochrone');
    const btnBike = document.getElementById('btn-isochrone-bike');
    const btnCar = document.getElementById('btn-isochrone-car');

    const reachButtons = { walk: btnWalk, bike: btnBike, car: btnCar };
    const isochroneSettings = {
        walk: { distance: 1200, color: '#5b94c6' },
        bike: { distance: 3750, color: '#9b59b6' }
    };

    let activeIsochroneMode = null; // 'walk' or 'bike'

    function resetIsochroneUI() {
        Object.values(reachButtons).forEach(btn => btn && btn.classList.remove('active'));
        activeIsochroneMode = null;
        if (map.getSource('isochrone')) {
            map.setLayoutProperty('isochrone-fill', 'visibility', 'none');
            map.setLayoutProperty('isochrone-line', 'visibility', 'none');
        }
    }

    function setActiveIsochroneMode(mode) {
        Object.values(reachButtons).forEach(btn => btn && btn.classList.remove('active'));
        if (!reachButtons[mode]) {
            activeIsochroneMode = null;
            return;
        }
        reachButtons[mode].classList.add('active');
        activeIsochroneMode = mode;
    }

    async function updateIsochrone(center, mode) {
        const settings = isochroneSettings[mode];
        if (!settings) return;

        try {
            map.getCanvas().style.cursor = 'wait';

            const response = await fetch('/api/isochrone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: center.lat,
                    lon: center.lng,
                    distance: settings.distance,
                    mode
                })
            });

            map.getCanvas().style.cursor = '';

            if (!response.ok) return;

            const geojson = await response.json();

            if (map.getSource('isochrone')) {
                map.getSource('isochrone').setData(geojson);
                map.setPaintProperty('isochrone-fill', 'fill-color', settings.color);
                map.setPaintProperty('isochrone-line', 'line-color', settings.color);
                map.setLayoutProperty('isochrone-fill', 'visibility', 'visible');
                map.setLayoutProperty('isochrone-line', 'visibility', 'visible');
            } else {
                map.addSource('isochrone', {
                    type: 'geojson',
                    data: geojson
                });

                map.addLayer({
                    id: 'isochrone-fill',
                    type: 'fill',
                    source: 'isochrone',
                    layout: {},
                    paint: {
                        'fill-color': settings.color,
                        'fill-opacity': 0.3
                    }
                });

                map.addLayer({
                    id: 'isochrone-line',
                    type: 'line',
                    source: 'isochrone',
                    layout: {},
                    paint: {
                        'line-color': settings.color,
                        'line-width': 2
                    }
                });
            }
        } catch (err) {
            console.error("Isochrone error:", err);
            map.getCanvas().style.cursor = '';
        }
    }

    if (btnWalk) {
        btnWalk.addEventListener('click', () => {
            if (btnWalk.dataset.dragged) {
                delete btnWalk.dataset.dragged;
                return;
            }
            const wasActive = activeIsochroneMode === 'walk';
            if (wasActive) {
                resetIsochroneUI();
            } else {
                setActiveIsochroneMode('walk');
            }
        });
    }

    if (btnBike) {
        btnBike.addEventListener('click', () => {
            if (btnBike.dataset.dragged) {
                delete btnBike.dataset.dragged;
                return;
            }
            const wasActive = activeIsochroneMode === 'bike';
            if (wasActive) {
                resetIsochroneUI();
            } else {
                setActiveIsochroneMode('bike');
            }
        });
    }

    initReachDraggables(map, {
        onDrop: (mode, coords) => {
            if (!isochroneSettings[mode]) return;
            setActiveIsochroneMode(mode);
            updateIsochrone(coords, mode);
        },
        onReset: () => {
            resetIsochroneUI();
        }
    });

    initIsovistDraggable(map);

    window.addEventListener('reach-drop', (event) => {
        const detail = event?.detail || {};
        const mode = detail.mode;
        const coords = detail.coords;
        if (!mode || !coords) return;
        if (!isochroneSettings[mode]) return;
        setActiveIsochroneMode(mode);
        updateIsochrone(coords, mode);
    });

    window.addEventListener('reach-reset', (event) => {
        const detail = event?.detail || {};
        const mode = detail.mode;
        if (!mode) return;
        if (activeIsochroneMode !== mode) return;
        resetIsochroneUI();
    });

    map.on('click', async (e) => {
        if (!activeIsochroneMode) return;
        updateIsochrone(e.lngLat, activeIsochroneMode);
    });

    initLayerToggles(map, overlayState.current);
    initDraggableItems(map);
    initDrawEraser(map, draw);

    survey = initSurvey({
        map,
        setupConfig,
        fallbackConfig,
        loadAndRenderLayer,
        draw,
        overlayState
    });

    initReactions({ map });

    if (map.isStyleLoaded()) {
        survey.onStyleLoad();
    }

}

initApp();
