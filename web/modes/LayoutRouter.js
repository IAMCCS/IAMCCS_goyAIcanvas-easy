/**
 * LayoutRouter.js
 * Conditionally mounts the rescue mode allowlist.
 *
 * ISOLATION CONTRACT:
 * - This is the ONLY file that manipulates Advanced-mode DOM (show/hide).
 * - Mode files (easy/, video/, visual/) must NEVER import from web/ui/.
 * - Mode files must NEVER access Advanced DOM directly.
 * - LayoutRouter passes `modules` to modes — that is their only API surface.
 * - Easy mode shares `.goya-canvas-area` with Advanced (documented below).
 * - Video and Visual are fully self-contained DOM trees.
 */

import { loadModeModule, normalizeMode, preloadModes, shouldReuseMode } from '../core/ModeRegistry.js?v=20260627_EASY_RESIZE_PERSIST01';
import { activateModeInstance, deactivateModeInstance, disposeModeInstance } from '../core/ModeLifecycleAdapter.js';
import AdvancedLegacyModeAdapter from '../core/AdvancedLegacyModeAdapter.js';

export default class LayoutRouter {
    constructor(eventBus, modules, options = {}) {
        this.eventBus = eventBus;
        this.modules = modules; // { layerManager, maskManager, promptManager, qwenBridge, workflowRunner, canvasView }
        this.options = options;
        this.easyOnly = !!options.easyOnly;
        this.currentMode = null;
        this.activeModeInstance = null;
        this._modeClassCache = {};
        this._modeSwitchToken = 0;
        this._advancedModeAdapter = new AdvancedLegacyModeAdapter({
            getRoot: () => this._getScopeRoot(),
            getWorkspace: () => this._getWorkspaceEl(),
            getToolbar: () => this._getToolbarEl(),
            getPanels: () => this._getPanelsEl(),
            getCanvasArea: () => this._getCanvasAreaEl(),
            setAdvancedVisible: (visible) => this._setAdvancedVisible(visible),
        });
        this._modeMountHandlers = this.easyOnly ? {
            easy: () => this.mountEasyMode(),
        } : {
            easy: () => this.mountEasyMode(),
            advanced: () => this.mountAdvancedMode(),
            video: () => this.mountVideoMode(),
            visual: () => this.mountVisualMode(),
            simulacra: () => this.mountSimulacraMode(),
            orchestrator: () => this.mountOrchestratorMode(),
        };

        // ── Keep-alive cache: mode instances survive mode-switch ──
        this._modeCache = {};   // { video, visual, easy, simulacra, orchestrator }
        
        this.eventBus.on('ui:mode:change', (data) => {
            void this.switchMode(data.mode);
        });
        this._scheduleModePreload();
    }

    async _resolveModeClass(mode) {
        if (this._modeClassCache[mode]) return this._modeClassCache[mode];
        const module = await loadModeModule(mode);
        const ModeClass = module?.default;
        if (typeof ModeClass !== 'function') {
            throw new Error(`[LayoutRouter] Mode ${mode} did not export a default class.`);
        }
        this._modeClassCache[mode] = ModeClass;
        return ModeClass;
    }

    _scheduleModePreload() {
        // Rescue boot: no background mode preloads. Heavy modes lazy-load on demand.
    }

    _normalizeMode(mode) {
        if (this.easyOnly) return 'easy';
        return normalizeMode(mode, 'advanced');
    }

    _shouldReuseMode(mode) {
        return shouldReuseMode(mode);
    }

    _isCurrentSwitch(mode, switchToken) {
        return this.currentMode === mode && switchToken === this._modeSwitchToken;
    }

    _activateModeInstance(instance) {
        activateModeInstance(instance, '[LayoutRouter]');
    }

    _disposeModeCacheEntry(mode) {
        const instance = this._modeCache?.[mode];
        if (!instance) return;
        disposeModeInstance(instance, '[LayoutRouter]');
        delete this._modeCache[mode];
    }

    _hideInactiveModeContainers(activeInstance = null) {
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const activeContainer = activeInstance?.container || null;
        workspace.querySelectorAll(
            '.easy-mode-container, .video-mode-container, .visual-mode-container, .simulacra-mode-container, .orchestrator-mode-container'
        ).forEach((element) => {
            element.style.display = element === activeContainer ? '' : 'none';
        });
    }

    _mountCachedMode(mode, createInstance, options = {}) {
        const { afterShow = null } = options;
        if (this._shouldReuseMode(mode) && this._modeCache[mode]) {
            this.activeModeInstance = this._modeCache[mode];
            this._activateModeInstance(this.activeModeInstance);
            if (this.activeModeInstance?.container) {
                this.activeModeInstance.container.style.display = '';
            }
            this._hideInactiveModeContainers(this.activeModeInstance);
            if (typeof afterShow === 'function') afterShow(this.activeModeInstance);
            return;
        }
        this.activeModeInstance = createInstance();
        if (this._shouldReuseMode(mode)) this._modeCache[mode] = this.activeModeInstance;
        this._activateModeInstance(this.activeModeInstance);
        if (this.activeModeInstance?.container) {
            this.activeModeInstance.container.style.display = '';
        }
        this._hideInactiveModeContainers(this.activeModeInstance);
        if (typeof afterShow === 'function') {
            requestAnimationFrame(() => afterShow(this.activeModeInstance));
        }
    }

    _deactivateModeInstance(instance) {
        deactivateModeInstance(instance, '[LayoutRouter]');
    }

    _pauseAllGoyaMedia() {
        // Safety net: stop any leaked media elements in our mode DOM trees.
        try {
            const scope = this._getWorkspaceEl() || this._getScopeRoot() || document;
            const media = scope.querySelectorAll(
                '.visual-mode-container video, .visual-mode-container audio, ' +
                '.video-mode-container video, .video-mode-container audio, ' +
                '.simulacra-mode-container video, .simulacra-mode-container audio, ' +
                '.goya-fullframe-overlay video, .goya-fullframe-overlay audio'
            );
            media.forEach((el) => {
                try { el.pause?.(); } catch (_e) {}
            });
        } catch (_e) {}
    }

    _getScopeRoot() {
        return this.options?.scope || document;
    }

    _getWorkspaceEl() {
        return this.modules?.workspace || this._getScopeRoot().querySelector('.goya-workspace');
    }

    _getToolbarEl() {
        return this.modules?.toolbarHost || document.getElementById('goya-toolbar');
    }

    _getPanelsEl() {
        return this.modules?.panelsHost || document.getElementById('goya-panels');
    }

    _getCanvasAreaEl() {
        return this._getScopeRoot().querySelector('.goya-canvas-area');
    }

    _getLeftRailEl() {
        return this.modules?.leftRail || this._getScopeRoot().querySelector('.goya-side-rail--left');
    }

    _getRightRailEl() {
        return this.modules?.rightRail || this._getScopeRoot().querySelector('.goya-side-rail--right');
    }

    _setRailsVisible(visible) {
        const method = visible ? 'remove' : 'add';
        this._getLeftRailEl()?.classList[method]('hidden');
        this._getRightRailEl()?.classList[method]('hidden');
    }

    /**
     * Hide or show ALL Advanced-mode DOM elements.
     * Called on every mode switch to guarantee no cross-mode contamination.
     */
    _setAdvancedVisible(visible) {
        const method = visible ? 'remove' : 'add';
        this._getToolbarEl()?.classList[method]('hidden');
        this._getCanvasAreaEl()?.classList[method]('hidden');
        this._getPanelsEl()?.classList[method]('hidden');
        this._setRailsVisible(visible);
    }

    _clearModeLayoutClasses() {
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        workspace.classList.remove('advanced-mode-layout', 'easy-mode-layout', 'video-mode-layout', 'visual-mode-layout', 'simulacra-mode-layout', 'orchestrator-mode-layout');
        // Clear any inline grid/layout styles left by mode resize handlers
        // (e.g. VisualMode sidebar resize sets gridTemplateColumns on workspace)
        workspace.style.removeProperty('grid-template-columns');
    }

    _removeTransientModeArtifacts() {
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        workspace.querySelectorAll('.goya-mode-diagnostic, [data-goya-mode-placeholder]').forEach((element) => {
            try { element.remove?.(); } catch (_e) {}
        });
    }

    _showModeLoadingPlaceholder(mode) {
        if (mode !== 'visual' || this._modeCache?.[mode]) return;
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        this._setAdvancedVisible(false);
        const label = 'FIELD';
        const element = document.createElement('section');
        element.setAttribute('data-goya-mode-placeholder', mode);
        element.className = `${mode}-mode-container`;
        element.style.cssText = [
            'grid-column:1 / -1',
            'min-height:520px',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:#111416',
            'color:#dce6ef',
            'border:1px solid #2d333a',
            'font:600 13px/1.4 system-ui,sans-serif',
            'letter-spacing:.08em',
            'text-transform:uppercase',
        ].join(';');
        element.textContent = `${label} loading`;
        workspace.appendChild(element);
    }
    
    async switchMode(mode) {
        mode = this._normalizeMode(mode);
        const switchToken = ++this._modeSwitchToken;
        console.log(`[LayoutRouter] Switching to mode: ${mode}`);
        this._removeTransientModeArtifacts();

        const previousMode = this.currentMode;

        // Pause/stop media in the outgoing mode before it gets hidden.
        this._deactivateModeInstance(this.activeModeInstance);
        this._pauseAllGoyaMedia();
        
        // Hide (but don't destroy) current cached mode
        if (this.activeModeInstance && this.activeModeInstance.container) {
            this.activeModeInstance.container.style.display = 'none';
        }
        if (previousMode && previousMode !== 'advanced' && !this._shouldReuseMode(previousMode)) {
            this._disposeModeCacheEntry(previousMode);
            this.activeModeInstance = null;
        }

        // IMPORTANT: always reset workspace mode layout classes.
        this._clearModeLayoutClasses();
        this._hideInactiveModeContainers(null);
        
        this.currentMode = mode;
        try {
            this.modules?.modeBridge?.setActiveMode(mode, {
                hasCachedInstance: Boolean(this._modeCache?.[mode]),
            });
        } catch (_e) {}
        this.eventBus.emit('mode:changed', { mode });
        this._showModeLoadingPlaceholder(mode);
        
        // Mount new mode
        try {
            const mountMode = this._modeMountHandlers[mode];
            if (typeof mountMode !== 'function') {
                console.error(`[LayoutRouter] Unknown mode: ${mode}`);
                return;
            }
            await mountMode(switchToken);
            this._removeTransientModeArtifacts();
        } catch (error) {
            console.error(`[LayoutRouter] Failed to mount mode ${mode}`, error);
            if (mode !== 'advanced') {
                this.mountAdvancedMode();
                this.currentMode = 'advanced';
                this.eventBus.emit('mode:changed', { mode: 'advanced' });
            }
        }
    }
    
    async mountEasyMode(switchToken = this._modeSwitchToken) {
        console.log('[LayoutRouter] Mounting EASY mode...');

        // SHARED CANVAS CONTRACT:
        // Easy mode re-uses the same .goya-canvas-area element as Advanced.
        // LayoutRouter hides toolbar & panels but re-shows canvas-area so the
        // .easy-mode-layout CSS grid can place it at grid-column 2.
        // EasyMode.js must NOT create a second canvas — it relies on this element.
        this._setAdvancedVisible(false);
        this._getCanvasAreaEl()?.classList.remove('hidden');
        
        // Create easy mode container
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const EasyMode = await this._resolveModeClass('easy');
        if (!this._isCurrentSwitch('easy', switchToken)) return;
        workspace.classList.add('easy-mode-layout');

        // Keep-alive: reuse existing instance if available
        if (this._modeCache.easy) {
            this._mountCachedMode('easy', () => new EasyMode(workspace, this.eventBus, this.modules));
            return;
        }
        this._mountCachedMode('easy', () => new EasyMode(workspace, this.eventBus, this.modules));
    }
    
    mountAdvancedMode() {
        console.log('[LayoutRouter] Mounting ADVANCED mode...');
        const workspace = this._getWorkspaceEl();
        workspace?.classList.add('advanced-mode-layout');
        this._setAdvancedVisible(true);
        this.activeModeInstance = this._advancedModeAdapter;
        this._activateModeInstance(this.activeModeInstance);
    }
    
    async mountVideoMode(switchToken = this._modeSwitchToken) {
        console.log('[LayoutRouter] Mounting VIDEO mode...');

        // Hide ALL Advanced DOM so it doesn't bleed into Video grid
        this._setAdvancedVisible(false);
        
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const VideoMode = await this._resolveModeClass('video');
        if (!this._isCurrentSwitch('video', switchToken)) return;
        workspace.classList.add('video-mode-layout');

        // Keep-alive: reuse existing instance if available
        this._mountCachedMode('video', () => new VideoMode(workspace, this.eventBus, this.modules));
    }
    
    async mountVisualMode(switchToken = this._modeSwitchToken) {
        console.log('[LayoutRouter] Mounting VISUAL mode...');

        // Hide ALL Advanced DOM so it doesn't bleed into Visual grid
        this._setAdvancedVisible(false);
        
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const VisualMode = await this._resolveModeClass('visual');
        if (!this._isCurrentSwitch('visual', switchToken)) return;
        workspace.classList.add('visual-mode-layout');

        // Keep-alive: reuse existing instance if available
        this._mountCachedMode('visual', () => new VisualMode(workspace, this.eventBus, this.modules), {
            afterShow: (instance) => {
                const editor = instance?.nodeEditor;
                const isCurrentVisualMount = () => this.currentMode === 'visual' && switchToken === this._modeSwitchToken;
                // Reflow/resize + re-render canvas after display:none.
                // When hidden, getBoundingClientRect() reports 0x0 and NodeEditor.resize()
                // can shrink the canvas to 0. We retry a couple frames to wait for layout.
                const tryResizeRender = (attempt = 0) => {
                    if (!isCurrentVisualMount()) return;
                    try {
                        editor?.resize?.();
                        editor?.render?.();

                        const w = Number(editor?.canvas?.width || 0);
                        const h = Number(editor?.canvas?.height || 0);
                        if ((w <= 0 || h <= 0) && attempt < 3) {
                            requestAnimationFrame(() => tryResizeRender(attempt + 1));
                        }
                    } catch (_e) {
                        if (attempt < 3 && isCurrentVisualMount()) requestAnimationFrame(() => tryResizeRender(attempt + 1));
                    }
                };
                requestAnimationFrame(() => tryResizeRender(0));
            },
        });
    }

    async mountOrchestratorMode(switchToken = this._modeSwitchToken) {
        console.log('[LayoutRouter] Mounting ORCHESTRATOR mode...');

        this._setAdvancedVisible(false);

        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const OrchestratorMode = await this._resolveModeClass('orchestrator');
        if (!this._isCurrentSwitch('orchestrator', switchToken)) return;
        workspace.classList.add('orchestrator-mode-layout');

        this._mountCachedMode('orchestrator', () => new OrchestratorMode(workspace, this.eventBus, this.modules));
    }

    async mountSimulacraMode(switchToken = this._modeSwitchToken) {
        console.log('[LayoutRouter] Mounting SIMULACRA mode...');

        this._setAdvancedVisible(false);

        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        const SimulacraMode = await this._resolveModeClass('simulacra');
        if (!this._isCurrentSwitch('simulacra', switchToken)) return;
        workspace.classList.add('simulacra-mode-layout');

        this._mountCachedMode('simulacra', () => new SimulacraMode(workspace, this.eventBus, this.modules));
    }


}
