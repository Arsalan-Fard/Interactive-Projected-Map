import { formatResponseTime, parseDateInput } from './setup-utils.js';

export function createResponsesManager({ store, els }) {
    function getResponseFilterRange() {
        const start = parseDateInput(els.responsesFilterStart?.value || '');
        const end = parseDateInput(els.responsesFilterEnd?.value || '', true);
        return { start, end };
    }

    function isResponseFilterActive(range) {
        return Boolean(range?.start || range?.end);
    }

    function getFilteredResponses() {
        const range = getResponseFilterRange();
        if (!isResponseFilterActive(range)) return store.responses;
        return store.responses.filter(response => {
            if (!response || !response.savedAt) return false;
            const date = new Date(response.savedAt);
            if (Number.isNaN(date.getTime())) return false;
            if (range.start && date < range.start) return false;
            if (range.end && date > range.end) return false;
            return true;
        });
    }

    function formatResponseFilename(response) {
        if (response && response.__filename) return response.__filename;
        if (!response || !response.savedAt) return 'responses.json';
        const safeTimestamp = String(response.savedAt).replace(/[:.]/g, '-');
        return `responses_${safeTimestamp}.json`;
    }

    function getResponseFilename(response) {
        return response && response.__filename ? response.__filename : formatResponseFilename(response);
    }

    function downloadResponse(response) {
        if (!response) return;
        const filename = getResponseFilename(response);
        const copy = { ...response };
        delete copy.__filename;
        const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function viewResponse(response) {
        if (!response) return;
        const copy = { ...response };
        delete copy.__filename;
        const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, '_blank');
        if (!opened) {
            alert('Popup blocked. Please allow popups to view the response.');
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    async function deleteResponse(filename, { skipConfirm = false } = {}) {
        if (!filename) return false;
        const projectId = store.state.project?.id;
        if (!projectId) {
            alert('No project selected.');
            return false;
        }
        if (!skipConfirm && !confirm(`Delete response "${filename}"? This cannot be undone.`)) {
            return false;
        }
        try {
            const res = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                alert('Failed to delete response.');
                return false;
            }
            return true;
        } catch (err) {
            alert('Failed to delete response.');
            return false;
        }
    }

    function updateResponsesSelectionUI(visibleResponses) {
        const list = Array.isArray(visibleResponses) ? visibleResponses : getFilteredResponses();
        const total = list.length;
        const selectedCount = list.filter(response =>
            store.selectedResponseFilenames.has(getResponseFilename(response))
        ).length;
        const allSelected = total > 0 && selectedCount === total;
        const hasSelection = selectedCount > 0;

        if (els.responsesSelectAll) {
            els.responsesSelectAll.textContent = allSelected ? 'Deselect All' : 'Select All';
            els.responsesSelectAll.disabled = total === 0;
            els.responsesSelectAll.classList.toggle('opacity-50', total === 0);
            els.responsesSelectAll.classList.toggle('cursor-not-allowed', total === 0);
        }
        if (els.responsesViewSelected) {
            els.responsesViewSelected.disabled = !hasSelection;
            els.responsesViewSelected.classList.toggle('opacity-50', !hasSelection);
            els.responsesViewSelected.classList.toggle('cursor-not-allowed', !hasSelection);
        }
        if (els.responsesDeleteSelected) {
            els.responsesDeleteSelected.disabled = !hasSelection;
            els.responsesDeleteSelected.classList.toggle('opacity-50', !hasSelection);
            els.responsesDeleteSelected.classList.toggle('cursor-not-allowed', !hasSelection);
        }
    }

    function renderResponses() {
        if (!els.responsesList) return;
        els.responsesList.innerHTML = '';

        if (!store.responses.length) {
            store.selectedResponseFilenames.clear();
            const empty = document.createElement('div');
            empty.className = 'text-xs text-text-muted italic';
            empty.textContent = 'No responses saved yet.';
            els.responsesList.appendChild(empty);
            updateResponsesSelectionUI([]);
            return;
        }

        const existingFilenames = new Set(store.responses.map(getResponseFilename));
        store.selectedResponseFilenames = new Set(
            Array.from(store.selectedResponseFilenames).filter(name => existingFilenames.has(name))
        );

        const range = getResponseFilterRange();
        const filterActive = isResponseFilterActive(range);
        const filteredResponses = filterActive ? getFilteredResponses() : store.responses;
        if (filterActive) {
            const filteredFilenames = new Set(filteredResponses.map(getResponseFilename));
            store.selectedResponseFilenames = new Set(
                Array.from(store.selectedResponseFilenames).filter(name => filteredFilenames.has(name))
            );
        }

        if (!filteredResponses.length) {
            const empty = document.createElement('div');
            empty.className = 'text-xs text-text-muted italic';
            empty.textContent = filterActive ? 'No responses in this date range.' : 'No responses saved yet.';
            els.responsesList.appendChild(empty);
            updateResponsesSelectionUI(filteredResponses);
            return;
        }

        filteredResponses.forEach(response => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-md text-text-secondary';

            const left = document.createElement('div');
            left.className = 'flex items-start gap-3';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'mt-1 w-[16px] h-[16px] cursor-pointer accent-accent-primary';
            const filename = getResponseFilename(response);
            checkbox.checked = store.selectedResponseFilenames.has(filename);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    store.selectedResponseFilenames.add(filename);
                } else {
                    store.selectedResponseFilenames.delete(filename);
                }
                updateResponsesSelectionUI();
            });

            const textWrap = document.createElement('div');
            textWrap.className = 'flex flex-col';
            const time = document.createElement('span');
            time.className = 'text-text-primary text-sm font-medium';
            time.textContent = formatResponseTime(response.savedAt);
            const filenameText = document.createElement('span');
            filenameText.className = 'text-[11px] text-text-muted';
            filenameText.textContent = filename;
            textWrap.appendChild(time);
            textWrap.appendChild(filenameText);
            left.appendChild(checkbox);
            left.appendChild(textWrap);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2';

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'px-2.5 py-1 text-[11px] border border-border-subtle rounded-md text-text-secondary hover:text-text-primary hover:border-border-focus';
            downloadBtn.textContent = 'Download';
            downloadBtn.addEventListener('click', () => downloadResponse(response));

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'px-2.5 py-1 text-[11px] border border-border-subtle rounded-md text-accent-danger hover:text-white hover:bg-accent-danger hover:border-accent-danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', async () => {
                const ok = await deleteResponse(filename);
                if (ok) {
                    store.selectedResponseFilenames.delete(filename);
                    loadResponses(store.state.project?.id);
                }
            });

            actions.appendChild(downloadBtn);
            actions.appendChild(deleteBtn);

            row.appendChild(left);
            row.appendChild(actions);
            els.responsesList.appendChild(row);
        });

        updateResponsesSelectionUI(filteredResponses);
    }

    async function loadResponses(projectId) {
        if (!els.responsesList) return;
        if (!projectId) {
            store.responses = [];
            renderResponses();
            return;
        }
        try {
            const res = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}`);
            if (res.ok) {
                const data = await res.json();
                store.responses = Array.isArray(data.responses) ? data.responses : [];
            } else {
                store.responses = [];
            }
        } catch (err) {
            store.responses = [];
        }
        renderResponses();
    }

    function scheduleResponsesRefresh() {
        if (store.responsesRefreshTimer) {
            clearTimeout(store.responsesRefreshTimer);
        }
        store.responsesRefreshTimer = setTimeout(() => {
            loadResponses(store.state.project?.id);
        }, 300);
    }

    function toggleSelectAllResponses() {
        const filteredResponses = getFilteredResponses();
        if (!filteredResponses.length) return;
        const allSelected = filteredResponses.every(response =>
            store.selectedResponseFilenames.has(getResponseFilename(response))
        );
        if (allSelected) {
            filteredResponses.forEach(response => {
                store.selectedResponseFilenames.delete(getResponseFilename(response));
            });
        } else {
            filteredResponses.forEach(response => {
                store.selectedResponseFilenames.add(getResponseFilename(response));
            });
        }
        renderResponses();
    }

    function viewSelectedResponses() {
        const selected = store.responses.filter(r => store.selectedResponseFilenames.has(getResponseFilename(r)));
        if (selected.length === 0) {
            alert('No responses selected.');
            return;
        }
        const projectId = store.state.project?.id;
        const params = new URLSearchParams();
        if (projectId) params.set('project', projectId);
        selected.forEach(response => {
            const filename = getResponseFilename(response);
            if (filename) params.append('response', filename);
        });
        window.open(`/results?${params.toString()}`, '_blank');
    }

    async function deleteSelectedResponses() {
        const selected = store.responses.filter(r => store.selectedResponseFilenames.has(getResponseFilename(r)));
        if (selected.length === 0) {
            alert('No responses selected.');
            return;
        }
        const countLabel = selected.length === 1 ? 'this response' : `${selected.length} responses`;
        if (!confirm(`Delete ${countLabel}? This cannot be undone.`)) {
            return;
        }
        for (const response of selected) {
            const filename = getResponseFilename(response);
            // Best-effort deletes; continue through failures.
            await deleteResponse(filename, { skipConfirm: true });
            store.selectedResponseFilenames.delete(filename);
        }
        loadResponses(store.state.project?.id);
    }

    async function uploadResponsesFile(file) {
        if (!file) return;
        const projectId = store.state.project?.id;
        if (!projectId) {
            alert('No project selected.');
            return;
        }
        if (!file.name.toLowerCase().endsWith('.json')) {
            alert('Please upload a JSON file.');
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || data.projectId !== projectId) {
                alert(`Project ID mismatch. Expected "${projectId}".`);
                return;
            }

            const res = await fetch('/api/save_responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    responses: data,
                    filename: file.name,
                    projectId
                })
            });

            if (!res.ok) {
                alert('Failed to upload responses.');
                return;
            }
            await loadResponses(projectId);
        } catch (err) {
            alert('Failed to upload responses.');
        }
    }

    return {
        renderResponses,
        loadResponses,
        scheduleResponsesRefresh,
        toggleSelectAllResponses,
        viewSelectedResponses,
        deleteSelectedResponses,
        uploadResponsesFile
    };
}
