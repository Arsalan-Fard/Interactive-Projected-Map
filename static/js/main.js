import { CONFIG } from './config.js';
import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { initDraggableItems, initDraggableStickers, initLayerToggles } from './ui.js';

const fallbackOverlays = ['palaiseau-roads', 'walking-network', 'mobility-infrastructure', 'bus-lanes', 'amenities', 'telecom-floorplan'];

const fallbackConfig = {
    project: {
        id: 'default-project',
        name: 'Default',
        location: 'Palaiseau',
        mapId: 'palaiseau-outdoor',
        rearProjection: false
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

    if (setupConfig.project.rearProjection) {
        document.body.style.transform = 'scaleX(-1)';
    }

    if (setupConfig.project.tuiMode) {
        document.body.classList.add('tui-mode');
    }

    mapboxgl.accessToken = CONFIG.accessToken;

    const map = new mapboxgl.Map({
        container: 'map',
        style: setupConfig.map.style,
        center: setupConfig.map.center,
        zoom: setupConfig.map.zoom,
        pitch: setupConfig.map.pitch,
        bearing: setupConfig.map.bearing,
        attributionControl: false,
        trackResize: false
    });

    let currentActiveOverlayIds = new Set(setupConfig.map.overlays || []);

    map.on('style.load', () => {

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
        document.body.appendChild(debugDot);
    
            // Create SVG overlay for debug lines
            const debugSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            Object.assign(debugSvg.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '9998', // Below dot, above map
                pointerEvents: 'none',
                overflow: 'visible'
            });
            document.body.appendChild(debugSvg);
        
            // Create Black Hole Mask for tracked tag
            const blackHole = document.createElement('div');
            Object.assign(blackHole.style, {
                position: 'absolute',
                width: '60px', // Slightly larger than the tag to ensure coverage
                height: '60px',
                backgroundColor: 'black',
                borderRadius: '50%',
                zIndex: '9997', // Below debug lines, above map
                pointerEvents: 'none',
                transform: 'translate(-50%, -50%)',
                display: 'none',
                left: '0%',
                top: '0%'
            });
            document.body.appendChild(blackHole);
        
            const debugLines = [1, 2, 3, 4].map(i => {            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("stroke", "blue");
            line.setAttribute("stroke-width", "2");
            line.setAttribute("opacity", "0.5");
            line.style.display = 'none';
            debugSvg.appendChild(line);
            return line;
        });
    
        async function checkPosition() {
    
    
            try {
    
                const response = await fetch('http://localhost:5000/api/position');
    
                if (!response.ok) {
                    return; 
                }
    
                const data = await response.json();
    
                const debugIds = document.getElementById('debug-ids');
                if (debugIds) {
                    const idsList = data.detected_ids ? data.detected_ids.join(', ') : '-';
                    debugIds.textContent = `IDs: ${idsList}`;
                }
    
                if (data.valid) {
                    let screenX, screenY;
    
                    // Try to get Maptastic coordinates
                    let corners = null;
                                    if (window.maptastic) {
                                        const layout = window.maptastic.getLayout();
                                        const layer = layout.find(l => l.id === 'main_container');
                                        if (layer && layer.targetPoints) {
                                            corners = layer.targetPoints; // [ [x,y], [x,y], [x,y], [x,y] ] (TL, TR, BR, BL)
                                        }
                                    }
                    
                if (data.valid && corners) {
                    // Use Backend Normalized Coordinates (0.0 - 1.0)
                    const u = data.x;
                    const v = data.y;

                    // Maptastic Corners: 0:TL, 1:TR, 2:BR, 3:BL
                    const x0 = corners[0][0], y0 = corners[0][1];
                    const x1 = corners[1][0], y1 = corners[1][1];
                    const x2 = corners[2][0], y2 = corners[2][1];
                    const x3 = corners[3][0], y3 = corners[3][1];

                    // Perspective Transform (Homography) from Unit Square
                    // Maps (0,0)->(x0,y0), (1,0)->(x1,y1), (1,1)->(x2,y2), (0,1)->(x3,y3)
                    
                    let projX, projY;
                    
                    const dx3 = x0 - x1 + x2 - x3;
                    const dy3 = y0 - y1 + y2 - y3;

                    if (Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6) {
                        // Affine (Parallelogram)
                        projX = x0 + (x1 - x0) * u + (x3 - x0) * v;
                        projY = y0 + (y1 - y0) * u + (y3 - y0) * v;
                    } else {
                        // Projective (Trapezoid/General Quad)
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
                    
                    screenX = projX;
                    screenY = projY;

                    // Update debug lines
                    const cornerList = [corners[0], corners[1], corners[2], corners[3]];
                    cornerList.forEach((corner, index) => {
                        const line = debugLines[index];
                        line.setAttribute("x1", screenX);
                        line.setAttribute("y1", screenY);
                        line.setAttribute("x2", corner[0]);
                        line.setAttribute("y2", corner[1]);
                        line.style.display = 'block';
                    });

                } else if (data.valid && !corners) {

                                        // Fallback if Maptastic isn't ready or found
                                        screenX = data.x * window.innerWidth;
                                        screenY = data.y * window.innerHeight;
                                        debugLines.forEach(l => l.style.display = 'none');
                                    } else {
                                        debugLines.forEach(l => l.style.display = 'none');
                                    }
                    
                                                    if (data.valid) {
                                                        debugDot.style.left = `${screenX}px`;
                                                        debugDot.style.top = `${screenY}px`;
                                                        debugDot.style.display = 'block';
                                    
                                                        // Update Black Hole Mask
                                                        // Only show if we are tracking a movable tag (5 or 6)
                                                        if (data.id === 5 || data.id === 6) {
                                                            blackHole.style.left = `${screenX}px`;
                                                            blackHole.style.top = `${screenY}px`;
                                                            blackHole.style.display = 'block';
                                                        } else {
                                                            blackHole.style.display = 'none';
                                                        }
                                                    } else {
                                                        debugDot.style.display = 'none';
                                                        blackHole.style.display = 'none';
                                                    }
                                    
                                                    if (data.valid && data.id === 5) {                    const element = document.elementFromPoint(screenX, screenY);

                    // --- MAP STYLES QUADRANT LOGIC ---
                    const mapStylesSection = document.querySelector('#left-sidebar .toolbar-section:first-child .section-content');
                    const sidebar = document.getElementById('left-sidebar');
                    
                    if (mapStylesSection && sidebar) {
                        const styleRect = mapStylesSection.getBoundingClientRect();
                        const sidebarRect = sidebar.getBoundingClientRect();
                        
                        // Relaxed bounds: 
                        // Horizontal: Must be within sidebar width (plus small margin)
                        // Vertical: Must be above the bottom of the Map Styles content (plus small margin)
                        // This allows being "outside" individual buttons but prevents conflict with sections below.
                        const margin = 20;
                        
                        const inHorz = screenX >= (sidebarRect.left - margin) && screenX <= (sidebarRect.right + margin);
                        const inVert = screenY <= (styleRect.bottom + margin); // Open top, bounded bottom
                        
                        if (inHorz && inVert) {
                            const centerX = styleRect.left + styleRect.width / 2;
                            const centerY = styleRect.top + styleRect.height / 2;
                            
                            let targetBtnId = null;
                            
                            if (screenY < centerY) {
                                // Top Row
                                if (screenX < centerX) targetBtnId = 'btn-light';     // Top-Left
                                else targetBtnId = 'btn-dark';                       // Top-Right
                            } else {
                                // Bottom Row
                                if (screenX < centerX) targetBtnId = 'btn-streets';   // Bottom-Left
                                else targetBtnId = 'btn-satellite';                  // Bottom-Right
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

                        if (button) {
                            if (layerButtons.includes(button.id)) {
                                const btnRect = button.getBoundingClientRect();
                                const isRightHalf = screenX > (btnRect.left + btnRect.width / 2);
                                const isActive = button.classList.contains('active');

                                if (isRightHalf && !isActive) {
                                    button.click(); // Activate
                                } else if (!isRightHalf && isActive) {
                                    button.click(); // Deactivate
                                }
                            } 
                        }
                    }
                }
                } else {
                    debugDot.style.display = 'none';
                }
            } catch (error) {
                console.error("CheckPosition error:", error);
            }
        }

    setInterval(checkPosition, 100);
    initLayerToggles(map);
    initDraggableItems(map);

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
    const responseState = new Map();

    initDraggableStickers(map, () => questions[currentQuestionIndex]?.id);

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const finishBtn = document.getElementById('finish-btn');
    const questionText = document.querySelector('.question-text');
    const questionOptions = document.getElementById('question-options');
    const dotsContainer = document.querySelector('.progress-dots');
    const previousAnswersBtn = document.getElementById('btn-previous-answers');
    const previousAnswersPanel = document.getElementById('previous-answers-panel');
    const previousAnswersSummary = document.getElementById('previous-answers-summary');
    const previousAnswersList = document.getElementById('previous-answers-list');
    let dots = [];
    let previousResponses = [];
    let previousResponsesLoaded = false;
    let showPreviousAnswers = false;

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

    function toggleChoiceAnswer(question, option) {
        if (question.type === 'multi-choice') {
            const current = responseState.get(question.id);
            const next = new Set(Array.isArray(current) ? current : []);
            if (next.has(option)) {
                next.delete(option);
            } else {
                next.add(option);
            }
            responseState.set(question.id, Array.from(next));
        } else {
            responseState.set(question.id, option);
        }
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
            const stored = responseState.get(question.id);
            const isSelected = question.type === 'multi-choice'
                ? Array.isArray(stored) && stored.includes(option)
                : stored === option;
            button.className = `question-option w-full text-left px-3 py-2 rounded-md border text-xs font-medium tracking-wide transition-all duration-200 ${isSelected ? 'bg-white/15 border-white/40 text-white' : 'bg-white/5 border-white/10 text-white/85 hover:bg-white/10 hover:border-white/25'}`;
            button.textContent = option;
            button.addEventListener('click', () => {
                toggleChoiceAnswer(question, option);
                renderQuestionOptions(question);
            });
            questionOptions.appendChild(button);
        });
    }

    function formatSavedAt(value) {
        if (!value) return 'Unknown time';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString();
    }

    async function fetchPreviousResponses() {
        const projectId = setupConfig.project.id;
        if (!projectId) return [];
        try {
            const response = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}`);
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.responses) ? data.responses : [];
        } catch (error) {
            console.error('Error loading previous responses:', error);
            return [];
        }
    }

    function getPreviousAnswersForQuestion(questionId) {
        return previousResponses
            .map(response => {
                const answer = Array.isArray(response.answers)
                    ? response.answers.find(item => item.questionId === questionId)
                    : null;
                if (!answer || answer.answer == null) return null;
                return { response, answer };
            })
            .filter(Boolean);
    }

    function renderPreviousAnswers(question) {
        if (!previousAnswersPanel || !previousAnswersList || !previousAnswersSummary) return;
        if (!showPreviousAnswers) {
            previousAnswersPanel.classList.add('hidden');
            return;
        }

        previousAnswersPanel.classList.remove('hidden');
        previousAnswersList.innerHTML = '';

        const entries = getPreviousAnswersForQuestion(question.id);
        previousAnswersSummary.textContent = entries.length ? `Responses: ${entries.length}` : 'No previous answers yet';

        if (!entries.length) return;

        if (['single-choice', 'multi-choice'].includes(question.type)) {
            const counts = new Map();
            entries.forEach(({ answer }) => {
                const value = answer.answer;
                if (question.type === 'multi-choice') {
                    if (Array.isArray(value)) {
                        value.forEach(option => {
                            counts.set(option, (counts.get(option) || 0) + 1);
                        });
                    }
                } else if (typeof value === 'string') {
                    counts.set(value, (counts.get(value) || 0) + 1);
                }
            });

            if (!counts.size) {
                const item = document.createElement('div');
                item.className = 'text-white/70';
                item.textContent = 'No saved choices.';
                previousAnswersList.appendChild(item);
                return;
            }

            Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .forEach(([option, count]) => {
                    const item = document.createElement('div');
                    item.className = 'flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1';
                    item.innerHTML = `<span>${option}</span><span class="text-white/70">${count}</span>`;
                    previousAnswersList.appendChild(item);
                });
            return;
        }

        if (question.type === 'sticker' || question.type === 'drawing') {
            entries.forEach(({ response, answer }) => {
                const features = answer.answer?.features;
                const count = Array.isArray(features) ? features.length : 0;
                const item = document.createElement('div');
                item.className = 'rounded border border-white/10 bg-white/5 px-2 py-1';
                item.textContent = `${formatSavedAt(response.savedAt)} • ${count} item${count === 1 ? '' : 's'}`;
                previousAnswersList.appendChild(item);
            });
            return;
        }

        entries.forEach(({ response, answer }) => {
            const item = document.createElement('div');
            item.className = 'rounded border border-white/10 bg-white/5 px-2 py-1';
            item.textContent = `${formatSavedAt(response.savedAt)} • ${String(answer.answer)}`;
            previousAnswersList.appendChild(item);
        });
    }

    const previousLayerIds = {
        pointsSource: 'previous-answers-points',
        pointsLayer: 'previous-answers-points-layer',
        linesSource: 'previous-answers-lines',
        linesLayer: 'previous-answers-lines-layer',
        polygonsSource: 'previous-answers-polygons',
        polygonsFill: 'previous-answers-polygons-fill',
        polygonsOutline: 'previous-answers-polygons-outline'
    };

    function removeLayerIfExists(id) {
        if (map.getLayer(id)) {
            map.removeLayer(id);
        }
    }

    function removeSourceIfExists(id) {
        if (map.getSource(id)) {
            map.removeSource(id);
        }
    }

    function clearPreviousAnswerLayers() {
        removeLayerIfExists(previousLayerIds.pointsLayer);
        removeLayerIfExists(previousLayerIds.linesLayer);
        removeLayerIfExists(previousLayerIds.polygonsOutline);
        removeLayerIfExists(previousLayerIds.polygonsFill);
        removeSourceIfExists(previousLayerIds.pointsSource);
        removeSourceIfExists(previousLayerIds.linesSource);
        removeSourceIfExists(previousLayerIds.polygonsSource);
    }

    function ensurePreviousAnswerLayers(pointData, lineData, polygonData) {
        if (!map.getSource(previousLayerIds.pointsSource)) {
            map.addSource(previousLayerIds.pointsSource, { type: 'geojson', data: pointData });
            map.addLayer({
                id: previousLayerIds.pointsLayer,
                type: 'circle',
                source: previousLayerIds.pointsSource,
                paint: {
                    'circle-radius': 5,
                    'circle-color': ['coalesce', ['get', 'color'], '#9aa5b1'],
                    'circle-opacity': 0.6,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1
                }
            });
        } else {
            map.getSource(previousLayerIds.pointsSource).setData(pointData);
        }

        if (!map.getSource(previousLayerIds.linesSource)) {
            map.addSource(previousLayerIds.linesSource, { type: 'geojson', data: lineData });
            map.addLayer({
                id: previousLayerIds.linesLayer,
                type: 'line',
                source: previousLayerIds.linesSource,
                paint: {
                    'line-color': '#f5d76e',
                    'line-width': 2,
                    'line-opacity': 0.6,
                    'line-dasharray': [1.5, 1.5]
                }
            });
        } else {
            map.getSource(previousLayerIds.linesSource).setData(lineData);
        }

        if (!map.getSource(previousLayerIds.polygonsSource)) {
            map.addSource(previousLayerIds.polygonsSource, { type: 'geojson', data: polygonData });
            map.addLayer({
                id: previousLayerIds.polygonsFill,
                type: 'fill',
                source: previousLayerIds.polygonsSource,
                paint: {
                    'fill-color': '#f5d76e',
                    'fill-opacity': 0.15
                }
            });
            map.addLayer({
                id: previousLayerIds.polygonsOutline,
                type: 'line',
                source: previousLayerIds.polygonsSource,
                paint: {
                    'line-color': '#f5d76e',
                    'line-width': 2,
                    'line-opacity': 0.5
                }
            });
        } else {
            map.getSource(previousLayerIds.polygonsSource).setData(polygonData);
        }
    }

    function renderPreviousAnswersOnMap(question) {
        if (!showPreviousAnswers) {
            clearPreviousAnswerLayers();
            return;
        }
        if (!map.isStyleLoaded()) return;

        const entries = getPreviousAnswersForQuestion(question.id);
        const pointFeatures = [];
        const lineFeatures = [];
        const polygonFeatures = [];

        entries.forEach(({ answer }) => {
            const features = answer.answer?.features;
            if (!Array.isArray(features)) return;
            features.forEach(feature => {
                const geomType = feature?.geometry?.type;
                if (!geomType) return;
                if (geomType === 'Point' || geomType === 'MultiPoint') {
                    pointFeatures.push(feature);
                } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
                    lineFeatures.push(feature);
                } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
                    polygonFeatures.push(feature);
                }
            });
        });

        ensurePreviousAnswerLayers(
            { type: 'FeatureCollection', features: pointFeatures },
            { type: 'FeatureCollection', features: lineFeatures },
            { type: 'FeatureCollection', features: polygonFeatures }
        );
    }

    async function togglePreviousAnswers() {
        showPreviousAnswers = !showPreviousAnswers;
        if (previousAnswersBtn) {
            previousAnswersBtn.classList.toggle('active', showPreviousAnswers);
            previousAnswersBtn.setAttribute('aria-pressed', showPreviousAnswers ? 'true' : 'false');
            previousAnswersBtn.textContent = showPreviousAnswers ? 'Hide Previous Answers' : 'Show Previous Answers';
        }

        if (showPreviousAnswers && !previousResponsesLoaded) {
            if (previousAnswersBtn) previousAnswersBtn.disabled = true;
            previousResponses = await fetchPreviousResponses();
            previousResponsesLoaded = true;
            if (previousAnswersBtn) previousAnswersBtn.disabled = false;
        }

        if (questions.length) {
            renderPreviousAnswers(questions[currentQuestionIndex]);
            renderPreviousAnswersOnMap(questions[currentQuestionIndex]);
        } else {
            renderPreviousAnswers({ id: null, type: null });
            clearPreviousAnswerLayers();
        }
    }
    function getStickersForQuestion(questionId) {
        const stickers = Array.from(document.querySelectorAll('.draggable-sticker'));
        if (!stickers.length) return [];
        const matching = questionId ? stickers.filter(sticker => sticker.dataset.questionId === questionId) : [];
        return matching.length ? matching : stickers;
    }

    function getStickerCoords(sticker) {
        const lng = parseFloat(sticker.dataset.lng);
        const lat = parseFloat(sticker.dataset.lat);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            return [lng, lat];
        }

        const rect = sticker.getBoundingClientRect();
        const mapRect = map.getContainer().getBoundingClientRect();
        const center = [rect.left + rect.width / 2 - mapRect.left, rect.top + rect.height / 2 - mapRect.top];
        const coords = map.unproject(center);
        return [coords.lng, coords.lat];
    }

    function buildStickerFeatures(question, questionIndex) {
        const stickers = getStickersForQuestion(question.id);
        if (!stickers.length) return [];
        return stickers.map(sticker => {
            const [lng, lat] = getStickerCoords(sticker);
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                },
                properties: {
                    id: sticker.dataset.typeId,
                    color: sticker.dataset.color,
                    questionId: question.id,
                    storageKey: question.storageKey || question.id,
                    questionIndex: questionIndex,
                    questionText: question.text,
                    groupId: question.groupId,
                    projectId: setupConfig.project.id,
                    timestamp: new Date().toISOString()
                }
            };
        });
    }

    function buildResponsesPayload() {
        return {
            projectId: setupConfig.project.id,
            projectName: setupConfig.project.name,
            savedAt: new Date().toISOString(),
            answers: questions.map((question, index) => {
                let answer = null;
                if (['single-choice', 'multi-choice'].includes(question.type)) {
                    const stored = responseState.get(question.id);
                    answer = question.type === 'multi-choice'
                        ? (Array.isArray(stored) ? stored : [])
                        : (stored ?? null);
                } else if (question.type === 'sticker') {
                    answer = {
                        type: 'FeatureCollection',
                        features: buildStickerFeatures(question, index)
                    };
                } else if (question.type === 'drawing') {
                    answer = draw.getAll();
                }

                return {
                    questionId: question.id,
                    questionText: question.text,
                    type: question.type,
                    responseShape: question.responseShape,
                    answer: answer
                };
            })
        };
    }

    async function saveResponses() {
        const payload = buildResponsesPayload();
        const filename = `${setupConfig.project.id || 'project'}_responses_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

        try {
            const response = await fetch('/api/save_responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    responses: payload,
                    filename: filename,
                    projectId: setupConfig.project.id
                })
            });

            if (!response.ok) {
                console.error('Failed to save responses to server');
            }
        } catch (error) {
            console.error('Error saving responses to server:', error);
        }
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
            if (finishBtn) finishBtn.classList.add('hidden');
            renderPreviousAnswers({ id: null, type: null });
            clearPreviousAnswerLayers();
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
        const isLastQuestion = currentQuestionIndex === questions.length - 1;
        if (nextBtn) nextBtn.classList.toggle('hidden', isLastQuestion);
        if (finishBtn) finishBtn.classList.toggle('hidden', !isLastQuestion);
        renderPreviousAnswers(q);
        renderPreviousAnswersOnMap(q);
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
        if (currentQuestionIndex < questions.length - 1) {
            currentQuestionIndex++;
            updateQuestion();
        }
    });

    if (previousAnswersBtn) {
        previousAnswersBtn.addEventListener('click', togglePreviousAnswers);
    }

    if (finishBtn) {
        finishBtn.addEventListener('click', async () => {
            if (!questions.length) return;
            finishBtn.disabled = true;
            try {
                await saveResponses();
                if (showPreviousAnswers) {
                    previousResponses = await fetchPreviousResponses();
                    previousResponsesLoaded = true;
                }
                window.alert('Thanks for completing the survey (Please return tokens to their places)');
                currentQuestionIndex = 0;
                updateQuestion();
            } finally {
                finishBtn.disabled = false;
            }
        });
    }
}

initApp();
