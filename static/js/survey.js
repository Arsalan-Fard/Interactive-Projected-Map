import { initDraggableStickers, getMapCoordsFromScreen } from './ui.js';

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
    const isTuiMode = Boolean(setupConfig?.project?.tuiMode);
    let currentQuestionIndex = 0;
    const responseState = new Map();

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const finishBtn = document.getElementById('finish-btn');
    const finishBtnTui = document.getElementById('finish-btn-tui');
    const questionText = document.querySelector('.question-text');
    const questionOptions = document.getElementById('question-options');
    const dotsContainer = document.querySelector('.progress-dots');
    const tuiQuestionList = document.getElementById('tui-question-list');
    const previousAnswersBtn = document.getElementById('btn-previous-answers');
    const previousAnswersPanel = document.getElementById('previous-answers-panel');
    const previousAnswersSummary = document.getElementById('previous-answers-summary');
    const previousAnswersList = document.getElementById('previous-answers-list');
    let dots = [];
    let tuiRows = [];
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

    function getStickerButtonTemplates() {
        const allButtons = Array.from(document.querySelectorAll('#left-sidebar #sidebar-standard .points-section .point-btn'));
        if (!allButtons.length) return [];
        const count = Number.isInteger(setupConfig?.project?.stickerConfig?.count)
            ? setupConfig.project.stickerConfig.count
            : allButtons.length;
        return allButtons.slice(0, Math.max(0, Math.min(allButtons.length, count)));
    }

    function getTuiRowClass(isActive) {
        return `rounded-lg border px-3 py-3 transition-all duration-200 cursor-pointer ${isActive ? 'border-white/35 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset]' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'}`;
    }

    function updateTuiActiveRow() {
        if (!tuiRows.length) return;
        tuiRows.forEach(({ element, index }) => {
            if (!element) return;
            element.className = getTuiRowClass(index === currentQuestionIndex);
        });
    }

    function renderTuiQuestionList() {
        if (!tuiQuestionList) return;
        tuiQuestionList.innerHTML = '';
        tuiRows = [];

        const stickerTemplates = getStickerButtonTemplates();

        questions.forEach((question, index) => {
            const row = document.createElement('div');
            row.className = getTuiRowClass(index === currentQuestionIndex);
            row.dataset.questionId = question.id || '';
            row.addEventListener('click', () => {
                currentQuestionIndex = index;
                updateQuestion();
            });

            const titleRow = document.createElement('div');
            titleRow.className = 'text-xs font-semibold text-white/95 leading-snug';
            titleRow.textContent = question.text || 'Untitled question';
            row.appendChild(titleRow);

            const inputRow = document.createElement('div');
            inputRow.className = 'mt-2 flex flex-col gap-2';

            if (['single-choice', 'multi-choice'].includes(question.type)) {
                const options = Array.isArray(question.options) ? question.options : [];
                const optionsRow = document.createElement('div');
                optionsRow.className = 'flex flex-wrap gap-2';

                const getChoiceClass = (selected) => (
                    `px-2.5 py-2 rounded-md border text-[11px] font-semibold tracking-wide transition-all duration-150 ${selected ? 'bg-white/20 border-white/40 text-white' : 'bg-white/5 border-white/10 text-white/85 hover:bg-white/10 hover:border-white/25'}`
                );

                const updateChoiceStyles = () => {
                    const stored = responseState.get(question.id);
                    Array.from(optionsRow.querySelectorAll('button[data-option]')).forEach(btn => {
                        const value = btn.dataset.option;
                        const selected = question.type === 'multi-choice'
                            ? Array.isArray(stored) && stored.includes(value)
                            : stored === value;
                        btn.className = getChoiceClass(selected);
                        btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
                    });
                };

                options.forEach(option => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.option = option;
                    button.className = getChoiceClass(false);
                    button.textContent = option;
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        currentQuestionIndex = index;
                        updateQuestion();
                        toggleChoiceAnswer(question, option);
                        updateChoiceStyles();
                        updateTuiActiveRow();
                    });
                    optionsRow.appendChild(button);
                });

                updateChoiceStyles();
                inputRow.appendChild(optionsRow);
            } else if (question.type === 'drawing') {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'w-full px-3 py-2 rounded-md border border-white/15 bg-white/5 text-white/85 text-xs font-semibold uppercase tracking-[1px] transition-all duration-200 hover:bg-white/10 hover:border-white/30 hover:text-white';
                button.textContent = question.drawLabel || 'Draw Line';
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentQuestionIndex = index;
                    updateQuestion();
                    updateTuiActiveRow();
                    if (!draw || typeof draw.getMode !== 'function' || typeof draw.changeMode !== 'function') return;
                    const targetMode = 'draw_line_string';
                    const mode = draw.getMode();
                    draw.changeMode(mode !== targetMode ? targetMode : 'simple_select');
                });
                inputRow.appendChild(button);
            } else if (question.type === 'sticker') {
                const paletteRow = document.createElement('div');
                paletteRow.className = 'flex flex-wrap gap-2';

                const hasExplicitStickerSelection = Array.isArray(question.stickerIds);
                const allowedStickerIds = hasExplicitStickerSelection
                    ? question.stickerIds.map(value => String(value)).filter(Boolean)
                    : [];
                const allowedStickerIdSet = hasExplicitStickerSelection ? new Set(allowedStickerIds) : null;

                stickerTemplates.forEach(template => {
                    const typeId = template.id || template.dataset.typeId;
                    if (allowedStickerIdSet && typeId && !allowedStickerIdSet.has(typeId)) {
                        return;
                    }
                    const clone = template.cloneNode(true);
                    clone.removeAttribute('id');
                    if (typeId) clone.dataset.typeId = typeId;
                    clone.dataset.questionId = question.id;
                    clone.style.display = '';
                    clone.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        currentQuestionIndex = index;
                        updateQuestion();
                        updateTuiActiveRow();
                    });
                    paletteRow.appendChild(clone);
                });

                if (!paletteRow.childElementCount) {
                    const empty = document.createElement('div');
                    empty.className = 'text-[11px] text-white/70';
                    empty.textContent = 'No stickers configured for this question.';
                    inputRow.appendChild(empty);
                } else {
                    inputRow.appendChild(paletteRow);
                }
            } else {
                const message = document.createElement('div');
                message.className = 'text-[11px] text-white/70';
                message.textContent = 'This question type is not supported in TUI layout yet.';
                inputRow.appendChild(message);
            }

            row.appendChild(inputRow);
            tuiQuestionList.appendChild(row);
            tuiRows.push({ element: row, index });
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

        if (!isTuiMode) {
            const buttons = Array.from(document.querySelectorAll('#left-sidebar #sidebar-standard .points-section .point-btn'));
            const count = Number.isInteger(setupConfig?.project?.stickerConfig?.count)
                ? setupConfig.project.stickerConfig.count
                : buttons.length;
            const availableIds = new Set(Array.from({ length: Math.max(0, count) }, (_, i) => `sticker-btn-${i + 1}`));
            const allowed = q.type === 'sticker' && Array.isArray(q.stickerIds)
                ? new Set(q.stickerIds.map(value => String(value)).filter(Boolean))
                : null;

            buttons.forEach(btn => {
                const id = btn.id || btn.dataset.typeId;
                const withinConfigured = id && availableIds.has(id);
                const shouldShow = withinConfigured && (!allowed || allowed.has(id));
                btn.style.display = shouldShow ? '' : 'none';
            });
        }
        if (isTuiMode) {
            updateTuiActiveRow();
        }

        // Update btn-draw button text if current question is a drawing question
        const drawBtn = document.getElementById('btn-draw');
        if (drawBtn && q.type === 'drawing') {
            const drawLabel = q.drawLabel || 'Draw Line';
            // Extract just the text part (e.g., "Line" from "Draw Line")
            const shortLabel = drawLabel.replace(/^draw\s+/i, '').trim() || 'Line';
            drawBtn.textContent = shortLabel;
        }
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

    if (finishBtnTui) {
        finishBtnTui.addEventListener('click', async () => {
            if (!questions.length) return;
            finishBtnTui.disabled = true;
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
                finishBtnTui.disabled = false;
            }
        });
    }

    if (isTuiMode) {
        renderTuiQuestionList();
    }

    initDraggableStickers(map, () => questions[currentQuestionIndex]?.id);

    return {
        onStyleLoad() {
            renderDots();
            updateQuestion();
        }
    };
}
