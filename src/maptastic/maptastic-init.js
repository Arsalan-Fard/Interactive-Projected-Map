var configObject = {
    autoSave: false,
    autoLoad: false,
    layers: ["main_container"]
};

window.onload = function() {
    window.maptastic = Maptastic(configObject);
};