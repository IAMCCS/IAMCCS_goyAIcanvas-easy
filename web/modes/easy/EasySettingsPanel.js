import { loadEasySettings, saveEasySettings } from '../../utils/EasyApi.js';
import { dedupeModelNames, getCompatibleSeedVR2Models, isCompatibleT2IModel, normalizeModelName } from '../../utils/ModelDiscovery.js?v=20260626_EASY_FINAL_POLISH01';

const EMPTY_SETTINGS = {
    zModel: '',
    zClip: '',
    zVae: '',
    fl2Model: '',
    fl2Clip: '',
    fl2Vae: '',
    seedvr2DitModel: '',
    seedvr2VaeModel: '',
    seedMode: 'randomize',
    seedValue: 0,
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildOptions(items, selected, fallbackLabel = 'No models found') {
    const list = dedupeModelNames(items || []);
    const autoSelected = !normalizeModelName(selected);
    const autoOption = `<option value="" ${autoSelected ? 'selected' : ''}>Auto compatible</option>`;
    if (!list.length) {
        return `<option value="">${escapeHtml(fallbackLabel)}</option>`;
    }
    return autoOption + list.map((name) => {
        const isSelected = normalizeModelName(name) === normalizeModelName(selected);
        return `<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)}</option>`;
    }).join('');
}

export default class EasySettingsPanel {
    constructor(eventBus, modules = {}, scopeRoot = document.body) {
        this.eventBus = eventBus;
        this.modules = modules;
        this.scopeRoot = scopeRoot || document.body;
        this.open = false;
        this.loading = false;
        this.error = '';
        this.catalog = {
            zModels: [],
            fl2Models: [],
            clips: [],
            vaes: [],
            seedvr2Models: [],
            seedvr2Vaes: [],
        };
        this.settings = { ...EMPTY_SETTINGS };
        this._unsubs = [];

        this.overlay = document.createElement('div');
        this.overlay.className = 'easy-settings-shell';
        this.overlay.innerHTML = '';
        this.scopeRoot.appendChild(this.overlay);
        this._onOverlayClick = (event) => {
            if (event.target === this.overlay) this.hide();
        };
        this.overlay.addEventListener('click', this._onOverlayClick);

        this._unsubs.push(this.eventBus.on('easy:settings:open', () => this.show()));
        this._unsubs.push(this.eventBus.on('easy:settings:close', () => this.hide()));
        this._unsubs.push(this.eventBus.on('easy:seed:used', ({ seed } = {}) => {
            const value = Math.max(0, Math.floor(Number(seed) || 0));
            if (!value && value !== 0) return;
            this.settings.seedValue = value;
            if (this.open) this.render();
        }));
        this.load();
    }

    async load() {
        this.loading = true;
        this.error = '';
        this.render();
        try {
            const payload = await loadEasySettings();
            this._hydrate(payload);
            this._emitChanged();
        } catch (error) {
            console.warn('[EasySettingsPanel] load failed', error);
            this.error = error?.message || String(error);
        } finally {
            this.loading = false;
            this.render();
        }
    }

    _hydrate(payload = {}) {
        const models = payload.models || {};
        const generationPool = dedupeModelNames([
            ...(models.unet || []),
            ...(models.diffusion_models || []),
            ...(models.checkpoints || []),
        ]);
        this.catalog = {
            zModels: generationPool.filter((name) => isCompatibleT2IModel(name, 'z')),
            fl2Models: generationPool.filter((name) => isCompatibleT2IModel(name, 'fl2')),
            clips: dedupeModelNames(models.clip || []),
            vaes: dedupeModelNames(models.vae || []),
            seedvr2Models: getCompatibleSeedVR2Models(models, generationPool),
            seedvr2Vaes: dedupeModelNames([...(models.seedvr2_vae || []), ...(models.vae || [])]),
        };

        const saved = payload.settings?.generationModels || payload.settings || {};
        this.settings = {
            ...EMPTY_SETTINGS,
            ...saved,
        };
        this.settings.zModel = this._keepInstalled(this.settings.zModel, this.catalog.zModels);
        this.settings.fl2Model = this._keepInstalled(this.settings.fl2Model, this.catalog.fl2Models);
        this.settings.zClip = this._keepInstalled(this.settings.zClip, this.catalog.clips);
        this.settings.fl2Clip = this._keepInstalled(this.settings.fl2Clip, this.catalog.clips);
        this.settings.zVae = this._keepInstalled(this.settings.zVae, this.catalog.vaes);
        this.settings.fl2Vae = this._keepInstalled(this.settings.fl2Vae, this.catalog.vaes);
        this.settings.seedvr2DitModel = this._keepInstalled(this.settings.seedvr2DitModel, this.catalog.seedvr2Models);
        this.settings.seedvr2VaeModel = this._keepInstalled(this.settings.seedvr2VaeModel, this.catalog.seedvr2Vaes);
        this.settings.seedMode = String(this.settings.seedMode || 'randomize') === 'locked' ? 'locked' : 'randomize';
        this.settings.seedValue = Math.max(0, Math.floor(Number(this.settings.seedValue) || 0));
    }

    _keepInstalled(current, items) {
        const normalized = normalizeModelName(current);
        if (normalized && (!items?.length || items.includes(normalized))) return normalized;
        return '';
    }

    _emitChanged() {
        this.eventBus.emit('easy:settings:changed', {
            generationModels: { ...this.settings },
            catalog: { ...this.catalog },
        });
    }

    show() {
        this.open = true;
        this.render();
    }

    hide() {
        this.open = false;
        this.render();
    }

    async save() {
        this.loading = true;
        this.error = '';
        this.render();
        try {
            const payload = await saveEasySettings({ generationModels: { ...this.settings } });
            this._hydrate(payload);
            this._emitChanged();
            this.hide();
            this.eventBus.emit('status:message', 'Easy settings saved');
        } catch (error) {
            console.warn('[EasySettingsPanel] save failed', error);
            this.error = error?.message || String(error);
        } finally {
            this.loading = false;
            this.render();
        }
    }

    render() {
        this.overlay.classList.toggle('is-open', this.open);
        if (!this.open) {
            this.overlay.innerHTML = '';
            return;
        }
        this.overlay.innerHTML = `
            <div class="easy-settings-card">
                <div class="easy-settings-card__head">
                    <div>
                        <div class="easy-settings-card__eyebrow">GoyAIcanvas Easy</div>
                        <h3>Settings</h3>
                    </div>
                    <div class="easy-settings-card__actions">
                        <button type="button" data-action="reload">Reload</button>
                        <button type="button" data-action="close">Close</button>
                    </div>
                </div>
                ${this.error ? `<div class="easy-settings-card__error">${escapeHtml(this.error)}</div>` : ''}
                <div class="easy-settings-grid">
                    ${this._field('Z-Image Model', 'zModel', this.catalog.zModels)}
                    ${this._field('Z-Image CLIP', 'zClip', this.catalog.clips)}
                    ${this._field('Z-Image VAE', 'zVae', this.catalog.vaes)}
                    ${this._field('Flux.2 Model', 'fl2Model', this.catalog.fl2Models)}
                    ${this._field('Flux.2 CLIP', 'fl2Clip', this.catalog.clips)}
                    ${this._field('Flux.2 VAE', 'fl2Vae', this.catalog.vaes)}
                    ${this._field('SeedVR2 DiT Model', 'seedvr2DitModel', this.catalog.seedvr2Models)}
                    ${this._field('SeedVR2 VAE', 'seedvr2VaeModel', this.catalog.seedvr2Vaes)}
                    ${this._seedControls()}
                </div>
                <div class="easy-settings-card__foot">
                    <button type="button" data-action="save" ${this.loading ? 'disabled' : ''}>Save</button>
                </div>
            </div>
        `;
        this.attachListeners();
    }

    _field(label, key, options) {
        return `
            <label class="easy-settings-field">
                <span>${escapeHtml(label)}</span>
                <select data-setting-key="${escapeHtml(key)}">
                    ${buildOptions(options, this.settings[key])}
                </select>
            </label>
        `;
    }

    _seedControls() {
        return `
            <label class="easy-settings-field">
                <span>Seed Mode</span>
                <select data-setting-key="seedMode">
                    <option value="randomize" ${this.settings.seedMode !== 'locked' ? 'selected' : ''}>Randomize</option>
                    <option value="locked" ${this.settings.seedMode === 'locked' ? 'selected' : ''}>Locked</option>
                </select>
            </label>
            <label class="easy-settings-field">
                <span>${this.settings.seedMode === 'locked' ? 'Locked Seed' : 'Last Seed'}</span>
                <input type="number" min="0" step="1" data-setting-key="seedValue" value="${escapeHtml(this.settings.seedValue)}" />
            </label>
        `;
    }

    attachListeners() {
        this.overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => this.hide());
        this.overlay.querySelector('[data-action="reload"]')?.addEventListener('click', () => this.load());
        this.overlay.querySelector('[data-action="save"]')?.addEventListener('click', () => this.save());
        this.overlay.querySelectorAll('[data-setting-key]').forEach((control) => {
            control.addEventListener('change', (event) => {
                const key = event.currentTarget.dataset.settingKey;
                if (!key) return;
                this.settings[key] = key === 'seedValue'
                    ? Math.max(0, Math.floor(Number(event.currentTarget.value) || 0))
                    : event.currentTarget.value;
                this._emitChanged();
            });
        });
    }

    destroy() {
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
        try { this.overlay.removeEventListener('click', this._onOverlayClick); } catch (_e) {}
        this.overlay.remove();
    }
}
