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
            label: 'Palaiseau outdoor',
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
                { id: 'travel-mode', text: 'How do you typically travel to campus?', type: 'single-choice', options: [], required: false, storageKey: 'travel_mode', responseShape: 'scalar' },
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
    const sortedGroups = [...(flow || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const list = [];
    sortedGroups.forEach(group => {
        (group.questions || []).forEach(q => {
            list.push({ ...q, groupId: group.id, groupTitle: group.title });
        });
    });
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
        displayControlsDefault: true,
        controls: {
            point: true,
            line_string: true,
            polygon: true,
            trash: true
        }
    });

    const drawBtn = document.getElementById('btn-draw');
    if (drawBtn) {
        drawBtn.addEventListener('click', () => {
            drawBtn.classList.toggle('active');
            if (drawBtn.classList.contains('active')) {
                map.addControl(draw, 'top-left');
            } else {
                map.removeControl(draw);
            }
        });
    }

    const isochroneBtn = document.getElementById('btn-isochrone');
    if (isochroneBtn) {
        isochroneBtn.addEventListener('click', () => {
            isochroneBtn.classList.toggle('active');
        });
    }

    let questions = flattenQuestions(setupConfig.questionFlow);
    if (!questions.length) {
        questions = flattenQuestions(fallbackConfig.questionFlow);
    }
    let currentQuestionIndex = 0;

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const questionText = document.querySelector('.question-text');
    const dotsContainer = document.querySelector('.progress-dots');
    let dots = [];

    function renderDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        questions.forEach((q, index) => {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = q.text;
            dot.addEventListener('click', () => {
                currentQuestionIndex = index;
                updateQuestion();
            });
            dotsContainer.appendChild(dot);
        });
        dots = dotsContainer.querySelectorAll('.dot');
    }

    function updateQuestion() {
        if (!questions.length) {
            questionText.textContent = 'No questions configured';
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        const q = questions[currentQuestionIndex];
        questionText.textContent = q.text;

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
