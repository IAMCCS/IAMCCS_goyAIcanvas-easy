/**
 * EasyShortcutRail.js
 * Minimal shared transform tools for Easy mode.
 */

export default class EasyShortcutRail {
    constructor(container, eventBus, canvasView) {
        this.container = container;
        this.eventBus = eventBus;
        this.canvasView = canvasView;
        this._activeTool = 'cursor';
        this._cropActive = false;
        this._keepAspect = true;
        this._rotatePivot = 'center';
        this._frameEnabled = false;
        this._snapEnabled = false;
        this._canvasPanEnabled = true;
        this._toolBeforeCanvasPan = 'cursor';
        this._unsubs = [];

        this._bindBusListeners();
        this.render();
        this.attachListeners();
        window.setTimeout(() => {
            this.eventBus.emit('tool:change', 'canvas_pan');
            this.eventBus.emit('canvas:pan:mode', { enabled: true });
        }, 0);
    }

    _bindBusListeners() {
        const onToolChange = (toolId) => {
            this._activeTool = typeof toolId === 'string' ? toolId : 'cursor';
            this._syncButtonState();
        };
        const onCropState = ({ active } = {}) => {
            this._cropActive = !!active;
            this._syncButtonState();
        };
        const onFrameState = ({ enabled } = {}) => {
            this._frameEnabled = !!enabled;
            this._syncButtonState();
        };

        this._unsubs.push(this.eventBus.on('tool:change', onToolChange));
        this._unsubs.push(this.eventBus.on('canvas:crop:state', onCropState));
        this._unsubs.push(this.eventBus.on('canvas:frame:state', onFrameState));
    }

    render() {
        this.container.innerHTML = `
            <div class="easy-shortcut-rail">
                <h4 class="easy-shortcut-rail__title">Tools</h4>
                <div class="easy-shortcut-rail__section">
                    <div class="easy-shortcut-rail__section-title">Canvas</div>
                    <div class="easy-shortcut-rail__grid">
                        <button class="easy-shortcut-rail__btn" id="easy-tool-select" data-tool="cursor">Select</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-pan" data-tool="canvas_pan">Move Canvas</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-center">Center Canvas</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-move" data-tool="move">Move</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-scale" data-tool="scale">Scale</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-rotate" data-tool="rotate">Rotate</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-crop">Crop</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-apply-crop">Apply Crop</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-reframe">Reframe</button>
                    </div>
                    <div class="easy-shortcut-rail__danger-row">
                        <button class="easy-shortcut-rail__btn easy-shortcut-rail__btn--danger" id="easy-tool-cancel">Clear Layer</button>
                    </div>
                </div>
                <div class="easy-shortcut-rail__section">
                    <div class="easy-shortcut-rail__section-title">History</div>
                    <div class="easy-shortcut-rail__grid easy-shortcut-rail__grid--history">
                        <button class="easy-shortcut-rail__btn" id="easy-tool-undo">Undo</button>
                        <button class="easy-shortcut-rail__btn" id="easy-tool-redo">Redo</button>
                    </div>
                </div>
                <div class="easy-shortcut-rail__section">
                    <div class="easy-shortcut-rail__section-title">Options</div>
                    <label class="easy-shortcut-rail__check">
                        <input type="checkbox" id="easy-tool-keep-aspect" ${this._keepAspect ? 'checked' : ''}>
                        <span>Keep aspect</span>
                    </label>
                    <div class="easy-shortcut-rail__toggles">
                        <label class="easy-shortcut-rail__check">
                            <input type="checkbox" id="easy-tool-snap" ${this._snapEnabled ? 'checked' : ''}>
                            <span>Snap</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
        this._syncButtonState();
    }

    attachListeners() {
        const activateSelectMode = () => {
            if (this._activeTool === 'cursor' && this._frameEnabled) {
                this.eventBus.emit('canvas:selection:clear');
                return;
            }
            if (this._cropActive) {
                this.eventBus.emit('canvas:crop:cancel');
            }
            this.eventBus.emit('canvas:pan:mode', { enabled: false });
            this.eventBus.emit('tool:change', 'cursor');
            this.eventBus.emit('canvas:frame', { enabled: true });
        };
        this.container.querySelector('#easy-tool-select')?.addEventListener('click', () => {
            activateSelectMode();
        });

        this.container.querySelector('#easy-tool-pan')?.addEventListener('click', () => {
            if (this._activeTool === 'canvas_pan') {
                this.eventBus.emit('canvas:pan:mode', { enabled: false });
                const fallbackTool = this._toolBeforeCanvasPan && this._toolBeforeCanvasPan !== 'canvas_pan'
                    ? this._toolBeforeCanvasPan
                    : 'cursor';
                this.eventBus.emit('tool:change', fallbackTool);
                this.eventBus.emit('canvas:frame', { enabled: fallbackTool === 'cursor' });
                return;
            }
            this._toolBeforeCanvasPan = this._activeTool || 'cursor';
            this.eventBus.emit('canvas:frame', { enabled: false });
            if (this._cropActive) this.eventBus.emit('canvas:crop:cancel');
            this.eventBus.emit('tool:change', 'canvas_pan');
            this.eventBus.emit('canvas:pan:mode', { enabled: true });
        });

        this.container.querySelector('#easy-tool-center')?.addEventListener('click', () => {
            this.eventBus.emit('canvas:pan:reset');
        });

        this.container.querySelector('#easy-tool-move')?.addEventListener('click', () => {
            if (this._activeTool === 'move') {
                activateSelectMode();
                return;
            }
            this.eventBus.emit('canvas:frame', { enabled: false });
            if (this._cropActive) this.eventBus.emit('canvas:crop:cancel');
            this.eventBus.emit('canvas:pan:mode', { enabled: false });
            this.eventBus.emit('tool:change', 'move');
        });

        this.container.querySelector('#easy-tool-scale')?.addEventListener('click', () => {
            if (this._activeTool === 'scale') {
                activateSelectMode();
                return;
            }
            this.eventBus.emit('canvas:frame', { enabled: false });
            if (this._cropActive) this.eventBus.emit('canvas:crop:cancel');
            this.eventBus.emit('canvas:pan:mode', { enabled: false });
            this.eventBus.emit('tool:change', 'scale');
        });

        this.container.querySelector('#easy-tool-rotate')?.addEventListener('click', () => {
            if (this._activeTool === 'rotate') {
                activateSelectMode();
                return;
            }
            this.eventBus.emit('canvas:frame', { enabled: false });
            if (this._cropActive) this.eventBus.emit('canvas:crop:cancel');
            this.eventBus.emit('canvas:pan:mode', { enabled: false });
            this.eventBus.emit('tool:change', 'rotate');
        });

        this.container.querySelector('#easy-tool-crop')?.addEventListener('click', () => {
            if (this._cropActive) {
                this.eventBus.emit('canvas:crop:cancel');
                activateSelectMode();
                return;
            }
            this.eventBus.emit('canvas:frame', { enabled: false });
            this.eventBus.emit('canvas:pan:mode', { enabled: false });
            this.eventBus.emit('tool:change', 'cursor');
            this.eventBus.emit('canvas:crop:start');
            this.eventBus.emit('status:message', 'Drag a crop rectangle on the canvas');
        });

        this.container.querySelector('#easy-tool-apply-crop')?.addEventListener('click', () => {
            this.eventBus.emit('canvas:crop:apply');
        });

        this.container.querySelector('#easy-tool-cancel')?.addEventListener('click', () => {
            this.eventBus.emit('easy:generation:reset', { reason: 'clear-layer-button' });
            this.eventBus.emit('canvas:selection:delete');
        });

        this.container.querySelector('#easy-tool-reframe')?.addEventListener('click', () => {
            this.eventBus.emit('canvas:selection:reframe');
        });

        this.container.querySelector('#easy-tool-undo')?.addEventListener('click', () => {
            this.eventBus.emit('history:undo');
        });

        this.container.querySelector('#easy-tool-redo')?.addEventListener('click', () => {
            this.eventBus.emit('history:redo');
        });

        this.container.querySelector('#easy-tool-keep-aspect')?.addEventListener('change', (event) => {
            this._keepAspect = !!event.target.checked;
            this.eventBus.emit('scale:options', { keepAspect: this._keepAspect });
        });

        this.container.querySelector('#easy-tool-snap')?.addEventListener('change', (event) => {
            this._snapEnabled = !!event.target.checked;
            this.eventBus.emit('canvas:snap', { enabled: this._snapEnabled });
        });
    }

    _syncButtonState() {
        this.container.querySelectorAll('[data-tool]').forEach((button) => {
            const tool = button.dataset.tool;
            const isActive = tool === 'cursor' ? (this._activeTool === 'cursor' && this._frameEnabled) : this._activeTool === tool;
            button.classList.toggle('is-active', isActive);
        });
        this.container.querySelector('#easy-tool-crop')?.classList.toggle('is-active', this._cropActive);
        this.container.querySelector('#easy-tool-apply-crop')?.toggleAttribute('disabled', !this._cropActive);
    }

    cleanup() {
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
    }
}
