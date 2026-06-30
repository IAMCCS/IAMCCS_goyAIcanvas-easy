/**
 * ModeSwitchBar.js
 * Header bar rendered from ModeRegistry, not hardcoded mode buttons.
 */

import { getModeDefinitions, normalizeMode } from '../core/ModeRegistry.js?v=20260630_EASY_OUTPAINT_ACCEPT02';
import { getGoyaBuildLabel } from '../app/BuildInfo.js?v=20260630_EASY_OUTPAINT_ACCEPT02';

export default class ModeSwitchBar {
    constructor(container, eventBus, initialMode = 'easy') {
        this.container = container;
        this.eventBus = eventBus;
        this.modeDefinitions = getModeDefinitions();
        this.currentMode = normalizeMode(initialMode, 'easy');

        this.render();
        this.attachListeners();

        this.eventBus.on('mode:changed', (data) => {
            const mode = normalizeMode(data?.mode, '');
            if (!mode) return;
            if (this.currentMode === mode) return;
            this.currentMode = mode;
            this.updateActiveButton();
        });
    }

    render() {
        if (!this.container) return;
        const buttons = this.modeDefinitions.map((mode) => {
            const tier = mode.tier ? ` data-tier="${this._escapeAttr(mode.tier)}"` : '';
            return `<button class="goya-button mode-switch-btn" data-mode="${this._escapeAttr(mode.id)}"${tier} type="button">${this._escapeText(mode.label)}</button>`;
        }).join('');

        this.container.innerHTML = `
            <div class="mode-switch-bar" data-goya-build="${this._escapeAttr(getGoyaBuildLabel())}">
                <div class="mode-switch-bar__buttons">${buttons}</div>
            </div>
        `;

        this.updateActiveButton();
    }

    attachListeners() {
        const buttons = this.container?.querySelectorAll?.('.mode-switch-btn') || [];
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                this.switchMode(btn.dataset.mode);
            });
        });
    }

    switchMode(mode) {
        const normalized = normalizeMode(mode, this.currentMode);
        if (this.currentMode === normalized) return;

        this.currentMode = normalized;
        this.updateActiveButton();
        this.eventBus.emit('ui:mode:change', { mode: normalized });
    }

    updateActiveButton() {
        const buttons = this.container?.querySelectorAll?.('.mode-switch-btn') || [];
        buttons.forEach((btn) => {
            const active = btn.dataset.mode === this.currentMode;
            btn.classList.toggle('active', active);
            btn.classList.toggle('goya-button--active', active);
        });
    }

    _escapeText(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    _escapeAttr(value) {
        return this._escapeText(value).replace(/"/g, '&quot;');
    }
}



