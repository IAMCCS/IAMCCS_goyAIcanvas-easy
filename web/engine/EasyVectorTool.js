export default class VectorTool {
    constructor(container, eventBus, layerManager, toolTargetResolver, getBrushSettings, getCanvasSize, commitCanvasCb, getLayerSurfaceSnapshotCb = null) {
        this.container = container;
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.toolTargetResolver = toolTargetResolver;
        this.getBrushSettings = getBrushSettings;
        this.getCanvasSize = getCanvasSize;
        this.commitCanvasCb = commitCanvasCb;
        this.getLayerSurfaceSnapshotCb = getLayerSurfaceSnapshotCb;

        this.enabled = false;
        this.mode = "idle"; // idle | adding | dragging-point | dragging-handle
        this.activePath = new BezierPath();
    this.selectedPointIndex = -1;
    this.draggingHandle = null; // 'in' | 'out' | null
    this.doubleBezier = false; // when true, mirror handles while dragging
    this._editingLayerId = null; // track layer for cleanup
    this._editingExisting = false;
    this._editPathIndex = -1;
    this._raf = null;
        this._activePointerId = null;
        this.shapeMode = 'path';
        this._shapeDraft = null;
        this._shapeStart = null;
        this._lineChainAnchor = null;
        this._lineChainStart = null;
        this._suppressNextPointerDown = false;
        this._gestureLayerId = null;
        this._gestureBaseCanvas = null;

        this._buildOverlay();
        this._bindBus();
    }

    _buildOverlay() {
        this.overlay = document.createElement('canvas');
        this.overlay.className = 'goya-vector-layer';
        this.ctx = this.overlay.getContext('2d', { desynchronized: true });
        const { width, height } = this.getCanvasSize();
        this.overlay.width = width; this.overlay.height = height;
        // Centered overlay: left/top 50% and translate(-50%,-50%), scaled via transform
        this.overlay.style.position = 'absolute';
        this.overlay.style.left = '50%';
        this.overlay.style.top = '50%';
        this.overlay.style.zIndex = '24';
        this.overlay.style.transformOrigin = 'center center';
        this.overlay.style.pointerEvents = 'none'; // default; enable when active
        this.container.appendChild(this.overlay);

        // Event catcher on top for interactions
        this.hitLayer = document.createElement('div');
        this.hitLayer.className = 'goya-vector-hit';
        this.hitLayer.style.position = 'absolute';
        this.hitLayer.style.left = '0';
        this.hitLayer.style.top = '0';
        this.hitLayer.style.right = '0';
        this.hitLayer.style.bottom = '0';
        this.hitLayer.style.zIndex = '25';
        this.hitLayer.style.cursor = 'crosshair';
        this.hitLayer.style.touchAction = 'none';
        this.hitLayer.style.pointerEvents = 'none';
        this.container.appendChild(this.hitLayer);

        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onKey = this._onKey.bind(this);

        // Defaults
        this.autoclose = true;
        this.fillMode = false;
    }

    _bindBus() {
        this.eventBus.on('canvas:transform', (payload) => {
            if (!payload) return;
            const { scale } = payload;
            if (typeof scale === 'number') {
                // Keep overlay centered and scaled like main canvas
                this.overlay.style.transform = `translate(-50%, -50%) scale(${scale})`;
            }
        });
        this.eventBus.on('canvas:resize', ({ width, height }) => this.resize(width, height));
        this.eventBus.on('tool:change', (toolId) => {
            // Vector tool activation handled in renderer; fill is now controlled by vector:options.fill
            if (toolId === 'vector' || toolId === 'vector_fill') {
                const opts = this.layerManager?.maskManager?.getVectorOptions?.() || {};
                if (typeof opts.fill === 'boolean') this.fillMode = opts.fill;
            }
        });
        this.eventBus.on('vector:options', (payload) => {
            if (!payload) return;
            if (typeof payload.autoclose === 'boolean') {
                this.autoclose = payload.autoclose;
            }
            if (typeof payload.doubleBezier === 'boolean') {
                this.doubleBezier = payload.doubleBezier;
            }
            if (typeof payload.fill === 'boolean') {
                this.fillMode = payload.fill;
            }
        });
        this.eventBus.on('vector:shape', (payload) => {
            const nextShape = String(payload?.shape || 'path');
            this.shapeMode = ['path', 'line', 'rect', 'ellipse'].includes(nextShape) ? nextShape : 'path';
            this._shapeDraft = null;
            this._shapeStart = null;
            if (this.shapeMode !== 'line') {
                this._lineChainAnchor = null;
                this._lineChainStart = null;
            }
            this._resetPath();
            this._redraw();
        });
        // Enter edit mode and load last bezier path from metadata
        this.eventBus.on('vector:mode', (payload) => {
            if (!payload || payload.mode !== 'edit') return;
            const layer = this.layerManager.getActiveLayer?.();
            if (!layer) return;
            const list = Array.isArray(layer.metadata?.bezierPaths) ? layer.metadata.bezierPaths : [];
            if (!list.length) return;
            this.activePath = BezierPath.fromJSON(list[list.length - 1]);
            this._editingExisting = true;
            this._editPathIndex = list.length - 1;
            this._editingLayerId = layer.id;
            this.enable();
            this._redraw();
        });
        // Cleanup to avoid ghost points
        this.eventBus.on('layer:selected', (layer) => {
            if (this._editingLayerId && (!layer || layer.id !== this._editingLayerId)) {
                this._resetPath();
                this._editingExisting = false;
                this._editPathIndex = -1;
                this._editingLayerId = null;
                this._redraw();
            }
        });
        this.eventBus.on('layer:delete', (layerId) => {
            if (this._editingLayerId && layerId === this._editingLayerId) {
                this._resetPath();
                this._editingExisting = false;
                this._editPathIndex = -1;
                this._editingLayerId = null;
                this._redraw();
            }
        });
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.hitLayer.style.pointerEvents = 'auto';
        this.hitLayer.addEventListener('pointerdown', this._onDown);
        this.hitLayer.addEventListener('pointermove', this._onMove);
        window.addEventListener('pointerup', this._onUp);
        window.addEventListener('pointercancel', this._onUp);
        this.hitLayer.addEventListener('dblclick', this._onDblClick);
        // Right-click to finalize when Autoclose is enabled
        this.hitLayer.addEventListener('contextmenu', (e) => {
            if (!this.enabled) return;
            e.preventDefault();
            if (this.autoclose) {
                this._finalizePath({ closePath: true });
            }
        });
        window.addEventListener('keydown', this._onKey);
        this._ensureRaf();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.hitLayer.style.pointerEvents = 'none';
        this.hitLayer.removeEventListener('pointerdown', this._onDown);
        this.hitLayer.removeEventListener('pointermove', this._onMove);
        window.removeEventListener('pointerup', this._onUp);
        window.removeEventListener('pointercancel', this._onUp);
        this.hitLayer.removeEventListener('dblclick', this._onDblClick);
        window.removeEventListener('keydown', this._onKey);
        this._activePointerId = null;
        this._gestureLayerId = null;
        this._clearLineChain();
        this._cancelRaf();
        this._redraw();
    }

    resize(width, height) {
        this.overlay.width = width; this.overlay.height = height;
        this._redraw();
    }

    _ensureRaf() {
        if (this._raf) return;
        const tick = () => {
            this._redraw();
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }

    _cancelRaf() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _canvasPoint(evt) {
        const rect = this.overlay.getBoundingClientRect();
        const scaleX = this.overlay.width / rect.width;
        const scaleY = this.overlay.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY,
        };
    }

    _onDown(e) {
        if (!this.enabled) return;
        // Ignore right-button here (handled by contextmenu finalize when Autoclose is on)
        if (e.button === 2) return;
        if (this._suppressNextPointerDown) {
            this._suppressNextPointerDown = false;
            e.preventDefault();
            return;
        }
        if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
        this._activePointerId = e.pointerId ? null;
        this.hitLayer.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const p = this._canvasPoint(e);
        if (this.shapeMode !== 'path') {
            this._ensureWritableLayer(true);
            this.mode = 'shape-drag';
            const startPoint = this.shapeMode === 'line' && this._lineChainAnchor
                ? { ...this._lineChainAnchor }
                : { ...p };
            if (this.shapeMode === 'line' && !this._lineChainStart) {
                this._lineChainStart = { ...startPoint };
            }
            this._shapeStart = startPoint;
            this._shapeDraft = { shape: this.shapeMode, start: startPoint, end: { ...p } };
            this._redraw();
            return;
        }
        // On first point ensure we are not drawing on background/locked layer
        if (this.activePath.points.length === 0) {
            this._ensureWritableLayer(true);
        }
        // Hit test handles first
        const hit = this._hitTest(p);
        if (this.mode === 'adding' && hit && hit.type === 'point' && hit.index === 0 && this.activePath.points.length >= 2) {
            this._finalizePath({ closePath: true });
            return;
        }
        if (hit && hit.type === 'handle') {
            this.mode = 'dragging-handle';
            this.selectedPointIndex = hit.index;
            this.draggingHandle = hit.which; // 'in' or 'out'
            return;
        }
        if (hit && hit.type === 'point') {
            this.mode = 'dragging-point';
            this.selectedPointIndex = hit.index;
            return;
        }
        // Add mode
        if (this.mode !== 'adding') {
            this.mode = 'adding';
            if (this.activePath.points.length === 0) {
                this.activePath.addPoint(p.x, p.y);
            } else {
                this.activePath.addPoint(p.x, p.y);
            }
        } else {
            this.activePath.addPoint(p.x, p.y);
        }
        this.selectedPointIndex = this.activePath.points.length - 1;
        // Start with temp handleOut when dragging
        this._dragStart = p;
        this._draggingNewHandle = true;

        // If Autoclose is OFF, close when clicking near the first point
        if (!this.autoclose && this.activePath.points.length >= 3) {
            const first = this.activePath.points[0];
            const curr = this.activePath.points[this.selectedPointIndex];
            if (this._dist2(first, curr) <= 100) { // ~10px
                this._finalizePath({ closePath: true });
                return;
            }
        }
    }

    _onMove(e) {
        if (!this.enabled) return;
        if (this._activePointerId != null && e.pointerId != null && e.pointerId !== this._activePointerId) return;
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const p = this._canvasPoint(e);
        if (this.mode === 'shape-drag' && this._shapeDraft) {
            this._shapeDraft.end = { ...p };
            this._applyCursor(null);
            return;
        }
        // Cursor feedback
        const hover = this._hitTest(p);
        this._applyCursor(hover);

        if (this.mode === 'dragging-point' && this.selectedPointIndex >= 0) {
            const pt = this.activePath.points[this.selectedPointIndex];
            const dx = p.x - (this._lastMove?.x ? p.x);
            const dy = p.y - (this._lastMove?.y ? p.y);
            pt.x += dx; pt.y += dy;
            if (pt.handleIn) { pt.handleIn.x += dx; pt.handleIn.y += dy; }
            if (pt.handleOut) { pt.handleOut.x += dx; pt.handleOut.y += dy; }
        } else if (this.mode === 'dragging-handle' && this.selectedPointIndex >= 0) {
            const pt = this.activePath.points[this.selectedPointIndex];
            if (this.draggingHandle === 'out') {
                pt.handleOut = { x: p.x, y: p.y };
            } else {
                pt.handleIn = { x: p.x, y: p.y };
            }
        } else if (this.mode === 'adding' && this._draggingNewHandle && this.selectedPointIndex >= 0) {
            // Default: single-bezier, adjust only the segment ending at the current point
            const curr = this.activePath.points[this.selectedPointIndex];
            const prev = this.activePath.points[this.selectedPointIndex - 1];
            // Current handleIn follows pointer (curves segment prev->curr)
            curr.handleIn = { x: p.x, y: p.y };
            if (prev && this.doubleBezier) {
                // When enabled, also mirror to previous handleOut for a smoother transition
                const vx = curr.x - p.x; const vy = curr.y - p.y;
                prev.handleOut = { x: prev.x + vx, y: prev.y + vy };
            }
        }
        this._lastMove = p;
    }

    _onUp(e) {
        if (this._activePointerId != null && e?.pointerId != null && e.pointerId !== this._activePointerId) return;
        e?.stopPropagation?.();
        e?.stopImmediatePropagation?.();
        try {
            if (this._activePointerId != null && this.hitLayer.hasPointerCapture?.(this._activePointerId)) {
                this.hitLayer.releasePointerCapture?.(this._activePointerId);
            }
        } catch (_e) {}
        this._activePointerId = null;
        if (this.mode === 'shape-drag' && this._shapeDraft) {
            this._finalizeShapeDraft();
            return;
        }
        this._draggingNewHandle = false;
        if (this.mode === 'dragging-point' || this.mode === 'dragging-handle') {
            this.mode = 'idle';
        }
    }

    _onDblClick(_e) {
        if (this.shapeMode !== 'path') {
            return;
        }
        this._suppressNextPointerDown = true;
        this._finalizePath({ closePath: this.activePath.points.length >= 3 });
    }

    _onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.mode === 'shape-drag') {
                this._clearLineChain();
                this._resetPath();
                this._redraw();
                return;
            }
            this._finalizePath();
        }
    }

    _finalizeShapeDraft() {
        let draft = this._shapeDraft;
        if (!draft) {
            this._resetPath();
            return;
        }
        if (draft.shape === 'line' && this._lineChainStart && this._dist2(draft.end, this._lineChainStart) <= 100) {
            draft = { ...draft, end: { ...this._lineChainStart } };
        }

        const targetLayer = this._ensureWritableLayer(false);
        const { canvas: tmp, ctx: tctx } = this._makeCommitCanvas();
        if (!tctx) {
            this._resetPath();
            return;
        }
        const { color, size } = this.getBrushSettings();
        const strokeColor = color || '#E39432';
        tctx.lineWidth = Math.max(1, size || 2);
        tctx.lineJoin = 'round';
        tctx.lineCap = 'round';
        tctx.strokeStyle = strokeColor;
        tctx.fillStyle = strokeColor;
        this._drawShapeToContext(tctx, draft);
        if (this.fillMode && draft.shape !== 'line') {
            tctx.fill();
        }
        tctx.stroke();

        try {
            const layer = targetLayer || this.layerManager.getActiveLayer?.();
            if (layer) {
                const prev = Array.isArray(layer.metadata?.vectorShapes) ? layer.metadata.vectorShapes.slice() : [];
                prev.push({
                    shape: draft.shape,
                    start: { ...draft.start },
                    end: { ...draft.end },
                    fill: this.fillMode,
                });
                this.layerManager.updateLayer({
                    id: layer.id,
                    patch: { metadata: { ...(layer.metadata || {}), vectorShapes: prev } },
                });
            }
        } catch (_e) {}

        if (typeof this.commitCanvasCb === 'function' && targetLayer?.id) {
            this.commitCanvasCb({ layerId: targetLayer.id, sourceCanvas: tmp, kind: 'shape', replaceBitmap: true });
        }

        this.eventBus.emit('vector:path:complete', {
            path: { shape: draft.shape, start: draft.start, end: draft.end, fill: this.fillMode },
        });

        if (draft.shape === 'line') {
            const closedLoop = this._lineChainStart && this._dist2(draft.end, this._lineChainStart) <= 100;
            if (closedLoop) {
                this._lineChainAnchor = null;
                this._lineChainStart = null;
            } else {
                this._lineChainAnchor = { ...draft.end };
            }
        }

        this._resetPath();
    }

    _finalizePath({ closePath = false } = {}) {
        if (this.activePath.points.length < 2) {
            this._resetPath();
            return;
        }
        // Ensure target layer exists and is writable (avoid background)
        const targetLayer = this._ensureWritableLayer(false);
        // Commit to layer
        const { canvas: tmp, ctx: tctx } = this._makeCommitCanvas();
        if (!tctx) {
            this._resetPath();
            return;
        }
        const { color, size } = this.getBrushSettings();
        const strokeColor = color || '#E39432';
        tctx.lineWidth = Math.max(1, size || 2);
        tctx.lineJoin = 'round';
        tctx.lineCap = 'round';
        tctx.strokeStyle = strokeColor;
        tctx.fillStyle = strokeColor;
        tctx.beginPath();
        this._traceBezierPath(tctx, this.activePath);
        const shouldClosePath = closePath || this._isClosedPath();
        if (shouldClosePath) {
            tctx.closePath();
        }
        if (this.fillMode && shouldClosePath) {
            tctx.fill();
        }
        tctx.stroke();

        // Save bezier data to layer metadata
        try {
            const layer = targetLayer || this.layerManager.getActiveLayer?.();
            if (layer) {
                const prev = Array.isArray(layer.metadata?.bezierPaths) ? layer.metadata.bezierPaths.slice() : [];
                if (this._editingExisting && this._editPathIndex >= 0 && this._editPathIndex < prev.length && layer.id === this._editingLayerId) {
                    prev[this._editPathIndex] = this.activePath.toJSON();
                } else {
                    prev.push(this.activePath.toJSON());
                }
                const patchMeta = { ...(layer.metadata || {}), bezierPaths: prev };
                this.layerManager.updateLayer({ id: layer.id, patch: { metadata: patchMeta } });
            }
        } catch (_e) {}

        // Commit bitmap via callback
        if (typeof this.commitCanvasCb === 'function' && targetLayer?.id) {
            this.commitCanvasCb({ layerId: targetLayer.id, sourceCanvas: tmp, kind: 'path', replaceBitmap: true });
        }

        // Export event
        this.eventBus.emit('vector:path:complete', { path: this.activePath.toJSON(), closed: shouldClosePath, fill: this.fillMode && shouldClosePath });

    this._resetPath();
    this._editingExisting = false;
    this._editPathIndex = -1;
    }

    _resetPath() {
        this.activePath = new BezierPath();
        this.mode = 'idle';
        this.selectedPointIndex = -1;
        this.draggingHandle = null;
        this._lastMove = null;
        this._shapeDraft = null;
        this._shapeStart = null;
        this._draggingNewHandle = false;
        this._gestureLayerId = null;
        this._gestureBaseCanvas = null;
    }

    _makeCommitCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.overlay.width;
        canvas.height = this.overlay.height;
        const ctx = canvas.getContext('2d', { desynchronized: true });
        if (!ctx) {
            return { canvas, ctx: null };
        }
        if (this._gestureBaseCanvas) {
            try {
                ctx.drawImage(this._gestureBaseCanvas, 0, 0, canvas.width, canvas.height);
            } catch (_e) {}
        }
        return { canvas, ctx };
    }

    _clearLineChain() {
        this._lineChainAnchor = null;
        this._lineChainStart = null;
    }

    _drawShapeToContext(ctx, draft) {
        if (!draft) return;
        const start = draft.start || { x: 0, y: 0 };
        const end = draft.end || start;
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);

        ctx.beginPath();
        if (draft.shape === 'line') {
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            return;
        }
        if (draft.shape === 'rect') {
            ctx.rect(left, top, width, height);
            return;
        }
        if (draft.shape === 'ellipse') {
            ctx.ellipse(left + width / 2, top + height / 2, Math.max(width / 2, 1), Math.max(height / 2, 1), 0, 0, Math.PI * 2);
            return;
        }
        this._traceBezierPath(ctx, this.activePath);
    }

    _traceBezierPath(ctx, path) {
        const pts = path.points;
        if (!pts.length) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const c0 = p0.handleOut || { x: p0.x, y: p0.y };
            const c1 = p1.handleIn || { x: p1.x, y: p1.y };
            ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, p1.x, p1.y);
        }
    }

    _hitTest(p) {
        // Check handles first
        for (let i = 0; i < this.activePath.points.length; i++) {
            const pt = this.activePath.points[i];
            if (pt.handleIn && this._dist2(p, pt.handleIn) < 9*9) return { type:'handle', which:'in', index:i };
            if (pt.handleOut && this._dist2(p, pt.handleOut) < 9*9) return { type:'handle', which:'out', index:i };
        }
        // Check points
        for (let i = 0; i < this.activePath.points.length; i++) {
            const pt = this.activePath.points[i];
            if (this._dist2(p, pt) < 8*8) return { type:'point', index:i };
        }
        return null;
    }

    _applyCursor(hit) {
        if (!this.enabled) return;
        if (!hit) { this.hitLayer.style.cursor = 'crosshair'; return; }
        if (hit.type === 'point') { this.hitLayer.style.cursor = 'move'; return; }
        if (hit.type === 'handle') { this.hitLayer.style.cursor = 'alias'; return; }
    }

    _dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx*dx + dy*dy; }

    _isClosedPath() {
        const pts = this.activePath.points || [];
        if (pts.length < 3) return false;
        return this._dist2(pts[0], pts[pts.length - 1]) <= 100;
    }

    _redraw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        if (!this.enabled) return;
        if (this._shapeDraft) {
            ctx.save();
            this._drawShapeToContext(ctx, this._shapeDraft);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#E39432';
            if (this.fillMode && this._shapeDraft.shape !== 'line') {
                ctx.fillStyle = 'rgba(227, 148, 50, 0.18)';
                ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
            return;
        }
        // Draw current path with Illustrator-like look
        const pts = this.activePath.points;
        if (!pts.length) return;

        // Draw control lines
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#555';
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.handleIn) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.handleIn.x, p.handleIn.y); ctx.stroke(); }
            if (p.handleOut) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.handleOut.x, p.handleOut.y); ctx.stroke(); }
        }
        ctx.restore();

        // Draw bezier path
        ctx.save();
        ctx.beginPath();
        this._traceBezierPath(ctx, this.activePath);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#E39432';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        // Draw points
        ctx.save();
        ctx.fillStyle = '#E0E0E0';
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        // Draw handle points
        ctx.fillStyle = '#999';
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.handleIn) { ctx.beginPath(); ctx.arc(p.handleIn.x, p.handleIn.y, 3, 0, Math.PI * 2); ctx.fill(); }
            if (p.handleOut) { ctx.beginPath(); ctx.arc(p.handleOut.x, p.handleOut.y, 3, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.restore();
    }

    _ensureWritableLayer(snapshotIfNew = false) {
        if (this._gestureLayerId) {
            const existing = this.layerManager.getLayerById?.(this._gestureLayerId) || this.layerManager.getActiveLayer?.();
            if (existing?.id === this._gestureLayerId) {
                return existing;
            }
        }
        const layer = this.toolTargetResolver?.resolveVectorLayer?.() || this.layerManager.getActiveLayer?.() || null;
        if (!layer) {
            return null;
        }
        this._gestureLayerId = layer.id;
        if (!this._gestureBaseCanvas && typeof this.getLayerSurfaceSnapshotCb === 'function') {
            try {
                this._gestureBaseCanvas = this.getLayerSurfaceSnapshotCb(layer.id) || null;
            } catch (_e) {
                this._gestureBaseCanvas = null;
            }
        }
        if (snapshotIfNew) {
            this.layerManager.snapshot?.();
        }
        return layer;
    }
}

class BezierPath {
    constructor() { this.points = []; }
    addPoint(x, y, handleIn = null, handleOut = null) {
        this.points.push({ x, y, handleIn, handleOut });
    }
    toJSON() {
        return this.points.map(p => ({
            x: p.x, y: p.y,
            handleIn: p.handleIn ? { x: p.handleIn.x, y: p.handleIn.y } : null,
            handleOut: p.handleOut ? { x: p.handleOut.x, y: p.handleOut.y } : null,
        }));
    }
    static fromJSON(arr) {
        const bp = new BezierPath();
        if (Array.isArray(arr)) {
            for (const p of arr) {
                bp.addPoint(p.x, p.y, p.handleIn ? { x: p.handleIn.x, y: p.handleIn.y } : null, p.handleOut ? { x: p.handleOut.x, y: p.handleOut.y } : null);
            }
        }
        return bp;
    }
}
