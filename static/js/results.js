import { add3DBuildings, loadAndRenderLayer } from './layers.js';
import { fallbackConfig, loadSetupConfig } from './config-loader.js';
import { initMap } from './map-setup.js';

function flattenQuestions(flow) {
    if (!flow || !Array.isArray(flow) || flow.length === 0) return [];
    const isGrouped = flow[0].questions && Array.isArray(flow[0].questions);
    if (!isGrouped) return flow;

    const sortedGroups = [...flow].sort((a, b) => (a.order || 0) - (b.order || 0));
    const list = [];
    sortedGroups.forEach(group => {
        (group.questions || []).forEach(q => {
            list.push({ ...q, groupId: group.id, groupTitle: group.title });
        });
    });
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    return list;
}

function formatSavedAt(value) {
    if (!value) return 'Unknown time';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
}

function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

async function fetchResponses(projectId) {
    if (!projectId) return [];
    try {
        const response = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.responses) ? data.responses : [];
    } catch (error) {
        return [];
    }
}

function pickResponse(responses, filename) {
    if (!responses.length) return null;
    if (filename) {
        const match = responses.find(item => item.__filename === filename);
        if (match) return match;
    }
    return responses[0];
}

function buildAnswerMap(response) {
    const answersById = new Map();
    if (response && Array.isArray(response.answers)) {
        response.answers.forEach(answer => {
            if (answer && answer.questionId) {
                answersById.set(answer.questionId, answer);
            }
        });
    }
    return answersById;
}

const responseLayerIds = {
    pointsSource: 'selected-response-points',
    pointsLayer: 'selected-response-points-layer',
    linesSource: 'selected-response-lines',
    linesLayer: 'selected-response-lines-layer',
    polygonsSource: 'selected-response-polygons',
    polygonsFill: 'selected-response-polygons-fill',
    polygonsOutline: 'selected-response-polygons-outline'
};

function removeLayerIfExists(map, id) {
    if (map.getLayer(id)) {
        map.removeLayer(id);
    }
}

function removeSourceIfExists(map, id) {
    if (map.getSource(id)) {
        map.removeSource(id);
    }
}

function clearResponseLayers(map) {
    removeLayerIfExists(map, responseLayerIds.pointsLayer);
    removeLayerIfExists(map, responseLayerIds.linesLayer);
    removeLayerIfExists(map, responseLayerIds.polygonsOutline);
    removeLayerIfExists(map, responseLayerIds.polygonsFill);
    removeSourceIfExists(map, responseLayerIds.pointsSource);
    removeSourceIfExists(map, responseLayerIds.linesSource);
    removeSourceIfExists(map, responseLayerIds.polygonsSource);
}

function ensureResponseLayers(map, pointData, lineData, polygonData) {
    if (!map.getSource(responseLayerIds.pointsSource)) {
        map.addSource(responseLayerIds.pointsSource, { type: 'geojson', data: pointData });
        map.addLayer({
            id: responseLayerIds.pointsLayer,
            type: 'circle',
            source: responseLayerIds.pointsSource,
            paint: {
                'circle-radius': 5,
                'circle-color': ['coalesce', ['get', 'color'], '#9aa5b1'],
                'circle-opacity': 0.75,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1
            }
        });
    } else {
        map.getSource(responseLayerIds.pointsSource).setData(pointData);
    }

    if (!map.getSource(responseLayerIds.linesSource)) {
        map.addSource(responseLayerIds.linesSource, { type: 'geojson', data: lineData });
        map.addLayer({
            id: responseLayerIds.linesLayer,
            type: 'line',
            source: responseLayerIds.linesSource,
            paint: {
                'line-color': '#f5d76e',
                'line-width': 2.5,
                'line-opacity': 0.7
            }
        });
    } else {
        map.getSource(responseLayerIds.linesSource).setData(lineData);
    }

    if (!map.getSource(responseLayerIds.polygonsSource)) {
        map.addSource(responseLayerIds.polygonsSource, { type: 'geojson', data: polygonData });
        map.addLayer({
            id: responseLayerIds.polygonsFill,
            type: 'fill',
            source: responseLayerIds.polygonsSource,
            paint: {
                'fill-color': '#f5d76e',
                'fill-opacity': 0.2
            }
        });
        map.addLayer({
            id: responseLayerIds.polygonsOutline,
            type: 'line',
            source: responseLayerIds.polygonsSource,
            paint: {
                'line-color': '#f5d76e',
                'line-width': 2,
                'line-opacity': 0.7
            }
        });
    } else {
        map.getSource(responseLayerIds.polygonsSource).setData(polygonData);
    }
}

function splitFeaturesByGeometry(features) {
    const pointFeatures = [];
    const lineFeatures = [];
    const polygonFeatures = [];

    (features || []).forEach(feature => {
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

    return { pointFeatures, lineFeatures, polygonFeatures };
}

async function initResults() {
    const setupConfig = await loadSetupConfig();
    const responseFilename = getQueryParam('response');
    const projectId = setupConfig.project?.id;
    const responseList = await fetchResponses(projectId);
    const response = pickResponse(responseList, responseFilename);
    const answersById = buildAnswerMap(response);

    if (setupConfig.project.rearProjection) {
        document.body.style.transform = 'scaleX(-1)';
    }

    const overlayStateRef = { current: new Set(setupConfig.map?.overlays || []) };
    let questions = flattenQuestions(setupConfig.questionFlow);
    if (!questions.length) {
        questions = flattenQuestions(fallbackConfig.questionFlow);
    }

    let currentQuestionIndex = 0;
    let dots = [];

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const finishBtn = document.getElementById('finish-btn');
    const questionText = document.querySelector('.question-text');
    const questionOptions = document.getElementById('question-options');
    const dotsContainer = document.querySelector('.progress-dots');

    if (finishBtn) {
        finishBtn.classList.add('hidden');
    }

    if (response?.savedAt) {
        document.title = `Results · ${formatSavedAt(response.savedAt)}`;
    }

    const { map } = initMap({
        setupConfig,
        add3DBuildings,
        loadAndRenderLayer,
        onStyleLoad: () => {
            updateQuestion();
        }
    });

    function renderDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        questions.forEach((q, index) => {
            const dot = document.createElement('span');
            dot.className = 'dot w-2.5 h-2.5 flex-none rounded-full bg-white/30 transition-all duration-300 cursor-pointer hover:bg-white/50 hover:scale-110 [&.active]:bg-gradient-to-br [&.active]:from-[#667eea] [&.active]:to-[#764ba2] [&.active]:scale-125 [&.active]:shadow-sm';
            dot.title = q.text || '';
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
        questionOptions.innerHTML = '';

        const answerEntry = answersById.get(question.id);
        const answerValue = answerEntry ? answerEntry.answer : null;
        const isChoice = ['single-choice', 'multi-choice'].includes(question.type);

        if (isChoice) {
            const options = Array.isArray(question.options) ? question.options : [];
            const selected = question.type === 'multi-choice'
                ? new Set(Array.isArray(answerValue) ? answerValue : [])
                : new Set(answerValue != null ? [answerValue] : []);

            if (!options.length) {
                const empty = document.createElement('div');
                empty.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
                empty.textContent = 'No options configured.';
                questionOptions.appendChild(empty);
            } else {
                options.forEach(option => {
                    const isSelected = selected.has(option);
                    const button = document.createElement('div');
                    button.className = `question-option w-full text-left px-3 py-2 rounded-md border text-xs font-medium tracking-wide ${isSelected ? 'bg-white/15 border-white/40 text-white' : 'bg-white/5 border-white/10 text-white/85'} cursor-default`;
                    button.textContent = option;
                    questionOptions.appendChild(button);
                });
            }
            questionOptions.classList.remove('hidden');
            return;
        }

        const message = document.createElement('div');
        message.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80';

        if (question.type === 'sticker' || question.type === 'drawing') {
            const count = Array.isArray(answerValue?.features) ? answerValue.features.length : 0;
            message.textContent = count
                ? `${count} item${count === 1 ? '' : 's'} shown on the map.`
                : 'No response for this question.';
        } else if (question.type === 'text') {
            message.textContent = answerValue ? String(answerValue) : 'No response for this question.';
        } else {
            message.textContent = answerValue != null ? String(answerValue) : 'No response for this question.';
        }

        questionOptions.appendChild(message);
        questionOptions.classList.remove('hidden');
    }

    function renderResponseOnMap(question) {
        if (!map.isStyleLoaded()) return;
        const answerEntry = answersById.get(question.id);
        const features = answerEntry?.answer?.features;

        if (!Array.isArray(features) || features.length === 0) {
            clearResponseLayers(map);
            return;
        }

        const { pointFeatures, lineFeatures, polygonFeatures } = splitFeaturesByGeometry(features);
        ensureResponseLayers(
            map,
            { type: 'FeatureCollection', features: pointFeatures },
            { type: 'FeatureCollection', features: lineFeatures },
            { type: 'FeatureCollection', features: polygonFeatures }
        );
    }

    function updateQuestion() {
        if (!questions.length) {
            if (questionText) questionText.textContent = 'No questions configured';
            if (questionOptions) questionOptions.classList.add('hidden');
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            clearResponseLayers(map);
            return;
        }

        const q = questions[currentQuestionIndex];
        if (questionText) {
            questionText.textContent = q.text || 'Untitled question';
        }

        renderQuestionOptions(q);

        const mapReady = map && map.isStyleLoaded && map.isStyleLoaded();
        if (mapReady && q.mapId && setupConfig.maps) {
            const mapConfig = setupConfig.maps.find(m => m.id === q.mapId);
            if (mapConfig) {
                overlayStateRef.current = new Set(mapConfig.overlays || []);
                if (setupConfig.overlays) {
                    setupConfig.overlays.forEach(layer => {
                        const isVisible = overlayStateRef.current.has(layer.id);
                        loadAndRenderLayer(map, layer, isVisible);
                    });
                }

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

        if (prevBtn) prevBtn.disabled = currentQuestionIndex === 0;
        if (nextBtn) nextBtn.disabled = currentQuestionIndex === questions.length - 1;

        if (mapReady) {
            renderResponseOnMap(q);
        }
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentQuestionIndex > 0) {
                currentQuestionIndex -= 1;
                updateQuestion();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentQuestionIndex < questions.length - 1) {
                currentQuestionIndex += 1;
                updateQuestion();
            }
        });
    }

    renderDots();
    if (map.isStyleLoaded()) {
        updateQuestion();
    }
}

initResults();
