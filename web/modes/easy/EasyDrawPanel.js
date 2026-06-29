/**
 * EasyDrawPanel.js
 * Easy drawing controls for helper-layer and inpaint-mask workflows.
 */

import { bakeLayerBitmapOnWhite, ensureEasyLayer, findEasyLayer, getEasyRoleForMode, layerHasMeaningfulPixels } from './easyLayerRuntime.js';
import { debugTrace } from '../../utils/DebugTrace.js';

const EASY_TRANSFORM_TOOLS = new Set(['cursor', 'move', 'scale', 'rotate']);
const EASY_INPAINT_MASK_COLOR = '#ff3b3b';
const EASY_INPAINT_MASK_OVERLAY = 'rgba(255, 59, 59, 0.42)';
const EASY_DIRECT_PAINT_KEY = 'goya:easy:directPaintOnImage';
const EASY_INPAINT_BRUSH = {
    brush: 'brush',
    opacity: 1,
    softness: 0,
    hardness: 1,
    source: 'easy-inpaint',
};

export default class EasyDrawPanel {
    constructor(container, eventBus, modules) {
        this.container = container;
        this.eventBus = eventBus;
        this.modules = modules;
        this.toolController = modules?.toolController || null;

        this.state = {
            easyMode: 't2i',
            drawOnly: false,
            tool: 'brush',
            vectorShape: 'path',
            vectorFill: Boolean(this.modules?.maskManager?.getVectorOptions?.()?.fill),
            brushColor: '#000000',
            pendingBrushColor: null,
            colorEditing: false,
            brushSize: 32,
            toolPreset: 'brush:soft_paint',
            directPaintOnImage: this._readDirectPaintPreference(),
        };

        this._unsubs = [];
        this._canvasPointerDownHandler = this._handleCanvasPointerDown.bind(this);
        this._bindBusListeners();
        this.render();
        this._bindDomListeners();
        this._bindCanvasListener();
        this._syncCanvasSurface();
        this._emitDirectPaintMode();
    }

    _bindBusListeners() {
        const onModeChange = ({ mode }) => {
            this.state.easyMode = mode || 't2i';
            if (this.state.easyMode === 'inpaint') {
                this.state.tool = 'brush';
                this.state.brushColor = EASY_INPAINT_MASK_COLOR;
                this._ensureIntentLayer();
                this._applyToolState();
            } else if (this.state.easyMode === 'draw') {
                this.state.tool = 'pencil';
                this.state.brushColor = '#000000';
                this.state.brushSize = Math.max(1, Math.round(Number(this.state.brushSize) || 32));
                this.eventBus.emit('canvas:pan:mode', { enabled: false });
                this.eventBus.emit('canvas:mode', { drawOnly: true });
                this._ensureIntentLayer();
                this._applyToolState();
            } else {
                this.eventBus.emit('canvas:pan:mode', { enabled: false });
                this.eventBus.emit('mask:paintMode', { enabled: false });
                this.eventBus.emit('mask:overlay', { enabled: false });
                this.eventBus.emit('mask:overlayStyle', { color: EASY_INPAINT_MASK_OVERLAY });
            }
            this._emitDirectPaintMode();
            this._syncCanvasSurface();
            this.render();
            this._bindDomListeners();
        };
        const onCanvasMode = async ({ drawOnly }) => {
            const wasDrawOnly = this.state.drawOnly;
            this.state.drawOnly = !!drawOnly;
            if (wasDrawOnly && !this.state.drawOnly && this.state.easyMode !== 'inpaint') {
                await this._commitDrawModeSurface();
            }
            if (this.state.drawOnly && this.state.easyMode !== 'inpaint') {
                this.state.tool = 'pencil';
                this.state.brushColor = '#000000';
                this.state.brushSize = Math.max(1, Math.round(Number(this.state.brushSize) || 32));
                this._ensureIntentLayer();
                this._applyToolState();
            }
            if (!this.state.drawOnly && this.state.easyMode !== 'inpaint') {
                this.eventBus.emit('mask:paintMode', { enabled: false });
                this.eventBus.emit('mask:overlay', { enabled: false });
            }
            this._emitDirectPaintMode();
            this._syncCanvasSurface();
            this.render();
            this._bindDomListeners();
        };
        const onLayersChanged = () => {
            this._emitDirectPaintMode();
            if (this._supportsDrawingIntent()) {
                this.render();
                this._bindDomListeners();
            }
        };
        const onToolChange = (toolId) => {
            if (toolId === 'brush') this.state.tool = 'brush';
            if (toolId === 'pencil') this.state.tool = 'pencil';
            if (toolId === 'eraser') this.state.tool = 'erase';
            if (toolId === 'fill') this.state.tool = 'fill';
            if (toolId === 'vector' || toolId === 'vector_fill') this.state.tool = 'vector';
            if (toolId === 'cursor') this.state.tool = 'cursor';
            if (toolId === 'move') this.state.tool = 'move';
            if (toolId === 'scale') this.state.tool = 'scale';
            if (toolId === 'rotate') this.state.tool = 'rotate';
            if (toolId === 'eyedropper') this.state.tool = 'eyedropper';
            if (toolId === 'eraser') {
                this.state.brushSize = Number(this.modules?.maskManager?.getEraserBrushSettings?.()?.size) || this.state.brushSize;
            } else if (toolId === 'vector' || toolId === 'vector_fill') {
                this.state.brushSize = Number(this.modules?.maskManager?.getVectorBrushSettings?.()?.size) || this.state.brushSize;
            } else if (toolId === 'brush' || toolId === 'pencil') {
                this.state.brushSize = Number(this.modules?.maskManager?.getBrushSettings?.()?.size) || this.state.brushSize;
            }
            this._updateToolButtonState();
        };
        const onVectorShape = ({ shape } = {}) => {
            if (['path', 'line', 'rect', 'ellipse'].includes(shape)) {
                this.state.vectorShape = shape;
                this._updateToolButtonState();
            }
        };
        const onBrushUpdate = (payload = {}) => {
            const source = String(payload.source || '').trim().toLowerCase();
            const isBackgroundColorUpdate = source === 'easy-background' || source === 'background-color' || source === 'background';
            if (typeof payload.color === 'string' && payload.color.trim()) {
                if (!isBackgroundColorUpdate) {
                    this.state.brushColor = payload.color.trim();
                    const input = this.container.querySelector('#easy-draw-color');
                    const readout = this.container.querySelector('.easy-draw-panel__color-value');
                    if (input) input.value = this.state.brushColor;
                    if (readout) readout.textContent = this.state.brushColor.toUpperCase();
                }
            }
            if (typeof payload.size === 'number' && Number.isFinite(payload.size)) {
                this.state.brushSize = Math.max(1, Math.round(payload.size));
                const input = this.container.querySelector('#easy-brush-size');
                const readout = this.container.querySelector('#easy-brush-size-value');
                if (input) input.value = String(this.state.brushSize);
                if (readout) readout.textContent = String(this.state.brushSize);
            }
            if (source === 'tool-preset') {
                const presetSelect = this.container.querySelector('#easy-tool-preset');
                if (presetSelect && this.state.toolPreset) {
                    presetSelect.value = this.state.toolPreset;
                }
            }
        };
        const onVectorOptions = (payload = {}) => {
            if (typeof payload.fill === 'boolean') {
                this.state.vectorFill = payload.fill;
                this._updateToolButtonState();
                this.container.querySelector('#easy-vector-fill-btn')?.classList.toggle('active', this.state.vectorFill);
            }
        };
        const onVectorBrush = (payload = {}) => {
            if (typeof payload.size === 'number' && Number.isFinite(payload.size)) {
                this.state.brushSize = Math.max(1, Math.round(payload.size));
                const input = this.container.querySelector('#easy-brush-size');
                const readout = this.container.querySelector('#easy-brush-size-value');
                if (input) input.value = String(this.state.brushSize);
                if (readout) readout.textContent = String(this.state.brushSize);
            }
        };
        const onEraserBrush = (payload = {}) => {
            if (typeof payload.size === 'number' && Number.isFinite(payload.size)) {
                this.state.brushSize = Math.max(1, Math.round(payload.size));
                const input = this.container.querySelector('#easy-brush-size');
                const readout = this.container.querySelector('#easy-brush-size-value');
                if (input) input.value = String(this.state.brushSize);
                if (readout) readout.textContent = String(this.state.brushSize);
            }
        };
        this._unsubs.push(this.eventBus.on('easy:mode:change', onModeChange));
        this._unsubs.push(this.eventBus.on('canvas:mode', onCanvasMode));
        this._unsubs.push(this.eventBus.on('layers:changed', onLayersChanged));
        this._unsubs.push(this.eventBus.on('layer:selected', onLayersChanged));
        this._unsubs.push(this.eventBus.on('tool:change', onToolChange));
        this._unsubs.push(this.eventBus.on('brush:update', onBrushUpdate));
        this._unsubs.push(this.eventBus.on('vector:shape', onVectorShape));
        this._unsubs.push(this.eventBus.on('vector:options', onVectorOptions));
        this._unsubs.push(this.eventBus.on('vector:brush', onVectorBrush));
        this._unsubs.push(this.eventBus.on('eraser:brush', onEraserBrush));
    }

    _bindCanvasListener() {
        const canvasEl = this.modules?.canvasView?.canvas || document.querySelector('#goya-main-canvas');
        if (!canvasEl || this._boundCanvasEl === canvasEl) {
            return;
        }
        if (this._boundCanvasEl) {
            this._boundCanvasEl.removeEventListener('pointerdown', this._canvasPointerDownHandler, true);
        }
        this._boundCanvasEl = canvasEl;
        this._boundCanvasEl.addEventListener('pointerdown', this._canvasPointerDownHandler, true);
    }

    _handleCanvasPointerDown(event) {
        if (EASY_TRANSFORM_TOOLS.has(this.state.tool) || this.state.tool === 'eyedropper') return;
        if (!this._supportsDrawingIntent()) return;
        if (typeof event?.button === 'number' && event.button !== 0) return;
        debugTrace('[EasyDrawPanel] pointerdown:prepare-draw', {
            tool: this.state.tool,
            easyMode: this.state.easyMode,
            drawOnly: this.state.drawOnly,
            activeLayerIdBefore: this.modules?.layerManager?.getActiveLayerId?.() || null,
            activeLayerBefore: this.modules?.layerManager?.getActiveLayer?.()?.name || null,
        });
        this._ensureIntentLayer();
        this._applyToolState();
    }

    _supportsDrawingIntent() {
        return this.state.drawOnly || this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint';
    }

    _getIntentRole() {
        if ((this.state.drawOnly || this.state.easyMode === 'draw') && this.state.easyMode !== 'inpaint') {
            return getEasyRoleForMode('draw');
        }
        return getEasyRoleForMode(this.state.easyMode);
    }

    _getIntentLayer() {
        return findEasyLayer(this.modules?.layerManager, this._getIntentRole());
    }

    _getDrawSurfaceLayer() {
        return findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('draw'));
    }

    _getHelperLayer() {
        return findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('i2i'));
    }

    _readDirectPaintPreference() {
        try {
            return localStorage.getItem(EASY_DIRECT_PAINT_KEY) === '1';
        } catch (_error) {
            return false;
        }
    }

    _setDirectPaintOnImage(enabled) {
        this.state.directPaintOnImage = !!enabled;
        try {
            localStorage.setItem(EASY_DIRECT_PAINT_KEY, this.state.directPaintOnImage ? '1' : '0');
        } catch (_error) {}
        this._emitDirectPaintMode();
    }

    _usesDirectImagePaint() {
        return !!this.state.directPaintOnImage && this.state.easyMode !== 'inpaint';
    }

    _isWritableImageLayer(layer) {
        if (!layer || layer.locked || layer.id === 'layer_background') {
            return false;
        }
        if (typeof layer.bitmap === 'string' && layer.bitmap.startsWith('data:image/')) {
            return true;
        }
        const sourceType = String(layer.metadata?.source?.type || '').toLowerCase();
        return sourceType === 'import' || sourceType === 'easy-final-image';
    }

    _getDirectImageLayer() {
        const layerManager = this.modules?.layerManager;
        const active = layerManager?.getActiveLayer?.() || null;
        if (this._isWritableImageLayer(active)) {
            return active;
        }
        const layers = layerManager?.getLayers?.() || [];
        for (let index = layers.length - 1; index >= 0; index -= 1) {
            const layer = layers[index];
            if (layer?.visible === false) continue;
            if (this._isWritableImageLayer(layer)) {
                return layer;
            }
        }
        return null;
    }

    _emitDirectPaintMode() {
        this.eventBus.emit('tool:target:direct', {
            enabled: this._usesDirectImagePaint(),
            source: 'easy-draw-panel',
        });
    }

    _ensureIntentLayer() {
        if (this._usesDirectImagePaint()) {
            const directLayer = this._getDirectImageLayer();
            if (directLayer) {
                this.modules?.layerManager?.selectLayer?.(directLayer.id);
                this.eventBus.emit('mask:paintMode', { enabled: false });
                this.eventBus.emit('mask:overlay', { enabled: false });
                this.eventBus.emit('mask:overlayStyle', { color: EASY_INPAINT_MASK_OVERLAY });
                this.eventBus.emit('brush:update', { color: this.state.brushColor, size: this.state.brushSize, source: 'easy-draw' });
                debugTrace('[EasyDrawPanel] direct-image-layer:selected', {
                    layerId: directLayer.id,
                    layerName: directLayer.name,
                    tool: this.state.tool,
                });
            }
            return directLayer || null;
        }
        const delegated = this.modules?.renderer?.toolTargetResolver?.ensureEasyManagedLayer?.();
        const role = this._getIntentRole();
        if (!role) return null;
        const name = this.state.easyMode === 'inpaint' ? 'Easy Inpaint Mask' : 'Easy Paint Layer';
        const layer = delegated || ensureEasyLayer(this.modules?.layerManager, role, name);
        if (!layer) return null;

        debugTrace('[EasyDrawPanel] ensure-intent-layer', {
            delegated: !!delegated,
            role,
            resolvedLayerId: layer.id,
            resolvedLayerName: layer.name,
            activeLayerIdBeforeSelect: this.modules?.layerManager?.getActiveLayerId?.() || null,
        });

        if (this.state.easyMode !== 'inpaint') {
            this.modules?.layerManager?.updateLayer?.({
                id: layer.id,
                patch: {
                    metadata: {
                        ...(layer.metadata || {}),
                        easyManaged: true,
                        easyRole: role,
                        easyDrawSurface: (this.state.drawOnly || this.state.easyMode === 'draw') ? 'white' : (layer.metadata?.easyDrawSurface || 'transparent'),
                    },
                },
            });
        }

        this.modules?.layerManager?.moveToTop?.(layer.id);
        this.modules?.layerManager?.selectLayer?.(layer.id);
        debugTrace('[EasyDrawPanel] ensure-intent-layer:selected', {
            selectedLayerId: this.modules?.layerManager?.getActiveLayerId?.() || null,
            selectedLayerName: this.modules?.layerManager?.getActiveLayer?.()?.name || null,
            tool: this.state.tool,
        });
        if (this.state.easyMode === 'inpaint') {
            const maskBrushSize = Math.max(1, Math.round(Number(this.state.brushSize) || 32));
            this.state.brushSize = maskBrushSize;
            if (this.state.tool !== 'erase') {
                this.state.tool = 'brush';
            }
            this.eventBus.emit('mask:paintMode', { enabled: true });
            this.eventBus.emit('mask:overlay', { enabled: true });
            this.state.brushColor = EASY_INPAINT_MASK_COLOR;
            this.eventBus.emit('mask:overlayStyle', { color: EASY_INPAINT_MASK_OVERLAY });
            if (this.state.tool === 'erase') {
                this.eventBus.emit('eraser:brush', { size: maskBrushSize, softness: 0, hardness: 1, source: 'easy-inpaint' });
                this.eventBus.emit('tool:change', 'eraser');
            } else {
                this.eventBus.emit('brush:update', { ...EASY_INPAINT_BRUSH, color: EASY_INPAINT_MASK_COLOR, size: maskBrushSize, source: 'easy-mask' });
                this.eventBus.emit('tool:change', 'brush');
            }
        } else {
            this.eventBus.emit('mask:paintMode', { enabled: false });
            this.eventBus.emit('mask:overlay', { enabled: false });
            this.eventBus.emit('mask:overlayStyle', { color: EASY_INPAINT_MASK_OVERLAY });
            const brushKind = this.state.tool === 'pencil' ? 'pencil' : 'brush';
            this.eventBus.emit('brush:update', { brush: brushKind, color: this.state.brushColor, size: this.state.brushSize, source: 'easy-draw' });
        }
        return layer;
    }

    async _commitDrawModeSurface() {
        const layer = this._getIntentLayer();
        const surfaceKind = String(layer?.metadata?.easyDrawSurface || '');
        if (!layer || !layer.bitmap || (surfaceKind !== 'white' && surfaceKind !== 'baked-white')) {
            return false;
        }

        const canvasEl = this.modules?.canvasView?.canvas || document.querySelector('#goya-main-canvas');
        const width = Number(canvasEl?.width) || Number(this.modules?.layerManager?.canvasWidth) || 1024;
        const height = Number(canvasEl?.height) || Number(this.modules?.layerManager?.canvasHeight) || 1024;
        return bakeLayerBitmapOnWhite(this.modules?.layerManager, layer.id, { width, height });
    }

    _syncCanvasSurface() {
        const canvasEl = this.modules?.canvasView?.canvas || document.querySelector('#goya-main-canvas');
        if (!canvasEl) return;

        if (!this._originalCanvasBackgroundColorCaptured) {
            this._originalCanvasBackgroundColor = canvasEl.style.backgroundColor || '';
            this._originalCanvasBackgroundColorCaptured = true;
        }

        const drawSurface = this.state.drawOnly || this.state.easyMode === 'draw';
        canvasEl.classList.toggle('goya-main-canvas--draw-surface', drawSurface);
        canvasEl.style.backgroundColor = drawSurface
            ? '#ffffff'
            : this._originalCanvasBackgroundColor;
    }

    _getSurfaceStatus() {
        if (!this._supportsDrawingIntent()) {
            return {
                title: 'Drawing inactive',
                detail: 'Enable Draw Mode, Image to Image, or Inpaint to paint on the shared canvas.',
                ready: false,
            };
        }

        const drawLayer = this._getDrawSurfaceLayer();
        const helperLayer = this._getHelperLayer();
        const drawReady = layerHasMeaningfulPixels(drawLayer, 'draw');
        const helperReady = layerHasMeaningfulPixels(helperLayer, 'i2i');

        if (this._usesDirectImagePaint()) {
            const directLayer = this._getDirectImageLayer();
            return {
                title: directLayer ? 'Direct Image Paint' : 'Select image layer',
                detail: directLayer
                    ? `Drawing directly on ${directLayer.name || 'selected image'}.`
                    : 'Select or import an unlocked image layer before painting directly.',
                ready: !!directLayer,
            };
        }

        if (this.state.drawOnly || this.state.easyMode === 'draw') {
            return {
                title: drawLayer ? 'Easy Draw Surface' : 'No draw surface yet',
                detail: drawLayer
                    ? (drawReady
                        ? `Dedicated white draw surface ready.${helperReady ? ' I2I helper stays separate.' : ''}`
                        : 'Start sketching on the white surface. Generate will use this as Draw reference.')
                    : 'The white draw surface is created when you start drawing.',
                ready: !!drawLayer,
            };
        }

        const layer = this._getIntentLayer();
        const ready = !!layer;
        const hasPixels = layerHasMeaningfulPixels(layer, this.state.easyMode);
        if (this.state.easyMode === 'inpaint') {
            return {
                title: ready ? layer.name : 'No mask layer yet',
                detail: ready
                    ? (hasPixels ? 'Mask ready on the shared canvas.' : 'Start painting to define the mask.')
                    : 'The mask layer is created when you start drawing.',
                ready,
            };
        }

        return {
            title: ready ? 'Easy I2I Helper' : 'No helper layer yet',
            detail: ready
                ? (hasPixels
                    ? `Helper drawing ready for Image to Image.${drawReady ? ' Draw surface remains separate.' : ''}`
                    : 'Start sketching guides or structure for Image to Image.')
                : 'The helper layer is created when you start drawing.',
            ready,
        };
    }

    render() {
        const drawingEnabled = this._supportsDrawingIntent();
        const isMaskMode = this.state.easyMode === 'inpaint';
        const surface = this._getSurfaceStatus();
        const showColor = drawingEnabled;
        const colorLabel = this.state.easyMode === 'inpaint' ? 'Mask Color:' : 'Color:';
        const stagedColor = this._normalizeHexColor(this.state.colorEditing ? (this.state.pendingBrushColor || this.state.brushColor) : this.state.brushColor);
        const directPaintActive = this._usesDirectImagePaint();
        const directPaintDisabled = !drawingEnabled || this.state.easyMode === 'inpaint';
        const panelTitle = isMaskMode ? 'Mask' : 'Draw';
        const toolPresetOptions = isMaskMode
            ? `
                        <option value="brush:detail" ${this.state.toolPreset === 'brush:detail' ? 'selected' : ''}>Mask Brush</option>
                        <option value="eraser:hard" ${this.state.toolPreset === 'eraser:hard' ? 'selected' : ''}>Mask Erase</option>
                    `
            : `
                        <option value="brush:soft_paint" ${this.state.toolPreset === 'brush:soft_paint' ? 'selected' : ''}>Brush - Soft Paint</option>
                        <option value="brush:detail" ${this.state.toolPreset === 'brush:detail' ? 'selected' : ''}>Brush - Detail</option>
                        <option value="pencil:sketch" ${this.state.toolPreset === 'pencil:sketch' ? 'selected' : ''}>Pencil - Sketch</option>
                        <option value="pencil:pixel" ${this.state.toolPreset === 'pencil:pixel' ? 'selected' : ''}>Pencil - Pixel</option>
                        <option value="eraser:hard" ${this.state.toolPreset === 'eraser:hard' ? 'selected' : ''}>Eraser - Hard</option>
                        <option value="eraser:soft" ${this.state.toolPreset === 'eraser:soft' ? 'selected' : ''}>Eraser - Soft</option>
                        <option value="fill:solid" ${this.state.toolPreset === 'fill:solid' ? 'selected' : ''}>Fill - Solid</option>
                    `;
        const toolButtons = isMaskMode
            ? `
                    <button class="easy-draw-tool-btn ${this.state.tool === 'brush' ? 'active' : ''}" data-tool="brush" ${drawingEnabled ? '' : 'disabled'}>
                        Mask Brush
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'erase' ? 'active' : ''}" data-tool="erase" ${drawingEnabled ? '' : 'disabled'}>
                        Erase Mask
                    </button>
                `
            : `
                    <button class="easy-draw-tool-btn ${this.state.tool === 'brush' ? 'active' : ''}" data-tool="brush" ${drawingEnabled ? '' : 'disabled'}>
                        Brush
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'pencil' ? 'active' : ''}" data-tool="pencil" ${drawingEnabled ? '' : 'disabled'}>
                        Pencil
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'erase' ? 'active' : ''}" data-tool="erase" ${drawingEnabled ? '' : 'disabled'}>
                        Erase
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'fill' ? 'active' : ''}" data-tool="fill" ${drawingEnabled ? '' : 'disabled'}>
                        Fill
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'vector' && this.state.vectorShape === 'path' ? 'active' : ''}" data-tool="vector" data-shape="path" ${drawingEnabled ? '' : 'disabled'}>
                        Path
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'vector' && this.state.vectorShape === 'line' ? 'active' : ''}" data-tool="vector" data-shape="line" ${drawingEnabled ? '' : 'disabled'}>
                        Line
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'vector' && this.state.vectorShape === 'rect' ? 'active' : ''}" data-tool="vector" data-shape="rect" ${drawingEnabled ? '' : 'disabled'}>
                        Rect
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'vector' && this.state.vectorShape === 'ellipse' ? 'active' : ''}" data-tool="vector" data-shape="ellipse" ${drawingEnabled ? '' : 'disabled'}>
                        Circle
                    </button>
                    <button class="easy-draw-tool-btn ${this.state.tool === 'eyedropper' ? 'active' : ''}" data-tool="eyedropper" ${drawingEnabled ? '' : 'disabled'}>
                        Pick
                    </button>
                `;
        const drawNote = drawingEnabled
            ? (directPaintActive
                ? 'Paint is applied to the selected image layer.'
                : 'The first stroke creates the working layer automatically.')
            : 'Enable Draw, Image to Image, or Inpaint to draw.';

        this.container.innerHTML = `
            <div class="easy-draw-panel ${isMaskMode ? 'easy-draw-panel--mask' : 'easy-draw-panel--draw'}">
                <h4 class="easy-draw-panel__title">${panelTitle}</h4>

                <div class="easy-draw-panel__surface ${surface.ready ? 'is-ready' : ''}">
                    <div class="easy-draw-panel__surface-title">${surface.title}</div>
                    <div class="easy-draw-panel__surface-copy">${surface.detail}</div>
                </div>

                <div class="easy-draw-panel__tools">
                    ${toolButtons}
                </div>

                <div class="easy-draw-panel__control">
                    <label>Tool Preset:</label>
                    <select id="easy-tool-preset" class="easy-draw-panel__select" ${drawingEnabled ? '' : 'disabled'}>
                        ${toolPresetOptions}
                    </select>
                </div>

                <label class="easy-draw-panel__toggle ${directPaintDisabled ? 'is-disabled' : ''}">
                    <input type="checkbox" id="easy-direct-paint-toggle" ${this.state.directPaintOnImage ? 'checked' : ''} ${directPaintDisabled ? 'disabled' : ''} />
                    <span>Paint/erase on image</span>
                </label>

                <div class="easy-draw-panel__control ${showColor ? '' : 'easy-draw-panel__control--hidden'}">
                    <label>${colorLabel}</label>
                    <div class="easy-draw-panel__color-row">
                        <input type="color" id="easy-draw-color" value="${stagedColor}" ${showColor ? '' : 'disabled'} />
                        <span class="easy-draw-panel__color-value">${stagedColor.toUpperCase()}</span>
                        <button class="easy-draw-panel__fill-btn ${this.state.vectorFill ? 'active' : ''}" id="easy-vector-fill-btn" type="button" ${showColor ? '' : 'disabled'}>Fill</button>
                    </div>
                </div>

                <div class="easy-draw-panel__control">
                    <label>Brush Size: <span id="easy-brush-size-value">${this.state.brushSize}</span>px</label>
                    <input type="range" id="easy-brush-size" min="1" max="256" value="${this.state.brushSize}" ${drawingEnabled ? '' : 'disabled'} />
                </div>

                <div class="easy-draw-panel__note">${drawNote}</div>

                <div class="easy-draw-panel__actions">
                    <button class="easy-draw-panel__btn easy-draw-panel__btn--primary" id="easy-draw-clear-btn" ${drawingEnabled ? '' : 'disabled'}>
                        Clear ${this.state.easyMode === 'inpaint' ? 'Mask' : 'Paint'}
                    </button>
                </div>
            </div>
        `;
    }

    _bindDomListeners() {
        this.container.querySelectorAll('.easy-draw-tool-btn').forEach((btn) => {
            btn.onclick = (e) => {
                const tool = e.currentTarget.dataset.tool;
                const isTransformTool = EASY_TRANSFORM_TOOLS.has(tool);
                if (!isTransformTool && !this._supportsDrawingIntent()) return;
                const shape = e.currentTarget.dataset.shape || '';
                const isSameTool = tool === 'vector'
                    ? this.state.tool === 'vector' && shape === this.state.vectorShape
                    : this.state.tool === tool;
                if (isSameTool) {
                    this.state.tool = 'cursor';
                    this.eventBus.emit('mask:paintMode', { enabled: false });
                    this._applyToolState();
                    this._updateToolButtonState();
                    return;
                }
                this.state.tool = tool;
                if (shape) {
                    this.state.vectorShape = shape;
                }
                if (!isTransformTool) {
                    this._ensureIntentLayer();
                }
                this._applyToolState();
                this._updateToolButtonState();
            };
        });

        const colorInput = this.container.querySelector('#easy-draw-color');
        const stageColorInput = (e) => {
            this.state.colorEditing = true;
            this.state.pendingBrushColor = this._normalizeHexColor(e.target.value || this.state.brushColor);
            this.state.brushColor = this.state.pendingBrushColor;
            const readout = this.container.querySelector('.easy-draw-panel__color-value');
            if (readout) readout.textContent = this.state.pendingBrushColor.toUpperCase();
            this.eventBus.emit('brush:update', {
                color: this.state.pendingBrushColor,
                source: this.state.easyMode === 'inpaint' ? 'easy-mask' : 'easy-draw',
            });
            if (this.state.easyMode === 'inpaint') {
                this.eventBus.emit('mask:overlayStyle', { color: this._hexToOverlay(this.state.pendingBrushColor, 0.42) });
            }
        };
        const commitColorInput = (e) => {
            const nextColor = this._normalizeHexColor(this.state.pendingBrushColor || e?.target?.value || this.state.brushColor);
            this.state.brushColor = nextColor;
            this.state.pendingBrushColor = null;
            this.state.colorEditing = false;
            if (colorInput) colorInput.value = nextColor;
            const readout = this.container.querySelector('.easy-draw-panel__color-value');
            if (readout) readout.textContent = nextColor.toUpperCase();
            this.eventBus.emit('brush:update', {
                color: nextColor,
                source: this.state.easyMode === 'inpaint' ? 'easy-mask' : 'easy-draw',
            });
            if (this.state.easyMode === 'inpaint') {
                this.eventBus.emit('mask:overlayStyle', { color: this._hexToOverlay(nextColor, 0.42) });
            }
        };
        colorInput?.addEventListener('pointerdown', (event) => event.stopPropagation());
        colorInput?.addEventListener('click', (event) => event.stopPropagation());
        colorInput?.addEventListener('input', (event) => {
            event.stopPropagation();
            stageColorInput(event);
        });
        colorInput?.addEventListener('change', (event) => {
            event.stopPropagation();
            stageColorInput(event);
        });
        colorInput?.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                event.preventDefault();
                commitColorInput(event);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.state.pendingBrushColor = null;
                this.state.colorEditing = false;
                colorInput.value = this.state.brushColor;
                const readout = this.container.querySelector('.easy-draw-panel__color-value');
                if (readout) readout.textContent = this.state.brushColor.toUpperCase();
            }
        });

        this.container.querySelector('#easy-vector-fill-btn')?.addEventListener('click', () => {
            this.state.vectorFill = !this.state.vectorFill;
            this.eventBus.emit('vector:options', { fill: this.state.vectorFill });
            this.container.querySelector('#easy-vector-fill-btn')?.classList.toggle('active', this.state.vectorFill);
        });

        this.container.querySelector('#easy-direct-paint-toggle')?.addEventListener('change', (event) => {
            this._setDirectPaintOnImage(!!event.target.checked);
            if (this.state.directPaintOnImage && this.state.easyMode !== 'inpaint') {
                this._ensureIntentLayer();
            }
            this._applyToolState();
            this.render();
            this._bindDomListeners();
        });

        this.container.querySelector('#easy-brush-size')?.addEventListener('input', (e) => {
            this.state.brushSize = parseInt(e.target.value);
            this.container.querySelector('#easy-brush-size-value').textContent = this.state.brushSize;
            if (this.state.tool === 'erase') {
                this.eventBus.emit('eraser:brush', { size: this.state.brushSize });
            } else if (this.state.tool === 'vector') {
                this.eventBus.emit('vector:brush', { size: this.state.brushSize });
            } else {
                const brush = this.state.tool === 'pencil' ? 'pencil' : 'brush';
                this.eventBus.emit('brush:update', { brush, size: this.state.brushSize });
            }
        });

        this.container.querySelector('#easy-tool-preset')?.addEventListener('change', (e) => {
            const presetValue = String(e.target.value || '');
            const [tool, preset] = presetValue.split(':');
            if (!tool || !preset) return;
            this.state.toolPreset = presetValue;
            const stateTool = tool === 'eraser' ? 'erase' : tool;
            this.state.tool = stateTool;
            if (!EASY_TRANSFORM_TOOLS.has(stateTool)) {
                this._ensureIntentLayer();
            }
            this.eventBus.emit('gimp:tool:preset:apply', { tool, preset });
            this._syncBrushStateFromManagers(stateTool);
            this._applyToolState();
            this._updateToolButtonState();
        });

        this.container.querySelector('#easy-draw-clear-btn')?.addEventListener('click', () => {
            this.clearIntentLayer();
        });
    }

    _applyToolState() {
        this._emitDirectPaintMode();
        this.eventBus.emit('canvas:pan:mode', { enabled: false });
        if (EASY_TRANSFORM_TOOLS.has(this.state.tool)) {
            this.eventBus.emit('gimp:tool:activate', { tool: this.state.tool === 'cursor' ? 'select' : this.state.tool });
            if (this.state.tool === 'cursor') {
                this.eventBus.emit('mask:paintMode', { enabled: false });
            }
            if (this.toolController?.applySelection) {
                this.toolController.applySelection({ tool: this.state.tool });
                return;
            }
            this.eventBus.emit('tool:change', this.state.tool === 'cursor' ? 'cursor' : this.state.tool);
            if (this.state.tool === 'cursor') {
                this.eventBus.emit('canvas:frame', { enabled: true });
            } else {
                this.eventBus.emit('canvas:frame', { enabled: false });
            }
            return;
        }

        if (!this._supportsDrawingIntent()) {
            this.toolController?.applySelection?.({ tool: 'cursor' }) || this.eventBus.emit('tool:change', 'cursor');
            return;
        }

        if (this.state.easyMode === 'inpaint') {
            const maskBrushSize = Math.max(1, Math.round(Number(this.state.brushSize) || 32));
            this.state.brushSize = maskBrushSize;
            this.eventBus.emit('mask:paintMode', { enabled: true });
            this.eventBus.emit('mask:overlay', { enabled: true });
            this.eventBus.emit('mask:overlayStyle', { color: this._hexToOverlay(this.state.brushColor || EASY_INPAINT_MASK_COLOR, 0.42) });
            if (this.state.tool === 'erase') {
                this.eventBus.emit('eraser:brush', { size: maskBrushSize, softness: 0, hardness: 1, source: 'easy-inpaint' });
                this.eventBus.emit('tool:change', 'eraser');
            } else {
                this.state.tool = 'brush';
                this.eventBus.emit('brush:update', { ...EASY_INPAINT_BRUSH, color: this.state.brushColor || EASY_INPAINT_MASK_COLOR, size: maskBrushSize, source: 'easy-mask' });
                this.eventBus.emit('tool:change', 'brush');
            }
        } else {
            this.eventBus.emit('mask:paintMode', { enabled: false });
            this.eventBus.emit('mask:overlay', { enabled: false });
            this.eventBus.emit('mask:overlayStyle', { color: EASY_INPAINT_MASK_OVERLAY });
            const brushKind = this.state.tool === 'pencil' ? 'pencil' : 'brush';
            this.eventBus.emit('brush:update', { brush: brushKind, color: this.state.brushColor, size: this.state.brushSize, source: 'easy-draw' });
        }
        if (this.toolController?.applySelection) {
            this.toolController.applySelection({
                tool: this.state.tool,
                shape: this.state.vectorShape,
                fill: this.state.vectorFill,
                color: this.state.easyMode === 'inpaint' ? (this.state.brushColor || EASY_INPAINT_MASK_COLOR) : this.state.brushColor,
                size: this.state.brushSize,
            });
            return;
        }

        if (this.state.tool === 'cursor') {
            this.eventBus.emit('tool:change', 'cursor');
            this.eventBus.emit('canvas:frame', { enabled: true });
        } else if (this.state.tool === 'fill') {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('tool:change', 'fill');
        } else if (this.state.tool === 'eyedropper') {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('tool:change', 'eyedropper');
        } else if (this.state.tool === 'vector') {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('vector:shape', { shape: this.state.vectorShape });
            this.eventBus.emit('vector:options', { fill: this.state.vectorFill });
            this.eventBus.emit('tool:change', 'vector');
        } else if (this.state.tool === 'erase') {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('eraser:brush', { size: this.state.brushSize });
            this.eventBus.emit('tool:change', 'eraser');
        } else if (this.state.tool === 'pencil') {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('brush:update', { brush: 'pencil' });
            this.eventBus.emit('tool:change', 'pencil');
        } else {
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('brush:update', { brush: 'brush' });
            this.eventBus.emit('tool:change', 'brush');
        }
    }

    _updateToolButtonState() {
        this.container.querySelectorAll('.easy-draw-tool-btn').forEach((btn) => {
            const tool = btn.dataset.tool;
            const shape = btn.dataset.shape || '';
            const active = tool === 'vector'
                ? this.state.tool === 'vector' && shape === this.state.vectorShape
                : tool === this.state.tool;
            btn.classList.toggle('active', active);
        });
    }

    clearIntentLayer() {
        const layer = this._getIntentLayer();
        if (!layer) {
            return;
        }

        const patch = this.state.easyMode === 'inpaint'
            ? { mask: null }
            : {
                bitmap: null,
                metadata: {
                    ...(layer.metadata || {}),
                    easyWhiteBase: false,
                    easyDrawSurface: (this.state.drawOnly || this.state.easyMode === 'draw') ? 'white' : 'transparent',
                },
            };
        this.modules?.layerManager?.updateLayer?.({ id: layer.id, patch });
        if (this.state.easyMode === 'inpaint') {
            this.eventBus.emit('mask:overlay', { enabled: false });
        }
    }

    _syncBrushStateFromManagers(tool = this.state.tool) {
        const manager = this.modules?.maskManager;
        const source = tool === 'erase'
            ? manager?.getEraserBrushSettings?.()
            : tool === 'vector'
                ? manager?.getVectorBrushSettings?.()
                : manager?.getBrushSettings?.();
        if (!source) return;
        if (typeof source.size === 'number' && Number.isFinite(source.size)) {
            this.state.brushSize = Math.max(1, Math.round(source.size));
            const input = this.container.querySelector('#easy-brush-size');
            const readout = this.container.querySelector('#easy-brush-size-value');
            if (input) input.value = String(this.state.brushSize);
            if (readout) readout.textContent = String(this.state.brushSize);
        }
        if (typeof source.color === 'string' && source.color.trim() && tool !== 'erase') {
            this.state.brushColor = source.color.trim();
            const input = this.container.querySelector('#easy-draw-color');
            const readout = this.container.querySelector('.easy-draw-panel__color-value');
            if (input) input.value = this._normalizeHexColor(this.state.brushColor);
            if (readout) readout.textContent = this._normalizeHexColor(this.state.brushColor).toUpperCase();
        }
    }

    _hexToOverlay(hex, alpha = 0.42) {
        const value = this._normalizeHexColor(hex || EASY_INPAINT_MASK_COLOR);
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
        if (!match) return EASY_INPAINT_MASK_OVERLAY;
        const r = parseInt(match[1], 16);
        const g = parseInt(match[2], 16);
        const b = parseInt(match[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${Math.max(0.05, Math.min(1, Number(alpha) || 0.42))})`;
    }

    _normalizeHexColor(value, fallback = '#000000') {
        const raw = String(value || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(raw)) {
            return `#${raw.slice(1).split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
        }
        return fallback;
    }

    cleanup() {
        if (this._boundCanvasEl) {
            this._boundCanvasEl.removeEventListener('pointerdown', this._canvasPointerDownHandler, true);
            this._boundCanvasEl = null;
        }
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
    }
}


