import { getMapCoordsFromScreen } from './ui.js';

const THIRD_QUESTION_INDEX = 2;
const GLOW_CLASS = 'reaction-glow';
const GLOW_STYLE_ID = 'reaction-glow-style';

function getStickerElements() {
    return Array.from(document.querySelectorAll('.draggable-sticker, .tag-controlled-sticker'));
}

function getStickerLocation(map, sticker) {
    const rawLng = Number.parseFloat(sticker.dataset.lng);
    const rawLat = Number.parseFloat(sticker.dataset.lat);
    if (Number.isFinite(rawLng) && Number.isFinite(rawLat)) {
        return { lng: rawLng, lat: rawLat, source: 'dataset' };
    }

    const marker = sticker._marker;
    if (marker && typeof marker.getLngLat === 'function') {
        const pos = marker.getLngLat();
        if (pos && Number.isFinite(pos.lng) && Number.isFinite(pos.lat)) {
            return { lng: pos.lng, lat: pos.lat, source: 'marker' };
        }
    }

    if (!map) return null;
    const rect = sticker.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const coords = getMapCoordsFromScreen(map, centerX, centerY);
    if (!coords) return null;
    return { lng: coords.lng, lat: coords.lat, source: 'screen' };
}

function ensureGlowStyles() {
    if (document.getElementById(GLOW_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = GLOW_STYLE_ID;
    style.textContent = `
@keyframes reactionGlowPulse {
  0% {
    opacity: 0.85;
    transform: translate(-50%, -50%) scale(0.9);
    box-shadow: 0 0 6px 2px rgba(255, 255, 255, 0.45);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.6);
    box-shadow: 0 0 18px 10px rgba(255, 255, 255, 0.95);
  }
  100% {
    opacity: 0.85;
    transform: translate(-50%, -50%) scale(0.9);
    box-shadow: 0 0 6px 2px rgba(255, 255, 255, 0.45);
  }
}
.${GLOW_CLASS} {
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.8));
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
}
.${GLOW_CLASS}::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  pointer-events: none;
  animation: reactionGlowPulse 1.6s ease-in-out infinite;
}
`;
    document.head.appendChild(style);
}

function getStickerScreenPoint(map, sticker, location) {
    if (map && location && typeof map.project === 'function') {
        try {
            const projected = map.project([location.lng, location.lat]);
            if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
                return { x: projected.x, y: projected.y };
            }
        } catch {
            // ignore
        }
    }

    const rect = sticker.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

function findFurthestPair(items) {
    let best = null;
    let bestDist2 = -Infinity;
    for (let i = 0; i < items.length - 1; i += 1) {
        const a = items[i];
        for (let j = i + 1; j < items.length; j += 1) {
            const b = items[j];
            const dx = a.point.x - b.point.x;
            const dy = a.point.y - b.point.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 > bestDist2) {
                bestDist2 = dist2;
                best = [a.sticker, b.sticker];
            }
        }
    }
    return best;
}

export function initReactions({ map } = {}) {
    if (typeof window === 'undefined') return null;
    let lastGlowing = [];

    const handleQuestionChange = (event) => {
        const detail = event?.detail || {};
        const index = Number(detail.index);
        if (!Number.isFinite(index)) return;
        ensureGlowStyles();

        const isThird = index === THIRD_QUESTION_INDEX;
        console.log('[reaction] question change', {
            index,
            isThird,
            workshopMode: !!detail.workshopMode
        });
        lastGlowing.forEach(sticker => sticker.classList.remove(GLOW_CLASS));
        lastGlowing = [];
        if (!isThird) return;

        const stickers = getStickerElements();
        if (stickers.length < 2) {
            console.log('[reaction] third question: not enough stickers to compare');
            return;
        }

        const items = [];
        stickers.forEach(sticker => {
            const location = getStickerLocation(map, sticker);
            if (!location) return;
            const point = getStickerScreenPoint(map, sticker, location);
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            items.push({ sticker, point });
        });

        if (items.length < 2) {
            console.log('[reaction] third question: missing sticker positions');
            return;
        }
        const pair = findFurthestPair(items);
        if (!pair) return;
        pair.forEach(sticker => sticker.classList.add(GLOW_CLASS));
        lastGlowing = pair;
        console.log('[reaction] third question: glowing furthest stickers', pair.map(sticker => ({
            color: sticker.dataset.color || null,
            typeId: sticker.dataset.typeId || null,
            tagId: sticker.dataset.tagId || null,
            questionId: sticker.dataset.questionId || null
        })));
    };

    window.addEventListener('question-change', handleQuestionChange);
    return {
        stop() {
            window.removeEventListener('question-change', handleQuestionChange);
        }
    };
}
