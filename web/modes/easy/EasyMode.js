export default class EasyMode {
    constructor(workspace, eventBus, modules) {
        this.workspace = workspace;
        this.eventBus = eventBus;
        this.modules = modules;
        this.instance = null;
        this.disposed = false;
        this.container = document.createElement('div');
        this.container.className = 'easy-mode-container easy-mode-container--loading';
        this.container.innerHTML = `
            <section class="goya-mode-loading">
                <strong>EASY</strong>
                <span>Loading workspace...</span>
            </section>
        `;
        this.workspace?.appendChild?.(this.container);
        this._load();
    }

    async _load() {
        try {
            const module = await import('./EasyModeFull.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02');
            if (this.disposed) return;
            const FullMode = module?.default;
            if (typeof FullMode !== 'function') throw new Error('full mode export missing');
            const placeholder = this.container;
            this.instance = new FullMode(this.workspace, this.eventBus, this.modules);
            this.container = this.instance?.container || placeholder;
            placeholder?.remove?.();
        } catch (error) {
            console.error('[EasyMode] lazy load failed', error);
            if (this.container) {
                this.container.innerHTML = `
                    <section class="goya-mode-loading goya-mode-loading--error">
                        <strong>EASY</strong>
                        <span>Workspace failed to load. Check console/backend logs.</span>
                    </section>
                `;
            }
        }
    }

    activate() {
        this.instance?.activate?.();
    }

    deactivate() {
        this.instance?.deactivate?.();
    }

    cleanup() {
        this.disposed = true;
        this.instance?.cleanup?.();
        this.container?.remove?.();
        this.container = null;
    }
}


