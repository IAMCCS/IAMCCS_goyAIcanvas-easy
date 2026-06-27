import UIHelpers from "../utils/UIHelpers.js";
import Constants from "../utils/Constants.js";
import { goyaDebug, goyaDebugError } from '../utils/GoyaDebugLog.js';

export default class CanvasToolbar {
    constructor(hostElement, eventBus, layerManager, bridge, workflowRunner) {
        this.hostElement = hostElement;
        this.eventBus = eventBus;
        this.layerManager = layerManager;
        this.bridge = bridge;
        this.workflowRunner = workflowRunner;
        this.root = UIHelpers.createElement("div", "goya-toolbar-top");
        this.drawOnly = false;
        this.qwenEnabled = true;
        this.sketchHudEnabled = false;
        this._activeMode = 'advanced';
        this._externalCanvasWindow = null;
        this._externalCanvasRefreshPending = false;
        this._externalCanvasPollId = null;
        this._externalCanvasRafId = null;
        this._externalCanvasLiveSource = null;
        this._visualMonitorFeed = null;
        this._portalRoot = this._ensurePortalRoot();
        this._assistantModels = [this.workflowRunner?.getGoyaiAssistantSettings?.()?.model].filter(Boolean);
        this._assistantCurrentModel = this._assistantModels[0] || '';
        this._optionsMenuOpen = false;
        this._optionsSubmenuPortal = null;
        this._boundOutsidePointer = null;
        hostElement.append(this.root);
        this._render();
        this.eventBus.on("bridge:state:pulled", (payload) => this._applyExternalState(payload));
        this.eventBus.on("project:hydrate", (payload) => this._applyExternalState(payload));
        this.eventBus.on("canvas:mode", (payload) => this._applyDrawState(payload));
        this.eventBus.on("canvas:qwen", (payload) => this._applyQwenState(payload));
        this.eventBus.on('mode:changed', ({ mode } = {}) => {
            this._activeMode = String(mode || 'advanced');
            this._requestExternalCanvasRefresh(true);
        });
        this.eventBus.on('visual:output-monitor:feed', (payload) => {
            this._visualMonitorFeed = payload || null;
            this._requestExternalCanvasRefresh(true);
        });
        this.eventBus.on('visual:output-monitor:clear', () => {
            this._visualMonitorFeed = null;
            this._requestExternalCanvasRefresh(true);
        });
        this.eventBus.on("layers:changed", () => this._requestExternalCanvasRefresh());
        this.eventBus.on("layer:patched", () => this._requestExternalCanvasRefresh());
        this.eventBus.on("canvas:resize", () => this._requestExternalCanvasRefresh());
        this.eventBus.on("mask:overlay:changed", () => this._requestExternalCanvasRefresh());
        this.eventBus.on("workflow:complete", () => this._requestExternalCanvasRefresh());
        this.eventBus.on("canvas:stroke:finished", () => this._requestExternalCanvasRefresh(true));
        this.eventBus.on("goyai-assistant:settings", ({ settings } = {}) => {
            const nextModel = String(settings?.model || this._assistantCurrentModel || '');
            this._assistantCurrentModel = nextModel;
            this._render();
        });
        this.eventBus.on("goyai-assistant:models", ({ models } = {}) => {
            const nextModels = Array.isArray(models) ? models.map((item) => String(item || '').trim()).filter(Boolean) : [];
            if (!nextModels.length) return;
            this._assistantModels = nextModels;
            if (!this._assistantModels.includes(this._assistantCurrentModel)) {
                this._assistantCurrentModel = this._assistantModels[0];
            }
            this._render();
        });
        this.eventBus.on('video:workflow:settings', () => {
            this._render();
        });
        this.eventBus.on('backup-settings:theme', ({ theme } = {}) => {
            const nextTheme = String(theme || 'cosmic');
            this._applyTheme(nextTheme);
            this._render();
        });
        this.eventBus.on("canvas:import:files", (payload) => {
            if (!payload) {
                return;
            }
            const files = payload.files instanceof FileList
                ? payload.files
                : (Array.isArray(payload.files) ? payload.files : payload.files?.files);
            if (files) {
                if (payload.replace) {
                    try { this.eventBus.emit("project:clear", { source: payload.source || "canvas-import" }); } catch (_e) {}
                }
                this._consumeFileList(files);
            }
        });
    }

    _applyButtonLayout(value) {
        const v = String(value || 'box');
        this._currentButtonLayout = v;
        const container = this.root?.closest('.goya-root') || document.querySelector('.goya-root');
        if (container) {
            container.classList.toggle('goya-buttons--round', v === 'round');
            container.classList.toggle('goya-buttons--box', v !== 'round');
        }
        try { localStorage.setItem('goya:buttonLayout', v); } catch (_e) {}
    }

    _applyValueBoxStyle(value) {
        const v = String(value || 'default');
        this._currentValueBoxStyle = v;
        const container = this.root?.closest('.goya-root') || document.querySelector('.goya-root');
        if (container) {
            container.classList.toggle('goya-values--white', v === 'white');
            container.classList.toggle('goya-values--train', v === 'train');
            container.classList.toggle('goya-values--gray-all-1', v === 'gray-all-1');
            container.classList.toggle('goya-values--dark-all-1', v === 'dark-all-1');
        }
        try { localStorage.setItem('goya:valueBoxStyle', v); } catch (_e) {}
    }

    _applyFontStyle(value) {
        const v = String(value || 'default');
        this._currentFontStyle = v;
        const container = this.root?.closest('.goya-root') || document.querySelector('.goya-root');
        if (!container) return;
        // Remove all font classes
        container.classList.remove(
            'goya-font--typewriter', 'goya-font--bold-sans', 'goya-font--bold-serif',
            'goya-font--large-sans', 'goya-font--large-serif'
        );
        if (v !== 'default') {
            container.classList.add(`goya-font--${v}`);
        }
        try { localStorage.setItem('goya:fontStyle', v); } catch (_e) {}
    }

    _render() {
        this.root.innerHTML = "";
        this.root.style.overflow = 'visible';
        this.drawButton = UIHelpers.createButton(this._drawLabel(), () => this._toggleDrawMode());
        this.compareButton = UIHelpers.createButton(this._compareLabel(), () => this._toggleCompare());
        this.compareButton.style.marginLeft = "8px";
        this.pencilButton = UIHelpers.createButton(this._pencilLabel(), () => this._togglePencilMode());
        this.pencilButton.style.marginLeft = "8px";
        this.qwenButton = UIHelpers.createButton(this._qwenLabel(), () => this._toggleQwen());
        const clearButton = UIHelpers.createButton("Clear", () => {
            try {
                this.eventBus.emit("project:clear", {});
            } catch (_e) {}
        });
        clearButton.classList.add('goya-button--danger');
        clearButton.style.marginLeft = "6px";

        const themeOptions = [
            { value: "anthracite", label: "Anthracite" },
            { value: "resolve-dark", label: "🎬 DaVinci Resolve Dark" },
            { value: "touchosc-cyber", label: "🎛️ TouchOSC Cyber" },
            { value: "resolve-light", label: "☀️ DaVinci Resolve Light" },
            { value: "midnight-purple", label: "🌙 Midnight Purple" },
            { value: "forest-green", label: "🌲 Forest Green" },
            { value: "reaktor-retro", label: "⚡ Reaktor Retro" },
            { value: "high-contrast", label: "High Contrast" },
            { value: "ableton", label: "Ableton" },
            { value: "dracula", label: "Dracula" },
            { value: "solarized", label: "Solarized Dark" },
            { value: "monokai", label: "Monokai" },
            { value: "slate", label: "Slate" },
            { value: "midnight", label: "Midnight" },
            { value: "neon", label: "Neon" },
            { value: "graphite", label: "Graphite" },
            { value: "emerald", label: "Emerald" },
            { value: "snow", label: "Snow (Light)" },
            { value: "sunset", label: "Sunset" },
            { value: "cyberpunk", label: "Cyberpunk" },
            { value: "forest", label: "Forest" },
            { value: "ocean", label: "Ocean" },
            { value: "iamccs-linear-glass", label: "IAMCCS · Linear Glass" },
            { value: "cosmic", label: "Cosmic IAMCCS (Default)" },
            { value: "horror", label: "Horror" },
            { value: "morrissey", label: "Morrissey" },
            { value: "neon-wave", label: "Neon Wave" },
            { value: "paper", label: "Paper" },
            { value: "glass-mint", label: "Glass Mint" },
            { value: "retro-console", label: "Retro Console" },
            // Additional themes added: 3 planets + 3 videogames
            { value: "planet-mars", label: "Mars (Rosso Solare)" },
            { value: "planet-jupiter", label: "Jupiter (Giove Tempestoso)" },
            { value: "planet-neptune", label: "Neptune (Blu Profondo)" },
            { value: "game-cyberpunk", label: "Cyberpunk (Neon City)" },
            { value: "game-zelda", label: "Zelda (Verdemagia)" },
            { value: "game-doom", label: "Doom (Hellfire)" },
        ];
        const savedTheme = this._currentTheme || ((typeof localStorage !== "undefined" && localStorage.getItem("iamccs_theme")) || "cosmic");
        const sliderStyleOptions = [
            { value: "default", label: "Default" },
            { value: "analogic", label: "Analogic" },
        ];
        const savedSliderStyle = this._currentSliderStyle || ((typeof localStorage !== "undefined" && localStorage.getItem("iamccs_slider_style")) || "default");
        const applySliderStyle = (value) => {
            this._currentSliderStyle = String(value || 'default');
            const container = this.root.closest('.goya-root');
            if (container) {
                container.dataset.slider = this._currentSliderStyle;
            }
            try { window.goyaSliderStyle = this._currentSliderStyle; } catch (_e) {}
            try { localStorage.setItem("iamccs_slider_style", this._currentSliderStyle); } catch (_e) {}
            try { window.dispatchEvent(new CustomEvent('goyaSliderStyleChanged', { detail: { style: this._currentSliderStyle } })); } catch (_e) {}
            try { this.eventBus.emit('ui:sliderStyle:changed', { style: this._currentSliderStyle }); } catch (_e) {}
        };
        applySliderStyle(savedSliderStyle);

        const buttonLayoutOptions = [
            { value: 'box', label: 'Box' },
            { value: 'round', label: 'Round' },
        ];
        const savedButtonLayout = this._currentButtonLayout || ((typeof localStorage !== 'undefined' && localStorage.getItem('goya:buttonLayout')) || 'box');
        this._applyButtonLayout(savedButtonLayout);

        const valueBoxOptions = [
            { value: 'default', label: 'Default' },
            { value: 'white', label: 'White' },
            { value: 'train', label: 'Train Sign' },
            { value: 'gray-all-1', label: 'Gray-All-1' },
            { value: 'dark-all-1', label: 'Dark-All-1' },
        ];
        const savedValueBox = this._currentValueBoxStyle || ((typeof localStorage !== 'undefined' && localStorage.getItem('goya:valueBoxStyle')) || 'default');
        this._applyValueBoxStyle(savedValueBox);

        const savedFont = this._currentFontStyle || ((typeof localStorage !== 'undefined' && localStorage.getItem('goya:fontStyle')) || 'default');
        this._applyFontStyle(savedFont);

        window.goyaSnapMeterEnabled = Boolean(window.goyaSnapMeterEnabled);
        const snapMeterButton = UIHelpers.createButton(window.goyaSnapMeterEnabled ? "Snap Meter: ON" : "Snap Meter: OFF", () => {
            window.goyaSnapMeterEnabled = !window.goyaSnapMeterEnabled;
            snapMeterButton.textContent = window.goyaSnapMeterEnabled ? "Snap Meter: ON" : "Snap Meter: OFF";
            snapMeterButton.classList.toggle("is-active", window.goyaSnapMeterEnabled);
            try { window.dispatchEvent(new CustomEvent('goyaSnapMeterChanged', { detail: { enabled: window.goyaSnapMeterEnabled } })); } catch (_e) {}
        });
        snapMeterButton.style.marginLeft = "8px";
        snapMeterButton.classList.toggle("is-active", window.goyaSnapMeterEnabled);
        this.sketchHudButton = UIHelpers.createButton(this._sketchHudLabel(), () => this._toggleSketchHud());
        this.sketchHudButton.style.marginLeft = "8px";
        this.externalCanvasButton = UIHelpers.createButton(this._externalCanvasLabel(), () => this._toggleExternalCanvasView());
        this.externalCanvasButton.style.marginLeft = "8px";

        const assistantSettings = this.workflowRunner?.getGoyaiAssistantSettings?.() || { model: this._assistantCurrentModel || '' };
        this._assistantCurrentModel = String(assistantSettings.model || this._assistantCurrentModel || '');
        if (!this._assistantModels.length && this._assistantCurrentModel) this._assistantModels = [this._assistantCurrentModel];
        if (!this._assistantModels.includes(this._assistantCurrentModel)) {
            this._assistantModels = [this._assistantCurrentModel, ...this._assistantModels];
        }

        const optionsMenu = this._buildOptionsMenu({
            themeOptions,
            currentTheme: savedTheme,
            sliderStyleOptions,
            currentSliderStyle: savedSliderStyle,
            buttonLayoutOptions,
            currentButtonLayout: savedButtonLayout,
            valueBoxOptions,
            currentValueBox: savedValueBox,
            assistantModels: this._assistantModels,
            currentAssistantModel: this._assistantCurrentModel,
            applySliderStyle,
        });

        this.root.append(this.drawButton, optionsMenu, snapMeterButton, this.compareButton, this.pencilButton, this.sketchHudButton, this.externalCanvasButton, clearButton);
        this._applyTheme(savedTheme);
        try {
            this.sketchHudEnabled = localStorage.getItem('goya:sketchHudEnabled') === 'true';
        } catch (_e) {}
        this._syncSketchHudButton();
        this.eventBus.emit('sketch:hud:set', { enabled: this.sketchHudEnabled });
        this._bindOptionsMenuDismiss();
    }

    _ensurePortalRoot() {
        const existing = this.hostElement?.closest?.('.iamccs-node-ui')?.querySelector?.('.goya-node-floating-root')
            || this.root?.closest?.('.iamccs-node-ui')?.querySelector?.('.goya-node-floating-root');
        if (existing) return existing;
        const host = this.hostElement?.closest?.('.iamccs-node-ui')
            || this.root?.closest?.('.iamccs-node-ui')
            || this.root?.closest?.('.goya-root--embedded')
            || document.body;
        const root = document.createElement('div');
        root.className = 'goya-node-floating-root';
        root.style.position = host === document.body ? 'fixed' : 'absolute';
        root.style.inset = '0';
        root.style.overflow = 'visible';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2147483647';
        host.appendChild(root);
        return root;
    }

    _buildOptionsMenu(config = {}) {
        const wrap = UIHelpers.createElement('div', 'goya-cascade-menu');
        this.optionsMenuWrap = wrap;
        const trigger = UIHelpers.createButton('Options', (event) => this._toggleOptionsMenu(undefined, event?.currentTarget || trigger));
        trigger.classList.add('goya-cascade-menu__trigger');
        trigger.title = 'Options and preferences';
        this._optionsMenuConfig = {
            Theme: {
                currentValue: config.currentTheme,
                options: config.themeOptions || [],
                onSelect: (value) => {
                    this._applyTheme(value);
                    try { localStorage.setItem('iamccs_theme', value); } catch (_e) {}
                    this._render();
                },
            },
            Slider: {
                currentValue: config.currentSliderStyle,
                options: config.sliderStyleOptions || [],
                onSelect: (value) => {
                    config.applySliderStyle?.(value);
                    this._render();
                },
            },
            Buttons: {
                currentValue: config.currentButtonLayout,
                options: config.buttonLayoutOptions || [],
                onSelect: (value) => {
                    this._applyButtonLayout(value);
                    this._render();
                },
            },
            Values: {
                currentValue: config.currentValueBox,
                options: config.valueBoxOptions || [],
                onSelect: (value) => {
                    this._applyValueBoxStyle(value);
                    this._render();
                },
            },
            'Assistant Model': {
                currentValue: config.currentAssistantModel,
                options: (config.assistantModels || []).map((item) => ({ value: item, label: item })),
                onSelect: (value) => {
                    this._assistantCurrentModel = value;
                    this.workflowRunner?.setGoyaiAssistantSettings?.({ model: value });
                    this._render();
                },
            },
            'Assistant Control': {
                currentValue: this.workflowRunner?.getGoyaiAssistantSettings?.()?.authority || 'watcher',
                options: [
                    { value: 'watcher', label: 'Watcher' },
                    { value: 'worker', label: 'Worker' },
                ],
                onSelect: (value) => {
                    this.workflowRunner?.setGoyaiAssistantSettings?.({ authority: value });
                    this._render();
                },
            },
            'Backup Settings': {
                type: 'action',
                description: 'Open runtime workflow settings',
                onAction: () => {
                    this._removeOptionsSubmenuPortal();
                    this._closeOptionsMenu();
                    goyaDebug('backup-settings:menu', 'emitting backup-settings:open', {
                        activeMode: this._activeMode,
                        hostConnected: this.hostElement?.isConnected === true,
                    });
                    try {
                        this.eventBus?.emit?.('backup-settings:open', {});
                    } catch (error) {
                        goyaDebugError('backup-settings:menu', 'emit backup-settings:open failed', error, {
                            activeMode: this._activeMode,
                        });
                    }
                },
            },
        };
        wrap.append(trigger);
        return wrap;
    }

    _labelForOption(options = [], value = '') {
        const match = (options || []).find((item) => String(item?.value || item || '') === String(value || ''));
        return String(match?.label || match?.value || match || value || 'Default');
    }

    _toggleOptionsMenu(force, anchorEl) {
        this._optionsMenuOpen = typeof force === 'boolean' ? force : !this._optionsMenuOpen;
        this.optionsMenuWrap?.classList?.toggle('is-open', this._optionsMenuOpen);
        if (!this._optionsMenuOpen) {
            this._removeOptionsMenuPortal();
            return;
        }
        this._showOptionsMenuPortal(anchorEl || this.optionsMenuWrap?.querySelector('.goya-cascade-menu__trigger'));
    }

    _closeOptionsMenu() {
        this._toggleOptionsMenu(false);
    }

    _showOptionsMenuPortal(anchorEl) {
        this._removeOptionsMenuPortal();
        if (!anchorEl) return;
        const menu = document.createElement('div');
        menu.className = 'goya-options-menu-portal';
        const config = this._optionsMenuConfig || {};
        Object.entries(config).forEach(([label, section]) => {
            const parent = document.createElement('button');
            parent.type = 'button';
            parent.className = 'goya-options-menu-portal__item goya-options-menu-portal__item--parent';
            const isAction = String(section?.type || '') === 'action';
            parent.innerHTML = isAction
                ? `
                    <span class="goya-options-menu-portal__label">${label}</span>
                    <span class="goya-options-menu-portal__meta">
                        <span class="goya-options-menu-portal__current">${this._escape(section?.description || '')}</span>
                    </span>
                `
                : `
                    <span class="goya-options-menu-portal__label">${label}</span>
                    <span class="goya-options-menu-portal__meta">
                        <span class="goya-options-menu-portal__current">${this._labelForOption(section.options || [], section.currentValue)}</span>
                        <span class="goya-options-menu-portal__arrow">›</span>
                    </span>
                `;
            const openSubmenu = () => this._showOptionsSubmenuPortal(parent, label, section);
            if (!isAction) {
                parent.addEventListener('mouseenter', openSubmenu);
                parent.addEventListener('focus', openSubmenu);
            } else {
                parent.addEventListener('mouseenter', () => this._removeOptionsSubmenuPortal());
                parent.addEventListener('focus', () => this._removeOptionsSubmenuPortal());
            }
            parent.addEventListener('click', (event) => {
                event.preventDefault();
                if (isAction) {
                    this._removeOptionsSubmenuPortal();
                    this._closeOptionsMenu();
                    section.onAction?.();
                    return;
                }
                openSubmenu();
            });
            menu.append(parent);
        });
        const rect = anchorEl.getBoundingClientRect();
        const hostRect = this._portalRoot?.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        menu.style.position = 'fixed';
        menu.style.visibility = 'hidden';
        menu.style.zIndex = '2147483647';
        menu.style.pointerEvents = 'auto';
        this._portalRoot.appendChild(menu);
        menu.style.position = this._portalRoot === document.body ? 'fixed' : 'absolute';
        const maxLeft = Math.max(12, hostRect.width - menu.offsetWidth - 12);
        const maxTop = Math.max(12, hostRect.height - menu.offsetHeight - 12);
        const anchorLeft = rect.left - hostRect.left;
        const anchorTop = rect.top - hostRect.top;
        const anchorBottom = rect.bottom - hostRect.top;
        const left = Math.max(12, Math.min(anchorLeft, maxLeft));
        const preferredTop = anchorBottom + 4;
        const top = preferredTop <= maxTop ? preferredTop : Math.max(12, anchorTop - menu.offsetHeight - 4);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.visibility = 'visible';
        this._optionsMenuPortal = menu;
    }

    _showOptionsSubmenuPortal(parentEl, label, section = {}) {
        if (!parentEl || !section) return;
        this._removeOptionsSubmenuPortal();
        const submenu = document.createElement('div');
        submenu.className = 'goya-options-submenu-portal';
        const title = document.createElement('div');
        title.className = 'goya-options-submenu-portal__title';
        title.textContent = label;
        const choices = document.createElement('div');
        choices.className = 'goya-options-submenu-portal__choices';
        (section.options || []).forEach((item) => {
            const value = String(item?.value || item || '');
            const labelText = String(item?.label || item || value);
            const option = document.createElement('button');
            option.type = 'button';
            option.className = `goya-options-submenu-portal__item ${value === String(section.currentValue || '') ? 'active' : ''}`;
            option.textContent = labelText;
            option.addEventListener('click', () => {
                section.onSelect?.(value);
                this._closeOptionsMenu();
            });
            choices.appendChild(option);
        });
        submenu.append(title, choices);

        const parentRect = parentEl.getBoundingClientRect();
        const hostRect = this._portalRoot?.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        submenu.style.position = 'fixed';
        submenu.style.visibility = 'hidden';
        submenu.style.zIndex = '2147483647';
        submenu.style.pointerEvents = 'auto';
        this._portalRoot.appendChild(submenu);
        submenu.style.position = this._portalRoot === document.body ? 'fixed' : 'absolute';

        const preferredLeft = parentRect.right - hostRect.left + 6;
        const fallbackLeft = parentRect.left - hostRect.left - submenu.offsetWidth - 6;
        const maxLeft = Math.max(12, hostRect.width - submenu.offsetWidth - 12);
        const left = preferredLeft <= maxLeft ? preferredLeft : Math.max(12, fallbackLeft);
        const top = Math.max(12, Math.min(parentRect.top - hostRect.top, hostRect.height - submenu.offsetHeight - 12));

        submenu.style.left = `${left}px`;
        submenu.style.top = `${top}px`;
        submenu.style.visibility = 'visible';
        this._optionsSubmenuPortal = submenu;
    }

    _removeOptionsMenuPortal() {
        this._removeOptionsSubmenuPortal();
        try { this._optionsMenuPortal?.remove?.(); } catch (_e) {}
        this._optionsMenuPortal = null;
    }

    _removeOptionsSubmenuPortal() {
        try { this._optionsSubmenuPortal?.remove?.(); } catch (_e) {}
        this._optionsSubmenuPortal = null;
    }

    _bindOptionsMenuDismiss() {
        if (this._boundOutsidePointer) return;
        this._boundOutsidePointer = (event) => {
            if (!this._optionsMenuOpen) return;
            if (this.optionsMenuWrap?.contains(event.target)) return;
            if (this._optionsMenuPortal?.contains(event.target)) return;
            if (this._optionsSubmenuPortal?.contains(event.target)) return;
            this._closeOptionsMenu();
        };
        document.addEventListener('pointerdown', this._boundOutsidePointer);
    }

    _drawLabel() {
        return this.drawOnly ? "Draw Mode: ON" : "Draw Mode: OFF";
    }

    _pencilLabel() {
        return this.pencilEnabled ? "Pencil: ON" : "Pencil: OFF";
    }

    _compareLabel() {
        return this.compareEnabled ? "Compare: ON" : "Compare: OFF";
    }

    _qwenLabel() {
        return this.qwenEnabled ? "Qwen Gen: ON" : "Qwen Gen: OFF";
    }

    _escape(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    _externalCanvasLabel() {
        return this._hasExternalCanvasWindow() ? "Canvas View: ON" : "Canvas View: OFF";
    }

    _sketchHudLabel() {
        return this.sketchHudEnabled ? 'Sketch HUD: ON' : 'Sketch HUD: OFF';
    }

    _toggleDrawMode() {
        this.drawOnly = !this.drawOnly;
        this.drawButton.textContent = this._drawLabel();
        this.eventBus.emit("canvas:mode", { drawOnly: this.drawOnly });
    }

    _toggleSketchHud() {
        this.sketchHudEnabled = !this.sketchHudEnabled;
        try { localStorage.setItem('goya:sketchHudEnabled', String(this.sketchHudEnabled)); } catch (_e) {}
        this._syncSketchHudButton();
        this.eventBus.emit('sketch:hud:set', { enabled: this.sketchHudEnabled });
    }

    async _toggleExternalCanvasView() {
        if (this._hasExternalCanvasWindow()) {
            this._closeExternalCanvasWindow();
            return;
        }
        await this._openExternalCanvasWindow();
    }

    _togglePencilMode() {
        this.pencilEnabled = !this.pencilEnabled;
        this.pencilButton.textContent = this._pencilLabel();
        this.eventBus.emit("input:pencil", { enabled: this.pencilEnabled });
    }

    _toggleCompare() {
        this.compareEnabled = !this.compareEnabled;
        this.compareButton.textContent = this._compareLabel();
        this.eventBus.emit("compare:toggle", { enabled: this.compareEnabled });
    }

    _applyDrawState(payload) {
        if (!payload || typeof payload.drawOnly !== "boolean") {
            return;
        }
        this.drawOnly = payload.drawOnly;
        if (this.drawButton) {
            this.drawButton.textContent = this._drawLabel();
        }
    }

    _toggleQwen() {
        this.qwenEnabled = !this.qwenEnabled;
        this.qwenButton.textContent = this._qwenLabel();
        if (this.workflowRunner) {
            this.workflowRunner.setQwenEnabled(this.qwenEnabled);
        }
        this.eventBus.emit("canvas:qwen", { enabled: this.qwenEnabled });
    }

    _applyQwenState(payload) {
        if (!payload || typeof payload.enabled !== "boolean") {
            return;
        }
        this.qwenEnabled = payload.enabled;
        if (this.workflowRunner) {
            this.workflowRunner.setQwenEnabled(this.qwenEnabled);
        }
        if (this.qwenButton) {
            this.qwenButton.textContent = this._qwenLabel();
        }
    }

    _applyExternalState(payload) {
        if (!payload) {
            return;
        }
        if (typeof payload.qwen_generation_enabled === "boolean") {
            this.qwenEnabled = payload.qwen_generation_enabled;
            if (this.workflowRunner) {
                this.workflowRunner.setQwenEnabled(this.qwenEnabled);
            }
            if (this.qwenButton) {
                this.qwenButton.textContent = this._qwenLabel();
            }
        }
        if (typeof payload.pencil_mode === "boolean") {
            this.pencilEnabled = !!payload.pencil_mode;
            if (this.pencilButton) this.pencilButton.textContent = this._pencilLabel();
            this.eventBus.emit("input:pencil", { enabled: this.pencilEnabled });
        }
        if (typeof payload.theme === "string" && payload.theme) {
            this._applyTheme(payload.theme);
            try { localStorage.setItem("iamccs_theme", payload.theme); } catch (_e) { /* ignore */ }
            this._render();
        }
        // Optional: hydrate compare state if provided by backend
        if (payload?.extra?.compare_enabled !== undefined) {
            this.compareEnabled = !!payload.extra.compare_enabled;
            if (this.compareButton) this.compareButton.textContent = this._compareLabel();
            this.eventBus.emit("compare:toggle", { enabled: this.compareEnabled });
        }
    }

    _hasExternalCanvasWindow() {
        return !!(this._externalCanvasWindow && !this._externalCanvasWindow.closed);
    }

    async _openExternalCanvasWindow() {
        let width = Math.max(640, window.screen?.availWidth || 1280);
        let height = Math.max(480, window.screen?.availHeight || 720);
        let left = (window.screenX || 0) + 40;
        let top = (window.screenY || 0) + 40;

        try {
            if (typeof window.getScreenDetails === 'function') {
                const details = await window.getScreenDetails();
                const currentScreen = details?.currentScreen;
                const secondaryScreen = (details?.screens || []).find((screen) => screen !== currentScreen) || null;
                if (secondaryScreen) {
                    width = Math.max(640, Math.floor(secondaryScreen.availWidth || secondaryScreen.width || width));
                    height = Math.max(480, Math.floor(secondaryScreen.availHeight || secondaryScreen.height || height));
                    left = Math.floor(secondaryScreen.availLeft ?? secondaryScreen.left ?? left);
                    top = Math.floor(secondaryScreen.availTop ?? secondaryScreen.top ?? top);
                }
            }
        } catch (_e) {}

        const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`;
        const viewer = window.open('', 'goya-canvas-external-view', features);
        if (!viewer) {
            return;
        }

        viewer.document.title = 'GoyAIcanvas Viewer';
        viewer.document.body.innerHTML = `
            <div style="margin:0;height:100vh;display:flex;flex-direction:column;font-family:Segoe UI, sans-serif;background:radial-gradient(circle at top, rgba(30,58,95,0.42), transparent 46%),repeating-conic-gradient(#191a22 0% 25%, #14151c 0% 50%) 0 0 / 30px 30px;color:#f0f0f0;">
                <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(8px);background:rgba(8,10,16,0.7);display:flex;justify-content:space-between;align-items:center;gap:12px;">
                    <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">GoyAIcanvas Viewer</div>
                    <div id="goya-external-canvas-meta" style="font-size:11px;color:rgba(240,240,240,0.72);">Workspace View</div>
                </div>
                <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:10px;overflow:hidden;">
                    <div style="width:min(100%, 98vw);height:min(100%, 96vh);border:1px solid rgba(255,255,255,0.08);background:linear-gradient(180deg, rgba(17,20,30,0.9), rgba(10,12,18,0.88));box-shadow:0 24px 80px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.04);border-radius:16px;padding:8px;display:flex;align-items:center;justify-content:center;">
                        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,255,255,0.16);border-radius:12px;background:radial-gradient(circle at center, rgba(255,255,255,0.04), rgba(255,255,255,0.01));padding:8px;position:relative;overflow:hidden;">
                            <div id="goya-external-canvas-empty" style="position:absolute;inset:8px;display:grid;place-items:center;text-align:center;color:rgba(240,240,240,0.48);font-size:18px;line-height:1.5;letter-spacing:0.02em;">Waiting for mode preview…</div>
                            <canvas id="goya-external-canvas-live" style="width:100%;height:100%;object-fit:contain;display:none;box-shadow:0 18px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);background:#111;border-radius:8px;"></canvas>
                            <img id="goya-external-canvas-image" alt="Canvas view" style="width:100%;height:100%;object-fit:contain;display:none;box-shadow:0 18px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);background:#111;border-radius:8px;" />
                        </div>
                    </div>
                </div>
            </div>
        `;
        viewer.addEventListener('beforeunload', () => {
            this._stopExternalCanvasPolling();
            this._externalCanvasWindow = null;
            this._syncExternalCanvasButton();
        });

        this._externalCanvasWindow = viewer;
        this._startExternalCanvasPolling();
        this._syncExternalCanvasButton();
        this._requestExternalCanvasRefresh(true);
    }

    _closeExternalCanvasWindow() {
        this._stopExternalCanvasPolling();
        if (this._externalCanvasWindow && !this._externalCanvasWindow.closed) {
            this._externalCanvasWindow.close();
        }
        this._externalCanvasWindow = null;
        this._syncExternalCanvasButton();
    }

    _syncExternalCanvasButton() {
        if (this.externalCanvasButton) {
            this.externalCanvasButton.textContent = this._externalCanvasLabel();
        }
    }

    _startExternalCanvasPolling() {
        this._stopExternalCanvasPolling();
        const tick = () => {
            if (!this._hasExternalCanvasWindow()) {
                this._stopExternalCanvasPolling();
                return;
            }
            this._renderExternalCanvasFrame();
            this._externalCanvasRafId = window.requestAnimationFrame(tick);
        };
        this._externalCanvasPollId = window.setInterval(() => this._requestExternalCanvasRefresh(true), 600);
        tick();
    }

    _stopExternalCanvasPolling() {
        if (this._externalCanvasPollId) {
            window.clearInterval(this._externalCanvasPollId);
        }
        this._externalCanvasPollId = null;
        if (this._externalCanvasRafId) {
            window.cancelAnimationFrame(this._externalCanvasRafId);
        }
        this._externalCanvasRafId = null;
        this._externalCanvasLiveSource = null;
    }

    _syncSketchHudButton() {
        if (this.sketchHudButton) {
            this.sketchHudButton.textContent = this._sketchHudLabel();
        }
    }

    _requestExternalCanvasRefresh(force = false) {
        if (!this._hasExternalCanvasWindow()) {
            this._syncExternalCanvasButton();
            return;
        }

        const workspacePreview = this._captureWorkspacePreview();

        if (this._activeMode === 'visual') {
            this._updateExternalCanvasWindow(this._captureVisualPreview());
            return;
        }
        if (this._activeMode === 'video') {
            this._updateExternalCanvasWindow(this._captureVideoPreview());
            return;
        }
        if (this._activeMode === 'synapse') {
            this._updateExternalCanvasWindow(this._captureSynapsePreview());
            return;
        }
        if (['simulacra', 'orchestrator'].includes(this._activeMode)) {
            this._updateExternalCanvasWindow({
                src: '',
                meta: `${String(this._activeMode).toUpperCase()} · Preview routing not assigned yet`,
                emptyText: 'This mode does not have a dedicated second-monitor feed yet.',
            });
            return;
        }
        if (workspacePreview?.liveSource) {
            this._updateExternalCanvasWindow(workspacePreview);
            return;
        }

        if (this._externalCanvasRefreshPending && !force) {
            return;
        }
        this._externalCanvasRefreshPending = true;

        let unsubscribe = null;
        unsubscribe = this.eventBus.on('canvas:export:composite:ready', ({ data, error } = {}) => {
            try { unsubscribe?.(); } catch (_e) {}
            this._externalCanvasRefreshPending = false;

            if (!this._hasExternalCanvasWindow()) {
                this._syncExternalCanvasButton();
                return;
            }
            if (!data || error) {
                return;
            }

            try {
                const canvasEl = document.querySelector('#goya-main-canvas');
                const width = Number(canvasEl?.width) || 0;
                const height = Number(canvasEl?.height) || 0;
                const drawOnly = !!this.drawOnly;
                this._updateExternalCanvasWindow({
                    src: data,
                    meta: width > 0 && height > 0
                        ? `${width} x ${height} workspace${drawOnly ? ' · Draw Mode' : ''}`
                        : (drawOnly ? 'Workspace View · Draw Mode' : 'Workspace View'),
                    emptyText: 'Workspace preview unavailable.',
                });
            } catch (_e) {}
        });

        this.eventBus.emit('canvas:export:composite');
    }

    _updateExternalCanvasWindow({ src = '', meta = 'Workspace View', emptyText = 'Preview unavailable.' } = {}) {
        if (!this._hasExternalCanvasWindow()) return;
        try {
            this._externalCanvasLiveSource = arguments[0]?.liveSource || null;
            const liveCanvas = this._externalCanvasWindow.document.getElementById('goya-external-canvas-live');
            const image = this._externalCanvasWindow.document.getElementById('goya-external-canvas-image');
            const metaEl = this._externalCanvasWindow.document.getElementById('goya-external-canvas-meta');
            const empty = this._externalCanvasWindow.document.getElementById('goya-external-canvas-empty');
            if (metaEl) metaEl.textContent = meta;
            if (liveCanvas) {
                liveCanvas.style.display = this._externalCanvasLiveSource ? 'block' : 'none';
                liveCanvas.style.width = '100%';
                liveCanvas.style.height = '100%';
            }
            if (image) {
                if (src) {
                    image.src = src;
                    image.style.display = 'block';
                    image.style.width = '100%';
                    image.style.height = '100%';
                } else {
                    image.removeAttribute('src');
                    image.style.display = 'none';
                }
            }
            if (empty) {
                empty.textContent = emptyText;
                empty.style.display = (src || this._externalCanvasLiveSource) ? 'none' : 'grid';
            }
        } catch (_e) {}
    }

    _renderExternalCanvasFrame() {
        if (!this._hasExternalCanvasWindow()) return;
        const source = this._externalCanvasLiveSource;
        if (!source) return;
        try {
            const target = this._externalCanvasWindow.document.getElementById('goya-external-canvas-live');
            if (!target) return;
            const { width, height } = this._getPreviewSourceSize(source);
            if (!(width > 0 && height > 0)) return;
            if (target.width !== width || target.height !== height) {
                target.width = width;
                target.height = height;
            }
            const ctx = target.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, width, height);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(source, 0, 0, width, height);
        } catch (_e) {}
    }

    _getPreviewSourceSize(source) {
        const tag = String(source?.tagName || '').toLowerCase();
        if (tag === 'canvas') {
            return { width: Number(source.width) || 0, height: Number(source.height) || 0 };
        }
        if (tag === 'video') {
            return { width: Number(source.videoWidth) || 0, height: Number(source.videoHeight) || 0 };
        }
        if (tag === 'img') {
            return { width: Number(source.naturalWidth) || 0, height: Number(source.naturalHeight) || 0 };
        }
        return { width: 0, height: 0 };
    }

    _captureWorkspacePreview() {
        const canvasEl = document.querySelector('#goya-main-canvas');
        const width = Number(canvasEl?.width) || 0;
        const height = Number(canvasEl?.height) || 0;
        if (canvasEl && width > 0 && height > 0) {
            return {
                liveSource: canvasEl,
                meta: `${width} x ${height} workspace${this.drawOnly ? ' · Draw Mode' : ''}`,
                emptyText: 'Workspace preview unavailable.',
            };
        }
        return null;
    }

    _captureVideoPreview() {
        const host = document.querySelector('.video-mode-container:not([style*="display: none"])') || document.querySelector('.video-mode-container');
        if (!host) {
            return {
                src: '',
                meta: 'VIDEO · Program monitor offline',
                emptyText: 'Switch to VIDEO mode to drive the second monitor from the program output.',
            };
        }

        const canvas = host.querySelector('#ve-canvas-program');
        if (canvas && canvas.width > 0 && canvas.height > 0) {
            return {
                liveSource: canvas,
                meta: 'VIDEO · Program monitor',
                emptyText: 'Program monitor unavailable.',
            };
        }

        const image = host.querySelector('#ve-program-surface img');
        if (image?.src) {
            return {
                liveSource: image,
                meta: 'VIDEO · Program still',
                emptyText: 'Program monitor unavailable.',
            };
        }

        const video = host.querySelector('#ve-video-program');
        if (video && video.videoWidth > 0 && video.videoHeight > 0) {
            return {
                liveSource: video,
                meta: 'VIDEO · Program playback',
                emptyText: 'Program monitor unavailable.',
            };
        }

        return {
            src: '',
            meta: 'VIDEO · Awaiting timeline clip',
            emptyText: 'Select or place a clip on the timeline to populate the Program monitor feed.',
        };
    }

    _captureVisualPreview() {
        const host = document.querySelector('.visual-mode-container:not([style*="display: none"])') || document.querySelector('.visual-mode-container');
        if (!host) {
            return {
                src: '',
                meta: 'FIELD · Offline',
                emptyText: 'Switch to FIELD mode to drive the second monitor from the selected preview or field canvas.',
            };
        }

        const monitorSource = this._visualMonitorFeed?.liveSource || this._visualMonitorFeed?.previewCanvas || null;
        const monitorSize = monitorSource ? this._getPreviewSourceSize(monitorSource) : { width: 0, height: 0 };
        if (monitorSource && monitorSize.width > 0 && monitorSize.height > 0) {
            return {
                liveSource: monitorSource,
                meta: this._visualMonitorFeed?.meta || `FIELD · Output Monitor ${monitorSize.width} x ${monitorSize.height}`,
                emptyText: this._visualMonitorFeed?.emptyText || 'FIELD output monitor unavailable.',
            };
        }

        const panelCanvas = host.querySelector('.visual-parameter-panel-host canvas[data-preview-canvas="1"]');
        if (panelCanvas && panelCanvas.width > 0 && panelCanvas.height > 0) {
            return {
                liveSource: panelCanvas,
                meta: `FIELD · Selected node preview ${panelCanvas.width} x ${panelCanvas.height}`,
                emptyText: 'Selected FIELD preview unavailable.',
            };
        }

        const panelImage = host.querySelector('.visual-parameter-panel-host img[data-preview-img="1"]');
        if (panelImage?.src) {
            return {
                liveSource: panelImage,
                meta: 'FIELD · Selected node still',
                emptyText: 'Selected FIELD preview unavailable.',
            };
        }

        const fieldCanvas = host.querySelector('.visual-node-canvas');
        if (fieldCanvas && fieldCanvas.width > 0 && fieldCanvas.height > 0) {
            return {
                liveSource: fieldCanvas,
                meta: `FIELD · Workspace ${fieldCanvas.width} x ${fieldCanvas.height}`,
                emptyText: 'FIELD workspace unavailable.',
            };
        }

        return {
            src: '',
            meta: 'FIELD · Awaiting selected preview',
            emptyText: 'Select a FIELD node with a preview, or render the graph, to populate the second monitor.',
        };
    }

    _captureSynapsePreview() {
        const host = document.querySelector('.synapse-mode-container:not([style*="display: none"])') || document.querySelector('.synapse-mode-container');
        const canvas = host?.querySelector('.synapse-viewport-canvas');
        if (canvas && canvas.width > 0 && canvas.height > 0) {
            return {
                liveSource: canvas,
                meta: `TEKTON · 3D viewport ${canvas.width} x ${canvas.height}`,
                emptyText: 'Tekton viewport unavailable.',
            };
        }
        return {
            src: '',
            meta: 'TEKTON · Viewport standby',
            emptyText: 'Switch to TEKTON mode to mirror the 3D stage on the second monitor.',
        };
    }

    _consumeFileList(fileList) {
        if (!fileList || fileList.length === 0) {
            return;
        }
        const candidates = Array.from(fileList).filter((file) => !file.type || file.type.startsWith("image/"));
        if (candidates.length === 0) {
            console.warn("[GoyaCanvas] Dropped files do not contain images.");
            return;
        }
        
        // Processa tutti i candidati, non solo il primo
        candidates.forEach((file, index) => {
            this._processImageFile(file, index);
        });
    }

    _processImageFile(file, index = 0) {
        this._readFileAsDataURL(file)
            .then((dataUrl) => {
                // Crea sempre un nuovo layer per ogni immagine
                const label = file.name ? file.name.replace(/\s+/g, " ").trim() : `Imported Layer ${index + 1}`;
                const target = this.layerManager.addLayer(label);
                
                if (!target) {
                    return;
                }

                this.layerManager.selectLayer(target.id);
                this.layerManager.snapshot();

                // Ottieni dimensioni originali dell'immagine
                const img = new Image();
                img.onload = () => {
                    const metadata = {
                        source: {
                            type: "import",
                            name: file.name || "image",
                            size: file.size || 0,
                            lastModified: file.lastModified || Date.now(),
                            originalWidth: img.width,
                            originalHeight: img.height,
                        },
                        needsFitToCanvas: img.width !== 1024 || img.height !== 1024,
                    };

                    const patch = { bitmap: dataUrl, metadata };
                    this.layerManager.updateLayer({ id: target.id, patch });
                    
                    this.eventBus.emit("canvas:image:imported", {
                        layerId: target.id,
                        name: file.name || null,
                        size: file.size || 0,
                        originalWidth: img.width,
                        originalHeight: img.height,
                        needsFitToCanvas: metadata.needsFitToCanvas,
                    });
                };
                img.src = dataUrl;
            })
            .catch((error) => {
                console.error("[GoyaCanvas] Failed to import image", error);
            });
    }

    _readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(reader.result));
            reader.addEventListener("error", reject);
            reader.readAsDataURL(file);
        });
    }

    _buildPayload() {
        return {
            width: Constants.CANVAS_WIDTH,
            height: Constants.CANVAS_HEIGHT,
            layers: this.layerManager.getLayers(),
            qwen_generation_enabled: this.qwenEnabled,
        };
    }

    _applyTheme(value) {
        this._currentTheme = String(value || 'cosmic');
        const container = this.root.closest('.goya-root');
        if (!container) return;
        // Remove any previous theme-* class
        [...container.classList].forEach(cls => { if (cls.startsWith('theme-')) container.classList.remove(cls); });
        container.classList.add(`theme-${this._currentTheme}`);
        container.dataset.theme = this._currentTheme;
    }

    _toggleEditor(buttonEl) {
        try {
            const mainContainer = this.root.closest('.goya-root');
            if (!mainContainer) {
                console.warn("[IAMCCS] Main container .goya-root not found");
                return;
            }
            if (!this._editorState) {
                this._editorState = {
                    open: false,
                    backdrop: null,
                    parent: null,
                    nextSibling: null,
                    placeholder: null,
                    wasEmbedded: null,
                };
            }
            if (!this._editorState.open) {
                // Open
                const backdropEl = document.createElement('div');
                backdropEl.className = 'goya-modal-backdrop';
                const modalContent = document.createElement('div');
                modalContent.className = 'goya-modal-content';
                backdropEl.appendChild(modalContent);

                // Save DOM position precisely and leave a placeholder to reduce layout/mutation side-effects.
                this._editorState.parent = mainContainer.parentElement;
                this._editorState.nextSibling = mainContainer.nextSibling;
                this._editorState.wasEmbedded = mainContainer.classList.contains('goya-root--embedded');
                const placeholder = document.createElement('div');
                placeholder.className = 'goya-editor-placeholder';
                placeholder.style.display = 'none';
                if (this._editorState.parent) {
                    this._editorState.parent.insertBefore(placeholder, this._editorState.nextSibling);
                }
                this._editorState.placeholder = placeholder;

                // Move the UI into the modal content to escape any ancestor overflow/transform clipping.
                mainContainer.classList.remove('goya-root--embedded');
                modalContent.appendChild(mainContainer);
                document.body.appendChild(backdropEl);
                this._editorState.open = true;
                this._editorState.backdrop = backdropEl;
                buttonEl.textContent = 'Close editor (ESC)';
                buttonEl.classList.add('is-active');
                // Notify listeners (canvas/view) to recompute layout inside modal
                this.eventBus.emit("ui:editor:open", {});
                requestAnimationFrame(() => this.eventBus.emit("canvas:refresh", {}));
                // ESC to close
                const escHandler = (e) => {
                    if (e.key === 'Escape' && this._editorState.open) {
                        e.preventDefault();
                        this._toggleEditor(buttonEl);
                    }
                };
                backdropEl._escHandler = escHandler;
                document.addEventListener('keydown', escHandler);

                // Click on the dark backdrop closes (but not clicks inside the editor)
                const clickHandler = (e) => {
                    try {
                        if (e.target === backdropEl && this._editorState.open) {
                            e.preventDefault();
                            this._toggleEditor(buttonEl);
                        }
                    } catch (_e) {}
                };
                backdropEl._clickHandler = clickHandler;
                backdropEl.addEventListener('mousedown', clickHandler);
            } else {
                // Close
                const { parent, nextSibling, placeholder, backdrop, wasEmbedded } = this._editorState;
                if (backdrop) {
                    try { document.body.removeChild(backdrop); } catch (_e) {}
                }

                // Restore DOM position (same slot as before open)
                try {
                    if (parent) {
                        if (nextSibling && nextSibling.parentNode === parent) {
                            parent.insertBefore(mainContainer, nextSibling);
                        } else {
                            parent.appendChild(mainContainer);
                        }
                    }
                } catch (_e) {}

                // Restore embedded class to original state
                if (wasEmbedded) {
                    mainContainer.classList.add('goya-root--embedded');
                } else {
                    mainContainer.classList.remove('goya-root--embedded');
                }

                try { placeholder?.remove(); } catch (_e) {}

                if (backdrop && backdrop._escHandler) {
                    document.removeEventListener('keydown', backdrop._escHandler);
                }
                if (backdrop && backdrop._clickHandler) {
                    try { backdrop.removeEventListener('mousedown', backdrop._clickHandler); } catch (_e) {}
                }
                this._editorState.open = false;
                this._editorState.backdrop = null;
                this._editorState.parent = null;
                this._editorState.nextSibling = null;
                this._editorState.placeholder = null;
                this._editorState.wasEmbedded = null;
                buttonEl.textContent = 'Open in editor';
                buttonEl.classList.remove('is-active');
                // Notify listeners (canvas/view) to recompute layout after reparenting
                this.eventBus.emit("ui:editor:close", {});
                // One more tick later to ensure DOM has fully reflowed
                requestAnimationFrame(() => this.eventBus.emit("canvas:refresh", {}));
            }
        } catch (e) {
            console.warn("[IAMCCS] Failed toggling editor", e);
        }
    }
}
