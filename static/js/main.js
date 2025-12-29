import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { initDraggableItems, initLayerToggles, getMapCoordsFromScreen, applyTagConfigVisibility } from './ui.js';
import { initSurvey } from './survey.js';
import { initTagTracking } from './tag-tracking.js';
import { fallbackConfig, loadSetupConfig } from './config-loader.js';
import { initMap } from './map-setup.js';

async function initApp() {
    const setupConfig = await loadSetupConfig();

    if (setupConfig.project.rearProjection) {
        document.body.style.transform = 'scaleX(-1)';
    }

    if (setupConfig.project.tuiMode) {
        document.body.classList.add('tui-mode');
    }

    applyTagConfigVisibility(setupConfig);

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
        if (!client) return e;
        const coords = getMapCoordsFromScreen(map, client.x, client.y);
        if (!coords) return e;
        e.lngLat = coords;
        e.point = map.project(coords);
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
                    return mode[handler].call(this, state, adjustDrawEvent(e));
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

    let activeIsochroneMode = null; // 'walk' or 'bike'

    function resetIsochroneUI() {
        if (btnWalk) btnWalk.classList.remove('active');
        if (btnBike) btnBike.classList.remove('active');
        activeIsochroneMode = null;
        if (map.getSource('isochrone')) {
            map.setLayoutProperty('isochrone-fill', 'visibility', 'none');
            map.setLayoutProperty('isochrone-line', 'visibility', 'none');
        }
    }

    if (btnWalk) {
        btnWalk.addEventListener('click', () => {
            const wasActive = btnWalk.classList.contains('active');
            resetIsochroneUI();
            if (!wasActive) {
                btnWalk.classList.add('active');
                activeIsochroneMode = 'walk';
            }
        });
    }

    if (btnBike) {
        btnBike.addEventListener('click', () => {
            const wasActive = btnBike.classList.contains('active');
            resetIsochroneUI();
            if (!wasActive) {
                btnBike.classList.add('active');
                activeIsochroneMode = 'bike';
            }
        });
    }

    map.on('click', async (e) => {
        if (!activeIsochroneMode) return;

        const center = e.lngLat;
        // Walk: ~1.2km (4-5km/h), Bike: ~3.75km (15km/h)
        const distance = activeIsochroneMode === 'walk' ? 1200 : 3750;
        const color = activeIsochroneMode === 'walk' ? '#5b94c6' : '#9b59b6';

        try {
            map.getCanvas().style.cursor = 'wait';

            const response = await fetch('/api/isochrone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: center.lat,
                    lon: center.lng,
                    distance: distance,
                    mode: activeIsochroneMode
                })
            });

            map.getCanvas().style.cursor = '';

            if (!response.ok) return;

            const geojson = await response.json();

            if (map.getSource('isochrone')) {
                map.getSource('isochrone').setData(geojson);
                map.setPaintProperty('isochrone-fill', 'fill-color', color);
                map.setPaintProperty('isochrone-line', 'line-color', color);
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
                        'fill-color': color,
                        'fill-opacity': 0.3
                    }
                });

                map.addLayer({
                    id: 'isochrone-line',
                    type: 'line',
                    source: 'isochrone',
                    layout: {},
                    paint: {
                        'line-color': color,
                        'line-width': 2
                    }
                });
            }
        } catch (err) {
            console.error("Isochrone error:", err);
            map.getCanvas().style.cursor = '';
        }
    });

    initLayerToggles(map, overlayState.current);
    initDraggableItems(map);

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
