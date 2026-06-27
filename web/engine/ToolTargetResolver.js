import { ensureEasyLayer, getEasyRoleForMode } from "../modes/easy/easyLayerRuntime.js";
import { debugTrace } from "../utils/DebugTrace.js";

export default class ToolTargetResolver {
    constructor(eventBus, layerManager) {
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.easyMode = "t2i";
        this.drawOnly = false;
        this.directPaintOnActiveLayer = false;

        this.eventBus.on("easy:mode:change", ({ mode } = {}) => {
            this.easyMode = mode || "t2i";
        });
        this.eventBus.on("canvas:mode", ({ drawOnly } = {}) => {
            this.drawOnly = !!drawOnly;
        });
        this.eventBus.on("tool:target:direct", ({ enabled } = {}) => {
            this.directPaintOnActiveLayer = !!enabled;
        });
    }

    resolveStrokeLayer(tool) {
        const directLayer = this._resolveDirectLayer();
        if (directLayer !== undefined) {
            return directLayer;
        }
        if (this._shouldUseEasyTarget(tool)) {
            return this.ensureEasyManagedLayer();
        }
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (tool === "eraser") {
            if (!layer || layer.locked) return null;
            return layer;
        }
        if (this._requiresNewPaintLayer(layer)) {
            return this._createLayer();
        }
        return layer;
    }

    resolveFillLayer() {
        const directLayer = this._resolveDirectLayer();
        if (directLayer !== undefined) {
            return directLayer;
        }
        if (this._shouldUseEasyTarget("fill")) {
            return this.ensureEasyManagedLayer();
        }
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (this._requiresNewPaintLayer(layer)) {
            return this._createLayer();
        }
        return layer;
    }

    resolveLassoLayer() {
        const directLayer = this._resolveDirectLayer();
        if (directLayer !== undefined) {
            return directLayer;
        }
        if (this._shouldUseEasyTarget("lasso")) {
            return this.ensureEasyManagedLayer();
        }
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (this._requiresNewPaintLayer(layer)) {
            return this._createLayer();
        }
        return layer;
    }

    resolveVectorLayer() {
        const directLayer = this._resolveDirectLayer();
        if (directLayer !== undefined) {
            return directLayer;
        }
        if (this._shouldUseEasyTarget("vector")) {
            return this.ensureEasyManagedLayer();
        }
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (layer && !layer.locked && layer.id !== "layer_background") {
            return layer;
        }
        if (this._requiresNewPaintLayer(layer)) {
            return this._createLayer("Vector");
        }
        return layer;
    }

    resolveWritableLayer() {
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (!layer || layer.locked || layer.id === "layer_background") {
            return this._createLayer();
        }
        return layer;
    }

    resolveTransformLayer() {
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (!layer || layer.locked || layer.id === "layer_background") {
            return null;
        }
        return layer;
    }

    ensureEasyManagedLayer() {
        const role = this._getEasyRole();
        if (!role) return null;
        const layer = ensureEasyLayer(this.layerManager, role, this._getEasyLayerName(role));
        if (!layer) return null;
        debugTrace('[ToolTargetResolver] ensureEasyManagedLayer', {
            role,
            easyMode: this.easyMode,
            drawOnly: this.drawOnly,
            layerId: layer.id,
            layerName: layer.name,
            activeLayerIdBefore: this.layerManager.getActiveLayerId?.() || null,
        });
        this.layerManager.moveToTop?.(layer.id);
        this.layerManager.selectLayer?.(layer.id);
        debugTrace('[ToolTargetResolver] ensureEasyManagedLayer:selected', {
            activeLayerIdAfter: this.layerManager.getActiveLayerId?.() || null,
            activeLayerNameAfter: this.layerManager.getActiveLayer?.()?.name || null,
        });
        return this.layerManager.getActiveLayer?.() || layer;
    }

    _shouldUseEasyTarget(tool) {
        if (!["brush", "pencil", "eraser", "fill", "lasso", "vector", "vector_fill", "liquify"].includes(tool)) {
            return false;
        }
        if (this.directPaintOnActiveLayer) {
            return false;
        }
        return this.drawOnly || this.easyMode === "i2i" || this.easyMode === "inpaint";
    }

    _getEasyRole() {
        if (this.drawOnly && this.easyMode !== "inpaint") {
            return getEasyRoleForMode("draw");
        }
        return getEasyRoleForMode(this.easyMode);
    }

    _getEasyLayerName(role) {
        if (role === getEasyRoleForMode("inpaint")) return "Easy Inpaint Mask";
        if (role === getEasyRoleForMode("i2i")) return "Easy Paint Layer";
        return "Easy Paint Layer";
    }

    _requiresNewPaintLayer(layer) {
        if (this.directPaintOnActiveLayer && layer && !layer.locked && layer.id !== "layer_background") {
            return false;
        }
        return !layer || layer.locked || layer.id === "layer_background" || !!(layer?.metadata?.source?.type === "import");
    }

    _resolveDirectLayer() {
        if (!this.directPaintOnActiveLayer) {
            return undefined;
        }
        const layer = this.layerManager.getActiveLayer?.() || null;
        if (!layer || layer.locked || layer.id === "layer_background") {
            return null;
        }
        return layer;
    }

    _createLayer(name = null) {
        const created = this.layerManager.addLayer?.(name);
        if (!created) return null;
        this.layerManager.selectLayer?.(created.id);
        return created;
    }
}
