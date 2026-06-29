import VectorTool from "./EasyVectorTool.js?v=20260629_EASY_CROP_DRAW01";
import ToolTargetResolver from "./ToolTargetResolver.js?v=20260629_EASY_CROP_DRAW01";
import TransformMath from "./EasyTransformMath.js?v=20260629_EASY_CROP_DRAW01";
import { debugTrace } from "../utils/DebugTrace.js?v=20260629_EASY_CROP_DRAW01";

const IAMCCS_SUPPORTED_STROKE_TOOLS = new Set(["brush", "pencil", "eraser"]);
const IAMCCS_TRANSFORM_TOOLS = new Set(["move", "scale", "rotate"]);
const IAMCCS_LASSO_TOOLS = new Set(["lasso", "lasso_fill"]);
const IAMCCS_VECTOR_TOOLS = new Set(["vector", "vector_fill"]);
const IAMCCS_LIQUIFY_TOOL = "liquify";

export default class IAMCCSRenderer {
    constructor(canvasElement, eventBus, layerManager, maskManager) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext("2d", { desynchronized: true, willReadFrequently: true });
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.maskManager = maskManager;
        // Single DOM overlay used to show parts of the active image that extend beyond
        // the canvas during transforms (move/scale/rotate). This avoids canvas clipping.
        this._ghostEl = null;

    this.activeLayerId = null;
    this.imageCache = new Map();
    this.maskCache = new Map();
        this.renderScheduled = false;
        this._colorPreviewTimer = null;

        this.isDrawing = false;
        this.activePointerId = null;
        this.strokeTool = null;
        this.baseBrush = null;
        this.lastPoint = null;
        this.lastMidpoint = null;
        this.strokeMoved = false;
        this.liveLayerCanvas = null;
        this.liveLayerCtx = null;
        this._lastImmediateStrokeRenderAt = 0;

    // Transform session state
    this.transformSession = null;
    // Image adjustments (Adjust Image panel)
    this.adjust = { exposure: 1, brightness: 1, contrast: 1, saturation: 1, gamma: 1, curve: 0 };
    // Imagining state (effects, levels, curves, RGB, color wheel)
    this.imaging = {
        effects: {}, // key -> { enabled: boolean, amount: 0..1 }
        levels: { black: 0, white: 255, gamma: 1 },
        curves: { lut: null }, // Array(256) of 0..255 or null
        rgb: { r: 0, g: 0, b: 0 }, // -100..100 offsets per channel
        colorwheel: { hueDeg: 0, sat: 0 } // hue rotation in degrees, additional saturation boost 0..1
    };
    this.snapEnabled = false;
    this.snapSettings = { moveStep: 10, angleStep: Math.PI / 12, scaleStep: 0.1 };

    // Lasso state
    this.lassoPoints = [];
    this.lassoFill = false;

    // Vector state
    this.vectorPoints = []; // array of {x,y,type:"line"|"quad", cx, cy}
    this.vectorFill = false;
    this.vectorIsAdding = false;

    // Text tool state
    this.textDragStart = null;
    this.textDragRect = null;

    // Crop state guard: when crop overlay is active, ignore renderer pointer interactions
    this.cropActive = false;

    // Liquify brush settings (interactive tool)
    this.liqBrushRadius = 40; // px in canvas units
    this.liqStrength = 0.5;   // 0..1
        this.liqMode = "twirl";  // push | pull | twirl | pinch | expand | smooth
        this._liqLast = null;
        this._liqLayer = null;

    // Auto first-touch move is context-sensitive; default flag remains false, logic below enables per state
    this.enableFirstTouchAutoMove = false;

        // Film post-process settings (applied when Film layer is visible)
        this.film = {
            enabled: false,
            grain: { enabled: false, intensity: 0.2, size: 2 },
            lut: { enabled: false, preset: null, cube: null },
            bake: false,
            blendMode: 'overlay',
            opacity: 1,
        };

        this.canvas.style.touchAction = "none";

        this.eventBus.on("layer:selected", (layer) => {
            this.activeLayerId = layer?.id ?? null;
            // DO NOT clear liveMaskCanvas here - let _ensureLiveSurface handle it when drawing starts
            // When changing layers, ensure image+mask cache is synced to avoid stale renders
            const layers = this.layerManager.getLayers?.();
            if (layers) {
                this._syncImageCache(layers);
                // Also sync mask cache for all visible layers WITH async load handling
                for (const l of layers) {
                    if (l.visible && l.mask) {
                        const cached = this.maskCache.get(l.id);
                        if (!cached || cached.src !== l.mask) {
                            const mimg = new Image();
                            mimg.src = l.mask;
                            // Trigger re-render when mask image loads
                            if (!mimg.complete) {
                                mimg.onload = () => this._requestRender();
                                mimg.onerror = () => this._requestRender();
                            }
                            this.maskCache.set(l.id, { image: mimg, src: l.mask });
                        }
                    }
                }
            }
            // Force a render when layer changes to ensure proper visual update
            this._requestRender();
        });
        // Some emitters use 'layer:select' – support both to keep active layer in sync
        this.eventBus.on("layer:select", (layerId) => {
            try {
                if (layerId && typeof layerId === 'string') this.activeLayerId = layerId;
                else if (layerId && typeof layerId === 'object') this.activeLayerId = layerId?.id ?? this.activeLayerId;
                // DO NOT clear liveMaskCanvas here
                // Sync image+mask cache and force render when layer changes
                const layers = this.layerManager.getLayers?.();
                if (layers) {
                    this._syncImageCache(layers);
                    // Sync mask cache WITH async load handling
                    for (const l of layers) {
                        if (l.visible && l.mask) {
                            const cached = this.maskCache.get(l.id);
                            if (!cached || cached.src !== l.mask) {
                                const mimg = new Image();
                                mimg.src = l.mask;
                                if (!mimg.complete) {
                                    mimg.onload = () => this._requestRender();
                                    mimg.onerror = () => this._requestRender();
                                }
                                this.maskCache.set(l.id, { image: mimg, src: l.mask });
                            }
                        }
                    }
                }
                this._requestColorPreviewRender();
            } catch (_e) {}
        });

        this.eventBus.on("layers:changed", (layers) => {
            this._syncImageCache(layers);
            this._requestRender();
        });
        this.eventBus.on("canvas:render:request", () => this._requestRender());
        this.eventBus.on("canvas:refresh", () => this._requestRender());
        this.eventBus.on("background:color:update", () => this._requestRender());
        this.eventBus.on("canvas:crop:rect", () => this._requestRender());
        this.eventBus.on("canvas:crop:state", () => this._requestRender());
        this.eventBus.on("layer:delete", (layerId) => {
            try { if (layerId) this.imageCache.delete(layerId); } catch (_e) {}
            try { if (layerId) this.maskCache.delete(layerId); } catch (_e) {}
            this.clearTransientState();
        });

        // Mask UI toggles should immediately affect the canvas
        this.eventBus.on("mask:overlay:changed", () => this._requestRender());
        this.eventBus.on("mask:paintMode", () => this._requestRender());

        // Lightweight layer patching (e.g. opacity drag) should still rerender
        this.eventBus.on("layer:patched", () => this._requestRender());

        this._bindEvents();
        this.toolTargetResolver = new ToolTargetResolver(this.eventBus, this.layerManager);

        // Vector tool integration (overlay canvas + event handling)
        try {
            const container = this.canvas.parentElement; // .goya-canvas-container
            this.vectorTool = new VectorTool(
                container,
                this.eventBus,
                this.layerManager,
                this.toolTargetResolver,
                () => {
                    const brush = this.maskManager.getBrushSettings?.() || {};
                    const vector = this.maskManager.getVectorBrushSettings?.() || {};
                    return { ...brush, ...vector };
                },
                () => ({ width: this.canvas.width, height: this.canvas.height }),
                (payload) => this._commitVectorCanvas(payload),
                (layerId) => this._getLayerSurfaceSnapshot(layerId)
            );
            this.eventBus.on("tool:change", (toolId) => {
                if (IAMCCS_VECTOR_TOOLS.has(toolId)) this.vectorTool.enable(); else this.vectorTool.disable();
            });
        } catch (e) {
            console.warn("[GoyaRenderer] VectorTool init failed", e);
        }

        // Snap toggle listener
        this.eventBus.on("canvas:snap", ({ enabled, moveStep, angleStep, scaleStep }) => {
            if (typeof enabled === 'boolean') this.snapEnabled = enabled;
            if (typeof moveStep === 'number') this.snapSettings.moveStep = Math.max(1, moveStep|0);
            if (typeof angleStep === 'number') this.snapSettings.angleStep = Math.max(0.01, angleStep);
            if (typeof scaleStep === 'number') this.snapSettings.scaleStep = Math.max(0.01, scaleStep);
        });

        // Liquify tool settings listener
        this.eventBus.on("liquify:settings", ({ radius, amount, mode }) => {
            if (typeof radius === 'number') this.liqBrushRadius = Math.max(2, radius|0);
            if (typeof amount === 'number') this.liqStrength = Math.max(0, Math.min(1, amount));
            if (["push", "pull", "twirl", "swirl", "pinch", "expand", "smooth"].includes(mode)) {
                this.liqMode = mode === "swirl" ? "twirl" : mode;
            }
        });

        // Film settings listener
        this.eventBus.on("film:settings", (payload={}) => {
            try {
                const f = this.film;
                if (typeof payload.enabled === 'boolean') f.enabled = payload.enabled;
                if (typeof payload.bake === 'boolean') f.bake = payload.bake;
                if (typeof payload.blendMode === 'string') f.blendMode = payload.blendMode;
                if (typeof payload.opacity === 'number') f.opacity = Math.max(0, Math.min(1, payload.opacity));
                if (payload.grain) {
                    const g = payload.grain;
                    if (typeof g.enabled === 'boolean') f.grain.enabled = g.enabled;
                    if (typeof g.intensity === 'number') f.grain.intensity = Math.max(0, Math.min(1, g.intensity));
                    if (typeof g.size === 'number') f.grain.size = Math.max(1, g.size|0);
                }
                // damage removed
                if (payload.lut) {
                    const l = payload.lut;
                    if (typeof l.enabled === 'boolean') f.lut.enabled = l.enabled;
                    if (l.preset != null) f.lut.preset = l.preset;
                    if (typeof l.cubeText === 'string') {
                        f.lut.cube = this._parseCubeLUT(l.cubeText);
                    }
                }
                // If baking is enabled, generate/update Film layer bitmap; else trigger repaint
                if (f.enabled && f.bake) {
                    const url = this._renderFilmOverlay();
                    const layers = this.layerManager.getLayers?.() || [];
                    const filmLayer = layers.find(l => l.metadata?.type === 'film');
                    if (filmLayer) {
                        // Only update bitmap and visibility; preserve layer's own blend/opacity managed in Layers panel
                        this.layerManager.updateLayer?.({ id: filmLayer.id, patch: { bitmap: url, visible: true } });
                    }
                }
                this._requestColorPreviewRender();
            } catch (_e) {}
        });

        // Adjust Image live settings
        this.eventBus.on("image:adjust", (payload={}) => {
            try {
                const a = this.adjust;
                if (typeof payload.exposure === 'number') a.exposure = Math.max(0.1, payload.exposure);
                if (typeof payload.brightness === 'number') a.brightness = Math.max(0.0, payload.brightness);
                if (typeof payload.contrast === 'number') a.contrast = Math.max(0.0, payload.contrast);
                if (typeof payload.saturation === 'number') a.saturation = Math.max(0.0, payload.saturation);
                if (typeof payload.gamma === 'number') a.gamma = Math.max(0.1, payload.gamma);
                if (typeof payload.curve === 'number') a.curve = Math.max(0.0, Math.min(1.0, payload.curve));
                this._requestColorPreviewRender();
            } catch (_e) {}
        });

        // Imagining: Effects toggle grid
        this.eventBus.on("image:effect:apply", ({ effect, enabled, amount }) => {
            try {
                if (typeof effect !== 'string') return;
                this.imaging.effects[effect] = { enabled: !!enabled, amount: Math.max(0, Math.min(1, Number(amount) || 0)) };
                this._requestRender();
            } catch (_e) {}
        });
        this.eventBus.on("image:effect:reset", () => {
            try { this.imaging.effects = {}; this._requestColorPreviewRender(); } catch (_e) {}
        });

        // Imagining: Levels
        this.eventBus.on("image:levels:apply", ({ black, white, gamma }) => {
            try {
                const lvl = this.imaging.levels;
                if (typeof black === 'number') lvl.black = Math.max(0, Math.min(254, black|0));
                if (typeof white === 'number') lvl.white = Math.max(1, Math.min(255, white|0));
                if (typeof gamma === 'number') lvl.gamma = Math.max(0.1, gamma);
                this._requestColorPreviewRender();
            } catch (_e) {}
        });
        this.eventBus.on("image:levels:reset", () => {
            try { this.imaging.levels = { black: 0, white: 255, gamma: 1 }; this._requestColorPreviewRender(); } catch (_e) {}
        });

        // Imagining: Curves LUT
        this.eventBus.on("image:curves:apply", ({ lut }) => {
            try {
                if (Array.isArray(lut) && lut.length === 256) {
                    // store a copy as Uint8Array
                    this.imaging.curves.lut = new Uint8Array(lut.map(v => Math.max(0, Math.min(255, v|0))));
                    this._requestColorPreviewRender();
                }
            } catch (_e) {}
        });
        this.eventBus.on("image:curves:reset", () => {
            try { this.imaging.curves.lut = null; this._requestColorPreviewRender(); } catch (_e) {}
        });

        // Imagining: RGB per-channel offset
        this.eventBus.on("image:rgb:apply", ({ r, g, b }) => {
            try {
                const clamp = (v) => Math.max(-100, Math.min(100, Number(v) || 0));
                this.imaging.rgb = { r: clamp(r), g: clamp(g), b: clamp(b) };
                this._requestColorPreviewRender();
            } catch (_e) {}
        });
        this.eventBus.on("image:rgb:reset", () => {
            try { this.imaging.rgb = { r: 0, g: 0, b: 0 }; this._requestColorPreviewRender(); } catch (_e) {}
        });

        // Imagining: color wheel hue/saturation
        this.eventBus.on("image:colorwheel:apply", ({ hueDeg, sat }) => {
            try {
                const hue = ((Number(hueDeg) || 0) % 360 + 360) % 360;
                const s = Math.max(0, Math.min(1, Number(sat) || 0));
                this.imaging.colorwheel = { hueDeg: hue, sat: s };
                this._requestColorPreviewRender();
            } catch (_e) {}
        });

        // Imagining: histogram request (active layer or composite)
        this.eventBus.on("image:histogram:request", () => {
            try {
                const w = this.canvas.width, h = this.canvas.height;
                const imgData = this.ctx.getImageData(0, 0, w, h);
                const bins = this._computeHistogram(imgData);
                this.eventBus.emit("image:histogram:ready", { bins });
            } catch (_e) {}
        });

        this.eventBus.on("gimp:transform:commit", () => {
            try { this.commitActiveTransform(); } catch (_e) {}
        });
        this.eventBus.on("gimp:image:commit-color", () => {
            try { this.commitActiveImageColor(); } catch (_e) {}
        });

        // Listen for crop overlay state
        this.eventBus.on("canvas:crop:state", ({ active }) => {
            this.cropActive = !!active;
        });
    }

    resize(width, height) {
        if (this.canvas.width === width && this.canvas.height === height) {
            return;
        }
        this.canvas.width = width;
        this.canvas.height = height;
        if (this.liveLayerCanvas) {
            this.liveLayerCanvas.width = width;
            this.liveLayerCanvas.height = height;
        }
        if (this._maskOverlayCanvas) {
            this._maskOverlayCanvas.width = width;
            this._maskOverlayCanvas.height = height;
        }
        if (this.vectorTool) {
            this.vectorTool.resize(width, height);
        }
        this._requestRender();
    }

    _drawImageAtNativeSize(ctx, image, dx = 0, dy = 0) {
        if (!ctx || !this._isDrawableImage(image)) {
            return;
        }
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (width <= 0 || height <= 0) {
            return;
        }
        ctx.drawImage(image, dx, dy, width, height);
    }

    render() {
        const layers = this.layerManager.getLayers();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._paintDocumentBackground(layers);
        let ghostShown = false;
        // Capture overlay intent once per frame (global tool state).
        const paintToMaskGlobal = this.maskManager.isPaintToMask?.() || false;
        const showOverlayUserGlobal = this.maskManager.isOverlayEnabled?.() || false;
        const showOverlayGlobal = showOverlayUserGlobal || paintToMaskGlobal;
        for (const layer of layers) {
            if (!layer.visible) {
                continue;
            }
            if (layer.id === "layer_background") {
                continue;
            }
            this.ctx.save();
            this.ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1;
            this.ctx.globalCompositeOperation = this._mapBlendMode(layer.blend_mode);
            // Determine if a non-destructive transform applies (raster-only)
            const transformSession = this._getTransformSession();
            const isActivePreview = !!transformSession && layer.id === transformSession.layerId;
            const t = isActivePreview
                ? this._composePreviewTransform(layer, transformSession)
                : ((layer.metadata && layer.metadata.transform) ? this._normTransform(layer.metadata.transform) : null);
            let applyTransform = t && layer.metadata?.type !== 'text' && layer.id !== 'layer_background';
            // Apply transform: for pure translation, keep top-left anchor; for rotate/scale use center anchor
            let translateOnly = false;
            if (applyTransform) {
                translateOnly = (t.angle === 0 && t.sx === 1 && t.sy === 1);
                if (translateOnly) {
                    this.ctx.translate(t.dx, t.dy);
                } else {
                    const origin = { x: this.canvas.width/2, y: this.canvas.height/2 };
                    this.ctx.translate(origin.x, origin.y);
                    this.ctx.translate(t.dx, t.dy);
                    if (t.angle) this.ctx.rotate(t.angle);
                    if (t.sx !== 1 || t.sy !== 1) this.ctx.scale(t.sx, t.sy);
                }
            }

            const paintToMask = paintToMaskGlobal;
            const showOverlay = showOverlayGlobal;
            const isActiveLayer = (layer.id === this.activeLayerId);
            const isActiveDrawing = (this.liveLayerCanvas && isActiveLayer && !isActivePreview);
            
            // Render text layers directly
            if (layer.metadata?.type === "text" && layer.metadata?.text) {
                // Text draws without raster transform pipeline
                this._drawTextLayer(layer);
            } else if (isActiveDrawing && paintToMask) {
                // Paint-to-mask mode for the active layer:
                // Render the underlying layer bitmap FIRST. 
                // Mask overlay will be drawn later in _drawAllMaskOverlays final pass.
                const cached = this.imageCache.get(layer.id);
                if (cached?.image && this._isDrawableImage(cached.image)) {
                    if (applyTransform) {
                        const iw = cached.image.naturalWidth || cached.image.width;
                        const ih = cached.image.naturalHeight || cached.image.height;
                        if (translateOnly) {
                            const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
                            try { this.ctx.drawImage(cached.image, cx - iw / 2, cy - ih / 2, iw, ih); } catch (_e) {}
                        } else {
                            try { this.ctx.drawImage(cached.image, -iw / 2, -ih / 2, iw, ih); } catch (_e) {}
                        }
                    } else {
                        try { this._drawImageAtNativeSize(this.ctx, cached.image); } catch (_e) {}
                    }
                } else if (layer.bitmap) {
                    // Best-effort draw if cache isn't ready yet
                    try {
                        const image = new Image();
                        image.src = layer.bitmap;
                        if (!image.complete) {
                            image.onload = () => this._requestRender();
                            image.onerror = () => this._requestRender();
                        }
                        this.imageCache.set(layer.id, { image, src: layer.bitmap });
                        if (this._isDrawableImage(image)) {
                            if (applyTransform) {
                                const iw = image.naturalWidth || image.width;
                                const ih = image.naturalHeight || image.height;
                                if (translateOnly) {
                                    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
                                    this.ctx.drawImage(image, cx - iw / 2, cy - ih / 2, iw, ih);
                                } else {
                                    this.ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
                                }
                            } else {
                                this._drawImageAtNativeSize(this.ctx, image);
                            }
                        }
                    } catch (_e) {}
                }

                // Mask overlay will be drawn in _drawAllMaskOverlays final pass (after all layer bitmaps)
            } else if (isActiveDrawing) {
                // Active layer normal drawing (brush, eraser, etc.)
                if (applyTransform) {
                    if (translateOnly) {
                        this.ctx.drawImage(this.liveLayerCanvas, 0, 0);
                    } else {
                        this.ctx.drawImage(this.liveLayerCanvas, -this.canvas.width/2, -this.canvas.height/2, this.canvas.width, this.canvas.height);
                    }
                } else {
                    this.ctx.drawImage(this.liveLayerCanvas, 0, 0);
                }
            } else {
                const cached = this.imageCache.get(layer.id);
                if (cached?.image && this._isDrawableImage(cached.image)) {
                    if (applyTransform) {
                        const iw = cached.image.naturalWidth || cached.image.width;
                        const ih = cached.image.naturalHeight || cached.image.height;
                        if (translateOnly) {
                            // Preview image centered in canvas with translation; ghost overlay will show spill
                            const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
                            try {
                                this.ctx.drawImage(cached.image, cx - iw / 2, cy - ih / 2, iw, ih);
                            } catch (err) {
                                // If the cached image is in a broken state, don't break the whole render.
                                try { this.imageCache.delete(layer.id); } catch (_e) {}
                                continue;
                            }
                            if (this._imageOutsideCanvas({ dx: t.dx, dy: t.dy, sx: 1, sy: 1, angle: 0 }, iw, ih)) {
                                this._syncGhostOverlayIfNeeded({ dx: t.dx, dy: t.dy, sx: 1, sy: 1, angle: 0 }, cached.image, layer);
                                ghostShown = true;
                            }
                        } else {
                            try {
                                this.ctx.drawImage(cached.image, -iw/2, -ih/2, iw, ih);
                            } catch (err) {
                                try { this.imageCache.delete(layer.id); } catch (_e) {}
                                continue;
                            }
                            if (this._imageOutsideCanvas(t, iw, ih)) {
                                this._syncGhostOverlayIfNeeded(t, cached.image, layer);
                                ghostShown = true;
                            }
                        }
                    } else {
                        // Always render cached bitmap to the full canvas bounds (avoids inner whitespace)
                        try {
                            this._drawImageAtNativeSize(this.ctx, cached.image);
                        } catch (err) {
                            try { this.imageCache.delete(layer.id); } catch (_e) {}
                            continue;
                        }
                    }
                } else if (cached?.image && this._isBrokenHtmlImage(cached.image)) {
                    // Broken image (complete=true but naturalWidth=0): clear so it can be reloaded.
                    try { this.imageCache.delete(layer.id); } catch (_e) {}
                } else if (cached?.image && cached.image.complete === false) {
                    // Image will trigger a rerender once loaded.
                } else if (layer.bitmap) {
                    const bitmap = layer.bitmap;
                    if (typeof bitmap === "string") {
                        const image = new Image();
                        image.src = bitmap;
                        if (!image.complete) {
                            image.onload = () => this._requestRender();
                            image.onerror = () => {
                                try { this.imageCache.delete(layer.id); } catch (_e) {}
                                this._requestRender();
                            };
                        } else if (this._isBrokenHtmlImage(image)) {
                            // If the browser marks it complete-but-broken immediately, don't cache it.
                            this._requestRender();
                            continue;
                        }
                        this.imageCache.set(layer.id, { image, src: bitmap });
                        if (this._isDrawableImage(image)) {
                            if (applyTransform) {
                                const iw = image.naturalWidth || image.width;
                                const ih = image.naturalHeight || image.height;
                                if (translateOnly) {
                                    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
                                    try {
                                        this.ctx.drawImage(image, cx - iw / 2, cy - ih / 2, iw, ih);
                                    } catch (err) {
                                        try { this.imageCache.delete(layer.id); } catch (_e) {}
                                        continue;
                                    }
                                    if (this._imageOutsideCanvas({ dx: t.dx, dy: t.dy, sx: 1, sy: 1, angle: 0 }, iw, ih)) {
                                        this._syncGhostOverlayIfNeeded({ dx: t.dx, dy: t.dy, sx: 1, sy: 1, angle: 0 }, image, layer);
                                        ghostShown = true;
                                    }
                                } else {
                                    try {
                                        this.ctx.drawImage(image, -iw/2, -ih/2, iw, ih);
                                    } catch (err) {
                                        try { this.imageCache.delete(layer.id); } catch (_e) {}
                                        continue;
                                    }
                                    if (this._imageOutsideCanvas(t, iw, ih)) {
                                        this._syncGhostOverlayIfNeeded(t, image, layer);
                                        ghostShown = true;
                                    }
                                }
                            } else {
                                // Always fill canvas when drawing freshly loaded bitmaps
                                try {
                                    this._drawImageAtNativeSize(this.ctx, image);
                                } catch (err) {
                                    try { this.imageCache.delete(layer.id); } catch (_e) {}
                                    continue;
                                }
                            }
                        }
                    } else if (this._isDrawableImage(bitmap)) {
                        // Defensive: if bitmap is already an Image/Canvas (legacy), draw it directly.
                        try {
                            if (applyTransform) {
                                const iw = bitmap.naturalWidth || bitmap.width;
                                const ih = bitmap.naturalHeight || bitmap.height;
                                if (translateOnly) {
                                    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
                                    this.ctx.drawImage(bitmap, cx - iw / 2, cy - ih / 2, iw, ih);
                                } else {
                                    this.ctx.drawImage(bitmap, -iw/2, -ih/2, iw, ih);
                                }
                            } else {
                                this._drawImageAtNativeSize(this.ctx, bitmap);
                            }
                        } catch (_e) {
                            // If it throws, ignore and let the user reapply the bitmap.
                        }
                    }
                }
            }

            this.ctx.restore();
        }

        // Draw ALL mask overlays as a final pass so they are always visible together.
        // This is purely visual: generation continues to use per-layer masks exactly as before.
        if (showOverlayGlobal) {
            this._drawAllMaskOverlays(layers, {
                paintToMask: paintToMaskGlobal,
                activeLayerId: this.activeLayerId,
                liveMaskCanvas: this.liveLayerCanvas,
            });
        }

        // Film post-process pass (if Film layer exists and is visible, and not baking)
        try {
            // Apply Imagining pipeline (non-cumulative, per-frame). Skip during interactive transforms.
            if (!this._hasTransformSession()) {
                let imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                imgData = this._applyImageColorPipeline(imgData);
                this.ctx.putImageData(imgData, 0, 0);
            }
            const filmLayer = layers.find(l => (l.metadata?.type === 'film') && (l.visible !== false));
            // Skip heavy film pass during interactive transforms to avoid flicker
            if (filmLayer && this.film.enabled && !this.film.bake && !this._hasTransformSession()) {
                const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                let out = imgData;
                if (this.film.lut.enabled) out = this._applyFilmLUT(out);
                if (this.film.grain.enabled) out = this._applyFilmGrain(out);
                this.ctx.putImageData(out, 0, 0);
            }
        } catch (_e) {}

        // Hide ghost overlay if not shown in this frame
        if (!ghostShown && this._ghostEl) this._ghostEl.style.display = 'none';
    }

    _paintDocumentBackground(layers) {
        const background = layers?.find?.((layer) => layer?.id === "layer_background");
        const fill = this._normalizeBackgroundColor(background?.metadata?.backgroundColor);
        this.ctx.save();
        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = fill;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    _normalizeBackgroundColor(value) {
        const raw = String(value || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
        if (/^#[0-9a-f]{3}$/i.test(raw)) {
            return `#${raw.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
        }
        return "#101318";
    }

    _isBrokenHtmlImage(img) {
        try {
            if (!img) return false;
            // HTMLImageElement: complete=true + naturalWidth=0 => broken
            if (typeof img.complete === "boolean" && img.complete === true) {
                if (typeof img.naturalWidth === "number" && typeof img.naturalHeight === "number") {
                    return img.naturalWidth === 0 || img.naturalHeight === 0;
                }
            }
        } catch (_e) {}
        return false;
    }

    _isDrawableImage(img) {
        try {
            if (!img) return false;
            // Canvas-like objects
            if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) {
                return (img.width | 0) > 0 && (img.height | 0) > 0;
            }
            if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
                return (img.width | 0) > 0 && (img.height | 0) > 0;
            }
            // HTMLImageElement
            if (typeof img.complete === "boolean" && img.complete === false) return false;
            if (this._isBrokenHtmlImage(img)) return false;
            const w = (img.naturalWidth ?? img.width) | 0;
            const h = (img.naturalHeight ?? img.height) | 0;
            return w > 0 && h > 0;
        } catch (_e) {
            return false;
        }
    }

    exportComposite() {
        this.renderScheduled = false;
        this.render();
        return this.canvas.toDataURL("image/png");
    }

    _bindEvents() {
        this._onPointerDownHandler = this._onPointerDown.bind(this);
        this._onPointerMoveHandler = this._onPointerMove.bind(this);
        this._onPointerUpHandler = this._onPointerUp.bind(this);
        this._onPointerCancelHandler = this._onPointerCancel.bind(this);

        this.canvas.addEventListener("pointerdown", this._onPointerDownHandler);
        this.canvas.addEventListener("pointermove", this._onPointerMoveHandler);
        this.canvas.addEventListener("pointerup", this._onPointerUpHandler);
        this.canvas.addEventListener("pointercancel", this._onPointerCancelHandler);
        this.canvas.addEventListener("pointerleave", this._onPointerCancelHandler);
        window.addEventListener("pointerup", this._onPointerUpHandler);
        window.addEventListener("pointercancel", this._onPointerCancelHandler);
        // Double click to edit text
        this._onDblClickHandler = (e) => this._onDoubleClick(e);
        this.canvas.addEventListener("dblclick", this._onDblClickHandler);
    }

    _onPointerDown(event) {
        if (this.cropActive) {
            // Let Canvas crop overlay handle interactions; renderer does nothing
            return;
        }
        // Neutral cursor tool: ignore interactions
        if (this.maskManager.activeTool === 'cursor') {
            return;
        }
        // Delegate vector tools to VectorTool overlay
        if (IAMCCS_VECTOR_TOOLS.has(this.maskManager.activeTool) && event.button !== 1) {
            return;
        }
        // Middle mouse: temporary Move transform regardless of active tool
        if (event.button === 1) {
            const point = this._getCanvasPoint(event);
            const layer = this._resolveTransformLayerAtPoint(point);
            if (!layer) return;
            if (!this._beginTransformSession(layer, "move", point, event.pointerId, true)) {
                return;
            }
            return;
        }
        if (event.button !== 0) { return; }
        const tool = this.maskManager.activeTool || "brush";
        // Liquify brush begins stroke
        if (tool === IAMCCS_LIQUIFY_TOOL) {
            const layer = this.toolTargetResolver.resolveStrokeLayer(tool);
            if (!layer) return;
            this.layerManager.snapshot?.();
            this._ensureLiveSurface(layer);
            this.isDrawing = true; this.activePointerId = event.pointerId;
            this.canvas.setPointerCapture?.(event.pointerId);
            this._liqLayer = layer;
            const p = this._mapPointToLayerInput(this._getCanvasPoint(event), layer);
            this._liqLast = p;
            this._applyLiquifyBrush(p);
            this._requestRender();
            return;
        }

        // First-touch auto-move disabled (removed)

        // Handle fill tool as click action (never paint directly onto imported image layer)
        if (tool === "fill") {
            let layer = this.toolTargetResolver.resolveFillLayer();
            if (!layer) return;
            debugTrace('[GoyaRenderer] pointerdown:fill', {
                activeLayerIdBeforeSnapshot: this.layerManager.getActiveLayerId?.() || null,
                resolvedLayerId: layer.id,
                resolvedLayerName: layer.name,
            });
            this.layerManager.snapshot();
            layer = this._bakeLayerTransformForEditing(layer);
            this._ensureLiveSurface(layer);
            const p = this._mapPointToLayerInput(this._getCanvasPoint(event), layer);
            this._performFill(p);
            this._commitStroke(); // reuse commit to write back
            return;
        }

        // Text tool disabled (stability priority)
        if (tool === "text") {
            this.textDragStart = null;
            this.textDragRect = null;
            return;
        }

        // VectorTool owns line/rect/ellipse interactions; do not run the legacy vector path in parallel.
        if (IAMCCS_VECTOR_TOOLS.has(tool) && this.vectorTool?.enabled) {
            return;
        }

        // Handle transforms
        if (this._isTransformMode(tool)) {
            const point = this._getCanvasPoint(event);
            const layer = this._resolveTransformLayerAtPoint(point);
            if (!layer) return;
            if (!this._beginTransformSession(layer, tool, point, event.pointerId, true)) {
                return;
            }
            return;
        }

        // Handle lasso tools (never paint directly onto imported image layer)
        if (IAMCCS_LASSO_TOOLS.has(tool)) {
            let layer = this.toolTargetResolver.resolveLassoLayer();
            if (!layer) return;
            this.layerManager.snapshot();
            layer = this._bakeLayerTransformForEditing(layer);
            this._ensureLiveSurface(layer);
            this.isDrawing = true;
            this.activePointerId = event.pointerId;
            this.lassoPoints = [this._mapPointToLayerInput(this._getCanvasPoint(event), layer)];
            const lopts = this.maskManager.getLassoOptions?.() || { fill: false };
            this.lassoFill = !!lopts.fill;
            this.canvas.setPointerCapture?.(event.pointerId);
            return;
        }

        // Handle vector tools (never paint directly onto imported image layer)
        if (IAMCCS_VECTOR_TOOLS.has(tool)) {
            let layer = this.toolTargetResolver.resolveVectorLayer();
            if (!layer) return;
            if (!this.vectorIsAdding) {
                // Start a new vector path
                this.layerManager.snapshot();
                layer = this._bakeLayerTransformForEditing(layer);
                this._ensureLiveSurface(layer);
                this.vectorPoints = [];
                this.vectorIsAdding = true;
                this.vectorFill = tool === "vector_fill";
            }
            const p = this._mapPointToLayerInput(this._getCanvasPoint(event), layer);
            // If user clicks near the first point and there are enough points, close
            if (this.vectorPoints.length >= 2 && this._nearPoint(p, this.vectorPoints[0])) {
                this._commitVector();
                return;
            }
            // Add a tentative line segment; will upgrade to quad on drag
            this.vectorPoints.push({ x: p.x, y: p.y, type: "line" });
            this.isDrawing = true;
            this.activePointerId = event.pointerId;
            this.canvas.setPointerCapture?.(event.pointerId);
            this._drawVectorPreview();
            this._requestRender();
            return;
        }

        // Default stroke tools
        if (IAMCCS_SUPPORTED_STROKE_TOOLS.has(tool)) {
            let layer = this.toolTargetResolver.resolveStrokeLayer(tool);
            if (!layer) return;
            debugTrace('[GoyaRenderer] pointerdown:stroke', {
                tool,
                resolvedLayerId: layer.id,
                resolvedLayerName: layer.name,
                activeLayerIdBeforeSnapshot: this.layerManager.getActiveLayerId?.() || null,
                vectorToolEnabled: !!this.vectorTool?.enabled,
            });

            if (tool === "eraser") {
                this.layerManager.snapshot();
                layer = this._bakeLayerTransformForEditing(layer);
                this.strokeTool = tool;
                this.baseBrush = this._getSafeStrokeBrush(tool);
                this._ensureLiveSurface(layer);
                this.isDrawing = true;
                this.strokeMoved = false;
                this.activePointerId = event.pointerId;
                this.lastPoint = this._getCanvasPoint(event);
                this.lastMidpoint = this.lastPoint;
                this.canvas.setPointerCapture?.(event.pointerId);
                const pressure = this._resolvePressure(event);
                this._strokePoint(this.lastPoint, pressure, true);
                this._requestStrokeRender(true);
            } else {
                this.layerManager.snapshot();
                layer = this._bakeLayerTransformForEditing(layer);
                this.strokeTool = tool;
                this.baseBrush = this._getSafeStrokeBrush(tool);
                this._ensureLiveSurface(layer);
                this.isDrawing = true;
                this.strokeMoved = false;
                this.activePointerId = event.pointerId;
                this.lastPoint = this._getCanvasPoint(event);
                this.lastMidpoint = this.lastPoint;
                this.canvas.setPointerCapture?.(event.pointerId);
                const pressure = this._resolvePressure(event);
                this._strokePoint(this.lastPoint, pressure, true);
                this._requestStrokeRender(true);
            }
        }
    }

    _onPointerMove(event) {
        if (IAMCCS_VECTOR_TOOLS.has(this.maskManager.activeTool)) {
            return;
        }
        if (!this.isDrawing || event.pointerId !== this.activePointerId) {
            return;
        }
        const point = this._getCanvasPoint(event);

        // Liquify brush interactive warp
        if (this.maskManager.activeTool === IAMCCS_LIQUIFY_TOOL) {
            const layer = this._liqLayer || this.layerManager.getActiveLayer?.();
            const mappedPoint = this._mapPointToLayerInput(point, layer);
            this._applyLiquifyBrush(mappedPoint, this._liqLast);
            this._liqLast = mappedPoint;
            this._requestRender();
            return;
        }

        // Text tool disabled (stability priority)
        if (this.maskManager.activeTool === "text") {
            return;
        }

        if (IAMCCS_VECTOR_TOOLS.has(this.maskManager.activeTool) && this.vectorTool?.enabled) {
            return;
        }

        // Transform tools
        if (this._hasTransformSession()) {
            this._updateTransform(point);
            this._requestRender();
            return;
        }

        // Lasso tools
        if (this.lassoPoints && this.lassoPoints.length) {
            const layer = this.layerManager.getActiveLayer?.();
            this.lassoPoints.push(this._mapPointToLayerInput(point, layer));
            this._drawLassoPreview();
            this._requestRender();
            return;
        }

        // Vector tools: modify last segment if dragging to create a curve
        if (this.vectorIsAdding && this.vectorPoints.length) {
            const layer = this.layerManager.getActiveLayer?.();
            const mappedPoint = this._mapPointToLayerInput(point, layer);
            const lastIdx = this.vectorPoints.length - 1;
            const last = this.vectorPoints[lastIdx];
            // Promote to quad curve when moving beyond a small threshold
            const prev = this.vectorPoints[lastIdx - 1] || last;
            const dx = mappedPoint.x - last.x;
            const dy = mappedPoint.y - last.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 > 9) { // threshold ~3px
                last.type = "quad";
                // Use current pointer as control point for a simple quadratic curve
                last.cx = mappedPoint.x;
                last.cy = mappedPoint.y;
            } else {
                last.type = "line";
                delete last.cx; delete last.cy;
            }
            this._drawVectorPreview();
            this._requestRender();
            return;
        }

        // Stroke tools
        const events = typeof event.getCoalescedEvents === "function"
            ? event.getCoalescedEvents()
            : null;
        const strokeEvents = events && events.length ? events : [event];
        for (const strokeEvent of strokeEvents) {
            const strokePoint = this._getCanvasPoint(strokeEvent);
            const pressure = this._resolvePressure(strokeEvent);
            this._strokePoint(strokePoint, pressure, false);
        }
        this._requestStrokeRender();
    }

    _onPointerUp(event) {
        if (IAMCCS_VECTOR_TOOLS.has(this.maskManager.activeTool)) {
            return;
        }
        if (!this.isDrawing) {
            return;
        }
        if (event.pointerId != null && event.pointerId !== this.activePointerId) {
            return;
        }
        this.canvas.releasePointerCapture?.(this.activePointerId);
        if (this.maskManager.activeTool === "text") {
            this.textDragStart = null;
            this.textDragRect = null;
            this._resetStrokeState();
            this._requestRender();
            return;
        }
        if (this._hasTransformSession()) {
            this.eventBus.emit("canvas:transform:precommit");
            this._commitTransform();
        } else if (this.maskManager.activeTool === IAMCCS_LIQUIFY_TOOL) {
            this._commitStroke();
            this._liqLast = null;
            this._liqLayer = null;
        } else if (this.lassoPoints && this.lassoPoints.length) {
            this._commitLasso();
        } else if (this.vectorIsAdding) {
            // Single click without closing just adds the point; releasing ends drag state
            this.isDrawing = false;
            this.activePointerId = null;
            // If autoclose and we ended near start with enough points, close
            const opts = this.maskManager.getVectorOptions?.() || { autoclose: true };
            if (opts.autoclose && this.vectorPoints.length >= 3) {
                const last = this.vectorPoints[this.vectorPoints.length - 1];
                if (this._nearPoint(last, this.vectorPoints[0])) {
                    this._commitVector();
                }
            }
            return;
        } else {
            if (!this.strokeMoved && this.lastPoint && IAMCCS_SUPPORTED_STROKE_TOOLS.has(this.strokeTool)) {
                this._renderTapStroke(this.lastPoint);
            }
            this._commitStroke();
        }
    }

    // External transform control for overlays (frame handles)
    beginExternalTransform(mode, startPoint) {
        if (!this._isTransformMode(mode)) return false;
        const layer = this.toolTargetResolver.resolveTransformLayer?.() || null;
        if (!layer) return false;
        return this._beginTransformSession(layer, mode, startPoint || { x: this.canvas.width / 2, y: this.canvas.height / 2 }, -1, false);
    }
    updateExternalTransform(point) {
        if (!this._hasTransformSession()) return;
        this._updateTransform(point);
        this._requestRender();
    }
    commitExternalTransform() {
        if (!this._hasTransformSession()) return;
        this._commitTransform();
    }

    getTransformPreviewFrameState() {
        const session = this._getTransformSession();
        if (!session) return null;
        const effectiveTransform = this._normTransform(session.effectiveTransform || session.baseTransform || {});
        return {
            layerId: session.layerId,
            baseBounds: session.sourceBounds ? { ...session.sourceBounds } : null,
            bounds: session.previewBounds ? { ...session.previewBounds } : (session.currentBounds ? { ...session.currentBounds } : null),
            transform: { ...effectiveTransform },
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        };
    }

    _getTransformSession() {
        const session = this.transformSession;
        if (!session || !session.mode || !session.snapshot) {
            return null;
        }
        return session;
    }

    _hasTransformSession() {
        return !!this._getTransformSession();
    }

    _beginTransformSession(layer, mode, startPoint, pointerId = null, capturePointer = false) {
        this.layerManager.snapshot?.();
        this._ensureLiveSurface(layer);
        if (!this._prepareTransformSession(layer, mode, startPoint)) {
            return false;
        }
        this.isDrawing = true;
        this.activePointerId = pointerId;
        if (capturePointer && pointerId != null && pointerId >= 0) {
            this.canvas.setPointerCapture?.(pointerId);
        }
        return true;
    }

    _isTransformMode(mode) {
        return typeof mode === 'string' && (IAMCCS_TRANSFORM_TOOLS.has(mode) || mode.startsWith('scale-'));
    }

    _prepareTransformSession(layer, mode, startPoint) {
        const baseTransform = this._normTransform(layer?.metadata?.transform || {});
        const snapshotState = this._buildLayerTransformSnapshot(layer, true);
        if (!snapshotState?.canvas || !snapshotState?.bounds) return false;
        const snapshot = snapshotState.canvas;
        const sourceBounds = snapshotState.bounds;
        if (!sourceBounds) return false;
        const currentBounds = TransformMath.transformBounds(sourceBounds, baseTransform, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
        const origin = { x: currentBounds.x + currentBounds.w / 2, y: currentBounds.y + currentBounds.h / 2 };
        const start = startPoint || origin;
        const preview = {
            dx: 0,
            dy: 0,
            sx: 1,
            sy: 1,
            angle: 0,
            ax: 0,
            ay: 0,
            originX: origin.x,
            originY: origin.y,
        };
        const session = {
            layerId: layer.id,
            mode,
            snapshot,
            snapshotX: Number(snapshotState.drawX || 0),
            snapshotY: Number(snapshotState.drawY || 0),
            baseTransform,
            sourceBounds,
            currentBounds,
            previewBounds: currentBounds,
            start,
            origin,
            preview,
            effectiveTransform: baseTransform,
            rotateStartAngle: 0,
            rotateBaseAngle: 0,
        };
        if (mode === 'rotate') {
            session.rotateStartAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
        }
        this.transformSession = session;
        return true;
    }

    _buildLayerTransformSnapshot(layer, ignoreExistingTransform = false) {
        const source = this.liveLayerCanvas || this._getLayerHitTestImage(layer);
        if (!source) return null;
        const width = source.naturalWidth || source.width || this.canvas.width;
        const height = source.naturalHeight || source.height || this.canvas.height;
        const t = this._normTransform(layer?.metadata?.transform || {});
        const applyTransform = !ignoreExistingTransform && !!layer?.metadata?.transform && layer.id !== 'layer_background' && layer.metadata?.type !== 'text';
        const baseSnapshot = document.createElement('canvas');
        baseSnapshot.width = width;
        baseSnapshot.height = height;
        const baseCtx = baseSnapshot.getContext('2d', { desynchronized: true });
        if (!baseCtx) return null;
        baseCtx.drawImage(source, 0, 0, width, height);

        const sourceBounds = this._scanCanvasAlphaBounds(baseSnapshot) || { x: 0, y: 0, w: width, h: height };
        if (!applyTransform) {
            return {
                canvas: baseSnapshot,
                bounds: sourceBounds,
                drawX: 0,
                drawY: 0,
            };
        }

        const transformedBounds = this._transformSnapshotBounds(sourceBounds, t, width, height);
        const snapshot = document.createElement('canvas');
        snapshot.width = Math.max(1, Math.ceil(transformedBounds.w));
        snapshot.height = Math.max(1, Math.ceil(transformedBounds.h));
        const ctx = snapshot.getContext('2d', { desynchronized: true });
        if (!ctx) return null;

        ctx.save();
        ctx.translate(-transformedBounds.x, -transformedBounds.y);
        const translateOnly = (t.angle === 0 && t.sx === 1 && t.sy === 1);
        if (translateOnly) {
            ctx.translate(t.dx, t.dy);
            ctx.drawImage(baseSnapshot, 0, 0, width, height);
        } else {
            const origin = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
            ctx.translate(origin.x, origin.y);
            ctx.translate(t.dx, t.dy);
            if (t.angle) ctx.rotate(t.angle);
            if (t.sx !== 1 || t.sy !== 1) ctx.scale(t.sx, t.sy);
            ctx.drawImage(baseSnapshot, -width / 2, -height / 2, width, height);
        }
        ctx.restore();

        return {
            canvas: snapshot,
            bounds: transformedBounds,
            drawX: transformedBounds.x,
            drawY: transformedBounds.y,
        };
    }

    _transformSnapshotBounds(bounds, transform, sourceWidth, sourceHeight) {
        return TransformMath.transformBounds(bounds || { x: 0, y: 0, w: sourceWidth, h: sourceHeight }, transform, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
    }

    _scanCanvasAlphaBounds(canvas) {
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;
            const { width, height } = canvas;
            const data = ctx.getImageData(0, 0, width, height).data;
            let minX = width;
            let minY = height;
            let maxX = -1;
            let maxY = -1;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const alpha = data[(y * width + x) * 4 + 3];
                    if (alpha <= 0) continue;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
            if (maxX < minX || maxY < minY) return null;
            return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        } catch (_e) {
            return null;
        }
    }

    _computeScalePreview(mode, dx, dy, session = this._getTransformSession()) {
        const sourceBounds = session?.sourceBounds || session?.currentBounds || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        const baseTransform = this._normTransform(session?.baseTransform || session?.effectiveTransform || {});
        const bounds = {
            x: 0,
            y: 0,
            w: Math.max(1, (sourceBounds.w || this.canvas.width) * (baseTransform.sx || 1)),
            h: Math.max(1, (sourceBounds.h || this.canvas.height) * (baseTransform.sy || 1)),
        };
        const opts = this.maskManager.getScaleOptions?.() || { keepAspect: true };
        const angle = baseTransform.angle || 0;
        if (mode === 'scale') {
            const reference = Math.max(64, Math.hypot(bounds.w, bounds.h) * 0.5);
            const uniform = Math.max(0.1, 1 - (dy / reference));
            return { sx: uniform, sy: uniform, ax: 0, ay: 0 };
        }
        return TransformMath.computeScalePreview(mode, dx, dy, bounds, angle, !!opts.keepAspect, 0.1);
    }

    _applyLiquifyBrush(point, prevPoint=null) {
        if (!this.liveLayerCtx) return;
        const r = Math.max(2, this.liqBrushRadius|0);
        const strength = Math.max(0.01, this.liqStrength);
        const x0 = Math.max(0, Math.floor(point.x - r));
        const y0 = Math.max(0, Math.floor(point.y - r));
        const layerW = this.liveLayerCanvas?.width || this.canvas.width;
        const layerH = this.liveLayerCanvas?.height || this.canvas.height;
        const w = Math.min(layerW - x0, r*2);
        const h = Math.min(layerH - y0, r*2);
        if (w<=0 || h<=0) return;
        const ctx = this.liveLayerCtx;
        const imgData = ctx.getImageData(x0, y0, w, h);
        const srcData = imgData.data;
        const out = ctx.createImageData(w,h);
        const dst = out.data;
        const mode = this.liqMode === "swirl" ? "twirl" : this.liqMode;
        const copyPixel = (di, si) => {
            dst[di]=srcData[si]; dst[di+1]=srcData[si+1]; dst[di+2]=srcData[si+2]; dst[di+3]=srcData[si+3];
        };
        const samplePixel = (x, y) => {
            const sxC = Math.min(w-1, Math.max(0, Math.round(x)));
            const syC = Math.min(h-1, Math.max(0, Math.round(y)));
            return (syC*w+sxC)*4;
        };
        if ((mode === 'push' || mode === 'pull') && prevPoint) {
            const dir = mode === 'pull' ? -1 : 1;
            const dxStroke = (point.x - prevPoint.x) * dir;
            const dyStroke = (point.y - prevPoint.y) * dir;
            const len = Math.max(1e-3, Math.hypot(dxStroke, dyStroke));
            const ux = dxStroke / len, uy = dyStroke / len;
            const maxShift = Math.max(1, Math.round(strength * 8));
            for (let y=0;y<h;y++){
                for (let x=0;x<w;x++){
                    const gx = x0 + x - point.x;
                    const gy = y0 + y - point.y;
                    const rr = Math.hypot(gx, gy);
                    const fall = rr > r ? 0 : 1 - (rr / r);
                    const shift = maxShift * fall * fall; // stronger at center
                    const si = samplePixel(x - ux * shift, y - uy * shift);
                    const di=(y*w+x)*4;
                    copyPixel(di, si);
                }
            }
        } else if (mode === 'pinch' || mode === 'expand') {
            const cx = point.x - x0, cy = point.y - y0;
            const sign = mode === 'pinch' ? 1 : -1;
            const maxShift = Math.max(1, strength * r * 0.32);
            for (let y=0;y<h;y++){
                for (let x=0;x<w;x++){
                    const dx = x - cx, dy = y - cy;
                    const rr = Math.hypot(dx, dy);
                    const di=(y*w+x)*4;
                    if (rr > r || rr < 1e-3) { copyPixel(di, di); continue; }
                    const fall = 1 - (rr / r);
                    const shift = sign * maxShift * fall * fall;
                    const sx = x + (dx / rr) * shift;
                    const sy = y + (dy / rr) * shift;
                    copyPixel(di, samplePixel(sx, sy));
                }
            }
        } else if (mode === 'smooth') {
            const cx = point.x - x0, cy = point.y - y0;
            const mix = Math.max(0.05, Math.min(0.92, strength));
            for (let y=0;y<h;y++){
                for (let x=0;x<w;x++){
                    const dx = x - cx, dy = y - cy;
                    const rr = Math.hypot(dx, dy);
                    const di=(y*w+x)*4;
                    if (rr > r) { copyPixel(di, di); continue; }
                    const fall = (1 - (rr / r)) ** 2;
                    let sr=0, sg=0, sb=0, sa=0, count=0;
                    for (let oy=-1; oy<=1; oy++) {
                        for (let ox=-1; ox<=1; ox++) {
                            const si = samplePixel(x + ox, y + oy);
                            sr += srcData[si]; sg += srcData[si+1]; sb += srcData[si+2]; sa += srcData[si+3]; count++;
                        }
                    }
                    const blend = mix * fall;
                    dst[di] = srcData[di] * (1 - blend) + (sr / count) * blend;
                    dst[di+1] = srcData[di+1] * (1 - blend) + (sg / count) * blend;
                    dst[di+2] = srcData[di+2] * (1 - blend) + (sb / count) * blend;
                    dst[di+3] = srcData[di+3] * (1 - blend) + (sa / count) * blend;
                }
            }
        } else {
            const cx = point.x - x0, cy=point.y - y0;
            const baseAngle = strength * 0.8; // up to ~45deg near center
            for (let y=0;y<h;y++){
                for (let x=0;x<w;x++){
                    const dx = x - cx, dy = y - cy;
                    const rr = Math.sqrt(dx*dx+dy*dy);
                    if (rr > r) { // copy as-is
                        const i=(y*w+x)*4; copyPixel(i, i); continue;
                    }
                    const t = 1 - (rr / r);
                    const ang = baseAngle * t*t; // stronger near center
                    const ca = Math.cos(ang), sa = Math.sin(ang);
                    const sx = cx + dx*ca - dy*sa;
                    const sy = cy + dx*sa + dy*ca;
                    const si=samplePixel(sx, sy); const di=(y*w+x)*4;
                    copyPixel(di, si);
                }
            }
        }
        ctx.putImageData(out, x0, y0);
    }

    // Expose a public requestRender for UI callers
    requestRender() { this._requestRender(); }

    // ====== FILM helpers ======
    _applyFilmGrain(imgData) {
        const { intensity=0.2, size=2 } = this.film.grain || {};
        const data = imgData.data; const w = imgData.width, h = imgData.height;
        const cell = Math.max(1, size|0);
        // Smooth value noise with bilinear interpolation per cell to avoid checkerboard
        const hash = (x,y)=>{
            let t = (x*374761393 + y*668265263) ^ (x<<1);
            t = (t ^ (t>>13)) * 1274126177;
            return ((t ^ (t>>16)) & 0xffff) / 0xffff; // 0..1
        };
        for (let y=0;y<h;y++){
            const gy = y / cell; const y0 = Math.floor(gy); const ty = gy - y0; const y1 = y0 + 1;
            for (let x=0;x<w;x++){
                const gx = x / cell; const x0 = Math.floor(gx); const tx = gx - x0; const x1 = x0 + 1;
                const n00 = hash(x0,y0), n10=hash(x1,y0), n01=hash(x0,y1), n11=hash(x1,y1);
                const nx0 = n00*(1-tx) + n10*tx;
                const nx1 = n01*(1-tx) + n11*tx;
                const n = (nx0*(1-ty) + nx1*ty) - 0.5; // -0.5..0.5
                const add = n * 64 * intensity; // amplitude
                const i=(y*w+x)*4;
                data[i]   = Math.max(0, Math.min(255, data[i] + add));
                data[i+1] = Math.max(0, Math.min(255, data[i+1] + add));
                data[i+2] = Math.max(0, Math.min(255, data[i+2] + add));
            }
        }
        return imgData;
    }

    // _applyFilmDamage removed

    _applyFilmLUT(imgData) {
        const lut = this.film.lut?.cube || this._builtinLUT(this.film.lut?.preset);
        if (!lut) return imgData;
        const data = imgData.data; const w = imgData.width, h = imgData.height;
        if (lut.type === '1D') {
            const L = lut.size; const t = lut.table; const min = lut.domainMin||0, max = lut.domainMax||1;
            for (let i=0;i<data.length;i+=4){
                const r = data[i]/255, g=data[i+1]/255, b=data[i+2]/255;
                const sr = Math.min(1, Math.max(0, (r-min)/(max-min))); const si = Math.round(sr*(L-1));
                const sg = Math.min(1, Math.max(0, (g-min)/(max-min))); const sj = Math.round(sg*(L-1));
                const sb = Math.min(1, Math.max(0, (b-min)/(max-min))); const sk = Math.round(sb*(L-1));
                data[i]   = Math.round(t[si]*255);
                data[i+1] = Math.round(t[sj]*255);
                data[i+2] = Math.round(t[sk]*255);
            }
            return imgData;
        }
        if (lut.type === '3D') {
            const N = lut.size; const tab = lut.table; const min = lut.domainMin||0, max = lut.domainMax||1;
            const idx = (r,g,b)=>((r*N + g)*N + b)*3;
            const clamp = (v, lo, hi)=>Math.max(lo, Math.min(hi, v));
            for (let i=0;i<data.length;i+=4){
                const rn = clamp((data[i]/255 - min)/(max-min), 0, 1);
                const gn = clamp((data[i+1]/255 - min)/(max-min), 0, 1);
                const bn = clamp((data[i+2]/255 - min)/(max-min), 0, 1);
                const rx = rn*(N-1), gx=gn*(N-1), bx=bn*(N-1);
                const r0=Math.floor(rx), r1=Math.min(N-1, r0+1), tx=rx-r0;
                const g0=Math.floor(gx), g1=Math.min(N-1, g0+1), ty=gx-g0;
                const b0=Math.floor(bx), b1=Math.min(N-1, b0+1), tz=bx-b0;
                const c000 = idx(r0,g0,b0), c100 = idx(r1,g0,b0), c010=idx(r0,g1,b0), c110=idx(r1,g1,b0);
                const c001 = idx(r0,g0,b1), c101 = idx(r1,g0,b1), c011=idx(r0,g1,b1), c111=idx(r1,g1,b1);
                const lerp = (a,b,t)=>a*(1-t)+b*t;
                const mix = (a,b,t)=>[lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
                const v000=[tab[c000],tab[c000+1],tab[c000+2]], v100=[tab[c100],tab[c100+1],tab[c100+2]];
                const v010=[tab[c010],tab[c010+1],tab[c010+2]], v110=[tab[c110],tab[c110+1],tab[c110+2]];
                const v001=[tab[c001],tab[c001+1],tab[c001+2]], v101=[tab[c101],tab[c101+1],tab[c101+2]];
                const v011=[tab[c011],tab[c011+1],tab[c011+2]], v111=[tab[c111],tab[c111+1],tab[c111+2]];
                const vx00 = mix(v000, v100, tx), vx10 = mix(v010, v110, tx), vx01 = mix(v001, v101, tx), vx11 = mix(v011, v111, tx);
                const vxy0 = mix(vx00, vx10, ty), vxy1 = mix(vx01, vx11, ty);
                const vxyz = mix(vxy0, vxy1, tz);
                data[i]   = Math.round(vxyz[0]*255);
                data[i+1] = Math.round(vxyz[1]*255);
                data[i+2] = Math.round(vxyz[2]*255);
            }
            return imgData;
        }
        return imgData;
    }

    _getActiveEditableLayer() {
        const active = this.layerManager.getActiveLayer?.();
        if (active) return active;
        const activeId = this.layerManager.getActiveLayerId?.() || this.activeLayerId;
        if (!activeId) return null;
        return this.layerManager.getLayerById?.(activeId)
            || (this.layerManager.getLayers?.() || []).find((layer) => layer?.id === activeId)
            || null;
    }

    _isEditableBitmapLayer(layer) {
        return !!layer
            && layer.id !== "layer_background"
            && layer.metadata?.type !== "text"
            && !!layer.bitmap;
    }

    _hasActiveImageColorPipeline() {
        const a = this.adjust || {};
        const levels = this.imaging?.levels || {};
        const rgb = this.imaging?.rgb || {};
        const wheel = this.imaging?.colorwheel || {};
        const hasAdjust = Math.abs((a.exposure ?? 1) - 1) > 1e-6
            || Math.abs((a.brightness ?? 1) - 1) > 1e-6
            || Math.abs((a.contrast ?? 1) - 1) > 1e-6
            || Math.abs((a.saturation ?? 1) - 1) > 1e-6
            || Math.abs((a.gamma ?? 1) - 1) > 1e-6
            || Math.abs(a.curve ?? 0) > 1e-6;
        const hasLevels = (levels.black ?? 0) !== 0
            || (levels.white ?? 255) !== 255
            || Math.abs((levels.gamma ?? 1) - 1) > 1e-6;
        const hasRgb = (rgb.r ?? 0) !== 0 || (rgb.g ?? 0) !== 0 || (rgb.b ?? 0) !== 0;
        const hasWheel = Math.abs(wheel.hueDeg ?? 0) > 1e-6 || (wheel.sat ?? 0) > 0;
        const hasCurves = !!this.imaging?.curves?.lut;
        const hasEffects = Object.values(this.imaging?.effects || {}).some((effect) => !!effect?.enabled && Number(effect.amount || 0) > 0);
        return hasAdjust || hasLevels || hasRgb || hasWheel || hasCurves || hasEffects;
    }

    _applyImageColorPipeline(imgData) {
        imgData = this._applyLevels(imgData);
        imgData = this._applyCurves(imgData);
        imgData = this._applyRGBAdjust(imgData);
        imgData = this._applyImaginingEffects(imgData);
        imgData = this._applyColorWheel(imgData);
        imgData = this._applyAdjustments(imgData);
        return imgData;
    }

    _resetImageColorPipelineState() {
        this.adjust = { exposure: 1, brightness: 1, contrast: 1, saturation: 1, gamma: 1, curve: 0 };
        this.imaging.effects = {};
        this.imaging.levels = { black: 0, white: 255, gamma: 1 };
        this.imaging.curves.lut = null;
        this.imaging.rgb = { r: 0, g: 0, b: 0 };
        this.imaging.colorwheel = { hueDeg: 0, sat: 0 };
    }

    async _loadLayerBitmapImage(layer) {
        const cached = this.imageCache.get(layer.id);
        if (cached?.image && this._isDrawableImage(cached.image)) {
            return cached.image;
        }
        if (!layer.bitmap) return null;
        const image = new Image();
        image.src = layer.bitmap;
        if (!image.complete) {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
            });
        }
        return this._isDrawableImage(image) ? image : null;
    }

    commitActiveTransform() {
        const layer = this._getActiveEditableLayer();
        const transform = this._normTransform(layer?.metadata?.transform || {});
        if (!layer || !this._isEditableBitmapLayer(layer)) {
            this.eventBus.emit("gimp:commit:state", { kind: "transform", ok: false, reason: "no-editable-layer" });
            return false;
        }
        if (this._isIdentityTransform(transform)) {
            this.eventBus.emit("gimp:transform:state", { transform, angleDeg: 0, committed: false });
            this.eventBus.emit("gimp:commit:state", { kind: "transform", ok: true, skipped: true, layerId: layer.id });
            return true;
        }
        this.layerManager.snapshot?.();
        const baked = this._bakeLayerTransformForEditing(layer);
        const identity = { dx: 0, dy: 0, sx: 1, sy: 1, angle: 0 };
        this._requestRender();
        this.eventBus.emit("gimp:transform:state", { transform: identity, angleDeg: 0, committed: true });
        this.eventBus.emit("gimp:commit:state", { kind: "transform", ok: true, layerId: baked?.id || layer.id });
        return true;
    }

    async commitActiveImageColor() {
        let layer = this._getActiveEditableLayer();
        if (!layer || !this._isEditableBitmapLayer(layer)) {
            this.eventBus.emit("gimp:commit:state", { kind: "color", ok: false, reason: "no-editable-layer" });
            return false;
        }
        if (!this._hasActiveImageColorPipeline()) {
            this.eventBus.emit("gimp:commit:state", { kind: "color", ok: true, skipped: true, layerId: layer.id });
            return true;
        }

        this.layerManager.snapshot?.();
        layer = this._bakeLayerTransformForEditing(layer);
        const source = await this._loadLayerBitmapImage(layer);
        if (!source) {
            this.eventBus.emit("gimp:commit:state", { kind: "color", ok: false, reason: "source-not-ready", layerId: layer.id });
            return false;
        }

        const baked = document.createElement("canvas");
        baked.width = this.canvas.width;
        baked.height = this.canvas.height;
        const ctx = baked.getContext("2d", { desynchronized: true });
        if (!ctx) {
            this.eventBus.emit("gimp:commit:state", { kind: "color", ok: false, reason: "canvas-context", layerId: layer.id });
            return false;
        }

        this._drawImageAtNativeSize(ctx, source);
        let imgData = ctx.getImageData(0, 0, baked.width, baked.height);
        imgData = this._applyImageColorPipeline(imgData);
        ctx.putImageData(imgData, 0, 0);
        this._updateBitmapLayerFromDataUrl(layer.id, baked.toDataURL("image/png"), baked);
        this._resetImageColorPipelineState();
        this._requestRender();
        this.eventBus.emit("image:histogram:request", {});
        this.eventBus.emit("gimp:commit:state", { kind: "color", ok: true, layerId: layer.id });
        return true;
    }

    _applyAdjustments(imgData) {
        try {
            const a = this.adjust || {};
            const { exposure=1, brightness=1, contrast=1, saturation=1, gamma=1, curve=0 } = a;
            const isDefault = Math.abs(exposure-1)<1e-6 && Math.abs(brightness-1)<1e-6 && Math.abs(contrast-1)<1e-6 && Math.abs(saturation-1)<1e-6 && Math.abs(gamma-1)<1e-6 && Math.abs(curve-0)<1e-6;
            if (isDefault) return imgData; // nothing to do
            const data = imgData.data; const len = data.length;
            const clamp = (v)=> Math.min(255, Math.max(0, v));
            const applyCurve = (v01)=>{
                if (curve <= 0) return v01;
                // Simple S-curve blend: mix linear with S-curve shaped by t=curve
                const s = (v01 < 0.5) ? 2*v01*v01 : 1 - 2*(1-v01)*(1-v01);
                return v01*(1-curve) + s*curve;
            };
            const invGamma = 1 / Math.max(0.1, gamma);
            for (let i=0;i<len;i+=4){
                let r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
                // exposure and brightness as multiplicative gains
                r *= exposure * brightness; g *= exposure * brightness; b *= exposure * brightness;
                // contrast around mid 0.5
                r = 0.5 + (r - 0.5) * contrast; g = 0.5 + (g - 0.5) * contrast; b = 0.5 + (b - 0.5) * contrast;
                // saturation via luma isolation
                const luma = 0.299*r + 0.587*g + 0.114*b;
                r = luma + (r - luma) * saturation;
                g = luma + (g - luma) * saturation;
                b = luma + (b - luma) * saturation;
                // curve blend
                r = applyCurve(r); g = applyCurve(g); b = applyCurve(b);
                // gamma correction
                r = Math.pow(Math.max(0, Math.min(1, r)), invGamma);
                g = Math.pow(Math.max(0, Math.min(1, g)), invGamma);
                b = Math.pow(Math.max(0, Math.min(1, b)), invGamma);
                data[i] = clamp(Math.round(r*255));
                data[i+1] = clamp(Math.round(g*255));
                data[i+2] = clamp(Math.round(b*255));
            }
            return imgData;
        } catch (_e) { return imgData; }
    }

    _applyLevels(imgData) {
        try {
            const { black=0, white=255, gamma=1 } = this.imaging.levels || {};
            const lo = Math.max(0, Math.min(254, black));
            const hi = Math.max(1, Math.min(255, white));
            if (lo === 0 && hi === 255 && Math.abs(gamma-1) < 1e-6) return imgData;
            const data = imgData.data; const range = Math.max(1, hi - lo); const invGamma = 1 / Math.max(0.1, gamma);
            for (let i=0;i<data.length;i+=4){
                for (let c=0;c<3;c++){
                    let v = data[i+c];
                    let n = Math.max(0, Math.min(1, (v - lo) / range));
                    n = Math.pow(n, invGamma);
                    data[i+c] = Math.round(n * 255);
                }
            }
            return imgData;
        } catch (_e) { return imgData; }
    }

    _applyCurves(imgData) {
        try {
            const lut = this.imaging.curves?.lut || null;
            if (!(lut && lut.length === 256)) return imgData;
            const data = imgData.data;
            for (let i=0;i<data.length;i+=4){
                data[i]   = lut[data[i]];
                data[i+1] = lut[data[i+1]];
                data[i+2] = lut[data[i+2]];
            }
            return imgData;
        } catch (_e) { return imgData; }
    }

    _applyRGBAdjust(imgData) {
        try {
            const { r=0, g=0, b=0 } = this.imaging.rgb || {};
            if (r === 0 && g === 0 && b === 0) return imgData;
            const data = imgData.data;
            const clamp = (v)=>Math.min(255, Math.max(0, v));
            for (let i=0;i<data.length;i+=4){
                data[i]   = clamp(data[i]   + r);
                data[i+1] = clamp(data[i+1] + g);
                data[i+2] = clamp(data[i+2] + b);
            }
            return imgData;
        } catch (_e) { return imgData; }
    }

    _applyImaginingEffects(imgData) {
        try {
            const effects = this.imaging.effects || {};
            const keys = Object.keys(effects).filter(k => effects[k]?.enabled);
            if (keys.length === 0) return imgData;
            // Apply in a stable order to avoid surprises
            const order = [
                'negative','grayscale','sepia','posterize','solarize','vignette',
                'hue-rotate','saturate','desaturate','brightness','contrast','emboss','blur','sharpen'
            ];
            for (const key of order){
                const cfg = effects[key]; if (!cfg?.enabled) continue;
                const amt = Math.max(0, Math.min(1, cfg.amount || 0));
                if (key === 'negative') imgData = this._fxNegative(imgData);
                else if (key === 'grayscale') imgData = this._fxGrayscale(imgData, amt);
                else if (key === 'sepia') imgData = this._fxSepia(imgData, amt);
                else if (key === 'posterize') imgData = this._fxPosterize(imgData, Math.max(2, Math.round(amt*8)));
                else if (key === 'solarize') imgData = this._fxSolarize(imgData, amt);
                else if (key === 'vignette') imgData = this._fxVignette(imgData, amt);
                else if (key === 'hue-rotate') imgData = this._fxHueRotate(imgData, amt*360);
                else if (key === 'saturate') imgData = this._fxSaturate(imgData, 1 + amt);
                else if (key === 'desaturate') imgData = this._fxSaturate(imgData, 1 - amt);
                else if (key === 'brightness') imgData = this._fxBrightness(imgData, 1 + amt);
                else if (key === 'contrast') imgData = this._fxContrast(imgData, 1 + amt);
                else if (key === 'emboss') imgData = this._fxEmboss(imgData, amt);
                else if (key === 'blur') imgData = this._fxBlur(imgData, amt);
                else if (key === 'sharpen') imgData = this._fxSharpen(imgData, amt);
            }
            return imgData;
        } catch (_e) { return imgData; }
    }

    _applyColorWheel(imgData) {
        try {
            const { hueDeg=0, sat=0 } = this.imaging.colorwheel || {};
            if (Math.abs(hueDeg) < 1e-6 && sat <= 0) return imgData;
            return this._fxHueSaturation(imgData, hueDeg, sat);
        } catch (_e) { return imgData; }
    }

    _computeHistogram(imgData) {
        try {
            const bins = new Array(256).fill(0);
            const d = imgData.data; const len = d.length;
            for (let i=0;i<len;i+=4){
                const r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
                const luma = Math.max(0, Math.min(1, 0.299*r + 0.587*g + 0.114*b));
                const idx = Math.max(0, Math.min(255, Math.round(luma*255)));
                bins[idx]++;
            }
            return bins;
        } catch (_e) { return new Array(256).fill(0); }
    }

    // Basic effects implementations
    _fxNegative(imgData){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; } return imgData; }
    _fxGrayscale(imgData, amt){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; d[i]=Math.round(d[i]*(1-amt)+l*amt); d[i+1]=Math.round(d[i+1]*(1-amt)+l*amt); d[i+2]=Math.round(d[i+2]*(1-amt)+l*amt);} return imgData; }
    _fxSepia(imgData, amt){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2]; const sr=Math.min(255,0.393*r+0.769*g+0.189*b), sg=Math.min(255,0.349*r+0.686*g+0.168*b), sb=Math.min(255,0.272*r+0.534*g+0.131*b); d[i]=Math.round(r*(1-amt)+sr*amt); d[i+1]=Math.round(g*(1-amt)+sg*amt); d[i+2]=Math.round(b*(1-amt)+sb*amt);} return imgData; }
    _fxPosterize(imgData, levels){ const d=imgData.data; const step=255/levels; for(let i=0;i<d.length;i+=4){ d[i]=Math.round(Math.floor(d[i]/step)*step); d[i+1]=Math.round(Math.floor(d[i+1]/step)*step); d[i+2]=Math.round(Math.floor(d[i+2]/step)*step);} return imgData; }
    _fxSolarize(imgData, amt){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ for(let c=0;c<3;c++){ const v=d[i+c]; d[i+c] = v>128 ? Math.round(v*(1-amt)) : Math.round(v + (255-v)*amt); } } return imgData; }
    _fxVignette(imgData, amt){ const w=this.canvas.width,h=this.canvas.height; const cx=w/2, cy=h/2; const maxR=Math.sqrt(cx*cx+cy*cy); const d=imgData.data; for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ const idx=(y*w+x)*4; const dist=Math.sqrt((x-cx)**2+(y-cy)**2)/maxR; const v=Math.max(0, Math.min(1, 1 - dist*amt)); d[idx]=Math.round(d[idx]*v); d[idx+1]=Math.round(d[idx+1]*v); d[idx+2]=Math.round(d[idx+2]*v); } } return imgData; }
    _fxHueRotate(imgData, deg){ return this._fxHueSaturation(imgData, deg, 0); }
    _fxSaturate(imgData, s){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255; const l=0.299*r+0.587*g+0.114*b; const nr=l+(r-l)*s, ng=l+(g-l)*s, nb=l+(b-l)*s; d[i]=Math.round(Math.max(0,Math.min(1,nr))*255); d[i+1]=Math.round(Math.max(0,Math.min(1,ng))*255); d[i+2]=Math.round(Math.max(0,Math.min(1,nb))*255);} return imgData; }
    _fxBrightness(imgData, gain){ const d=imgData.data; const clamp=(v)=>Math.max(0,Math.min(255,v)); for(let i=0;i<d.length;i+=4){ d[i]=clamp(Math.round(d[i]*gain)); d[i+1]=clamp(Math.round(d[i+1]*gain)); d[i+2]=clamp(Math.round(d[i+2]*gain)); } return imgData; }
    _fxContrast(imgData, c){ const d=imgData.data; for(let i=0;i<d.length;i+=4){ for(let cidx=0;cidx<3;cidx++){ const v=d[i+cidx]/255; const nv=0.5+(v-0.5)*c; d[i+cidx]=Math.round(Math.max(0,Math.min(1,nv))*255); } } return imgData; }
    _fxEmboss(imgData, amt){ return this._fxConvolve(imgData, [ -2, -1, 0, -1, 1, 1, 0, 1, 2 ], amt); }
    _fxSharpen(imgData, amt){ return this._fxConvolve(imgData, [ 0, -1, 0, -1, 5, -1, 0, -1, 0 ], amt); }
    _fxBlur(imgData, amt){ const k=Math.max(1, Math.round(amt*3)); const size=k*2+1; const val=1/(size*size); const kernel=new Array(size*size).fill(val); return this._fxConvolve(imgData, kernel, amt); }
    _fxConvolve(imgData, kernel, amt){ try { if (amt<=0) return imgData; const w=this.canvas.width,h=this.canvas.height; const out=new ImageData(new Uint8ClampedArray(imgData.data), w, h); const src=imgData.data, dst=out.data; const kw=Math.round(Math.sqrt(kernel.length)); const kwh=kw>>1; for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ let r=0,g=0,b=0; for(let ky=-kwh;ky<=kwh;ky++){ for(let kx=-kwh;kx<=kwh;kx++){ const ix=Math.max(0,Math.min(w-1,x+kx)); const iy=Math.max(0,Math.min(h-1,y+ky)); const idx=(iy*w+ix)*4; const kval=kernel[(ky+kwh)*kw+(kx+kwh)]; r+=src[idx]*kval; g+=src[idx+1]*kval; b+=src[idx+2]*kval; } } const oidx=(y*w+x)*4; dst[oidx]=Math.round(src[oidx]*(1-amt) + r*amt); dst[oidx+1]=Math.round(src[oidx+1]*(1-amt) + g*amt); dst[oidx+2]=Math.round(src[oidx+2]*(1-amt) + b*amt); } } return out; } catch (_e) { return imgData; } }
    _fxHueSaturation(imgData, hueDeg, sat){ const d=imgData.data; const rad=(hueDeg||0)*Math.PI/180; const cos=Math.cos(rad), sin=Math.sin(rad); for(let i=0;i<d.length;i+=4){ let r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255; // convert to YIQ, rotate hue, back to RGB
            const y=0.299*r+0.587*g+0.114*b; let iC=0.596*r-0.274*g-0.322*b; let q=0.211*r-0.523*g+0.312*b; const inew=iC*cos - q*sin; const qnew=iC*sin + q*cos; r=y + 0.956*inew + 0.621*qnew; g=y - 0.272*inew - 0.647*qnew; b=y - 1.105*inew + 1.702*qnew; // saturation boost
            const l=0.299*r+0.587*g+0.114*b; r=l+(r-l)*(1+sat); g=l+(g-l)*(1+sat); b=l+(b-l)*(1+sat);
            d[i]=Math.round(Math.max(0,Math.min(1,r))*255); d[i+1]=Math.round(Math.max(0,Math.min(1,g))*255); d[i+2]=Math.round(Math.max(0,Math.min(1,b))*255); }
        return imgData; }

    _parseCubeLUT(text) {
        try {
            const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
            let size3D = null, size1D = null; let domainMin = 0, domainMax = 1; const table3D=[]; const table1D=[];
            let mode = null; // '1D'|'3D'
            for (const ln of lines){
                const [key, ...rest] = ln.split(/\s+/);
                if (key === 'LUT_3D_SIZE') { size3D = parseInt(rest[0],10); mode = '3D'; continue; }
                if (key === 'LUT_1D_SIZE') { size1D = parseInt(rest[0],10); mode = '1D'; continue; }
                if (key === 'DOMAIN_MIN') { domainMin = parseFloat(rest[0]); continue; }
                if (key === 'DOMAIN_MAX') { domainMax = parseFloat(rest[0]); continue; }
                // data rows
                if (mode === '3D') {
                    const parts = ln.split(/\s+/).map(Number); if (parts.length>=3) table3D.push(parts[0],parts[1],parts[2]);
                } else if (mode === '1D') {
                    const parts = ln.split(/\s+/).map(Number); if (parts.length>=3) table1D.push(parts[0]); // simplistic: use R only
                }
            }
            if (size3D && table3D.length >= size3D*size3D*size3D*3) return { type:'3D', size:size3D, table: table3D, domainMin, domainMax };
            if (size1D && table1D.length >= size1D) return { type:'1D', size:size1D, table: table1D, domainMin, domainMax };
        } catch (_e) {}
        return null;
    }

    _builtinLUT(name) {
        if (!name) return null;
        // Minimal presets (soft Kodak-like warm vs cool)
        if (name === 'kodak-warm-1d') {
            // warm highlight lift + midtone warmth curve
            const size=256; const t = new Array(size).fill(0).map((_,i)=>{
                const v=i/255; const lifted = Math.min(1, v*1.08); const curve = 0.5 + (lifted-0.5)*1.12; return curve;
            });
            return { type:'1D', size, table: t, domainMin:0, domainMax:1 };
        }
        if (name === 'cool-contrast-1d') {
            const size=256; const t = new Array(size).fill(0).map((_,i)=>{ const v=i/255; const c=1.18; return Math.min(1, Math.max(0, 0.5 + (v-0.5)*c)); });
            return { type:'1D', size, table: t, domainMin:0, domainMax:1 };
        }
        // Additional approximations
        if (name === 'bmfilm-soft-1d') {
            const size=256; const t = new Array(size).fill(0).map((_,i)=>{
                const v=i/255; const mid = 0.5 + (v-0.5)*0.9; const hl = Math.min(1, mid*0.98 + 0.02); return hl;
            });
            return { type:'1D', size, table: t, domainMin:0, domainMax:1 };
        }
        if (name === 'panasonic-vlog-warm-1d') {
            const size=256; const t = new Array(size).fill(0).map((_,i)=>{
                const v=i/255; const s = 0.5 + (v-0.5)*1.05; const sc = 0.5 + (s-0.5)*(0.95 - 0.05*Math.cos(v*Math.PI)); return Math.min(1, Math.max(0, sc));
            });
            return { type:'1D', size, table: t, domainMin:0, domainMax:1 };
        }
        return null;
    }

    _renderFilmOverlay() {
        // Generate an overlay bitmap based on base composite (excluding Film layer)
        const w=this.canvas.width, h=this.canvas.height;
        const off = document.createElement('canvas'); off.width=w; off.height=h; const ctx=off.getContext('2d');
        ctx.clearRect(0,0,w,h);
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,w,h);

        // Composite all layers except Film into a temp canvas, respecting transforms
        const base = document.createElement('canvas'); base.width=w; base.height=h; const bctx=base.getContext('2d');
        const layers = this.layerManager.getLayers?.() || [];
        for (const layer of layers) {
            if (!layer.visible) continue;
            if (layer.metadata?.type === 'film') continue;
            bctx.save();
            bctx.globalAlpha = typeof layer.opacity === 'number' ? layer.opacity : 1;
            bctx.globalCompositeOperation = this._mapBlendMode(layer.blend_mode);
            const t = (layer.metadata && layer.metadata.transform) ? this._normTransform(layer.metadata.transform) : null;
            const applyTransform = t && layer.metadata?.type !== 'text' && layer.id !== 'layer_background';
            let translateOnly = false;
            if (applyTransform) {
                translateOnly = (t.angle === 0 && t.sx === 1 && t.sy === 1);
                if (translateOnly) {
                    bctx.translate(t.dx, t.dy);
                } else {
                    const origin = { x: w/2, y: h/2 };
                    bctx.translate(origin.x, origin.y);
                    bctx.translate(t.dx, t.dy);
                    if (t.angle) bctx.rotate(t.angle);
                    if (t.sx !== 1 || t.sy !== 1) bctx.scale(t.sx, t.sy);
                }
            }
            if (layer.metadata?.type === 'text' && layer.metadata?.text) {
                const prevCtx = this.ctx; this.ctx = bctx; this._drawTextLayer(layer); this.ctx = prevCtx;
            } else {
                const cached = this.imageCache.get(layer.id);
                if (cached?.image?.complete) {
                    if (applyTransform) {
                        const iw = cached.image.naturalWidth || cached.image.width;
                        const ih = cached.image.naturalHeight || cached.image.height;
                        if (translateOnly) bctx.drawImage(cached.image, 0, 0); else bctx.drawImage(cached.image, -iw/2, -ih/2, iw, ih);
                    } else {
                        bctx.drawImage(cached.image, 0, 0, w, h);
                    }
                } else if (layer.bitmap) {
                    const image = new Image(); image.src = layer.bitmap;
                    if (applyTransform) {
                        const iw = image.naturalWidth || image.width;
                        const ih = image.naturalHeight || image.height;
                        if (translateOnly) bctx.drawImage(image, 0, 0); else bctx.drawImage(image, -iw/2, -ih/2, iw, ih);
                    } else {
                        bctx.drawImage(image, 0, 0, w, h);
                    }
                } else if (layer.id === 'layer_background') {
                    const fill = layer.metadata?.backgroundColor ?? '#101318';
                    bctx.fillStyle = fill; bctx.fillRect(0,0,w,h);
                }
            }
            bctx.restore();
        }
        const comp = bctx.getImageData(0,0,w,h);
        let overlay = new ImageData(new Uint8ClampedArray(comp.data), w, h);
        // Damage effect removed; keep grain and LUT only
        if (this.film.grain.enabled) overlay = this._applyFilmGrain(overlay);
        if (this.film.lut.enabled) overlay = this._applyFilmLUT(overlay);
        ctx.putImageData(overlay, 0, 0);
        return off.toDataURL('image/png');
    }

    _onPointerCancel(event) {
        if (IAMCCS_VECTOR_TOOLS.has(this.maskManager.activeTool)) {
            return;
        }
        if (!this.isDrawing) {
            return;
        }
        if (event.pointerId != null && event.pointerId !== this.activePointerId) {
            return;
        }
        this.canvas.releasePointerCapture?.(this.activePointerId);
        this._abortStroke();
    }

    _ensureLiveSurface(layer) {
        if (!this.liveLayerCanvas) {
            this.liveLayerCanvas = document.createElement("canvas");
            this.liveLayerCanvas.width = this.canvas.width;
            this.liveLayerCanvas.height = this.canvas.height;
            this.liveLayerCtx = this.liveLayerCanvas.getContext("2d", { desynchronized: true });
        }

        debugTrace('[GoyaRenderer] ensureLiveSurface:start', {
            layerId: layer?.id || null,
            layerName: layer?.name || null,
            hasBitmap: !!layer?.bitmap,
            bitmapPrefix: typeof layer?.bitmap === 'string' ? layer.bitmap.slice(0, 32) : null,
            paintToMask: !!(this.maskManager.isPaintToMask?.() || false),
            cachedImage: !!this.imageCache.get(layer?.id)?.image,
        });

        const paintToMask = this.maskManager.isPaintToMask?.() || false;
        
        // Clear and reload based on mode and layer content
        if (paintToMask) {
            // In paint-to-mask mode: clear first, then load existing mask for this layer
            this.liveLayerCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            // Initialize with existing mask content if any
            const cachedMask = this.maskCache.get(layer.id);
            if (cachedMask?.image && this._isDrawableImage(cachedMask.image)) {
                this._drawImageAtNativeSize(this.liveLayerCtx, cachedMask.image);
                return;
            }
            if (layer.mask) {
                const mimg = new Image();
                mimg.src = layer.mask;
                if (!mimg.complete) {
                    mimg.onload = () => {
                        if (this.liveLayerCtx) {
                            this._drawImageAtNativeSize(this.liveLayerCtx, mimg);
                            this._requestRender();
                        }
                    };
                }
                if (mimg.complete) {
                    this._drawImageAtNativeSize(this.liveLayerCtx, mimg);
                }
                this.maskCache.set(layer.id, { image: mimg, src: layer.mask });
            }
            return;
        }

        const cached = this.imageCache.get(layer.id);
        if (cached?.image?.complete) {
            this._drawImageAtNativeSize(this.liveLayerCtx, cached.image);
            debugTrace('[GoyaRenderer] ensureLiveSurface:from-cache', {
                layerId: layer.id,
                cacheSrcPrefix: typeof cached.src === 'string' ? cached.src.slice(0, 32) : null,
            });
            return;
        }

        if (layer.bitmap) {
            const image = new Image();
            image.src = layer.bitmap;
            if (!image.complete) {
                image.onload = () => {
                    if (this.liveLayerCtx) {
                        this._drawImageAtNativeSize(this.liveLayerCtx, image);
                        this._requestRender();
                    }
                };
            }
            if (image.complete) {
                this._drawImageAtNativeSize(this.liveLayerCtx, image);
            }
        } else if (layer.id === "layer_background") {
            const fill = layer.metadata?.backgroundColor ?? "#101318";
            this.liveLayerCtx.fillStyle = fill;
            this.liveLayerCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        debugTrace('[GoyaRenderer] ensureLiveSurface:end', {
            layerId: layer?.id || null,
            liveCanvasReady: !!this.liveLayerCanvas,
        });
    }

    _isIdentityTransform(transform) {
        const t = this._normTransform(transform || {});
        return t.dx === 0 && t.dy === 0 && t.sx === 1 && t.sy === 1 && t.angle === 0;
    }

    _bakeLayerTransformForEditing(layer) {
        if (!layer || layer.id === "layer_background" || layer.metadata?.type === "text") {
            return layer;
        }
        const transform = this._normTransform(layer.metadata?.transform || {});
        if (this._isIdentityTransform(transform)) {
            return layer;
        }
        const source = this._getLayerHitTestImage(layer);
        if (!source || !this._isDrawableImage(source)) {
            return layer;
        }

        const baked = document.createElement("canvas");
        baked.width = this.canvas.width;
        baked.height = this.canvas.height;
        const ctx = baked.getContext("2d", { desynchronized: true });
        if (!ctx) {
            return layer;
        }

        const width = source.naturalWidth || source.width || this.canvas.width;
        const height = source.naturalHeight || source.height || this.canvas.height;
        const translateOnly = transform.angle === 0 && transform.sx === 1 && transform.sy === 1;
        ctx.save();
        if (translateOnly) {
            ctx.translate(transform.dx, transform.dy);
            ctx.drawImage(source, 0, 0, width, height);
        } else {
            const originX = this.canvas.width / 2;
            const originY = this.canvas.height / 2;
            ctx.translate(originX, originY);
            ctx.translate(transform.dx, transform.dy);
            if (transform.angle) ctx.rotate(transform.angle);
            if (transform.sx !== 1 || transform.sy !== 1) ctx.scale(transform.sx, transform.sy);
            ctx.drawImage(source, -width / 2, -height / 2, width, height);
        }
        ctx.restore();

        const dataUrl = baked.toDataURL("image/png");
        const image = new Image();
        image.src = dataUrl;
        if (!image.complete) {
            image.onload = () => this._requestRender();
        }
        this.imageCache.set(layer.id, { image, src: dataUrl });
        this.layerManager.updateLayer({
            id: layer.id,
            patch: {
                bitmap: dataUrl,
                metadata: {
                    ...(layer.metadata || {}),
                    transform: { dx: 0, dy: 0, sx: 1, sy: 1, angle: 0 },
                },
            },
        });
        return this.layerManager.getLayerById?.(layer.id) || layer;
    }

    _getSafeStrokeBrush(tool = this.strokeTool) {
        const isEraser = tool === "eraser";
        const source = isEraser
            ? (this.maskManager.getEraserBrushSettings?.() || this.maskManager.getBrushSettings?.() || {})
            : (this.maskManager.getBrushSettings?.() || {});
        const fallbackSize = tool === "pencil" ? 8 : isEraser ? 32 : 48;
        const size = Number(source.size);
        const opacity = Number(source.opacity);
        const hardness = Number(source.hardness);
        return {
            ...source,
            brush: source.brush || tool || "brush",
            size: Math.max(1, Math.min(256, Math.round(Number.isFinite(size) ? size : fallbackSize))),
            opacity: Number.isFinite(opacity) ? Math.max(0.05, Math.min(1, opacity)) : 1,
            hardness: Number.isFinite(hardness) ? Math.max(0, Math.min(1, hardness)) : (tool === "pencil" ? 1 : 0.75),
            color: typeof source.color === "string" && source.color.trim() ? source.color : "#ffffff",
        };
    }

    _getStrokeBaseSize() {
        const fallbackSize = this.strokeTool === "pencil" ? 8 : this.strokeTool === "eraser" ? 32 : 48;
        const size = Number(this.baseBrush?.size);
        return Math.max(1, Number.isFinite(size) ? size : fallbackSize);
    }

    _strokePoint(point, pressure, isInitial) {
        if (!this.liveLayerCtx || !this.baseBrush) {
            return;
        }
        // Adjust point if layer previously had a transform baked mid-session (defensive): metadata.transform should be identity after bake.
        // If a non-identity transform slipped through, map stroke point by inverse transform so drawing aligns visually.
        const layer = this.layerManager.getActiveLayer?.();
        const t = this._normTransform(layer?.metadata?.transform || {});
        if (t.dx !== 0 || t.dy !== 0 || t.sx !== 1 || t.sy !== 1 || t.angle !== 0) {
            point = this._mapPointToLiveLayer(point, t);
        }
        const ctx = this.liveLayerCtx;
        const baseSize = this._getStrokeBaseSize();
        const hardness = typeof this.baseBrush.hardness === "number" ? this.baseBrush.hardness : 1;
        const opacity = typeof this.baseBrush.opacity === "number" ? this.baseBrush.opacity : 1;
        const safePressure = Math.max(0.05, pressure);
        const paintToMask = this.maskManager.isPaintToMask?.() || false;
        const pixelPencil = this.strokeTool === 'pencil' && !paintToMask && baseSize <= 1.25;

        if (isInitial || !this.lastPoint) {
            this.lastPoint = point;
            this.lastMidpoint = point;
            this._drawStrokeDotAt(ctx, point.x, point.y, this._getStrokeSize(safePressure, pixelPencil), this._getStrokeAlpha(safePressure, hardness, opacity, pixelPencil));
            this.strokeMoved = true;
            return;
        }

        const distance = Math.hypot(point.x - this.lastPoint.x, point.y - this.lastPoint.y);
        const spacing = pixelPencil ? 0.5 : Math.max(0.5, baseSize * 0.15);
        if (distance < spacing * 0.5) {
            return;
        }

        const steps = Math.max(1, Math.ceil(distance / spacing));
        for (let index = 1; index <= steps; index += 1) {
            const tStep = index / steps;
            const x = this.lastPoint.x + (point.x - this.lastPoint.x) * tStep;
            const y = this.lastPoint.y + (point.y - this.lastPoint.y) * tStep;
            this._drawStrokeDotAt(
                ctx,
                x,
                y,
                this._getStrokeSize(safePressure, pixelPencil),
                this._getStrokeAlpha(safePressure, hardness, opacity, pixelPencil)
            );
        }

        this.strokeMoved = true;
        this.lastMidpoint = point;
        this.lastPoint = point;
    }

    _getStrokeSize(pressure = 1, pixelPencil = false) {
        if (pixelPencil) return 1;
        const baseSize = this._getStrokeBaseSize();
        if (this.strokeTool === 'eraser') return baseSize * 2;
        const safePressure = Math.max(0.05, Number(pressure) || 1);
        return Math.max(0.5, baseSize * (0.3 + safePressure * 0.7));
    }

    _getStrokeAlpha(pressure = 1, hardness = 1, opacity = 1, pixelPencil = false) {
        if (pixelPencil) return Math.min(1, Math.max(0.05, opacity));
        const safePressure = Math.max(0.05, Number(pressure) || 1);
        return Math.min(1, Math.max(0.05, opacity * safePressure * hardness));
    }

    _renderTapStroke(point) {
        if (!this.liveLayerCtx || !this.baseBrush || !point) {
            return;
        }
        const baseSize = this._getStrokeBaseSize();
        const hardness = typeof this.baseBrush.hardness === "number" ? this.baseBrush.hardness : 1;
        const opacity = typeof this.baseBrush.opacity === "number" ? this.baseBrush.opacity : 1;
        const paintToMask = this.maskManager.isPaintToMask?.() || false;
        const pixelPencil = this.strokeTool === 'pencil' && !paintToMask && baseSize <= 1.25;
        const size = pixelPencil ? 1 : this.strokeTool === 'eraser' ? baseSize * 2 : baseSize;
        const alpha = pixelPencil
            ? Math.min(1, Math.max(0.05, opacity))
            : Math.min(1, Math.max(0.05, opacity * hardness));
        this._drawStrokeDotAt(this.liveLayerCtx, point.x, point.y, size, alpha);
    }

    _drawStrokeDotAt(ctx, x, y, size, alpha = 1) {
        if (!ctx || !this.baseBrush) return;
        const paintToMask = this.maskManager.isPaintToMask?.() || false;
        if (this.strokeTool === 'eraser') {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, size) / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return;
        }
        const pixelPencil = this.strokeTool === 'pencil'
            && !paintToMask
            && Math.max(1, Number(this.baseBrush?.size) || 1) <= 1.25;
        if (pixelPencil) {
            const fill = this.baseBrush.color || '#ffffff';
            const fx = Math.floor(x);
            const fy = Math.floor(y);
            const ax = x - fx;
            const ay = y - fy;
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = fill;
            ctx.globalAlpha = alpha * (1 - ax) * (1 - ay);
            ctx.fillRect(fx, fy, 1, 1);
            ctx.globalAlpha = alpha * ax * (1 - ay);
            ctx.fillRect(fx + 1, fy, 1, 1);
            ctx.globalAlpha = alpha * (1 - ax) * ay;
            ctx.fillRect(fx, fy + 1, 1, 1);
            ctx.globalAlpha = alpha * ax * ay;
            ctx.fillRect(fx + 1, fy + 1, 1, 1);
            ctx.restore();
            return;
        }
        this._drawBrushStamp(ctx, x, y, size, alpha, paintToMask ? '#ffffff' : (this.baseBrush.color || '#ffffff'));
    }

    _drawBrushStamp(ctx, x, y, size, alpha, color) {
        const hardness = Math.max(0, Math.min(1, typeof this.baseBrush.hardness === 'number' ? this.baseBrush.hardness : 1));
        const radius = Math.max(0.5, size) / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
        if (hardness >= 0.999) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return;
        }
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const core = hardness * 0.8;
        gradient.addColorStop(0, color);
        gradient.addColorStop(core, color);
        gradient.addColorStop(Math.min(1, core + (1 - core) * 0.5), `rgba(${r}, ${g}, ${b}, 0.45)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _commitStroke() {
        if (!this.isDrawing || !this.liveLayerCanvas) {
            this._resetStrokeState();
            return;
        }

        const layer = this.layerManager.getActiveLayer();
        if (!layer) {
            this._resetStrokeState();
            return;
        }

        debugTrace('[GoyaRenderer] commitStroke:start', {
            activeLayerId: layer.id,
            activeLayerName: layer.name,
            paintToMask: !!(this.maskManager.isPaintToMask?.() || false),
            hasBitmapBefore: !!layer.bitmap,
            bitmapPrefixBefore: typeof layer.bitmap === 'string' ? layer.bitmap.slice(0, 32) : null,
        });

        const paintToMask = this.maskManager.isPaintToMask?.() || false;
        const dataUrl = this.liveLayerCanvas.toDataURL("image/png");
        if (paintToMask) {
            // Avoid HTMLImageElement decode stalls between consecutive mask strokes:
            // cache a canvas snapshot (immediately drawable) while still persisting dataUrl in layer state.
            const maskSnapshot = document.createElement("canvas");
            maskSnapshot.width = this.canvas.width;
            maskSnapshot.height = this.canvas.height;
            const mctx = maskSnapshot.getContext("2d", { desynchronized: true });
            try { mctx.drawImage(this.liveLayerCanvas, 0, 0, this.canvas.width, this.canvas.height); } catch (_e) {}
            this.maskCache.set(layer.id, { image: maskSnapshot, src: dataUrl });
            this.layerManager.updateLayer({ id: layer.id, patch: { mask: dataUrl } });
        } else {
            this._updateBitmapLayerFromDataUrl(layer.id, dataUrl, this.liveLayerCanvas);
        }

        debugTrace('[GoyaRenderer] commitStroke:end', {
            activeLayerId: layer.id,
            committedPrefix: dataUrl.slice(0, 32),
        });

        this._resetStrokeState();
        this._requestRender();
        this.eventBus.emit("canvas:stroke:finished");
    }

    _abortStroke() {
        const hadTransformSession = this._hasTransformSession();
        this._resetStrokeState();
        this._requestRender();
        if (hadTransformSession) {
            this.eventBus.emit("canvas:transform:end");
        }
    }

    _resetStrokeState() {
        this.isDrawing = false;
        this.activePointerId = null;
        this.strokeTool = null;
        this.baseBrush = null;
        this.lastPoint = null;
        this.lastMidpoint = null;
        this.strokeMoved = false;
        if (this.liveLayerCtx) {
            this.liveLayerCtx.setTransform(1, 0, 0, 1, 0, 0);
        }
        this.liveLayerCanvas = null;
        this.liveLayerCtx = null;
        this.transformSession = null;
        this._liqLayer = null;
        this.lassoPoints = [];
        this.lassoFill = false;
        // Reset any temporary vector flags if used
        this.vectorPoints = [];
        this.vectorFill = false;
        this.vectorIsAdding = false;
    }

    _getLayerSurfaceSnapshot(layerId = null) {
        const targetLayerId = layerId || this.layerManager.getActiveLayerId?.() || null;
        if (!targetLayerId) {
            return null;
        }
        const layer = (this.layerManager.getLayers?.() || []).find((entry) => entry?.id === targetLayerId) || null;
        if (!layer) {
            return null;
        }
        const snapshot = document.createElement('canvas');
        snapshot.width = this.canvas.width;
        snapshot.height = this.canvas.height;
        const ctx = snapshot.getContext('2d', { desynchronized: true });
        if (!ctx) {
            return null;
        }

        const cached = this.imageCache.get(layer.id);
        let source = null;
        if (cached?.image && this._isDrawableImage(cached.image)) {
            source = cached.image;
        } else if (cached?.decodedImage && this._isDrawableImage(cached.decodedImage)) {
            source = cached.decodedImage;
        } else if (layer.bitmap) {
            const image = new Image();
            image.src = layer.bitmap;
            if (this._isDrawableImage(image)) {
                source = image;
            } else if (!image.complete) {
                image.onload = () => this._requestRender();
            }
        }

        if (source) {
            const transform = this._normTransform(layer.metadata?.transform || {});
            const width = source.naturalWidth || source.width || snapshot.width;
            const height = source.naturalHeight || source.height || snapshot.height;
            const translateOnly = transform.angle === 0 && transform.sx === 1 && transform.sy === 1;
            if (this._isIdentityTransform(transform)) {
                this._drawImageAtNativeSize(ctx, source);
            } else {
                ctx.save();
                if (translateOnly) {
                    ctx.translate(transform.dx, transform.dy);
                    ctx.drawImage(source, 0, 0, width, height);
                } else {
                    const originX = this.canvas.width / 2;
                    const originY = this.canvas.height / 2;
                    ctx.translate(originX, originY);
                    ctx.translate(transform.dx, transform.dy);
                    if (transform.angle) ctx.rotate(transform.angle);
                    if (transform.sx !== 1 || transform.sy !== 1) ctx.scale(transform.sx, transform.sy);
                    ctx.drawImage(source, -width / 2, -height / 2, width, height);
                }
                ctx.restore();
            }
        } else if (layer.id === 'layer_background') {
            const fill = layer.metadata?.backgroundColor ?? '#101318';
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, snapshot.width, snapshot.height);
        }
        return snapshot;
    }

    _commitVectorCanvas(payload = {}) {
        const layerId = payload.layerId || this.layerManager.getActiveLayer?.()?.id || null;
        const sourceCanvas = payload.sourceCanvas || payload.canvas || null;
        const replaceBitmap = payload.replaceBitmap === true;
        if (!layerId || !sourceCanvas) return;
        let layer = (this.layerManager.getLayers?.() || []).find((entry) => entry?.id === layerId) || null;
        if (!layer) return;
        debugTrace('[GoyaRenderer] commitVectorCanvas:start', {
            payloadLayerId: layerId,
            payloadKind: payload.kind || null,
            activeLayerIdNow: this.layerManager.getActiveLayerId?.() || null,
            layerName: layer.name,
            hasBitmapBefore: !!layer.bitmap,
        });
        layer = this._bakeLayerTransformForEditing(layer);
        if (replaceBitmap) {
            const dataUrl = sourceCanvas.toDataURL('image/png');
            this._updateBitmapLayerFromDataUrl(layer.id, dataUrl, sourceCanvas);
            debugTrace('[GoyaRenderer] commitVectorCanvas:base-merge', {
                layerId: layer.id,
                baseSource: 'sourceCanvas',
                hasCachedImage: !!this.imageCache.get(layer.id)?.image,
                cachedDrawable: !!(this.imageCache.get(layer.id)?.image && this._isDrawableImage(this.imageCache.get(layer.id).image)),
                hasLayerBitmap: !!layer.bitmap,
            });
            debugTrace('[GoyaRenderer] commitVectorCanvas:end', {
                committedLayerId: layer.id,
                committedPrefix: dataUrl.slice(0, 32),
            });
            this._requestRender();
            this.eventBus.emit('canvas:stroke:finished');
            return;
        }
        const merged = document.createElement('canvas');
        merged.width = this.canvas.width;
        merged.height = this.canvas.height;
        const ctx = merged.getContext('2d', { desynchronized: true });
        if (!ctx) return;
        const cached = this.imageCache.get(layer.id);
        let baseSource = 'none';
        if (cached?.image && this._isDrawableImage(cached.image)) {
            this._drawImageAtNativeSize(ctx, cached.image);
            baseSource = 'imageCache';
        } else if (layer.bitmap) {
            const base = new Image();
            base.src = layer.bitmap;
            if (base.complete) {
                this._drawImageAtNativeSize(ctx, base);
                baseSource = 'layer.bitmap';
            }
        }
        debugTrace('[GoyaRenderer] commitVectorCanvas:base-merge', {
            layerId: layer.id,
            baseSource,
            hasCachedImage: !!cached?.image,
            cachedDrawable: !!(cached?.image && this._isDrawableImage(cached.image)),
            hasLayerBitmap: !!layer.bitmap,
        });
        ctx.drawImage(sourceCanvas, 0, 0);
        const dataUrl = merged.toDataURL("image/png");
        this._updateBitmapLayerFromDataUrl(layer.id, dataUrl, merged);
        debugTrace('[GoyaRenderer] commitVectorCanvas:end', {
            committedLayerId: layer.id,
            committedPrefix: dataUrl.slice(0, 32),
        });
        this._requestRender();
        this.eventBus.emit("canvas:stroke:finished");
    }

    _updateBitmapLayerFromDataUrl(layerId, dataUrl, sourceCanvas = null) {
        let cachedImage = null;
        if (sourceCanvas) {
            try {
                const snapshot = document.createElement('canvas');
                snapshot.width = this.canvas.width;
                snapshot.height = this.canvas.height;
                const sctx = snapshot.getContext('2d', { desynchronized: true });
                sctx?.drawImage(sourceCanvas, 0, 0, snapshot.width, snapshot.height);
                cachedImage = snapshot;
            } catch (_e) {}
        }
        const image = new Image();
        image.src = dataUrl;
        if (!image.complete) {
            image.onload = () => this._requestRender();
        }
        this.imageCache.set(layerId, { image: cachedImage || image, src: dataUrl, decodedImage: image });
        debugTrace('[GoyaRenderer] updateBitmapLayerFromDataUrl', {
            layerId,
            cacheKind: cachedImage ? 'canvas-snapshot' : 'html-image',
            dataPrefix: dataUrl.slice(0, 32),
        });
        this.layerManager.updateLayer({ id: layerId, patch: { bitmap: dataUrl } });
    }

    async bakeLayerBitmapOnWhite(layerId = null) {
        const targetId = layerId || this.layerManager.getActiveLayerId?.();
        if (!targetId) {
            return false;
        }

        const layer = (this.layerManager.getLayers?.() || []).find((entry) => entry?.id === targetId) || null;
        if (!layer || !layer.bitmap || layer.id === 'layer_background' || layer?.metadata?.source?.type === 'import') {
            return false;
        }

        const source = new Image();
        source.src = layer.bitmap;
        if (!source.complete) {
            try {
                await new Promise((resolve, reject) => {
                    source.onload = resolve;
                    source.onerror = reject;
                });
            } catch (_e) {
                return false;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        const ctx = canvas.getContext('2d', { desynchronized: true });
        if (!ctx) {
            return false;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, source.naturalWidth || source.width || canvas.width, source.naturalHeight || source.height || canvas.height);

        const dataUrl = canvas.toDataURL('image/png');
        const image = new Image();
        image.src = dataUrl;
        if (!image.complete) {
            image.onload = () => this._requestRender();
        }
        this.imageCache.set(layer.id, { image, src: dataUrl });
        this.layerManager.updateLayer({
            id: layer.id,
            patch: {
                bitmap: dataUrl,
                metadata: {
                    ...(layer.metadata || {}),
                    easyWhiteBase: true,
                    easyDrawSurface: 'baked-white',
                },
            },
        });
        this._requestRender();
        return true;
    }

    _syncImageCache(layers) {
        const keep = new Set();
        for (const layer of layers) {
            keep.add(layer.id);
            if (!layer.bitmap) {
                this.imageCache.delete(layer.id);
            } else {
            const cached = this.imageCache.get(layer.id);
            if (cached?.src === layer.bitmap) {
                // ok
            } else {
                const image = new Image();
                image.src = layer.bitmap;
                if (!image.complete) {
                    image.onload = () => this._requestRender();
                }
                this.imageCache.set(layer.id, { image, src: layer.bitmap });
            }
            }

            // Sync mask cache as well
            if (!layer.mask) {
                console.log(`[MASK SYNC] Layer ${layer.id}: No mask, deleting from cache`);
                this.maskCache.delete(layer.id);
            } else {
                console.log(`[MASK SYNC] Layer ${layer.id}: Has mask, src=${layer.mask.substring(0,50)}...`);
                const cachedMask = this.maskCache.get(layer.id);
                const cachedDrawable = !!(cachedMask?.image && this._isDrawableImage(cachedMask.image));
                console.log(`[MASK SYNC] Layer ${layer.id}: cachedDrawable=${cachedDrawable}, needsUpdate=${cachedMask?.src !== layer.mask}`);

                // If we already have a drawable cached snapshot (canvas), keep it to avoid
                // HTMLImageElement decode stalls between consecutive strokes or during state races.
                // If layer.mask changes, decode the new mask in the background and swap when ready.
                if (cachedDrawable && cachedMask?.src !== layer.mask) {
                    console.log(`[MASK SYNC] Layer ${layer.id}: Updating drawable cache with new mask`);
                    try {
                        const mimg = new Image();
                        mimg.src = layer.mask;
                        const commitLoaded = () => {
                            try {
                                const maskSnapshot = document.createElement("canvas");
                                maskSnapshot.width = this.canvas.width;
                                maskSnapshot.height = this.canvas.height;
                                const mctx = maskSnapshot.getContext("2d", { desynchronized: true });
                                try { mctx.drawImage(mimg, 0, 0, this.canvas.width, this.canvas.height); } catch (_e) {}
                                this.maskCache.set(layer.id, { image: maskSnapshot, src: layer.mask });
                                console.log(`[MASK SYNC] Layer ${layer.id}: Cache updated with canvas snapshot`);
                                this._requestRender();
                            } catch (_e) {
                                // keep previous drawable cache
                                console.log(`[MASK SYNC] Layer ${layer.id}: Failed to create snapshot, keeping old cache`);
                            }
                        };
                        if (!mimg.complete) {
                            mimg.onload = commitLoaded;
                        } else {
                            commitLoaded();
                        }
                    } catch (_e) {
                        // keep previous drawable cache
                        console.log(`[MASK SYNC] Layer ${layer.id}: Exception during mask update`);
                    }
                } else if (!cachedDrawable && cachedMask?.src !== layer.mask) {
                    console.log(`[MASK SYNC] Layer ${layer.id}: Creating initial Image() cache`);
                    const mimg = new Image();
                    mimg.src = layer.mask;
                    if (!mimg.complete) {
                        mimg.onload = () => {
                            console.log(`[MASK SYNC] Layer ${layer.id}: Image loaded`);
                            this._requestRender();
                        };
                    }
                    this.maskCache.set(layer.id, { image: mimg, src: layer.mask });
                } else {
                    console.log(`[MASK SYNC] Layer ${layer.id}: Cache up-to-date, no action needed`);
                }
            }
        }

        for (const key of this.imageCache.keys()) {
            if (!keep.has(key)) {
                this.imageCache.delete(key);
            }
        }
        for (const key of this.maskCache.keys()) {
            if (!keep.has(key)) {
                this.maskCache.delete(key);
            }
        }
    }

    _requestColorPreviewRender() {
        if (this._colorPreviewTimer) return;
        this._colorPreviewTimer = setTimeout(() => {
            this._colorPreviewTimer = null;
            this._requestRender();
        }, 50);
    }

    _requestRender() {
        if (this.renderScheduled) {
            return;
        }
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            this.render();
        });
    }

    _requestStrokeRender(force = false) {
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (force || now - this._lastImmediateStrokeRenderAt > 8) {
            this._lastImmediateStrokeRenderAt = now;
            this.renderScheduled = false;
            this.render();
            return;
        }
        this._requestRender();
    }

    _ensureWritableLayer() {
        return this.toolTargetResolver.resolveWritableLayer();
    }

    _resolveTransformLayerAtPoint(point) {
        const picked = this.pickLayerAtPoint?.(point) || null;
        if (picked && !picked.locked && picked.id !== "layer_background") {
            this.layerManager.selectLayer?.(picked.id);
            return picked;
        }
        return this.toolTargetResolver.resolveTransformLayer?.() || null;
    }

    _drawTextRectPreview() {
        // Draw a dashed rectangle on live layer canvas as preview
        if (!this.textDragRect) return;
        if (!this.liveLayerCanvas) {
            this.liveLayerCanvas = document.createElement("canvas");
            this.liveLayerCanvas.width = this.canvas.width;
            this.liveLayerCanvas.height = this.canvas.height;
            this.liveLayerCtx = this.liveLayerCanvas.getContext("2d", { desynchronized: true });
        }
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.strokeStyle = "#ffb703";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        const r = this.textDragRect;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
        ctx.restore();
    }

    _drawTextLayer(layer) {
        const t = layer.metadata?.text;
        if (!t) return;
        const rect = t.rect || { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
        const ctx = this.ctx;
        ctx.save();
        const weight = t.bold ? "bold" : "normal";
        const style = t.italic ? "italic" : "normal";
        const fontSize = Math.max(6, t.size || 24);
        ctx.font = `${style} ${weight} ${fontSize}px ${t.font || 'Arial'}`;
        ctx.fillStyle = (this.maskManager.getBrushSettings?.().color) || "#ffffff";
        ctx.textAlign = (t.align || 'left');
        ctx.textBaseline = "top";
        // Multi-line wrap
        const words = String(t.value || "").split(/\s+/);
        let line = "";
        const lines = [];
        const maxWidth = rect.w - 8;
        for (let i = 0; i < words.length; i++) {
            const test = line ? line + " " + words[i] : words[i];
            const w2 = ctx.measureText(test).width;
            if (w2 > maxWidth && line) {
                lines.push(line);
                line = words[i];
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        const lineHeight = Math.round(fontSize * 1.3);
        const x = t.align === 'center' ? rect.x + rect.w / 2 : t.align === 'right' ? rect.x + rect.w - 4 : rect.x + 4;
        let y = rect.y + 4;
        for (const l of lines) {
            if (y + lineHeight > rect.y + rect.h) break;
            ctx.fillText(l, x, y);
            if (t.underline) {
                const w2 = ctx.measureText(l).width;
                const ux = t.align === 'center' ? x - w2/2 : t.align === 'right' ? x - w2 : x;
                ctx.fillRect(ux, y + fontSize + 2, w2, 1);
            }
            y += lineHeight;
        }
        ctx.restore();
    }

    _onDoubleClick(event) {
        // Text tool disabled (stability priority)
        return;

        // Find topmost text layer under cursor
        const p = this._getCanvasPoint(event);
        const layers = this.layerManager.getLayers?.() || [];
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            if (layer.metadata?.type === 'text') {
                const r = layer.metadata?.text?.rect;
                if (r && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h) {
                    this.eventBus.emit('text:edit:start', { layerId: layer.id, rect: r, text: layer.metadata?.text?.value || '', style: layer.metadata?.text || {} });
                    break;
                }
            }
        }
    }

    _updateTransform(point) {
        const session = this._getTransformSession();
        if (!this.liveLayerCtx || !session) return;
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const bounds = session.currentBounds || session.sourceBounds || { x: 0, y: 0, w, h };
        const origin = session.origin || { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
        const start = session.start || origin;
        const mode = session.mode;
        let dx = point.x - start.x;
        let dy = point.y - start.y;
        let sx = 1;
        let sy = 1;
        let angle = 0;
        let ax = 0;
        let ay = 0;
        let tx = 0;
        let ty = 0;
        if (mode === "move") {
            if (this.snapEnabled) {
                const step = this.snapSettings.moveStep || 10;
                dx = Math.round(dx / step) * step;
                dy = Math.round(dy / step) * step;
            }
            tx = dx;
            ty = dy;
        } else if (mode === "scale" || String(mode).startsWith('scale-')) {
            const preview = this._computeScalePreview(mode, dx, dy, session);
            sx = preview.sx;
            sy = preview.sy;
            ax = preview.ax;
            ay = preview.ay;
            if (this.snapEnabled) {
                const st = this.snapSettings.scaleStep || 0.1;
                const q = (v)=> Math.max(0.1, Math.round(v / st) * st);
                sx = q(sx); sy = q(sy);
            }
        } else if (mode === "rotate") {
            const angCurrent = Math.atan2(point.y - origin.y, point.x - origin.x);
            let delta = angCurrent - session.rotateStartAngle;
            while (delta > Math.PI) delta -= 2*Math.PI;
            while (delta < -Math.PI) delta += 2*Math.PI;
            if (this.snapEnabled) {
                const astep = this.snapSettings.angleStep || (Math.PI/12);
                const total = session.rotateBaseAngle + delta;
                const snapped = Math.round(total / astep) * astep;
                angle = snapped - session.rotateBaseAngle;
            } else {
                angle = delta;
            }
        }
        const preview = {
            dx: mode === 'move' ? dx : 0,
            dy: mode === 'move' ? dy : 0,
            sx,
            sy,
            angle,
            ax,
            ay,
            originX: origin.x,
            originY: origin.y,
        };
        const baseMatrix = TransformMath.toMatrix(session.baseTransform || {}, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
        const previewMatrix = TransformMath.toMatrix(preview, {
            originX: origin.x,
            originY: origin.y,
        });
        const totalMatrix = TransformMath.multiplyMatrices(previewMatrix, baseMatrix);
        ctx.setTransform(totalMatrix.a, totalMatrix.b, totalMatrix.c, totalMatrix.d, totalMatrix.e, totalMatrix.f);
        ctx.drawImage(session.snapshot, session.snapshotX || 0, session.snapshotY || 0);
        const effectiveTransform = this._normTransform(TransformMath.fromMatrix(totalMatrix, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        }));
        const previewBounds = TransformMath.transformBoundsWithMatrix(session.sourceBounds || bounds, totalMatrix);
        this.transformSession = { ...session, preview, effectiveTransform, previewBounds, totalMatrix };
        this.eventBus.emit("canvas:transform:preview", {
            mode,
            layerId: session.layerId,
            bounds: previewBounds ? { ...previewBounds } : null,
            baseBounds: session.sourceBounds ? { ...session.sourceBounds } : null,
            transform: { ...effectiveTransform },
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
    }

    _commitTransform() {
        const session = this._getTransformSession();
        if (!this.liveLayerCanvas) { this._resetStrokeState(); return; }
        const layer = this.layerManager.getLayerById?.(session?.layerId) || this.layerManager.getActiveLayer();
        if (!layer) { this._resetStrokeState(); return; }
        const nextTransform = this._normTransform(session?.effectiveTransform || layer.metadata?.transform || {});
        this.layerManager.updateLayer({ id: layer.id, patch: { metadata: { ...layer.metadata, transform: nextTransform } } });
        this._resetStrokeState();
        this._requestRender();
        if (this._ghostEl) this._ghostEl.style.display = 'none';
        this.eventBus.emit("canvas:transform:end");
    }

    _drawLassoPreview() {
        if (!this.liveLayerCtx || !this.lassoPoints?.length) return;
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // Draw underlying current bitmap so previous lassos remain visible
        const layer = this.layerManager.getActiveLayer?.();
        const cached = layer ? this.imageCache.get(layer.id) : null;
        if (cached?.image?.complete) {
            ctx.drawImage(cached.image, 0, 0, w, h);
        }
        ctx.save();
        ctx.strokeStyle = "#00ffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const first = this.lassoPoints[0];
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < this.lassoPoints.length; i++) {
            const p = this.lassoPoints[i];
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    _commitLasso() {
        if (!this.liveLayerCanvas) { this._resetStrokeState(); return; }
        const layer = this.layerManager.getActiveLayer();
        if (!layer) { this._resetStrokeState(); return; }
        const opts = this.maskManager.getLassoOptions?.() || { autoclose: true };
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // Draw over the current image content
        const cached = this.imageCache.get(layer.id);
        if (cached?.image?.complete) {
            ctx.drawImage(cached.image, 0, 0, w, h);
        }
        // Build path
        ctx.save();
        ctx.beginPath();
        const pts = this.lassoPoints || [];
        if (!pts.length) { this._resetStrokeState(); return; }
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (opts.autoclose) ctx.closePath();
        if (this.lassoFill) {
            const color = (this.maskManager.getBrushSettings?.().color) || "#ffffff";
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            const color = (this.maskManager.getBrushSettings?.().color) || "#ffffff";
            const lset = this.maskManager.getLassoBrushSettings?.() || {};
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, lset.size || 1);
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
        }
        ctx.restore();
        const dataUrl = this.liveLayerCanvas.toDataURL("image/png");
        const image = new Image(); image.src = dataUrl; if (!image.complete) image.onload = () => this._requestRender();
        this.imageCache.set(layer.id, { image, src: dataUrl });
        this.layerManager.updateLayer({ id: layer.id, patch: { bitmap: dataUrl } });
        this._resetStrokeState();
        this._requestRender();
        this.eventBus.emit("canvas:stroke:finished");
    }

    _drawVectorPreview() {
        if (!this.liveLayerCtx) return;
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // draw underlying image
        const layer = this.layerManager.getActiveLayer?.();
        const cached = layer ? this.imageCache.get(layer.id) : null;
        if (cached?.image?.complete) {
            ctx.drawImage(cached.image, 0, 0, w, h);
        }
        if (this.vectorPoints.length === 0) return;
        ctx.save();
        ctx.strokeStyle = "#00ffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const pts = this.vectorPoints;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const seg = pts[i];
            if (seg.type === "quad" && typeof seg.cx === "number") {
                ctx.quadraticCurveTo(seg.cx, seg.cy, seg.x, seg.y);
            } else {
                ctx.lineTo(seg.x, seg.y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    _commitVector() {
        if (!this.liveLayerCanvas || !this.vectorPoints.length) { this._resetStrokeState(); return; }
        const layer = this.layerManager.getActiveLayer?.();
        if (!layer) { this._resetStrokeState(); return; }
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const cached = this.imageCache.get(layer.id);
        if (cached?.image?.complete) ctx.drawImage(cached.image, 0, 0, w, h);

        const color = (this.maskManager.getBrushSettings?.().color) || "#ffffff";
        const vset = this.maskManager.getVectorBrushSettings?.() || {};
        const width = Math.max(1, vset.size || 1);
        const opts = this.maskManager.getVectorOptions?.() || { autoclose: true };

        ctx.save();
        ctx.beginPath();
        const pts = this.vectorPoints;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const seg = pts[i];
            if (seg.type === "quad" && typeof seg.cx === "number") {
                ctx.quadraticCurveTo(seg.cx, seg.cy, seg.x, seg.y);
            } else {
                ctx.lineTo(seg.x, seg.y);
            }
        }
        if (opts.autoclose) ctx.closePath();
        if (this.vectorFill) {
            ctx.fillStyle = color;
            ctx.fill();
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
        }
        ctx.restore();

        const dataUrl = this.liveLayerCanvas.toDataURL("image/png");
        const image = new Image(); image.src = dataUrl; if (!image.complete) image.onload = () => this._requestRender();
        this.imageCache.set(layer.id, { image, src: dataUrl });
        this.layerManager.updateLayer({ id: layer.id, patch: { bitmap: dataUrl } });
        this._resetStrokeState();
        this._requestRender();
        this.eventBus.emit("canvas:stroke:finished");
    }

    _performFill(point) {
        if (!this.liveLayerCtx) return;
        const ctx = this.liveLayerCtx;
        const w = this.canvas.width, h = this.canvas.height;
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const px = Math.floor(point.x);
        const py = Math.floor(point.y);
        if (px < 0 || py < 0 || px >= w || py >= h) return;
        const seed = this._findFillSeed(data, w, h, px, py);
        if (!seed) return;
        const idx = (seed.y * w + seed.x) * 4;
        const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
        const fillColorHex = (this.maskManager.getBrushSettings?.().color) || "#ffffff";
        const fill = this._hexToRgba(fillColorHex, 255);
        if (this._colorsEqual(target, fill)) return;
        const { pixels } = this._collectFillRegion(data, w, h, seed.x, seed.y, target);
        if (!pixels.length) return;
        for (const p of pixels) {
            const i = p * 4;
            data[i] = fill[0];
            data[i + 1] = fill[1];
            data[i + 2] = fill[2];
            data[i + 3] = fill[3];
        }
        ctx.putImageData(imgData, 0, 0);
    }

    _matchesFillTarget(rgba, target) {
        if (target[3] <= 16) {
            return rgba[3] <= 16 && this._colorsNear(rgba, target, 10, 16);
        }
        return this._colorsNear(rgba, target, 12, 12);
    }

    _collectFillRegion(data, w, h, startX, startY, target) {
        const visited = new Uint8Array(w * h);
        const queue = [];
        const pixels = [];
        let touchesEdge = false;
        const matchesTarget = (rgba) => {
            if (target[3] <= 16) {
                return rgba[3] <= 16 && this._colorsNear(rgba, target, 10, 16);
            }
            return this._colorsNear(rgba, target, 12, 12);
        };
        const push = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const p = y * w + x;
            if (visited[p]) return;
            const i = p * 4;
            const c = [data[i], data[i + 1], data[i + 2], data[i + 3]];
            if (matchesTarget(c)) {
                visited[p] = 1;
                queue.push(p);
            }
        };
        push(startX, startY);
        while (queue.length) {
            const p = queue.pop();
            const x = p % w, y = (p / w) | 0;
            if (x === 0 || y === 0 || x === (w - 1) || y === (h - 1)) {
                touchesEdge = true;
            }
            pixels.push(p);
            push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
        }
        return { pixels, touchesEdge };
    }

    _findFillSeed(data, w, h, px, py) {
        const currentIndex = (py * w + px) * 4;
        const current = [data[currentIndex], data[currentIndex + 1], data[currentIndex + 2], data[currentIndex + 3]];
        if (current[3] <= 16) {
            return { x: px, y: py };
        }

        for (let radius = 1; radius <= 12; radius += 1) {
            for (let oy = -radius; oy <= radius; oy += 1) {
                for (let ox = -radius; ox <= radius; ox += 1) {
                    const x = px + ox;
                    const y = py + oy;
                    if (x < 0 || y < 0 || x >= w || y >= h) continue;
                    const i = (y * w + x) * 4;
                    const candidate = [data[i], data[i + 1], data[i + 2], data[i + 3]];
                    if (candidate[3] > 16) continue;
                    const region = this._collectFillRegion(data, w, h, x, y, candidate);
                    if (region.pixels.length && !region.touchesEdge) {
                        return { x, y };
                    }
                }
            }
        }

        return { x: px, y: py };
    }

    _hexToRgba(hex, a = 255) {
        const h = hex.replace('#', '');
        const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return [r, g, b, a];
    }

    _colorsEqual(a, b) {
        return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }

    _colorsNear(a, b, rgbTolerance = 0, alphaTolerance = rgbTolerance) {
        return Math.abs(a[0] - b[0]) <= rgbTolerance
            && Math.abs(a[1] - b[1]) <= rgbTolerance
            && Math.abs(a[2] - b[2]) <= rgbTolerance
            && Math.abs(a[3] - b[3]) <= alphaTolerance;
    }

    _getCanvasPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
        };
    }

    _resolvePressure(event) {
        if (typeof event.pressure === "number" && event.pressure > 0) {
            return event.pressure;
        }
        return 1;
    }

    _midPoint(a, b) {
        return {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        };
    }

    _nearPoint(a, b, threshold = 10) {
        if (!a || !b) return false;
        const dx = a.x - b.x, dy = a.y - b.y;
        return (dx * dx + dy * dy) <= threshold * threshold;
    }

    _mapBlendMode(mode) {
        const supported = new Set([
            "normal",
            "multiply",
            "screen",
            "overlay",
            "darken",
            "lighten",
            "color-dodge",
            "color-burn",
            "hard-light",
            "soft-light",
        ]);
        return supported.has(mode) ? mode : "source-over";
    }

    _imageOutsideCanvas(t, iw, ih) {
        try {
            const w = this.canvas.width, h = this.canvas.height;
            const origin = { x: w/2, y: h/2 };
            const pts = [
                {x:0,y:0},{x:iw,y:0},{x:iw,y:ih},{x:0,y:ih}
            ].map(p=>{
                let x=p.x, y=p.y;
                if (t.angle) { const ca=Math.cos(t.angle), sa=Math.sin(t.angle); const rx=x*ca - y*sa; const ry=x*sa + y*ca; x=rx; y=ry; }
                x *= (t.sx||1); y *= (t.sy||1);
                if (t.angle || (t.sx&&t.sx!==1) || (t.sy&&t.sy!==1)) { x += origin.x; y += origin.y; }
                x += (t.dx||0); y += (t.dy||0);
                return {x,y};
            });
            return pts.some(c => c.x<0 || c.y<0 || c.x>w || c.y>h);
        } catch (_e) { return false; }
    }

    _ensureGhostElement() {
        if (this._ghostEl) return this._ghostEl;
        const el = document.createElement('img');
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.5';
        el.style.willChange = 'transform, opacity';
        // Anchor around center of the main canvas; we will apply a CSS matrix
        // that works in raw canvas coordinates, independent of zoom.
        el.style.transformOrigin = '0 0';
        el.style.display = 'none';

        // Attach to global overlay so it is not clipped by canvas/container.
        const globalOverlay = document.getElementById('goya-global-overlay');
        const host = globalOverlay || document.body;
        if (getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
        }
        host.appendChild(el);
        this._ghostEl = el;
        return el;
    }

    _syncGhostOverlayIfNeeded(t, imageEl, layer) {
        const el = this._ensureGhostElement();
        const tag = layer.bitmap || imageEl.currentSrc || imageEl.src;
        if (el._srcTag !== tag) {
            el._srcTag = tag;
            el.src = tag;
        }
        const m = this._toCssMatrix(t);
        el.style.transform = `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
        el.style.display = 'block';
    }

    _toCssMatrix(t) {
        // Map canvas-space transform (around canvas center) into CSS matrix
        // in screen space. We compute everything in raw canvas units and then
        // place the ghost so that (0,0) of canvas maps to the canvas element's
        // top-left on screen.
        const rect = this.canvas.getBoundingClientRect();
        const w = this.canvas.width, h = this.canvas.height;
        const cx = w / 2, cy = h / 2;
        const sx = t.sx || 1, sy = t.sy || 1;
        const ang = t.angle || 0;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const a = sx * cos;
        const b = sx * sin;
        const c = -sy * sin;
        const d = sy * cos;

        // We want: screenPos = M * canvasPos, with canvasPos in [0,w]x[0,h].
        // Base mapping from canvas to screen is rect + scaling used by CanvasView
        // (rect.width/height vs canvas width/height). Compute that scale:
        const scaleX = rect.width / w;
        const scaleY = rect.height / h;

        // Combine canvas->local (centered, transformed) and local->screen.
        // First apply rotate/scale around center in canvas units, then add dx,dy,
        // then map to screen with scale and rect offsets.

        // Effective matrix in canvas units
        const m11 = a;
        const m12 = b;
        const m21 = c;
        const m22 = d;
        // Translation in canvas units that keeps center fixed then applies dx,dy
        const txCanvas = (t.dx || 0) + cx - (m11 * cx + m21 * cy);
        const tyCanvas = (t.dy || 0) + cy - (m12 * cx + m22 * cy);

        // Now scale to screen space and add rect offsets; since we are putting
        // the img at (left:0,top:0) of the global overlay with matrix, we bake
        // rect.left/top into e,f.
        const a2 = m11 * scaleX;
        const b2 = m12 * scaleY;
        const c2 = m21 * scaleX;
        const d2 = m22 * scaleY;
        const e2 = rect.left + txCanvas * scaleX;
        const f2 = rect.top + tyCanvas * scaleY;

        return { a: a2, b: b2, c: c2, d: d2, e: e2, f: f2 };
    }

    _composePreviewTransform(layer, session = this._getTransformSession()) {
        return this._normTransform(session?.effectiveTransform || layer?.metadata?.transform || {});
    }

    clearTransientState() {
        this._resetStrokeState();
        if (this._ghostEl) this._ghostEl.style.display = 'none';
        this._requestRender();
    }

    _normTransform(t) {
        const out = TransformMath.normalize(t || {});
        return {
            dx: out.dx,
            dy: out.dy,
            sx: out.sx,
            sy: out.sy,
            angle: out.angle,
        };
    }

    _composeTransforms(a, b) {
        const composed = TransformMath.compose(a, b);
        return {
            dx: composed.dx,
            dy: composed.dy,
            sx: composed.sx,
            sy: composed.sy,
            angle: composed.angle,
        };
    }

    _inverseTransform(t) {
        const inverse = TransformMath.inverse(t);
        return {
            dx: inverse.dx,
            dy: inverse.dy,
            sx: inverse.sx,
            sy: inverse.sy,
            angle: inverse.angle,
        };
    }

    _applyInverse(point, inv) {
        return TransformMath.applyInverse(point, inv);
    }

    _mapPointToLiveLayer(point, transform) {
        return TransformMath.mapPointToLayer(point, transform, {
            originX: this.canvas.width / 2,
            originY: this.canvas.height / 2,
        });
    }

    _mapPointToLayerInput(point, layer) {
        const transform = this._normTransform(layer?.metadata?.transform || {});
        if (transform.dx === 0 && transform.dy === 0 && transform.sx === 1 && transform.sy === 1 && transform.angle === 0) {
            return point;
        }
        return this._mapPointToLiveLayer(point, transform);
    }

    pickLayerAtPoint(point) {
        const layers = (this.layerManager.getLayers?.() || []).slice().reverse();
        for (const layer of layers) {
            if (!layer || !layer.visible || layer.id === 'layer_background') {
                continue;
            }
            const image = this._getLayerHitTestImage(layer);
            if (!image || !this._isDrawableImage(image)) {
                continue;
            }
            const localPoint = this._mapCanvasPointToLayer(point, layer, image);
            if (!localPoint) {
                continue;
            }
            if (this._sampleImageAlpha(image, localPoint.x, localPoint.y) > 0) {
                return layer;
            }
        }
        return null;
    }


    _getLayerHitTestImage(layer) {
        if (layer?.id === this.activeLayerId && this.liveLayerCanvas) {
            return this.liveLayerCanvas;
        }
        const cached = this.imageCache.get(layer?.id);
        if (cached?.image && this._isDrawableImage(cached.image)) {
            return cached.image;
        }
        if (typeof layer?.bitmap === 'string' && layer.bitmap) {
            const image = new Image();
            image.src = layer.bitmap;
            if (this._isDrawableImage(image)) {
                this.imageCache.set(layer.id, { image, src: layer.bitmap });
                return image;
            }
        }
        return null;
    }

    _mapCanvasPointToLayer(point, layer, image) {
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (width <= 0 || height <= 0) {
            return null;
        }
        const transform = this._normTransform(layer?.metadata?.transform || {});
        if (transform.dx || transform.dy || transform.sx !== 1 || transform.sy !== 1 || transform.angle) {
            const centeredPoint = {
                x: point.x - this.canvas.width / 2,
                y: point.y - this.canvas.height / 2,
            };
            const mapped = TransformMath.mapPointToLayer(point, transform, {
                originX: this.canvas.width / 2,
                originY: this.canvas.height / 2,
            });
            const local = { x: mapped.x + width / 2 - this.canvas.width / 2, y: mapped.y + height / 2 - this.canvas.height / 2 };
            if (local.x < 0 || local.y < 0 || local.x >= width || local.y >= height) {
                return null;
            }
            return local;
        }
        if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
            return null;
        }
        return point;
    }

    _sampleImageAlpha(image, x, y) {
        try {
            const width = image.naturalWidth || image.width || 0;
            const height = image.naturalHeight || image.height || 0;
            if (width <= 0 || height <= 0) {
                return 0;
            }
            if (!this._hitTestCanvas) {
                this._hitTestCanvas = document.createElement('canvas');
                this._hitTestCtx = this._hitTestCanvas.getContext('2d', { willReadFrequently: true });
            }
            this._hitTestCanvas.width = width;
            this._hitTestCanvas.height = height;
            this._hitTestCtx.clearRect(0, 0, width, height);
            this._hitTestCtx.drawImage(image, 0, 0, width, height);
            return this._hitTestCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] || 0;
        } catch (_e) {
            return 0;
        }
    }

    _ensureOverlaySurface() {
        if (!this._maskOverlayCanvas) {
            this._maskOverlayCanvas = document.createElement("canvas");
            this._maskOverlayCanvas.width = this.canvas.width;
            this._maskOverlayCanvas.height = this.canvas.height;
            this._maskOverlayCtx = this._maskOverlayCanvas.getContext("2d", { desynchronized: true });
        }
        return this._maskOverlayCtx;
    }

    _drawMaskOverlayFromImage(maskImage) {
        console.log(`[MASK RENDER] _drawMaskOverlayFromImage called, maskImage type=${maskImage.constructor.name}`);
        const overlayColor = this.maskManager.getOverlayStyle?.().color || "rgba(255, 0, 0, 0.35)";
        const ctx = this._ensureOverlaySurface();
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Cleared _maskOverlayCanvas`);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.drawImage(maskImage, 0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Drew maskImage onto _maskOverlayCanvas`);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = overlayColor;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Applied red overlay on _maskOverlayCanvas`);
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.drawImage(this._maskOverlayCanvas, 0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Drew _maskOverlayCanvas onto main canvas (source-over)`);
        this.ctx.restore();
    }

    _drawMaskOverlayFromCanvas(maskCanvas) {
        console.log(`[MASK RENDER] _drawMaskOverlayFromCanvas called`);
        const overlayColor = this.maskManager.getOverlayStyle?.().color || "rgba(255, 0, 0, 0.35)";
        const ctx = this._ensureOverlaySurface();
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Cleared _maskOverlayCanvas`);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.drawImage(maskCanvas, 0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Drew maskCanvas onto _maskOverlayCanvas`);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = overlayColor;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        console.log(`[MASK RENDER] Applied red overlay on _maskOverlayCanvas`);
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.drawImage(this._maskOverlayCanvas, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    _drawAllMaskOverlays(layers, { paintToMask, activeLayerId, liveMaskCanvas }) {
        const maskDebug = false;
        const logMask = (...args) => {
            if (maskDebug) console.debug(...args);
        };
        logMask(`[MASK DEBUG] _drawAllMaskOverlays called: paintToMask=${paintToMask}, activeLayerId=${activeLayerId}, isDrawing=${this.isDrawing}, layers.length=${layers.length}`);
        const fallbackOverlayColor = this.maskManager.getOverlayStyle?.().color || "rgba(255, 0, 0, 0.35)";

        // Prepare one overlay canvas and tint each layer mask with its own regional color.
        const overlayCtx = this._ensureOverlaySurface();
        overlayCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        logMask(`[MASK DEBUG] Cleared _maskOverlayCanvas at start (will accumulate all masks)`);
        let hasAccumulatedMask = false;
        const tintCanvas = document.createElement("canvas");
        tintCanvas.width = this.canvas.width;
        tintCanvas.height = this.canvas.height;
        const tintCtx = tintCanvas.getContext("2d", { desynchronized: true });
        if (!tintCtx) return;
        
        try {
            for (const layer of layers) {
                if (!layer || layer.visible === false) {
                    logMask(`[MASK DEBUG] Layer ${layer?.id} skipped: visible=${layer?.visible}`);
                    continue;
                }

                // Resolve mask source for this layer
                let maskSource = null;
                const isActive = layer.id === activeLayerId;
                logMask(`[MASK DEBUG] Layer ${layer.id}: isActive=${isActive}, hasMask=${!!layer.mask}, maskSrc=${layer.mask?.substring(0,50)}...`);
                
                // If this is the active layer and we're actively drawing in paint-to-mask mode, use liveMaskCanvas
                // CRITICAL: Only use liveMaskCanvas when ACTIVELY DRAWING (this.isDrawing === true)
                // Otherwise liveMaskCanvas may contain stale content from previous layer after layer switch
                if (isActive && paintToMask && liveMaskCanvas && this.isDrawing) {
                    // During active drawing, liveMaskCanvas contains the live strokes for THIS layer
                    maskSource = liveMaskCanvas;
                    logMask(`[MASK DEBUG] Layer ${layer.id}: Using liveMaskCanvas (active drawing)`);
                } else if (layer.mask) {
                    // Not actively drawing, or not the active layer: use committed cached mask
                    const cachedMask = this.maskCache.get(layer.id);
                    logMask(`[MASK DEBUG] Layer ${layer.id}: cachedMask exists=${!!cachedMask}, cachedMask.image=${!!cachedMask?.image}, src match=${cachedMask?.src === layer.mask}`);
                    
                    if (cachedMask?.image && this._isDrawableImage(cachedMask.image)) {
                        maskSource = cachedMask.image;
                        logMask(`[MASK DEBUG] Layer ${layer.id}: Using cachedMask.image (drawable)`);
                    } else if (!cachedMask || cachedMask?.src !== layer.mask) {
                        logMask(`[MASK DEBUG] Layer ${layer.id}: Creating new Image() for mask`);
                        const mimg = new Image();
                        mimg.src = layer.mask;
                        if (!mimg.complete) mimg.onload = () => this._requestRender();
                        this.maskCache.set(layer.id, { image: mimg, src: layer.mask });
                        if (this._isDrawableImage(mimg)) {
                            maskSource = mimg;
                            logMask(`[MASK DEBUG] Layer ${layer.id}: Using new mimg (drawable immediately)`);
                        } else {
                            logMask(`[MASK DEBUG] Layer ${layer.id}: mimg not drawable yet, waiting for load`);
                        }
                    }
                }
                
                if (!maskSource) {
                    logMask(`[MASK DEBUG] Layer ${layer.id}: NO maskSource resolved, skipping overlay render`);
                    continue;
                }
                logMask(`[MASK DEBUG] Layer ${layer.id}: maskSource resolved, accumulating onto overlay canvas`);

                tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
                tintCtx.globalCompositeOperation = "source-over";
                tintCtx.globalAlpha = 1;
                tintCtx.drawImage(maskSource, 0, 0, this.canvas.width, this.canvas.height);
                tintCtx.globalCompositeOperation = "source-in";
                tintCtx.fillStyle = this.maskManager.getLayerMaskOverlayStyle?.(layer.id)?.color || fallbackOverlayColor;
                tintCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                overlayCtx.globalCompositeOperation = "source-over";
                overlayCtx.globalAlpha = 1;
                overlayCtx.drawImage(tintCanvas, 0, 0, this.canvas.width, this.canvas.height);
                hasAccumulatedMask = true;
                logMask(`[MASK DEBUG] Layer ${layer.id}: Accumulated mask onto _maskOverlayCanvas`);
            }
            if (!hasAccumulatedMask) {
                logMask(`[MASK DEBUG] No accumulated mask content, skipping overlay draw`);
                return;
            }
            // Finally, copy the accumulated overlay to main canvas ONCE
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.globalAlpha = 1;
            this.ctx.drawImage(this._maskOverlayCanvas, 0, 0, this.canvas.width, this.canvas.height);
            logMask(`[MASK DEBUG] Drew accumulated _maskOverlayCanvas onto main canvas`);
            this.ctx.restore();
        } catch (e) {
            if (maskDebug) console.warn(`[MASK DEBUG] Exception in _drawAllMaskOverlays:`, e);
            // Overlay is non-critical.
        }
    }

    _canvasHasContent(canvas) {
        try {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            // Check if any pixel has non-zero alpha
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) return true;
            }
            return false;
        } catch (_e) {
            return false;
        }
    }
}



