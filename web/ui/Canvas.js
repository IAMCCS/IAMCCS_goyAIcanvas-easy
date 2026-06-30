import UIHelpers from "../utils/UIHelpers.js";
import { debugTrace } from "../utils/DebugTrace.js";
import Constants from "../utils/Constants.js";
import EasyCanvasKernel from "./EasyCanvasKernel.js?v=20260630_EASY_OUTPAINT_ACCEPT02";
import TransformMath from "../engine/EasyTransformMath.js?v=20260630_EASY_OUTPAINT_ACCEPT02";
import EasyCanvasDocument from "./EasyCanvasDocument.js?v=20260630_EASY_OUTPAINT_ACCEPT02";
import EasyCropController from "./EasyCropController.js?v=20260630_EASY_OUTPAINT_ACCEPT02";

export default class CanvasView {
    constructor(hostElement, eventBus, layerManager, maskManager) {
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.maskManager = maskManager;
        this.container = UIHelpers.createElement("div", "goya-canvas-container");
        this.canvas = document.createElement("canvas");
        this.canvas.id = "goya-main-canvas";
        this.container.append(this.canvas);
        this._viewportPan = { x: 0, y: 0 };
        this._canvasPanMode = true;
        this._canvasPanDrag = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            originX: 0,
            originY: 0,
        };
        this._sketchHudState = {
            tool: 'cursor',
            drawOnly: false,
            easyMode: 't2i',
            vectorShape: 'line',
            vectorFill: Boolean(maskManager?.getVectorOptions?.()?.fill),
            size: Number(maskManager?.getBrushSettings?.()?.size) || 32,
            opacity: Number(maskManager?.getBrushSettings?.()?.opacity) || 1,
            color: String(maskManager?.getBrushSettings?.()?.color || '#ffffff'),
            hudEnabled: false,
            eyedropper: false,
        };
        this._frameInteraction = {
            active: false,
            pointerId: null,
            mode: null,
        };
        this._frameEnabled = false;
        this._sketchHudDrag = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            originLeft: 0,
            originTop: 0,
        };
        // Compare overlay canvas (draws generated image clipped by a vertical wipe)
        this.compareOverlay = document.createElement("canvas");
        this.compareOverlay.id = "goya-compare-overlay";
        Object.assign(this.compareOverlay.style, {
            position: 'absolute', left: '50%', top: '50%', transformOrigin: 'center center',
            zIndex: 900, pointerEvents: 'none',
        });
        this.container.append(this.compareOverlay);
        this._buildSketchHud();
        hostElement.append(this.container);
        this.renderer = new EasyCanvasKernel(this.canvas, this.eventBus, this.layerManager, this.maskManager);
        this.documentModel = new EasyCanvasDocument({ canvas: this.canvas, layerManager: this.layerManager });
        this.cropController = new EasyCropController({
            canvasView: this,
            eventBus: this.eventBus,
            container: this.container,
            canvas: this.canvas,
            layerManager: this.layerManager,
            renderer: this.renderer,
            documentModel: this.documentModel,
        });
        this._previousCanvasBackgroundColor = '';
        this._drawModeWasActive = false;

    // Compare overlay state
    this.compareEnabled = false;
    this.compareDirection = 'ltr'; // 'ltr' or 'rtl'
    this.compareImage = null; // HTMLImageElement
    this.compareBaseImage = null; // Optional baseline image for dual-compare
    this._compareBaselineExplicit = false;
    this._compareDirectionUserTouched = false;
    this._preRunCompositeDataUrl = "";
    this.compareDragging = false;
    this.compareWipeX = null; // canvas-space position

    // Mode tracking - used to scope generated-image overlay to the originating mode
    this._activeMode = 'advanced';
    this._generationOriginMode = null;
    this.eventBus.on('mode:changed', ({ mode }) => {
        this._activeMode = mode || 'advanced';
        // When leaving the mode that started a generation, hide the compare overlay
        if (this._generationOriginMode && this._activeMode !== this._generationOriginMode) {
            this.compareOverlay.style.display = 'none';
        } else if (this._generationOriginMode && this._activeMode === this._generationOriginMode) {
            this.compareOverlay.style.display = '';
        }
    });

    // Frame overlay (not rendered) with inner rect and handles
    this.frameOverlay = document.createElement("div");
    this.frameOverlay.className = "goya-frame-overlay";
    // Hide overlay by default to avoid a small ghost frame on first open
    this.frameOverlay.style.display = "none";
    // Resolution frame (always visible reference of canvas bounds)
    this._resFrame = document.createElement('div');
    this._resFrame.className = 'goya-resolution-frame';
    this._resFrameLabel = document.createElement('div');
    this._resFrameLabel.className = 'goya-resolution-label';
    this._resFrame.appendChild(this._resFrameLabel);
    // Separate active wrap from ghost frames to avoid shifting ghosts during preview
    this._frameActiveWrap = document.createElement("div");
    this._frameActiveWrap.className = 'goya-frame-activewrap';
    this.frameOverlay.appendChild(this._frameActiveWrap);
    this._framePreviewWrap = document.createElement("div");
    this._framePreviewWrap.className = 'goya-frame-previewwrap';
    this._frameActiveWrap.appendChild(this._framePreviewWrap);
    this.frameRect = document.createElement("div");
    this.frameRect.className = "goya-frame-rect";
    this._framePreviewWrap.appendChild(this.frameRect);
    this._frameEdges = ['top', 'right', 'bottom', 'left'].map((edge) => {
        const edgeEl = document.createElement('div');
        edgeEl.className = 'goya-frame-edge';
        edgeEl.dataset.frameEdge = edge;
        this._framePreviewWrap.appendChild(edgeEl);
        return edgeEl;
    });
    this._frameHandles = [];
    // Make sure resolution frame sits underneath active/ghost frames
    this.frameOverlay.appendChild(this._resFrame);
    this.container.append(this.frameOverlay);
    this._frameBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
    this._frameBaseBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
    this._frameCurrentTransform = { dx: 0, dy: 0, sx: 1, sy: 1, angle: 0 };
    this._buildFrameHandles();
    this._bindFrameInteractions();

    // Ghost frames for other layers
    this._frameGhostsWrap = document.createElement("div");
    this._frameGhostsWrap.className = 'goya-frame-ghosts';
    this.frameOverlay.appendChild(this._frameGhostsWrap);

    // Liquify brush cursor ring
    this._liqRing = document.createElement('div');
    this._liqRing.className = 'goya-liq-ring';
    this._liqRing.style.display = 'none';
    // inner falloff ring
    const liqInner = document.createElement('div');
    liqInner.className = 'goya-liq-ring__inner';
    this._liqRing.appendChild(liqInner);
    this.container.appendChild(this._liqRing);

    // Crop overlay state
    this._cropActive = false;
    this._cropOverlay = null;
    this._cropRectEl = null;
    this._cropStart = null;
    this._activeScenario = "";
    this._fl2oPadding = { left: 0, top: 0, right: 0, bottom: 0 };
    this._ignoreImportedResizeUntil = 0;

    // Imaging effects state
    this._effectsOriginal = {};
    this._effectsState = {}; // layerId -> { original: dataURL, map: { [effect]: { enabled, amount } } }

        this._bindDropZone();

        // Zoom state: base fit scale (auto) x user zoom
        this.baseFitScale = 1;
        this.userZoom = 1; // 1 = 100%
        this._applyZoomTransform();

        // Observe wrapper to keep canvas always fitted
        this._resizeObserver = new ResizeObserver(() => this._recomputeFitScale());
        this._resizeObserver.observe(this.container);

        // Mouse wheel zoom
        this._onWheelHandler = (e) => {
            if (!e.ctrlKey && !e.metaKey) {
                // Allow standard page scroll unless over canvas; intercept to zoom anyway
                if (!this.container.contains(e.target)) return;
            }
            e.preventDefault();
            const delta = e.deltaY;
            const factor = delta > 0 ? 0.9 : 1.1;
            this.setUserZoom(this.userZoom * factor);
        };
        this.container.addEventListener("wheel", this._onWheelHandler, { passive: false });

        // Compare overlay interactions
        const overlayDown = (e) => {
            if (!this.compareEnabled || (!this.compareImage && !this.compareBaseImage)) return;
            e.preventDefault(); e.stopPropagation();
            const p = this._clientToCanvas(e.clientX, e.clientY);
            this.compareDragging = true;
            this.compareWipeX = Math.max(0, Math.min(this.canvas.width, p.x));
            this._renderCompareOverlay();
            window.addEventListener('mousemove', overlayMove, true);
            window.addEventListener('mouseup', overlayUp, true);
        };
        const overlayMove = (e) => {
            if (!this.compareDragging) return;
            e.preventDefault(); e.stopPropagation();
            const p = this._clientToCanvas(e.clientX, e.clientY);
            this.compareWipeX = Math.max(0, Math.min(this.canvas.width, p.x));
            this._renderCompareOverlay();
        };
        const overlayUp = (e) => {
            this.compareDragging = false;
            window.removeEventListener('mousemove', overlayMove, true);
            window.removeEventListener('mouseup', overlayUp, true);
        };
        // Double-click toggles direction LTR/RTL
        const overlayDbl = (e) => {
            if (!this.compareEnabled || (!this.compareImage && !this.compareBaseImage)) return;
            e.preventDefault(); e.stopPropagation();
            this._compareDirectionUserTouched = true;
            this.compareDirection = this.compareDirection === 'ltr' ? 'rtl' : 'ltr';
            this._renderCompareOverlay();
        };
        // Bind on overlay canvas (enabled only during compare)
        this.compareOverlay.addEventListener('mousedown', overlayDown);
        this.compareOverlay.addEventListener('dblclick', overlayDbl);

        // EventBus zoom controls
        this.eventBus.on("canvas:zoom:delta", ({ factor }) => this.setUserZoom(this.userZoom * (factor || 1)));
        this.eventBus.on("canvas:zoom:set", ({ value }) => this.setUserZoom(value || 1));
        this.eventBus.on("canvas:zoom:reset", () => this.setUserZoom(1));
        this.eventBus.on("canvas:pan:mode", ({ enabled } = {}) => {
            this._canvasPanMode = !!enabled;
            if (this._canvasPanMode) {
                this.container.style.cursor = 'grab';
            } else if ((this.maskManager?.activeTool || '') === 'canvas_pan') {
                this.eventBus.emit('tool:change', 'cursor');
            }
        });
        this.eventBus.on("canvas:pan:reset", () => {
            this._viewportPan = { x: 0, y: 0 };
            this._applyZoomTransform();
        });

        // Provide composite export on demand for workflows
        this.eventBus.on("canvas:export:composite", () => {
            try {
                const data = this.exportComposite();
                this.eventBus.emit("canvas:export:composite:ready", { data });
            } catch (err) {
                this.eventBus.emit("canvas:export:composite:ready", { data: null, error: String(err) });
            }
        });

        // Frame toggle
    // Force frame overlay disabled; keep resolution frame only
    this.eventBus.on("canvas:frame", ({ enabled, preserveTool } = {}) => this._toggleFrame(enabled, { preserveTool }));
        this.eventBus.on("canvas:selection:clear", () => {
            this._toggleFrame(false);
            this.layerManager.selectLayer?.(null);
            this._maybeRecomputeFrameBounds();
        });
        this.eventBus.on("canvas:selection:delete", () => {
            const active = this.layerManager.getActiveLayer?.();
            if (active?.id && active.id !== 'layer_background') {
                this.layerManager.snapshot?.();
                this.renderer.imageCache?.delete?.(active.id);
                this.layerManager.updateLayer?.({
                    id: active.id,
                    patch: {
                        bitmap: null,
                        mask: null,
                        metadata: {
                            ...active.metadata,
                            transform: { dx: 0, dy: 0, sx: 1, sy: 1, angle: 0 },
                        },
                    },
                });
                try { this.renderer.clearTransientState?.(); } catch (_e) {}
                this.renderer.requestRender?.();
                this.eventBus.emit("canvas:layer:cleared", { layerId: active.id });
                this.eventBus.emit("easy:generation:reset", { reason: "clear-layer" });
            }
            this.eventBus.emit("canvas:selection:clear");
        });
        this.eventBus.on("canvas:selection:reframe", () => {
            const active = this.layerManager.getActiveLayer?.();
            if (!active?.id || active.id === 'layer_background') {
                return;
            }
            const current = this._normFrameTransform(active.metadata?.transform);
            const isIdentity = current.dx === 0 && current.dy === 0 && current.sx === 1 && current.sy === 1 && current.angle === 0;
            if (isIdentity) {
                return;
            }
            this.layerManager.snapshot?.();
            try { this.renderer.clearTransientState?.(); } catch (_e) {}
            this.layerManager.updateLayer?.({
                id: active.id,
                patch: {
                    metadata: {
                        ...active.metadata,
                        transform: { dx: 0, dy: 0, sx: 1, sy: 1, angle: 0 },
                    },
                },
            });
            this._maybeRecomputeFrameBounds();
            this.renderer.requestRender?.();
        });
        this.eventBus.on("project:clear", () => {
            try { this.renderer.clearTransientState?.(); } catch (_e) {}
            this._ignoreImportedResizeUntil = Date.now() + 1500;
            console.log("[CanvasView] project:clear", {
                canvasWidth: this.canvas.width,
                canvasHeight: this.canvas.height,
                ignoreImportedResizeUntil: this._ignoreImportedResizeUntil,
            });
            this.compareEnabled = false;
            this.compareImage = null;
            this.compareBaseImage = null;
            this._compareBaselineExplicit = false;
            this._generationOriginMode = null;
            this._preRunCompositeDataUrl = "";
            this.compareOverlay.style.display = 'none';
            const overlayCtx = this.compareOverlay.getContext?.('2d');
            overlayCtx?.clearRect?.(0, 0, this.compareOverlay.width, this.compareOverlay.height);
        });
        this.eventBus.on("easy:generation:reset", () => {
            this._clearGeneratedViewState();
            try { this.renderer.clearTransientState?.(); } catch (_e) {}
        });
        this.eventBus.on('tool:change', (toolId) => {
            if (toolId !== 'canvas_pan') {
                this._canvasPanMode = false;
                if (this._canvasPanDrag?.active) {
                    this._canvasPanDrag.active = false;
                    this._canvasPanDrag.pointerId = null;
                }
            }
            this._sketchHudState.tool = toolId || 'cursor';
            if (toolId !== 'eyedropper') {
                this._sketchHudState.eyedropper = false;
            }
            if (toolId && toolId !== 'cursor' && this._frameEnabled) {
                this._toggleFrame(false);
            }
            this._syncSketchHud();
        });
        this.eventBus.on('brush:update', (payload = {}) => {
            if (typeof payload.size === 'number') this._sketchHudState.size = Math.max(1, Math.round(payload.size));
            if (typeof payload.opacity === 'number') this._sketchHudState.opacity = Math.max(0.05, Math.min(1, payload.opacity));
            if (typeof payload.color === 'string' && payload.color.trim()) this._sketchHudState.color = payload.color.trim();
            this._syncSketchHud();
        });
        this.eventBus.on('eraser:brush', (payload = {}) => {
            if (typeof payload.size === 'number') this._sketchHudState.size = Math.max(1, Math.round(payload.size));
            this._syncSketchHud();
        });
        this.eventBus.on('vector:brush', (payload = {}) => {
            if (typeof payload.size === 'number') this._sketchHudState.size = Math.max(1, Math.round(payload.size));
            this._syncSketchHud();
        });
        this.eventBus.on('vector:shape', ({ shape } = {}) => {
            this._sketchHudState.vectorShape = ['line', 'rect', 'ellipse'].includes(shape) ? shape : 'line';
            this._syncSketchHud();
        });
        this.eventBus.on('vector:options', (payload = {}) => {
            if (typeof payload.fill === 'boolean') {
                this._sketchHudState.vectorFill = payload.fill;
                this._syncSketchHud();
            }
        });
        this.eventBus.on('canvas:mode', async ({ drawOnly } = {}) => {
            const nextDrawOnly = !!drawOnly;
            this._sketchHudState.drawOnly = nextDrawOnly;
            this._syncDrawSurface(nextDrawOnly);
            if (this._drawModeWasActive && !nextDrawOnly) {
                const easyDrawLayer = (this.layerManager.getLayers?.() || []).find((layer) => layer?.metadata?.easyRole === 'easy_draw_surface' && layer?.bitmap) || null;
                await this.renderer.bakeLayerBitmapOnWhite(easyDrawLayer?.id || null);
            }
            this._drawModeWasActive = nextDrawOnly;
            this._syncSketchHud();
        });
        this.eventBus.on('easy:mode:change', ({ mode } = {}) => {
            this._sketchHudState.easyMode = mode || 't2i';
            this._syncSketchHud();
        });
        this.eventBus.on('mode:changed', ({ mode } = {}) => {
            this._activeMode = mode || 'advanced';
            this._syncSketchHud();
        });
        this.eventBus.on('sketch:hud:set', ({ enabled } = {}) => {
            this._sketchHudState.hudEnabled = !!enabled;
            this._syncSketchHud();
        });
    // Follow transform previews for image frame (non-rendered)
    this.eventBus.on("canvas:transform:preview", (t) => this._updateFramePreview(t));
        this.eventBus.on("canvas:transform:end", () => {
            this._resetFramePreview();
            // Restore overlay visibility after commit
            this.frameOverlay.style.visibility = '';
        });
        this.eventBus.on("canvas:transform:precommit", () => {
            // Hide overlay just before applying transform to avoid any flash, will be restored on transform:end
            this.frameOverlay.style.visibility = 'hidden';
        });
    // Recompute frame bounds on layer changes
    this.eventBus.on("layers:changed", () => this._maybeRecomputeFrameBounds());
    this.eventBus.on("layer:selected", () => this._maybeRecomputeFrameBounds());
        // Snap toggle (used by transform tools in renderer, and by crop here)
        this._snapEnabled = false;
        this._snapStep = 10;
        this.eventBus.on("canvas:snap", ({ enabled, moveStep }) => {
            if (typeof enabled === 'boolean') this._snapEnabled = enabled;
            if (typeof moveStep === 'number' && Number.isFinite(moveStep)) this._snapStep = Math.max(1, moveStep | 0);
        });

        this.eventBus.on("scenario:changed", ({ scenario }) => {
            this._activeScenario = String(scenario || "");
        });
        this.eventBus.on("fl2o:padding", ({ left, top, right, bottom }) => {
            this._fl2oPadding = {
                left: Number.isFinite(left) ? Math.max(0, Math.trunc(left)) : (this._fl2oPadding.left || 0),
                top: Number.isFinite(top) ? Math.max(0, Math.trunc(top)) : (this._fl2oPadding.top || 0),
                right: Number.isFinite(right) ? Math.max(0, Math.trunc(right)) : (this._fl2oPadding.right || 0),
                bottom: Number.isFinite(bottom) ? Math.max(0, Math.trunc(bottom)) : (this._fl2oPadding.bottom || 0),
            };
        });
        // Imaging events are handled non-destructively by the canvas kernel.
    // this.eventBus.on("image:effect:apply", (payload) => this._onEffectApply(payload));
    // this.eventBus.on("image:effect:reset", () => this._resetEffects());
    // this.eventBus.on("image:curves:reset", () => this._resetCurves());
    // this.eventBus.on("image:levels:reset", () => this._resetLevels());
    // this.eventBus.on("image:rgb:reset", () => this._resetRGB());
    // this.eventBus.on("image:curves:apply", ({ lut }) => this._onCurvesApply(lut));
    // this.eventBus.on("image:levels:apply", ({ black, white, gamma }) => this._onLevelsApply(black, white, gamma));
    // this.eventBus.on("image:rgb:apply", ({ r, g, b }) => this._onRgbApply(r, g, b));
    // this.eventBus.on("image:colorwheel:apply", ({ hueDeg, sat }) => this._onColorWheelApply(hueDeg, sat));
    // this.eventBus.on("image:adjust", (payload) => this._onAdjustImage(payload));
        // Ensure resolution label updates after import-driven resize
        this.eventBus.on("canvas:import:files", () => {
            setTimeout(() => {
                try { this._resFrameLabel.textContent = `${this.canvas.width}x${this.canvas.height}`; } catch (_e) {}
            }, 100);
        });
        // When a single image is detected/imported, resize canvas to match it
        this.eventBus.on("canvas:image:imported", ({ originalWidth, originalHeight, source }) => {
            if (Date.now() < this._ignoreImportedResizeUntil) {
                console.log("[CanvasView] Ignored canvas:image:imported during clear guard", {
                    originalWidth,
                    originalHeight,
                    ignoreImportedResizeUntil: this._ignoreImportedResizeUntil,
                    now: Date.now(),
                });
                return;
            }
            if (Number.isFinite(originalWidth) && Number.isFinite(originalHeight) && originalWidth > 0 && originalHeight > 0) {
                console.log("[CanvasView] Applying canvas:image:imported resize", {
                    from: { width: this.canvas.width, height: this.canvas.height },
                    to: { width: originalWidth, height: originalHeight },
                });
                this.resize(originalWidth, originalHeight);
                // Broadcast detection for UI panels
                this.eventBus.emit("canvas:image:detected", { width: originalWidth, height: originalHeight, source });
            }
        });
        
        const applyGeneratedImage = (imageUrl) => {
            // IMPORTANT: per spec, do NOT place the generated output into any layer.
            // Background must remain transparent/solid-color only.
            if (!imageUrl || typeof imageUrl !== "string") return;
            try {
                // Cache last generated as compare image (used by compare toggle defaults)
                this._setCompareImage(imageUrl);
                if (!this._compareBaselineExplicit && this._preRunCompositeDataUrl) {
                    this._setCompareBaseline(this._preRunCompositeDataUrl);
                    if (!this._compareDirectionUserTouched) {
                        this.compareDirection = 'rtl';
                    }
                }
                this._renderCompareOverlay();
            } catch (_e) {}
        };

        // Prefer workflow:final (python-mode) for the actual saved output
        this.eventBus.on("workflow:final", ({ url }) => {
            if (!url) return;
            this._generationOriginMode = this._activeMode;
            applyGeneratedImage(url);
        });
        // Fallback for any older/graph emitters that might still send result.image
        this.eventBus.on("workflow:complete", (payload) => {
            const url = payload?.result?.image || payload?.url;
            if (!url) return;
            this._generationOriginMode = this._activeMode;
            applyGeneratedImage(url);
        });

        // Capture a baseline snapshot on start (used for default compare when ON)
        this.eventBus.on("workflow:started", () => {
            this._generationOriginMode = this._activeMode;
            try {
                // Export current canvas composite BEFORE generation modifies layers.
                this._preRunCompositeDataUrl = this.exportComposite();
            } catch (_e) {
                this._preRunCompositeDataUrl = "";
            }
        });
        // External toggle of compare
        this.eventBus.on("compare:toggle", ({ enabled }) => {
            this.compareEnabled = !!enabled;
            // Enable pointer events only when active
            this.compareOverlay.style.pointerEvents = this.compareEnabled ? 'auto' : 'none';
            this.compareOverlay.style.cursor = this.compareEnabled ? 'col-resize' : 'default';
            this.compareOverlay.style.display = this.compareEnabled ? '' : 'none';
            // Default wipeX to center when turning on
            if (this.compareEnabled && this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);
            // Ensure backing store matches canvas so overlay draws crisply
            this.compareOverlay.width = this.canvas.width;
            this.compareOverlay.height = this.canvas.height;

            // If compare is enabled without an explicit baseline selection,
            // try to hydrate baseline from last pre-run snapshot.
            if (this.compareEnabled && !this.compareBaseImage && !this._compareBaselineExplicit && this._preRunCompositeDataUrl) {
                try {
                    this._setCompareBaseline(this._preRunCompositeDataUrl);
                    if (!this._compareDirectionUserTouched) this.compareDirection = 'rtl';
                } catch (_e) {}
            }
            this._renderCompareOverlay();
        });
        // Allow external image(s) (e.g., Gallery) to set compare overlay
        this.eventBus.on("canvas:compare:set", ({ dataUrl, baselineDataUrl }) => {
            let updated = false;
            if (typeof dataUrl === 'string' && dataUrl.trim()) {
                this._setCompareImage(dataUrl);
                updated = true;
            }
            if (typeof baselineDataUrl === 'string' && baselineDataUrl.trim()) {
                this._compareBaselineExplicit = true;
                this._setCompareBaseline(baselineDataUrl);
                updated = true;
            }
            if (updated) {
                // Ensure overlay is interactive
                this.compareEnabled = true;
                this.compareOverlay.style.pointerEvents = 'auto';
                this.compareOverlay.style.cursor = 'col-resize';
                this.compareOverlay.style.display = '';
                if (this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);
                this._renderCompareOverlay();
            }
        });
    // Histogram is computed from the visible composite.
    // this.eventBus.on("image:histogram:request", () => this._onHistogramRequest());
        // Text editing overlay disabled (stability priority)
        // this.eventBus.on("text:edit:start", (payload) => this._openTextEditor(payload));

        // Liquify brush ring visibility and size sync
        this.eventBus.on('liquify:settings', ({ radius }) => {
            if (typeof radius === 'number') this._updateLiqRingSize(radius);
        });
        this.eventBus.on('tool:change', (toolId) => {
            const on = toolId === 'liquify';
            this._liqRing.style.display = on ? 'block' : 'none';
        });
        this.container.addEventListener('mousemove', (e) => {
            if (this._liqRing.style.display !== 'block') return;
            const scale = this.baseFitScale * this.userZoom;
            const rect = this.container.getBoundingClientRect();
            const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
            const r = (this._liqRing._radius || 40) * scale;
            Object.assign(this._liqRing.style, { left: `${cx - r}px`, top: `${cy - r}px`, width: `${r*2}px`, height: `${r*2}px` });
        });
        this.container.addEventListener('mouseleave', () => { this._liqRing.style.display = 'none'; });
        this.container.addEventListener('mouseenter', () => {
            // only show when liquify active
            const on = (this.maskManager?.activeTool) === 'liquify';
            this._liqRing.style.display = on ? 'block' : 'none';
        });

        // Cursor management: dynamic cursors for each tool
        this.eventBus.on('tool:change', (toolId) => {
            if (toolId !== 'canvas_pan') {
                this._canvasPanMode = false;
            }
            const cursorMap = {
                'cursor': 'default',
                'canvas_pan': 'grab',
                'move': 'grab',
                'brush': 'crosshair',
                'pencil': 'crosshair',
                'eraser': 'cell',
                'scale': 'nwse-resize',
                'rotate': 'alias',
                'lasso': 'crosshair',
                'vector': 'crosshair',
                'text': 'text'
            };
            this.container.style.cursor = cursorMap[toolId] || '';
        });
        this._bindCanvasPanInteractions();
        this.eventBus.on('canvas:transform:preview', ({ mode }) => {
            if (mode === 'move') this.container.style.cursor = 'grabbing';
        });
        this.eventBus.on('canvas:transform:end', () => {
            // If active tool is move keep 'grab', otherwise reset default
            const t = this.maskManager?.activeTool;
            if (t === 'move') this.container.style.cursor = 'grab';
            else if (t === 'cursor') this.container.style.cursor = 'default';
            else this.container.style.cursor = '';
        });
        this.eventBus.on('canvas:cursor:default', ()=> { this.container.style.cursor=''; });
        this.eventBus.on('canvas:cursor:hand', ()=> { this.container.style.cursor='grab'; });
        // Initial layout of resolution frame
        this._layoutResolutionFrame();

        // React to editor open/close and generic refresh with a reflow+repaint
        const doRefresh = () => {
            try {
                // Recompute fit after container size/context changes
                this._recomputeFitScale();
                this._layoutResolutionFrame();
                this.cropController?.refresh?.();
                this.renderer.render?.();
                this.renderer.requestRender?.();
            } catch (_e) {}
        };
        this.eventBus.on("ui:editor:open", () => {
            // immediate and next frame to catch modal sizing
            doRefresh();
            requestAnimationFrame(doRefresh);
        });
        this.eventBus.on("ui:editor:close", () => {
            // after reparenting, force reflow/resize twice to be safe
            doRefresh();
            requestAnimationFrame(doRefresh);
        });
        this.eventBus.on("canvas:refresh", () => doRefresh());

        // On canvas dimension changes, recalc frame bounds/handles so overlays match at any DPI
        this.eventBus.on("canvas:resize", () => {
            try {
                this._maybeRecomputeFrameBounds();
                this._layoutFrameRect();
                this._layoutGhostFrames();
                // Resize compare overlay backing store
                this.compareOverlay.width = this.canvas.width;
                this.compareOverlay.height = this.canvas.height;
                // Default wipeX to center when enabling or after resize
                if (this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);
                this._renderCompareOverlay();
                // If crop is active, reflow the crop rect to match new canvas scale/size
                this.cropController?.refresh?.();
            } catch (_e) {}
        });

        // Pencil mode state & input filtering
        this.pencilModeEnabled = false;
        this.eventBus.on("input:pencil", ({ enabled }) => {
            this.pencilModeEnabled = !!enabled;
        });
        // When pencil mode is ON, suppress non-pen pointer events to prevent accidental drawing.
        // Use capture to intercept before renderer/tools receive them.
        const suppressIfNeeded = (e) => {
            if (!this.pencilModeEnabled) return;
            if (e.pointerType && e.pointerType !== 'pen') {
                // Stop downstream draw handlers; allow default gestures (no drawing implemented for touch now)
                e.stopPropagation();
            }
        };
        this.container.addEventListener('pointerdown', suppressIfNeeded, true);
        this.container.addEventListener('pointermove', suppressIfNeeded, true);
        this.container.addEventListener('pointerup', suppressIfNeeded, true);
        this.canvas.addEventListener('pointerdown', (event) => {
            if (!this._sketchHudState.eyedropper || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const point = this._clientToCanvas(event.clientX, event.clientY);
            const sampledColor = this._sampleCompositeColor(point.x, point.y);
            if (!sampledColor) return;
            this._sketchHudState.color = sampledColor;
            this._sketchHudState.eyedropper = false;
            this.eventBus.emit('brush:update', { color: sampledColor });
            this.eventBus.emit('tool:change', 'cursor');
            this._syncSketchHud();
        }, true);
        this.canvas.addEventListener('pointerdown', (event) => {
            if ((this.maskManager?.activeTool || '') !== 'cursor' || event.button !== 0) return;
            const point = this._clientToCanvas(event.clientX, event.clientY, { unclamped: true });
            const layer = this.renderer.pickLayerAtPoint?.(point);
            debugTrace('[CanvasView] cursor-select:pointerdown', {
                point,
                pickedLayerId: layer?.id || null,
                pickedLayerName: layer?.name || null,
                activeLayerIdBefore: this.layerManager.getActiveLayerId?.() || null,
            });
            if (!layer?.id) {
                this.eventBus.emit('canvas:selection:clear');
                return;
            }
            this.layerManager.selectLayer?.(layer.id);
            this._maybeRecomputeFrameBounds();
        }, true);
    }

    _buildFrameHandles() {
        const handleSpecs = [
            { key: 'tl', mode: 'scale-tl' },
            { key: 'tr', mode: 'scale-tr' },
            { key: 'br', mode: 'scale-br' },
            { key: 'bl', mode: 'scale-bl' },
            { key: 't', mode: 'scale-t' },
            { key: 'r', mode: 'scale-r' },
            { key: 'b', mode: 'scale-b' },
            { key: 'l', mode: 'scale-l' },
            { key: 'rotate', mode: 'rotate' },
        ];
        this._frameHandles = handleSpecs.map(({ key, mode }) => {
            const handle = document.createElement('div');
            handle.className = 'goya-frame-handle';
            handle.dataset.frameHandle = key;
            handle.dataset.frameMode = mode;
            this._framePreviewWrap.appendChild(handle);
            return handle;
        });
    }

    _bindFrameInteractions() {
        this._onFramePointerMove = (event) => {
            if (!this._frameInteraction.active) return;
            if (event.pointerId != null && this._frameInteraction.pointerId != null && event.pointerId !== this._frameInteraction.pointerId) return;
            const point = this._clientToCanvas(event.clientX, event.clientY, { unclamped: true });
            this.renderer.updateExternalTransform?.(point);
        };
        this._onFramePointerUp = (event) => {
            if (!this._frameInteraction.active) return;
            if (event.pointerId != null && this._frameInteraction.pointerId != null && event.pointerId !== this._frameInteraction.pointerId) return;
            this._frameInteraction.active = false;
            this._frameInteraction.pointerId = null;
            this._frameInteraction.mode = null;
            window.removeEventListener('pointermove', this._onFramePointerMove, true);
            window.removeEventListener('pointerup', this._onFramePointerUp, true);
            window.removeEventListener('pointercancel', this._onFramePointerUp, true);
            this.renderer.commitExternalTransform?.();
        };

        const beginFrameTransform = (mode, event) => {
            if (!this._frameEnabled || (this.maskManager?.activeTool || '') !== 'cursor' || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const point = this._clientToCanvas(event.clientX, event.clientY, { unclamped: true });
            const started = this.renderer.beginExternalTransform?.(mode, point);
            if (!started) return;
            this._frameInteraction.active = true;
            this._frameInteraction.pointerId = event.pointerId ?? null;
            this._frameInteraction.mode = mode;
            window.addEventListener('pointermove', this._onFramePointerMove, true);
            window.addEventListener('pointerup', this._onFramePointerUp, true);
            window.addEventListener('pointercancel', this._onFramePointerUp, true);
        };

        this.frameRect.addEventListener('pointerdown', (event) => beginFrameTransform('move', event));
        this._frameHandles.forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => beginFrameTransform(handle.dataset.frameMode || 'scale', event));
        });
    }

    _syncFrameInteractivity() {
        if (!this.frameOverlay || !this.frameRect || !Array.isArray(this._frameHandles)) {
            return;
        }
        const interactive = !!this._frameEnabled && (this.maskManager?.activeTool || '') === 'cursor';
        this.frameOverlay.style.pointerEvents = interactive ? 'auto' : 'none';
        this.frameRect.style.pointerEvents = interactive ? 'auto' : 'none';
        this._frameHandles.forEach((handle) => {
            handle.style.pointerEvents = interactive ? 'auto' : 'none';
            handle.style.display = this._frameEnabled ? 'block' : 'none';
        });
    }

    _buildSketchHud() {
        this._sketchHud = document.createElement('div');
        this._sketchHud.className = 'goya-sketch-hud';
        this._sketchHud.innerHTML = `
            <div class="goya-sketch-hud__dragbar" data-sketch-drag-handle>
                <span class="goya-sketch-hud__dragtitle">Sketch HUD</span>
                <span class="goya-sketch-hud__draghint">drag</span>
            </div>
            <div class="goya-sketch-hud__tools">
                <button type="button" class="goya-sketch-hud__tool" data-sketch-tool="brush">Brush</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-tool="pencil">Pencil</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-tool="eraser">Erase</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-shape="line">Line</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-shape="rect">Rect</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-shape="ellipse">Circle</button>
                <button type="button" class="goya-sketch-hud__tool" data-sketch-tool="eyedropper">Pick</button>
            </div>
            <div class="goya-sketch-hud__color-row">
                <label class="goya-sketch-hud__color-field">
                    <span>Color</span>
                    <input type="color" data-sketch-color value="#ffffff" />
                </label>
                <button type="button" class="goya-sketch-hud__tool goya-sketch-hud__tool--mini" data-sketch-fill>Fill</button>
                <button type="button" class="goya-sketch-hud__tool goya-sketch-hud__tool--mini" data-sketch-cursor>Select</button>
            </div>
            <div class="goya-sketch-hud__controls">
                <label class="goya-sketch-hud__field">
                    <span>Size</span>
                    <div data-sketch-meter="size"></div>
                    <strong data-sketch-readout="size">32</strong>
                </label>
                <label class="goya-sketch-hud__field">
                    <span>Opacity</span>
                    <div data-sketch-meter="opacity"></div>
                    <strong data-sketch-readout="opacity">100%</strong>
                </label>
            </div>
        `;
        this.container.append(this._sketchHud);
        this._buildSketchHudMeters();

        const dragHandle = this._sketchHud.querySelector('[data-sketch-drag-handle]');
        this._onSketchHudDragMove = (event) => {
            if (!this._sketchHudDrag.active) return;
            if (event.pointerId != null && this._sketchHudDrag.pointerId != null && event.pointerId !== this._sketchHudDrag.pointerId) return;
            event.preventDefault();
            const dx = event.clientX - this._sketchHudDrag.startX;
            const dy = event.clientY - this._sketchHudDrag.startY;
            const containerRect = this.container.getBoundingClientRect();
            const hudRect = this._sketchHud.getBoundingClientRect();
            const maxLeft = Math.max(12, containerRect.width - hudRect.width - 12);
            const maxTop = Math.max(12, containerRect.height - hudRect.height - 12);
            const nextLeft = Math.max(12, Math.min(maxLeft, this._sketchHudDrag.originLeft + dx));
            const nextTop = Math.max(12, Math.min(maxTop, this._sketchHudDrag.originTop + dy));
            this._sketchHud.style.left = `${nextLeft}px`;
            this._sketchHud.style.top = `${nextTop}px`;
            this._sketchHud.style.right = 'auto';
            this._sketchHud.style.bottom = 'auto';
        };
        this._onSketchHudDragEnd = (event) => {
            if (!this._sketchHudDrag.active) return;
            if (event?.pointerId != null && this._sketchHudDrag.pointerId != null && event.pointerId !== this._sketchHudDrag.pointerId) return;
            this._sketchHudDrag.active = false;
            this._sketchHudDrag.pointerId = null;
            this._sketchHud.classList.remove('is-dragging');
            window.removeEventListener('pointermove', this._onSketchHudDragMove, true);
            window.removeEventListener('pointerup', this._onSketchHudDragEnd, true);
            window.removeEventListener('pointercancel', this._onSketchHudDragEnd, true);
        };

        dragHandle?.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this._sketchHudDrag.active = true;
            this._sketchHudDrag.pointerId = event.pointerId ?? null;
            this._sketchHudDrag.startX = event.clientX;
            this._sketchHudDrag.startY = event.clientY;
            const rect = this._sketchHud.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            this._sketchHudDrag.originLeft = rect.left - containerRect.left;
            this._sketchHudDrag.originTop = rect.top - containerRect.top;
            dragHandle.setPointerCapture?.(event.pointerId);
            this._sketchHud.classList.add('is-dragging');
            window.addEventListener('pointermove', this._onSketchHudDragMove, true);
            window.addEventListener('pointerup', this._onSketchHudDragEnd, true);
            window.addEventListener('pointercancel', this._onSketchHudDragEnd, true);
        });

        this._sketchHud.querySelectorAll('[data-sketch-tool]').forEach((button) => {
            button.addEventListener('click', () => {
                const tool = button.dataset.sketchTool;
                if (tool === 'eyedropper') {
                    this._sketchHudState.eyedropper = !this._sketchHudState.eyedropper;
                    if (this._sketchHudState.eyedropper) {
                        this._sketchHudState.tool = 'eyedropper';
                    } else {
                        this.eventBus.emit('tool:change', 'cursor');
                    }
                    this._syncSketchHud();
                    return;
                }
                if (this._sketchHudState.tool === tool) {
                    this.eventBus.emit('tool:change', 'cursor');
                    return;
                }
                if (tool === 'brush' || tool === 'pencil') {
                    const currentSize = Number(this._sketchHudState.size) || (tool === 'pencil' ? 8 : 48);
                    const minVisible = tool === 'pencil' ? 4 : 8;
                    const size = Math.max(minVisible, Math.round(currentSize));
                    this._sketchHudState.size = size;
                    this.eventBus.emit('brush:update', {
                        brush: tool,
                        size,
                        opacity: Number(this._sketchHudState.opacity) || 1,
                        color: this._sketchHudState.color || '#ffffff',
                        hardness: tool === 'pencil' ? 1 : 0.75,
                        softness: tool === 'pencil' ? 0 : 0.25,
                    });
                }
                this.eventBus.emit('tool:change', tool);
            });
        });
        this._sketchHud.querySelectorAll('[data-sketch-shape]').forEach((button) => {
            button.addEventListener('click', () => {
                const shape = button.dataset.sketchShape;
                const isSameShape = (this._sketchHudState.tool === 'vector' || this._sketchHudState.tool === 'vector_fill')
                    && this._sketchHudState.vectorShape === shape;
                if (isSameShape) {
                    this.eventBus.emit('tool:change', 'cursor');
                    return;
                }
                this.eventBus.emit('vector:shape', { shape });
                this.eventBus.emit('tool:change', 'vector');
            });
        });
        this._sketchHud.querySelector('[data-sketch-color]')?.addEventListener('input', (event) => {
            const color = String(event.target.value || '#ffffff');
            this._sketchHudState.color = color;
            this.eventBus.emit('brush:update', { color });
            this._syncSketchHud();
        });
        this._sketchHud.querySelector('[data-sketch-fill]')?.addEventListener('click', () => {
            this._sketchHudState.vectorFill = !this._sketchHudState.vectorFill;
            this.eventBus.emit('vector:options', { fill: this._sketchHudState.vectorFill });
            this._syncSketchHud();
        });
        this._sketchHud.querySelector('[data-sketch-cursor]')?.addEventListener('click', () => {
            this._sketchHudState.eyedropper = false;
            this.eventBus.emit('tool:change', 'cursor');
            this.eventBus.emit('canvas:frame', { enabled: true });
            this._syncSketchHud();
        });

        this._syncSketchHud();
    }

    _buildSketchHudMeters() {
        const MeterCtor = window.GoyaMeterSlider;
        if (!MeterCtor) {
            return;
        }

        this._sketchHudSizeMeter = new MeterCtor({
            orientation: 'horizontal',
            min: 1,
            max: 256,
            value: this._sketchHudState.size,
            step: 1,
            colorStart: '#FF3B3B',
            colorEnd: '#00FF6A',
            width: '100%',
            onChange: (value) => {
                const size = Math.max(1, Math.round(value));
                this._sketchHudState.size = size;
                const tool = this._sketchHudState.tool;
                if (tool === 'eraser') {
                    this.eventBus.emit('eraser:brush', { size });
                } else if (tool === 'vector' || tool === 'vector_fill') {
                    this.eventBus.emit('vector:brush', { size });
                } else {
                    this.eventBus.emit('brush:update', { size });
                }
                this._syncSketchHud();
            },
        });
        this._sketchHudOpacityMeter = new MeterCtor({
            orientation: 'horizontal',
            min: 0.05,
            max: 1,
            value: this._sketchHudState.opacity,
            step: 0.05,
            snapExempt: true,
            colorStart: '#2b6cb0',
            colorEnd: '#e6f2ff',
            width: '100%',
            onChange: (value) => {
                const opacity = Math.max(0.05, Math.min(1, value));
                this._sketchHudState.opacity = opacity;
                this.eventBus.emit('brush:update', { opacity });
                this._syncSketchHud();
            },
        });

        this._sketchHud.querySelector('[data-sketch-meter="size"]')?.append(this._sketchHudSizeMeter.getElement());
        this._sketchHud.querySelector('[data-sketch-meter="opacity"]')?.append(this._sketchHudOpacityMeter.getElement());
    }

    _syncDrawSurface(drawOnly) {
        this.canvas.classList.remove('goya-main-canvas--draw-surface');
        this.renderer?.requestRender?.();
    }

    _sampleCompositeColor(x, y) {
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            return null;
        }
        const px = Math.max(0, Math.min(this.canvas.width - 1, Math.round(x)));
        const py = Math.max(0, Math.min(this.canvas.height - 1, Math.round(y)));
        const data = ctx.getImageData(px, py, 1, 1).data;
        return `#${[data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    }

    _shouldShowSketchHud() {
        if (!this._sketchHudState.hudEnabled) {
            return false;
        }
        return true;
    }

    _syncSketchHud() {
        if (!this._sketchHud) return;
        const visible = this._shouldShowSketchHud();
        this._sketchHud.classList.toggle('is-hidden', !visible);

        const sizeInput = this._sketchHud.querySelector('[data-sketch-control="size"]');
        const opacityInput = this._sketchHud.querySelector('[data-sketch-control="opacity"]');
        const sizeReadout = this._sketchHud.querySelector('[data-sketch-readout="size"]');
        const opacityReadout = this._sketchHud.querySelector('[data-sketch-readout="opacity"]');
        const colorInput = this._sketchHud.querySelector('[data-sketch-color]');
        if (sizeInput) sizeInput.value = String(this._sketchHudState.size);
        if (opacityInput) opacityInput.value = String(this._sketchHudState.opacity);
        if (colorInput) colorInput.value = this._sketchHudState.color;
        this._sketchHudSizeMeter?.setValue(this._sketchHudState.size);
        this._sketchHudOpacityMeter?.setValue(this._sketchHudState.opacity);
        if (sizeReadout) sizeReadout.textContent = String(this._sketchHudState.size);
        if (opacityReadout) opacityReadout.textContent = `${Math.round(this._sketchHudState.opacity * 100)}%`;

        this._sketchHud.querySelectorAll('[data-sketch-tool]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.sketchTool === this._sketchHudState.tool);
        });
        this._sketchHud.querySelectorAll('[data-sketch-shape]').forEach((button) => {
            const isVector = this._sketchHudState.tool === 'vector' || this._sketchHudState.tool === 'vector_fill';
            button.classList.toggle('is-active', isVector && button.dataset.sketchShape === this._sketchHudState.vectorShape);
        });
        this._sketchHud.querySelector('[data-sketch-fill]')?.classList.toggle('is-active', !!this._sketchHudState.vectorFill);
        this._syncFrameInteractivity();
    }

    destroy() {
        try { this._resizeObserver?.disconnect?.(); } catch (_e) {}
        try { this.container?.removeEventListener("wheel", this._onWheelHandler, { passive: false }); } catch (_e) {}
        try { if (this._cropOverlay?._cleanup) this._cropOverlay._cleanup(); } catch (_e) {}
        try {
            this.compareDragging = false;
            window.removeEventListener('mousemove', this._overlayMoveHandler, true);
            window.removeEventListener('mouseup', this._overlayUpHandler, true);
        } catch (_e) {}
    }

    resize(width = Constants.CANVAS_WIDTH, height = Constants.CANVAS_HEIGHT) {
        const changed = (this.canvas.width !== width || this.canvas.height !== height);
        this.renderer.resize(width, height);
        this._recomputeFitScale();
        // announce size to UI (both events for broader compatibility)
        this.eventBus.emit("canvas:size", { width, height });
        this.eventBus.emit("canvas:resize", { width, height });
        this._layoutResolutionFrame();
        // Force a full repaint so the canvas is never left blank after a dimension change
        if (changed) {
            try { this.renderer._requestRender?.(); } catch (_e) {}
        }
    }

    exportComposite() {
        return this.renderer.exportComposite();
    }

    _setCompareImage(dataUrl) {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.compareImage = img;
                // Ensure overlay backing store matches canvas and render immediately
                this.compareOverlay.width = this.canvas.width;
                this.compareOverlay.height = this.canvas.height;
                if (this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);
                this._renderCompareOverlay();
            };
            img.onerror = () => { this.compareImage = null; this._renderCompareOverlay(); };
            img.src = dataUrl;
        } catch (_e) {
            this.compareImage = null;
            this._renderCompareOverlay();
        }
    }

    _setCompareBaseline(dataUrl) {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.compareBaseImage = img;
                this.compareOverlay.width = this.canvas.width;
                this.compareOverlay.height = this.canvas.height;
                if (this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);
                this._renderCompareOverlay();
            };
            img.onerror = () => { this.compareBaseImage = null; this._renderCompareOverlay(); };
            img.src = dataUrl;
        } catch (_e) {
            this.compareBaseImage = null;
            this._renderCompareOverlay();
        }
    }

    _renderCompareOverlay() {
        try {
            const ctx = this.compareOverlay.getContext('2d');
            if (!ctx) return;
            // Clear overlay fully
            ctx.clearRect(0, 0, this.compareOverlay.width, this.compareOverlay.height);
            if (!this.compareEnabled) return;
            const W = this.canvas.width|0; const H = this.canvas.height|0;
            const wipe = Math.max(0, Math.min(W, (this.compareWipeX == null ? Math.floor(W/2) : this.compareWipeX|0)));
            // Dual-image compare: draw compare and baseline on opposite halves
            const layers = this.layerManager?.getLayers?.() || [];
            const hasLayerBaseline = layers.some(l => !!(l && l.visible && l.bitmap));
            const drawContained = (img) => {
                const imgW = img.naturalWidth || img.width || W;
                const imgH = img.naturalHeight || img.height || H;
                const scaleContain = Math.min(W / imgW, H / imgH);
                const scale = scaleContain; // allow upscaling to fit canvas for accurate upscale comparison
                const drawW = Math.floor(imgW * scale);
                const drawH = Math.floor(imgH * scale);
                const offX = Math.floor((W - drawW) / 2);
                const offY = Math.floor((H - drawH) / 2);
                ctx.drawImage(img, offX, offY, drawW, drawH);
            };

            if (this.compareImage && this.compareBaseImage) {
                // Compare half
                ctx.save();
                if (this.compareDirection === 'ltr') {
                    ctx.beginPath(); ctx.rect(0, 0, wipe, H); ctx.clip();
                } else {
                    ctx.beginPath(); ctx.rect(wipe, 0, W - wipe, H); ctx.clip();
                }
                drawContained(this.compareImage);
                ctx.restore();
                // Baseline half
                ctx.save();
                if (this.compareDirection === 'ltr') {
                    ctx.beginPath(); ctx.rect(wipe, 0, W - wipe, H); ctx.clip();
                } else {
                    ctx.beginPath(); ctx.rect(0, 0, wipe, H); ctx.clip();
                }
                drawContained(this.compareBaseImage);
                ctx.restore();
            } else if (this.compareImage) {
                // Single-image compare. If the canvas has a baseline image in layers, clip to half; otherwise draw full.
                ctx.save();
                if (hasLayerBaseline) {
                    if (this.compareDirection === 'ltr') {
                        ctx.beginPath(); ctx.rect(0, 0, wipe, H); ctx.clip();
                    } else {
                        ctx.beginPath(); ctx.rect(wipe, 0, W - wipe, H); ctx.clip();
                    }
                }
                drawContained(this.compareImage);
                ctx.restore();
            }
            // Draw splitter handle
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(wipe+0.5, 0); ctx.lineTo(wipe+0.5, H); ctx.stroke();
            // Small grabber
            ctx.fillStyle = 'rgba(0, 180, 255, 0.9)';
            ctx.fillRect(Math.max(0, wipe-3), Math.max(0, Math.floor(H/2)-20), 6, 40);
            ctx.restore();
        } catch (_e) {}
    }

    _bindDropZone() {
        this._onDragEnterHandler = (event) => {
            if (!this._supportsDrop(event)) {
                return;
            }
            event.preventDefault();
            this.container.classList.add("goya-canvas-container--dropping");
        };

        this._onDragOverHandler = (event) => {
            if (!this._supportsDrop(event)) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
        };

        this._onDragLeaveHandler = (event) => {
            if (event.currentTarget !== this.container) {
                return;
            }
            if (event.relatedTarget && this.container.contains(event.relatedTarget)) {
                return;
            }
            this.container.classList.remove("goya-canvas-container--dropping");
        };

        this._onDropHandler = (event) => {
            if (!this._supportsDrop(event)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.container.classList.remove("goya-canvas-container--dropping");
            
            // Previeni che ComfyUI apra il workflow in altra tab
            if (event.dataTransfer?.files?.length) {
                // Blocca la propagazione verso ComfyUI
                event.stopImmediatePropagation();
                this.eventBus.emit("canvas:import:files", { files: event.dataTransfer.files });
                return;
            }

            // Drag from Gallery (JSON payload): set compare slot(s)
            try {
                const dt = event.dataTransfer;
                const raw = dt.getData("application/x-goya-gallery-image") || dt.getData("application/json") || dt.getData("text/plain") || "";
                if (!raw) return;
                const obj = JSON.parse(raw);
                if (!obj || obj.kind !== "goya-gallery-image" || !obj.url) return;

                // Auto-enable compare on drop
                this.compareEnabled = true;
                this.compareOverlay.style.pointerEvents = 'auto';
                if (this.compareWipeX == null) this.compareWipeX = Math.floor(this.canvas.width / 2);

                // Simpler UX: drop-left sets BASELINE, drop-right sets COMPARE.
                // This matches the user's expectation of two explicit slots.
                const rect = this.container.getBoundingClientRect();
                const leftSide = (event.clientX - rect.left) < (rect.width / 2);

                const setCompare = (url) => { try { this._setCompareImage(url); } catch (_e) {} };
                const setBaseline = (url) => { try { this._compareBaselineExplicit = true; this._setCompareBaseline(url); } catch (_e) {} };

                if (leftSide) setBaseline(obj.url);
                else setCompare(obj.url);

                // Default to baseline-left / compare-right
                if (!this._compareDirectionUserTouched) {
                    this.compareDirection = 'rtl';
                }
                // Keep toolbar and other UI in sync
                try { this.eventBus.emit("compare:toggle", { enabled: true }); } catch (_e) {}
                this._renderCompareOverlay();
            } catch (_e) {
                // ignore
            }
        };

        this.container.addEventListener("dragenter", this._onDragEnterHandler);
        this.container.addEventListener("dragover", this._onDragOverHandler);
        this.container.addEventListener("dragleave", this._onDragLeaveHandler);
        this.container.addEventListener("drop", this._onDropHandler);
    }

    _supportsDrop(event) {
        // When the inline text editor is open, treat the canvas as non-droppable.
        // Otherwise dragging/selecting text inside the editor triggers dragenter/dragover/drop
        // and can temporarily hijack the whole workspace.
        if (this._textEditorEl) {
            return false;
        }
        if (!event?.dataTransfer) {
            return false;
        }
        const dt = event.dataTransfer;

        // Accept file drops (images)
        const hasFilesType = dt.types && Array.from(dt.types).includes("Files");
        if (hasFilesType) {
            if (dt.items) {
                return Array.from(dt.items).some(
                    (item) => item.kind === "file" && (!item.type || item.type.startsWith("image/"))
                );
            }
            return dt.files && dt.files.length > 0;
        }

        // Accept Gallery drags (avoid getData() during dragover/dragenter; many browsers return empty there)
        const types = Array.from(dt.types || []);
        if (types.includes("application/x-goya-gallery-image")) return true;
        if (types.includes("application/json") || types.includes("text/plain")) return true;
        return false;
    }

    setUserZoom(value) {
        const clamped = Math.max(0.1, Math.min(8, value));
        this.userZoom = clamped;
        this._applyZoomTransform();
    }

    _bindCanvasPanInteractions() {
        const isEditableTarget = (target) => {
            try {
                return !!target?.closest?.('input, textarea, select, button, [contenteditable="true"]');
            } catch (_e) {
                return false;
            }
        };
        const endPan = (event) => {
            if (!this._canvasPanDrag.active) return;
            if (event?.pointerId != null && this._canvasPanDrag.pointerId != null && event.pointerId !== this._canvasPanDrag.pointerId) return;
            this._canvasPanDrag.active = false;
            this._canvasPanDrag.pointerId = null;
            try { this.container.releasePointerCapture?.(event.pointerId); } catch (_e) {}
            if ((this.maskManager?.activeTool || '') === 'canvas_pan' && this._canvasPanMode) {
                this.container.style.cursor = 'grab';
            }
            window.removeEventListener('pointermove', movePan, true);
            window.removeEventListener('pointerup', endPan, true);
            window.removeEventListener('pointercancel', endPan, true);
        };
        const movePan = (event) => {
            if (!this._canvasPanDrag.active) return;
            if (event?.pointerId != null && this._canvasPanDrag.pointerId != null && event.pointerId !== this._canvasPanDrag.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            this._viewportPan = {
                x: this._canvasPanDrag.originX + (event.clientX - this._canvasPanDrag.startX),
                y: this._canvasPanDrag.originY + (event.clientY - this._canvasPanDrag.startY),
            };
            this._applyZoomTransform();
        };
        this.container.addEventListener('pointerdown', (event) => {
            const activeTool = this.maskManager?.activeTool || '';
            const shouldPan = activeTool === 'canvas_pan' && this._canvasPanMode;
            if (!shouldPan || event.button !== 0 || isEditableTarget(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            this._canvasPanDrag = {
                active: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: Number(this._viewportPan?.x) || 0,
                originY: Number(this._viewportPan?.y) || 0,
            };
            try { this.container.setPointerCapture?.(event.pointerId); } catch (_e) {}
            this.container.style.cursor = 'grabbing';
            window.addEventListener('pointermove', movePan, true);
            window.addEventListener('pointerup', endPan, true);
            window.addEventListener('pointercancel', endPan, true);
        }, true);
    }

    _recomputeFitScale() {
        const w = this.canvas.width || 1;
        const h = this.canvas.height || 1;
        const cw = this.container.clientWidth || 1;
        const ch = this.container.clientHeight || 1;
        this.baseFitScale = Math.min(cw / w, ch / h);
        this._applyZoomTransform();
    }

    _applyZoomTransform() {
        const scale = this.baseFitScale * this.userZoom;
        const panX = Number(this._viewportPan?.x) || 0;
        const panY = Number(this._viewportPan?.y) || 0;
        // Center the canvas within the checkerboard container and scale
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = `calc(50% + ${panX}px)`;
        this.canvas.style.top = `calc(50% + ${panY}px)`;
        this.canvas.style.transformOrigin = "center center";
        this.canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
        // Override CSS max-width/max-height so the canvas CSS box matches its
        // bitmap resolution.  Without this the stylesheet constraint clamps the
        // box to the container size BEFORE the scale() transform is applied,
        // causing baseFitScale to double-shrink the canvas and making dimension
        // changes appear to have no visual effect.
        this.canvas.style.maxWidth = 'none';
        this.canvas.style.maxHeight = 'none';
        // Keep compare overlay aligned with canvas
        if (this.compareOverlay) {
            this.compareOverlay.style.left = `calc(50% + ${panX}px)`;
            this.compareOverlay.style.top = `calc(50% + ${panY}px)`;
            this.compareOverlay.style.width = `${this.canvas.width}px`;
            this.compareOverlay.style.height = `${this.canvas.height}px`;
            this.compareOverlay.style.transform = `translate(-50%, -50%) scale(${scale})`;
        }
        // Notify overlays (e.g., vector layer) to sync transform
        this.eventBus.emit("canvas:transform", { scale, transform: `scale(${scale})` });
        // Sync frame overlay base transform and rect layout
        this.frameOverlay.style.width = `${this.canvas.width}px`;
        this.frameOverlay.style.height = `${this.canvas.height}px`;
        this.frameOverlay.style.left = `calc(50% + ${panX}px)`;
        this.frameOverlay.style.top = `calc(50% + ${panY}px)`;
        this.frameOverlay.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this._frameActiveWrap.style.transform = '';
        this._framePreviewWrap.style.transform = '';
        if (this._frameEnabled) this._layoutFrameRect();
        // keep resolution frame in sync
        this._layoutResolutionFrame();
        this.cropController?.refresh?.();
        // Update liquify ring size/position
        if (this._liqRing && this._liqRing._radius) this._updateLiqRingSize(this._liqRing._radius);
    }

    _layoutResolutionFrame() {
        try {
            if (!this._resFrame) return;
            const w = this.canvas.width || 1;
            const h = this.canvas.height || 1;
            Object.assign(this._resFrame.style, { left: '0px', top: '0px', width: `${w}px`, height: `${h}px` });
            if (this._resFrameLabel) this._resFrameLabel.textContent = `${w} x ${h}`;
        } catch (_e) { /* ignore */ }
    }

    _toggleFrame(enabled, { preserveTool = false } = {}) {
        const activeTool = this.maskManager?.activeTool || '';
        if (activeTool === 'vector' && enabled) {
            enabled = false;
            preserveTool = true;
        }
        this._frameEnabled = !!enabled;
        const frameCompatibleTool = activeTool === 'cursor';
        debugTrace('[CanvasView] frame-toggle', {
            enabled: this._frameEnabled,
            preserveTool,
            activeTool,
            frameCompatibleTool,
        });
        if (this._frameEnabled && !preserveTool && !frameCompatibleTool) {
            this.eventBus.emit('tool:change', 'cursor');
        }
        this.frameOverlay.style.display = this._frameEnabled ? "block" : "none";
        this.eventBus.emit('canvas:frame:state', { enabled: this._frameEnabled });
        // Keep resolution frame visible and synced
        this._applyZoomTransform();
        this._syncFrameInteractivity();
        if (this._frameEnabled) {
            this._maybeRecomputeFrameBounds();
        }
    }

    _updateFramePreview({ mode, dx=0, dy=0, sx=1, sy=1, angle=0, ax=0, ay=0, originX=null, originY=null, bounds=null, layerId=null, baseBounds=null, transform=null }) {
        if (!this._frameEnabled) return;
        const active = this.layerManager.getActiveLayer?.();
        const previewState = (layerId && (bounds || baseBounds || transform))
            ? { layerId, bounds, baseBounds, transform, dx, dy, sx, sy, angle, ax, ay, originX, originY }
            : this.renderer?.getTransformPreviewFrameState?.();
        if (previewState?.layerId && previewState.layerId === active?.id && previewState.baseBounds && previewState.transform) {
            this._applyFrameGeometry(this._buildFrameGeometry(previewState.baseBounds, previewState.transform, {
                originX: previewState.originX,
                originY: previewState.originY,
            }));
            this.frameOverlay.style.display = "block";
            return;
        }
        const fallbackBounds = this._frameBounds || this._frameBaseBounds || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        const activeTransform = this._getActiveFrameTransform();
        const previewTransform = this._normFrameTransform({
            dx,
            dy,
            sx,
            sy,
            angle,
            ax,
            ay,
        });
        const composedPreview = TransformMath.compose(activeTransform, previewTransform);
        this._applyFrameGeometry(this._buildFrameGeometry(fallbackBounds, composedPreview, {
            originX: Number.isFinite(originX) ? originX : (this.canvas.width / 2),
            originY: Number.isFinite(originY) ? originY : (this.canvas.height / 2),
        }));
        this.frameOverlay.style.display = "block";

        // Preview bitmap is handled by the renderer; the overlay only mirrors the same transform.
    }

    _resetFramePreview() {
        if (!this._frameEnabled) { this.frameOverlay.style.display = "none"; return; }
        this._layoutFrameRect();
    }

    _primeLayerImageCache(layerId, dataUrl) {
        if (!layerId || !dataUrl) return;
        try {
            const image = new Image();
            image.onload = () => {
                try { this.renderer?.requestRender?.(); } catch (_e) {}
                try { this.renderer?._requestRender?.(); } catch (_e) {}
            };
            image.src = dataUrl;
            this.renderer?.imageCache?.set?.(layerId, { image, src: dataUrl });
        } catch (_e) {}
    }
    _clearGeneratedViewState() {
        this.compareEnabled = false;
        this.compareImage = null;
        this.compareBaseImage = null;
        this._compareBaselineExplicit = false;
        this._generationOriginMode = null;
        this._preRunCompositeDataUrl = "";
        this.compareDragging = false;
        this.compareWipeX = null;
        if (this.compareOverlay) {
            this.compareOverlay.style.display = 'none';
            this.compareOverlay.style.pointerEvents = 'none';
            const overlayCtx = this.compareOverlay.getContext?.('2d');
            overlayCtx?.clearRect?.(0, 0, this.compareOverlay.width, this.compareOverlay.height);
        }
    }

    _padDataUrl(src, size, offset) {
        try {
            const img = new Image();
            img.src = src;
            const w = Math.max(1, Math.floor(size?.w ?? 1));
            const h = Math.max(1, Math.floor(size?.h ?? 1));
            const dx = Math.floor(offset?.dx ?? 0);
            const dy = Math.floor(offset?.dy ?? 0);
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, dx, dy);
            return c.toDataURL("image/png");
        } catch (_e) {
            return src;
        }
    }

    async _padDataUrlAsync(src, size, offset) {
        try {
            const w = Math.max(1, Math.floor(size?.w ?? 1));
            const h = Math.max(1, Math.floor(size?.h ?? 1));
            const dx = Math.floor(offset?.dx ?? 0);
            const dy = Math.floor(offset?.dy ?? 0);
            const img = await this._loadImageAsync(src);
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, dx, dy);
            return c.toDataURL("image/png");
        } catch (_e) {
            return src;
        }
    }

    async _loadImageAsync(src) {
        const img = new Image();
        img.src = src;
        // Fast path: already loaded and valid
        if (img.complete && img.naturalWidth > 0) return img;
        // Prefer decode() when available
        if (typeof img.decode === 'function') {
            try {
                await img.decode();
                if (img.naturalWidth > 0) return img;
            } catch (_e) {
                // fall through to onload
            }
        }
        await new Promise((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
        });
        return img;
    }

    _snapPoint(p) {
        try {
            const step = Math.max(1, this._snapStep | 0);
            return {
                x: Math.round(p.x / step) * step,
                y: Math.round(p.y / step) * step
            };
        } catch (_e) {
            return p;
        }
    }

    _clientToCanvas(clientX, clientY, opts = {}) {
        const { unclamped = false } = opts || {};
        const rect = this.canvas.getBoundingClientRect();
        const cx = ((clientX - rect.left) / rect.width) * this.canvas.width;
        const cy = ((clientY - rect.top) / rect.height) * this.canvas.height;
        if (unclamped) {
            return { x: cx, y: cy };
        }
        return { x: Math.max(0, Math.min(this.canvas.width, cx)), y: Math.max(0, Math.min(this.canvas.height, cy)) };
    }

    _openTextEditor({ layerId, rect, text, style }) {
        // Disabled: the text overlay caused input/clickability regressions.
        return;

        // Remove existing editor if any
        if (this._textEditorEl && this._textEditorEl.parentElement) {
            this._textEditorEl.parentElement.removeChild(this._textEditorEl);
        }
        const scale = this.baseFitScale * this.userZoom;
        const left = (this.container.clientWidth - this.canvas.width * scale) / 2 + rect.x * scale;
        const top = (this.container.clientHeight - this.canvas.height * scale) / 2 + rect.y * scale;
        const w = rect.w * scale; const h = rect.h * scale;
        const t = style || {};
        const baseSize = Number.isFinite(Number(t.size)) ? Number(t.size) : 24;
        const fontSizePx = Math.max(8, baseSize * scale);
        const fontFamily = String(t.font || 'Arial');
        const fontWeight = t.bold ? '700' : '400';
        const fontStyle = t.italic ? 'italic' : 'normal';
        const textAlign = (t.align === 'center' || t.align === 'right') ? t.align : 'left';
        const ta = document.createElement("textarea");
        ta.value = text || "";
        ta.className = "goya-text-editor";
        // Prevent native drag behavior (and its drag/drop events) from escaping into the canvas drop zone.
        ta.setAttribute('draggable', 'false');
        ta.draggable = false;
        Object.assign(ta.style, {
            position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
            resize: 'none',
            background: 'var(--panel)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            outline: 'none',
            padding: '6px',
            fontFamily,
            fontSize: `${fontSizePx}px`,
            lineHeight: `${Math.round(fontSizePx * 1.25)}px`,
            fontWeight,
            fontStyle,
            textAlign,
            boxSizing: 'border-box',
        });

        // Keep workspace/canvas tools fully functional while editing.
        const swallow = (e) => { try { e.stopPropagation(); } catch (_e) {} };
        ta.addEventListener('pointerdown', swallow, true);
        ta.addEventListener('pointermove', swallow, true);
        ta.addEventListener('pointerup', swallow, true);
        ta.addEventListener('mousedown', swallow, true);
        ta.addEventListener('mousemove', swallow, true);
        ta.addEventListener('mouseup', swallow, true);
        ta.addEventListener('dragstart', (e) => { e.preventDefault(); swallow(e); });
        ta.addEventListener('dragenter', swallow, true);
        ta.addEventListener('dragover', swallow, true);
        ta.addEventListener('drop', (e) => { e.preventDefault(); swallow(e); }, true);
        // Allow scrolling inside textarea, but do not let it zoom/pan the canvas.
        ta.addEventListener('wheel', swallow, { passive: true });

        this.container.appendChild(ta);
        this._textEditorEl = ta;
        ta.focus();
        const commit = () => {
            const layers = this.layerManager.getLayers?.() || [];
            const layer = layers.find(l => l.id === layerId);
            if (layer) {
                const meta = Object.assign({}, layer.metadata || {});
                meta.type = 'text';
                meta.text = Object.assign({}, meta.text || {}, { value: ta.value });
                this.layerManager.updateLayer?.({ id: layerId, patch: { metadata: meta } });
            }
            if (ta.parentElement) ta.parentElement.removeChild(ta);
            this._textEditorEl = null;
        };
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } });
    }

    _onEffectApply({ effect, enabled, amount=1.0 }) {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active) return;
        const id = active.id;
        const current = active.bitmap;
        if (!current) return;

        // Init state for this layer
        if (!this._effectsState[id]) {
            this._effectsState[id] = { original: current, map: {} };
        }
        const state = this._effectsState[id];
        if (!state.original) state.original = current;

        // Update map entry
        state.map[effect] = { enabled: !!enabled, amount: Math.max(0, Math.min(1, amount ?? 1)) };

        // If all effects disabled, restore original
        const anyEnabled = Object.values(state.map).some(e => e?.enabled);
        if (!anyEnabled) {
            this.layerManager.updateLayer?.({ id, patch: { bitmap: state.original } });
            this.renderer.requestRender?.();
            // Keep original for future but clear map
            return;
        }

        // Recompute pipeline from original using a fixed order
        const order = [
            'negative','grayscale','sepia','posterize','solarize','bleach','sharpen','blur','emboss','vignette','liquify','hue-rotate','saturate','desaturate','brightness','contrast'
        ];
        let chain = Promise.resolve(state.original);
        order.forEach(key => {
            const cfg = state.map[key];
            if (!cfg || !cfg.enabled) return;
            chain = chain.then((url) => this._applyEffectURL(url, key, cfg.amount));
        });
        chain.then((finalUrl) => {
            this.layerManager.updateLayer?.({ id, patch: { bitmap: finalUrl } });
            this.renderer.requestRender?.();
            // Refresh histogram
            this.eventBus.emit("image:histogram:request", {});
        }).catch(()=>{});
    }

    _applyEffectURL(url, effect, amount=1.0) {
        const amt = Math.max(0, Math.min(1, amount ?? 1));
        return this._processImageURL(url, (imgData) => {
            const orig = new Uint8ClampedArray(imgData.data);
            const processed = this._processByEffect(imgData, effect) || imgData;
            if (amt < 1) {
                const p = processed.data; const len = p.length;
                for (let i=0;i<len;i+=4){
                    p[i]   = Math.round(orig[i]*(1-amt)   + p[i]*amt);
                    p[i+1] = Math.round(orig[i+1]*(1-amt) + p[i+1]*amt);
                    p[i+2] = Math.round(orig[i+2]*(1-amt) + p[i+2]*amt);
                }
            }
            return processed;
        });
    }

    _processByEffect(imgData, effect) {
        const data = imgData.data;
        const len = data.length;
        switch ((effect || '').toLowerCase()) {
            case 'liquify': {
                return this._liquify(imgData);
            }
            case 'negative':
                for (let i = 0; i < len; i += 4) {
                    data[ i ] = 255 - data[ i ];
                    data[i+1] = 255 - data[i+1];
                    data[i+2] = 255 - data[i+2];
                }
                break;
            case 'grayscale':
                for (let i = 0; i < len; i += 4) {
                    const r = data[i], g = data[i+1], b = data[i+2];
                    const y = 0.2126*r + 0.7152*g + 0.0722*b;
                    data[i] = data[i+1] = data[i+2] = y;
                }
                break;
            case 'sepia':
                for (let i = 0; i < len; i += 4) {
                    const r = data[i], g = data[i+1], b = data[i+2];
                    data[i]   = Math.min(255, 0.393*r + 0.769*g + 0.189*b);
                    data[i+1] = Math.min(255, 0.349*r + 0.686*g + 0.168*b);
                    data[i+2] = Math.min(255, 0.272*r + 0.534*g + 0.131*b);
                }
                break;
            case 'posterize': {
                const levels = 8; const step = 255/(levels-1);
                for (let i = 0; i < len; i += 4) {
                    data[i] = Math.round(data[i]/step)*step;
                    data[i+1] = Math.round(data[i+1]/step)*step;
                    data[i+2] = Math.round(data[i+2]/step)*step;
                }
                break; }
            case 'solarize':
                for (let i = 0; i < len; i += 4) {
                    data[i]   = data[i]   > 127 ? 255 - data[i]   : data[i];
                    data[i+1] = data[i+1] > 127 ? 255 - data[i+1] : data[i+1];
                    data[i+2] = data[i+2] > 127 ? 255 - data[i+2] : data[i+2];
                }
                break;
            case 'bleach bypass':
            case 'bleach':
                for (let i = 0; i < len; i += 4) {
                    const r = data[i], g = data[i+1], b = data[i+2];
                    const y = 0.2126*r + 0.7152*g + 0.0722*b;
                    // desaturate towards luminance
                    const mix = 0.6; // stronger desat
                    let nr = r*(1-mix) + y*mix;
                    let ng = g*(1-mix) + y*mix;
                    let nb = b*(1-mix) + y*mix;
                    // increase contrast slightly
                    const c = 1.15;
                    nr = (nr-128)*c + 128;
                    ng = (ng-128)*c + 128;
                    nb = (nb-128)*c + 128;
                    data[i] = Math.max(0, Math.min(255, nr));
                    data[i+1] = Math.max(0, Math.min(255, ng));
                    data[i+2] = Math.max(0, Math.min(255, nb));
                }
                break;
            case 'sharpen':
                return this._convolve(imgData, [0,-1,0,-1,5,-1,0,-1,0]);
            case 'emboss':
                return this._convolve(imgData, [-2,-1,0,-1,1,1,0,1,2]);
            case 'blur':
                return this._boxBlur(imgData);
            case 'vignette': {
                const w = imgData.width, h = imgData.height; const cx = w/2, cy=h/2; const maxd = Math.sqrt(cx*cx+cy*cy);
                for (let y=0;y<h;y++){
                    for (let x=0;x<w;x++){
                        const dx=x-cx, dy=y-cy; const d=Math.sqrt(dx*dx+dy*dy)/maxd; const v=Math.max(0.5,1-d*0.8);
                        const i=(y*w+x)*4; data[i]=data[i]*v; data[i+1]=data[i+1]*v; data[i+2]=data[i+2]*v;
                    }
                }
                break; }
            case 'hue-rotate':
                return this._hueRotate(imgData, 30);
            case 'saturate':
                return this._saturate(imgData, 1.3);
            case 'desaturate':
                return this._saturate(imgData, 0.7);
            case 'brightness':
                return this._brightnessContrast(imgData, 20, 0);
            case 'contrast':
                return this._brightnessContrast(imgData, 0, 20);
            default:
                break;
        }
        return imgData;
    }

    _liquify(imgData) {
        // Simple swirl-like liquify around center; strength tuned; external amount blends result
        const w = imgData.width, h = imgData.height;
        const src = imgData.data;
        const out = new ImageData(w, h);
        const dst = out.data;
        const cx = w / 2, cy = h / 2;
        const maxR = Math.sqrt(cx*cx + cy*cy);
        const baseAngle = 0.6; // radians max rotation near center
        for (let y=0; y<h; y++) {
            for (let x=0; x<w; x++) {
                const dx = x - cx, dy = y - cy;
                const r = Math.sqrt(dx*dx + dy*dy);
                const t = 1 - Math.min(1, r / maxR);
                const ang = baseAngle * t*t; // stronger near center
                const ca = Math.cos(ang), sa = Math.sin(ang);
                const sx = Math.round(cx + dx*ca - dy*sa);
                const sy = Math.round(cy + dx*sa + dy*ca);
                const si = (Math.min(h-1, Math.max(0, sy)) * w + Math.min(w-1, Math.max(0, sx))) * 4;
                const di = (y * w + x) * 4;
                dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = src[si+3];
            }
        }
        return out;
    }

    _onCurvesApply(lut) {
        const apply = (url) => this._processImageURL(url, (imgData) => this._applyLUT(imgData, lut));
        this._updateActiveBitmap(apply);
        // trigger live histogram update for previews
        this.eventBus.emit("image:histogram:request", {});
    }

    _onLevelsApply(black=0, white=255, gamma=1.0) {
        const apply = (url) => this._processImageURL(url, (imgData) => this._applyLevels(imgData, black, white, gamma));
        this._updateActiveBitmap(apply);
    }

    _onRgbApply(r=0,g=0,b=0) {
        const apply = (url) => this._processImageURL(url, (imgData) => this._applyRGB(imgData, r,g,b));
        this._updateActiveBitmap(apply);
    }

    _onColorWheelApply(hueDeg=0, sat=1) {
        const apply = (url) => this._processImageURL(url, (imgData) => this._applyHueSat(imgData, hueDeg, sat));
        this._updateActiveBitmap(apply);
    }

    _updateActiveBitmap(transformPromiseFactory) {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.bitmap) return;
        transformPromiseFactory(active.bitmap).then((outUrl) => {
            this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: outUrl } });
            this.renderer.requestRender?.();
        }).catch(()=>{});
    }

    _applyLUT(imgData, lutArr) {
        const lut = Array.isArray(lutArr) ? lutArr : [];
        const data = imgData.data;
        for (let i=0;i<data.length;i+=4){ data[i]=lut[data[i]]??data[i]; data[i+1]=lut[data[i+1]]??data[i+1]; data[i+2]=lut[data[i+2]]??data[i+2]; }
        return imgData;
    }

    _applyLevels(imgData, black, white, gamma=1.0) {
        const data = imgData.data; const scale = 255/(white - black || 1);
        for (let i=0;i<data.length;i+=4){
            for (let c=0;c<3;c++){
                let v = (data[i+c]-black)*scale; v = Math.max(0, Math.min(255, v));
                v = 255 * Math.pow(v/255, 1/(gamma||1));
                data[i+c] = v;
            }
        }
        return imgData;
    }

    _applyRGB(imgData, r,g,b) {
        const data = imgData.data; const add = [r,g,b];
        for (let i=0;i<data.length;i+=4){ data[i]=Math.max(0, Math.min(255, data[i]+add[0])); data[i+1]=Math.max(0, Math.min(255, data[i+1]+add[1])); data[i+2]=Math.max(0, Math.min(255, data[i+2]+add[2])); }
        return imgData;
    }

    _onAdjustImage({ exposure=1, brightness=1, contrast=1, saturation=1, gamma=1, curve=0 }) {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.bitmap) return;
        // Preserve original the first time
        if (!this._adjustState) this._adjustState = {};
        if (!this._adjustState[active.id]) {
            this._adjustState[active.id] = { original: active.bitmap };
        }
        const state = this._adjustState[active.id];
        const original = state.original;
        // Chain transforms off original each time (stateless - no accumulation)
        this._processImageURL(original, (imgData) => {
            imgData = this._applyExposure(imgData, exposure);
            imgData = this._applyBrightnessContrastSat(imgData, brightness, contrast, saturation);
            if (Math.abs(gamma - 1) > 0.001) imgData = this._applyGamma(imgData, gamma);
            if (Math.abs(curve) > 0.001) imgData = this._applyCurve(imgData, curve);
            return imgData;
        }).then((outUrl)=>{
            this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: outUrl } });
            this.renderer.requestRender?.();
        }).catch(()=>{});
    }
    _applyExposure(imgData, exposure){
        if (Math.abs(exposure - 1) < 1e-3) return imgData;
        const d = imgData.data; for (let i=0;i<d.length;i+=4){ d[i]=Math.min(255, d[i]*exposure); d[i+1]=Math.min(255, d[i+1]*exposure); d[i+2]=Math.min(255, d[i+2]*exposure); }
        return imgData;
    }
    _applyBrightnessContrastSat(imgData, brightness, contrast, saturation){
        const d = imgData.data; const c = contrast; const b=brightness; const s=saturation;
        for (let i=0;i<d.length;i+=4){
            let r=d[i]/255, g=d[i+1]/255, b2=d[i+2]/255;
            // brightness multiply
            r*=b; g*=b; b2*=b;
            // contrast pivot 0.5
            r = (r-0.5)*c + 0.5; g=(g-0.5)*c + 0.5; b2=(b2-0.5)*c + 0.5;
            r=Math.min(1,Math.max(0,r)); g=Math.min(1,Math.max(0,g)); b2=Math.min(1,Math.max(0,b2));
            if (Math.abs(s-1)>1e-3){
                const gray = r*0.299 + g*0.587 + b2*0.114;
                r = gray + (r-gray)*s; g = gray + (g-gray)*s; b2 = gray + (b2-gray)*s;
            }
            d[i] = Math.round(Math.min(255, Math.max(0, r*255)));
            d[i+1] = Math.round(Math.min(255, Math.max(0, g*255)));
            d[i+2] = Math.round(Math.min(255, Math.max(0, b2*255)));
        }
        return imgData;
    }
    _applyGamma(imgData, gamma){
        const d=imgData.data; const g=gamma; for (let i=0;i<d.length;i+=4){ d[i]=Math.min(255, Math.pow(d[i]/255, 1/g)*255); d[i+1]=Math.min(255, Math.pow(d[i+1]/255, 1/g)*255); d[i+2]=Math.min(255, Math.pow(d[i+2]/255, 1/g)*255); }
        return imgData;
    }
    _applyCurve(imgData, strength){
        const d=imgData.data; const k=strength; for (let i=0;i<d.length;i+=4){ for(let ch=0;ch<3;ch++){ const v=d[i+ch]/255; const c=v + (v - v*(1-v))*k; d[i+ch]=Math.round(Math.min(1,Math.max(0,c))*255); } }
        return imgData;
    }

    _applyHueSat(imgData, hueDeg, sat=1) {
        const data = imgData.data; const hue = (hueDeg||0) * Math.PI/180;
        for (let i=0;i<data.length;i+=4){
            let r=data[i]/255, g=data[i+1]/255, b=data[i+2]/255;
            // rgb->hsl
            const max=Math.max(r,g,b), min=Math.min(r,g,b); let h=0,s=0,l=(max+min)/2;
            if (max!==min){ const d=max-min; s=l>0.5? d/(2-max-min) : d/(max+min);
                switch(max){case r: h=(g-b)/d + (g<b?6:0); break; case g: h=(b-r)/d + 2; break; case b: h=(r-g)/d + 4; break;}
                h/=6;
            }
            h = (h + hue/(2*Math.PI)) % 1; s = Math.max(0, Math.min(1, s*sat));
            // hsl->rgb
            const q = l < 0.5 ? l*(1+s) : l + s - l*s; const p = 2*l - q;
            const hk = h; const t = [hk + 1/3, hk, hk - 1/3];
            const rgb = t.map(tt=>{ let t2=tt; if (t2<0) t2+=1; if (t2>1) t2-=1; if (t2<1/6) return p + (q-p)*6*t2; if (t2<1/2) return q; if (t2<2/3) return p + (q-p)*(2/3 - t2)*6; return p; });
            data[i]=Math.round(rgb[0]*255); data[i+1]=Math.round(rgb[1]*255); data[i+2]=Math.round(rgb[2]*255);
        }
        return imgData;
    }

    _convolve(imgData, kernel) {
        const w = imgData.width, h = imgData.height; const out = new ImageData(w,h); const src = imgData.data; const dst = out.data;
        const k = kernel, kw=3, kh=3; const half=1;
        for (let y=0;y<h;y++){
            for (let x=0;x<w;x++){
                let r=0,g=0,b=0,a=src[(y*w+x)*4+3];
                for (let ky=-half;ky<=half;ky++){
                    for (let kx=-half;kx<=half;kx++){
                        const px = Math.min(w-1, Math.max(0, x+kx));
                        const py = Math.min(h-1, Math.max(0, y+ky));
                        const i = (py*w+px)*4; const kk = k[(ky+half)*kw + (kx+half)];
                        r += src[i]*kk; g += src[i+1]*kk; b += src[i+2]*kk;
                    }
                }
                const o = (y*w+x)*4; dst[o]=Math.max(0,Math.min(255,r)); dst[o+1]=Math.max(0,Math.min(255,g)); dst[o+2]=Math.max(0,Math.min(255,b)); dst[o+3]=a;
            }
        }
        return out;
    }

    _boxBlur(imgData) {
        const w=imgData.width,h=imgData.height; const out=new ImageData(w,h); const src=imgData.data; const dst=out.data; const r=1; const area=(2*r+1)*(2*r+1);
        for (let y=0;y<h;y++){
            for (let x=0;x<w;x++){
                let rr=0,gg=0,bb=0,aa=0;
                for (let ky=-r;ky<=r;ky++){
                    for (let kx=-r;kx<=r;kx++){
                        const px=Math.min(w-1, Math.max(0, x+kx)); const py=Math.min(h-1, Math.max(0, y+ky)); const i=(py*w+px)*4;
                        rr+=src[i]; gg+=src[i+1]; bb+=src[i+2]; aa+=src[i+3];
                    }
                }
                const o=(y*w+x)*4; dst[o]=rr/area; dst[o+1]=gg/area; dst[o+2]=bb/area; dst[o+3]=aa/area;
            }
        }
        return out;
    }

    _brightnessContrast(imgData, bright=0, cont=0) {
        const data = imgData.data; const b = bright; const c = (cont/100); const k = Math.tan((Math.PI*(c))/4);
        for (let i=0;i<data.length;i+=4){
            for (let ch=0;ch<3;ch++){
                let v = data[i+ch] + b;
                v = 255*(0.5 + k*(v/255 - 0.5));
                data[i+ch] = Math.max(0, Math.min(255, v));
            }
        }
        return imgData;
    }

    _processImageURL(url, processor) {
        return new Promise((resolve, reject) => {
            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        const c = document.createElement('canvas');
                        c.width = img.width; c.height = img.height;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        let imgData = ctx.getImageData(0, 0, c.width, c.height);
                        imgData = processor(imgData) || imgData;
                        ctx.putImageData(imgData, 0, 0);
                        resolve(c.toDataURL('image/png'));
                    } catch (err) { reject(err); }
                };
                img.onerror = reject;
                img.src = url;
            } catch (err) {
                reject(err);
            }
        });
    }

    _onHistogramRequest() {
        try {
            const layers = this.layerManager.getLayers?.() || [];
            const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
            if (!active || !active.bitmap) {
                this.eventBus.emit("image:histogram:ready", { bins: new Array(256).fill(0) });
                return;
            }
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, c.width, c.height).data;
                    const bins = new Array(256).fill(0);
                    for (let i=0;i<data.length;i+=4){
                        const r=data[i], g=data[i+1], b=data[i+2];
                        const y = Math.round(0.2126*r + 0.7152*g + 0.0722*b);
                        bins[y]++;
                    }
                    this.eventBus.emit("image:histogram:ready", { bins });
                } catch (_e) {
                    this.eventBus.emit("image:histogram:ready", { bins: new Array(256).fill(0) });
                }
            };
            img.onerror = () => this.eventBus.emit("image:histogram:ready", { bins: new Array(256).fill(0) });
            img.src = active.bitmap;
        } catch (_e) {
            this.eventBus.emit("image:histogram:ready", { bins: new Array(256).fill(0) });
        }
    }

    // Frame helpers
    _maybeRecomputeFrameBounds() {
        if (!this._frameEnabled) return;
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || null;
        if (!active || !active.bitmap) {
            // Hide overlay if nothing to show
            this.frameOverlay.style.display = 'none';
            // Clear ghosts
            if (this._frameGhostsWrap) this._frameGhostsWrap.innerHTML = '';
            return;
        }
        this.frameOverlay.style.display = 'block';
        this._recomputeFrameBounds();
        this._layoutFrameRect();
        this._layoutGhostFrames();
    }

    _recomputeFrameBounds() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || null;
        if (!active || !active.bitmap) {
            this._frameBaseBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            this._frameBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            this._frameCurrentTransform = this._normFrameTransform();
            return;
        }
        try {
            const img = new Image(); img.src = active.bitmap;
            this._frameCurrentTransform = this._normFrameTransform(active.metadata?.transform);
            this._frameBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            this._frameBaseBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            img.onload = () => {
                try {
                    const off = document.createElement('canvas'); off.width = this.canvas.width; off.height = this.canvas.height;
                    const ctx = off.getContext('2d');
                    const width = img.naturalWidth || img.width || off.width;
                    const height = img.naturalHeight || img.height || off.height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const { x, y, w, h } = this._scanAlphaBounds(ctx.getImageData(0, 0, off.width, off.height));
                    this._frameBaseBounds = { x, y, w, h };
                    this._frameBounds = this._transformFrameBounds({ x, y, w, h }, active.metadata?.transform);
                    this._layoutFrameRect();
                } catch (_e) { /* ignore */ }
            };
            if (img.complete) {
                const off = document.createElement('canvas'); off.width = this.canvas.width; off.height = this.canvas.height;
                const ctx = off.getContext('2d');
                const width = img.naturalWidth || img.width || off.width;
                const height = img.naturalHeight || img.height || off.height;
                ctx.drawImage(img, 0, 0, width, height);
                const { x, y, w, h } = this._scanAlphaBounds(ctx.getImageData(0, 0, off.width, off.height));
                this._frameBaseBounds = { x, y, w, h };
                this._frameBounds = this._transformFrameBounds({ x, y, w, h }, active.metadata?.transform);
            }
        } catch (_e) {
            this._frameBaseBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            this._frameBounds = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
            this._frameCurrentTransform = this._normFrameTransform();
        }
    }

    _scanAlphaBounds(imgData) {
        const { data, width: w, height: h } = imgData;
        let minX = w, minY = h, maxX = -1, maxY = -1; const thr = 1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const a = data[(y * w + x) * 4 + 3];
                if (a >= thr) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            }
        }
        if (maxX < minX || maxY < minY) { return { x: 0, y: 0, w: w, h: h }; }
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    _layoutFrameRect() {
        const r = this._frameBaseBounds || this._frameBounds || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        this._applyFrameGeometry(this._buildFrameGeometry(r, this._getActiveFrameTransform(), {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        }));
    }

    _layoutFrameGeometry(r) {
        Object.assign(this.frameRect.style, {
            left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`
        });
    }

    _applyFrameGeometry(geometry) {
        if (!geometry) return;
        const { corners, handles, bbox } = geometry;
        this._layoutFrameGeometry(bbox);
        this._positionFrameEdge(this._frameEdges?.[0], corners.tl, corners.tr);
        this._positionFrameEdge(this._frameEdges?.[1], corners.tr, corners.br);
        this._positionFrameEdge(this._frameEdges?.[2], corners.br, corners.bl);
        this._positionFrameEdge(this._frameEdges?.[3], corners.bl, corners.tl);
        const hw = 10, hh = 10;
        if (this._frameHandles && this._frameHandles.length) {
            this._frameHandles.forEach((h) => {
                const key = h.dataset.frameHandle || 'tl';
                const anchor = handles[key] || corners.tl;
                let x = anchor.x;
                let y = anchor.y;
                let handleWidth = hw;
                let handleHeight = hh;
                if (key === 'rotate') {
                    handleWidth = 28;
                    handleHeight = 28;
                }
                Object.assign(h.style, { left: `${x - handleWidth/2}px`, top: `${y - handleHeight/2}px`, width: `${handleWidth}px`, height: `${handleHeight}px` });
            });
        }
    }

    _buildFrameGeometry(bounds, transform, options = {}) {
        const rect = bounds || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        const left = rect.x;
        const top = rect.y;
        const right = rect.x + rect.w;
        const bottom = rect.y + rect.h;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const source = {
            tl: { x: left, y: top },
            tr: { x: right, y: top },
            br: { x: right, y: bottom },
            bl: { x: left, y: bottom },
            t: { x: cx, y: top },
            r: { x: right, y: cy },
            b: { x: cx, y: bottom },
            l: { x: left, y: cy },
            rotate: { x: cx, y: top - 42 },
        };
        const handles = Object.fromEntries(Object.entries(source).map(([key, point]) => [key, this._transformFramePoint(point, transform, options)]));
        const corners = { tl: handles.tl, tr: handles.tr, br: handles.br, bl: handles.bl };
        const bbox = TransformMath.boundsFromPoints(Object.values(corners));
        return {
            corners,
            handles,
            bbox,
        };
    }

    _transformFramePoint(point, transform, options = {}) {
        return TransformMath.transformPoint(point, this._normFrameTransform(transform), {
            originX: Number.isFinite(options.originX) ? options.originX : (this.canvas.width / 2),
            originY: Number.isFinite(options.originY) ? options.originY : (this.canvas.height / 2),
        });
    }

    _positionFrameEdge(edgeEl, start, end) {
        if (!edgeEl || !start || !end) return;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        edgeEl.style.left = `${start.x}px`;
        edgeEl.style.top = `${start.y}px`;
        edgeEl.style.width = `${len}px`;
        edgeEl.style.transformOrigin = '0 50%';
        edgeEl.style.transform = `translateY(-50%) rotate(${angle}rad)`;
    }

    _getActiveFrameTransform() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || null;
        return this._normFrameTransform(active?.metadata?.transform || this._frameCurrentTransform || {});
    }

    _applyFrameBaseTransform(transform, options = {}) {
        if (this._frameActiveWrap) this._frameActiveWrap.style.transform = '';
    }

    _applyFramePreviewTransform(transform, options = {}) {
        if (this._framePreviewWrap) this._framePreviewWrap.style.transform = '';
    }

    _applyFrameTransformToTarget(target, transform, options = {}) {
        if (target) target.style.transform = '';
    }

    _normFrameTransform(transform) {
        return TransformMath.normalize(transform || {});
    }

    _transformFrameBounds(bounds, transform) {
        return TransformMath.transformBounds(bounds || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }, transform, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
    }

    _resetEffects() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.id) return;
        if (this._effectsState && this._effectsState[active.id]) {
            const state = this._effectsState[active.id];
            if (state.original) {
                this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: state.original } });
                this.renderer.requestRender?.();
            }
            delete this._effectsState[active.id];
        }
    }

    _resetCurves() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.bitmap) return;
        // Reset to identity curve (no transform)
        const identity = new Uint8Array(256);
        for (let i = 0; i < 256; i++) identity[i] = i;
        this._processImageURL(active.bitmap, (imgData) => {
            return this._applyLUT(imgData, Array.from(identity));
        }).then((outUrl) => {
            this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: outUrl } });
            this.renderer.requestRender?.();
        }).catch(() => {});
    }

    _resetLevels() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.bitmap) return;
        // Reset black=0, white=255, gamma=1
        this._processImageURL(active.bitmap, (imgData) => {
            return this._applyLevels(imgData, 0, 255, 1.0);
        }).then((outUrl) => {
            this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: outUrl } });
            this.renderer.requestRender?.();
        }).catch(() => {});
    }

    _resetRGB() {
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || layers[layers.length - 1];
        if (!active || !active.bitmap) return;
        // Reset r=0, g=0, b=0 (no shift)
        this._processImageURL(active.bitmap, (imgData) => {
            return this._applyRGBShift(imgData, 0, 0, 0);
        }).then((outUrl) => {
            this.layerManager.updateLayer?.({ id: active.id, patch: { bitmap: outUrl } });
            this.renderer.requestRender?.();
        }).catch(() => {});
    }

    _layoutGhostFrames() {
        if (!this._frameEnabled) return;
        const layers = this.layerManager.getLayers?.() || [];
        const active = this.layerManager.getActiveLayer?.() || layers.find(l => l.active) || null;
        if (!this._frameGhostsWrap) return;
        this._frameGhostsWrap.innerHTML = '';
        layers.forEach((ly, idx) => {
            if (ly === active) return;
            if (!ly.visible || !ly.bitmap) return;
            try {
                const img = new Image(); img.src = ly.bitmap;
                const off = document.createElement('canvas'); off.width = this.canvas.width; off.height = this.canvas.height;
                const ctx = off.getContext('2d');
                const addRect = (rect)=>{
                    const el = document.createElement('div'); el.className = 'goya-frame-ghost';
                    const hue = (idx * 40) % 360; const col = `hsla(${hue},70%,70%,0.55)`;
                    Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, position:'absolute', borderColor: col, boxShadow: `0 0 0 1px ${col.replace('0.55','0.28')}` });
                    const label = document.createElement('div'); label.className = 'goya-frame-ghost__label'; label.textContent = String(idx);
                    el.appendChild(label);
                    this._frameGhostsWrap.appendChild(el);
                };
                const doScan = ()=>{
                    try {
                        ctx.clearRect(0,0,off.width, off.height);
                        ctx.drawImage(img, 0, 0, off.width, off.height);
                        const scanned = this._scanAlphaBounds(ctx.getImageData(0, 0, off.width, off.height));
                        addRect(this._transformFrameBounds(scanned, ly.metadata?.transform));
                    } catch (_e) {}
                };
                if (img.complete) doScan(); else img.onload = doScan;
            } catch (_e) {}
        });
    }

    _updateLiqRingSize(radius) {
        const scale = this.baseFitScale * this.userZoom;
        this._liqRing._radius = Math.max(2, radius|0);
        const r = this._liqRing._radius * scale;
        Object.assign(this._liqRing.style, { width: `${r*2}px`, height: `${r*2}px` });
    }
}




