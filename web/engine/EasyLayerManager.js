import Constants from "../utils/Constants.js";

const clone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return value; }
};

export default class EasyLayerManager {
    constructor(eventBus, options = {}) {
        this.eventBus = eventBus;
        this.layers = [];
        this.activeLayerId = null;
        this.width = Number(options.width || Constants.CANVAS_WIDTH);
        this.height = Number(options.height || Constants.CANVAS_HEIGHT);
        this._nextId = 1;
        this._history = [];
        this._redo = [];
        this.eventBus?.on?.("project:hydrate", (payload) => this.hydrate(payload));
        this.eventBus?.on?.("project:clear", () => this.bootstrapDefaultLayers({ reset: true }));
        this.eventBus?.on?.("canvas:resize", ({ width, height } = {}) => {
            if (Number.isFinite(Number(width))) this.width = Number(width);
            if (Number.isFinite(Number(height))) this.height = Number(height);
        });
        this.eventBus?.on?.("history:undo", () => this.undo());
        this.eventBus?.on?.("history:redo", () => this.redo());
    }

    bootstrapDefaultLayers(options = {}) {
        if (this.layers.length && !options.reset) return;
        this.layers = [this._backgroundLayer()];
        this.activeLayerId = "layer_background";
        this._history = [];
        this._redo = [];
        this._emitChanged();
        this.selectLayer(this.activeLayerId);
    }

    _backgroundLayer() {
        return {
            id: "layer_background",
            name: Constants.BACKGROUND_LAYER_NAME || "Background",
            visible: true,
            locked: true,
            opacity: 1,
            blendMode: "normal",
            bitmap: "",
            mask: "",
            metadata: { backgroundColor: "#101318", easyRole: "background" },
            active: false,
        };
    }

    _newLayer(name = "Paint Layer") {
        const id = `layer_${this._nextId++}`;
        return { id, name, visible: true, locked: false, opacity: 1, blendMode: "normal", bitmap: "", mask: "", metadata: {}, active: false };
    }

    getLayers() { return this.layers; }
    getLayerById(id) { return this.layers.find((layer) => layer.id === id) || null; }
    getActiveLayerId() { return this.activeLayerId; }
    getActiveLayer() { return this.getLayerById(this.activeLayerId) || null; }

    addLayer(name = "Paint Layer") {
        this.snapshot();
        const layer = this._newLayer(name || "Paint Layer");
        this.layers.push(layer);
        this.activeLayerId = layer.id;
        this._emitChanged();
        this.selectLayer(layer.id);
        return layer;
    }

    replaceWithRasterDocument(dataUrl, options = {}) {
        const width = Math.max(1, Math.round(Number(options.width || this.width) || this.width || Constants.CANVAS_WIDTH));
        const height = Math.max(1, Math.round(Number(options.height || this.height) || this.height || Constants.CANVAS_HEIGHT));
        const previousBackground = this.getLayerById("layer_background")?.metadata?.backgroundColor || "#101318";
        const background = this._backgroundLayer();
        background.metadata = {
            ...(background.metadata || {}),
            backgroundColor: options.backgroundColor || previousBackground,
            easyRole: "background",
        };
        const layer = this._newLayer(options.name || "Cropped Image");
        layer.bitmap = dataUrl || "";
        layer.mask = "";
        layer.opacity = 1;
        layer.blendMode = "normal";
        layer.metadata = {
            source: { type: "crop", mode: "easy-crop" },
            originalWidth: width,
            originalHeight: height,
            easyRole: "import",
        };

        this.snapshot();
        this.width = width;
        this.height = height;
        this.layers = [background, layer];
        this.activeLayerId = layer.id;
        this._emitChanged();
        this.selectLayer(layer.id);
        return layer;
    }

    removeLayer(id) {
        const layer = this.getLayerById(id);
        if (!layer || layer.locked || layer.id === "layer_background") return false;
        this.snapshot();
        this.layers = this.layers.filter((item) => item.id !== id);
        if (this.activeLayerId === id) {
            const next = [...this.layers].reverse().find((item) => !item.locked) || this.layers[0] || null;
            this.activeLayerId = next?.id || null;
        }
        this.eventBus?.emit?.("layer:delete", id);
        this._emitChanged();
        this.selectLayer(this.activeLayerId);
        return true;
    }

    selectLayer(id) {
        if (id && !this.getLayerById(id)) return;
        this.activeLayerId = id || null;
        this.layers.forEach((layer) => { layer.active = layer.id === this.activeLayerId; });
        this.eventBus?.emit?.("layer:selected", this.getActiveLayer());
        this._emitChanged(false);
    }

    updateLayer(input = {}) {
        const layer = this.getLayerById(input.id);
        if (!layer) return null;
        const patch = input.patch || {};
        const next = { ...layer, ...patch };
        if (patch.metadata) next.metadata = { ...(layer.metadata || {}), ...(patch.metadata || {}) };
        if (patch.source) next.source = { ...(layer.source || {}), ...(patch.source || {}) };
        Object.assign(layer, next);
        this._emitChanged(input.announce !== false);
        return layer;
    }

    moveToTop(id) {
        const index = this.layers.findIndex((layer) => layer.id === id);
        if (index < 0) return null;
        const [layer] = this.layers.splice(index, 1);
        this.layers.push(layer);
        this._emitChanged();
        return layer;
    }

    reorderLayers(orderedIds = []) {
        const ids = Array.isArray(orderedIds) ? orderedIds.map((id) => String(id || "")).filter(Boolean) : [];
        if (!ids.length) return false;
        const byId = new Map(this.layers.map((layer) => [layer.id, layer]));
        const background = byId.get("layer_background") || this.layers.find((layer) => layer.locked) || null;
        const next = [];
        if (background) next.push(background);
        for (const id of ids) {
            const layer = byId.get(id);
            if (!layer || layer.id === "layer_background" || next.includes(layer)) continue;
            next.push(layer);
        }
        for (const layer of this.layers) {
            if (!layer || layer.id === "layer_background" || next.includes(layer)) continue;
            next.push(layer);
        }
        if (next.length !== this.layers.length) return false;
        const before = this.layers.map((layer) => layer.id).join("|");
        const after = next.map((layer) => layer.id).join("|");
        if (before === after) return false;
        this.snapshot();
        this.layers = next;
        this._emitChanged();
        this.selectLayer(this.activeLayerId);
        return true;
    }

    snapshot() {
        this._history.push({ layers: clone(this.layers), activeLayerId: this.activeLayerId, nextId: this._nextId });
        if (this._history.length > Constants.HISTORY_LIMIT) this._history.shift();
        this._redo = [];
    }

    undo() {
        const state = this._history.pop();
        if (!state) return false;
        this._redo.push({ layers: clone(this.layers), activeLayerId: this.activeLayerId, nextId: this._nextId });
        this._restoreState(state);
        return true;
    }

    redo() {
        const state = this._redo.pop();
        if (!state) return false;
        this._history.push({ layers: clone(this.layers), activeLayerId: this.activeLayerId, nextId: this._nextId });
        this._restoreState(state);
        return true;
    }

    hydrate(payload = {}) {
        if (!payload || typeof payload !== "object") return;
        if (Array.isArray(payload.layers) && payload.layers.length) {
            this.layers = payload.layers.map((layer) => ({ visible: true, locked: false, opacity: 1, blendMode: "normal", bitmap: "", mask: "", metadata: {}, ...clone(layer) }));
            if (!this.layers.some((layer) => layer.id === "layer_background")) this.layers.unshift(this._backgroundLayer());
            this.activeLayerId = payload.activeLayerId || payload.active_layer_id || this.layers.find((layer) => !layer.locked)?.id || "layer_background";
            this._emitChanged();
            this.selectLayer(this.activeLayerId);
        }
    }

    _restoreState(state) {
        this.layers = clone(state.layers || []);
        this.activeLayerId = state.activeLayerId || null;
        this._nextId = Number(state.nextId || this._nextId) || this._nextId;
        this._emitChanged();
        this.selectLayer(this.activeLayerId);
    }

    _emitChanged(render = true) {
        this.eventBus?.emit?.("layers:changed", this.getLayers());
        if (render) this.eventBus?.emit?.("canvas:render:request", { source: "easy-layer-manager" });
    }
}

