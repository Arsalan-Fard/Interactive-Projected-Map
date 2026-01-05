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
    '#E74C3C',
    '#2ECC71',
    '#1ABC9C',
    '#3498DB',
    '#9B59B6',
    '#34495E',
    '#16A085',
    '#27AE60',
    '#2980B9',
    '#8E44AD',
    '#F1C40F',
    '#E67E22',
    '#D35400',
    '#C0392B',
    '#7F8C8D'
];

export function getDefaultStickerConfig() {
    return {
        count: DEFAULT_STICKER_COLORS.length,
        colors: [...DEFAULT_STICKER_COLORS]
    };
}
