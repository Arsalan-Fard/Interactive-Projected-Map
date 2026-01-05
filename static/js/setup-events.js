import { DEFAULT_DRAWING_ITEM } from './setup-defaults.js';
import { clampStickerCount, clampTagSettingsCount, normalizeDrawingConfig } from './setup-normalizers.js';
import { parseCenter, slugify } from './setup-utils.js';

export function createEventHandlers({ store, els, handlers }) {
    const {
        checkUnsavedChanges,
        loadProjectById,
        uploadResponsesFile,
        renderResponses,
        toggleSelectAllResponses,
        viewSelectedResponses,
        deleteSelectedResponses,
        newProject,
        deleteCurrentProject,
        persistStateToServer,
        downloadConfig,
        renderProjectDropdown,
        scheduleResponsesRefresh,
        updateTagSettingsCount,
        renderTagSettings,
        markSaved,
        renderDrawingConfig,
        renderStickerConfig,
        renderTagConfig,
        updateStickerCount,
        updateSelectedMap,
        deleteMap,
        toggleAllOverlays,
        addMapFromForm,
        addDefaultQuestion,
        deleteSelectedQuestion,
        updateSelectedQuestion,
        renderQuestionDetails
    } = handlers;

    function switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            }
        });

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            if (panel.dataset.panel === tabName) {
                panel.classList.remove('hidden');
                panel.classList.add('block');
            } else {
                panel.classList.remove('block');
                panel.classList.add('hidden');
            }
        });
    }

    function switchProjectSubtab(subtabName) {
        if (!subtabName) return;

        document.querySelectorAll('.project-subtab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.subtab === subtabName) {
                btn.classList.add('active');
            }
        });

        document.querySelectorAll('.project-subtab-panel').forEach(panel => {
            if (panel.dataset.subpanel === subtabName) {
                panel.classList.remove('hidden');
                panel.classList.add('block');
            } else {
                panel.classList.remove('block');
                panel.classList.add('hidden');
            }
        });
    }

    function initEvents() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Project sub-tabs
        document.querySelectorAll('.project-subtab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchProjectSubtab(btn.dataset.subtab));
        });
        const activeProjectSubtab = document.querySelector('.project-subtab-btn.active');
        if (activeProjectSubtab) {
            switchProjectSubtab(activeProjectSubtab.dataset.subtab);
        }

        // Project dropdown
        els.projectDropdown?.addEventListener('change', e => {
            const projectId = e.target.value;
            if (projectId && projectId !== store.state.project.id) {
                if (!checkUnsavedChanges()) {
                    els.projectDropdown.value = store.state.project.id || '';
                    return;
                }
                loadProjectById(projectId);
            }
        });

        // Responses upload
        els.uploadResponsesBtn?.addEventListener('click', () => {
            els.uploadResponsesInput?.click();
        });
        els.uploadResponsesInput?.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
            if (!file) return;
            await uploadResponsesFile(file);
            e.target.value = '';
        });
        els.responsesFilterStart?.addEventListener('change', renderResponses);
        els.responsesFilterEnd?.addEventListener('change', renderResponses);
        els.responsesSelectAll?.addEventListener('click', toggleSelectAllResponses);
        els.responsesViewSelected?.addEventListener('click', viewSelectedResponses);
        els.responsesDeleteSelected?.addEventListener('click', deleteSelectedResponses);

        // Project actions
        els.newProject?.addEventListener('click', newProject);
        els.deleteProject?.addEventListener('click', deleteCurrentProject);
        els.saveServer?.addEventListener('click', persistStateToServer);
        els.downloadConfig?.addEventListener('click', downloadConfig);
        els.openProject?.addEventListener('click', () => {
            const selected = els.projectDropdown?.value || store.state.project.id;
            const params = new URLSearchParams();
            if (selected) {
                params.set('project', selected);
            }
            params.set('tui', store.state.project?.tuiMode ? '1' : '0');
            const query = params.toString();
            const url = query ? `/app?${query}` : '/app';
            window.open(url, '_blank');
        });

        // Project details
        els.projectName.addEventListener('input', e => {
            store.state.project.name = e.target.value;
            markSaved('Unsaved changes');
            renderProjectDropdown();
        });
        els.projectLocation.addEventListener('input', e => {
            store.state.project.location = e.target.value;
            markSaved('Unsaved changes');
        });
        els.projectId.addEventListener('input', e => {
            store.state.project.id = slugify(e.target.value || 'project');
            els.projectPill.textContent = store.state.project.id;
            markSaved('Unsaved changes');
            scheduleResponsesRefresh();
        });

        els.projectRearProjection?.addEventListener('change', e => {
            store.state.project.rearProjection = e.target.checked;
            markSaved('Unsaved changes');
        });

        els.projectTuiMode?.addEventListener('change', e => {
            store.state.project.tuiMode = e.target.checked;
            markSaved('Unsaved changes');
        });

        els.tagSettingsCount?.addEventListener('input', e => {
            const raw = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(raw)) return;
            const nextCount = clampTagSettingsCount(raw);
            if (nextCount !== raw) {
                e.target.value = nextCount;
            }
            updateTagSettingsCount(nextCount);
            renderTagSettings();
            markSaved('Unsaved changes');
        });

        els.projectWorkshopMode?.addEventListener('change', e => {
            store.state.project.workshopMode = e.target.checked;
            markSaved('Unsaved changes');
        });

        els.addDrawingSetting?.addEventListener('click', () => {
            normalizeDrawingConfig(store.state);
            const items = store.state.project.drawingConfig.items;
            const nextIndex = items.length + 1;
            items.push({
                id: `drawing-${nextIndex}`,
                label: DEFAULT_DRAWING_ITEM.label,
                color: DEFAULT_DRAWING_ITEM.color,
                tagId: DEFAULT_DRAWING_ITEM.tagId
            });
            renderDrawingConfig();
            renderStickerConfig();
            renderTagConfig();
            markSaved('Unsaved changes');
        });

        els.stickerCount?.addEventListener('input', e => {
            const raw = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(raw)) return;
            const nextCount = clampStickerCount(raw);
            if (nextCount !== raw) {
                e.target.value = nextCount;
            }
            updateStickerCount(nextCount);
            renderStickerConfig();
            markSaved('Unsaved changes');
        });

        // Map details
        els.mapStyle.addEventListener('input', e => updateSelectedMap({ style: e.target.value }));
        els.mapCenter.addEventListener('input', e => {
            const center = parseCenter(e.target.value);
            if (center) updateSelectedMap({ center });
        });
        els.mapZoom.addEventListener('input', e => updateSelectedMap({ zoom: parseFloat(e.target.value) || 0 }));
        els.mapPitch.addEventListener('input', e => updateSelectedMap({ pitch: parseFloat(e.target.value) || 0 }));
        els.mapBearing.addEventListener('input', e => updateSelectedMap({ bearing: parseFloat(e.target.value) || 0 }));
        els.mapLabel.addEventListener('input', e => {
            updateSelectedMap({ label: e.target.value });
            els.mapDetailTitle.textContent = e.target.value || 'Untitled Map';
        });
        els.deleteMapBtn.addEventListener('click', deleteMap);

        // Overlays
        els.toggleAllOverlays.addEventListener('click', toggleAllOverlays);
        els.addMapBtn.addEventListener('click', addMapFromForm);

        // Questions
        els.addQuestionBtn.addEventListener('click', addDefaultQuestion);
        els.deleteQuestionBtn.addEventListener('click', deleteSelectedQuestion);
        els.questionText.addEventListener('input', updateSelectedQuestion);
        els.questionType.addEventListener('change', () => {
            updateSelectedQuestion();
            renderQuestionDetails();
        });
        els.questionMapPreset.addEventListener('change', updateSelectedQuestion);
        if (els.questionOptions) els.questionOptions.addEventListener('input', updateSelectedQuestion);
    }

    return {
        initEvents,
        switchTab,
        switchProjectSubtab
    };
}
