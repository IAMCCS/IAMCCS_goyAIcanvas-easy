import Constants from "../utils/Constants.js";
import { loadEasyWorkflow, saveEasyAsset } from "../utils/EasyApi.js";

const EASY_OUTPUT_PREFIX = "goya_output";
const EASY_RANDOM_SEED_MAX = 1125899906842624;

export default class WorkflowRunner {
    constructor(eventBus, bridge, layerManager, promptManager, maskManager) {
        this.eventBus = eventBus;
        this.bridge = bridge;
        this.layerManager = layerManager;
        this.promptManager = promptManager;
        this.maskManager = maskManager;

        this.canvasWidth = Constants.CANVAS_WIDTH;
        this.canvasHeight = Constants.CANVAS_HEIGHT;
        this.easyCanvasWidth = Constants.CANVAS_WIDTH;
        this.easyCanvasHeight = Constants.CANVAS_HEIGHT;
        this._generationSource = "easy";
        this._easyResultPollSerial = 0;

        this.seed = -1;
        this.steps = 8;
        this.cfg = 1;
        this.globalGuidance = 3.5;
        this.sampler = "euler";
        this.scheduler = "beta";
        this.engine = "z";
        this.activePanel = null;
        this.fl2PanelScenario = null;

        this.unetModel = "";
        this.vaeModel = "";
        this.clip1Model = "";
        this.clip2Enabled = false;
        this.clip2Model = "";
        this.clipType = "lumina2";
        this.txt2imgBatch = 1;
        this.zBatchSize = 1;
        this.auraFlowShift = 3;
        this.zUseCheckpoint = false;
        this.zCheckpointName = "";

        this.lora1Enabled = false;
        this.lora1Model = "";
        this.lora1Strength = 1;
        this.lora2Enabled = false;
        this.lora2Model = "";
        this.lora2Strength = 1;
        this.lora3Enabled = false;
        this.lora3Model = "";
        this.lora3Strength = 1;

        this.acceleratorEnabled = true;
        this.fp16AccumulationEnabled = true;
        this.sageAttentionMode = "sageattn_qk_int8_pv_fp16_cuda";

        this.upscaleEnabled = false;
        this.upscaleMode = "seedvr2";
        this.upscalePanelSubmode = "seedvr2";
        this.upscaleModel = "";
        this.upscaleFactor = 2;
        this.upscaleDenoise = 0.15;
        this.modeType = "Chess";
        this.tileWidth = 1024;
        this.tileHeight = 1024;
        this.maskBlur = 8;
        this.tilePadding = 32;
        this.seamFixMode = "None";
        this.seamFixDenoise = 1;
        this.seamFixMaskBlur = 64;
        this.seamFixWidth = 8;
        this.seamFixPadding = 16;
        this.forceUniformTiles = true;
        this.tiledDecode = false;
        this.upscaleExtras = {};
        this.seedvr2Params = {};
        this.seedvr2Enabled = false;
        this.seedvr2DitModel = "";
        this.seedvr2VaeModel = "";

        this.fl2oLeft = 0;
        this.fl2oTop = 0;
        this.fl2oRight = 0;
        this.fl2oBottom = 0;
        this.fl2oFeathering = 64;
        this.fl2oMaxWidth = 1328;
        this.fl2oMaxHeight = 1328;

        this.eventBus?.on?.("workflow:execute", (params) => this.executeActiveScenario(params));
        this.eventBus?.on?.("scenario:z:run", (params) => this.executeEasyZImageStandalone(params));
        this.eventBus?.on?.("scenario:z:update", (params) => this.updateScenarioZParams(params));
        this.eventBus?.on?.("fl2o:padding:set", (payload = {}) => this.setOutpaintPadding(payload));
        this.eventBus?.on?.("bridge:state:pulled", (payload = {}) => this.restoreFromPayload(payload));
    }

    _pushStateSafe() {
        try { this.bridge?.pushState?.(this.buildPayload()); } catch (_e) {}
    }

    _toInt(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    }

    _toFloat(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    _randomSeed() {
        return Math.floor(Math.random() * EASY_RANDOM_SEED_MAX);
    }

    restoreFromPayload(payload = {}) {
        const extra = payload?.extra || {};
        if (Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
            this.canvasWidth = Math.max(64, Math.round(payload.width));
            this.canvasHeight = Math.max(64, Math.round(payload.height));
        }
        if (Number.isFinite(payload.seed)) this.seed = payload.seed;
        if (Number.isFinite(payload.steps)) this.steps = payload.steps;
        if (Number.isFinite(payload.cfg)) this.cfg = payload.cfg;
        if (payload.sampler) this.sampler = String(payload.sampler);
        if (payload.scheduler) this.scheduler = String(payload.scheduler);
        if (extra.unet_model_override) this.unetModel = String(extra.unet_model_override);
        if (extra.vae_model_override) this.vaeModel = String(extra.vae_model_override);
        if (extra.clip1_model_override) this.clip1Model = String(extra.clip1_model_override);
    }

    updateScenarioZParams(params = {}) {
        if (!params || typeof params !== "object") return;
        if (Number.isFinite(params.seed)) this.seed = params.seed;
        if (Number.isFinite(params.steps)) this.steps = params.steps;
        if (Number.isFinite(params.cfg)) this.cfg = params.cfg;
        if (Number.isFinite(params.globalGuidance)) this.globalGuidance = params.globalGuidance;
        if (params.sampler) this.sampler = String(params.sampler);
        if (params.scheduler) this.scheduler = String(params.scheduler);
        if (params.unetModel != null) this.unetModel = String(params.unetModel || "");
        if (params.vaeModel != null) this.vaeModel = String(params.vaeModel || "");
        if (params.clip1Model != null) this.clip1Model = String(params.clip1Model || "");
        if (params.clipType != null) this.clipType = String(params.clipType || this.clipType);
    }

    setSeed(seed) { this.seed = Number(seed); }
    setSteps(steps) { const v = Number(steps); if (Number.isFinite(v)) this.steps = Math.max(1, Math.round(v)); }
    setCfg(cfg) { const v = Number(cfg); if (Number.isFinite(v)) this.cfg = v; }
    setSampler(sampler) { this.sampler = String(sampler || this.sampler); this._pushStateSafe(); }
    setScheduler(scheduler) { this.scheduler = String(scheduler || this.scheduler); this._pushStateSafe(); }
    setUseCompositeInit(flag) { this.useCompositeInit = !!flag; }
    setZBatchSize(value) { const v = parseInt(value); if (Number.isFinite(v)) this.zBatchSize = Math.max(1, v); }
    setAuraFlowShift(value) { const v = parseFloat(value); if (Number.isFinite(v)) this.auraFlowShift = v; }
    setLora1Enabled(flag) { this.lora1Enabled = !!flag; }
    setLora1Model(name) { this.lora1Model = String(name || ""); }
    setLora1Strength(value) { const v = parseFloat(value); if (Number.isFinite(v)) this.lora1Strength = v; }
    setLora2Enabled(flag) { this.lora2Enabled = !!flag; }
    setLora2Model(name) { this.lora2Model = String(name || ""); }
    setLora2Strength(value) { const v = parseFloat(value); if (Number.isFinite(v)) this.lora2Strength = v; }
    setLora3Enabled(flag) { this.lora3Enabled = !!flag; }
    setLora3Model(name) { this.lora3Model = String(name || ""); }
    setLora3Strength(value) { const v = parseFloat(value); if (Number.isFinite(v)) this.lora3Strength = v; }
    setTxt2ImgWidth(width) { const v = parseInt(width); if (Number.isFinite(v)) this.easyCanvasWidth = Math.max(64, v); }
    setTxt2ImgHeight(height) { const v = parseInt(height); if (Number.isFinite(v)) this.easyCanvasHeight = Math.max(64, v); }
    setAcceleratorEnabled(enabled) { this.acceleratorEnabled = !!enabled; }
    setSageAttentionMode(mode) { this.sageAttentionMode = String(mode || this.sageAttentionMode); }
    setFp16AccumulationEnabled(enabled) { this.fp16AccumulationEnabled = !!enabled; }
    setGlobalGuidance(value) { const v = parseFloat(value); if (Number.isFinite(v)) this.globalGuidance = v; }
    setTxt2ImgBatch(value) { const v = parseInt(value); if (Number.isFinite(v)) this.txt2imgBatch = Math.max(1, Math.min(16, v)); }

    setEngine(engine) {
        const next = String(engine || "z").toLowerCase();
        this.engine = next;
        if (next !== "upscale") this.upscaleEnabled = false;
    }
    setUnetModel(model) { this.unetModel = String(model || ""); }
    setVaeModel(model) { this.vaeModel = String(model || ""); }
    setClip1Model(model) { this.clip1Model = String(model || ""); }
    setClip2Enabled(enabled) { this.clip2Enabled = !!enabled; }
    setClip2Model(model) { this.clip2Model = String(model || ""); }
    setClipType(type) {
        const value = String(type || "").toLowerCase();
        this.clipType = value || this.clipType;
    }

    _syncUpscaleModeExtras() {
        const submode = String(this.upscalePanelSubmode || this.upscaleMode || "seedvr2").toLowerCase();
        this.seedvr2Enabled = submode === "seedvr2" && this.upscaleEnabled !== false;
        this.upscaleExtras = {
            ...(this.upscaleExtras || {}),
            upscale_mode: this.upscaleMode,
            upscale_panel_submode: this.upscalePanelSubmode,
            seedvr2_enabled: this.seedvr2Enabled,
            seedvr2_dit_model: this.seedvr2DitModel,
            seedvr2_vae_model: this.seedvr2VaeModel,
            seedvr2_tile_width: this.tileWidth,
            seedvr2_tile_height: this.tileHeight,
            seedvr2_factor: this.upscaleFactor,
            seedvr2_denoise: this.upscaleDenoise,
            seedvr2_mode: this.modeType,
            seedvr2_tile_padding: this.tilePadding,
            seedvr2_mask_blur: this.maskBlur,
        };
        this.seedvr2Params = { ...(this.seedvr2Params || {}), ...this.upscaleExtras };
    }

    setUpscaleEnabled(enabled) {
        this.upscaleEnabled = !!enabled;
        if (this.upscaleEnabled) this.engine = "upscale";
        this._syncUpscaleModeExtras();
        this._pushStateSafe();
    }
    setUpscaleMode(mode, options = {}) {
        this.upscaleMode = String(mode || "seedvr2").toLowerCase();
        if (options.panelSubmode) this.upscalePanelSubmode = String(options.panelSubmode).toLowerCase();
        this._syncUpscaleModeExtras();
        if (!options.silent) this._pushStateSafe();
    }
    setUpscalePanelSubmode(mode, options = {}) {
        this.upscalePanelSubmode = String(mode || "seedvr2").toLowerCase();
        this._syncUpscaleModeExtras();
        if (!options.silent) this._pushStateSafe();
    }
    setSeedVR2Enabled(flag, options = {}) {
        this.seedvr2Enabled = !!flag;
        this.upscaleEnabled = !!flag;
        if (this.upscaleEnabled) this.engine = "upscale";
        this._syncUpscaleModeExtras();
        if (!options.silent) this._pushStateSafe();
    }
    setSeedVR2DitModel(name) {
        const base = String(name || "").split("/").pop().split("\\").pop();
        this.seedvr2DitModel = base || "";
        this.setUpscaleValue("seedvr2_dit_model", this.seedvr2DitModel, { silent: true });
        this._pushStateSafe();
    }
    setUpscaleValue(key, value, options = {}) {
        const k = String(key || "");
        if (k === "seedvr2_vae_model") this.seedvr2VaeModel = String(value || "");
        if (k === "seedvr2_dit_model") this.seedvr2DitModel = String(value || "");
        if (k === "seedvr2_factor") this.upscaleFactor = Number(value) || this.upscaleFactor;
        if (k === "seedvr2_denoise") this.upscaleDenoise = Number(value) || this.upscaleDenoise;
        if (k === "seedvr2_tile_width") this.tileWidth = this._toInt(value, this.tileWidth);
        if (k === "seedvr2_tile_height") this.tileHeight = this._toInt(value, this.tileHeight);
        if (k === "seedvr2_tile_padding") this.tilePadding = this._toInt(value, this.tilePadding);
        if (k === "seedvr2_mask_blur") this.maskBlur = this._toInt(value, this.maskBlur);
        if (!this.upscaleExtras) this.upscaleExtras = {};
        this.upscaleExtras[k] = value;
        if (k.startsWith("seedvr2")) {
            if (!this.seedvr2Params) this.seedvr2Params = {};
            this.seedvr2Params[k] = value;
        }
        if (!options.silent) this._pushStateSafe();
    }

    setOutpaintPadding(payload = {}) {
        this.fl2oLeft = this._toInt(payload.left, this.fl2oLeft);
        this.fl2oTop = this._toInt(payload.top, this.fl2oTop);
        this.fl2oRight = this._toInt(payload.right, this.fl2oRight);
        this.fl2oBottom = this._toInt(payload.bottom, this.fl2oBottom);
    }

    getGenerationDimensions() {
        return {
            width: Math.max(64, Math.round(Number(this.easyCanvasWidth || this.canvasWidth) || Constants.CANVAS_WIDTH)),
            height: Math.max(64, Math.round(Number(this.easyCanvasHeight || this.canvasHeight) || Constants.CANVAS_HEIGHT)),
        };
    }

    getActiveScenario() {
        if (this.upscaleEnabled || String(this.engine).toLowerCase() === "upscale") return "up";
        const forced = String(this.fl2PanelScenario || "").toLowerCase();
        if (["fl2-i", "fl2-s", "fl2-t", "fl2-o"].includes(forced)) return forced;
        if (String(this.engine).toLowerCase() === "z") return "z";
        if (String(this.engine).toLowerCase() === "flux") return "fl2-i";
        return "z";
    }

    buildPayload(extra = {}) {
        this._syncUpscaleModeExtras();
        const dims = this.getGenerationDimensions();
        const activeScenario = this.getActiveScenario();
        const promptPayload = this.promptManager?.buildPayload?.() || {};
        const maskStack = this.maskManager?.exportMaskStack?.() || [];
        const layers = this.layerManager?.getLayers?.() || [];
        const extraPayload = {
            scenario_override: activeScenario,
            engine: this.engine,
            sampler_name: this.sampler,
            scheduler: this.scheduler,
            global_guidance: this.globalGuidance,
            unet_model_override: this.unetModel,
            vae_model_override: this.vaeModel,
            clip1_model_override: this.clip1Model,
            clip2_enabled: this.clip2Enabled,
            clip2_model_override: this.clip2Model,
            clip_type: this.clipType,
            lora1_enabled: this.lora1Enabled,
            lora_model_override: this.lora1Enabled ? this.lora1Model : "",
            lora_strength: this.lora1Enabled ? this.lora1Strength : 0,
            lora2_enabled: this.lora2Enabled,
            lora2_model: this.lora2Model,
            lora2_strength: this.lora2Strength,
            lora3_enabled: this.lora3Enabled,
            lora3_model: this.lora3Model,
            lora3_strength: this.lora3Strength,
            accelerator_enabled: this.acceleratorEnabled,
            fp16_accumulation_enabled: this.fp16AccumulationEnabled,
            sage_attention: this.sageAttentionMode,
            upscale_enabled: this.upscaleEnabled,
            upscale_mode: this.upscaleMode,
            upscale_panel_submode: this.upscalePanelSubmode,
            seedvr2_enabled: this.seedvr2Enabled,
            seedvr2_dit_model: this.seedvr2DitModel,
            seedvr2_vae_model: this.seedvr2VaeModel,
            ...this.upscaleExtras,
            ...(extra?.extra || {}),
            scenario_override: activeScenario,
            easy_slim_runner: true,
        };
        return {
            width: dims.width,
            height: dims.height,
            seed: this.seed,
            steps: this.steps,
            sampler: this.sampler,
            scheduler: this.scheduler,
            cfg: this.cfg,
            global_cfg: this.cfg,
            global_guidance: this.globalGuidance,
            scenario: activeScenario,
            qwen_generation_enabled: false,
            qwen_generation_mode: "disabled",
            ...promptPayload,
            layers,
            mask_stack: maskStack,
            extra: extraPayload,
            ...((extra && !extra.extra) ? extra : {}),
        };
    }

    async executeActiveScenario(params = {}) {
        const source = String(params?.source || "").toLowerCase();
        const requested = String(params?.scenarioKey || params?.templateKey || params?.intentMode || "").toLowerCase();
        if (source === "easy") {
            if (requested === "z" || requested === "easy-z") return this.executeEasyZImageStandalone(params);
            if (requested === "up" || requested === "upscale" || requested === "easy-upscale") return this.executeEasyUpscaleStandalone(params);
            return this.executeEasyStandalone(params);
        }
        if (this.getActiveScenario() === "up") return this.executeEasyUpscaleStandalone(params);
        if (this.getActiveScenario() === "z") return this.executeEasyZImageStandalone(params);
        return this.executeEasyStandalone(params);
    }

    async executeScenarioOne() { return this.executeActiveScenario({ source: "easy" }); }
    async executeScenarioZ(params = {}) { return this.executeEasyZImageStandalone(params); }
    async executeScenarioZ2(params = {}) { this.eventBus?.emit?.("status:message", "Z2 is not part of Easy."); return false; }
    async executeScenarioZ3(params = {}) { this.eventBus?.emit?.("status:message", "ControlNet is not part of Easy."); return false; }
    _normalizeEasyStandaloneMode(params = {}) {
        const requested = String(params?.scenarioKey || params?.templateKey || params?.intentMode || "").toLowerCase();
        if (requested === "fl2-d" || requested === "draw" || requested === "sketch") return "i2i";
        if (requested === "fl2-i" || requested === "inpaint") return "inpaint";
        if (requested === "fl2-o" || requested === "outpaint") return "outpaint";
        return "i2i";
    }

    _getComfyClientId() {
        try {
            const clientId = window?.app?.api?.clientId || window?.app?.clientId || "";
            if (clientId) return String(clientId);
        } catch (_e) {}
        try {
            if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
                return crypto.randomUUID();
            }
        } catch (_e) {}
        return `goyai-easy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    _easyAssetLoadImageValue(asset) {
        const name = String(asset?.name || "").trim();
        const subfolder = String(asset?.subfolder || "").trim().replace(/\\/g, "/");
        return subfolder ? `${subfolder}/${name}` : name;
    }

    async _saveEasyStandaloneAsset(dataUrl, prefix, options = {}) {
        return saveEasyAsset(dataUrl, prefix, options);
    }

    _loadEasyStandaloneImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Easy outpaint: unable to read source image."));
            image.src = dataUrl;
        });
    }

    async _prepareEasyOutpaintPayload(sourceImageDataUrl, outpaintPadding = {}) {
        const source = await this._loadEasyStandaloneImage(sourceImageDataUrl);
        const left = Math.max(0, Math.round(Number(outpaintPadding?.left) || 0));
        const top = Math.max(0, Math.round(Number(outpaintPadding?.top) || 0));
        const right = Math.max(0, Math.round(Number(outpaintPadding?.right) || 0));
        const bottom = Math.max(0, Math.round(Number(outpaintPadding?.bottom) || 0));
        const total = left + top + right + bottom;
        if (total <= 0) {
            throw new Error("Easy outpaint: drag a frame outside the image before generating.");
        }

        const sourceWidth = Math.max(1, source.naturalWidth || source.width || Math.round(Number(this.easyCanvasWidth || this.canvasWidth) || 1024));
        const sourceHeight = Math.max(1, source.naturalHeight || source.height || Math.round(Number(this.easyCanvasHeight || this.canvasHeight) || 1024));
        const width = Math.max(64, sourceWidth + left + right);
        const height = Math.max(64, sourceHeight + top + bottom);

        const prepared = document.createElement("canvas");
        prepared.width = width;
        prepared.height = height;
        const pctx = prepared.getContext("2d", { willReadFrequently: true });
        if (!pctx) {
            throw new Error("Easy outpaint: unable to prepare expanded source.");
        }
        pctx.fillStyle = "#000000";
        pctx.fillRect(0, 0, width, height);
        pctx.drawImage(source, left, top, sourceWidth, sourceHeight);

        const mask = document.createElement("canvas");
        mask.width = width;
        mask.height = height;
        const mctx = mask.getContext("2d", { willReadFrequently: true });
        if (!mctx) {
            throw new Error("Easy outpaint: unable to prepare mask.");
        }
        mctx.fillStyle = "#000000";
        mctx.fillRect(0, 0, width, height);
        mctx.fillStyle = "#ff0000";
        if (top > 0) mctx.fillRect(0, 0, width, top);
        if (bottom > 0) mctx.fillRect(0, top + sourceHeight, width, bottom);
        if (left > 0) mctx.fillRect(0, top, left, sourceHeight);
        if (right > 0) mctx.fillRect(left + sourceWidth, top, right, sourceHeight);
        const overlap = Math.max(16, Math.round(Number(outpaintPadding?.overlap) || 32));
        if (top > 0) mctx.fillRect(left, top, sourceWidth, Math.min(overlap, sourceHeight));
        if (bottom > 0) mctx.fillRect(left, Math.max(top, top + sourceHeight - overlap), sourceWidth, Math.min(overlap, sourceHeight));
        if (left > 0) mctx.fillRect(left, top, Math.min(overlap, sourceWidth), sourceHeight);
        if (right > 0) mctx.fillRect(Math.max(left, left + sourceWidth - overlap), top, Math.min(overlap, sourceWidth), sourceHeight);

        return {
            sourceImageDataUrl: prepared.toDataURL("image/png"),
            maskImageDataUrl: mask.toDataURL("image/png"),
            width,
            height,
            outpaint: {
                enabled: true,
                left,
                top,
                right,
                bottom,
                source_rect: { x: left, y: top, w: sourceWidth, h: sourceHeight, unit: "px" },
                source_is_prepared: true,
                mask_overlap: overlap,
                style: "unicanvas_masked_latent_drag_frame",
            },
        };
    }

    async _prepareEasyOutpaintGeometry(sourceImageDataUrl, outpaintPadding = {}) {
        const source = await this._loadEasyStandaloneImage(sourceImageDataUrl);
        const left = Math.max(0, Math.round(Number(outpaintPadding?.left) || 0));
        const top = Math.max(0, Math.round(Number(outpaintPadding?.top) || 0));
        const right = Math.max(0, Math.round(Number(outpaintPadding?.right) || 0));
        const bottom = Math.max(0, Math.round(Number(outpaintPadding?.bottom) || 0));
        const total = left + top + right + bottom;
        if (total <= 0) {
            throw new Error("Easy outpaint: drag a frame outside the image before generating.");
        }
        const sourceWidth = Math.max(1, source.naturalWidth || source.width || Math.round(Number(this.easyCanvasWidth || this.canvasWidth) || 1024));
        const sourceHeight = Math.max(1, source.naturalHeight || source.height || Math.round(Number(this.easyCanvasHeight || this.canvasHeight) || 1024));
        return {
            width: Math.max(64, sourceWidth + left + right),
            height: Math.max(64, sourceHeight + top + bottom),
            outpaint: {
                enabled: true,
                left,
                top,
                right,
                bottom,
                source_rect: { x: left, y: top, w: sourceWidth, h: sourceHeight, unit: "px" },
                source_is_prepared: false,
                style: "fl9b_imagepad_drag_frame",
            },
        };
    }

    async _loadEasyStandaloneWorkflow(mode) {
        if (mode === "draw" || mode === "i2i" || mode === "outpaint") {
            return { nodes: [], fallback: `easy_${mode}_reference_builtin` };
        }
        return loadEasyWorkflow(mode);
    }

    _patchEasyStandaloneWorkflow(graph, params = {}, assets = {}, mode = "i2i") {
        if (mode === "draw" || mode === "i2i") {
            return this._buildEasyReferenceI2IPrompt(params, assets, mode);
        }
        if (mode === "outpaint") {
            return this._buildEasyUniCanvasOutpaintPrompt(params, assets);
        }
        const patched = JSON.parse(JSON.stringify(graph || {}));
        const entries = Object.entries(patched);
        const prompt = String(params.prompt ?? this._getGlobalPromptText?.() ?? "");
        const negative = String(params.negativePrompt ?? this._getGlobalNegativePromptText?.() ?? "");
        const model = String(params.generationModel || params.modelChoice || this.unetModel || "").trim();
        const vae = String(params.vaeModel || this.vaeModel || "").trim();
        const clip = String(params.clipModel || this.clip1Model || "").trim();
        const clipType = String(params.clipType || this.clipType || "flux2").trim();
        const sampler = String(params.sampler || this.sampler || "euler").trim();
        const scheduler = String(params.scheduler || this.scheduler || "beta").trim();
        const steps = Math.max(1, Math.round(Number(params.steps ?? this.steps ?? 8) || 8));
        const cfg = Number(params.cfg ?? this.cfg ?? 1) || 1;
        const rawSeed = Number(params.seed ?? this.seed);
        const seed = Number.isFinite(rawSeed) && rawSeed >= 0
            ? Math.floor(rawSeed)
            : Math.floor(Math.random() * 1125899906842624);
        const denoiseDefault = (mode === "inpaint" || mode === "outpaint") ? 1 : 0.75;
        const denoise = Math.max(0, Math.min(1, Number(params.denoise ?? denoiseDefault) || denoiseDefault));
        const width = Math.max(64, Math.round(Number(params.width ?? this.easyCanvasWidth ?? this.canvasWidth) || 1024));
        const height = Math.max(64, Math.round(Number(params.height ?? this.easyCanvasHeight ?? this.canvasHeight) || 1024));

        let textIndex = 0;
        let loadImageIndex = 0;
        const sourceImage = this._easyAssetLoadImageValue(assets.source);
        const maskImage = assets.mask ? this._easyAssetLoadImageValue(assets.mask) : "";

        for (const [_id, node] of entries) {
            const classType = String(node?.class_type || "");
            const inputs = node?.inputs || {};
            if (classType === "UNETLoader" && Object.prototype.hasOwnProperty.call(inputs, "unet_name")) {
                if (/\.gguf$/i.test(model)) {
                    node.class_type = "LoaderGGUF";
                    node.inputs = { gguf_name: model };
                } else {
                    inputs.unet_name = model;
                }
            }
            if (classType === "CheckpointLoaderSimple" && Object.prototype.hasOwnProperty.call(inputs, "ckpt_name")) {
                inputs.ckpt_name = model;
            }
            if (classType === "VAELoader" && Object.prototype.hasOwnProperty.call(inputs, "vae_name")) {
                if (/\.gguf$/i.test(vae)) {
                    node.class_type = "VaeGGUF";
                    node.inputs = { vae_name: vae };
                } else {
                    inputs.vae_name = vae;
                }
            }
            if (classType === "CLIPLoader") {
                if (/\.gguf$/i.test(clip)) {
                    node.class_type = "ClipLoaderGGUF";
                    node.inputs = { clip_name: clip, type: clipType || "flux2", device: inputs.device || "default" };
                } else {
                    if (Object.prototype.hasOwnProperty.call(inputs, "clip_name")) inputs.clip_name = clip;
                    if (clipType && Object.prototype.hasOwnProperty.call(inputs, "type")) inputs.type = clipType;
                }
            }
            if (classType === "CLIPTextEncode" && Object.prototype.hasOwnProperty.call(inputs, "text")) {
                inputs.text = textIndex === 0 ? prompt : negative;
                textIndex += 1;
            }
            if (classType === "LoadImage" && Object.prototype.hasOwnProperty.call(inputs, "image")) {
                inputs.image = loadImageIndex === 0 ? sourceImage : (maskImage || sourceImage);
                if (Object.prototype.hasOwnProperty.call(inputs, "upload")) inputs.upload = "image";
                loadImageIndex += 1;
            }
            if (Object.prototype.hasOwnProperty.call(inputs, "seed")) inputs.seed = seed;
            if (Object.prototype.hasOwnProperty.call(inputs, "steps")) inputs.steps = steps;
            if (Object.prototype.hasOwnProperty.call(inputs, "cfg")) inputs.cfg = cfg;
            if (Object.prototype.hasOwnProperty.call(inputs, "sampler_name")) inputs.sampler_name = sampler;
            if (Object.prototype.hasOwnProperty.call(inputs, "scheduler")) inputs.scheduler = scheduler;
            if (Object.prototype.hasOwnProperty.call(inputs, "denoise")) inputs.denoise = denoise;
            if (classType === "InpaintCropImproved") {
                if (Object.prototype.hasOwnProperty.call(inputs, "output_target_width")) inputs.output_target_width = width;
                if (Object.prototype.hasOwnProperty.call(inputs, "output_target_height")) inputs.output_target_height = height;
                if (Object.prototype.hasOwnProperty.call(inputs, "preresize_min_width")) inputs.preresize_min_width = width;
                if (Object.prototype.hasOwnProperty.call(inputs, "preresize_min_height")) inputs.preresize_min_height = height;
            }
            if (classType === "SaveImage" && Object.prototype.hasOwnProperty.call(inputs, "filename_prefix")) {
                inputs.filename_prefix = `${EASY_OUTPUT_PREFIX}/goyai_easy_${mode}`;
            }
        }

        if (mode === "inpaint" || mode === "outpaint") {
            this._applyNegativeTextEncodeFallback(patched, negative);
            this._applyModelOnlyLoras(patched);
        }

        return { prompt: patched, meta: { seed, steps, cfg, sampler, scheduler, denoise, width, height, mode } };
    }

    _buildEasyReferenceI2IPrompt(params = {}, assets = {}, mode = "i2i") {
        const normalizedMode = "i2i";
        const modeLabel = "Image to Image";
        const promptText = String(params.prompt ?? this._getGlobalPromptText?.() ?? "").trim();
        const negativeText = String(params.negativePrompt ?? this._getGlobalNegativePromptText?.() ?? "");
        const model = String(params.generationModel || params.modelChoice || this.unetModel || "").trim();
        const vae = String(params.vaeModel || this.vaeModel || "").trim();
        const clip = String(params.clipModel || this.clip1Model || "").trim();
        const clipType = String(params.clipType || this.clipType || "flux2").trim();
        const sampler = String(params.sampler || "euler").trim();
        const scheduler = String(params.scheduler || "flux2").trim();
        const steps = Math.max(1, Math.round(Number(params.steps ?? this.steps ?? 8) || 8));
        const cfg = Number(params.cfg ?? this.cfg ?? 1) || 1;
        const denoise = Math.max(0, Math.min(1, Number(params.denoise ?? 1) || 1));
        const rescaleReferenceImage = params.rescaleReferenceImage !== false;
        const rawSeed = Number(params.seed ?? this.seed);
        const seed = Number.isFinite(rawSeed) && rawSeed >= 0
            ? Math.floor(rawSeed)
            : Math.floor(Math.random() * 1125899906842624);
        const width = Math.max(64, Math.round(Number(params.width ?? this.easyCanvasWidth ?? this.canvasWidth) || 1024));
        const height = Math.max(64, Math.round(Number(params.height ?? this.easyCanvasHeight ?? this.canvasHeight) || 1024));
        const sourceImage = this._easyAssetLoadImageValue(assets.source);

        if (!model) throw new Error(`Easy ${modeLabel}: choose an installed Flux/Klein model in Settings.`);
        if (!vae) throw new Error(`Easy ${modeLabel}: choose an installed VAE in Settings.`);
        if (!clip) throw new Error(`Easy ${modeLabel}: choose an installed CLIP/text encoder in Settings.`);
        if (!sourceImage) throw new Error(`Easy ${modeLabel}: source image is missing.`);

        const prompt = {};
        let nextId = 1;
        const id = () => String(nextId++);

        const idModel = id();
        const isGgufModel = /\.gguf$/i.test(model);
        prompt[idModel] = isGgufModel
            ? { class_type: "UnetLoaderGGUF", inputs: { unet_name: model } }
            : { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: "default" } };
        let modelOut = idModel;
        const addLora = (name, strength) => {
            const loraName = String(name || "").trim();
            if (!loraName) return;
            const loraId = id();
            prompt[loraId] = {
                class_type: "LoraLoaderModelOnly",
                inputs: {
                    model: [modelOut, 0],
                    lora_name: loraName,
                    strength_model: Number(strength) || 1,
                },
            };
            modelOut = loraId;
        };
        if (this.lora1Enabled && this.lora1Model) addLora(this.lora1Model, this.lora1Strength);
        if (this.lora2Enabled && this.lora2Model) addLora(this.lora2Model, this.lora2Strength);
        if (this.lora3Enabled && this.lora3Model) addLora(this.lora3Model, this.lora3Strength);

        const idSampling = id();
        prompt[idSampling] = {
            class_type: "ModelSamplingAuraFlow",
            inputs: { model: [modelOut, 0], shift: Number(params.fl9bShift ?? this.auraFlowShift ?? 3) || 3 },
        };
        const idClip = id();
        prompt[idClip] = {
            class_type: "CLIPLoader",
            inputs: { clip_name: clip, type: clipType || "flux2", device: "default" },
        };
        const idVae = id();
        prompt[idVae] = { class_type: "VAELoader", inputs: { vae_name: vae } };
        const idLoad = id();
        prompt[idLoad] = { class_type: "LoadImage", inputs: { image: sourceImage, upload: "image" } };
        let referenceImageOut = [idLoad, 0];
        if (rescaleReferenceImage) {
            const idScaleTotal = id();
            prompt[idScaleTotal] = {
                class_type: "ImageScaleToTotalPixels",
                inputs: {
                    image: referenceImageOut,
                    upscale_method: "lanczos",
                    megapixels: Math.max(0.1, Number(params.referenceMegapixels ?? 1) || 1),
                    resolution_steps: 1,
                },
            };
            referenceImageOut = [idScaleTotal, 0];
        }
        const idSize = id();
        prompt[idSize] = {
            class_type: "GetImageSize",
            inputs: { image: referenceImageOut },
        };
        const idEncode = id();
        prompt[idEncode] = {
            class_type: "VAEEncode",
            inputs: { pixels: referenceImageOut, vae: [idVae, 0] },
        };
        const idPositive = id();
        prompt[idPositive] = {
            class_type: "CLIPTextEncode",
            inputs: { clip: [idClip, 0], text: promptText },
        };
        const idNegative = id();
        prompt[idNegative] = {
            class_type: "CLIPTextEncode",
            inputs: { clip: [idClip, 0], text: negativeText },
        };
        const idPositiveRef = id();
        prompt[idPositiveRef] = {
            class_type: "ReferenceLatent",
            inputs: { conditioning: [idPositive, 0], latent: [idEncode, 0] },
        };
        const idNegativeRef = id();
        prompt[idNegativeRef] = {
            class_type: "ReferenceLatent",
            inputs: { conditioning: [idNegative, 0], latent: [idEncode, 0] },
        };
        const idLatent = id();
        prompt[idLatent] = {
            class_type: "EmptyFlux2LatentImage",
            inputs: { width: [idSize, 0], height: [idSize, 1], batch_size: 1 },
        };
        const idGuider = id();
        prompt[idGuider] = {
            class_type: "CFGGuider",
            inputs: { model: [idSampling, 0], positive: [idPositiveRef, 0], negative: [idNegativeRef, 0], cfg },
        };
        const idNoise = id();
        prompt[idNoise] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
        const idSampler = id();
        prompt[idSampler] = { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } };
        const idSigmas = id();
        prompt[idSigmas] = {
            class_type: "Flux2Scheduler",
            inputs: { steps, width: [idSize, 0], height: [idSize, 1] },
        };
        const idSample = id();
        prompt[idSample] = {
            class_type: "SamplerCustomAdvanced",
            inputs: {
                noise: [idNoise, 0],
                guider: [idGuider, 0],
                sampler: [idSampler, 0],
                sigmas: [idSigmas, 0],
                latent_image: [idLatent, 0],
            },
        };
        const idDecode = id();
        prompt[idDecode] = {
            class_type: "VAEDecode",
            inputs: { samples: [idSample, 0], vae: [idVae, 0] },
        };
        const idSave = id();
        prompt[idSave] = {
            class_type: "SaveImage",
            inputs: { images: [idDecode, 0], filename_prefix: `${EASY_OUTPUT_PREFIX}/goyai_easy_${normalizedMode}` },
        };

        return {
            prompt,
            meta: {
                seed,
                steps,
                cfg,
                sampler,
                scheduler,
                denoise,
                width,
                height,
                rescaleReferenceImage,
                mode: normalizedMode,
                workflow: `flux2_easycanvas_img2img_builtin`,
            },
        };
    }

    _withOutpaintPromptSuffix(text) {
        const suffix = "outpaint black part of image";
        const prompt = String(text || "").trim();
        if (!prompt) return suffix;
        return prompt.toLowerCase().includes(suffix) ? prompt : `${prompt}, ${suffix}`;
    }

    _buildEasyUniCanvasOutpaintPrompt(params = {}, assets = {}) {
        const promptText = this._withOutpaintPromptSuffix(params.prompt ?? this._getGlobalPromptText?.() ?? "");
        const negativeText = String(params.negativePrompt ?? this._getGlobalNegativePromptText?.() ?? "");
        const model = String(params.generationModel || params.modelChoice || this.unetModel || "").trim();
        const vae = String(params.vaeModel || this.vaeModel || "").trim();
        const clip = String(params.clipModel || this.clip1Model || "").trim();
        const clipType = String(params.clipType || this.clipType || "flux2").trim();
        const sampler = "euler";
        const scheduler = "simple";
        const steps = 4;
        const cfg = 1;
        const rawSeed = Number(params.seed ?? this.seed);
        const seed = Number.isFinite(rawSeed) && rawSeed >= 0
            ? Math.floor(rawSeed)
            : Math.floor(Math.random() * 1125899906842624);
        const width = Math.max(64, Math.round(Number(params.width ?? this.easyCanvasWidth ?? this.canvasWidth) || 1024));
        const height = Math.max(64, Math.round(Number(params.height ?? this.easyCanvasHeight ?? this.canvasHeight) || 1024));
        const sourceImage = this._easyAssetLoadImageValue(assets.source);
        const maskImage = this._easyAssetLoadImageValue(assets.mask);

        if (!model) throw new Error("Easy outpaint: choose an installed Flux/Klein model in Settings.");
        if (!vae) throw new Error("Easy outpaint: choose an installed VAE in Settings.");
        if (!clip) throw new Error("Easy outpaint: choose an installed CLIP/text encoder in Settings.");
        if (!sourceImage) throw new Error("Easy outpaint: source image is missing.");
        if (!maskImage) throw new Error("Easy outpaint: mask image is missing.");

        const prompt = {};
        let nextId = 1;
        const id = () => String(nextId++);

        const idModel = id();
        const isGgufModel = /\.gguf$/i.test(model);
        prompt[idModel] = isGgufModel
            ? { class_type: "UnetLoaderGGUF", inputs: { unet_name: model } }
            : { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: "default" } };
        let modelOut = idModel;
        const addLora = (name, strength) => {
            const loraName = String(name || "").trim();
            if (!loraName) return;
            const loraId = id();
            prompt[loraId] = {
                class_type: "LoraLoaderModelOnly",
                inputs: {
                    model: [modelOut, 0],
                    lora_name: loraName,
                    strength_model: Number(strength) || 1,
                },
            };
            modelOut = loraId;
        };
        if (this.lora1Enabled && this.lora1Model) addLora(this.lora1Model, this.lora1Strength);
        if (this.lora2Enabled && this.lora2Model) addLora(this.lora2Model, this.lora2Strength);
        if (this.lora3Enabled && this.lora3Model) addLora(this.lora3Model, this.lora3Strength);

        const idClip = id();
        prompt[idClip] = {
            class_type: "CLIPLoader",
            inputs: { clip_name: clip, type: clipType || "flux2", device: "default" },
        };
        const idVae = id();
        prompt[idVae] = { class_type: "VAELoader", inputs: { vae_name: vae } };
        const idLoad = id();
        prompt[idLoad] = { class_type: "LoadImage", inputs: { image: sourceImage, upload: "image" } };
        const idMaskLoad = id();
        prompt[idMaskLoad] = { class_type: "LoadImage", inputs: { image: maskImage, upload: "image" } };
        const idEncode = id();
        prompt[idEncode] = {
            class_type: "VAEEncode",
            inputs: { pixels: [idLoad, 0], vae: [idVae, 0] },
        };
        const idMask = id();
        prompt[idMask] = {
            class_type: "ImageToMask",
            inputs: { image: [idMaskLoad, 0], channel: "red" },
        };
        const idMaskedLatent = id();
        prompt[idMaskedLatent] = {
            class_type: "SetLatentNoiseMask",
            inputs: { samples: [idEncode, 0], mask: [idMask, 0] },
        };
        const idPositive = id();
        prompt[idPositive] = {
            class_type: "CLIPTextEncode",
            inputs: { clip: [idClip, 0], text: promptText },
        };
        const idNegative = id();
        prompt[idNegative] = {
            class_type: "CLIPTextEncode",
            inputs: { clip: [idClip, 0], text: negativeText },
        };
        const idPositiveRef = id();
        prompt[idPositiveRef] = {
            class_type: "ReferenceLatent",
            inputs: { conditioning: [idPositive, 0], latent: [idEncode, 0] },
        };
        const idNegativeZero = id();
        prompt[idNegativeZero] = {
            class_type: "ConditioningZeroOut",
            inputs: { conditioning: [idNegative, 0] },
        };
        const idNegativeRef = id();
        prompt[idNegativeRef] = {
            class_type: "ReferenceLatent",
            inputs: { conditioning: [idNegativeZero, 0], latent: [idEncode, 0] },
        };
        const idGuider = id();
        prompt[idGuider] = {
            class_type: "CFGGuider",
            inputs: { model: [modelOut, 0], positive: [idPositiveRef, 0], negative: [idNegativeRef, 0], cfg },
        };
        const idNoise = id();
        prompt[idNoise] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
        const idSampler = id();
        prompt[idSampler] = { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } };
        const idSigmas = id();
        prompt[idSigmas] = { class_type: "Flux2Scheduler", inputs: { steps, width, height } };
        const idSample = id();
        prompt[idSample] = {
            class_type: "SamplerCustomAdvanced",
            inputs: {
                noise: [idNoise, 0],
                guider: [idGuider, 0],
                sampler: [idSampler, 0],
                sigmas: [idSigmas, 0],
                latent_image: [idMaskedLatent, 0],
            },
        };
        const idDecode = id();
        prompt[idDecode] = {
            class_type: "VAEDecode",
            inputs: { samples: [idSample, 0], vae: [idVae, 0] },
        };
        const idSave = id();
        prompt[idSave] = {
            class_type: "SaveImage",
            inputs: { images: [idDecode, 0], filename_prefix: `${EASY_OUTPUT_PREFIX}/goyai_easy_outpaint` },
        };

        return {
            prompt,
            meta: {
                seed,
                steps,
                cfg,
                sampler,
                scheduler,
                denoise: 1,
                width,
                height,
                mode: "outpaint",
                workflow: "unicanvas_masked_latent_outpaint_builtin",
                source: sourceImage,
                mask: maskImage,
                acceptRequired: true,
            },
        };
    }

    _easyViewUrlFromHistoryImage(img) {
        try {
            const filename = encodeURIComponent(img?.filename || img?.name || "");
            if (!filename) return "";
            const subfolder = encodeURIComponent(img?.subfolder || "");
            const type = encodeURIComponent(img?.type || "output");
            return `/view?filename=${filename}&subfolder=${subfolder}&type=${type}&t=${Date.now()}`;
        } catch (_e) {
            return "";
        }
    }

    _easyImageNameFromHistoryImage(img) {
        const filename = String(img?.filename || img?.name || "").trim();
        if (!filename) return "";
        const subfolder = String(img?.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (subfolder === EASY_OUTPUT_PREFIX) return filename;
        return subfolder ? `${subfolder}/${filename}` : filename;
    }

    _extractEasyHistoryImages(historyEntry) {
        const outputs = historyEntry?.outputs || {};
        const images = [];
        for (const output of Object.values(outputs)) {
            if (Array.isArray(output?.images)) {
                images.push(...output.images);
            }
        }
        return images;
    }

    _easyResultPollIsCurrent(serial) {
        return serial == null || serial === this._easyResultPollSerial;
    }

    _easyModeOutputPrefix(mode = "easy") {
        const safe = String(mode || "easy").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
        return `goyai_easy_${safe}`;
    }

    async _findLatestEasyGalleryResult(mode = "easy", options = {}) {
        const response = await fetch(`${Constants.EASY_API_BASE || "/iamccs/goyai_easy"}/gallery/list`, { cache: "no-store" });
        if (!response?.ok) return null;
        const data = await response.json().catch(() => ({}));
        const prefix = this._easyModeOutputPrefix(mode);
        const minMtime = Number(options.minMtime || 0) || 0;
        const item = (Array.isArray(data?.items) ? data.items : []).find((entry) => {
            const name = String(entry?.name || entry?.file || "").split(/[\\/]/).pop();
            const mtime = Number(entry?.mtime || 0) || 0;
            return name.startsWith(prefix) && (!minMtime || mtime >= minMtime);
        });
        if (!item) return null;
        const name = String(item.name || item.file || "").trim();
        const url = String(item.url || `${Constants.EASY_API_BASE || "/iamccs/goyai_easy"}/gallery/get?name=${encodeURIComponent(name)}`);
        return name && url ? { name, url, images: [{ filename: name, subfolder: EASY_OUTPUT_PREFIX, type: "output" }] } : null;
    }

    _emitEasyFinalResult({ url, name, images = [], promptId = "", mode = "easy" } = {}) {
        if (!url) return false;
        this.eventBus.emit("workflow:phase", { index: 4, count: 4, phase: "Result saved", phaseProgress: 100 });
        this.eventBus.emit("workflow:progress", { percent: 100 });
        this.eventBus.emit("workflow:image", { name, url, images, promptId, mode });
        this.eventBus.emit("workflow:final", { name, url, images, data: { prompt_id: promptId, mode } });
        this.eventBus.emit("workflow:finished", { promptId, mode });
        this.eventBus.emit("workflow:complete", { promptId, mode });
        return true;
    }

    _emitEasyHistoryProgress(historyEntry, fallbackPct = null) {
        const status = historyEntry?.status || {};
        const completed = Number(status?.completed ?? 0);
        const total = Number(status?.total ?? 0);
        if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
            this.eventBus.emit("workflow:progress", {
                completed,
                total,
                percent: Math.max(0, Math.min(100, (completed / total) * 100)),
            });
            return;
        }
        if (Number.isFinite(fallbackPct)) {
            this.eventBus.emit("workflow:progress", { percent: Math.max(0, Math.min(100, fallbackPct)) });
        }
    }

    async _awaitEasyPromptResult(promptId, mode = "easy", options = {}) {
        const id = String(promptId || "").trim();
        if (!id) return [];
        const serial = options.serial ?? null;
        const queuedAt = Number(options.queuedAt || 0) || 0;
        const queuedAtSeconds = queuedAt > 0 ? Math.max(0, queuedAt / 1000 - 2) : 0;
        const timeoutMs = Math.max(60 * 1000, Number(options.timeoutMs ?? 30 * 60 * 1000) || 30 * 60 * 1000);
        const timeoutAt = Date.now() + timeoutMs;
        let lastStatus = "";
        let lastWaitingTick = 0;
        this.eventBus.emit("workflow:phase", { index: 3, count: 4, phase: "Running", phaseProgress: 55 });

        while (Date.now() < timeoutAt) {
            if (!this._easyResultPollIsCurrent(serial)) return [];
            try {
                const now = Date.now();
                if (now - lastWaitingTick > 10000) {
                    lastWaitingTick = now;
                    this.eventBus.emit("status:message", `ComfyUI still processing ${mode}`);
                    this.eventBus.emit("workflow:phase", { index: 3, count: 4, phase: "Running", phaseProgress: 65 });
                }
                const response = await fetch(`/history/${encodeURIComponent(id)}`, { cache: "no-store" });
                if (response?.ok) {
                    const data = await response.json().catch(() => ({}));
                    const entry = data?.[id] || data;
                    if (entry && typeof entry === "object") {
                        const statusText = String(entry?.status?.status_str || "").trim();
                        if (statusText && statusText !== lastStatus && this._easyResultPollIsCurrent(serial)) {
                            lastStatus = statusText;
                            this.eventBus.emit("status:message", statusText);
                        }
                        this._emitEasyHistoryProgress(entry);
                        const images = this._extractEasyHistoryImages(entry);
                        if (images.length) {
                            const first = images[0];
                            const url = this._easyViewUrlFromHistoryImage(first);
                            const name = this._easyImageNameFromHistoryImage(first);
                            if (this._easyResultPollIsCurrent(serial)) {
                                this._emitEasyFinalResult({ url, name, images, promptId: id, mode });
                            }
                            return images;
                        }
                        const completed = !!entry?.status?.completed;
                        const statusLower = String(entry?.status?.status_str || "").toLowerCase();
                        if (completed && statusLower === "success") {
                            const galleryResult = await this._findLatestEasyGalleryResult(mode, { minMtime: queuedAtSeconds }).catch(() => null);
                            if (galleryResult && this._easyResultPollIsCurrent(serial)) {
                                this._emitEasyFinalResult({ ...galleryResult, promptId: id, mode });
                                return galleryResult.images || [];
                            }
                            if (this._easyResultPollIsCurrent(serial)) {
                                this.eventBus.emit("workflow:phase", { index: 4, count: 4, phase: "Complete", phaseProgress: 100 });
                                this.eventBus.emit("workflow:progress", { percent: 100 });
                                this.eventBus.emit("workflow:finished", { promptId: id, mode });
                                this.eventBus.emit("workflow:complete", { promptId: id, mode });
                            }
                            return [];
                        }
                        if (completed && statusLower && statusLower !== "success") {
                            throw new Error(`Easy ${mode} failed: ${entry.status.status_str}`);
                        }
                    }
                }
            } catch (error) {
                if (String(error?.message || "").includes(`Easy ${mode} failed`)) throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        const galleryResult = await this._findLatestEasyGalleryResult(mode, { minMtime: queuedAtSeconds }).catch(() => null);
        if (galleryResult && this._easyResultPollIsCurrent(serial)) {
            this._emitEasyFinalResult({ ...galleryResult, promptId: id, mode });
            return galleryResult.images || [];
        }
        throw new Error(`Easy ${mode}: timeout waiting for ComfyUI history.`);
    }

    async executeEasyStandalone(params = {}) {
        const mode = this._normalizeEasyStandaloneMode(params);
        if (mode !== "draw" && mode !== "i2i" && mode !== "inpaint" && mode !== "outpaint") {
            throw new Error(`Easy standalone mode not ready yet: ${mode}`);
        }
        try {
            let executionParams = { ...params };
            let sourceImageDataUrl = String(params.sourceImageDataUrl || "");
            if (!sourceImageDataUrl.startsWith("data:image/")) {
                throw new Error("Easy image source missing: import or draw an image before generating.");
            }
            let maskImageDataUrl = "";
            if (mode === "outpaint") {
                const prepared = await this._prepareEasyOutpaintPayload(sourceImageDataUrl, params.outpaintPadding || params.outpaint || {});
                sourceImageDataUrl = prepared.sourceImageDataUrl;
                maskImageDataUrl = prepared.maskImageDataUrl;
                executionParams = {
                    ...executionParams,
                    width: prepared.width,
                    height: prepared.height,
                    outpaint: prepared.outpaint,
                    sourceImageDataUrl: prepared.sourceImageDataUrl,
                    maskImageDataUrl: prepared.maskImageDataUrl,
                };
            }
            const sourceAsset = await this._saveEasyStandaloneAsset(sourceImageDataUrl, `goyai_easy_${mode}_source`, {
                gallery: mode !== "outpaint",
                gallery_prefix: `goyai_easy_${mode}_before`,
            });
            if (sourceAsset?.gallery_url) {
                const sourcePayload = {
                    mode,
                    name: sourceAsset.gallery_name || sourceAsset.name || "",
                    url: `${sourceAsset.gallery_url}${sourceAsset.gallery_url.includes("?") ? "&" : "?"}t=${Date.now()}`,
                    inputName: sourceAsset.name || "",
                };
                this.eventBus.emit("easy:source:saved", sourcePayload);
                this.eventBus.emit("easy:gallery:add", {
                    imageUrl: sourcePayload.url,
                    imageName: sourcePayload.name,
                    source: "easy-before",
                    mode,
                });
            }
            this.eventBus.emit("workflow:phase", { index: 1, count: 4, phase: "Assets ready", phaseProgress: 25 });
            let maskAsset = null;
            if (mode === "inpaint" || mode === "outpaint") {
                maskImageDataUrl = String(params.maskImageDataUrl || "");
                if (mode === "outpaint") {
                    maskImageDataUrl = String(maskImageDataUrl || executionParams.maskImageDataUrl || "");
                }
                if (!maskImageDataUrl.startsWith("data:image/")) {
                    throw new Error(mode === "outpaint" ? "Easy outpaint: drag a frame outside the image before generating." : "Easy inpaint: paint a mask before generating.");
                }
                maskAsset = await this._saveEasyStandaloneAsset(maskImageDataUrl, `goyai_easy_${mode}_mask`);
            }
            const workflow = await this._loadEasyStandaloneWorkflow(mode);
            const { prompt, meta } = this._patchEasyStandaloneWorkflow(workflow, executionParams, { source: sourceAsset, mask: maskAsset }, mode);
            const queuePayload = {
                prompt,
                client_id: this._getComfyClientId(),
                extra_data: {
                    goyai_easy: {
                        source: "easy",
                        standalone: true,
                        mode,
                        scenario_override: `easy-${mode}`,
                    },
                },
            };
            const response = await fetch("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(queuePayload),
            });
            const queuedAt = Date.now();
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result?.error || `Easy queue failed (${response.status})`);
            }
            const promptId = String(result?.prompt_id || "").trim();
            if (!promptId) {
                throw new Error("Easy queue failed: ComfyUI did not return a prompt_id.");
            }
            const eventPayload = {
                source: "easy",
                easyStandalone: true,
                directPromptQueued: true,
                intentMode: mode,
                scenarioKey: `easy-${mode}`,
                prompt_id: promptId,
                directRender: false,
                extra: {
                    scenario_override: `easy-${mode}`,
                    engine: "easy",
                    easy_standalone: true,
                    direct_prompt_queued: true,
                    ...meta,
                },
            };
            console.log("[DISPATCHER] Easy standalone queued", eventPayload);
            this.eventBus.emit("workflow:started", { payload: eventPayload });
            this.eventBus.emit("workflow:queued", eventPayload);
            this.eventBus.emit("workflow:phase", { index: 2, count: 4, phase: "Prompt queued", phaseProgress: 50 });
            this.eventBus.emit("status:message", `Easy ${mode} queued${eventPayload.prompt_id ? `: ${eventPayload.prompt_id}` : ""}`);
            if (eventPayload.prompt_id) {
                const pollSerial = (this._easyResultPollSerial || 0) + 1;
                this._easyResultPollSerial = pollSerial;
                this._awaitEasyPromptResult(eventPayload.prompt_id, mode, { serial: pollSerial, queuedAt }).catch((error) => {
                    if (!this._easyResultPollIsCurrent(pollSerial)) return;
                    const message = error?.message || String(error);
                    console.warn("[WorkflowRunner] Easy history polling failed", error);
                    this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: mode });
                    this.eventBus.emit("status:message", message);
                });
            }
            return true;
        } catch (err) {
            const message = err?.message || String(err);
            console.warn("[WorkflowRunner] executeEasyStandalone failed", err);
            this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: mode });
            this.eventBus.emit("status:message", message);
            return false;
        }
    }

    // Helper: load scenario file (served statically)
    async _loadScenarioFile(name) {
        // Easy owns its workflow templates; do not fall through to the main Goya package.
        const urls = [
            `/iamccs/goyai_easy_static/workflows/${name}`,
            `/custom_nodes/IAMCCS_goyAIcanvas-easy/workflows/${name}`,
            `/extensions/IAMCCS_goyAIcanvas-easy/workflows/${name}`,
        ];
        let lastErr = null;
        for (const url of urls) {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (res.ok) {
                    return await res.json();
                }
                lastErr = new Error(`Fetch failed ${res.status} for ${url}`);
            } catch (e) {
                lastErr = e;
            }
        }
        throw new Error(`Cannot load scenario file: ${name} (${lastErr?.message || 'unknown error'})`);
    }

    _getGlobalPromptText() {
        const globalPrompt = this.promptManager?.getGlobalPrompt?.() || {};
        return typeof globalPrompt.positive === "string" ? globalPrompt.positive : "";
    }

    _getGlobalNegativePromptText() {
        const globalPrompt = this.promptManager?.getGlobalPrompt?.() || {};
        return typeof globalPrompt.negative === "string" ? globalPrompt.negative : "";
    }

    // Helper: bind SCENARIO_Z.json with current UI params (DOCUMENTO 7 template)
    _bindScenarioZ(def, params) {
        const graph = JSON.parse(JSON.stringify(def));

        const seed = params.seed ?? this.seed;
        const steps = params.steps ?? this.steps;
        const cfg = params.cfg ?? this.cfg;
        const sampler = params.sampler ?? this.sampler;
        const scheduler = params.scheduler ?? this.scheduler;
        const prompt = params.prompt ?? this._getGlobalPromptText();
        const unet = params.generationModel || params.modelChoice || params.unet || this.unetModel;
        const vae = params.vaeModel || params.vae || this.vaeModel;
        const clip = params.clipModel || params.clip || this.clip1Model;
        const clipType = params.clipType || this.clipType || "lumina2";
        const width = Number(params.width || this.easyCanvasWidth || this.canvasWidth);
        const height = Number(params.height || this.easyCanvasHeight || this.canvasHeight);

        for (const node of graph.nodes) {
            // 1. Prompt
            if (node.type === "CLIPTextEncode") {
                node.widgets_values[0] = prompt;
            }

            // 2. Models
            if (node.type === "UNETLoader") {
                node.widgets_values[0] = unet;
            }
            if (node.type === "VAELoader") {
                node.widgets_values[0] = vae;
            }
            if (node.type === "CLIPLoader") {
                node.widgets_values[0] = clip;
                if (node.widgets_values.length > 1) node.widgets_values[1] = clipType;
            }

            // 3. Sampler (DOCUMENTO 7 pattern)
            if (node.type === "KSampler" || node.type.includes("Sampler")) {
                node.widgets_values[0] = seed;
                node.widgets_values[2] = steps;
                node.widgets_values[3] = cfg;
                node.widgets_values[4] = sampler;
                node.widgets_values[5] = scheduler;
            }

            // 4. Latent (DOCUMENTO 9: canvas width/height binding)
            if (node.type === "EmptySD3LatentImage" ||
                node.type === "EmptyLatentImage" ||
                node.type.includes("Latent")) {
                const _d = this.getGenerationDimensions();
                node.widgets_values[0] = Number.isFinite(width) && width > 0 ? width : _d.width;
                node.widgets_values[1] = Number.isFinite(height) && height > 0 ? height : _d.height;
            }
        }

        return graph;
    }

    // Scenario Z (TXT2IMG via Z-Image) â€” per DOCUMENTO 6 architecture

    _getUiWorkflowWidgetInputs(node, params = {}) {
        const type = String(node?.type || "");
        const values = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
        if (type === "SaveImage") {
            return { filename_prefix: String(values[0] || params.filenamePrefix || `${EASY_OUTPUT_PREFIX}/goyai_easy_z`) };
        }
        if (type === "LoadImage") {
            return {
                image: String(params.sourceImage || values[0] || ""),
                upload: String(values[1] || "image"),
            };
        }
        if (type === "SeedVR2LoadVAEModel") {
            return {
                model: String(params.seedvr2VaeModel || params.vaeModel || values[0] || ""),
                device: String(values[1] || "cuda:0"),
                encode_tiled: !!values[2],
                encode_tile_size: Number(values[3] || 1024),
                encode_tile_overlap: Number(values[4] || 128),
                decode_tiled: !!values[5],
                decode_tile_size: Number(values[6] || 1024),
                decode_tile_overlap: Number(values[7] || 128),
                tile_debug: String(values[8] || "false"),
                offload_device: String(values[9] || "cpu"),
                cache_model: !!values[10],
            };
        }
        if (type === "SeedVR2LoadDiTModel") {
            return {
                model: String(params.seedvr2DitModel || params.generationModel || params.modelChoice || values[0] || ""),
                device: String(values[1] || "cuda:0"),
                blocks_to_swap: Number(values[2] || 0),
                swap_io_components: !!values[3],
                offload_device: String(values[4] || "cpu"),
                cache_model: !!values[5],
                attention_mode: String(values[6] || "sdpa"),
            };
        }
        if (type === "SeedVR2VideoUpscaler") {
            const seed = Number(params.seed);
            const resolution = Number(params.seedvr2Resolution ?? params.resolution ?? values[2] ?? 2048);
            const maxResolution = Number(params.seedvr2MaxResolution ?? params.maxResolution ?? values[3] ?? 4096);
            return {
                seed: Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) : Math.floor(Math.random() * 4294967295),
                resolution: Number.isFinite(resolution) ? Math.max(16, Math.round(resolution / 2) * 2) : 2048,
                max_resolution: Number.isFinite(maxResolution) ? Math.max(0, Math.round(maxResolution / 2) * 2) : 4096,
                batch_size: Math.max(1, Math.round(Number(values[4] || params.seedvr2BatchSize || 5))),
                uniform_batch_size: !!values[5],
                color_correction: String(values[6] || "lab"),
                temporal_overlap: Number(values[7] || 0),
                prepend_frames: Number(values[8] || 0),
                input_noise_scale: Number(values[9] || 0),
                latent_noise_scale: Number(values[10] || 0),
                offload_device: String(values[11] || "cpu"),
                enable_debug: !!values[12],
            };
        }
        if (type === "ImageScaleBy") {
            const scaleBy = Number(params.scale_by ?? params.scaleBy ?? params.seedvr2ScaleBy ?? values[1] ?? 1);
            return {
                upscale_method: String(params.upscale_method || params.upscaleMethod || values[0] || "lanczos"),
                scale_by: Number.isFinite(scaleBy) && scaleBy > 0 ? scaleBy : 1,
            };
        }
        if (type === "VAELoader") {
            return { vae_name: String(params.vaeModel || this.vaeModel || "") };
        }
        if (type === "VaeGGUF") {
            return { vae_name: String(params.vaeModel || values[0] || this.vaeModel || "") };
        }
        if (type === "UNETLoader") {
            return {
                unet_name: String(params.generationModel || params.modelChoice || this.unetModel || ""),
                weight_dtype: String(values[1] || "default"),
            };
        }
        if (type === "LoaderGGUF") {
            const modelName = String(params.generationModel || params.modelChoice || values[0] || this.unetModel || "");
            return /\.gguf$/i.test(modelName)
                ? { gguf_name: modelName }
                : { unet_name: modelName, weight_dtype: "default" };
        }
        if (type === "UnetLoaderGGUF") {
            return { unet_name: String(params.generationModel || params.modelChoice || values[0] || this.unetModel || "") };
        }
        if (type === "CLIPLoader") {
            return {
                clip_name: String(params.clipModel || this.clip1Model || ""),
                type: String(values[1] || params.clipType || this.clipType || "lumina2"),
                device: String(values[2] || "default"),
            };
        }
        if (type === "CLIPLoaderGGUF" || type === "ClipLoaderGGUF") {
            return {
                clip_name: String(params.clipModel || values[0] || this.clip1Model || ""),
                type: String(values[1] || params.clipType || this.clipType || "flux2"),
                device: String(values[2] || "default"),
            };
        }
        if (type === "CLIPTextEncode") {
            return { text: String(values[0] || params.prompt || this._getGlobalPromptText?.() || "") };
        }
        if (type === "EmptySD3LatentImage" || type === "EmptyLatentImage" || type === "EmptyFlux2LatentImage") {
            const dims = this.getGenerationDimensions?.() || {};
            return {
                width: Math.max(64, Math.round(Number(params.width ?? dims.width ?? this.easyCanvasWidth ?? values[0] ?? 1024))),
                height: Math.max(64, Math.round(Number(params.height ?? dims.height ?? this.easyCanvasHeight ?? values[1] ?? 1024))),
                batch_size: Math.max(1, Math.round(Number(values[2] || params.batchSize || this.zBatchSize || 1))),
            };
        }
        if (type === "ImageScaleToTotalPixels") {
            return {
                upscale_method: String(params.referenceUpscaleMethod || values[0] || "nearest-exact"),
                megapixels: Number(params.referenceMegapixels ?? values[1] ?? 1) || 1,
                resolution_steps: Math.max(1, Math.round(Number(params.referenceResolutionSteps ?? values[2] ?? 1) || 1)),
            };
        }
        if (type === "ImagePadKJ") {
            return {
                left: Math.max(0, Math.round(Number(values[0] || 0))),
                right: Math.max(0, Math.round(Number(values[1] || 0))),
                top: Math.max(0, Math.round(Number(values[2] || 0))),
                bottom: Math.max(0, Math.round(Number(values[3] || 0))),
                extra_padding: Math.max(0, Math.round(Number(values[4] || 0))),
                pad_mode: String(values[5] || "color"),
                color: String(values[6] || "0, 0, 0"),
            };
        }
        if (type === "ImageResizeKJv2") {
            return {
                width: Math.max(64, Math.round(Number(values[0] || params.width || this.easyCanvasWidth || 1024))),
                height: Math.max(64, Math.round(Number(values[1] || params.height || this.easyCanvasHeight || 1024))),
                upscale_method: String(values[2] || "nearest-exact"),
                keep_proportion: String(values[3] || "resize"),
                pad_color: String(values[4] || "0, 0, 0"),
                crop_position: String(values[5] || "center"),
                divisible_by: Math.max(1, Math.round(Number(values[6] || 2))),
                device: String(values[7] || "cpu"),
            };
        }
        if (type === "KSampler") {
            const rawSeed = Number(params.seed ?? values[0] ?? this.seed);
            return {
                seed: Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * 1125899906842624),
                steps: Math.max(1, Math.round(Number(params.steps ?? values[2] ?? this.steps ?? 8) || 8)),
                cfg: Number(params.cfg ?? values[3] ?? this.cfg ?? 1) || 1,
                sampler_name: String(params.sampler || values[4] || this.sampler || "res_multistep"),
                scheduler: String(params.scheduler || values[5] || this.scheduler || "simple"),
                denoise: Math.max(0, Math.min(1, Number(params.denoise ?? values[6] ?? 1) || 1)),
            };
        }
        if (type === "RandomNoise") {
            const rawSeed = Number(params.seed ?? values[0] ?? this.seed);
            return { noise_seed: Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * EASY_RANDOM_SEED_MAX) };
        }
        if (type === "KSamplerSelect") {
            return { sampler_name: String(params.fl9bSampler || params.sampler || values[0] || this.sampler || "res_2s") };
        }
        if (type === "Flux2Scheduler") {
            return {
                steps: Math.max(1, Math.round(Number(params.steps ?? values[0] ?? this.steps ?? 8) || 8)),
                width: Math.max(64, Math.round(Number(params.width ?? values[1] ?? this.easyCanvasWidth ?? 1024))),
                height: Math.max(64, Math.round(Number(params.height ?? values[2] ?? this.easyCanvasHeight ?? 1024))),
            };
        }
        if (type === "CFGGuider") {
            return { cfg: Number(params.cfg ?? values[0] ?? this.cfg ?? 1) || 1 };
        }
        if (type === "LoraLoaderModelOnly") {
            return {
                lora_name: String(values[0] || ""),
                strength_model: Number(values[1] ?? 1) || 1,
            };
        }
        if (type === "ModelSamplingAuraFlow") {
            return { shift: Number(values[0] ?? this.auraFlowShift ?? 3) || 3 };
        }
        return {};
    }

    _compileUiWorkflowToApiPrompt(workflow, params = {}) {
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        const links = Array.isArray(workflow?.links) ? workflow.links : [];
        const nodeById = new Map();
        for (const node of nodes) {
            if (node && node.id !== undefined) {
                nodeById.set(String(node.id), node);
            }
        }
        const linkById = new Map();
        for (const link of links) {
            if (Array.isArray(link) && link.length >= 5) {
                linkById.set(Number(link[0]), link);
            }
        }

        const resolveOrigin = (link, seen = new Set()) => {
            if (!Array.isArray(link)) return null;
            const originNodeId = String(link[1]);
            const originSlot = Number(link[2]) || 0;
            if (seen.has(originNodeId)) return { nodeId: originNodeId, slot: originSlot };
            seen.add(originNodeId);
            const originNode = nodeById.get(originNodeId);
            const originType = String(originNode?.type || originNode?.class_type || "").trim().toLowerCase();
            if (originType === "reroute") {
                const rerouteInput = (originNode.inputs || []).find((input) => Number.isFinite(Number(input?.link)));
                const sourceLink = linkById.get(Number(rerouteInput?.link));
                return resolveOrigin(sourceLink, seen) || { nodeId: originNodeId, slot: originSlot };
            }
            if (originType === "power lora loader (rgthree)") {
                const inputName = originSlot === 1 ? "clip" : "model";
                const sourceInput = (originNode.inputs || []).find((input) => String(input?.name || "").toLowerCase() === inputName);
                const sourceLink = linkById.get(Number(sourceInput?.link));
                return resolveOrigin(sourceLink, seen) || { nodeId: originNodeId, slot: originSlot };
            }
            if (!originType || !this._isInlineUiWorkflowNode(originNode)) {
                return { nodeId: originNodeId, slot: originSlot };
            }
            return { nodeId: originNodeId, slot: originSlot, inline: true };
        };

        const prompt = {};
        for (const node of nodes) {
            if (!node || node.id === undefined || !node.type) continue;
            if (this._isDecorativeUiWorkflowNode(node)) continue;
            const inputs = this._getUiWorkflowWidgetInputs(node, params);
            for (const input of (node.inputs || [])) {
                const linkId = Number(input?.link);
                if (!Number.isFinite(linkId)) continue;
                const link = linkById.get(linkId);
                if (!link) continue;
                const origin = resolveOrigin(link);
                if (!origin) continue;
                if (origin.inline) {
                    const inlineNode = nodeById.get(origin.nodeId);
                    inputs[String(input.name)] = this._inlineUiWorkflowValue(inlineNode, params);
                    continue;
                }
                inputs[String(input.name)] = [origin.nodeId, origin.slot];
            }
            prompt[String(node.id)] = {
                class_type: this._classTypeForUiWorkflowNode(node, params),
                inputs,
            };
        }
        this._replaceEasyReferenceConditioningNodes(prompt);
        return prompt;
    }

    _classTypeForUiWorkflowNode(node, params = {}) {
        const type = String(node?.type || "");
        if (type === "LoaderGGUF") {
            const values = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
            const modelName = String(params.generationModel || params.modelChoice || values[0] || this.unetModel || "");
            return /\.gguf$/i.test(modelName) ? "LoaderGGUF" : "UNETLoader";
        }
        return type;
    }

    _isInlineUiWorkflowNode(node) {
        const type = String(node?.type || node?.class_type || "").trim().toLowerCase();
        return type === "primitivefloat"
            || type === "primitiveint"
            || type === "easy int"
            || type === "primitivestringmultiline"
            || type === "seed generator"
            || type === "sampler selector";
    }

    _inlineUiWorkflowValue(node, params = {}) {
        const type = String(node?.type || node?.class_type || "").trim().toLowerCase();
        const values = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
        if (type === "seed generator") {
            const rawSeed = Number(params.seed ?? values[0] ?? this.seed);
            return Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : Math.floor(Math.random() * EASY_RANDOM_SEED_MAX);
        }
        if (type === "sampler selector") {
            return String(params.fl9bSampler || params.sampler || values[0] || this.sampler || "res_2s");
        }
        if (type === "primitivefloat") {
            return Number(params.cfg ?? values[0] ?? this.cfg ?? 1) || 1;
        }
        if (type === "primitiveint" || type === "easy int") {
            return Math.max(1, Math.round(Number(params.steps ?? values[0] ?? this.steps ?? 8) || 8));
        }
        if (type === "primitivestringmultiline") {
            return String(params.prompt ?? values[0] ?? this._getGlobalPromptText?.() ?? "");
        }
        return values[0];
    }

    _replaceEasyReferenceConditioningNodes(prompt = {}) {
        const entries = Object.entries(prompt || {});
        const numericIds = entries.map(([id]) => Number(id)).filter(Number.isFinite);
        let nextId = numericIds.length ? Math.max(...numericIds) + 1 : 9000;
        const replacements = [];
        for (const [nodeId, node] of entries) {
            const classType = String(node?.class_type || "");
            const inputs = node?.inputs || {};
            const looksLikeReferenceConditioning = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(classType)
                && Array.isArray(inputs.pixels)
                && Array.isArray(inputs.vae)
                && Array.isArray(inputs.conditioning)
                && Array.isArray(inputs.conditioning_1);
            if (!looksLikeReferenceConditioning) continue;
            const posId = String(nextId++);
            const negId = String(nextId++);
            prompt[nodeId] = {
                class_type: "VAEEncode",
                inputs: {
                    pixels: inputs.pixels,
                    vae: inputs.vae,
                },
            };
            prompt[posId] = {
                class_type: "ReferenceLatent",
                inputs: {
                    conditioning: inputs.conditioning,
                    latent: [nodeId, 0],
                },
                _meta: { title: "Easy Outpaint Reference Positive" },
            };
            prompt[negId] = {
                class_type: "ReferenceLatent",
                inputs: {
                    conditioning: inputs.conditioning_1,
                    latent: [nodeId, 0],
                },
                _meta: { title: "Easy Outpaint Reference Negative" },
            };
            replacements.push({ sourceId: nodeId, posId, negId });
        }
        for (const replacement of replacements) {
            for (const [currentId, node] of Object.entries(prompt || {})) {
                if (currentId === replacement.posId || currentId === replacement.negId) continue;
                const inputs = node?.inputs || {};
                for (const [key, value] of Object.entries(inputs)) {
                    if (!Array.isArray(value) || String(value[0]) !== replacement.sourceId) continue;
                    const slot = Number(value[1]) || 0;
                    inputs[key] = [slot === 1 ? replacement.negId : replacement.posId, 0];
                }
            }
        }
    }

    _applyNegativeTextEncodeFallback(prompt = {}, negativeText = "") {
        const negative = String(negativeText ?? this._getGlobalNegativePromptText?.() ?? "");
        if (!negative.trim()) return false;
        const entries = Object.entries(prompt || {});
        const clipEncodeEntries = entries.filter(([_id, node]) => String(node?.class_type || "") === "CLIPTextEncode");
        if (!clipEncodeEntries.length) return false;
        let changed = false;
        for (const [nodeId, node] of entries) {
            if (String(node?.class_type || "") !== "ConditioningZeroOut") continue;
            const conditioning = node?.inputs?.conditioning;
            const sourceId = Array.isArray(conditioning) ? String(conditioning[0]) : "";
            const positiveNode = prompt[sourceId] || clipEncodeEntries[0]?.[1];
            const clipInput = positiveNode?.inputs?.clip;
            if (!Array.isArray(clipInput)) continue;
            prompt[nodeId] = {
                class_type: "CLIPTextEncode",
                inputs: {
                    clip: [...clipInput],
                    text: negative,
                },
                _meta: {
                    ...(node?._meta || {}),
                    title: "IAMCCS GoyAIcanvas Negative CLIPTextEncode",
                },
            };
            changed = true;
        }
        if (changed) {
            this.eventBus?.emit?.("status:message", "Negative prompt linked");
        }
        return changed;
    }

    _applyModelOnlyLoras(prompt = {}) {
        const loras = [
            this.lora1Enabled && this.lora1Model ? { name: this.lora1Model, strength: this.lora1Strength } : null,
            this.lora2Enabled && this.lora2Model ? { name: this.lora2Model, strength: this.lora2Strength } : null,
            this.lora3Enabled && this.lora3Model ? { name: this.lora3Model, strength: this.lora3Strength } : null,
        ].filter(Boolean);
        if (!loras.length) return false;
        const entries = Object.entries(prompt || {});
        const modelEntry = entries.find(([_id, node]) => String(node?.class_type || "") === "UNETLoader"
            || String(node?.class_type || "") === "LoaderGGUF"
            || String(node?.class_type || "") === "UnetLoaderGGUF"
            || String(node?.class_type || "") === "CheckpointLoaderSimple");
        if (!modelEntry) return false;
        const sourceModelId = String(modelEntry[0]);
        const numericIds = entries.map(([id]) => Number(id)).filter(Number.isFinite);
        let nextId = numericIds.length ? Math.max(...numericIds) + 1 : 9000;
        let currentModelRef = [sourceModelId, 0];
        const createdIds = new Set();
        for (const lora of loras) {
            const id = String(nextId++);
            createdIds.add(id);
            prompt[id] = {
                class_type: "LoraLoaderModelOnly",
                inputs: {
                    model: currentModelRef,
                    lora_name: String(lora.name || ""),
                    strength_model: Number(lora.strength) || 1,
                },
                _meta: { title: "Easy LoRA" },
            };
            currentModelRef = [id, 0];
        }
        for (const [id, node] of Object.entries(prompt || {})) {
            if (createdIds.has(String(id))) continue;
            const inputs = node?.inputs || {};
            for (const [key, value] of Object.entries(inputs)) {
                if (key !== "model" || !Array.isArray(value)) continue;
                if (String(value[0]) === sourceModelId && Number(value[1] || 0) === 0) {
                    inputs[key] = [...currentModelRef];
                }
            }
        }
        return true;
    }

    _isDecorativeUiWorkflowNode(node) {
        const type = String(node?.type || node?.class_type || '').trim().toLowerCase();
        if (!type) return false;
        return type === 'label (rgthree)'
            || type === 'note'
            || type === 'note (rgthree)'
            || type === 'getnode'
            || type === 'reroute'
            || type === 'power lora loader (rgthree)'
            || this._isInlineUiWorkflowNode(node);
    }

    async _queueEasyPrompt(prompt, eventPayload = {}) {
        const queuePayload = {
            prompt,
            client_id: this._getComfyClientId(),
            extra_data: {
                goyai_easy: {
                    source: "easy",
                    standalone: true,
                    mode: eventPayload.intentMode || eventPayload.mode || "unknown",
                    scenario_override: eventPayload.scenarioKey || "easy",
                    direct_prompt_queued: true,
                },
            },
        };
        const response = await fetch("/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(queuePayload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result?.error || `Easy queue failed (${response.status})`);
        }
        const payload = {
            ...eventPayload,
            source: "easy",
            easyStandalone: true,
            directPromptQueued: true,
            directRender: false,
            prompt_id: result?.prompt_id || "",
            extra: {
                ...(eventPayload.extra || {}),
                easy_standalone: true,
                direct_prompt_queued: true,
            },
        };
        this.eventBus.emit("workflow:started", { payload });
        this.eventBus.emit("workflow:queued", payload);
        this.eventBus.emit("workflow:phase", { index: 2, count: 4, phase: "Prompt queued", phaseProgress: 50 });
        return payload;
    }

    async executeEasyZImageStandalone(params = {}) {
        try {
            const workflow = await this._loadScenarioFile("SCENARIO_Z.json");
            const patchedWorkflow = this._bindScenarioZ(workflow, params);
            for (const node of (patchedWorkflow.nodes || [])) {
                if (node?.type === "SaveImage") {
                    node.widgets_values = [`${EASY_OUTPUT_PREFIX}/goyai_easy_z`];
                }
            }
            const prompt = this._compileUiWorkflowToApiPrompt(patchedWorkflow, {
                ...params,
                filenamePrefix: `${EASY_OUTPUT_PREFIX}/goyai_easy_z`,
            });
            this._applyNegativeTextEncodeFallback(prompt, params.negativePrompt);
            this._applyModelOnlyLoras(prompt);
            const queued = await this._queueEasyPrompt(prompt, {
                intentMode: "t2i",
                scenarioKey: "easy-z",
                templateKey: "z",
                extra: {
                    scenario_override: "easy-z",
                    engine: "easy",
                    easy_standalone: true,
                    workflow: "SCENARIO_Z.json",
                    seed: params.seed,
                },
            });
            this.eventBus.emit("status:message", `Easy Z-Image queued${queued.prompt_id ? `: ${queued.prompt_id}` : ""}`);
            if (queued.prompt_id) {
                this._awaitEasyPromptResult(queued.prompt_id, "z").catch((error) => {
                    const message = error?.message || String(error);
                    console.warn("[WorkflowRunner] Easy Z history polling failed", error);
                    this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: "t2i", scenarioKey: "easy-z" });
                    this.eventBus.emit("status:message", message);
                });
            }
            return true;
        } catch (err) {
            const message = err?.message || String(err);
            console.warn("[WorkflowRunner] executeEasyZImageStandalone failed", err);
            this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: "t2i", scenarioKey: "easy-z" });
            this.eventBus.emit("status:message", message);
            return false;
        }
    }

    async executeEasyUpscaleStandalone(params = {}) {
        try {
            const sourceImageDataUrl = String(params.sourceImageDataUrl || "");
            if (!sourceImageDataUrl.startsWith("data:image/")) {
                throw new Error("Easy upscale: import or generate an image on the canvas before upscaling.");
            }
            const sourceAsset = await this._saveEasyStandaloneAsset(sourceImageDataUrl, "goyai_easy_upscale_source");
            const sourceImage = this._easyAssetLoadImageValue(sourceAsset);
            const workflow = await this._loadScenarioFile("SCENARIO_SEEDVR2.json");
            const patchedWorkflow = this._bindScenarioZ(workflow, params);
            for (const node of (patchedWorkflow.nodes || [])) {
                if (node?.type === "SaveImage") {
                    node.widgets_values = [`${EASY_OUTPUT_PREFIX}/goyai_easy_upscale`];
                }
                if (node?.type === "LoadImage") {
                    node.widgets_values = [sourceImage, "image"];
                }
            }
            const prompt = this._compileUiWorkflowToApiPrompt(patchedWorkflow, {
                ...params,
                sourceImage,
                filenamePrefix: `${EASY_OUTPUT_PREFIX}/goyai_easy_upscale`,
                seedvr2DitModel: params.seedvr2DitModel || this.seedvr2DitModel || params.generationModel || params.modelChoice || "",
                seedvr2VaeModel: params.seedvr2VaeModel || this.seedvr2VaeModel || params.vaeModel || "",
            });
            this._applyNegativeTextEncodeFallback(prompt, params.negativePrompt);
            const queued = await this._queueEasyPrompt(prompt, {
                intentMode: "upscale",
                scenarioKey: "easy-upscale",
                templateKey: "upscale",
                extra: {
                    scenario_override: "easy-upscale",
                    engine: "easy",
                    easy_standalone: true,
                    workflow: "SCENARIO_SEEDVR2.json",
                    seed: params.seed,
                },
            });
            this.eventBus.emit("status:message", `Easy upscale queued${queued.prompt_id ? `: ${queued.prompt_id}` : ""}`);
            if (queued.prompt_id) {
                this._awaitEasyPromptResult(queued.prompt_id, "upscale").catch((error) => {
                    const message = error?.message || String(error);
                    console.warn("[WorkflowRunner] Easy upscale history polling failed", error);
                    this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: "upscale", scenarioKey: "easy-upscale" });
                    this.eventBus.emit("status:message", message);
                });
            }
            return true;
        } catch (err) {
            const message = err?.message || String(err);
            console.warn("[WorkflowRunner] executeEasyUpscaleStandalone failed", err);
            this.eventBus.emit("workflow:error", { error: message, source: "easy", intentMode: "upscale", scenarioKey: "easy-upscale" });
            this.eventBus.emit("status:message", message);
            return false;
        }
    }

    destroy() {}
}
