export const DEFAULT_STICKER_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
    '#F8B739',
    '#E74C3C'
];

export function getDefaultStickerConfig() {
    return {
        count: DEFAULT_STICKER_COLORS.length,
        colors: [...DEFAULT_STICKER_COLORS]
    };
}
