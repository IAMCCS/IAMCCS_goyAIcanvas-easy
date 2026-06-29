export default class EasyCropController {
    constructor({ canvasView, eventBus, container, canvas, layerManager, renderer, documentModel }) {
        this.canvasView = canvasView;
        this.eventBus = eventBus;
        this.container = container;
        this.canvas = canvas;
        this.layerManager = layerManager;
        this.renderer = renderer;
        this.documentModel = documentModel;
        this.active = false;
        this.rect = null;
        this.overlay = null;
        this.rectEl = null;
        this.startPoint = null;

        this.eventBus.on("canvas:crop:start", () => this.start());
        this.eventBus.on("canvas:crop:cancel", () => this.cancel());
        this.eventBus.on("canvas:crop:apply", () => this.apply());
    }

    start() {
        if (this.active) return;
        this.eventBus.emit("canvas:frame", { enabled: false });
        this.eventBus.emit("canvas:pan:mode", { enabled: false });
        this.eventBus.emit("tool:change", "cursor");
        this.active = true;
        this.rect = null;
        this.startPoint = null;
        this._syncCanvasState();
        this.eventBus.emit("canvas:crop:state", { active: true });

        this.overlay = document.createElement("div");
        this.overlay.className = "goya-easy-crop-overlay";
        this.rectEl = document.createElement("div");
        this.rectEl.className = "goya-easy-crop-rect";
        this.rectEl.style.display = "none";
        this.overlay.appendChild(this.rectEl);
        this.container.appendChild(this.overlay);

        const onDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
            let point = this.canvasView._clientToCanvas(event.clientX, event.clientY);
            if (this.canvasView._snapEnabled) point = this.canvasView._snapPoint(point);
            this.startPoint = point;
            this._setRect(point, point);
            window.addEventListener("mousemove", onMove, true);
            window.addEventListener("mouseup", onUp, true);
        };
        const onMove = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!this.startPoint) return;
            let point = this.canvasView._clientToCanvas(event.clientX, event.clientY);
            if (this.canvasView._snapEnabled) point = this.canvasView._snapPoint(point);
            this._setRect(this.startPoint, point);
        };
        const onUp = (event) => {
            event.preventDefault();
            event.stopPropagation();
            window.removeEventListener("mousemove", onMove, true);
            window.removeEventListener("mouseup", onUp, true);
        };
        const onKey = (event) => {
            if (event.key === "Escape") this.cancel();
            if (event.key === "Enter") this.apply();
        };

        this.overlay.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        this.overlay._cleanup = () => {
            this.overlay?.removeEventListener("mousedown", onDown);
            window.removeEventListener("mousemove", onMove, true);
            window.removeEventListener("mouseup", onUp, true);
            window.removeEventListener("keydown", onKey);
        };
    }

    cancel({ silent = false } = {}) {
        if (!this.active && !this.overlay) return;
        this.active = false;
        this.rect = null;
        this.startPoint = null;
        try { this.overlay?._cleanup?.(); } catch (_e) {}
        if (this.overlay?.parentElement) this.overlay.parentElement.removeChild(this.overlay);
        this.overlay = null;
        this.rectEl = null;
        this._syncCanvasState();
        if (!silent) this.eventBus.emit("canvas:crop:state", { active: false });
    }

    async apply() {
        if (!this.active || !this.rect) {
            this.eventBus.emit("status:message", "Crop needs a dragged selection");
            return;
        }
        const crop = this.documentModel.normalizeRect(this.rect);
        if (!crop || crop.w < 2 || crop.h < 2) {
            this.eventBus.emit("status:message", "Crop ignored: empty selection");
            this.cancel();
            return;
        }

        let dataUrl = "";
        try {
            dataUrl = await this._cropVisibleCanvas(crop);
        } catch (error) {
            console.warn("[EasyCropController] crop failed", error);
            this.eventBus.emit("status:message", `Crop failed: ${error?.message || error}`);
            return;
        }
        if (!dataUrl) return;

        this.cancel({ silent: true });
        this.eventBus.emit("canvas:crop:state", { active: false });
        this.canvasView._clearGeneratedViewState?.();
        this.canvasView._clearCanvasRuntimeCaches?.();
        this.canvasView.resize(crop.w, crop.h);

        const layer = this.layerManager.replaceWithRasterDocument?.(dataUrl, {
            width: crop.w,
            height: crop.h,
            name: "Cropped Image",
            backgroundColor: this.documentModel.backgroundColor(),
        });
        if (layer?.id) this.canvasView._primeLayerImageCache?.(layer.id, dataUrl);
        try { this.renderer?._syncImageCache?.(this.layerManager.getLayers?.() || []); } catch (_e) {}
        try { this.renderer?.render?.(); } catch (_e) {}
        try { this.renderer?.requestRender?.(); } catch (_e) {}

        this.eventBus.emit("canvas:image:detected", { width: crop.w, height: crop.h });
        this.eventBus.emit("workflow:params:changed", { immediate: true });
        this.eventBus.emit("easy:generation:reset", { reason: "crop" });
        this.eventBus.emit("status:message", `Cropped canvas to ${crop.w}x${crop.h}`);
    }

    async _cropVisibleCanvas(crop) {
        try { this.renderer?.render?.(); } catch (_e) {}
        const source = this.canvas;
        const out = document.createElement("canvas");
        out.width = crop.w;
        out.height = crop.h;
        const ctx = out.getContext("2d", { willReadFrequently: true });
        if (!ctx) return "";
        ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        return out.toDataURL("image/png");
    }

    refresh() {
        if (!this.active || !this.rect || !this.rectEl) return;
        this._positionRect();
    }

    _setRect(a, b) {
        const x1 = Math.min(a.x, b.x);
        const y1 = Math.min(a.y, b.y);
        const x2 = Math.max(a.x, b.x);
        const y2 = Math.max(a.y, b.y);
        this.rect = {
            x: Math.floor(x1),
            y: Math.floor(y1),
            w: Math.max(1, Math.floor(x2 - x1)),
            h: Math.max(1, Math.floor(y2 - y1)),
        };
        this._syncCanvasState();
        this._positionRect();
        this.eventBus.emit("canvas:crop:rect", { rect: { ...this.rect } });
    }

    _positionRect() {
        const canvasRect = this.canvas.getBoundingClientRect();
        const hostRect = this.container.getBoundingClientRect();
        const scaleX = canvasRect.width / Math.max(1, this.canvas.width);
        const scaleY = canvasRect.height / Math.max(1, this.canvas.height);
        Object.assign(this.rectEl.style, {
            display: "block",
            left: `${(canvasRect.left - hostRect.left) + this.rect.x * scaleX}px`,
            top: `${(canvasRect.top - hostRect.top) + this.rect.y * scaleY}px`,
            width: `${this.rect.w * scaleX}px`,
            height: `${this.rect.h * scaleY}px`,
        });
    }

    _syncCanvasState() {
        this.canvasView._cropActive = this.active;
        this.canvasView._cropRect = this.rect ? { ...this.rect } : null;
        this.canvasView._cropOverlay = this.overlay;
        this.canvasView._cropRectEl = this.rectEl;
    }
}
