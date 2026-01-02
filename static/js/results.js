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

function getQueryParams(name) {
    const params = new URLSearchParams(window.location.search);
    return params.getAll(name);
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

function normalizeResponseSelection() {
    const selected = getQueryParams('response');
    const listParam = getQueryParam('responses');
    const combined = [...selected];
    if (listParam) {
        listParam.split(',').forEach(item => combined.push(item));
    }
    return Array.from(new Set(combined.map(item => item.trim()).filter(Boolean)));
}

function pickResponses(responses, filenames) {
    if (!responses.length) return [];
    if (filenames.length) {
        const filtered = responses.filter(item => filenames.includes(item.__filename));
        return filtered.length ? filtered : responses.slice(0, 1);
    }
    return responses.slice(0, 1);
}

function buildAnswersByQuestion(responses) {
    const map = new Map();
    (responses || []).forEach(response => {
        const list = Array.isArray(response.answers) ? response.answers : [];
        list.forEach(answer => {
            if (!answer || !answer.questionId) return;
            if (!map.has(answer.questionId)) {
                map.set(answer.questionId, []);
            }
            map.get(answer.questionId).push({ response, answer });
        });
    });
    return map;
}

const responseLayerIds = {
    pointsSource: 'selected-response-points',
    pointsLayer: 'selected-response-points-layer',
    linesSource: 'selected-response-lines',
    linesGlow: 'selected-response-lines-glow',
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
    removeLayerIfExists(map, responseLayerIds.linesGlow);
    removeLayerIfExists(map, responseLayerIds.linesLayer);
    removeLayerIfExists(map, responseLayerIds.polygonsOutline);
    removeLayerIfExists(map, responseLayerIds.polygonsFill);
    removeSourceIfExists(map, responseLayerIds.pointsSource);
    removeSourceIfExists(map, responseLayerIds.linesSource);
    removeSourceIfExists(map, responseLayerIds.polygonsSource);
}

function ensureResponseLayers(map, pointData, lineData, polygonData, drawColor = '#FF00FF') {
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
    } else {
        map.getSource(responseLayerIds.linesSource).setData(lineData);
    }
    if (!map.getLayer(responseLayerIds.linesGlow)) {
        map.addLayer({
            id: responseLayerIds.linesGlow,
            type: 'line',
            source: responseLayerIds.linesSource,
            paint: {
                'line-color': drawColor,
                'line-width': 14,
                'line-opacity': 0.6,
                'line-blur': 6
            }
        }, map.getLayer(responseLayerIds.linesLayer) ? responseLayerIds.linesLayer : undefined);
    } else {
        // Update color if layer already exists
        map.setPaintProperty(responseLayerIds.linesGlow, 'line-color', drawColor);
    }
    if (!map.getLayer(responseLayerIds.linesLayer)) {
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
    const responseFilenames = normalizeResponseSelection();
    const projectId = setupConfig.project?.id;
    const responseList = await fetchResponses(projectId);
    const selectedResponses = pickResponses(responseList, responseFilenames);
    const answersByQuestion = buildAnswersByQuestion(selectedResponses);

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
    const resultsCount = document.getElementById('results-count');
    const resultsSummaryTitle = document.getElementById('results-summary-title');
    const resultsSummaryBody = document.getElementById('results-summary-body');

    if (finishBtn) {
        finishBtn.classList.add('hidden');
    }

    if (selectedResponses.length > 1) {
        document.title = `Results · ${selectedResponses.length} responses`;
    } else if (selectedResponses[0]?.savedAt) {
        document.title = `Results · ${formatSavedAt(selectedResponses[0].savedAt)}`;
    }

    if (resultsCount) {
        resultsCount.textContent = `${selectedResponses.length} selected`;
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

        if (['single-choice', 'multi-choice'].includes(question.type)) {
            const options = Array.isArray(question.options) ? question.options : [];
            if (!options.length) {
                const empty = document.createElement('div');
                empty.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
                empty.textContent = 'No options configured.';
                questionOptions.appendChild(empty);
            } else {
                options.forEach(option => {
                    const button = document.createElement('div');
                    button.className = 'question-option w-full text-left px-3 py-2 rounded-md border text-xs font-medium tracking-wide bg-white/5 border-white/10 text-white/85 cursor-default';
                    button.textContent = option;
                    questionOptions.appendChild(button);
                });
            }
            questionOptions.classList.remove('hidden');
            return;
        }

        const message = document.createElement('div');
        message.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80';
        message.textContent = question.type === 'text'
            ? 'Text responses are shown on the right.'
            : 'Spatial responses are shown on the map.';
        questionOptions.appendChild(message);
        questionOptions.classList.remove('hidden');
    }

    function getAnswerEntries(questionId) {
        return answersByQuestion.get(questionId) || [];
    }

    function renderSummaryPanel(question) {
        if (!resultsSummaryTitle || !resultsSummaryBody) return;

        resultsSummaryTitle.textContent = question?.text ? question.text : 'Question Summary';
        resultsSummaryBody.innerHTML = '';

        const entries = getAnswerEntries(question.id);
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
            empty.textContent = 'No responses selected for this question.';
            resultsSummaryBody.appendChild(empty);
            return;
        }

        if (['single-choice', 'multi-choice'].includes(question.type)) {
            const counts = new Map();
            entries.forEach(entry => {
                const value = entry.answer?.answer;
                if (question.type === 'multi-choice') {
                    if (Array.isArray(value)) {
                        value.forEach(option => {
                            if (!option) return;
                            counts.set(option, (counts.get(option) || 0) + 1);
                        });
                    }
                } else if (value != null) {
                    counts.set(value, (counts.get(value) || 0) + 1);
                }
            });

            const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
            if (!rows.length) {
                const empty = document.createElement('div');
                empty.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
                empty.textContent = 'No choice responses for this question.';
                resultsSummaryBody.appendChild(empty);
                return;
            }

            const maxCount = Math.max(...rows.map(([, count]) => count), 1);
            rows.forEach(([label, count]) => {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-2';

                const name = document.createElement('div');
                name.className = 'w-20 text-[11px] text-white/80 truncate';
                name.textContent = String(label);

                const barWrap = document.createElement('div');
                barWrap.className = 'flex-1 h-2 rounded bg-white/10 overflow-hidden';
                const bar = document.createElement('div');
                bar.className = 'h-2 bg-blue-400/80';
                bar.style.width = `${Math.round((count / maxCount) * 100)}%`;
                barWrap.appendChild(bar);

                const value = document.createElement('div');
                value.className = 'w-6 text-[11px] text-white/70 text-right';
                value.textContent = String(count);

                row.appendChild(name);
                row.appendChild(barWrap);
                row.appendChild(value);
                resultsSummaryBody.appendChild(row);
            });
            return;
        }

        if (question.type === 'text') {
            const list = document.createElement('div');
            list.className = 'max-h-40 overflow-auto flex flex-col gap-2';
            const texts = entries
                .map(entry => entry.answer?.answer)
                .filter(value => value != null && String(value).trim().length > 0)
                .map(value => String(value));

            if (!texts.length) {
                const empty = document.createElement('div');
                empty.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
                empty.textContent = 'No text responses for this question.';
                resultsSummaryBody.appendChild(empty);
                return;
            }

            texts.forEach(text => {
                const item = document.createElement('div');
                item.className = 'rounded border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/85 leading-snug';
                item.textContent = text;
                list.appendChild(item);
            });
            resultsSummaryBody.appendChild(list);
            return;
        }

        const info = document.createElement('div');
        info.className = 'rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70';
        info.textContent = 'Map responses are aggregated on the map.';
        resultsSummaryBody.appendChild(info);
    }

    function renderResponseOnMap(question) {
        if (!map.isStyleLoaded()) return;
        const entries = getAnswerEntries(question.id);
        const collected = [];

        entries.forEach(entry => {
            const features = entry.answer?.answer?.features;
            if (Array.isArray(features)) {
                collected.push(...features);
            }
        });

        if (!collected.length) {
            clearResponseLayers(map);
            return;
        }

        const { pointFeatures, lineFeatures, polygonFeatures } = splitFeaturesByGeometry(collected);
        const drawColor = question.type === 'drawing' && question.drawColor 
            ? question.drawColor 
            : '#FF00FF'; // Default magenta
        ensureResponseLayers(
            map,
            { type: 'FeatureCollection', features: pointFeatures },
            { type: 'FeatureCollection', features: lineFeatures },
            { type: 'FeatureCollection', features: polygonFeatures },
            drawColor
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

        renderSummaryPanel(q);
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
