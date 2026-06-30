import { ensureEasyLayer, findEasyLayer, getEasyRoleForMode } from './easyLayerRuntime.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeRect(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return {
        x: Math.round(x1),
        y: Math.round(y1),
        width: Math.max(1, Math.round(x2 - x1)),
        height: Math.max(1, Math.round(y2 - y1)),
    };
}

function normalizeScreenRect(a, b) {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const right = Math.max(a.x, b.x);
    const bottom = Math.max(a.y, b.y);
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

export default class EasySelectionOverlay {
    constructor(eventBus, modules) {
        this.eventBus = eventBus;
        this.modules = modules || {};
        this.enabled = false;
        this.mode = 'inpaint';
        this.drag = null;
        this.rect = null;
        this.outpaintPadding = null;
        this.outpaintPreviewActive = false;
        this._trackingFrame = 0;
        this._unsubs = [];

        this.overlay = document.createElement('div');
        this.overlay.className = 'easy-selection-overlay';
        this.overlay.style.display = 'none';

        this.box = document.createElement('div');
        this.box.className = 'easy-selection-overlay__box';
        this.overlay.appendChild(this.box);
        this.innerBox = document.createElement('div');
        this.innerBox.className = 'easy-selection-overlay__inner';
        this.innerBox.style.display = 'none';
        this.overlay.appendChild(this.innerBox);
        this.readout = document.createElement('div');
        this.readout.className = 'easy-selection-overlay__readout';
        this.readout.style.display = 'none';
        this.overlay.appendChild(this.readout);

        this._bindDom();
        this._mount();
        this._bindBus();
    }

    _bindBus() {
        this._unsubs.push(this.eventBus.on('easy:selection:enable', (payload = {}) => {
            const nextMode = payload.mode || 'inpaint';
            if (nextMode !== this.mode) {
                this.drag = null;
                if (nextMode !== 'outpaint') {
                    this.rect = null;
                    this.outpaintPadding = null;
                }
            }
            this.mode = nextMode;
            this.setEnabled(!!payload.enabled);
        }));
        this._unsubs.push(this.eventBus.on('easy:selection:clear', (payload = {}) => {
            if (payload.mode && payload.mode !== this.mode) return;
            this.clearSelection();
        }));
        this._unsubs.push(this.eventBus.on('easy:outpaint:reset', () => {
            const previousMode = this.mode;
            this.mode = 'outpaint';
            this.outpaintPreviewActive = false;
            this.clearSelection();
            this.setEnabled(false);
            this.mode = previousMode;
        }));
        this._unsubs.push(this.eventBus.on('easy:outpaint:preview', ({ active } = {}) => {
            this.outpaintPreviewActive = !!active;
            if (this.mode === 'outpaint' && this.enabled) {
                this._syncOverlayBounds();
                this._renderRect();
            }
        }));
        this._unsubs.push(this.eventBus.on('canvas:resize', () => {
            if (this.mode === 'outpaint' && this.outpaintPadding) {
                this._syncOverlayBounds();
                this._renderRect();
                return;
            }
            this.clearSelection();
        }));
        this._unsubs.push(this.eventBus.on('project:clear', () => this.clearSelection()));
    }

    _bindDom() {
        this._onPointerDown = (event) => this._handlePointerDown(event);
        this._onPointerMove = (event) => this._handlePointerMove(event);
        this._onPointerUp = (event) => this._handlePointerUp(event);
        this.overlay.addEventListener('pointerdown', this._onPointerDown);
        window.addEventListener('pointermove', this._onPointerMove, true);
        window.addEventListener('pointerup', this._onPointerUp, true);
        window.addEventListener('pointercancel', this._onPointerUp, true);
    }

    _startTracking() {
        if (this._trackingFrame) return;
        const tick = () => {
            this._trackingFrame = 0;
            if (!this.enabled) return;
            if (this.mode === 'outpaint' && !this.drag) {
                this._renderRect();
            } else {
                this._syncOverlayBounds();
            }
            this._trackingFrame = requestAnimationFrame(tick);
        };
        this._trackingFrame = requestAnimationFrame(tick);
    }

    _stopTracking() {
        if (!this._trackingFrame) return;
        cancelAnimationFrame(this._trackingFrame);
        this._trackingFrame = 0;
    }

    _mount() {
        const host = this.modules?.canvasView?.container || document.querySelector('.goya-canvas-container');
        if (!host || this.overlay.parentElement === host) return;
        const currentPosition = window.getComputedStyle(host).position;
        if (!currentPosition || currentPosition === 'static') {
            host.style.position = 'relative';
        }
        host.appendChild(this.overlay);
        this._syncOverlayBounds();
    }

    _getCanvas() {
        return this.modules?.canvasView?.canvas || document.getElementById('goya-main-canvas');
    }

    _syncOverlayBounds() {
        const canvas = this._getCanvas();
        const host = this.overlay.parentElement;
        if (!canvas || !host) return null;

        const canvasRect = canvas.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const outpaint = this.mode === 'outpaint';
        const left = outpaint ? 0 : canvasRect.left - hostRect.left;
        const top = outpaint ? 0 : canvasRect.top - hostRect.top;

        Object.assign(this.overlay.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${outpaint ? hostRect.width : canvasRect.width}px`,
            height: `${outpaint ? hostRect.height : canvasRect.height}px`,
        });

        return {
            canvas,
            canvasRect,
            hostRect,
            outpaint,
            canvasBox: {
                left: canvasRect.left - hostRect.left,
                top: canvasRect.top - hostRect.top,
                right: canvasRect.right - hostRect.left,
                bottom: canvasRect.bottom - hostRect.top,
                width: canvasRect.width,
                height: canvasRect.height,
            },
            scaleX: canvas.width / Math.max(1, canvasRect.width),
            scaleY: canvas.height / Math.max(1, canvasRect.height),
        };
    }

    _eventToCanvasPoint(event) {
        const metrics = this._syncOverlayBounds();
        if (!metrics) return null;
        const x = clamp((event.clientX - metrics.canvasRect.left) * metrics.scaleX, 0, metrics.canvas.width);
        const y = clamp((event.clientY - metrics.canvasRect.top) * metrics.scaleY, 0, metrics.canvas.height);
        return { x, y };
    }

    _eventToHostPoint(event) {
        const metrics = this._syncOverlayBounds();
        if (!metrics) return null;
        return {
            x: clamp(event.clientX - metrics.hostRect.left, 0, metrics.hostRect.width),
            y: clamp(event.clientY - metrics.hostRect.top, 0, metrics.hostRect.height),
        };
    }

    _outpaintFrameFromDrag(start, current) {
        const metrics = this._syncOverlayBounds();
        if (!metrics) return null;
        const dragRect = normalizeScreenRect(start, current);
        const canvasBox = metrics.canvasBox;
        const base = this.drag?.baseRect || this.rect || {
            x: canvasBox.left,
            y: canvasBox.top,
            width: canvasBox.width,
            height: canvasBox.height,
        };
        const baseRight = base.x + base.width;
        const baseBottom = base.y + base.height;
        const left = clamp(Math.min(canvasBox.left, base.x, dragRect.left), 0, metrics.hostRect.width);
        const top = clamp(Math.min(canvasBox.top, base.y, dragRect.top), 0, metrics.hostRect.height);
        const right = clamp(Math.max(canvasBox.right, baseRight, dragRect.right), 0, metrics.hostRect.width);
        const bottom = clamp(Math.max(canvasBox.bottom, baseBottom, dragRect.bottom), 0, metrics.hostRect.height);
        const padding = {
            left: Math.max(0, Math.round((canvasBox.left - left) * metrics.scaleX)),
            top: Math.max(0, Math.round((canvasBox.top - top) * metrics.scaleY)),
            right: Math.max(0, Math.round((right - canvasBox.right) * metrics.scaleX)),
            bottom: Math.max(0, Math.round((bottom - canvasBox.bottom) * metrics.scaleY)),
        };
        return {
            rect: {
                x: left,
                y: top,
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top),
            },
            padding,
        };
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        this._mount();
        this.overlay.classList.toggle('is-enabled', this.enabled);
        this.overlay.classList.toggle('is-outpaint', this.enabled && this.mode === 'outpaint');
        this.overlay.style.display = this.enabled ? 'block' : 'none';
        if (this.enabled) {
            this._startTracking();
            this._syncOverlayBounds();
            this._renderRect();
        } else {
            this._stopTracking();
        }
    }

    _handlePointerDown(event) {
        if (!this.enabled || event.button !== 0) return;
        const start = this.mode === 'outpaint'
            ? this._eventToHostPoint(event)
            : this._eventToCanvasPoint(event);
        if (!start) return;

        event.preventDefault();
        event.stopPropagation();
        this.overlay.setPointerCapture?.(event.pointerId);
        this.drag = {
            pointerId: event.pointerId,
            start,
            current: start,
            baseRect: this.mode === 'outpaint' && this.rect ? { ...this.rect } : null,
        };
        if (this.mode === 'outpaint') {
            const frame = this._outpaintFrameFromDrag(start, start);
            this.rect = frame?.rect || null;
            this.outpaintPadding = frame?.padding || null;
        } else {
            this.rect = normalizeRect(start, start);
        }
        this._renderRect();
    }

    _handlePointerMove(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const current = this.mode === 'outpaint'
            ? this._eventToHostPoint(event)
            : this._eventToCanvasPoint(event);
        if (!current) return;

        event.preventDefault();
        event.stopPropagation();
        this.drag.current = current;
        if (this.mode === 'outpaint') {
            const frame = this._outpaintFrameFromDrag(this.drag.start, current);
            this.rect = frame?.rect || null;
            this.outpaintPadding = frame?.padding || null;
        } else {
            this.rect = normalizeRect(this.drag.start, current);
        }
        this._renderRect();
    }

    _handlePointerUp(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        this.overlay.releasePointerCapture?.(event.pointerId);

        const rect = this.rect;
        const padding = this.outpaintPadding;
        this.drag = null;
        if (this.mode === 'outpaint') {
            const total = (padding?.left || 0) + (padding?.top || 0) + (padding?.right || 0) + (padding?.bottom || 0);
            if (!rect || total <= 0) {
                this.clearSelection();
                return;
            }
            this._commitOutpaintSelection(rect, padding);
            return;
        }
        if (!rect || rect.width < 3 || rect.height < 3) {
            this.clearSelection({ keepLayer: true });
            return;
        }
        this._commitSelection(rect);
    }

    _renderRect() {
        const metrics = this._syncOverlayBounds();
        if (!metrics || !this.rect) {
            this.box.style.display = 'none';
            this.innerBox.style.display = 'none';
            this.readout.style.display = 'none';
            return;
        }

        let left = this.mode === 'outpaint' ? this.rect.x : this.rect.x / metrics.scaleX;
        let top = this.mode === 'outpaint' ? this.rect.y : this.rect.y / metrics.scaleY;
        let width = this.mode === 'outpaint' ? this.rect.width : this.rect.width / metrics.scaleX;
        let height = this.mode === 'outpaint' ? this.rect.height : this.rect.height / metrics.scaleY;

        if (this.mode === 'outpaint' && this.outpaintPadding && !this.outpaintPreviewActive) {
            const canvasBox = metrics.canvasBox;
            const pad = this.outpaintPadding;
            left = canvasBox.left - ((Number(pad.left) || 0) / metrics.scaleX);
            top = canvasBox.top - ((Number(pad.top) || 0) / metrics.scaleY);
            const right = canvasBox.right + ((Number(pad.right) || 0) / metrics.scaleX);
            const bottom = canvasBox.bottom + ((Number(pad.bottom) || 0) / metrics.scaleY);
            width = Math.max(1, right - left);
            height = Math.max(1, bottom - top);
            this.rect = { x: left, y: top, width, height };
        } else if (this.mode === 'outpaint' && this.outpaintPreviewActive) {
            const canvasBox = metrics.canvasBox;
            left = canvasBox.left;
            top = canvasBox.top;
            width = canvasBox.width;
            height = canvasBox.height;
            this.rect = { x: left, y: top, width, height };
        }
        const showOutpaintInner = this.mode === 'outpaint' && this.outpaintPreviewActive && this.outpaintPadding;

        Object.assign(this.box.style, {
            display: 'block',
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
        if (showOutpaintInner) {
            const pad = this.outpaintPadding || {};
            const innerLeft = left + ((Number(pad.left) || 0) / metrics.scaleX);
            const innerTop = top + ((Number(pad.top) || 0) / metrics.scaleY);
            const innerWidth = Math.max(1, width - (((Number(pad.left) || 0) + (Number(pad.right) || 0)) / metrics.scaleX));
            const innerHeight = Math.max(1, height - (((Number(pad.top) || 0) + (Number(pad.bottom) || 0)) / metrics.scaleY));
            Object.assign(this.innerBox.style, {
                display: 'block',
                left: `${innerLeft}px`,
                top: `${innerTop}px`,
                width: `${innerWidth}px`,
                height: `${innerHeight}px`,
            });
        } else {
            this.innerBox.style.display = 'none';
        }
        const label = this.mode === 'outpaint' && this.outpaintPadding
            ? `L ${Math.round(this.outpaintPadding.left || 0)}  T ${Math.round(this.outpaintPadding.top || 0)}  R ${Math.round(this.outpaintPadding.right || 0)}  B ${Math.round(this.outpaintPadding.bottom || 0)}`
            : `${Math.round(this.rect.width)} x ${Math.round(this.rect.height)}`;
        this.readout.textContent = label;
        Object.assign(this.readout.style, {
            display: 'block',
            left: `${Math.max(8, left + 8)}px`,
            top: `${Math.max(8, top - 34)}px`,
        });
    }

    _makeMaskDataUrl(rect) {
        const canvas = this._getCanvas();
        const width = Math.max(1, Math.round(canvas?.width || this.modules?.layerManager?.canvasWidth || 1024));
        const height = Math.max(1, Math.round(canvas?.height || this.modules?.layerManager?.canvasHeight || 1024));
        const mask = document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        const ctx = mask.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        return mask.toDataURL('image/png');
    }

    _commitOutpaintSelection(rect, padding) {
        const clean = {
            left: Math.max(0, Math.round(Number(padding?.left) || 0)),
            top: Math.max(0, Math.round(Number(padding?.top) || 0)),
            right: Math.max(0, Math.round(Number(padding?.right) || 0)),
            bottom: Math.max(0, Math.round(Number(padding?.bottom) || 0)),
        };
        this.outpaintPadding = clean;
        this.eventBus.emit('fl2o:padding:set', clean);
        this.eventBus.emit('easy:outpaint:set', {
            mode: 'outpaint',
            padding: { ...clean },
            rect: { ...rect },
        });
        this.eventBus.emit('status:message', `Easy outpaint frame: L${clean.left} T${clean.top} R${clean.right} B${clean.bottom}`);
        this._renderRect();
    }

    _commitSelection(rect) {
        const layerManager = this.modules?.layerManager;
        const role = getEasyRoleForMode('inpaint');
        const layer = ensureEasyLayer(layerManager, role, 'Inpaint Mask');
        if (!layer) return;

        const mask = this._makeMaskDataUrl(rect);
        layerManager.updateLayer?.({
            id: layer.id,
            patch: {
                mask,
                bitmap: null,
                visible: true,
                opacity: 1,
                metadata: {
                    ...(layer.metadata || {}),
                    easyManaged: true,
                    easyRole: role,
                    easySelectionRect: { ...rect },
                    easyMaskSource: 'drag-selection',
                },
            },
        });
        layerManager.selectLayer?.(layer.id);

        this.eventBus.emit('canvas:render:request');
        this.eventBus.emit('easy:selection:set', { mode: this.mode, rect: { ...rect } });
        this.eventBus.emit('status:message', `Easy inpaint selection: ${rect.width}x${rect.height}`);
    }

    clearSelection(options = {}) {
        this.drag = null;
        this.rect = null;
        this.outpaintPadding = null;
        this.outpaintPreviewActive = false;
        this._renderRect();
        if (this.mode === 'outpaint') {
            this.eventBus.emit('fl2o:padding:set', { left: 0, top: 0, right: 0, bottom: 0 });
            this.eventBus.emit('easy:outpaint:set', { mode: 'outpaint', padding: null, rect: null });
        } else if (!options.keepLayer) {
            const layer = findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('inpaint'));
            if (layer) {
                this.modules.layerManager.updateLayer?.({
                    id: layer.id,
                    patch: {
                        mask: null,
                        bitmap: null,
                        metadata: {
                            ...(layer.metadata || {}),
                            easyManaged: true,
                            easyRole: getEasyRoleForMode('inpaint'),
                            easySelectionRect: null,
                            easyMaskSource: '',
                        },
                    },
                });
            }
        }
        this.eventBus.emit('easy:selection:set', { mode: this.mode, rect: null });
        this.eventBus.emit('canvas:render:request');
    }

    cleanup() {
        this.setEnabled(false);
        this._stopTracking();
        this.overlay.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove, true);
        window.removeEventListener('pointerup', this._onPointerUp, true);
        window.removeEventListener('pointercancel', this._onPointerUp, true);
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
        this.overlay.remove();
    }
}
