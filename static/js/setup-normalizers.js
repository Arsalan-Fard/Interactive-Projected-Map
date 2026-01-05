import {
    DEFAULT_DRAWING_CONFIG,
    DEFAULT_DRAWING_ITEM,
    DEFAULT_TAG_GROUPS,
    DEFAULT_TAG_SETTINGS_COUNT,
    MAX_STICKER_COUNT,
    MAX_TAG_SETTINGS_COUNT
} from './setup-defaults.js';
import { DEFAULT_STICKER_COLORS } from './sticker-defaults.js';

export function mergeTagItems(defaultItems, existingItems) {
    const byId = new Map();
    (existingItems || []).forEach(item => {
        if (item && item.id) {
            byId.set(item.id, item);
        }
    });
    return defaultItems.map(item => {
        const existing = byId.get(item.id) || {};
        return {
            id: item.id,
            label: item.label,
            enabled: existing.enabled ?? item.enabled ?? true,
            tagId: Number.isInteger(existing.tagId)
                ? existing.tagId
                : (Number.isInteger(item.tagId) ? item.tagId : null)
        };
    });
}

export function normalizeTagConfig(state) {
    if (!state?.project) return;
    const existing = state.project.tagConfig || {};
    const layerItems = (state.overlays || []).map(layer => {
        const layerConfig = (existing.layers?.items || []).find(item => item.id === layer.id) || {};
        return {
            id: layer.id,
            label: layer.label || layer.id,
            enabled: layerConfig.enabled ?? true,
            tagId: Number.isInteger(layerConfig.tagId) ? layerConfig.tagId : null
        };
    });

    state.project.tagConfig = {
        layers: { items: layerItems },
        reach15: { items: mergeTagItems(DEFAULT_TAG_GROUPS.reach15, existing.reach15?.items) },
        isovist: { items: mergeTagItems(DEFAULT_TAG_GROUPS.isovist, existing.isovist?.items) },
        shortestPath: { items: mergeTagItems(DEFAULT_TAG_GROUPS.shortestPath, existing.shortestPath?.items) },
        tools: { items: mergeTagItems(DEFAULT_TAG_GROUPS.tools, existing.tools?.items) }
    };
}

export function normalizeDrawingConfig(state) {
    if (!state?.project) return;
    const existing = state.project.drawingConfig;

    let items = [];
    if (Array.isArray(existing)) {
        items = existing;
    } else if (existing && Array.isArray(existing.items)) {
        items = existing.items;
    } else if (existing && (existing.label || existing.color || existing.tagId !== undefined)) {
        items = [existing];
    } else {
        items = DEFAULT_DRAWING_CONFIG.items;
    }

    const normalized = (Array.isArray(items) ? items : []).map((raw, index) => {
        const fallbackId = `drawing-${index + 1}`;
        const id = typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : fallbackId;
        const label = typeof raw?.label === 'string' && raw.label.trim().length > 0
            ? raw.label
            : DEFAULT_DRAWING_ITEM.label;
        let color = typeof raw?.color === 'string' ? raw.color.trim() : '';
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
            if (color.toLowerCase() === 'magenta' || color.toLowerCase() === 'fuchsia') {
                color = DEFAULT_DRAWING_ITEM.color;
            } else {
                color = DEFAULT_DRAWING_ITEM.color;
            }
        }
        const tagId = Number.isInteger(raw?.tagId) ? raw.tagId : DEFAULT_DRAWING_ITEM.tagId;
        return { id, label, color, tagId };
    });

    if (normalized.length === 0) {
        normalized.push({ ...DEFAULT_DRAWING_ITEM });
    }

    state.project.drawingConfig = { items: normalized };
}

export function clampStickerCount(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(MAX_STICKER_COUNT, value));
}

export function normalizeStickerConfig(state) {
    if (!state?.project) return;
    const existing = state.project.stickerConfig || {};
    let count = Number.isInteger(existing.count) ? existing.count : null;

    if (!count) {
        if (Array.isArray(existing.colors) && existing.colors.length > 0) {
            count = existing.colors.length;
        } else {
            count = MAX_STICKER_COUNT;
        }
    }

    count = clampStickerCount(count);
    const colors = Array.isArray(existing.colors) ? existing.colors.slice(0, MAX_STICKER_COUNT) : [];
    const tags = Array.isArray(existing.tags) ? existing.tags.slice(0, MAX_STICKER_COUNT) : [];

    while (colors.length < count) {
        const fallback = DEFAULT_STICKER_COLORS[colors.length] || '#cccccc';
        colors.push(fallback);
    }

    while (tags.length < count) {
        tags.push(null);
    }

    state.project.stickerConfig = {
        count,
        colors: colors.slice(0, count),
        tags: tags.slice(0, count)
    };
}

export function clampTagSettingsCount(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(MAX_TAG_SETTINGS_COUNT, value));
}

export function normalizeTagSettings(state) {
    if (!state?.project) return;
    const existing = state.project.tagSettings || {};
    let count = Number.isInteger(existing.count) ? existing.count : null;
    const rawItems = Array.isArray(existing.items) ? existing.items : [];

    if (!count) {
        count = rawItems.length > 0 ? rawItems.length : DEFAULT_TAG_SETTINGS_COUNT;
    }

    count = clampTagSettingsCount(count);
    const items = rawItems.slice(0, count).map(item => {
        const label = typeof item?.label === 'string' ? item.label.trim() : '';
        const tagId = Number.isInteger(item?.tagId) ? item.tagId : null;
        return { label, tagId };
    });

    while (items.length < count) {
        items.push({ label: '', tagId: null });
    }

    state.project.tagSettings = {
        count,
        items: items.slice(0, count)
    };
}
