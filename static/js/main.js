import { CONFIG } from './config.js';
import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { initDraggableItems, initDraggableStickers } from './ui.js';

const fallbackOverlays = ['palaiseau-roads', 'walking-network', 'mobility-infrastructure', 'bus-lanes', 'amenities', 'telecom-floorplan'];

const fallbackConfig = {
    project: {
        id: 'default-project',
        name: 'Default',
        location: 'Palaiseau',
        mapId: 'palaiseau-outdoor'
    },
    maps: [
        {
            id: 'palaiseau-outdoor',
            label: 'IP Paris Campus',
            style: CONFIG.style,
            center: CONFIG.center,
            zoom: CONFIG.zoom,
            pitch: CONFIG.pitch,
            bearing: CONFIG.bearing,
            overlays: fallbackOverlays
        }
    ],
    overlays: fallbackOverlays.map(id => ({ id })),
    questionFlow: [
        {
            id: 'default',
            title: 'Default',
            order: 1,
            questions: [
                { id: 'travel-mode', text: 'How do you typically travel to campus?', type: 'single-choice', options: ['Walk', 'Bike', 'Bus', 'Car', 'Other'], required: false, storageKey: 'travel_mode', responseShape: 'scalar' },
                { id: 'bike-lanes', text: 'Where do you suggest to add more bike lanes?', type: 'sticker', options: [], required: false, storageKey: 'bike_lanes', responseShape: 'point-collection' },
                { id: 'confused', text: 'In Which points do you get confused?', type: 'sticker', options: [], required: false, storageKey: 'confused_points', responseShape: 'point-collection' }
            ]
        }
    ]
};

function normalizeConfig(raw) {
    const project = raw?.project || fallbackConfig.project;
    let selectedMap = raw?.map;

    if (!selectedMap && raw?.maps?.length) {
        selectedMap = raw.maps.find(m => m.id === project.mapId) || raw.maps[0];
    }
    if (!selectedMap) selectedMap = fallbackConfig.maps[0];

    const derivedQuestionFlow = () => {
        if (raw?.questionFlow) return raw.questionFlow;
        if (raw?.questions) return raw.questions; // Support flat questions
        if (raw?.questionGroups) {
            return raw.questionGroups.map(group => ({
                id: group.id,
                title: group.title,
                description: group.description,
                order: group.order,
                questions: group.questions || []
            }));
        }
        return null;
    };

    const questionFlow = derivedQuestionFlow() || fallbackConfig.questionFlow;

    return {
        project,
        maps: raw?.maps || fallbackConfig.maps,
        map: {
            style: selectedMap.style || fallbackConfig.maps[0].style,
            center: selectedMap.center || fallbackConfig.maps[0].center,
            zoom: selectedMap.zoom ?? fallbackConfig.maps[0].zoom,
            pitch: selectedMap.pitch ?? fallbackConfig.maps[0].pitch,
            bearing: selectedMap.bearing ?? fallbackConfig.maps[0].bearing,
            overlays: (selectedMap.overlays !== undefined) ? selectedMap.overlays : fallbackOverlays
        },
        overlays: raw?.overlays || fallbackConfig.overlays,
        questionFlow
    };
}

function getQueryProjectId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('project');
}

async function fetchServerConfig(projectId) {
    try {
        const url = projectId ? `/api/config?project=${encodeURIComponent(projectId)}` : '/api/config';
        const response = await fetch(url);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.warn('No server config found', error);
    }
    return null;
}

async function loadSetupConfig() {
    const projectId = getQueryProjectId();
    const serverConfig = await fetchServerConfig(projectId);
    if (serverConfig) return normalizeConfig(serverConfig);
    return normalizeConfig(fallbackConfig);
}

function flattenQuestions(flow) {
    if (!flow || !Array.isArray(flow) || flow.length === 0) return [];

    // Check if the first item looks like a group (has 'questions' array)
    // If not, assume it is already a flat list of questions
    const isGrouped = flow[0].questions && Array.isArray(flow[0].questions);

    if (!isGrouped) {
        return flow;
    }

    const sortedGroups = [...(flow || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const list = [];
    sortedGroups.forEach(group => {
        (group.questions || []).forEach(q => {
            list.push({ ...q, groupId: group.id, groupTitle: group.title });
        });
    });
    
    // Sort flat list by order if present
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    return list;
}

function setActiveStyleButton(styleUrl, styles) {
    Object.keys(styles).forEach(key => {
        const btn = document.getElementById(key);
        if (btn) {
            btn.classList.toggle('active', styles[key] === styleUrl);
        }
    });
}

async function initApp() {
    const setupConfig = await loadSetupConfig();

    mapboxgl.accessToken = CONFIG.accessToken;

    const map = new mapboxgl.Map({
        container: 'map',
        style: setupConfig.map.style,
        center: setupConfig.map.center,
        zoom: setupConfig.map.zoom,
        pitch: setupConfig.map.pitch,
        bearing: setupConfig.map.bearing,
        attributionControl: false
    });

    let currentActiveOverlayIds = new Set(setupConfig.map.overlays || []);

    map.on('style.load', () => {
        console.log("Style loaded event fired!");
        
        add3DBuildings(map);

        if (setupConfig.overlays) {
            setupConfig.overlays.forEach(layer => {
                const isVisible = currentActiveOverlayIds.has(layer.id);
                loadAndRenderLayer(map, layer, isVisible);
            });
        }

        renderDots();
        updateQuestion();
    });

    const styles = {
        'btn-light': 'mapbox://styles/mapbox/light-v11',
        'btn-dark': 'mapbox://styles/mapbox/dark-v11',
        'btn-streets': 'mapbox://styles/mapbox/streets-v12',
        'btn-satellite': 'mapbox://styles/mapbox/satellite-streets-v12'
    };

    Object.keys(styles).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                map.setStyle(styles[id]);
                setActiveStyleButton(styles[id], styles);
                btn.blur();
            });
        }
    });
    setActiveStyleButton(setupConfig.map.style, styles);

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
    document.getElementById('main_container').appendChild(debugDot);

    async function checkPosition() {
        try {
            const response = await fetch('http://localhost:5000/api/position');
            if (!response.ok) return; 

            const data = await response.json();

            if (data.valid) {
                const clampedX = Math.max(0, Math.min(1, data.x));
                const clampedY = Math.max(0, Math.min(1, data.y));

                debugDot.style.left = `${clampedX * 100}%`;
                debugDot.style.top = `${clampedY * 100}%`;
                debugDot.style.display = 'block';

                if (data.id === 5) {
                    const dotRect = debugDot.getBoundingClientRect();
                    const element = document.elementFromPoint(
                        dotRect.left + dotRect.width / 2, 
                        dotRect.top + dotRect.height / 2
                    );

                    if (element) {
                        const button = element.closest('button');
                        if (button && styles[button.id] && !button.classList.contains('active')) {
                            button.click();
                        }
                    }
                }
            } else {
                debugDot.style.display = 'none';
            }
        } catch (error) {
        }
    }

    setInterval(checkPosition, 100);
    initDraggableItems(map);
    initDraggableStickers(map);

    const draw = new MapboxDraw({
        displayControlsDefault: false
    });
    map.addControl(draw);

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

    let questions = flattenQuestions(setupConfig.questionFlow);
    if (!questions.length) {
        questions = flattenQuestions(fallbackConfig.questionFlow);
    }
    let currentQuestionIndex = 0;

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const questionText = document.querySelector('.question-text');
    const questionOptions = document.getElementById('question-options');
    const dotsContainer = document.querySelector('.progress-dots');
    let dots = [];

    function renderDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        questions.forEach((q, index) => {
            const dot = document.createElement('span');
            dot.className = 'dot w-2.5 h-2.5 flex-none rounded-full bg-white/30 transition-all duration-300 cursor-pointer hover:bg-white/50 hover:scale-110 [&.active]:bg-gradient-to-br [&.active]:from-[#667eea] [&.active]:to-[#764ba2] [&.active]:scale-125 [&.active]:shadow-sm';
            dot.title = q.text;
            dot.addEventListener('click', () => {
                currentQuestionIndex = index;
                updateQuestion();
            });
            dotsContainer.appendChild(dot);
        });
        dots = dotsContainer.querySelectorAll('.dot');
    }

    function renderQuestionOptions(question) {
        if (!questionOptions) return;
        const options = Array.isArray(question?.options) ? question.options : [];
        const shouldShow = options.length > 0 && ['single-choice', 'multi-choice'].includes(question?.type);
        if (!shouldShow) {
            questionOptions.innerHTML = '';
            questionOptions.classList.add('hidden');
            return;
        }

        questionOptions.classList.remove('hidden');
        questionOptions.innerHTML = '';
        options.forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'question-option w-full text-left px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white/85 text-xs font-medium tracking-wide transition-all duration-200 hover:bg-white/10 hover:border-white/25';
            button.textContent = option;
            questionOptions.appendChild(button);
        });
    }

    function updateQuestion() {
        if (!questions.length) {
            questionText.textContent = 'No questions configured';
            if (questionOptions) {
                questionOptions.innerHTML = '';
                questionOptions.classList.add('hidden');
            }
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        const q = questions[currentQuestionIndex];
        questionText.textContent = q.text;
        renderQuestionOptions(q);

        // Map switching logic
        if (q.mapId && setupConfig.maps) {
            const mapConfig = setupConfig.maps.find(m => m.id === q.mapId);
            if (mapConfig) {
                // Update active overlays
                currentActiveOverlayIds = new Set(mapConfig.overlays || []);

                // Update visibility of existing layers
                if (setupConfig.overlays) {
                    setupConfig.overlays.forEach(layer => {
                        const isVisible = currentActiveOverlayIds.has(layer.id);
                        loadAndRenderLayer(map, layer, isVisible);
                    });
                }

                // Fly to new view
                map.flyTo({
                    center: mapConfig.center,
                    zoom: mapConfig.zoom,
                    pitch: mapConfig.pitch,
                    bearing: mapConfig.bearing
                });
            }
        }

        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentQuestionIndex);
        });

        prevBtn.disabled = currentQuestionIndex === 0;
        nextBtn.disabled = currentQuestionIndex === questions.length - 1;
    }

    prevBtn.addEventListener('click', () => {
        if (!questions.length) return;
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
            updateQuestion();
        }
    });

    nextBtn.addEventListener('click', async () => {
        if (!questions.length) return;
        const stickers = document.querySelectorAll('.draggable-sticker');
        const question = questions[currentQuestionIndex];
        if (stickers.length > 0) {
            const features = Array.from(stickers).map(sticker => {
                const rect = sticker.getBoundingClientRect();
                const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                const coords = map.unproject(center);
                
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [coords.lng, coords.lat]
                    },
                    properties: {
                        id: sticker.dataset.typeId,
                        color: sticker.dataset.color,
                        questionId: question.id,
                        storageKey: question.storageKey || question.id,
                        questionIndex: currentQuestionIndex,
                        questionText: question.text,
                        groupId: question.groupId,
                        projectId: setupConfig.project.id,
                        timestamp: new Date().toISOString()
                    }
                };
            });

            const geojson = {
                type: 'FeatureCollection',
                features: features
            };

            const filename = `${setupConfig.project.id || 'project'}_${question.storageKey || question.id}_q${currentQuestionIndex}_${new Date().toISOString().replace(/[:.]/g, '-')}.geojson`;
            
            try {
                const response = await fetch('/api/save_geojson', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        geojson: geojson,
                        filename: filename,
                        projectId: setupConfig.project.id
                    })
                });

                if (!response.ok) {
                    console.error('Failed to save GeoJSON to server');
                }
            } catch (error) {
                console.error('Error saving GeoJSON to server:', error);
            }
        }

        if (currentQuestionIndex < questions.length - 1) {
            currentQuestionIndex++;
            updateQuestion();
        }
    });
}

initApp();
