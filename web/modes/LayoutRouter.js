import { loadModeModule, normalizeMode, shouldReuseMode } from "../core/ModeRegistry.js?v=20260630_EASY_OUTPAINT_CONDITIONING01";

export default class LayoutRouter {
    constructor(eventBus, modules, options = {}) {
        this.eventBus = eventBus;
        this.modules = modules;
        this.options = options;
        this.currentMode = null;
        this.activeModeInstance = null;
        this._modeCache = {};
        this._modeClassCache = {};
        this._modeSwitchToken = 0;
        this.eventBus.on("ui:mode:change", () => { void this.switchMode("easy"); });
    }

    async _resolveModeClass(mode) {
        const normalized = normalizeMode(mode, "easy");
        if (this._modeClassCache[normalized]) return this._modeClassCache[normalized];
        const module = await loadModeModule(normalized);
        const ModeClass = module?.default;
        if (typeof ModeClass !== "function") throw new Error(`[LayoutRouter] Mode ${normalized} did not export a default class.`);
        this._modeClassCache[normalized] = ModeClass;
        return ModeClass;
    }

    async switchMode() {
        const mode = "easy";
        const switchToken = ++this._modeSwitchToken;
        this.currentMode = mode;
        this.eventBus.emit("mode:changed", { mode });
        await this.mountEasyMode(switchToken);
    }

    async mountEasyMode(switchToken = this._modeSwitchToken) {
        const workspace = this._getWorkspaceEl();
        if (!workspace) return;
        this._setEasyVisible(true);
        workspace.classList.add("easy-mode-layout");
        const EasyMode = await this._resolveModeClass("easy");
        if (switchToken !== this._modeSwitchToken) return;
        if (shouldReuseMode("easy") && this._modeCache.easy) {
            this.activeModeInstance = this._modeCache.easy;
            this.activeModeInstance.container.style.display = "";
            this.activeModeInstance.activate?.();
            return;
        }
        this.activeModeInstance = new EasyMode(workspace, this.eventBus, this.modules);
        if (shouldReuseMode("easy")) this._modeCache.easy = this.activeModeInstance;
        this.activeModeInstance.activate?.();
    }

    _getScopeRoot() { return this.options?.scope || document; }
    _getWorkspaceEl() { return this.modules?.workspace || this._getScopeRoot().querySelector(".goya-workspace"); }
    _getCanvasAreaEl() { return this.modules?.canvasArea || this._getScopeRoot().querySelector(".goya-canvas-area"); }
    _getToolbarEl() { return this.modules?.toolbarHost || this._getScopeRoot().querySelector(".goya-toolbar"); }
    _getPanelsEl() { return this.modules?.panelsHost || this._getScopeRoot().querySelector(".goya-panels"); }
    _getLeftRailEl() { return this.modules?.leftRail || this._getScopeRoot().querySelector(".goya-side-rail--left"); }
    _getRightRailEl() { return this.modules?.rightRail || this._getScopeRoot().querySelector(".goya-side-rail--right"); }

    _setEasyVisible(visible) {
        const method = visible ? "remove" : "add";
        this._getCanvasAreaEl()?.classList[method]("hidden");
        this._getToolbarEl()?.classList.add("hidden");
        this._getPanelsEl()?.classList.add("hidden");
        this._getLeftRailEl()?.classList.add("hidden");
        this._getRightRailEl()?.classList.add("hidden");
    }

    cleanup() {
        Object.values(this._modeCache || {}).forEach((instance) => {
            try { instance?.cleanup?.(); } catch (_e) {}
        });
        this._modeCache = {};
        this.activeModeInstance = null;
    }
}


