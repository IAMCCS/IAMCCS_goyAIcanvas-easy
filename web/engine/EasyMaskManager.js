export default class EasyMaskManager {
    constructor(eventBus, layerManager) {
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.activeTool = "cursor";
        this.paintToMask = false;
        this.overlayEnabled = false;
        this.overlayStyle = { color: "rgba(255, 59, 59, 0.42)" };
        this.brush = { brush: "brush", size: 32, opacity: 1, hardness: 0.75, color: "#ffffff" };
        this.eraserBrush = { size: 32, opacity: 1, hardness: 0.75 };
        this.vectorBrush = { size: 4, opacity: 1, color: "#ffffff" };
        this.vectorOptions = { shape: "path", fill: false, autoclose: true, doubleBezier: false };
        this.lassoOptions = { fill: false, autoclose: true };
        this.scaleOptions = { keepAspect: true };
        this._bindEvents();
    }

    _bindEvents() {
        this.eventBus?.on?.("tool:change", (toolId) => this.setActiveTool(toolId));
        this.eventBus?.on?.("brush:update", (patch = {}) => this.updateBrush(patch));
        this.eventBus?.on?.("eraser:brush", (patch = {}) => { this.eraserBrush = { ...this.eraserBrush, ...patch }; });
        this.eventBus?.on?.("vector:brush", (patch = {}) => { this.vectorBrush = { ...this.vectorBrush, ...patch }; });
        this.eventBus?.on?.("vector:shape", ({ shape } = {}) => { if (shape) this.vectorOptions = { ...this.vectorOptions, shape }; });
        this.eventBus?.on?.("vector:options", (patch = {}) => { this.vectorOptions = { ...this.vectorOptions, ...patch }; });
        this.eventBus?.on?.("lasso:options", (patch = {}) => { this.lassoOptions = { ...this.lassoOptions, ...patch }; });
        this.eventBus?.on?.("scale:options", (patch = {}) => { this.scaleOptions = { ...this.scaleOptions, ...patch }; });
        this.eventBus?.on?.("mask:paintMode", ({ enabled } = {}) => {
            this.paintToMask = !!enabled;
            this.eventBus?.emit?.("mask:paintMode:changed", { enabled: this.paintToMask });
        });
        this.eventBus?.on?.("mask:overlay", ({ enabled } = {}) => {
            this.overlayEnabled = !!enabled;
            this.eventBus?.emit?.("mask:overlay:changed", { enabled: this.overlayEnabled });
        });
        this.eventBus?.on?.("mask:overlayStyle", (style = {}) => {
            if (style?.color) this.overlayStyle = { ...this.overlayStyle, color: style.color };
            this.eventBus?.emit?.("mask:overlay:changed", { enabled: this.overlayEnabled, style: this.overlayStyle });
        });
    }

    setActiveTool(toolId) {
        this.activeTool = typeof toolId === "string" && toolId ? toolId : "cursor";
        this.eventBus?.emit?.("tool:changed", { tool: this.activeTool });
    }

    updateBrush(patch = {}) {
        this.brush = { ...this.brush, ...patch };
        if (patch.size != null) {
            this.eraserBrush = { ...this.eraserBrush, size: Number(patch.size) || this.eraserBrush.size };
            this.vectorBrush = { ...this.vectorBrush, size: Number(patch.size) || this.vectorBrush.size };
        }
        if (patch.color) this.vectorBrush = { ...this.vectorBrush, color: patch.color };
    }

    getBrushSettings() { return { ...this.brush }; }
    getEraserBrushSettings() { return { ...this.eraserBrush }; }
    getVectorBrushSettings() { return { ...this.vectorBrush }; }
    getVectorOptions() { return { ...this.vectorOptions }; }
    getLassoOptions() { return { ...this.lassoOptions }; }
    getLassoBrushSettings() { return { ...this.brush }; }
    getScaleOptions() { return { ...this.scaleOptions }; }
    isPaintToMask() { return !!this.paintToMask; }
    isOverlayEnabled() { return !!this.overlayEnabled; }
    getOverlayStyle() { return { ...this.overlayStyle }; }
    getLayerMaskOverlayStyle() { return this.getOverlayStyle(); }

    exportMaskStack() {
        const layers = this.layerManager?.getLayers?.() || [];
        return layers
            .filter((layer) => layer?.mask)
            .map((layer) => ({ id: layer.id, mask: layer.mask }));
    }
}
