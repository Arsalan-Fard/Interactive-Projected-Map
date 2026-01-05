import { defaultState } from './setup-defaults.js';
import {
    normalizeDrawingConfig,
    normalizeStickerConfig,
    normalizeTagConfig,
    normalizeTagSettings
} from './setup-normalizers.js';

export function createApi({
    store,
    renderProject,
    renderMapCards,
    renderMapDetails,
    renderOverlayList,
    renderQuestions,
    renderProjectDropdown,
    renderResponses,
    loadResponses,
    markSaved,
    buildPreviewConfig
}) {
    async function fetchServerConfig() {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const data = await res.json();
                return data;
            }
        } catch (err) {
            console.warn('No server config found', err);
        }
        return null;
    }

    function mergeState(serverConfig) {
        if (!serverConfig) return;
        store.state = JSON.parse(JSON.stringify(defaultState));
        store.state.project = { ...defaultState.project, ...(serverConfig.project || {}) };
        store.state.overlays = (serverConfig.overlays && serverConfig.overlays.length > 0) ? serverConfig.overlays : defaultState.overlays;
        store.state.maps = (serverConfig.maps && serverConfig.maps.length > 0) ? serverConfig.maps : defaultState.maps;
        store.state.questions = serverConfig.questions || serverConfig.questionFlow || defaultState.questions;
        // Flatten if we got groups from old config
        if (serverConfig.questionGroups) {
            store.state.questions = [];
            serverConfig.questionGroups.forEach(g => {
                if (g.questions) store.state.questions.push(...g.questions);
            });
        }

        if (!store.state.project.mapId && store.state.maps.length) {
            store.state.project.mapId = store.state.maps[0].id;
        }

        normalizeTagConfig(store.state);
        normalizeDrawingConfig(store.state);
        normalizeStickerConfig(store.state);
        normalizeTagSettings(store.state);
    }

    async function loadProjectsList() {
        try {
            const res = await fetch('/api/projects');
            if (res.ok) {
                store.projects = await res.json();
            } else {
                store.projects = [];
            }
        } catch (err) {
            store.projects = [];
        }
        renderProjectDropdown();
    }

    async function loadProjectById(projectId) {
        try {
            const res = await fetch(`/api/config?project=${encodeURIComponent(projectId)}`);
            if (res.ok) {
                const cfg = await res.json();
                mergeState(cfg);
                renderProject();
                renderMapCards();
                renderMapDetails();
                renderOverlayList();
                renderQuestions();
                renderProjectDropdown();

                await loadResponses(projectId);
                markSaved(`Loaded ${projectId}`);
                return;
            }
        } catch (err) {
        }
        store.responses = [];
        renderResponses();
        markSaved('Failed to load project');
    }

    async function persistStateToServer() {
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: buildPreviewConfig() })
            });
            if (response.ok) {
                markSaved('Saved to server');
                await loadProjectsList();
            } else {
                markSaved('Server save failed');
            }
        } catch (error) {
            markSaved('Server save failed');
        }
    }

    async function deleteCurrentProject() {
        if (!store.state.project || !store.state.project.id) {
            alert('No project selected');
            return;
        }

        const projectName = store.state.project.name || store.state.project.id;
        if (!confirm(`Are you sure you want to delete project "${projectName}"?\nThis action cannot be undone.`)) {
            return;
        }

        try {
            const res = await fetch(`/api/projects/${store.state.project.id}`, { method: 'DELETE' });
            if (res.ok) {
                await loadProjectsList();
                // Reset to default state
                store.state = JSON.parse(JSON.stringify(defaultState));
                renderProject();
                renderMapCards();
                renderMapDetails();
                renderOverlayList();
                renderQuestions();
                loadResponses(store.state.project.id);
                markSaved('Project deleted');
            } else {
                alert('Failed to delete project');
            }
        } catch (err) {
            alert('Error deleting project');
        }
    }

    return {
        fetchServerConfig,
        mergeState,
        loadProjectsList,
        loadProjectById,
        persistStateToServer,
        deleteCurrentProject
    };
}
