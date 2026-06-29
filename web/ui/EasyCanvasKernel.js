export default class EasyCanvasKernel {
    constructor(canvas, eventBus, layerManager, maskManager) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { willReadFrequently: true });
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.maskManager = maskManager;
        this.imageCache = new Map();
        this.maskCache = new Map();
        this.activeTool = "cursor";
        this.drawing = null;
        this.transforming = null;
        this.renderQueued = false;
        this.cropActive = false;
        this.toolTargetResolver = {
            ensureEasyManagedLayer: () => this._ensureWritableLayer(),
            resolveStrokeLayer: () => this._ensureWritableLayer(),
            resolveFillLayer: () => this._ensureWritableLayer(),
        };
        this._bindEvents();
        this._bindPointerEvents();
    }

    _bindEvents() {
        this.eventBus?.on?.("layers:changed", () => this.requestRender());
        this.eventBus?.on?.("layer:selected", () => this.requestRender());
        this.eventBus?.on?.("canvas:render:request", () => this.requestRender());
        this.eventBus?.on?.("canvas:refresh", () => this.requestRender());
        this.eventBus?.on?.("background:color:update", () => this.requestRender());
        this.eventBus?.on?.("tool:change", (tool) => { this.activeTool = String(tool || "cursor"); });
        this.eventBus?.on?.("canvas:crop:state", ({ active } = {}) => { this.cropActive = !!active; });
        this.eventBus?.on?.("layer:delete", (id) => {
            if (!id) return;
            this.imageCache.delete(id);
            this.maskCache.delete(id);
            this.requestRender();
        });
    }

    _bindPointerEvents() {
        this._down = (event) => this._onPointerDown(event);
        this._move = (event) => this._onPointerMove(event);
        this._up = (event) => this._onPointerUp(event);
        this.canvas.addEventListener("pointerdown", this._down);
        this.canvas.addEventListener("pointermove", this._move);
        this.canvas.addEventListener("pointerup", this._up);
        this.canvas.addEventListener("pointercancel", this._up);
        this.canvas.addEventListener("pointerleave", this._up);
        window.addEventListener("pointerup", this._up);
        window.addEventListener("pointercancel", this._up);
    }

    resize(width, height) {
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        this.canvas.width = w;
        this.canvas.height = h;
        this.layerManager.width = w;
        this.layerManager.height = h;
        this.requestRender();
    }

    requestRender() { this._requestRender(); }

    _requestRender() {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }

    render() {
        if (!this.ctx) return;
        const width = this.canvas.width || 1;
        const height = this.canvas.height || 1;
        const layers = this.layerManager?.getLayers?.() || [];
        this.ctx.save();
        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = this._backgroundColor(layers);
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.restore();

        for (const layer of layers) {
            const liveCanvas = this._liveCanvasForLayer(layer, false);
            if (!layer || layer.id === "layer_background" || layer.visible === false || (!layer.bitmap && !liveCanvas)) continue;
            const cached = liveCanvas || this._imageForLayer(layer);
            if (!cached) continue;
            this.ctx.save();
            this.ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1;
            this.ctx.globalCompositeOperation = this._blendMode(layer.blendMode || layer.blend_mode);
            this._drawLayerImage(this.ctx, cached, layer);
            this.ctx.restore();
        }

        if (this.maskManager?.isOverlayEnabled?.() || this.maskManager?.isPaintToMask?.()) {
            this._drawMaskOverlays(layers);
        }
    }

    exportComposite() {
        this.render();
        return this.canvas.toDataURL("image/png");
    }

    async bakeLayerBitmapOnWhite(layerId) {
        const layer = this.layerManager?.getLayerById?.(layerId);
        if (!layer?.bitmap) return false;
        const image = await this._loadImage(layer.bitmap);
        if (!image) return false;
        const out = document.createElement("canvas");
        out.width = this.canvas.width || 1;
        out.height = this.canvas.height || 1;
        const ctx = out.getContext("2d", { willReadFrequently: true });
        if (!ctx) return false;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
        const dataUrl = out.toDataURL("image/png");
        this._updateBitmapLayerFromDataUrl(layer.id, dataUrl, out);
        this.layerManager.updateLayer?.({
            id: layer.id,
            patch: {
                bitmap: dataUrl,
                metadata: {
                    ...(layer.metadata || {}),
                    easyWhiteBase: true,
                    easyDrawSurface: "baked-white",
                },
            },
        });
        return true;
    }

    clearTransientState() {
        this.drawing = null;
    }

    _syncImageCache(layers = []) {
        for (const layer of layers || []) {
            if (!layer?.id || !layer.bitmap) continue;
            if (!this.imageCache.has(layer.id)) this._primeImage(layer.id, layer.bitmap);
        }
        this.requestRender();
    }

    _updateBitmapLayerFromDataUrl(layerId, dataUrl, drawable = null) {
        if (!layerId || !dataUrl) return;
        if (drawable) {
            this.imageCache.set(layerId, { image: drawable, src: dataUrl });
        } else {
            this._primeImage(layerId, dataUrl);
        }
        this.requestRender();
    }

    pickLayerAtPoint(point = {}) {
        const layers = (this.layerManager?.getLayers?.() || []).slice().reverse();
        const x = Number(point.x);
        const y = Number(point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        for (const layer of layers) {
            if (!layer || layer.id === "layer_background" || layer.visible === false || !layer.bitmap) continue;
            const image = this._imageForLayer(layer);
            const w = image?.naturalWidth || image?.width || 0;
            const h = image?.naturalHeight || image?.height || 0;
            if (x >= 0 && y >= 0 && x <= w && y <= h) return layer;
        }
        return null;
    }

    beginExternalTransform(mode = "move", point = {}) {
        const layer = this._resolveTransformLayer(point);
        if (!layer) return false;
        this._beginTransform(String(mode || "move"), point, layer);
        return true;
    }

    updateExternalTransform(point = {}) {
        if (!this.transforming) return false;
        this._updateTransform(point);
        return true;
    }

    commitExternalTransform() {
        if (!this.transforming) return false;
        this._finishTransform();
        return true;
    }

    async _onPointerDown(event) {
        if (this.cropActive || event.button !== 0) return;
        const tool = this.maskManager?.activeTool || this.activeTool || "cursor";
        if (["move", "scale", "rotate"].includes(tool)) {
            const point = this._eventPoint(event);
            const layer = this._resolveTransformLayer(point);
            if (!layer) return;
            event.preventDefault();
            event.stopPropagation();
            this.canvas.setPointerCapture?.(event.pointerId);
            this._beginTransform(tool, point, layer, event.pointerId);
            return;
        }
        if (!["brush", "pencil", "eraser", "fill"].includes(tool)) return;
        const layer = this._ensureWritableLayer();
        if (!layer) return;
        event.preventDefault();
        event.stopPropagation();
        const paintMask = !!this.maskManager?.isPaintToMask?.();
        const target = await this._layerCanvas(layer, paintMask ? "mask" : "bitmap");
        const ctx = target.getContext("2d", { willReadFrequently: true });
        const point = this._eventPoint(event);
        this.drawing = {
            pointerId: event.pointerId,
            layerId: layer.id,
            paintMask,
            tool,
            canvas: target,
            ctx,
            last: point,
        };
        this.canvas.setPointerCapture?.(event.pointerId);
        if (tool === "fill") {
            this._fillCanvas(ctx, paintMask ? "#ffffff" : this._brush().color);
            this._commitDrawing();
            return;
        }
        this._drawDot(point);
        this.requestRender();
    }

    _onPointerMove(event) {
        if (this.transforming) {
            if (this.transforming.pointerId != null && event.pointerId != null && this.transforming.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            this._updateTransform(this._eventPoint(event));
            return;
        }
        const stroke = this.drawing;
        if (!stroke) return;
        if (stroke.pointerId != null && event.pointerId != null && stroke.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const point = this._eventPoint(event);
        this._drawLine(stroke.last, point);
        stroke.last = point;
        this.requestRender();
    }

    _onPointerUp(event) {
        if (this.transforming) {
            if (this.transforming.pointerId != null && event?.pointerId != null && this.transforming.pointerId !== event.pointerId) return;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            this._finishTransform();
            return;
        }
        if (!this.drawing) return;
        if (this.drawing.pointerId != null && event?.pointerId != null && this.drawing.pointerId !== event.pointerId) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._commitDrawing();
    }

    _drawDot(point) {
        const stroke = this.drawing;
        if (!stroke?.ctx) return;
        const brush = this._brush(stroke.tool);
        stroke.ctx.save();
        stroke.ctx.globalAlpha = brush.opacity;
        stroke.ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        stroke.ctx.fillStyle = stroke.paintMask ? "#ffffff" : brush.color;
        stroke.ctx.beginPath();
        stroke.ctx.arc(point.x, point.y, Math.max(0.5, brush.size / 2), 0, Math.PI * 2);
        stroke.ctx.fill();
        stroke.ctx.restore();
    }

    _beginTransform(mode, point, layer, pointerId = null) {
        const normalized = this._normalizeTransformMode(mode);
        const base = this._normalizeTransform(layer?.metadata?.transform);
        const center = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
        this.layerManager?.selectLayer?.(layer.id);
        this.transforming = {
            pointerId,
            layerId: layer.id,
            mode: normalized,
            start: { x: Number(point.x) || 0, y: Number(point.y) || 0 },
            base,
            center,
            startAngle: Math.atan2((Number(point.y) || 0) - center.y, (Number(point.x) || 0) - center.x),
        };
        this.eventBus?.emit?.("canvas:transform:start", { layerId: layer.id, mode: normalized });
    }

    _updateTransform(point = {}) {
        const current = this.transforming;
        if (!current) return;
        const x = Number(point.x) || 0;
        const y = Number(point.y) || 0;
        const dx = x - current.start.x;
        const dy = y - current.start.y;
        const next = { ...current.base };
        if (current.mode === "move") {
            next.dx = current.base.dx + dx;
            next.dy = current.base.dy + dy;
        } else if (current.mode === "rotate") {
            const angle = Math.atan2(y - current.center.y, x - current.center.x);
            next.angle = current.base.angle + (angle - current.startAngle);
        } else {
            const verticalDrag = current.start.y - y;
            const factor = Math.max(0.05, 1 + (verticalDrag / 300));
            next.sx = Math.max(0.05, current.base.sx * factor);
            next.sy = Math.max(0.05, current.base.sy * factor);
        }
        this._setLayerTransform(current.layerId, next, false);
        this.requestRender();
    }

    _finishTransform() {
        const layerId = this.transforming?.layerId || null;
        this.transforming = null;
        this.eventBus?.emit?.("canvas:transform:end", { layerId });
        this.eventBus?.emit?.("workflow:params:changed", { reason: "transform" });
        this.eventBus?.emit?.("canvas:export:composite", { reason: "transform-commit" });
        this.requestRender();
    }

    _resolveTransformLayer(point = {}) {
        const active = this.layerManager?.getActiveLayer?.();
        if (this._isTransformableLayer(active)) return active;
        const picked = this.pickLayerAtPoint(point);
        if (this._isTransformableLayer(picked)) return picked;
        return null;
    }

    _isTransformableLayer(layer) {
        return !!(layer && layer.id !== "layer_background" && layer.visible !== false && !layer.locked && layer.bitmap);
    }

    _normalizeTransformMode(mode) {
        const raw = String(mode || "move").toLowerCase();
        if (raw.includes("rotate")) return "rotate";
        if (raw.includes("scale")) return "scale";
        return "move";
    }

    _normalizeTransform(transform = {}) {
        return {
            dx: Number(transform?.dx) || 0,
            dy: Number(transform?.dy) || 0,
            sx: Math.max(0.05, Number(transform?.sx ?? transform?.scaleX ?? 1) || 1),
            sy: Math.max(0.05, Number(transform?.sy ?? transform?.scaleY ?? 1) || 1),
            angle: Number(transform?.angle ?? transform?.rotation ?? 0) || 0,
        };
    }

    _setLayerTransform(layerId, transform, announce = false) {
        const layer = this.layerManager?.getLayerById?.(layerId);
        if (!layer) return;
        this.layerManager.updateLayer?.({
            id: layerId,
            announce,
            patch: {
                metadata: {
                    ...(layer.metadata || {}),
                    transform,
                },
            },
        });
    }

    _drawLine(from, to) {
        const stroke = this.drawing;
        if (!stroke?.ctx) return;
        const brush = this._brush(stroke.tool);
        stroke.ctx.save();
        stroke.ctx.globalAlpha = brush.opacity;
        stroke.ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        stroke.ctx.strokeStyle = stroke.paintMask ? "#ffffff" : brush.color;
        stroke.ctx.lineWidth = Math.max(1, brush.size);
        stroke.ctx.lineCap = "round";
        stroke.ctx.lineJoin = "round";
        stroke.ctx.beginPath();
        stroke.ctx.moveTo(from.x, from.y);
        stroke.ctx.lineTo(to.x, to.y);
        stroke.ctx.stroke();
        stroke.ctx.restore();
    }

    _commitDrawing() {
        const stroke = this.drawing;
        if (!stroke) return;
        const dataUrl = stroke.canvas.toDataURL("image/png");
        if (stroke.paintMask) {
            this.maskCache.set(stroke.layerId, { image: stroke.canvas, src: dataUrl });
            this.layerManager.updateLayer?.({ id: stroke.layerId, patch: { mask: dataUrl } });
        } else {
            this.imageCache.set(stroke.layerId, { image: stroke.canvas, src: dataUrl });
            this.layerManager.updateLayer?.({ id: stroke.layerId, patch: { bitmap: dataUrl } });
        }
        this.drawing = null;
        this.eventBus?.emit?.("canvas:export:composite", { reason: "draw-commit" });
        this.requestRender();
    }

    _eventPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width / Math.max(1, rect.width);
        const sy = this.canvas.height / Math.max(1, rect.height);
        return {
            x: Math.max(0, Math.min(this.canvas.width, (event.clientX - rect.left) * sx)),
            y: Math.max(0, Math.min(this.canvas.height, (event.clientY - rect.top) * sy)),
        };
    }

    async _layerCanvas(layer, kind) {
        const canvas = document.createElement("canvas");
        canvas.width = this.canvas.width || 1;
        canvas.height = this.canvas.height || 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const src = kind === "mask" ? layer.mask : layer.bitmap;
        if (src) {
            const image = await this._loadImage(src);
            if (image) ctx.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
        }
        return canvas;
    }

    _ensureWritableLayer() {
        const active = this.layerManager?.getActiveLayer?.();
        if (active && active.id !== "layer_background" && !active.locked) return active;
        const layer = this.layerManager?.addLayer?.("Easy Paint Layer");
        if (layer?.id) this.layerManager?.selectLayer?.(layer.id);
        return layer || null;
    }

    _brush(tool = this.maskManager?.activeTool || this.activeTool) {
        if (tool === "eraser") {
            const eraser = this.maskManager?.getEraserBrushSettings?.() || {};
            return { size: Number(eraser.size) || 32, opacity: Number(eraser.opacity) || 1, color: "#000000" };
        }
        const brush = this.maskManager?.getBrushSettings?.() || {};
        return {
            size: Number(brush.size) || 32,
            opacity: Number(brush.opacity) || 1,
            color: this._normalizeColor(brush.color || "#000000"),
        };
    }

    _fillCanvas(ctx, color) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = this._normalizeColor(color);
        ctx.fillRect(0, 0, this.canvas.width || 1, this.canvas.height || 1);
        ctx.restore();
    }

    _backgroundColor(layers) {
        const layer = layers.find((item) => item?.id === "layer_background");
        return this._normalizeColor(layer?.metadata?.backgroundColor || "#101318");
    }

    _imageForLayer(layer) {
        const cached = this.imageCache.get(layer.id);
        if (cached?.src === layer.bitmap && cached.image) return cached.image;
        if (layer.bitmap) this._primeImage(layer.id, layer.bitmap);
        return null;
    }

    _liveCanvasForLayer(layer, paintMask) {
        if (!this.drawing || this.drawing.layerId !== layer?.id || !!this.drawing.paintMask !== !!paintMask) return null;
        return this.drawing.canvas || null;
    }

    _primeImage(id, src) {
        const image = new Image();
        image.onload = () => this.requestRender();
        image.onerror = () => this.imageCache.delete(id);
        image.src = src;
        this.imageCache.set(id, { image, src });
        return image;
    }

    _loadImage(src) {
        return new Promise((resolve) => {
            if (!src) return resolve(null);
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = src;
            if (image.complete && (image.naturalWidth || image.width)) resolve(image);
        });
    }

    _drawLayerImage(ctx, image, layer) {
        const width = image.naturalWidth || image.width || this.canvas.width;
        const height = image.naturalHeight || image.height || this.canvas.height;
        const transform = layer?.metadata?.transform || null;
        if (!transform) {
            ctx.drawImage(image, 0, 0, width, height);
            return;
        }
        const dx = Number(transform.dx) || 0;
        const dy = Number(transform.dy) || 0;
        const sx = Number(transform.sx ?? transform.scaleX ?? 1) || 1;
        const sy = Number(transform.sy ?? transform.scaleY ?? 1) || 1;
        const angle = Number(transform.angle ?? transform.rotation ?? 0) || 0;
        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        ctx.translate(dx, dy);
        if (angle) ctx.rotate(angle);
        ctx.scale(sx, sy);
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }

    _drawMaskOverlays(layers) {
        const color = this.maskManager?.getOverlayStyle?.()?.color || "rgba(255, 59, 59, 0.42)";
        for (const layer of layers) {
            if (layer?.visible === false) continue;
            const liveCanvas = this._liveCanvasForLayer(layer, true);
            if (!layer?.mask && !liveCanvas) continue;
            const cached = liveCanvas || this._maskForLayer(layer);
            if (!cached) continue;
            const tint = document.createElement("canvas");
            tint.width = this.canvas.width || 1;
            tint.height = this.canvas.height || 1;
            const tctx = tint.getContext("2d", { willReadFrequently: true });
            tctx.drawImage(cached, 0, 0, cached.naturalWidth || cached.width, cached.naturalHeight || cached.height);
            tctx.globalCompositeOperation = "source-in";
            tctx.fillStyle = color;
            tctx.fillRect(0, 0, tint.width, tint.height);
            this.ctx.drawImage(tint, 0, 0);
        }
    }

    _maskForLayer(layer) {
        const cached = this.maskCache.get(layer.id);
        if (cached?.src === layer.mask && cached.image) return cached.image;
        if (layer.mask) {
            const image = new Image();
            image.onload = () => this.requestRender();
            image.onerror = () => this.maskCache.delete(layer.id);
            image.src = layer.mask;
            this.maskCache.set(layer.id, { image, src: layer.mask });
        }
        return null;
    }

    _blendMode(mode) {
        const normalized = String(mode || "normal").replace(/_/g, "-");
        if (normalized === "normal") return "source-over";
        const allowed = new Set(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
        return allowed.has(normalized) ? normalized : "source-over";
    }

    _normalizeColor(value) {
        const raw = String(value || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
        if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
        return "#000000";
    }
}
