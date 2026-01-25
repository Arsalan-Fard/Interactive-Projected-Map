import { initDraggableStickers, getMapCoordsFromScreen, getScreenCoordsFromNormalized, addStickerMarker, removeStickersForQuestion } from './ui.js';

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

export function initSurvey({ map, setupConfig, fallbackConfig, loadAndRenderLayer, draw, overlayState }) {
    const overlayStateRef = overlayState || { current: new Set(setupConfig.map?.overlays || []) };
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
    const questionTextNodes = Array.from(new Set([
        ...document.querySelectorAll('.question-text'),
        ...document.querySelectorAll('[data-question-text]')
    ]));
    const questionOptions = document.getElementById('question-options');
    const dotsContainer = document.querySelector('.progress-dots');
    const workshopDotsContainers = Array.from(document.querySelectorAll('[data-workshop-question-dots]'));
    const previousAnswersBtn = document.getElementById('btn-previous-answers');
    const previousAnswersPanel = document.getElementById('previous-answers-panel');
    const previousAnswersSummary = document.getElementById('previous-answers-summary');
    const previousAnswersList = document.getElementById('previous-answers-list');
    let dots = [];
    let previousResponses = [];
    let previousResponsesLoaded = false;
    let showPreviousAnswers = false;
    let workshopDots = [];
    let workshopSelections = [];
    let isTransitioning = false;
    let mapTransitionLocks = 0;
    let pendingMapConfig = null;

    const prevButtons = Array.from(new Set([
        ...document.querySelectorAll('[data-question-nav="prev"]'),
        prevBtn
    ])).filter(Boolean);
    const nextButtons = Array.from(new Set([
        ...document.querySelectorAll('[data-question-nav="next"]'),
        nextBtn
    ])).filter(Boolean);
    const finishButtonsAll = Array.from(new Set([
        ...document.querySelectorAll('[data-question-nav="finish"]'),
        finishBtn
    ])).filter(Boolean);
    const finishButtonsVisible = finishButtonsAll.filter(btn => !btn.hasAttribute('data-workshop-finish'));

    function setQuestionText(value) {
        questionTextNodes.forEach(node => {
            node.textContent = value;
        });
    }

    function setButtonsDisabled(buttons, disabled) {
        buttons.forEach(btn => {
            btn.disabled = disabled;
        });
    }

    function toggleButtonsHidden(buttons, hidden) {
        buttons.forEach(btn => {
            btn.classList.toggle('hidden', hidden);
        });
    }

    function updateWorkshopSelectionStyles() {
        if (!workshopDots.length || !workshopSelections.length) return;
        workshopDots.forEach((group, groupIndex) => {
            const selection = workshopSelections[groupIndex];
            group.dots.forEach((dot, index) => {
                dot.classList.toggle('selected', selection?.type === 'question' && selection.index === index);
            });
            if (group.finish) {
                group.finish.classList.toggle('selected', selection?.type === 'finish');
            }
        });
    }

    function clearWorkshopSelections() {
        if (!workshopSelections.length) return;
        workshopSelections = workshopSelections.map(() => null);
        updateWorkshopSelectionStyles();
    }

    function getWorkshopConsensus() {
        if (!workshopSelections.length) return null;
        const first = workshopSelections[0];
        if (!first) return null;
        for (let i = 1; i < workshopSelections.length; i += 1) {
            const next = workshopSelections[i];
            if (!next || next.type !== first.type || next.index !== first.index) {
                return null;
            }
        }
        return first;
    }

    function setWorkshopSelection(groupIndex, selection) {
        if (!workshopSelections.length) return;
        workshopSelections[groupIndex] = selection;
        updateWorkshopSelectionStyles();
        const consensus = getWorkshopConsensus();
        if (!consensus) return;
        if (consensus.type === 'question') {
            transitionToQuestionIndex(consensus.index);
        } else if (consensus.type === 'finish') {
            handleFinish();
        }
    }

    function handleWorkshopSelectionEvent(event) {
        const detail = event?.detail || {};
        const groupIndex = Number(detail.groupIndex);
        if (!Number.isInteger(groupIndex)) return;
        if (!workshopSelections.length || groupIndex < 0 || groupIndex >= workshopSelections.length) return;

        const selection = detail.selection || null;
        if (!selection) {
            workshopSelections[groupIndex] = null;
            updateWorkshopSelectionStyles();
            return;
        }

        if (selection.type === 'finish') {
            setWorkshopSelection(groupIndex, { type: 'finish', index: null });
            return;
        }

        const index = Number(selection.index);
        if (!Number.isInteger(index) || index < 0 || index >= questions.length) return;
        setWorkshopSelection(groupIndex, { type: 'question', index });
    }

    function renderDots() {
        if (dotsContainer) {
            dotsContainer.innerHTML = '';
            questions.forEach((q, index) => {
                const dot = document.createElement('span');
                dot.className = 'dot w-2.5 h-2.5 flex-none rounded-full bg-white/30 transition-all duration-300 cursor-pointer hover:bg-white/50 hover:scale-110 [&.active]:bg-gradient-to-br [&.active]:from-[#667eea] [&.active]:to-[#764ba2] [&.active]:scale-125 [&.active]:shadow-sm';
                dot.title = q.text;
                dot.addEventListener('click', () => {
                    transitionToQuestionIndex(index);
                });
                dotsContainer.appendChild(dot);
            });
            dots = dotsContainer.querySelectorAll('.dot');
        }

        if (!workshopDotsContainers.length) return;
        workshopDots = workshopDotsContainers.map((container, groupIndex) => {
            container.innerHTML = '';
            const dots = questions.map((q, index) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'workshop-question-dot';
                dot.title = q.text;
                dot.textContent = `Q${index + 1}`;
                dot.dataset.questionIndex = String(index);
                dot.addEventListener('click', () => {
                    setWorkshopSelection(groupIndex, { type: 'question', index });
                });
                container.appendChild(dot);
                return dot;
            });
            const finishDot = document.createElement('button');
            finishDot.type = 'button';
            finishDot.className = 'workshop-question-dot';
            finishDot.title = 'Finish';
            finishDot.textContent = 'F';
            finishDot.dataset.questionFinish = '1';
            finishDot.addEventListener('click', () => {
                setWorkshopSelection(groupIndex, { type: 'finish', index: null });
            });
            container.appendChild(finishDot);
            return { dots, finish: finishDot };
        });
        workshopSelections = workshopDots.map(() => null);
        updateWorkshopSelectionStyles();
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
                item.textContent = `${formatSavedAt(response.savedAt)} ƒ?› ${count} item${count === 1 ? '' : 's'}`;
                previousAnswersList.appendChild(item);
            });
            return;
        }

        entries.forEach(({ response, answer }) => {
            const item = document.createElement('div');
            item.className = 'rounded border border-white/10 bg-white/5 px-2 py-1';
            item.textContent = `${formatSavedAt(response.savedAt)} ƒ?› ${String(answer.answer)}`;
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
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const coords = getMapCoordsFromScreen(map, centerX, centerY);
        if (coords) return [coords.lng, coords.lat];

        const mapRect = map.getContainer().getBoundingClientRect();
        const center = [centerX - mapRect.left, centerY - mapRect.top];
        const fallback = map.unproject(center);
        return [fallback.lng, fallback.lat];
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

    function notifyQuestionChange(question) {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('question-change', {
            detail: {
                index: currentQuestionIndex,
                total: questions.length,
                questionId: question?.id || null,
                workshopMode: !!setupConfig?.project?.workshopMode
            }
        }));
    }

    let captureBlackoutOverlay = null;

    function setCaptureBlackoutVisible(visible) {
        if (typeof document === 'undefined') return;
        if (!captureBlackoutOverlay) {
            const el = document.createElement('div');
            Object.assign(el.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                backgroundColor: 'black',
                zIndex: '20000',
                display: 'none',
                pointerEvents: 'none'
            });
            document.body.appendChild(el);
            captureBlackoutOverlay = el;
        }
        captureBlackoutOverlay.style.display = visible ? 'block' : 'none';
    }

    function getMapViewSnapshot() {
        if (!map) return null;
        try {
            const center = map.getCenter?.();
            const lng = center?.lng;
            const lat = center?.lat;
            const zoom = map.getZoom?.();
            const pitch = map.getPitch?.();
            const bearing = map.getBearing?.();
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
            if (!Number.isFinite(zoom) || !Number.isFinite(pitch) || !Number.isFinite(bearing)) return null;
            return { center: [lng, lat], zoom, pitch, bearing };
        } catch {
            return null;
        }
    }

    function restoreMapViewSnapshot(snapshot) {
        if (!map || !snapshot) return;
        try {
            if (typeof map.stop === 'function') {
                map.stop();
            }
            if (typeof map.jumpTo === 'function') {
                map.jumpTo(snapshot);
            }
        } catch {
            // ignore
        }
    }

    function lockMapTransitions() {
        mapTransitionLocks += 1;
    }

    function applyMapConfig(mapConfig) {
        if (!mapConfig) return;

        // Update active overlays
        overlayStateRef.current = new Set(mapConfig.overlays || []);

        // Update visibility of existing layers
        if (setupConfig.overlays) {
            setupConfig.overlays.forEach(layer => {
                const isVisible = overlayStateRef.current.has(layer.id);
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

    function unlockMapTransitions() {
        mapTransitionLocks = Math.max(0, mapTransitionLocks - 1);
        if (mapTransitionLocks > 0) return;
        if (!pendingMapConfig) return;
        const cfg = pendingMapConfig;
        pendingMapConfig = null;
        applyMapConfig(cfg);
    }

    async function maybeCaptureCircleStickers(fromQuestion, toQuestion, mapViewSnapshot) {
        const detectionMode = setupConfig?.project?.stickerDetectionMode;
        if (detectionMode !== 'circle') return;
        if (!fromQuestion) return;

        const colors = Array.isArray(setupConfig?.project?.stickerConfig?.colors)
            ? setupConfig.project.stickerConfig.colors
            : [];
        if (!colors.length) return;

        // Stop any in-progress map animation so screen->lng/lat conversion uses the correct view.
        restoreMapViewSnapshot(mapViewSnapshot);

        setCaptureBlackoutVisible(true);
        try {
            // Ensure the blackout overlay has actually painted before triggering the camera capture.
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            await new Promise(resolve => setTimeout(resolve, 100));

            try {
                const res = await fetch('http://localhost:5000/api/capture-circles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: setupConfig?.project?.id || null,
                        fromQuestionId: fromQuestion.id || null,
                        fromQuestionIndex: currentQuestionIndex,
                        toQuestionId: toQuestion?.id || null,
                        toQuestionIndex: toQuestion ? (questions.findIndex(q => q.id === toQuestion.id)) : null,
                        stickerColors: colors,
                        delayMs: 250,
                        minNewFrames: 3,
                        waitTimeoutMs: 3000
                    })
                });
                if (!res.ok) {
                    return;
                }
                const data = await res.json();
                if (!data?.ok) return;

                const circles = Array.isArray(data.circles) ? data.circles : [];
                if (!circles.length) {
                    removeStickersForQuestion(fromQuestion.id);
                    return;
                }

                removeStickersForQuestion(fromQuestion.id);

                // Ensure conversion happens against the original (pre-next-click) map view.
                restoreMapViewSnapshot(mapViewSnapshot);

                circles.forEach(c => {
                    const nx = c?.nx;
                    const ny = c?.ny;
                    const screen = getScreenCoordsFromNormalized(nx, ny);
                    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return;

                    const lngLat = getMapCoordsFromScreen(map, screen.x, screen.y);
                    if (!lngLat) return;

                    const idx = Number.parseInt(c?.stickerIndex, 10);
                    if (!Number.isInteger(idx) || idx < 0 || idx >= colors.length) return;

                    const color = colors[idx] || c?.color || '#ffffff';
                    const typeId = `sticker-btn-${idx + 1}`;
                    addStickerMarker(map, lngLat, color, typeId, fromQuestion.id);
                });
            } catch (error) {
                console.warn('Circle capture failed', error);
            }
        } finally {
            await new Promise(resolve => setTimeout(resolve, 50));
            setCaptureBlackoutVisible(false);
        }
    }

    async function transitionToQuestionIndex(nextIndex) {
        if (isTransitioning) return;
        if (!questions.length) return;
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= questions.length) return;

        const fromIndex = currentQuestionIndex;
        const toIndex = nextIndex;
        const fromQuestion = questions[fromIndex];
        const toQuestion = questions[toIndex];

        isTransitioning = true;
        setButtonsDisabled(prevButtons, true);
        setButtonsDisabled(nextButtons, true);

        try {
            const mapViewSnapshot = getMapViewSnapshot();
            lockMapTransitions();
            await maybeCaptureCircleStickers(fromQuestion, toQuestion, mapViewSnapshot);
            currentQuestionIndex = nextIndex;
            updateQuestion();
        } finally {
            unlockMapTransitions();
            isTransitioning = false;
        }
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
            setButtonsDisabled(prevButtons, true);
            setButtonsDisabled(nextButtons, true);
            toggleButtonsHidden(finishButtonsVisible, true);
            renderPreviousAnswers({ id: null, type: null });
            clearPreviousAnswerLayers();
            notifyQuestionChange(null);
            return;
        }

        const q = questions[currentQuestionIndex];
        setQuestionText(q.text);
        renderQuestionOptions(q);

        // Map switching logic
        if (q.mapId && setupConfig.maps) {
            const mapConfig = setupConfig.maps.find(m => m.id === q.mapId);
            if (mapConfig) {
                if (mapTransitionLocks > 0) {
                    pendingMapConfig = mapConfig;
                } else {
                    applyMapConfig(mapConfig);
                }
            }
        }

        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === currentQuestionIndex);
        });
        workshopDots.forEach(group => {
            group.dots.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentQuestionIndex);
            });
        });

        const isLastQuestion = currentQuestionIndex === questions.length - 1;
        setButtonsDisabled(prevButtons, currentQuestionIndex === 0);
        setButtonsDisabled(nextButtons, currentQuestionIndex === questions.length - 1);
        toggleButtonsHidden(nextButtons, isLastQuestion);
        toggleButtonsHidden(finishButtonsVisible, !isLastQuestion);
        renderPreviousAnswers(q);
        renderPreviousAnswersOnMap(q);
        notifyQuestionChange(q);
    }

    prevButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!questions.length) return;
            if (currentQuestionIndex > 0) {
                transitionToQuestionIndex(currentQuestionIndex - 1);
            }
        });
    });

    nextButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!questions.length) return;
            if (currentQuestionIndex < questions.length - 1) {
                await transitionToQuestionIndex(currentQuestionIndex + 1);
            }
        });
    });

    if (previousAnswersBtn) {
        previousAnswersBtn.addEventListener('click', togglePreviousAnswers);
    }

    async function handleFinish() {
        if (!questions.length) return;
        setButtonsDisabled(finishButtonsAll, true);
        try {
            await maybeCaptureCircleStickers(questions[currentQuestionIndex], null);
            await saveResponses();
            if (showPreviousAnswers) {
                previousResponses = await fetchPreviousResponses();
                previousResponsesLoaded = true;
            }
            window.alert('Thanks for completing the survey (Please return tokens to their places)');
            currentQuestionIndex = 0;
            updateQuestion();
        } finally {
            setButtonsDisabled(finishButtonsAll, false);
        }
    }

    finishButtonsAll.forEach(btn => {
        btn.addEventListener('click', handleFinish);
    });

    if (typeof window !== 'undefined') {
        window.addEventListener('workshop-question-select', handleWorkshopSelectionEvent);
    }

    return {
        onStyleLoad() {
            renderDots();
            updateQuestion();
        }
    };
}
