export function getReadableTextColor(hex) {
    const value = typeof hex === 'string' ? hex.trim() : '';
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
        return '#ffffff';
    }
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.6 ? '#111111' : '#ffffff';
}
