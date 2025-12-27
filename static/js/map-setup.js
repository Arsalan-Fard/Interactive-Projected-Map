import { CONFIG } from './config.js';

function setActiveStyleButton(styleUrl, styles) {
    Object.keys(styles).forEach(key => {
        const btn = document.getElementById(key);
        if (btn) {
            btn.classList.toggle('active', styles[key] === styleUrl);
        }
    });
}

export function initMap({ setupConfig, add3DBuildings, loadAndRenderLayer, onStyleLoad }) {
    mapboxgl.accessToken = CONFIG.accessToken;

    const map = new mapboxgl.Map({
        container: 'map',
        style: setupConfig.map.style,
        center: setupConfig.map.center,
        zoom: setupConfig.map.zoom,
        pitch: setupConfig.map.pitch,
        bearing: setupConfig.map.bearing,
        attributionControl: false,
        trackResize: false
    });

    const overlayState = { current: new Set(setupConfig.map.overlays || []) };

    map.on('style.load', () => {
        if (typeof add3DBuildings === 'function') {
            add3DBuildings(map);
        }

        if (setupConfig.overlays && typeof loadAndRenderLayer === 'function') {
            setupConfig.overlays.forEach(layer => {
                const isVisible = overlayState.current.has(layer.id);
                loadAndRenderLayer(map, layer, isVisible);
            });
        }

        if (typeof onStyleLoad === 'function') {
            onStyleLoad();
        }
    });

    const styles = {
        'btn-light': 'mapbox://styles/mapbox/light-v11',
        'btn-dark': 'mapbox://styles/mapbox/dark-v11',
        'btn-streets': 'mapbox://styles/mapbox/streets-v12',
        'btn-satellite': 'mapbox://styles/mapbox/satellite-streets-v12'
    };

    Object.keys(styles).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                map.setStyle(styles[id]);
                setActiveStyleButton(styles[id], styles);
                btn.blur();
            });
        }
    });
    setActiveStyleButton(setupConfig.map.style, styles);

    return { map, overlayState };
}
