import { TAG_IMAGE_PREFIX } from './setup-defaults.js';

export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'item';
}

export function getTagImageSrc(tagId) {
    if (!Number.isFinite(tagId)) return '';
    const safeId = Math.max(0, Math.floor(tagId));
    return `${TAG_IMAGE_PREFIX}${String(safeId).padStart(2, '0')}.png`;
}

export function parseCenter(value) {
    const parts = value.split(',').map(v => parseFloat(v.trim()));
    if (parts.length === 2 && parts.every(v => Number.isFinite(v))) {
        return parts;
    }
    return null;
}

export function formatResponseTime(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

export function parseDateInput(value, isEnd = false) {
    if (!value) return null;
    const parts = value.split('-').map(part => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    if (isEnd) {
        return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}
