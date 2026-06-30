/**
 * EasyPanel.js
 * Main Easy controls for curated intent routing.
 */

import { bakeLayerBitmapOnWhite, findEasyLayer, getEasyRoleForMode } from './easyLayerRuntime.js';
import { getCompatibleSeedVR2Models, isCompatibleT2IModel, normalizeModelName } from '../../utils/ModelDiscovery.js?v=20260626_EASY_FINAL_POLISH01';
import { loadEasySettings } from '../../utils/EasyApi.js';

const EASY_T2I_TEMPLATES = {
    z: {
        label: 'Z-Image',
        scenarioKey: 'z',
        contractId: 'easy_z_txt2img_v1',
        clipType: 'lumina2',
        sampler: 'res_multistep',
        scheduler: 'simple',
        steps: 8,
        cfg: 1.0,
        guidance: null,
        lora1Enabled: false,
        lora1Model: '',
        lora1Strength: 0,
    },
    fl2: {
        label: 'Flux.2 Klein',
        scenarioKey: 'fl2-t',
        contractId: 'easy_flux2_txt2img_v1',
        clipType: 'flux2',
        sampler: 'euler',
        scheduler: 'beta',
        steps: 8,
        cfg: 1.0,
        guidance: 3.5,
        lora1Enabled: false,
        lora1Model: '',
        lora1Strength: 0,
    },
};

const EASY_FL2_EDIT_DEFAULTS = {
    clipType: 'flux2',
    sampler: 'er_sde',
    scheduler: 'simple',
    steps: 8,
    cfg: 1.0,
    guidance: 3.5,
};

const EASY_SEEDVR2_DEFAULTS = {
    ditOffloadDevice: 'cuda:0',
};

const EASY_RANDOM_SEED_MAX = 1125899906842624;

const EASY_LORA_DEFAULTS = {
    lora1Enabled: false,
    lora1Model: '',
    lora1Strength: 1.0,
    lora2Enabled: false,
    lora2Model: '',
    lora2Strength: 1.0,
};

const DIMENSION_PRESETS = [
    { label: '512x512',   w: 512,  h: 512 },
    { label: '768x512',   w: 768,  h: 512 },
    { label: '512x768',   w: 512,  h: 768 },
    { label: '768x768',   w: 768,  h: 768 },
    { label: '1024x1024', w: 1024, h: 1024 },
    { label: '1152x896',  w: 1152, h: 896 },
    { label: '896x1152',  w: 896,  h: 1152 },
    { label: '1280x720',  w: 1280, h: 720 },
    { label: '720x1280',  w: 720,  h: 1280 },
    { label: '1024x768',  w: 1024, h: 768 },
    { label: '768x1024',  w: 768,  h: 1024 },
    { label: '1280x768',  w: 1280, h: 768 },
    { label: '768x1280',  w: 768,  h: 1280 },
    { label: '1536x1024', w: 1536, h: 1024 },
    { label: '1024x1536', w: 1024, h: 1536 },
    { label: '1920x1088', w: 1920, h: 1088 },
    { label: '1088x1920', w: 1088, h: 1920 },
    { label: '2048x2048', w: 2048, h: 2048 },
    { label: '2048x1024', w: 2048, h: 1024 },
    { label: '1024x2048', w: 1024, h: 2048 },
    { label: '1828x1332', w: 1828, h: 1332 },
    { label: '1828x1556', w: 1828, h: 1556 },
    { label: '1920x803',  w: 1920, h: 803 },
    { label: '1998x1080', w: 1998, h: 1080 },
    { label: '2048x858',  w: 2048, h: 858 },
    { label: '2048x1080', w: 2048, h: 1080 },
    { label: '2048x1152', w: 2048, h: 1152 },
    { label: '2048x1556', w: 2048, h: 1556 },
    { label: '768x321',   w: 768,  h: 321 },
    { label: '832x349',   w: 832,  h: 349 },
    { label: '896x375',   w: 896,  h: 375 },
    { label: '960x402',   w: 960,  h: 402 },
    { label: '1024x428',  w: 1024, h: 428 },
    { label: '1280x536',  w: 1280, h: 536 },
    { label: '1536x643',  w: 1536, h: 643 },
    { label: '2048x857',  w: 2048, h: 857 },
];

function formatDimensionPresetLabel({ label, w, h }) {
    const orientation = w === h ? 'SQ' : (w > h ? 'H' : 'V');
    return `${label} - ${orientation}`;
}

export default class EasyPanel {
    constructor(container, eventBus, modules) {
        this.container = container;
        this.eventBus = eventBus;
        this.modules = modules;

        this.state = {
            easyMode: 't2i',
            t2iTemplate: 'z',
            t2iModelChoices: {
                z: '',
                fl2: '',
            },
            t2iModels: {
                z: [],
                fl2: [],
            },
            seedvr2DitChoice: '',
            seedvr2DitModels: [],
            seedvr2VaeModels: [],
            seedMode: 'randomize',
            seedValue: 0,
            clipModels: [],
            vaeModels: [],
            loraModels: [],
            lora1Enabled: EASY_LORA_DEFAULTS.lora1Enabled,
            lora1Model: EASY_LORA_DEFAULTS.lora1Model,
            lora1Strength: EASY_LORA_DEFAULTS.lora1Strength,
            lora2Enabled: EASY_LORA_DEFAULTS.lora2Enabled,
            lora2Model: EASY_LORA_DEFAULTS.lora2Model,
            lora2Strength: EASY_LORA_DEFAULTS.lora2Strength,
            easyBackendSettings: {},
            t2iLoading: false,
            t2iError: '',
            prompt: '',
            negativePrompt: '',
            width: 1024,
            height: 1024,
            resizeImageOnCanvasSize: true,
            resizeKeepProportions: true,
            rescaleReferenceImage: true,
            drawOnly: false,
            outpaintDragSelection: true,
            outpaintPadding: null,
        };

        this._unsubs = [];
        this._bindBusListeners();

        this.refresh();
        this.loadT2IModels();
    }

    _bindBusListeners() {
        const onResize = (payload) => {
            const width = Number(payload?.width);
            const height = Number(payload?.height);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                return;
            }
            if (this.state.width === width && this.state.height === height) {
                return;
            }
            this.state.width = width;
            this.state.height = height;
            this.refresh();
        };
        const onLayersChanged = () => {
            if (this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint') {
                this.refresh();
            }
        };
        const onSelectionSet = (payload = {}) => {
            if (payload.mode !== 'inpaint') return;
            if (this.state.easyMode === 'inpaint') {
                this.refresh();
            }
        };
        const onOutpaintSet = (payload = {}) => {
            if (payload.mode !== 'outpaint') return;
            this.state.outpaintPadding = payload.padding || null;
            if (this.state.easyMode === 'outpaint') {
                this.refresh();
            }
        };
        const onOutpaintReset = () => {
            this._resetOutpaintFrame({ notifyOverlay: false });
        };
        const onCanvasImageChanged = () => {
            this._resetOutpaintFrame();
        };

        this._unsubs.push(this.eventBus.on('canvas:resize', onResize));
        this._unsubs.push(this.eventBus.on('canvas:image:detected', onResize));
        this._unsubs.push(this.eventBus.on('canvas:image:detected', onCanvasImageChanged));
        this._unsubs.push(this.eventBus.on('canvas:image:imported', onCanvasImageChanged));
        this._unsubs.push(this.eventBus.on('canvas:import:files', onCanvasImageChanged));
        this._unsubs.push(this.eventBus.on('layers:changed', onLayersChanged));
        this._unsubs.push(this.eventBus.on('easy:selection:set', onSelectionSet));
        this._unsubs.push(this.eventBus.on('easy:outpaint:set', onOutpaintSet));
        this._unsubs.push(this.eventBus.on('easy:outpaint:reset', onOutpaintReset));
        this._unsubs.push(this.eventBus.on('easy:prompt:update', (patch = {}) => {
            if (typeof patch.prompt === 'string') this.state.prompt = patch.prompt;
            if (typeof patch.negativePrompt === 'string') this.state.negativePrompt = patch.negativePrompt;
        }));
        this._unsubs.push(this.eventBus.on('project:clear', () => {
            this.state.width = 1024;
            this.state.height = 1024;
            this.refresh();
        }));
        this._unsubs.push(this.eventBus.on('canvas:mode', ({ drawOnly } = {}) => {
            this.state.drawOnly = !!drawOnly;
        }));
        this._unsubs.push(this.eventBus.on('easy:settings:changed', (payload = {}) => {
            this.applyEasyBackendSettings(payload.generationModels || payload.settings || {});
            this.refresh();
        }));
        this._unsubs.push(this.eventBus.on('easy:generate:request', () => {
            this.handleGenerate();
        }));
        this._unsubs.push(this.eventBus.on('easy:generate:availability:request', () => {
            this._emitGenerateAvailability();
        }));
    }

    refresh() {
        this.render();
        this.attachListeners();
    }

    _resetOutpaintFrame(options = {}) {
        const hadFrame = !!this.state.outpaintPadding;
        this.state.outpaintPadding = null;
        if (options.notifyOverlay !== false) {
            this.eventBus.emit('easy:selection:clear', { mode: 'outpaint' });
        }
        if (hadFrame && this.state.easyMode === 'outpaint') {
            this.refresh();
        }
    }

    getSelectedT2IModel() {
        return this.state.t2iModelChoices[this.state.t2iTemplate] || '';
    }

    getSelectedEditModel() {
        return this.state.t2iModelChoices.fl2 || '';
    }

    getT2IModelStatusText() {
        if (this.state.t2iLoading) {
            return 'Loading compatible installed models...';
        }
        if (this.state.t2iError) {
            return this.state.t2iError;
        }
        const items = this.state.t2iModels[this.state.t2iTemplate] || [];
        if (!items.length) {
            return `No compatible installed models detected for ${EASY_T2I_TEMPLATES[this.state.t2iTemplate].label}.`;
        }
        return `${items.length} compatible installed model${items.length === 1 ? '' : 's'} available.`;
    }

    canGenerate() {
        const hasFluxRuntimeModels = !!(this.getSelectedEditModel() && this.getSelectedFluxClip() && this.getSelectedFluxVae());
        if (this.state.easyMode === 't2i') {
            return this.state.t2iTemplate === 'z'
                ? !!(this.getSelectedT2IModel() && this.getSelectedZClip() && this.getSelectedZVae())
                : !!(this.getSelectedT2IModel() && this.getSelectedFluxClip() && this.getSelectedFluxVae());
        }
        if (this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint') {
            return hasFluxRuntimeModels;
        }
        if (this.state.easyMode === 'upscale') {
            return !!(this.getSelectedSeedVR2Model() && this.state.easyBackendSettings.seedvr2VaeModel);
        }
        return true;
    }

    getEditModelStatusText() {
        if (this.state.t2iLoading) {
            return 'Loading compatible FL2 models...';
        }
        if (this.state.t2iError) {
            return this.state.t2iError;
        }
        const items = this.state.t2iModels.fl2 || [];
        if (!items.length) {
            return 'No compatible installed Flux.2 models detected for edit workflows.';
        }
        return `${items.length} compatible Flux.2 model${items.length === 1 ? '' : 's'} available for edit workflows.`;
    }

    getSelectedSeedVR2Model() {
        return this.state.seedvr2DitChoice || '';
    }

    getSelectedFluxClip() {
        return this.state.easyBackendSettings.fl2Clip || this.state.clipModels?.[0] || '';
    }

    getSelectedFluxVae() {
        return this.state.easyBackendSettings.fl2Vae || this.state.vaeModels?.[0] || '';
    }

    getSelectedZClip() {
        return this.state.easyBackendSettings.zClip || this.state.clipModels?.[0] || '';
    }

    getSelectedZVae() {
        return this.state.easyBackendSettings.zVae || this.state.vaeModels?.[0] || '';
    }

    getModeLabel(mode = this.state.easyMode) {
        const labels = {
            t2i: 'Text to Image',
            i2i: 'Image to Image',
            draw: 'Draw',
            inpaint: 'Inpaint',
            outpaint: 'Outpaint',
            upscale: 'Upscale',
        };
        return labels[mode] || String(mode || 'Easy');
    }

    getSeedVR2ModelStatusText() {
        if (this.state.t2iLoading) {
            return 'Loading compatible SeedVR2 DiT models...';
        }
        if (this.state.t2iError) {
            return this.state.t2iError;
        }
        const items = this.state.seedvr2DitModels || [];
        if (!items.length) {
            return 'No SeedVR2 DiT models detected.';
        }
        return `${items.length} SeedVR2 DiT model${items.length === 1 ? '' : 's'} available.`;
    }

    getLoraModelStatusText() {
        if (this.state.t2iLoading) {
            return 'Loading installed LoRA models...';
        }
        if (this.state.t2iError) {
            return this.state.t2iError;
        }
        const items = this.state.loraModels || [];
        if (!items.length) {
            return 'No installed LoRA models detected from the shared backend source.';
        }
        return `${items.length} LoRA model${items.length === 1 ? '' : 's'} available for Easy.`;
    }

    async loadT2IModels() {
        this.state.t2iLoading = true;
        this.state.t2iError = '';
        this.refresh();
        try {
            const payload = await loadEasySettings();
            const models = payload.models || {};
            const generationPool = [
                ...(models.unet || []),
                ...(models.diffusion_models || []),
                ...(models.checkpoints || []),
            ].map(normalizeModelName).filter(Boolean);
            const catalog = {
                generationModels: {
                    z: generationPool.filter((name) => isCompatibleT2IModel(name, 'z')),
                    fl2: generationPool.filter((name) => isCompatibleT2IModel(name, 'fl2')),
                },
                seedvr2DitModels: getCompatibleSeedVR2Models(models, generationPool),
                seedvr2VaeModels: [...(models.seedvr2_vae || []), ...(models.vae || [])].map(normalizeModelName).filter(Boolean),
                clipModels: (models.clip || []).map(normalizeModelName).filter(Boolean),
                vaeModels: (models.vae || []).map(normalizeModelName).filter(Boolean),
                loraModels: (models.loras || []).map(normalizeModelName).filter(Boolean),
            };
            this.state.t2iModels = catalog.generationModels;
            this.state.seedvr2DitModels = catalog.seedvr2DitModels;
            this.state.seedvr2VaeModels = catalog.seedvr2VaeModels;
            this.state.clipModels = catalog.clipModels;
            this.state.vaeModels = catalog.vaeModels;
            this.state.loraModels = catalog.loraModels;
            const savedSettings = payload.settings?.generationModels || payload.settings || {};
            this.applyEasyBackendSettings(this.buildRuntimeBackendSettings(savedSettings, catalog));
            this.state.t2iModelChoices = {
                z: this.pickInitialT2IModel('z', catalog.generationModels.z),
                fl2: this.pickInitialT2IModel('fl2', catalog.generationModels.fl2),
            };
            this.state.seedvr2DitChoice = this.pickInitialSeedVR2Model(this.state.seedvr2DitModels);
            this.state.lora1Model = this.state.lora1Enabled ? this.pickInitialLoraModel('lora1Model', this.state.loraModels) : '';
            this.state.lora2Model = this.state.lora2Enabled ? this.pickInitialLoraModel('lora2Model', this.state.loraModels) : '';
        } catch (error) {
            console.warn('[EasyPanel] Failed loading t2i models', error);
            this.state.t2iError = 'Unable to load Easy model settings.';
            this.state.t2iModels = { z: [], fl2: [] };
            this.state.seedvr2DitModels = [];
            this.state.seedvr2VaeModels = [];
            this.state.clipModels = [];
            this.state.vaeModels = [];
            this.state.loraModels = [];
        } finally {
            this.state.t2iLoading = false;
            this.refresh();
        }
    }

    buildRuntimeBackendSettings(settings = {}, catalog = {}) {
        const clean = settings && typeof settings === 'object' ? settings : {};
        const zModels = catalog.generationModels?.z || [];
        const fl2Models = catalog.generationModels?.fl2 || [];
        const clipModels = catalog.clipModels || [];
        const vaeModels = catalog.vaeModels || [];
        const seedvr2DitModels = catalog.seedvr2DitModels || [];
        const seedvr2VaeModels = catalog.seedvr2VaeModels || vaeModels;
        return {
            ...clean,
            zModel: this.pickInstalled(clean.zModel, zModels),
            fl2Model: this.pickInstalled(clean.fl2Model, fl2Models),
            zClip: this.pickInstalled(clean.zClip, clipModels),
            fl2Clip: this.pickInstalled(clean.fl2Clip, clipModels),
            zVae: this.pickInstalled(clean.zVae, vaeModels),
            fl2Vae: this.pickInstalled(clean.fl2Vae, vaeModels),
            seedvr2DitModel: this.pickInstalled(clean.seedvr2DitModel, seedvr2DitModels),
            seedvr2VaeModel: this.pickInstalled(clean.seedvr2VaeModel, seedvr2VaeModels),
            seedMode: String(clean.seedMode || 'randomize') === 'locked' ? 'locked' : 'randomize',
            seedValue: Math.max(0, Math.floor(Number(clean.seedValue) || 0)),
        };
    }

    pickInstalled(current, items = [], fallback = '') {
        const normalized = normalizeModelName(current);
        if (normalized && items.includes(normalized)) return normalized;
        const fallbackName = normalizeModelName(fallback);
        if (fallbackName && items.includes(fallbackName)) return fallbackName;
        return items[0] || '';
    }

    applyEasyBackendSettings(settings = {}) {
        const clean = settings && typeof settings === 'object' ? settings : {};
        this.state.easyBackendSettings = {
            ...(this.state.easyBackendSettings || {}),
            ...clean,
        };
        if (clean.zModel) this.state.t2iModelChoices.z = normalizeModelName(clean.zModel);
        if (clean.fl2Model) this.state.t2iModelChoices.fl2 = normalizeModelName(clean.fl2Model);
        if (clean.seedvr2DitModel) this.state.seedvr2DitChoice = normalizeModelName(clean.seedvr2DitModel);
        this.state.seedMode = String(clean.seedMode || this.state.seedMode || 'randomize') === 'locked' ? 'locked' : 'randomize';
        this.state.seedValue = Math.max(0, Math.floor(Number(clean.seedValue ?? this.state.seedValue) || 0));
    }

    pickInitialT2IModel(templateKey, items) {
        const currentChoice = normalizeModelName(this.state.t2iModelChoices?.[templateKey]);
        if (currentChoice && items.includes(currentChoice)) return currentChoice;
        const runnerChoice = normalizeModelName(this.modules?.workflowRunner?.unetModel);
        if (runnerChoice && items.includes(runnerChoice)) return runnerChoice;
        return items[0] || '';
    }

    pickInitialSeedVR2Model(items) {
        const currentChoice = normalizeModelName(this.state.seedvr2DitChoice);
        if (currentChoice && items.includes(currentChoice)) return currentChoice;
        const runnerChoice = normalizeModelName(this.modules?.workflowRunner?.seedvr2DitModel);
        if (runnerChoice && items.includes(runnerChoice)) return runnerChoice;
        return items[0] || '';
    }

    pickInitialLoraModel(stateKey, items) {
        const currentChoice = normalizeModelName(this.state[stateKey]);
        if (currentChoice && items.includes(currentChoice)) return currentChoice;
        return '';
    }

    getEasyLoraSettings() {
        return {
            lora1Enabled: !!this.state.lora1Enabled && !!this.state.lora1Model,
            lora1Model: String(this.state.lora1Model || ''),
            lora1Strength: Number(this.state.lora1Strength || 0) || EASY_LORA_DEFAULTS.lora1Strength,
            lora2Enabled: !!this.state.lora2Enabled && !!this.state.lora2Model,
            lora2Model: String(this.state.lora2Model || ''),
            lora2Strength: Number(this.state.lora2Strength || 0) || EASY_LORA_DEFAULTS.lora2Strength,
        };
    }

    _buildResizeRequest(width, height) {
        return {
            width,
            height,
            resizeImage: !!this.state.resizeImageOnCanvasSize,
            keepProportions: this.state.resizeKeepProportions !== false,
            source: 'easy-canvas-size',
        };
    }

    _resolveGenerationSeed() {
        if (this.state.seedMode === 'locked') {
            return Math.max(0, Math.floor(Number(this.state.seedValue) || 0));
        }
        const seed = this._createRandomSeed();
        this.state.seedValue = seed;
        this.eventBus.emit('easy:seed:used', {
            seed,
            mode: this.state.easyMode,
            seedMode: 'randomize',
        });
        this.eventBus.emit('status:message', `Seed used: ${seed}`);
        return seed;
    }

    _createRandomSeed() {
        try {
            const cryptoApi = globalThis.crypto;
            if (cryptoApi?.getRandomValues) {
                const values = new Uint32Array(2);
                cryptoApi.getRandomValues(values);
                return Number((BigInt(values[0]) << 20n) ^ (BigInt(values[1]) & 0xfffffn));
            }
        } catch (_error) {}
        return Math.floor((Date.now() * 1009 + Math.random() * EASY_RANDOM_SEED_MAX) % EASY_RANDOM_SEED_MAX);
    }

    applyEasyLoras(wr) {
        const loras = this.getEasyLoraSettings();
        wr.setLora1Enabled?.(loras.lora1Enabled);
        wr.setLora1Model?.(loras.lora1Enabled ? loras.lora1Model : '');
        wr.setLora1Strength?.(loras.lora1Enabled ? loras.lora1Strength : 0);
        wr.setLora2Enabled?.(loras.lora2Enabled);
        wr.setLora2Model?.(loras.lora2Enabled ? loras.lora2Model : '');
        wr.setLora2Strength?.(loras.lora2Enabled ? loras.lora2Strength : 0);
        wr.setLora3Enabled?.(false);
        wr.setLora3Model?.('');
        wr.setLora3Strength?.(0);
        wr.lora3Enabled = false;
        wr.lora3Model = '';
        wr.lora3Strength = 0;
    }

    render() {
        const hasMatchingDimensionPreset = DIMENSION_PRESETS.some((p) => p.w === this.state.width && p.h === this.state.height);
        const presetOpts = `${hasMatchingDimensionPreset ? '' : '<option value="custom" selected>Custom size</option>'}${DIMENSION_PRESETS.map(p =>
            `<option value="${p.w}x${p.h}" ${p.w === this.state.width && p.h === this.state.height ? 'selected' : ''}>${formatDimensionPresetLabel(p)}</option>`
        ).join('')}`;
        const modeItems = [
            { value: 't2i', label: 'Text to Image' },
            { value: 'i2i', label: 'Image to Image' },
            { value: 'draw', label: 'Draw' },
            { value: 'inpaint', label: 'Inpaint (Mask)' },
            { value: 'outpaint', label: 'Outpaint' },
            { value: 'upscale', label: 'Upscale (SeedVR2)' },
        ];
        const modeOpts = modeItems.map(({ value, label }) => `<option value="${value}" ${this.state.easyMode === value ? 'selected' : ''}>${label}</option>`).join('');
        const modeChips = modeItems.map(({ value, label }) => `
            <button type="button" class="easy-panel__mode-chip ${this.state.easyMode === value ? 'is-active' : ''}" data-mode="${value}">
                ${label}
            </button>
        `).join('');
        const templateOpts = Object.entries(EASY_T2I_TEMPLATES)
            .map(([key, template]) => `<option value="${key}" ${this.state.t2iTemplate === key ? 'selected' : ''}>${template.label}</option>`)
            .join('');
        const selectedModel = this.getSelectedT2IModel();
        const selectedEditModel = this.getSelectedEditModel();
        const selectedSeedVR2Model = this.getSelectedSeedVR2Model();
        const selectedTemplate = EASY_T2I_TEMPLATES[this.state.t2iTemplate];
        const loraModelOptions = (this.state.loraModels || [])
            .map((name) => `<option value="${name}" ${this.state.lora1Model === name ? 'selected' : ''}>${name}</option>`)
            .join('');
        const lora2ModelOptions = (this.state.loraModels || [])
            .map((name) => `<option value="${name}" ${this.state.lora2Model === name ? 'selected' : ''}>${name}</option>`)
            .join('');
        const t2iModelOpts = (this.state.t2iModels[this.state.t2iTemplate] || [])
            .map((name) => `<option value="${name}" ${selectedModel === name ? 'selected' : ''}>${name}</option>`)
            .join('');
        const editModelOpts = (this.state.t2iModels.fl2 || [])
            .map((name) => `<option value="${name}" ${selectedEditModel === name ? 'selected' : ''}>${name}</option>`)
            .join('');
        const seedvr2ModelOpts = (this.state.seedvr2DitModels || [])
            .map((name) => `<option value="${name}" ${selectedSeedVR2Model === name ? 'selected' : ''}>${name}</option>`)
            .join('');
        const activeRoute = this.state.easyMode === 't2i'
            ? `${selectedTemplate.label} text to image`
            : this.state.easyMode === 'i2i'
                ? 'Flux.2 image to image'
                : this.state.easyMode === 'draw'
                    ? 'Flux.2 draw to image'
                    : this.state.easyMode === 'inpaint'
                        ? 'Flux.2 inpaint'
                        : this.state.easyMode === 'outpaint'
                            ? 'Flux.2 outpaint'
                            : 'SeedVR2 -> upscale';
        const activeModel = this.state.easyMode === 't2i'
            ? (selectedModel || 'No model selected')
            : this.state.easyMode === 'upscale'
                ? (selectedSeedVR2Model || 'No model selected')
                : (selectedEditModel || 'No model selected');
        const t2iSections = this.state.easyMode === 't2i' ? `
                <div class="easy-panel__field-card easy-panel__field-card--compact">
                    <label>Template Family:</label>
                    <select id="easy-t2i-template" class="easy-panel__dropdown">${templateOpts}</select>
                </div>
        ` : '';
        const showFl2EditModel = this.state.easyMode === 'draw' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint' || this.state.easyMode === 'i2i';
        const editSections = (this.state.easyMode === 'draw' || this.state.easyMode === 'i2i') ? `
                <div class="easy-panel__field-card easy-panel__field-card--compact">
                    <label>Reference Prep:</label>
                    <label class="easy-panel__inline-toggle">
                        <input id="easy-rescale-reference-toggle" type="checkbox" ${this.state.rescaleReferenceImage ? 'checked' : ''} />
                        <span>Rescale reference</span>
                    </label>
                    <div class="easy-panel__field-note">Uses ImageScaleToTotalPixels before Flux.2 img2img to reduce OOM risk.</div>
                </div>
        ` : '';
        const inpaintSections = this.state.easyMode === 'inpaint' ? `
                <div class="easy-panel__field-card easy-panel__field-card--compact">
                    <label>Inpaint Mask:</label>
                    <div class="easy-panel__field-note">Paint the mask with the Brush panel. Use the brush-size slider to control mask width.</div>
                </div>
        ` : '';
        const outpaintPadding = this.state.outpaintPadding || {};
        const outpaintTotal = ['left', 'top', 'right', 'bottom'].reduce((sum, key) => sum + (Number(outpaintPadding[key]) || 0), 0);
        const outpaintSelectionLabel = outpaintTotal > 0
            ? `L${Math.round(outpaintPadding.left || 0)} T${Math.round(outpaintPadding.top || 0)} R${Math.round(outpaintPadding.right || 0)} B${Math.round(outpaintPadding.bottom || 0)}`
            : 'No frame';
        const outpaintSections = this.state.easyMode === 'outpaint' ? `
                <div class="easy-panel__field-card easy-panel__field-card--compact">
                    <label>Outpaint Frame:</label>
                    <div class="easy-panel__selection-row">
                        <button
                            id="easy-outpaint-selection-toggle"
                            type="button"
                            class="easy-panel__button easy-panel__button--secondary ${this.state.outpaintDragSelection ? 'is-active' : ''}"
                            title="Drag an outpaint frame outside the image"
                        >
                            Drag Frame
                        </button>
                        <button
                            id="easy-outpaint-selection-clear"
                            type="button"
                            class="easy-panel__button easy-panel__button--secondary"
                            title="Clear the current outpaint frame"
                        >
                            Clear
                        </button>
                    </div>
                    <div class="easy-panel__field-note">${outpaintSelectionLabel}</div>
                </div>
        ` : '';
        const upscaleSections = this.state.easyMode === 'upscale' ? `
        ` : '';
        const loraSections = this.state.easyMode !== 'upscale' ? `
                <div class="easy-panel__field-card">
                    <label>LoRA Stack:</label>
                    <div class="easy-panel__lora-stack">
                        <div class="easy-panel__lora-row ${this.state.lora1Enabled ? 'is-enabled' : ''}">
                            <label class="easy-panel__lora-toggle">
                                <input id="easy-lora1-enabled" type="checkbox" ${this.state.lora1Enabled ? 'checked' : ''} />
                                <span>LoRA 1</span>
                            </label>
                            <select id="easy-lora1-model" class="easy-panel__dropdown" ${this.state.t2iLoading || !loraModelOptions || !this.state.lora1Enabled ? 'disabled' : ''}>
                                ${loraModelOptions || '<option value="">No LoRA models found</option>'}
                            </select>
                            <div class="easy-panel__lora-strength">
                                <span>Strength</span>
                                <input id="easy-lora1-strength" type="number" class="easy-panel__num-input" min="0" max="2" step="0.05" value="${this.state.lora1Strength}" ${this.state.lora1Enabled ? '' : 'disabled'} />
                            </div>
                        </div>
                        <div class="easy-panel__lora-row ${this.state.lora2Enabled ? 'is-enabled' : ''}">
                            <label class="easy-panel__lora-toggle">
                                <input id="easy-lora2-enabled" type="checkbox" ${this.state.lora2Enabled ? 'checked' : ''} />
                                <span>LoRA 2</span>
                            </label>
                            <select id="easy-lora2-model" class="easy-panel__dropdown" ${this.state.t2iLoading || !lora2ModelOptions || !this.state.lora2Enabled ? 'disabled' : ''}>
                                ${lora2ModelOptions || '<option value="">No LoRA models found</option>'}
                            </select>
                            <div class="easy-panel__lora-strength">
                                <span>Strength</span>
                                <input id="easy-lora2-strength" type="number" class="easy-panel__num-input" min="0" max="2" step="0.05" value="${this.state.lora2Strength}" ${this.state.lora2Enabled ? '' : 'disabled'} />
                            </div>
                        </div>
                    </div>
                    <div class="easy-panel__field-note">${this.getLoraModelStatusText()}</div>
                </div>
        ` : '';

        this.container.innerHTML = `
            <div class="easy-panel easy-panel--workbench">
                <div class="easy-panel__header-simple">
                    <div class="easy-panel__eyebrow">GoyAIcanvas Easy</div>
                    <h3 class="easy-panel__title">Generate</h3>
                    <div class="easy-panel__summary">${activeRoute}</div>
                </div>

                <div class="easy-panel__mode-switch">
                    ${modeChips}
                    <select id="easy-mode-dropdown" class="easy-panel__dropdown easy-panel__dropdown--fallback">${modeOpts}</select>
                </div>

                <div class="easy-panel__stack">
                    <div class="easy-panel__field-card easy-panel__field-card--compact">
                        <label>Canvas Size:</label>
                        <select id="easy-dim-preset" class="easy-panel__dropdown">${presetOpts}</select>
                        <div class="easy-panel__size-row">
                            <div class="easy-panel__mini-field">
                                <span>W</span>
                                <input id="easy-width" type="number" class="easy-panel__num-input" min="128" max="2048" step="64" value="${this.state.width}" />
                            </div>
                            <div class="easy-panel__mini-field">
                                <span>H</span>
                                <input id="easy-height" type="number" class="easy-panel__num-input" min="128" max="2048" step="64" value="${this.state.height}" />
                            </div>
                        </div>
                        <div class="easy-panel__resize-options">
                            <label class="easy-panel__inline-toggle">
                                <input id="easy-resize-image-toggle" type="checkbox" ${this.state.resizeImageOnCanvasSize ? 'checked' : ''} />
                                <span>Resize image</span>
                            </label>
                            <label class="easy-panel__inline-toggle ${this.state.resizeImageOnCanvasSize ? '' : 'is-disabled'}">
                                <input id="easy-keep-proportions-toggle" type="checkbox" ${this.state.resizeKeepProportions ? 'checked' : ''} ${this.state.resizeImageOnCanvasSize ? '' : 'disabled'} />
                                <span>Keep prop</span>
                            </label>
                        </div>
                    </div>

                    ${t2iSections}
                    ${editSections}
                    ${inpaintSections}
                    ${outpaintSections}
                    ${loraSections}
                    ${upscaleSections}
                </div>
            </div>
        `;
        this._emitGenerateAvailability({
            canGenerate: this.canGenerate(),
            activeModel,
            activeRoute,
        });
    }

    _emitGenerateAvailability(payload = {}) {
        const activeModel = payload.activeModel ?? (this.state.easyMode === 't2i'
            ? (this.getSelectedT2IModel() || 'No model selected')
            : this.state.easyMode === 'upscale'
                ? (this.getSelectedSeedVR2Model() || 'No model selected')
                : (this.getSelectedEditModel() || 'No model selected'));
        this.eventBus.emit('easy:generate:availability', {
            canGenerate: payload.canGenerate ?? this.canGenerate(),
            activeModel,
            activeRoute: payload.activeRoute || '',
        });
    }

    attachListeners() {
        const modeDropdown = this.container.querySelector('#easy-mode-dropdown');
        const widthInput = this.container.querySelector('#easy-width');
        const heightInput = this.container.querySelector('#easy-height');
        const dimPreset = this.container.querySelector('#easy-dim-preset');
        const resizeImageToggle = this.container.querySelector('#easy-resize-image-toggle');
        const keepProportionsToggle = this.container.querySelector('#easy-keep-proportions-toggle');
        const rescaleReferenceToggle = this.container.querySelector('#easy-rescale-reference-toggle');
        const modeButtons = this.container.querySelectorAll('.easy-panel__mode-chip');
        const templateDropdown = this.container.querySelector('#easy-t2i-template');
        const modelDropdown = this.container.querySelector('#easy-t2i-model');
        const editModelDropdown = this.container.querySelector('#easy-edit-model');
        const upscaleModelDropdown = this.container.querySelector('#easy-upscale-model');
        const lora1Enabled = this.container.querySelector('#easy-lora1-enabled');
        const lora1Model = this.container.querySelector('#easy-lora1-model');
        const lora1Strength = this.container.querySelector('#easy-lora1-strength');
        const lora2Enabled = this.container.querySelector('#easy-lora2-enabled');
        const lora2Model = this.container.querySelector('#easy-lora2-model');
        const lora2Strength = this.container.querySelector('#easy-lora2-strength');
        const outpaintSelectionToggle = this.container.querySelector('#easy-outpaint-selection-toggle');
        const outpaintSelectionClear = this.container.querySelector('#easy-outpaint-selection-clear');

        dimPreset?.addEventListener('change', (e) => {
            if (e.target.value === 'custom') return;
            const [w, h] = e.target.value.split('x').map(Number);
            if (!Number.isFinite(w) || !Number.isFinite(h)) return;
            this.state.width = w;
            this.state.height = h;
            if (widthInput) widthInput.value = w;
            if (heightInput) heightInput.value = h;
            // Resize the actual drawing canvas
            this.eventBus.emit('canvas:resize:request', this._buildResizeRequest(w, h));
        });

        widthInput?.addEventListener('change', (e) => {
            this.state.width = Math.max(128, Math.min(2048, parseInt(e.target.value) || 1024));
            this.eventBus.emit('canvas:resize:request', this._buildResizeRequest(this.state.width, this.state.height));
        });
        heightInput?.addEventListener('change', (e) => {
            this.state.height = Math.max(128, Math.min(2048, parseInt(e.target.value) || 1024));
            this.eventBus.emit('canvas:resize:request', this._buildResizeRequest(this.state.width, this.state.height));
        });

        resizeImageToggle?.addEventListener('change', (e) => {
            this.state.resizeImageOnCanvasSize = !!e.target.checked;
            this.refresh();
        });

        keepProportionsToggle?.addEventListener('change', (e) => {
            this.state.resizeKeepProportions = !!e.target.checked;
        });

        rescaleReferenceToggle?.addEventListener('change', (e) => {
            this.state.rescaleReferenceImage = !!e.target.checked;
        });

        modeDropdown?.addEventListener('change', (e) => {
            const previousMode = this.state.easyMode;
            this.state.easyMode = e.target.value;
            if (previousMode === 'outpaint' && this.state.easyMode !== 'outpaint') {
                this._resetOutpaintFrame();
            }
            this.eventBus.emit('easy:mode:change', { mode: e.target.value });
            this.eventBus.emit('status:message', `Easy mode changed: ${this.getModeLabel(e.target.value)}`);
            this._syncEasySelectionMode();
            this.refresh();
        });

        modeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (!mode || mode === this.state.easyMode) return;
                const previousMode = this.state.easyMode;
                this.state.easyMode = mode;
                if (previousMode === 'outpaint' && mode !== 'outpaint') {
                    this._resetOutpaintFrame();
                }
                this.eventBus.emit('easy:mode:change', { mode });
                this.eventBus.emit('status:message', `Easy mode changed: ${this.getModeLabel(mode)}`);
                this._syncEasySelectionMode();
                this.refresh();
            });
        });

        outpaintSelectionToggle?.addEventListener('click', () => {
            this.state.outpaintDragSelection = !this.state.outpaintDragSelection;
            this._syncEasySelectionMode();
            this.refresh();
        });

        outpaintSelectionClear?.addEventListener('click', () => {
            this.state.outpaintPadding = null;
            this.eventBus.emit('easy:selection:clear', { mode: 'outpaint' });
        });

        templateDropdown?.addEventListener('change', (e) => {
            this.state.t2iTemplate = e.target.value;
            this.refresh();
        });

        modelDropdown?.addEventListener('change', (e) => {
            this.state.t2iModelChoices[this.state.t2iTemplate] = e.target.value;
        });

        editModelDropdown?.addEventListener('change', (e) => {
            this.state.t2iModelChoices.fl2 = e.target.value;
        });

        upscaleModelDropdown?.addEventListener('change', (e) => {
            this.state.seedvr2DitChoice = e.target.value;
        });

        lora1Enabled?.addEventListener('change', (e) => {
            this.state.lora1Enabled = !!e.target.checked;
            this.refresh();
        });

        lora1Model?.addEventListener('change', (e) => {
            this.state.lora1Model = e.target.value;
        });

        lora1Strength?.addEventListener('change', (e) => {
            this.state.lora1Strength = Number(e.target.value || EASY_LORA_DEFAULTS.lora1Strength) || EASY_LORA_DEFAULTS.lora1Strength;
        });

        lora2Enabled?.addEventListener('change', (e) => {
            this.state.lora2Enabled = !!e.target.checked;
            this.refresh();
        });

        lora2Model?.addEventListener('change', (e) => {
            this.state.lora2Model = e.target.value;
        });

        lora2Strength?.addEventListener('change', (e) => {
            this.state.lora2Strength = Number(e.target.value || EASY_LORA_DEFAULTS.lora2Strength) || EASY_LORA_DEFAULTS.lora2Strength;
        });

    }

    async commitDrawModeSource() {
        const drawLayer = findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('draw'));
        const surfaceKind = String(drawLayer?.metadata?.easyDrawSurface || '');
        if (!drawLayer || !drawLayer.bitmap || (surfaceKind !== 'white' && surfaceKind !== 'baked-white')) {
            return false;
        }
        return bakeLayerBitmapOnWhite(this.modules?.layerManager, drawLayer.id, {
            width: this.state.width,
            height: this.state.height,
        });
    }

    _syncEasySelectionMode() {
        if (this.state.easyMode === 'outpaint') {
            this.eventBus.emit('easy:selection:enable', {
                mode: 'outpaint',
                enabled: !!this.state.outpaintDragSelection,
            });
            return;
        }
        this.eventBus.emit('easy:selection:enable', {
            mode: 'inpaint',
            enabled: false,
        });
    }

    _isImageDataUrl(value) {
        return typeof value === 'string' && value.startsWith('data:image/');
    }

    _getLayerSourceImageDataUrl() {
        const layerManager = this.modules?.layerManager;
        const layers = layerManager?.getLayers?.() || [];
        const activeLayer = layerManager?.getActiveLayer?.() || null;
        const candidates = [
            activeLayer,
            findEasyLayer(layerManager, getEasyRoleForMode('draw')),
            findEasyLayer(layerManager, getEasyRoleForMode('i2i')),
            ...layers.slice().reverse().filter((layer) => layer?.visible !== false),
            ...layers.slice().reverse(),
        ];
        const match = candidates.find((layer) => this._isImageDataUrl(layer?.bitmap));
        return match?.bitmap || '';
    }

    _getEasySourceImageDataUrl(options = {}) {
        const forceComposite = !!options.forceComposite;
        const preferLayerSource = !!options.preferLayerSource;
        const preferDrawSource = !!options.preferDrawSource;
        if (forceComposite) {
            try {
                const composite = this.modules?.canvasView?.exportComposite?.();
                if (this._isImageDataUrl(composite)) {
                    return composite;
                }
            } catch (_e) {}
        }
        if (preferDrawSource) {
            const drawLayer = findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('draw'));
            if (this._isImageDataUrl(drawLayer?.bitmap)) {
                return drawLayer.bitmap;
            }
            if (options.requireDrawSource) {
                return '';
            }
        }
        if (preferLayerSource) {
            const layerSource = this._getLayerSourceImageDataUrl();
            if (this._isImageDataUrl(layerSource)) {
                return layerSource;
            }
        }

        try {
            const composite = this.modules?.canvasView?.exportComposite?.();
            if (this._isImageDataUrl(composite)) {
                return composite;
            }
        } catch (_e) {}

        return this._getLayerSourceImageDataUrl();
    }

    async _waitForCanvasCompositeReady() {
        await new Promise((resolve) => {
            try {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            } catch (_error) {
                setTimeout(resolve, 60);
            }
        });
    }

    _getEasyMaskImageDataUrl() {
        const maskLayer = findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('inpaint'));
        if (this._isImageDataUrl(maskLayer?.mask)) return maskLayer.mask;
        if (this._isImageDataUrl(maskLayer?.bitmap)) return maskLayer.bitmap;
        return '';
    }

    async handleGenerate() {
        console.log('[EasyPanel] Generate clicked', this.state);
        const wr = this.modules.workflowRunner;
        if (!wr) {
            console.error('[EasyPanel] WorkflowRunner not available');
            return;
        }
        if (!this.canGenerate()) {
            console.warn('[EasyPanel] Generate aborted: no compatible t2i model selected');
            return;
        }

        if (this.state.drawOnly || this.state.easyMode === 'draw') {
            await this.commitDrawModeSource();
            this.eventBus.emit('canvas:mode', { drawOnly: false });
            await this._waitForCanvasCompositeReady();
        }

        // Keep shared prompt fields in sync for the workflow runner.
        this.eventBus.emit('prompt:global:update', {
            positive: this.state.prompt,
            negative: this.state.negativePrompt,
            source: 'easy',
        });
        // Apply canvas dimensions
        wr._generationSource = 'easy';
        wr.easyCanvasWidth = this.state.width;
        wr.easyCanvasHeight = this.state.height;
        wr.canvasWidth = this.state.width;
        wr.canvasHeight = this.state.height;

        this.applyEasyLoras(wr);

        if (this.state.easyMode === 't2i') {
            this.applyT2ITemplate(wr);
        } else if (this.state.easyMode === 'draw') {
            this.applyFl2EditTemplate(wr, 'fl2-s');
        } else if (this.state.easyMode === 'i2i') {
            this.applyFl2EditTemplate(wr, 'fl2-s');
        } else if (this.state.easyMode === 'inpaint') {
            const maskLayer = findEasyLayer(this.modules?.layerManager, getEasyRoleForMode('inpaint'));
            if (!maskLayer || !maskLayer.mask) {
                this.eventBus.emit('status:message', 'Easy inpaint: paint a red mask before generating for a meaningful result.');
            }
            this.applyFl2EditTemplate(wr, 'fl2-i');
        } else if (this.state.easyMode === 'outpaint') {
            const padding = this.state.outpaintPadding || {};
            const total = ['left', 'top', 'right', 'bottom'].reduce((sum, key) => sum + (Number(padding[key]) || 0), 0);
            if (total <= 0) {
                this.eventBus.emit('status:message', 'Easy outpaint: drag a frame outside the image before generating.');
            }
            this.applyFl2EditTemplate(wr, 'fl2-o');
        } else if (this.state.easyMode === 'upscale') {
            this.applyUpscaleTemplate(wr);
        }
        const generationSeed = this._resolveGenerationSeed();
        wr.setSeed?.(generationSeed);

        this.eventBus.emit('workflow:params:changed');

        const selectedGenerationModel = this.state.easyMode === 't2i'
            ? this.getSelectedT2IModel()
            : (this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint' ? this.getSelectedEditModel() : '');
        const activeT2ITemplate = this.state.easyMode === 't2i'
            ? EASY_T2I_TEMPLATES[this.state.t2iTemplate]
            : EASY_FL2_EDIT_DEFAULTS;
        const activeVaeModel = this.state.easyMode === 't2i' && this.state.t2iTemplate === 'z'
            ? this.getSelectedZVae()
            : this.getSelectedFluxVae();
        const activeClipModel = this.state.easyMode === 't2i' && this.state.t2iTemplate === 'z'
            ? this.getSelectedZClip()
            : this.getSelectedFluxClip();

        const activeContractId = '';
        const generationMode = this.state.easyMode === 'draw' ? 'i2i' : this.state.easyMode;
        const executionPayload = {
            source: 'easy',
            intentMode: this.state.easyMode,
            templateKey: this.state.easyMode === 't2i' ? this.state.t2iTemplate : generationMode,
            scenarioKey: this.state.easyMode === 't2i'
                ? EASY_T2I_TEMPLATES[this.state.t2iTemplate].scenarioKey
                : (this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint'
                    ? generationMode
                    : 'up'),
            generationContract: activeContractId,
            workflowContract: activeContractId,
            modelChoice: selectedGenerationModel,
            generationModel: selectedGenerationModel,
            vaeModel: activeVaeModel,
            clipModel: activeClipModel,
            clipType: activeT2ITemplate?.clipType || EASY_FL2_EDIT_DEFAULTS.clipType,
            sampler: activeT2ITemplate?.sampler || EASY_FL2_EDIT_DEFAULTS.sampler,
            scheduler: activeT2ITemplate?.scheduler || EASY_FL2_EDIT_DEFAULTS.scheduler,
            prompt: this.state.prompt,
            negativePrompt: this.state.negativePrompt,
            seed: generationSeed,
            width: this.state.width,
            height: this.state.height,
            rescaleReferenceImage: this.state.rescaleReferenceImage !== false,
            ...this.getEasyLoraSettings(),
        };

        this.eventBus.emit('easy:generate', executionPayload);

        // Trigger generation
        wr._generationSource = 'easy';
        if ((this.state.easyMode === 'draw' || this.state.easyMode === 'i2i' || this.state.easyMode === 'inpaint' || this.state.easyMode === 'outpaint') && typeof wr.executeEasyStandalone === 'function') {
            await this._waitForCanvasCompositeReady();
            executionPayload.sourceImageDataUrl = this._getEasySourceImageDataUrl({
                preferLayerSource: this.state.easyMode === 'outpaint',
                forceComposite: this.state.easyMode !== 'outpaint',
                preferDrawSource: false,
            });
            if (this.state.easyMode === 'inpaint') {
                executionPayload.maskImageDataUrl = this._getEasyMaskImageDataUrl();
            }
            if (this.state.easyMode === 'outpaint') {
                executionPayload.outpaintPadding = this.state.outpaintPadding || null;
            }
            await wr.executeEasyStandalone(executionPayload);
            return;
        }
        if (this.state.easyMode === 'upscale' && typeof wr.executeEasyUpscaleStandalone === 'function') {
            executionPayload.sourceImageDataUrl = this._getEasySourceImageDataUrl();
            executionPayload.seedvr2DitModel = this.getSelectedSeedVR2Model();
            executionPayload.seedvr2VaeModel = this.state.easyBackendSettings.seedvr2VaeModel || '';
            await wr.executeEasyUpscaleStandalone(executionPayload);
            return;
        }
        if (this.state.easyMode === 't2i' && typeof wr.executeEasyZImageStandalone === 'function') {
            const zModel = this.state.t2iModelChoices.z || this.getSelectedT2IModel();
            if (!zModel) {
                this.eventBus.emit('status:message', 'Easy Text to Image: choose an installed Z-Image model in Settings.');
                return;
            }
            await wr.executeEasyZImageStandalone({
                ...executionPayload,
                templateKey: 'z',
                scenarioKey: 'z',
                modelChoice: zModel,
                generationModel: zModel,
                clipModel: this.getSelectedZClip(),
                vaeModel: this.getSelectedZVae(),
                clipType: EASY_T2I_TEMPLATES.z.clipType,
                sampler: EASY_T2I_TEMPLATES.z.sampler,
                scheduler: EASY_T2I_TEMPLATES.z.scheduler,
            });
            return;
        }
        this.eventBus.emit('workflow:execute', executionPayload);
    }

    resetEasyNonUpscaleState(wr, options = {}) {
        wr.upscaleExtras = {};
        wr.seedvr2Params = {};
        wr.seedvr2Enabled = false;
        wr.z3ControlNetEnabled = false;
        if (options.resetZCheckpoint) {
            wr.zUseCheckpoint = false;
            wr.zCheckpointName = '';
        }
    }

    applyT2ITemplate(wr) {
        const templateKey = this.state.t2iTemplate;
        const template = EASY_T2I_TEMPLATES[templateKey];
        const chosenModel = this.getSelectedT2IModel();

        wr.setUpscaleEnabled?.(false);
        this.resetEasyNonUpscaleState(wr, { resetZCheckpoint: templateKey === 'z' });
        wr.setClip2Enabled?.(false);
        wr.setClip2Model?.('');
        wr.setSeed?.(-1);
        wr.setSteps?.(template.steps);
        wr.setCfg?.(template.cfg);
        wr.setSampler?.(template.sampler);
        wr.setScheduler?.(template.scheduler);
        wr.setAcceleratorEnabled?.(true);
        wr.setFp16AccumulationEnabled?.(true);
        wr.setLora3Enabled?.(false);

        if (templateKey === 'z') {
            wr.setEngine?.('z');
            wr.activePanel = 'z';
            wr.fl2PanelScenario = null;
            wr.setClipType?.(template.clipType);
            wr.setUnetModel?.(chosenModel);
            wr.setVaeModel?.(this.getSelectedZVae());
            wr.setClip1Model?.(this.getSelectedZClip());
            wr.setGlobalGuidance?.(1.0);
            wr.setAuraFlowShift?.(3);
            wr.setZBatchSize?.(1);
            wr.z3ControlNetEnabled = false;
            this.applyEasyLoras(wr);
            wr.setLora3Enabled?.(false);
            wr.setLora3Model?.('');
            wr.setLora3Strength?.(0);
            this.eventBus.emit('engine:changed', 'z');
        } else {
            wr.setEngine?.('flux');
            wr.activePanel = 'fl2';
            wr.fl2PanelScenario = 'fl2-t';
            wr.z3ControlNetEnabled = false;
            wr.setClipType?.(template.clipType);
            wr.setUnetModel?.(chosenModel);
            wr.setVaeModel?.(this.getSelectedFluxVae());
            wr.setClip1Model?.(this.getSelectedFluxClip());
            wr.setGlobalGuidance?.(template.guidance);
            this.applyEasyLoras(wr);
            wr.setLora3Enabled?.(false);
            wr.setLora3Model?.('');
            wr.setLora3Strength?.(0);
            this.eventBus.emit('engine:changed', 'fl2');
        }

        console.log('[EasyPanel] Dispatching t2i template', {
            templateKey,
            scenarioKey: template.scenarioKey,
            model: chosenModel,
        });
    }

    applyFl2EditTemplate(wr, scenarioKey) {
        const chosenModel = this.getSelectedEditModel();
        wr.setUpscaleEnabled?.(false);
        this.resetEasyNonUpscaleState(wr);
        wr.setEngine?.('flux');
        wr.activePanel = 'fl2';
        wr.fl2PanelScenario = scenarioKey;
        wr.setClipType?.(EASY_FL2_EDIT_DEFAULTS.clipType);
        wr.setUnetModel?.(chosenModel);
        wr.setVaeModel?.(this.getSelectedFluxVae());
        wr.setClip1Model?.(this.getSelectedFluxClip());
        wr.setClip2Enabled?.(false);
        wr.setClip2Model?.('');
        wr.setSeed?.(-1);
        wr.setSteps?.(EASY_FL2_EDIT_DEFAULTS.steps);
        wr.setCfg?.(EASY_FL2_EDIT_DEFAULTS.cfg);
        wr.setSampler?.(EASY_FL2_EDIT_DEFAULTS.sampler);
        wr.setScheduler?.(EASY_FL2_EDIT_DEFAULTS.scheduler);
        wr.setGlobalGuidance?.(EASY_FL2_EDIT_DEFAULTS.guidance);
        this.applyEasyLoras(wr);
        wr.setLora3Enabled?.(false);
        wr.setLora3Model?.('');
        wr.setLora3Strength?.(0);
        wr.setAcceleratorEnabled?.(true);
        wr.setFp16AccumulationEnabled?.(true);
        this.eventBus.emit('engine:changed', 'fl2');
    }

    applyUpscaleTemplate(wr) {
        const chosenSeedVR2Model = this.getSelectedSeedVR2Model();
        wr.setEngine?.('upscale');
        wr.setUpscaleMode?.('seedvr2', { panelSubmode: 'seedvr2', silent: true });
        wr.setUpscalePanelSubmode?.('seedvr2', { silent: true });
        wr.setSeedVR2Enabled?.(true, { silent: true });
        wr.setUpscaleEnabled?.(true);
        wr.activePanel = 'seedvr2';
        wr.setSeedVR2DitModel?.(chosenSeedVR2Model);
        wr.seedvr2VaeModel = this.state.easyBackendSettings.seedvr2VaeModel || '';
        wr.setUpscaleValue?.('seedvr2_vae_model', wr.seedvr2VaeModel);
        wr.setUpscaleValue?.('seedvr2_dit_offload_device', EASY_SEEDVR2_DEFAULTS.ditOffloadDevice);
        this.eventBus.emit('engine:changed', 'upscale');
    }

    cleanup() {
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
        this.eventBus.emit('easy:selection:enable', { mode: 'inpaint', enabled: false });
        this.eventBus.emit('easy:selection:enable', { mode: 'outpaint', enabled: false });
    }
}

