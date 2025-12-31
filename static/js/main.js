import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { initDraggableItems, initLayerToggles, getMapCoordsFromScreen, applyTagConfigVisibility, initReachDraggables, initDrawEraser } from './ui.js';
import { initSurvey } from './survey.js';
import { initTagTracking } from './tag-tracking.js';
import { fallbackConfig, loadSetupConfig } from './config-loader.js';
import { initMap } from './map-setup.js';

function applyStickerConfig(setupConfig) {
    const config = setupConfig?.project?.stickerConfig;
    if (!config) return;
    const colors = Array.isArray(config.colors) ? config.colors : [];
    const rawCount = Number.isInteger(config.count) ? config.count : colors.length;
    const count = Math.max(0, rawCount);

    const buttons = Array.from(document.querySelectorAll('.point-btn'));
    buttons.forEach((btn, index) => {
        if (index < count) {
            const color = colors[index] || btn.dataset.color || '#ffffff';
            btn.style.display = '';
            btn.dataset.color = color;
            btn.style.backgroundColor = color;
        } else {
            btn.style.display = 'none';
        }
    });
}

async function initApp() {
    const setupConfig = await loadSetupConfig();

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

    applyTagConfigVisibility(setupConfig);
    applyStickerConfig(setupConfig);

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
            if (survey) {
                survey.onStyleLoad();
            }
        }
    });

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

    const drawModes = buildDrawModes();
    const draw = new MapboxDraw({
        displayControlsDefault: false,
        ...(drawModes ? { modes: drawModes } : {})
    });
    map.addControl(draw);

    initTagTracking({ map, setupConfig, draw });

    const drawBtn = document.getElementById('btn-draw');
    const surfaceBtn = document.getElementById('btn-surface');

    function setDrawMode(targetMode) {
        const mode = draw.getMode();
        if (mode !== targetMode) {
            draw.changeMode(targetMode);
        } else {
            draw.changeMode('simple_select');
        }
    }

    function syncDrawButtons(mode) {
        if (drawBtn) drawBtn.classList.toggle('active', mode === 'draw_line_string');
        if (surfaceBtn) surfaceBtn.classList.toggle('active', mode === 'draw_polygon');
    }

    if (drawBtn) {
        drawBtn.addEventListener('click', () => {
            setDrawMode('draw_line_string');
        });
    }

    if (surfaceBtn) {
        surfaceBtn.addEventListener('click', () => {
            setDrawMode('draw_polygon');
        });
    }

    map.on('draw.modechange', (e) => {
        console.log('Draw mode changed to:', e.mode);
        syncDrawButtons(e.mode);
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

    if (map.isStyleLoaded()) {
        survey.onStyleLoad();
    }

}

initApp();
