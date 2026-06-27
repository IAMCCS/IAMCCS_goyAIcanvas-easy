import Constants from "../utils/Constants.js";

// Test switch: execution source for Flux/Z during quality comparison
// Values: "python" (use backend runners only) | "json" (use JSON graph via /prompt)
// Force Python-only execution path.
import { loadEasyWorkflow, saveEasyAsset } from "../utils/EasyApi.js";
const TEST_FLUXZ_EXEC_MODE = "python";
const EASY_OUTPUT_PREFIX = "goya_output";

// Internal scenario registry (mirrors existing scenarios; minimal addition)
const SCENARIO_FILES = {
    "scenario_1": "SCENARIO1.json",
    "scenario_1c": "SCENARIO1C.json",
    "scenario_2": "SCENARIO_2.json",
    "scenario_z": "SCENARIO_Z.json",
    "scenario_z2": "SCENARIO_Z2.json",
};

export default class WorkflowRunner {
    constructor(eventBus, bridge, layerManager, promptManager, maskManager) {
        this.eventBus = eventBus;
        this.bridge = bridge;
        this.layerManager = layerManager;
        this.promptManager = promptManager;
        this.maskManager = maskManager;
        this.canvasWidth = Constants.CANVAS_WIDTH;
        this.canvasHeight = Constants.CANVAS_HEIGHT;
        // Easy mode has its own independent canvas dimensions
        this.easyCanvasWidth = Constants.CANVAS_WIDTH;
        this.easyCanvasHeight = Constants.CANVAS_HEIGHT;
        // Track which mode initiated the current generation
        this._generationSource = 'advanced'; // 'easy' | 'advanced'
        this.seed = -1;
        this.steps = 8;
        this.cfg = 1;
        // Separate guidance used by FluxGuidance (distinct from CFG)
        this.globalGuidance = 3.5;
        this.sampler = "euler";
        this.scheduler = "beta";
        this.qwenEnabled = true;
        this.goyaiAssistant = {
            enabled: false,
            open: false,
            floating: true,
            transparent: false,
            model: "",
            authority: "watcher",
            disableThinking: true,
            voiceInputEnabled: false,
            voiceOutputEnabled: true,
            recognitionLang: 'it-IT',
            asrProvider: 'browser',
            asrModel: 'whisper',
            voiceInputMode: 'click',
            wakeWord: 'goya',
            ttsProvider: 'browser',
            ttsVoice: 'af_heart',
            ttsSpeed: 1.1,
            keepAliveMinutes: 30,
            requestTimeoutSeconds: 50,
            promptEngineeringEnabled: true,
            promptEngineeringProfile: 'ltx',
        };
        this.videoWorkflowSettings = {
            workflowId: 'ltx23_manual_inpaint_v1',
            unetMode: 'gguf',
            ggufModel: 'ltx-2.3-22b-dev-Q4_K_S.gguf',
            unetModel: 'ltx-2.3-22b-distilled_transformer_only_fp8_input_scaled_v3.safetensors',
            videoVaeModel: '',
            audioVaeModel: '',
            textEncoderModel: 'gemma_3_12B_it_fp8_e4m3fn.safetensors',
            textProjectionModel: 'ltx-2.3_text_projection_bf16.safetensors',
            distilledLoraEnabled: true,
            distilledLoraModel: 'ltx-2.3-22b-distilled-lora-384.safetensors',
            distilledLoraStrength: 1.0,
            inpaintLoraEnabled: false,
            inpaintLoraModel: 'ltx23_inpaint_rank128_v1.safetensors',
            inpaintLoraStrength: 1.0,
            sampler: 'euler_ancestral_cfg_pp',
            steps: 8,
            seedMode: 'fixed',
            seedValue: 10,
            scheduler: 'bong_tangent',
        };
        this.useCompositeInit = false;
        // Execution mode for Flux/Z (A/B switch): default from constant, updatable via UI
        this.execModeFluxZ = TEST_FLUXZ_EXEC_MODE;
    // Scaling controls removed: backend scales automatically to 1MP
    // Extra controls for backend (Scenario 2)
    this.lora2Enabled = false;
    this.lora2Model = "";
    this.lora2Strength = 1.0;
    // Primary LoRA override (optional, mirrors node widget if unset)
    this.lora1Enabled = false;
    this.lora1Model = "";
    this.lora1Strength = 1.0;
    // Scenario 1C: LoRA 3, accelerator
    this.lora3Enabled = false;
    this.lora3Model = "";
    this.lora3Strength = 1.0;
    // Model optimizations (applied either by Python runners or injected into prompt-graphs)
    // Defaults requested: ON (Sage CUDA + FP16 accumulation)
    this.acceleratorEnabled = true;
    this.fp16AccumulationEnabled = true;
    this.sageAttentionMode = "sageattn_qk_int8_pv_fp16_cuda";
    // Engine and model selection
    this.engine = "qwen"; // "qwen" or "flux"
    this.unetModel = "";
    this.vaeModel = "";
    this.clip1Model = "";
    this.clip2Enabled = false;
    this.clip2Model = "";
    this.clipType = "qwen"; // or "flux"
    // Flux sigma shift parameters
        this.fluxMaxShift = 1.15;
        this.fluxBaseShift = 0.5;
        // Flux txt2img batch size (EmptySD3LatentImage)
        this.txt2imgBatch = 1;
        // Scenario Z controls
        this.zBatchSize = 1;
        this.auraFlowShift = 3;
        // Scenario Z: optional unified checkpoint loader (model+clip+vae)
        this.zUseCheckpoint = false;
        this.zCheckpointName = "";
        // Scenario Z2: optional unified checkpoint loader (model+clip+vae)
        this.z2UseCheckpoint = false;
        this.z2CheckpointName = "";
        // Upscale controls
        this.upscaleEnabled = false;
        this.upscaleModel = "4x-ClearRealityV1.pth";
        this.upscaleFactor = 2.0;
        this.upscaleDenoise = 0.15;
        this.modeType = "Chess";
        this.tileWidth = 1024;
        this.tileHeight = 1024;
        this.maskBlur = 8;
        this.tilePadding = 32;
        this.seamFixMode = "None";
        this.seamFixDenoise = 1.0;
        this.seamFixMaskBlur = 64;
        this.seamFixWidth = 8;
        this.seamFixPadding = 16;
        this.forceUniformTiles = true;
        this.tiledDecode = false;
        // Collect arbitrary upscale extras (e.g., SeedVR2 params)
        this.upscaleExtras = {};
        this.seedvr2Params = {};
        this.upscaleMode = "seedvr2";
        this.upscalePanelSubmode = "seedvr2";
        this.seedvr2Enabled = false;
        this.seedvr2DitModel = "";
        // SDultimate-specific parameters
        this.upscaleUnetModel = "";
        this.upscaleVaeModel = "";
        this.upscaleClipType = "lumina2";
        this.upscaleClip1Model = "";
        this.upscaleClip2Enabled = false;
        this.upscaleClip2Model = "";
        this.upscaleLora1Model = "";
        this.upscaleLora1Strength = 1.0;
        this.upscaleLora2Model = "";
        this.upscaleLora2Strength = 1.0;
        this.upscaleLora3Model = "";
        this.upscaleLora3Strength = 1.0;

        // Scenario Z FlashVSR upscale options
        this.zUpscaleEnabled = false;
        this.zFlashModel = "FlashVSR-v1.1";
        this.zFlashMode = "tiny"; // tiny | tiny-long | full
        this.zFlashScale = 2; // 2..4
        this.zFlashTiledVae = true;
        this.zFlashTiledDit = true;
        this.zFlashUnloadDit = false;
        this.zFlashSeed = 0;

        // Scenario LIL (LTX-2 I2V) parameters
        // Empty Latent Video
        // Keep defaults aligned with Visual sphere (faster + consistent).
        this.lilWidth = 768;
        this.lilHeight = 512;
        this.lilFps = 25;
        this.lilFrames = 97;
        this.lilInheritDimensions = false;  // inherit width/height/aspect from input image
        // Stage 2 upscale (mandatory, hardcoded: cfg=1.0, sigmas=fixed, strength=1.0, bypass=false, sampler=euler, seed=inherited)
        this.lilUpscaleModel = "ltx-2-spatial-upscaler-x2-1.0.safetensors";
        // Audio/Save
        this.lilAudioVae = "LTX2_audio_vae_bf16.safetensors";
        this.lilOutputFolder = "output_goyaicanvas";
        this.lilFilenamePrefix = "IAMCCS_lil";
        this.lilFormat = "mp4";
        this.lilCodec = "h264";

        // Decode tiled defaults (performance): ensure panel-triggered LIL doesn't fall back to heavy reference defaults.
        this.lilSpatialTiles = 2;
        this.lilSpatialOverlap = 2;
        this.lilTemporalTileLength = 32;
        this.lilDecodeWorkingDevice = "auto";

        // Scenario 1C (Flux) FlashVSR upscale options
        this.s1cUpscaleEnabled = false;
        this.s1cFlashModel = "FlashVSR-v1.1";
        this.s1cFlashMode = "tiny"; // tiny | tiny-long | full
        this.s1cFlashScale = 2; // 2..4
        this.s1cFlashTiledVae = true;
        this.s1cFlashTiledDit = true;
        this.s1cFlashUnloadDit = false;
        this.s1cFlashSeed = 0;
        this.zFlashSeedMode = "randomize"; // randomize | fixed
        this.s1cFlashSeedMode = "randomize";
        this.zFlashSeedLocked = false;
        this.s1cFlashSeedLocked = false;

        // DISPATCHER: Track active UI panel for scenario routing
        this.activePanel = null; // "qwen" | "flux" | "z" | "z2" | "sdultimate" | "seedvr2" | "video"

        // FL2 panel explicit mode override (null/"auto" => use resolver)
        // Allowed: "fl2-i" | "fl2-s" | "fl2-t" | "fl2-o"
        this.fl2PanelScenario = null;

        // FL2-O (outpaint) extras (pixels)
        this.fl2oLeft = 128;
        this.fl2oTop = 128;
        this.fl2oRight = 128;
        this.fl2oBottom = 128;
        this.fl2oFeathering = 64;

        // FL2-O: optional resize cap (0 = disabled)
        this.fl2oMaxWidth = 1328;
        this.fl2oMaxHeight = 1328;

        this.eventBus.on("workflow:execute", (params) => {
            console.log("[RUNNER] workflow:execute FIRED");
            this.executeActiveScenario(params);
        });
        // UI toggle for execution mode (Flux/Z) disabled: always Python
        this.eventBus.on("runner:execmode:set", () => {
            this.execModeFluxZ = "python";
        });
        // Scenario Z triggers
        this.eventBus.on("scenario:z:run", (params) => this.executeScenarioZ(params));
        this.eventBus.on("scenario:z2:run", (params) => this.executeScenarioZ2(params));
        this.eventBus.on("scenario:z3:run", (params) => this.executeScenarioZ3(params));
        this.eventBus.on("scenario:z:update", (params) => this.updateScenarioZParams(params));
        this.eventBus.on("canvas:qwen", (payload) => {
            if (payload && typeof payload.enabled === "boolean") {
                this.setQwenEnabled(payload.enabled);
            }
        });
        // Update Global Prompt immediately when backend state is pulled and contains prompt_preview
        this.eventBus.on("bridge:state:pulled", (payload) => {
            try {
                console.log("[FRONTEND DEBUG] bridge:state:pulled received, payload keys:", Object.keys(payload || {}));
                if (payload?.extra) {
                    console.log("[FRONTEND DEBUG] payload.extra keys:", Object.keys(payload.extra));
                    if (payload.extra.controlnet_preview_data_url) {
                        console.log("[FRONTEND DEBUG] controlnet_preview_data_url found, length:", payload.extra.controlnet_preview_data_url.length);
                    }
                    if (payload.extra.prompt_preview) {
                        console.log("[FRONTEND DEBUG] prompt_preview found, length:", payload.extra.prompt_preview.length);
                    }
                }
                const preview = payload?.extra?.prompt_preview || payload?.prompt_preview || "";
                if (typeof preview === "string" && preview.trim().length > 0) {
                    console.log("[FRONTEND PROMPT] bridge:state:pulled → prompt_preview detected (chars)", preview.length, "text:", preview.substring(0, 200));
                    this._emitZ2PromptPreview(preview, { force: true });
                }
            } catch (e) {
                console.warn("[WorkflowRunner] Failed to process bridge:state:pulled for prompt_preview", e);
            }
        });

        // Z2 secondary prompt and Qwen-VL description cache
        this.z2SecondaryPrompt = "";
        // Z3 ControlNet patch model (ComfyUI models/model_patches)
        this.z3ControlNetPatchModel = "Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors";
        this.z2QwenLastDescription = "";
        this.z2QwenModel = "Qwen3-VL-4B-Instruct";
        this.z2QwenQuant = "4-bit (VRAM-friendly)";
        this.z2QwenPreset = "🖼️ Detailed Description";
        this.z2QwenCustomPrompt = "";
        this.z2QwenAttention = "auto";
        this.z2QwenKeepLoaded = true;
        this.z2QwenMaxTokens = 1024;
        this.z2K1Seed = -1;
        this.z2K2Seed = -1;
        this.z2K1SeedLastFixed = 0;
        this.z2K2SeedLastFixed = 0;
        this.z2K1Steps = 6;
        this.z2K2Steps = 3;
        this.z2K1Cfg = 1.0;
        this.z2K2Cfg = 1.0;
        this.z2K1Sampler = "res_multistep";
        this.z2K2Sampler = "res_multistep";
        this.z2K1Scheduler = "simple";
        this.z2K2Scheduler = "simple";
        this.z2K1Denoise = 1.0;
        this.z2K2Denoise = 0.6;
        this._z2PromptPreview = "";

        // Qwen-VL model selection from UI (Z2/Z3)
        this.eventBus.on("z2:qwen:model", ({ model }) => {
            if (model) {
                this.z2QwenModel = String(model);
                this.eventBus.emit("workflow:params:changed");
            }
        });
        this.eventBus.on("z3:qwen:model", ({ model }) => {
            if (model) {
                this.z3QwenModel = String(model);
                this.eventBus.emit("workflow:params:changed");
            }
        });

        // ByteDance models refresh (list available Qwen-VL models from filesystem)
        // Keep this relative to ComfyUI's models root so it works across installs and drives.
        this.preferredByteDanceDir = "ByteDance";

        this.eventBus.on("models:bytedance:refresh", async () => {
            try {
                const path = this.preferredByteDanceDir;
                const url = `${Constants.API_BASE}/fs/list?path=${encodeURIComponent(path)}`;
                const res = await fetch(url);
                if (!res.ok) {
                    const err = new Error(`HTTP ${res.status}`);
                    err.status = res.status;
                    throw err;
                }
                const data = await res.json();
                // Expect array of filenames
                const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                this.byteDanceItems = items.filter(x => typeof x === 'string');
                this.eventBus.emit("workflow:params:changed");
                console.log("[Models] ByteDance list:", this.byteDanceItems);
            } catch (e) {
                // Missing endpoint is expected in some installs; avoid spamming the console
                if (e && (e.status === 404 || String(e.message || "").includes("HTTP 404"))) {
                    console.log("[Models] ByteDance refresh unavailable (no /fs/list). Using defaults.");
                } else {
                    console.warn("[Models] ByteDance refresh failed, falling back to defaults", e);
                }
                this.byteDanceItems = [
                    "Qwen3-VL-2B-Instruct",
                    "Qwen3-VL-2B-Thinking",
                    "Qwen3-VL-2B-Instruct-FP8",
                    "Qwen3-VL-2B-Thinking-FP8",
                    "Qwen3-VL-4B-Instruct",
                    "Qwen3-VL-4B-Thinking",
                    "Qwen3-VL-4B-Instruct-FP8",
                    "Qwen3-VL-4B-Thinking-FP8",
                    "Qwen3-VL-8B-Instruct",
                    "Qwen3-VL-8B-Thinking",
                    "Qwen3-VL-8B-Instruct-FP8",
                    "Qwen3-VL-8B-Thinking-FP8",
                    "Qwen3-VL-32B-Instruct",
                    "Qwen3-VL-32B-Thinking",
                    "Qwen3-VL-32B-Instruct-FP8",
                    "Qwen3-VL-32B-Thinking-FP8",
                    "Qwen2.5-VL-3B-Instruct",
                    "Qwen2.5-VL-7B-Instruct"
                ];
            }
        });
        this.eventBus.on("bridge:state:pulled", (payload) => {
            if (payload && typeof payload.qwen_generation_enabled === "boolean") {
                this.setQwenEnabled(payload.qwen_generation_enabled);
            }
            // Restore core workflow params if present
            try {
                if (Number.isFinite(payload?.steps)) this.steps = Number(payload.steps);
                if (payload?.sampler) this.sampler = String(payload.sampler);
                if (payload?.scheduler) this.scheduler = String(payload.scheduler);
                if (Number.isFinite(payload?.global_guidance)) this.globalGuidance = Number(payload.global_guidance);
                // Ignore legacy exec_mode restored from backend; enforce python-only
                const extra = payload?.extra || {};
                if (extra && typeof extra === "object") {
                    this.execModeFluxZ = "python";
                    if (typeof extra.accelerator_enabled === "boolean") {
                        this.acceleratorEnabled = extra.accelerator_enabled;
                    }
                    if (typeof extra.fp16_accumulation_enabled === "boolean") {
                        this.fp16AccumulationEnabled = extra.fp16_accumulation_enabled;
                    }
                    if (typeof extra.sage_attention === "string") {
                        const v = String(extra.sage_attention || "").trim();
                        // Keep in sync with goya_core.model_optimizations.sageattn_modes.
                        const allowed = new Set([
                            "disabled",
                            "auto",
                            "sageattn_qk_int8_pv_fp16_cuda",
                            "sageattn_qk_int8_pv_fp16_triton",
                            "sageattn_qk_int8_pv_fp8_cuda",
                            "sageattn_qk_int8_pv_fp8_cuda++",
                            "sageattn3",
                            "sageattn3_per_block_mean",
                        ]);
                        if (allowed.has(v)) this.sageAttentionMode = v;
                    }
                    if (typeof extra.controlnet_patch_model === "string") {
                        this.z3ControlNetPatchModel = extra.controlnet_patch_model;
                    }
                    // Prevent cache from overriding current panel routing
                    // Ignore restored 'upscale_mode' and 'upscale_panel_submode' to avoid conflicts
                    // Current UI selection stays authoritative
                    // if (typeof extra.upscale_mode === "string") this.upscaleMode = extra.upscale_mode;
                    // if (typeof extra.upscale_panel_submode === "string") this.upscalePanelSubmode = extra.upscale_panel_submode;
                    if (typeof extra.seedvr2_enabled === "boolean") this.seedvr2Enabled = extra.seedvr2_enabled;
                    try {
                        Object.entries(extra).forEach(([key, value]) => {
                            if (key && key.startsWith("seedvr2")) {
                                // Do NOT restore the model selection from cache; UI is authoritative
                                if (key === "seedvr2_dit_model") return;
                                if (!this.seedvr2Params) this.seedvr2Params = {};
                                this.seedvr2Params[key] = value;
                            }
                        });
                    } catch (_e) {}

                    // Restore FL2-O outpaint params from cache (do not affect routing)
                    try {
                        const left = (extra.fl2o_left ?? extra.outpaint_left);
                        const top = (extra.fl2o_top ?? extra.outpaint_top);
                        const right = (extra.fl2o_right ?? extra.outpaint_right);
                        const bottom = (extra.fl2o_bottom ?? extra.outpaint_bottom);
                        const feathering = (extra.fl2o_feathering ?? extra.outpaint_feathering);
                        const maxW = (extra.fl2o_max_width ?? extra.outpaint_max_width);
                        const maxH = (extra.fl2o_max_height ?? extra.outpaint_max_height);
                        if (left != null) this.fl2oLeft = this._toInt(left, this.fl2oLeft);
                        if (top != null) this.fl2oTop = this._toInt(top, this.fl2oTop);
                        if (right != null) this.fl2oRight = this._toInt(right, this.fl2oRight);
                        if (bottom != null) this.fl2oBottom = this._toInt(bottom, this.fl2oBottom);
                        if (feathering != null) this.fl2oFeathering = this._toInt(feathering, this.fl2oFeathering);
                        if (maxW != null) this.fl2oMaxWidth = this._toInt(maxW, this.fl2oMaxWidth);
                        if (maxH != null) this.fl2oMaxHeight = this._toInt(maxH, this.fl2oMaxHeight);
                    } catch (_e) {}
                }
                if (Number.isFinite(extra.sd3_batch_size)) this.txt2imgBatch = Number(extra.sd3_batch_size);
            } catch (_e) {}
            // If backend adapts size to imported image resolution, sync UI canvas
            if (payload && Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
                const w = Number(payload.width), h = Number(payload.height);
                if (w > 0 && h > 0 && (w !== this.canvasWidth || h !== this.canvasHeight)) {
                    this.canvasWidth = w; this.canvasHeight = h;
                    this.eventBus.emit("canvas:resize", { width: w, height: h });
                    // ask for a fresh composite preview
                    this.eventBus.emit("canvas:export:composite");
                }
            }
            // Surface backend live status entries (hi-res tiles, flux, etc.)
            try {
                const extra = payload && payload.extra ? payload.extra : {};
                const up = extra && extra.live_status_up ? extra.live_status_up : null;
                const flux = extra && extra.live_status_flux ? extra.live_status_flux : null;
                const generic = extra && extra.live_status ? extra.live_status : null;
                const pick = up || flux || generic;
                if (pick && pick.text) {
                    this.eventBus.emit("status:message", String(pick.text));
                }
            } catch (e) {
                // ignore
            }
        });

        // Listen for UI param changes and push state to backend.
        // Some callers (e.g. crop commit) may request an immediate push to avoid
        // races with backend state pulls.
        this.eventBus.on("workflow:params:changed", (opts) => {
            try {
                const payload = this.buildPayload();
                const immediate = !!(opts && typeof opts === "object" && opts.immediate);
                this.bridge.pushState(payload, { immediate });
                console.log("[WorkflowRunner] 🔄 Pushed state on params change", {
                    seed: this.seed, steps: this.steps, cfg: this.cfg,
                    sampler: this.sampler, scheduler: this.scheduler,
                    upscale: {
                        model: this.upscaleModel, factor: this.upscaleFactor,
                        denoise: this.upscaleDenoise, mode: this.modeType,
                        tileW: this.tileWidth, tileH: this.tileHeight,
                    }
                });
            } catch (e) {
                console.warn("[WorkflowRunner] pushState failed on params change", e);
            }
        });

        // Crop-driven FL2-O padding updates (crop tool acts as outpaint frame)
        this.eventBus.on("fl2o:padding:set", ({ left, top, right, bottom }) => {
            try {
                if (left != null) this.fl2oLeft = this._toInt(left, this.fl2oLeft);
                if (top != null) this.fl2oTop = this._toInt(top, this.fl2oTop);
                if (right != null) this.fl2oRight = this._toInt(right, this.fl2oRight);
                if (bottom != null) this.fl2oBottom = this._toInt(bottom, this.fl2oBottom);
                // Keep Canvas crop anchoring and UI in sync
                try {
                    this.eventBus.emit("fl2o:padding", {
                        left: this.fl2oLeft ?? 0,
                        top: this.fl2oTop ?? 0,
                        right: this.fl2oRight ?? 0,
                        bottom: this.fl2oBottom ?? 0,
                    });
                } catch (_e) {}
                this.eventBus.emit("workflow:params:changed");
            } catch (e) {
                console.warn("[WorkflowRunner] fl2o:padding:set failed", e);
            }
        });

        this.eventBus.on("prompt:global:changed", () => {
            this._refreshZ2PromptPreview();
        });

        // Listen for global prompt updates. Always push state so presets are included in backend runs.
        this.eventBus.on("prompt:global:update", (patch) => {
            try {
                // Make sure prompt changes are persisted to backend immediately.
                // This is critical for style presets (Stylized Prompt) to affect generation.
                this.eventBus.emit("workflow:params:changed");
            } catch (_e) {}

            if (patch && patch.source === 'preset') {
                // Skip preview refresh for preset selections to avoid overwriting user input
                return;
            }
            this._refreshZ2PromptPreview();
        });

        // Track canvas size changes
        this.eventBus.on("canvas:resize", (payload) => {
            if (!payload) return;
            const w = Number(payload.width), h = Number(payload.height);
            if (Number.isFinite(w) && Number.isFinite(h)) {
                this.canvasWidth = w;
                this.canvasHeight = h;
            }
        });
        
        // Restore workflow parameters from loaded JSON
        this.eventBus.on("workflow:hydrate", (params) => {
            if (!params) return;
            console.log("[WorkflowRunner] Restoring parameters from JSON:", params);
            if (Number.isFinite(params.seed)) this.seed = params.seed;
            if (Number.isFinite(params.steps)) this.steps = params.steps;
            if (Number.isFinite(params.cfg)) this.cfg = params.cfg;
            if (Number.isFinite(params.globalGuidance)) this.globalGuidance = params.globalGuidance;
            if (params.sampler) this.sampler = params.sampler;
            if (params.scheduler) this.scheduler = params.scheduler;
            if (typeof params.qwenEnabled === "boolean") this.qwenEnabled = params.qwenEnabled;
            if (typeof params.useCompositeInit === "boolean") this.useCompositeInit = params.useCompositeInit;
            if (typeof params.lora1Enabled === "boolean") this.lora1Enabled = params.lora1Enabled;
            if (params.lora1Model !== undefined) this.lora1Model = params.lora1Model;
            if (Number.isFinite(params.lora1Strength)) this.lora1Strength = params.lora1Strength;
            if (typeof params.lora2Enabled === "boolean") this.lora2Enabled = params.lora2Enabled;
            if (params.lora2Model !== undefined) this.lora2Model = params.lora2Model;
            if (Number.isFinite(params.lora2Strength)) this.lora2Strength = params.lora2Strength;
            if (typeof params.lora3Enabled === "boolean") this.lora3Enabled = params.lora3Enabled;
            if (params.lora3Model !== undefined) this.lora3Model = params.lora3Model;
            if (Number.isFinite(params.lora3Strength)) this.lora3Strength = params.lora3Strength;
            if (typeof params.acceleratorEnabled === "boolean") this.acceleratorEnabled = params.acceleratorEnabled;
            if (typeof params.fp16AccumulationEnabled === "boolean") this.fp16AccumulationEnabled = params.fp16AccumulationEnabled;
            if (params.engine !== undefined) this.engine = params.engine;
            if (typeof params.upscaleMode === "string") this.upscaleMode = params.upscaleMode;
            if (typeof params.upscalePanelSubmode === "string") this.upscalePanelSubmode = params.upscalePanelSubmode;
            if (typeof params.seedvr2Enabled === "boolean") this.seedvr2Enabled = params.seedvr2Enabled;
            if (params.unetModel !== undefined) this.unetModel = params.unetModel;
            if (params.vaeModel !== undefined) this.vaeModel = params.vaeModel;
            if (params.clip1Model !== undefined) this.clip1Model = params.clip1Model;
            if (typeof params.clip2Enabled === "boolean") this.clip2Enabled = params.clip2Enabled;
            if (params.clip2Model !== undefined) this.clip2Model = params.clip2Model;
            if (params.clipType !== undefined) this.clipType = params.clipType;
            if (Number.isFinite(params.fluxMaxShift)) this.fluxMaxShift = params.fluxMaxShift;
            if (Number.isFinite(params.fluxBaseShift)) this.fluxBaseShift = params.fluxBaseShift;
            if (Number.isFinite(params.txt2imgBatch)) this.txt2imgBatch = params.txt2imgBatch;
            if (typeof params.upscaleEnabled === "boolean") this.upscaleEnabled = params.upscaleEnabled;
            if (params.upscaleModel !== undefined) this.upscaleModel = params.upscaleModel;
            if (Number.isFinite(params.upscaleFactor)) this.upscaleFactor = params.upscaleFactor;
            if (Number.isFinite(params.upscaleDenoise)) this.upscaleDenoise = params.upscaleDenoise;
            if (params.modeType !== undefined) this.modeType = params.modeType;
            if (Number.isFinite(params.tileWidth)) this.tileWidth = params.tileWidth;
            if (Number.isFinite(params.tileHeight)) this.tileHeight = params.tileHeight;
            if (Number.isFinite(params.maskBlur)) this.maskBlur = params.maskBlur;
            if (Number.isFinite(params.tilePadding)) this.tilePadding = params.tilePadding;
            if (params.seamFixMode !== undefined) this.seamFixMode = params.seamFixMode;
            if (Number.isFinite(params.seamFixDenoise)) this.seamFixDenoise = params.seamFixDenoise;
            if (Number.isFinite(params.seamFixMaskBlur)) this.seamFixMaskBlur = params.seamFixMaskBlur;
            if (Number.isFinite(params.seamFixWidth)) this.seamFixWidth = params.seamFixWidth;
            if (Number.isFinite(params.seamFixPadding)) this.seamFixPadding = params.seamFixPadding;
            if (typeof params.forceUniformTiles === "boolean") this.forceUniformTiles = params.forceUniformTiles;
            if (typeof params.tiledDecode === "boolean") this.tiledDecode = params.tiledDecode;
            console.log("[WorkflowRunner] ✅ Parameters restored: seed=%d steps=%d cfg=%.1f sampler=%s lora1=%s flux_shift=[%.2f, %.2f] upscale=%s", 
                this.seed, this.steps, this.cfg, this.sampler, this.lora1Model || "(none)", this.fluxMaxShift, this.fluxBaseShift, this.upscaleEnabled ? "enabled" : "disabled");
        });
    }

    // removed scenario_z controls

    // Route resolver: decide which scenario to use based on payload/engine/unet
    _resolveRoute(payload) {
        // 1) Respect explicit scenario override if provided
        const override = (payload?.extra?.scenario_override || "").toLowerCase();
        if (override === "z") return "scenario_z";
        if (override === "1c" || override === "scenario_1c") return "scenario_1c";
        if (override === "up" || override === "scenario_up") return "scenario_up";

        // 2) Evaluate engine with guards so Flux/Z aren't hijacked by global upscale
        const engine = (payload?.extra?.engine || this.engine || "").toLowerCase();
        if (engine === "flux") {
            console.log("[Route] Scenario 1C (engine=flux)");
            return "scenario_1c";
        }
        if (engine === "z") {
            console.log("[Route] Scenario Z (engine=z)");
            return "scenario_z";
        }

        // 3) Only route to UP when engine explicitly set to 'upscale' AND flag enabled
        const upEnabled = !!(payload?.extra?.upscale_enabled);
        if (engine === "upscale" && upEnabled) {
            console.log("[Route] 📌 Scenario UP (engine=upscale & upscale_enabled=true)");
            return "scenario_up";
        }

        // Default
        return "scenario_1";
    }

    setSeed(seed) {
        this.seed = seed;
    }

    setSteps(steps) {
        this.steps = steps;
    }

    setCfg(cfg) {
        this.cfg = cfg;
    }

    setSampler(sampler) {
        this.sampler = sampler;
        this.bridge.pushState(this.buildPayload());
    }

    setScheduler(scheduler) {
        this.scheduler = scheduler;
        this.bridge.pushState(this.buildPayload());
    }

    setQwenEnabled(flag) {
        this.qwenEnabled = Boolean(flag);
    }

    setUseCompositeInit(flag) {
        this.useCompositeInit = Boolean(flag);
    }

    // Scenario Z extras
    setZBatchSize(value) {
        const v = parseInt(value);
        this.zBatchSize = Number.isFinite(v) ? Math.max(1, v) : this.zBatchSize;
    }
    setAuraFlowShift(value) {
        const v = parseFloat(value);
        this.auraFlowShift = Number.isFinite(v) ? v : this.auraFlowShift;
    }

    // Scenario LIL (LTX-2 Image-to-Video) setters
    setLilUpscaleModel(value) {
        this.lilUpscaleModel = String(value || "ltx-2-spatial-upscaler-x2-1.0.safetensors");
    }
    setLilAudioVae(value) {
        this.lilAudioVae = String(value || "LTX2_audio_vae_bf16.safetensors");
    }
    setLilOutputFolder(value) {
        this.lilOutputFolder = String(value || "output_goyaicanvas");
    }
    setLilFilenamePrefix(value) {
        this.lilFilenamePrefix = String(value || "IAMCCS_lil");
    }
    setLilFormat(value) {
        this.lilFormat = String(value || "mp4");
    }
    setLilCodec(value) {
        this.lilCodec = String(value || "h264");
    }

    _toInt(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    }

    _toFloat(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    _normalizeSchedulerName(name) {
        const raw = (name || "").toString().trim().toLowerCase();
        if (!raw) return "simple";
        const aliases = {
            "euler_discrete": "simple",
            "eulerdiscretescheduler": "simple",
        };
        return aliases[raw] || raw;
    }

    _randomSeed(exclude = null) {
        let attempt = 0;
        let candidate = Math.floor(Math.random() * 0xffffffff);
        while (exclude !== null && candidate === exclude && attempt < 6) {
            candidate = Math.floor(Math.random() * 0xffffffff);
            attempt += 1;
        }
        return candidate;
    }

    _resolveSeedValue(seedValue, exclude = null) {
        const parsed = Number(seedValue);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.trunc(parsed);
        }
        return this._randomSeed(exclude);
    }

    _collectZ2Settings(options = {}) {
        const { resolveSeeds = false } = options || {};
        const steps1 = this._toInt(this.z2K1Steps ?? this.z2Steps1st, 6);
        const steps2 = this._toInt(this.z2K2Steps ?? this.z2Steps2nd, 3);
        const cfg1 = this._toFloat(this.z2K1Cfg, Number.isFinite(this.cfg) ? this.cfg : 1.0);
        const cfg2 = this._toFloat(this.z2K2Cfg, cfg1);
        const denoise1 = this._toFloat(this.z2K1Denoise, 1.0);
        const denoise2 = this._toFloat(this.z2K2Denoise, 0.6);
        const sampler1 = (this.z2K1Sampler || this.sampler || "res_multistep") + "";
        const sampler2 = (this.z2K2Sampler || sampler1) + "";
        const scheduler1Raw = (this.z2K1Scheduler || this.scheduler || "simple") + "";
        const scheduler2Raw = (this.z2K2Scheduler || scheduler1Raw) + "";
        const scheduler1 = this._normalizeSchedulerName(scheduler1Raw);
        const scheduler2 = this._normalizeSchedulerName(scheduler2Raw);
        const seed1Raw = this._toInt(this.z2K1Seed, -1);
        const seed2Raw = this._toInt(this.z2K2Seed, -1);
        const seed1 = resolveSeeds ? this._resolveSeedValue(seed1Raw) : seed1Raw;
        const seed2 = resolveSeeds ? this._resolveSeedValue(seed2Raw, seed1) : seed2Raw;
        const qwenTokens = Math.max(128, Math.min(4096, this._toInt(this.z2QwenMaxTokens, 1024)));
        const extras = {
            qwen_vl_enabled: this.qwenEnabled !== false,
            qwen_model: this.z2QwenModel || "Qwen3-VL-4B-Instruct",
            qwen_quantization: this.z2QwenQuant || "4-bit (VRAM-friendly)",
            qwen_preset_prompt: this.z2QwenPreset || "🖼️ Detailed Description",
            qwen_custom_prompt: this.z2QwenCustomPrompt || "",
            qwen_attention_mode: this.z2QwenAttention || "auto",
            qwen_keep_loaded: this.z2QwenKeepLoaded !== false,
            qwen_max_tokens: qwenTokens,
            z2_secondary_prompt: this.z2SecondaryPrompt || "",
            steps_1st: steps1,
            steps_2nd: steps2,
            cfg: cfg1,
            cfg_1st: cfg1,
            cfg_2nd: cfg2,
            denoise_1: denoise1,
            denoise_2: denoise2,
            sampler_name: sampler1,
            sampler_2nd: sampler2,
            scheduler: scheduler1,
            scheduler_2nd: scheduler2,
            scheduler_original: scheduler1Raw,
            scheduler_2nd_original: scheduler2Raw,
            latent_scale_by: this._toFloat(this.z2LatentScaleBy, 1.0),
            upscale_method: "nearest-exact",
            aura_shift: this._toFloat(this.auraFlowShift, 3.0),
            seed_1st_mode: seed1Raw < 0 ? "random" : "fixed",
            seed_2nd_mode: seed2Raw < 0 ? "random" : "fixed",
            seed_1st_raw: seed1Raw,
            seed_2nd_raw: seed2Raw,
            // Checkpoint mode toggle (unified loader)
            use_checkpoint: this.z2UseCheckpoint === true,
            checkpoint_name: (this.z2CheckpointName || "") + "",
        };
        if (resolveSeeds) {
            extras.seed = seed1;
            extras.seed_1st = seed1;
            extras.seed_2nd = seed2;
            extras.qwen_seed = seed1;
            if (seed1Raw < 0) this.z2K1SeedLastFixed = seed1;
            if (seed2Raw < 0) this.z2K2SeedLastFixed = seed2;
        }
        this._refreshZ2PromptPreview({ qwenDescription: this.z2QwenLastDescription, secondaryPrompt: this.z2SecondaryPrompt });
        return extras;
    }

    _composeZ2PromptPreview(overrides = {}) {
        try {
            const globalPrompt = this.promptManager?.getGlobalPrompt?.() || {};
            const qwen = ((overrides && Object.prototype.hasOwnProperty.call(overrides, "qwenDescription")) ? overrides.qwenDescription : this.z2QwenLastDescription) || "";
            const secondary = ((overrides && Object.prototype.hasOwnProperty.call(overrides, "secondaryPrompt")) ? overrides.secondaryPrompt : this.z2SecondaryPrompt) || "";
            const globalPositive = ((overrides && Object.prototype.hasOwnProperty.call(overrides, "globalPositive")) ? overrides.globalPositive : globalPrompt.positive) || "";
            const parts = [qwen, secondary, globalPositive].map((segment) => (segment || "").trim()).filter(Boolean);
            if (!parts.length) {
                return "";
            }
            let preview = "";
            parts.forEach((segment) => {
                if (!preview) {
                    preview = segment;
                    return;
                }
                const trimmed = preview.trim();
                const needsPeriod = trimmed.length > 0 && !/[.!?]$/.test(trimmed);
                preview = `${needsPeriod ? `${trimmed}.` : trimmed} ${segment}`;
            });
            return preview.trim();
        } catch (err) {
            console.warn("[WorkflowRunner] Failed composing Z2 prompt preview", err);
            return "";
        }
    }

    _emitZ2PromptPreview(preview, options = {}) {
        const { force = false } = options || {};
        const text = typeof preview === "string" ? preview : "";
        this._z2PromptPreview = text;
        console.log("[Z2] Emitting prompt:global:preview, force=", force, "chars=", text.length);
        this.eventBus.emit("prompt:global:preview", { text, force });
        return this._z2PromptPreview;
    }

    _refreshZ2PromptPreview(overrides = {}) {
        const preview = this._composeZ2PromptPreview(overrides);
        return this._emitZ2PromptPreview(preview);
    }

    _collectZ3Settings(options = {}) {
        const { resolveSeeds = false } = options || {};
        const steps = this._toInt(this.steps, 12);
        const cfg = this._toFloat(this.cfg, 1.0);
        const sampler = (this.sampler || "res_multistep") + "";
        const schedulerRaw = (this.scheduler || "simple") + "";
        const scheduler = this._normalizeSchedulerName(schedulerRaw);
        const seedRaw = this._toInt(this.seed, -1);
        const seed = resolveSeeds ? this._resolveSeedValue(seedRaw) : seedRaw;
        const qwenTokens = Math.max(128, Math.min(4096, this._toInt(this.z2QwenMaxTokens, 1024)));
        const extras = {
            qwen_vl_enabled: this.qwenEnabled !== false,
            qwen_model: this.z2QwenModel || "Qwen3-VL-4B-Instruct",
            qwen_quantization: this.z2QwenQuant || "4-bit (VRAM-friendly)",
            qwen_preset_prompt: this.z2QwenPreset || "🖼️ Detailed Description",
            qwen_custom_prompt: this.z2QwenCustomPrompt || "",
            qwen_attention_mode: this.z2QwenAttention || "auto",
            qwen_keep_loaded: this.z2QwenKeepLoaded !== false,
            qwen_max_tokens: qwenTokens,
            z3_secondary_prompt: this.z2SecondaryPrompt || "",
            steps,
            cfg,
            sampler_name: sampler,
            scheduler,
            scheduler_original: schedulerRaw,
            controlnet_enabled: this.z3ControlNetEnabled === true,
            controlnet_type: (this.z3ControlNetType || "aio_preprocessor") + "",
            controlnet_patch_model: (this.z3ControlNetPatchModel || "") + "",
            controlnet_preview_enabled: true,
            // Common ControlNet params
            controlnet_strength: Number.isFinite(this.z3CnStrength) ? this.z3CnStrength : 1.0,
            controlnet_guidance_start: Number.isFinite(this.z3CnGuidanceStart) ? this.z3CnGuidanceStart : 0.0,
            controlnet_guidance_end: Number.isFinite(this.z3CnGuidanceEnd) ? this.z3CnGuidanceEnd : 1.0,
            // AIO params
            aio_mode: (this.z3AioMode || "canny") + "",
            aio_resolution: Number.isFinite(this.z3AioResolution) ? Math.trunc(this.z3AioResolution) : 512,
            aio_canny_low: Number.isFinite(this.z3AioCannyLow) ? Math.trunc(this.z3AioCannyLow) : 100,
            aio_canny_high: Number.isFinite(this.z3AioCannyHigh) ? Math.trunc(this.z3AioCannyHigh) : 200,
            // DepthAnythingV3 params
            depthanything_quality: (this.z3DaNormalizationMode || this.z3DaQuality || "V2-Style") + "",
            depthanything_normalize: this.z3DaNormalize === true,
            depthanything_resize_mode: (this.z3DaResizeMethod || "resize") + "",
            depthanything_invert: this.z3DaInvertDepth === true,
            depthanything_keep_model_size: this.z3DaKeepModelSize === true,
            // Checkpoint mode toggle
            use_checkpoint: this.z3UseCheckpoint === true,
            checkpoint_name: (this.z3CheckpointName || "") + "",
        };
        if (resolveSeeds) {
            extras.seed = seed;
            if (seedRaw < 0) this.seed = seed;
        }
        const gp = this.promptManager && this.promptManager.getGlobalPrompt ? (this.promptManager.getGlobalPrompt() || {}) : {};
        const preview = this._composeZ2PromptPreview({
            qwenDescription: this.z2QwenLastDescription,
            secondaryPrompt: this.z2SecondaryPrompt,
            globalPositive: gp.positive || "",
        });
        extras.prompt_preview = preview;
        return extras;
    }

    setZ2SecondaryPrompt(value, options = {}) {
        const { silentPush = false } = options || {};
        const next = typeof value === "string" ? value : "";
        const changed = next !== this.z2SecondaryPrompt;
        this.z2SecondaryPrompt = next;
        this._refreshZ2PromptPreview({ secondaryPrompt: next });
        if (!silentPush && changed) {
            this.eventBus.emit("workflow:params:changed");
        }
        if (changed) {
            this.eventBus.emit("z2:secondary:changed", { value: next });
        }
        return next;
    }

    setZ2QwenLastDescription(value, options = {}) {
        const { silentPreview = false } = options || {};
        const next = typeof value === "string" ? value : "";
        this.z2QwenLastDescription = next;
        if (!silentPreview) {
            this._refreshZ2PromptPreview({ qwenDescription: next });
        }
        return next;
    }

    applyLastGenerationMetadata(metadata = {}) {
        if (!metadata || typeof metadata !== "object") return;
        const scenarioKey = String(metadata.scenario || "").toLowerCase();
        if (scenarioKey && scenarioKey !== "scenario_z2") {
            return;
        }

        if (typeof metadata.qwen_description === "string") {
            this.setZ2QwenLastDescription(metadata.qwen_description, { silentPreview: true });
        }
        if (typeof metadata.secondary_prompt === "string") {
            this.setZ2SecondaryPrompt(metadata.secondary_prompt, { silentPush: true });
        }

        // Always update UI seed inputs with actual resolved seeds from backend
        if (Number.isFinite(metadata.seed_1st)) {
            this.z2K1Seed = metadata.seed_1st;
            this.z2K1SeedLastFixed = metadata.seed_1st;
        }
        if (Number.isFinite(metadata.seed_2nd)) {
            this.z2K2Seed = metadata.seed_2nd;
            this.z2K2SeedLastFixed = metadata.seed_2nd;
        }

        if (typeof metadata.prompt_preview === "string") {
            console.log("[Z2] Metadata prompt_preview received (chars)", metadata.prompt_preview.length);
            this._emitZ2PromptPreview(metadata.prompt_preview, { force: true });
        } else {
            console.warn("[Z2] No prompt_preview in metadata, composing from parts");
            const preview = this._composeZ2PromptPreview();
            this._emitZ2PromptPreview(preview, { force: true });
        }
        
        // Trigger UI refresh to show updated seeds
        this.eventBus.emit("workflow:params:changed");
    }

    _getSeedSlot(slot) {
        const normalized = (slot || "").toLowerCase();
        if (normalized === "k2" || normalized === "second") {
            return { key: "z2K2Seed", lastKey: "z2K2SeedLastFixed" };
        }
        return { key: "z2K1Seed", lastKey: "z2K1SeedLastFixed" };
    }

    _setZ2SeedRaw(slot, value) {
        const { key, lastKey } = this._getSeedSlot(slot);
        const normalized = this._toInt(value, -1);
        this[key] = normalized;
        if (normalized >= 0) {
            this[lastKey] = normalized;
        }
        this.eventBus.emit("workflow:params:changed");
        return normalized;
    }

    setZ2SeedValue(slot, value) {
        return this._setZ2SeedRaw(slot, value);
    }

    randomizeZ2Seed(slot) {
        const randomValue = this._randomSeed();
        return this._setZ2SeedRaw(slot, randomValue);
    }

    setZ2SeedRandomMode(slot) {
        this._setZ2SeedRaw(slot, -1);
        return -1;
    }

    toggleZ2SeedLock(slot) {
        const locked = this.isZ2SeedLocked(slot);
        if (locked) {
            this.setZ2SeedRandomMode(slot);
            return false;
        }
        const { lastKey } = this._getSeedSlot(slot);
        const fallback = this._toInt(this[lastKey], this._randomSeed());
        this.setZ2SeedValue(slot, fallback >= 0 ? fallback : this._randomSeed());
        return true;
    }

    getZ2SeedRaw(slot) {
        const { key } = this._getSeedSlot(slot);
        return this._toInt(this[key], -1);
    }

    isZ2SeedLocked(slot) {
        return this.getZ2SeedRaw(slot) >= 0;
    }

    // Scaling controls removed

    // Scenario 2 extras
    setLora2Enabled(flag) {
        this.lora2Enabled = Boolean(flag);
    }
    setLora2Model(name) {
        this.lora2Model = String(name || "");
    }
    setLora2Strength(value) {
        const v = parseFloat(value);
        this.lora2Strength = Number.isFinite(v) ? v : this.lora2Strength;
    }

    // LoRA 1 override
    setLora1Enabled(flag) {
        this.lora1Enabled = !!flag;
    }
    setLora1Model(name) {
        this.lora1Model = String(name || "");
    }
    setLora1Strength(value) {
        const v = parseFloat(value);
        this.lora1Strength = Number.isFinite(v) ? v : this.lora1Strength;
    }

    // LoRA 3 for Scenario 1C
    setLora3Enabled(enabled) {
        this.lora3Enabled = !!enabled;
    }
    setLora3Model(name) {
        this.lora3Model = String(name || "");
    }
    setLora3Strength(value) {
        const v = parseFloat(value);
        this.lora3Strength = Number.isFinite(v) ? v : this.lora3Strength;
    }

    // Txt2Img dimensions for Scenario 1C
    setTxt2ImgWidth(width) {
        const v = parseInt(width);
        this.txt2imgWidth = Number.isFinite(v) ? v : 1280;
    }
    setTxt2ImgHeight(height) {
        const v = parseInt(height);
        this.txt2imgHeight = Number.isFinite(v) ? v : 832;
    }

    // Accelerator toggle (Sage Attention)
    setAcceleratorEnabled(enabled) {
        this.acceleratorEnabled = !!enabled;
    }

    // Sage attention mode (string enum)
    setSageAttentionMode(mode) {
        const v = String(mode || "").trim();
        const allowed = new Set([
            "disabled",
            "auto",
            "sageattn_qk_int8_pv_fp16_cuda",
            "sageattn_qk_int8_pv_fp16_triton",
            "sageattn_qk_int8_pv_fp8_cuda",
            "sageattn_qk_int8_pv_fp8_cuda++",
            "sageattn3",
            "sageattn3_per_block_mean",
        ]);
        if (allowed.has(v)) this.sageAttentionMode = v;
    }

    // FP16 accumulation toggle (torch.backends.cuda.matmul.allow_fp16_accumulation)
    setFp16AccumulationEnabled(enabled) {
        this.fp16AccumulationEnabled = !!enabled;
    }

    // Global guidance for FluxGuidance
    setGlobalGuidance(value) {
        const v = parseFloat(value);
        if (Number.isFinite(v)) this.globalGuidance = v;
    }

    // Flux txt2img batch size
    setTxt2ImgBatch(value) {
        const v = parseInt(value);
        if (Number.isFinite(v)) this.txt2imgBatch = Math.max(1, Math.min(16, v));
    }

    // Z-Image FlashVSR controls
    setZUpscaleEnabled(enabled) { this.zUpscaleEnabled = !!enabled; }
    setZFlashModel(name) { this.zFlashModel = String(name || "FlashVSR-v1.1"); }
    setZFlashMode(mode) { const m = String(mode||"tiny"); this.zFlashMode = ["tiny","tiny-long","full"].includes(m)?m:"tiny"; }
    setZFlashScale(s) { const v = parseInt(s); this.zFlashScale = Number.isFinite(v) ? Math.min(4, Math.max(2, v)) : 2; }
    setZFlashTiledVae(b) { this.zFlashTiledVae = !!b; }
    setZFlashTiledDit(b) { this.zFlashTiledDit = !!b; }
    setZFlashUnloadDit(b) { this.zFlashUnloadDit = !!b; }
    setZFlashSeed(v) { const n = parseInt(v); this.zFlashSeed = Number.isFinite(n) ? Math.max(0, n) : 0; }
    setZFlashSeedMode(mode) { const m = String(mode||"randomize"); this.zFlashSeedMode = ["randomize","fixed"].includes(m)?m:"randomize"; }
    setZFlashSeedLocked(lock) { this.zFlashSeedLocked = !!lock; if (this.zFlashSeedLocked) this.setZFlashSeedMode("fixed"); }

    // Scenario 1C FlashVSR controls
    setS1CUpscaleEnabled(enabled) { this.s1cUpscaleEnabled = !!enabled; }
    setS1CFlashModel(name) { this.s1cFlashModel = String(name || "FlashVSR-v1.1"); }
    setS1CFlashMode(mode) { const m = String(mode||"tiny"); this.s1cFlashMode = ["tiny","tiny-long","full"].includes(m)?m:"tiny"; }
    setS1CFlashScale(s) { const v = parseInt(s); this.s1cFlashScale = Number.isFinite(v) ? Math.min(4, Math.max(2, v)) : 2; }
    setS1CFlashTiledVae(b) { this.s1cFlashTiledVae = !!b; }
    setS1CFlashTiledDit(b) { this.s1cFlashTiledDit = !!b; }
    setS1CFlashUnloadDit(b) { this.s1cFlashUnloadDit = !!b; }
    setS1CFlashSeed(v) { const n = parseInt(v); this.s1cFlashSeed = Number.isFinite(n) ? Math.max(0, n) : 0; }
    setS1CFlashSeedMode(mode) { const m = String(mode||"randomize"); this.s1cFlashSeedMode = ["randomize","fixed"].includes(m)?m:"randomize"; }
    setS1CFlashSeedLocked(lock) { this.s1cFlashSeedLocked = !!lock; if (this.s1cFlashSeedLocked) this.setS1CFlashSeedMode("fixed"); }

    // Engine selection
    setEngine(engine) {
        const normalized = String(engine || "qwen").toLowerCase();

        if (normalized === "upscale") {
            // Force CFG defaults before syncing state so pushState sees new value
            this.cfg = 1.0;
            if (!this.upscaleEnabled) {
                this.setUpscaleEnabled(true);
            } else {
                this.engine = "upscale";
                this._syncUpscaleModeExtras();
                this.bridge.pushState(this.buildPayload());
            }
            return;
        }

        this.engine = normalized;
        if (this.upscaleEnabled) {
            this.upscaleEnabled = false;
        }

        // Set default CFG based on engine
        if (this.engine === "flux") {
            this.cfg = 3.5;
        } else {
            this.cfg = 1.0;
        }
        // Scenario-specific defaults
        if (this.engine === "z") {
            this.setSampler("res_multistep");
            this.setClipType("lumina2");
            this.setClip2Enabled(false);
            this.setLora1Enabled(false);
            this.setLora1Model("");
            this.setLora1Strength(0);
            this.setLora2Enabled(false);
            this.setLora2Model("");
            this.setLora2Strength(0);
            this.setLora3Enabled(false);
            this.setLora3Model("");
            this.setLora3Strength(0);
            this.auraFlowShift = 3;
            this.zBatchSize = 1;
        }
    }

    // Model selectors
    setUnetModel(model) {
        this.unetModel = String(model || "");
    }
    setVaeModel(model) {
        this.vaeModel = String(model || "");
    }
    setClip1Model(model) {
        this.clip1Model = String(model || "");
    }
    setClip2Enabled(enabled) {
        this.clip2Enabled = !!enabled;
        console.log("[WorkflowRunner] clip2Enabled set:", this.clip2Enabled, "engine:", this.engine);
    }
    setClip2Model(model) {
        this.clip2Model = String(model || "");
    }
    setUpscaleClip2Enabled(enabled) {
        this.upscaleClip2Enabled = !!enabled;
        console.log("[WorkflowRunner] upscaleClip2Enabled set:", this.upscaleClip2Enabled);
        this.bridge.pushState(this.buildPayload());
    }
    setUpscaleClip2Model(model) {
        this.upscaleClip2Model = String(model || "");
        this.bridge.pushState(this.buildPayload());
    }
    setClipType(t) {
        const v = String(t || "qwen").toLowerCase();
        if (v === "flux" || v === "flux2") this.clipType = v;
        else if (v === "lumina" || v === "lumina2") this.clipType = v;
        else this.clipType = "qwen";
    }

    /**
     * DISPATCHER: Determine active scenario from UI panel state.
     * Follows ARCH GENERALE DISPATCHING pattern:
     * UI Panel → scenario key → Router Priority 1 → SCENARIO_REGISTRY
    /** Return the generation-time canvas dimensions (easy or advanced based on source) */
    getGenerationDimensions() {
        if (this._generationSource === 'easy') {
            return { width: this.easyCanvasWidth, height: this.easyCanvasHeight };
        }
        return { width: this.canvasWidth, height: this.canvasHeight };
    }

    /**
     * Determine which scenario to run based on current UI state.
     * @returns {string} Scenario key for SCENARIO_REGISTRY
     */
    getActiveScenario() {
        // Priority-based panel detection
        if (this.upscaleEnabled) {
            const submode = (this.upscalePanelSubmode || this.upscaleMode || "").toLowerCase();
            if (submode === "sdultimate") return "up"; // legacy panel routed to supported upscale wrapper
            if (submode === "seedvr2") return "up";       // SeedVR2 panel
        }
        
        // CRITICAL: Check activePanel BEFORE engine to allow Z2/Z3 override
        const panel = (this.activePanel || "").toLowerCase();
        if (panel === "fl2") {
            // Allow explicit FL2 mode override from UI (keeps existing auto resolver intact)
            const forced = String(this.fl2PanelScenario || "").toLowerCase();
            if (forced === "fl2-i" || forced === "fl2-s" || forced === "fl2-t" || forced === "fl2-o") {
                console.log("[DISPATCHER] → Returning", JSON.stringify(forced), "for FL2 panel (explicit override)");
                return forced;
            }
            const resolved = this._resolveFl2PanelScenario();
            console.log("[DISPATCHER] → Returning", JSON.stringify(resolved), "for FL2 panel (activePanel priority)");
            return resolved;
        }
        if (panel === "z2") {
            console.log("[DISPATCHER] → Returning 'z2' for Z-Image IMG2IMG (activePanel priority)");
            return "z2";      // Z-Image IMG2IMG panel
        }
        if (panel === "z3") {
            console.log("[DISPATCHER] → Returning 'z3' for Z-Image ControlNet (activePanel priority)");
            return "z3";      // Z-Image ControlNet panel
        }
        if (panel === "video") {
            console.log("[DISPATCHER] → Returning 'video' for Video Timeline (activePanel priority)");
            return "video";   // Video Timeline panel
        }
        if (panel === "lil") {
            console.log("[DISPATCHER] → Returning 'lil' for LI-L (activePanel priority)");
            return "lil";
        }
        
        const engine = (this.engine || "qwen").toLowerCase();
        console.log("[DISPATCHER] Checking engine=", engine, "activePanel=", panel || "none");
        if (engine === "flux") {
            console.log("[DISPATCHER] → Returning '1c' for Flux");
            return "1c";  // Flux SRPO panel
        }
        if (engine === "z") {
            console.log("[DISPATCHER] → Returning 'z' for Z-Image (txt2img default)");
            return "z";      // Z-Image panel (txt2img)
        }

        // IMPORTANT: When user is on the default Qwen panel, but they created regional prompts + masks,
        // they expect an inpaint workflow (Scenario 2). If we keep forcing scenario_override="1",
        // backend auto-detection never runs and masks look "ignored".
        try {
            const layers = (this.layerManager?.getLayers?.() || []).filter((l) => !!l && l.visible !== false);
            const maskStack = this.maskManager?.exportMaskStack?.() || [];
            const hasMaskStack = Array.isArray(maskStack) && maskStack.length > 0;
            const hasScenario2Candidate = layers.some((l) => {
                if (!l || l.locked || l.id === 'layer_background') return false;
                const p = l.prompt || {};
                const pos = String(p.positive || '').trim();
                const neg = String(p.negative || '').trim();
                const hasRegionalPrompt = !!(pos || neg);
                if (!hasRegionalPrompt) return false;

                // Explicit mask, OR mask_stack, OR a paint-layer bitmap (alpha-derived mask backend-side).
                const hasExplicitMask = (typeof l.mask === 'string' && l.mask.length > 64);
                const isImported = (l?.metadata?.source?.type === 'import');
                const hasPaintBitmap = (!isImported && typeof l.bitmap === 'string' && l.bitmap.length > 64);
                return hasExplicitMask || hasMaskStack || hasPaintBitmap;
            });
            if (hasScenario2Candidate) {
                console.log("[DISPATCHER] → Returning '2' for Scenario 2 (regional inpaint detected)");
                return "2";
            }
        } catch (e) {
            // fallthrough to baseline
        }
        
        console.log("[DISPATCHER] → Returning '1' (default Qwen baseline)");
        return "1"; // Default: Qwen baseline
    }

    /**
     * Execute LIL scenario (LTXV Image-to-Video baseline).
     * IMPORTANT: LIL is a ComfyUI graph pipeline; pushing /state alone does not enqueue execution.
     * We therefore enqueue via /enqueue-graph (backend will build the reference workflow when graph is missing).
     */
    async executeScenarioLIL(params = {}) {
        try {
            console.warn('[DISPATCHER] ═══ executeScenarioLIL CALLED ═══');
            console.log('[DISPATCHER] executeScenarioLIL: Setting activePanel=lil, engine=lil');
            // LIL requires a source image.
            // If the caller didn't provide one (common when LIL is triggered via activePanel/main Generate),
            // export the current canvas composite and upload it to ComfyUI input/.
            const p = (params && typeof params === 'object') ? { ...params } : {};

            // Fill missing params from runner defaults so non-Visual triggers remain consistent.
            // (Visual mode passes explicit values from the sphere; those take priority.)
            if (p.width == null) p.width = this.lilWidth;
            if (p.height == null) p.height = this.lilHeight;
            if (p.fps == null) p.fps = this.lilFps;
            if (p.frames == null) p.frames = this.lilFrames;
            if (p.inheritDimensions == null) p.inheritDimensions = this.lilInheritDimensions;
            if (p.filenamePrefix == null) p.filenamePrefix = this.lilFilenamePrefix;
            if (p.format == null) p.format = this.lilFormat;
            if (p.codec == null) p.codec = this.lilCodec;
            if (p.outputFolder == null) p.outputFolder = this.lilOutputFolder;

            if (p.lil_spatial_tiles == null) p.lil_spatial_tiles = this.lilSpatialTiles;
            if (p.lil_spatial_overlap == null) p.lil_spatial_overlap = this.lilSpatialOverlap;
            if (p.lil_temporal_tile_length == null) p.lil_temporal_tile_length = this.lilTemporalTileLength;
            if (p.lil_decode_working_device == null) p.lil_decode_working_device = this.lilDecodeWorkingDevice;
            try {
                const gp = this.promptManager?.getGlobalPrompt?.() || {};
                if (p.prompt == null && typeof gp.positive === 'string' && gp.positive.trim()) {
                    p.prompt = gp.positive;
                }
                if (p.negative == null && typeof gp.negative === 'string' && gp.negative.trim()) {
                    p.negative = gp.negative;
                }
            } catch (_e) {}

            if (!p.initImageFilename) {
                try {
                    const dataUrl = await this._awaitCanvasCompositeDataUrl({ timeoutMs: 1500 });
                    if (dataUrl) {
                        const uploaded = await this._uploadDataUrlToComfyUIImage(dataUrl, {
                            filename: `goya_lil_init_${Date.now()}.png`,
                            overwrite: true,
                        });
                        if (uploaded) {
                            p.initImageFilename = uploaded;
                            console.log('[DISPATCHER] LIL init image auto-uploaded from canvas composite:', uploaded);
                        }
                    }
                } catch (e) {
                    console.warn('[DISPATCHER] Failed to auto-provide LIL init image from canvas composite', e);
                }
            }

            if (!p.initImageFilename) {
                const msg = 'LIL requires an init image. Add/import an image on the canvas (or connect an image_in node in Visual mode) and try again.';
                console.warn('[DISPATCHER] ' + msg);
                try { this.eventBus.emit('status:message', msg); } catch (_e) {}
                try { this.eventBus.emit('workflow:error', { error: msg }); } catch (_e) {}
                return false;
            }

            let baselineTs = 0;
            try {
                const base = await this.bridge.pullLastGeneration();
                 baselineTs = Number(base?.ts || base?.timestamp || 0) || 0;
            } catch (_e) {}

            // Set routing (like Z2/Z3)
            this.activePanel = "lil";

            // Build payload for UI/state hydration only.
            // Execution is triggered via /enqueue-graph (see below).
            const payloadLIL = this.buildPayload({ extra: { scenario_override: "lil", engine: "lil" } });

            // Inject params into payload.extra (like Z2/Z3)
            try {
                if (p && typeof p === 'object') {
                    if (p.prompt != null) payloadLIL.extra.lil_prompt = String(p.prompt);
                    if (p.negative != null) payloadLIL.extra.lil_negative = String(p.negative);
                    // Empty Latent Video params
                    if (p.width != null) payloadLIL.extra.lil_width = p.width;
                    if (p.height != null) payloadLIL.extra.lil_height = p.height;
                    if (p.fps != null) payloadLIL.extra.lil_fps = p.fps;
                    if (p.frames != null) payloadLIL.extra.lil_frames = p.frames;
                    if (p.inheritDimensions != null) payloadLIL.extra.lil_inherit_dimensions = Boolean(p.inheritDimensions);
                    if (p.seed != null) payloadLIL.extra.lil_seed = p.seed;
                    if (p.strength != null) payloadLIL.extra.lil_strength = p.strength;
                    // Save Video params
                    if (p.filenamePrefix != null) payloadLIL.extra.lil_filename_prefix = String(p.filenamePrefix);
                    if (p.format != null) payloadLIL.extra.lil_format = String(p.format);
                    if (p.codec != null) payloadLIL.extra.lil_codec = String(p.codec);
                    // LTX-2 pipeline params
                    if (p.model != null) payloadLIL.extra.lil_model = String(p.model);
                    if (p.vae != null) payloadLIL.extra.lil_vae = String(p.vae);
                    if (p.audioVae != null) payloadLIL.extra.lil_audio_vae = String(p.audioVae);
                    if (p.steps != null) payloadLIL.extra.lil_steps = p.steps;
                    if (p.cfg != null) payloadLIL.extra.lil_cfg = p.cfg;
                    if (p.maxShift != null) payloadLIL.extra.lil_max_shift = p.maxShift;
                    if (p.baseShift != null) payloadLIL.extra.lil_base_shift = p.baseShift;
                    if (p.stretch != null) payloadLIL.extra.lil_stretch = p.stretch;
                    if (p.terminal != null) payloadLIL.extra.lil_terminal = p.terminal;
                    // Dual CLIP (Gemma + 19B embeddings)
                    if (p.clip1 != null) payloadLIL.extra.lil_clip1 = String(p.clip1);
                    if (p.clip2 != null) payloadLIL.extra.lil_clip2 = String(p.clip2);
                    if (p.clipType != null) payloadLIL.extra.lil_clip_type = String(p.clipType);
                    if (p.clipDevice != null) payloadLIL.extra.lil_clip_device = String(p.clipDevice);
                    // Decode tiled (performance)
                    if (p.lil_spatial_tiles != null) payloadLIL.extra.lil_spatial_tiles = p.lil_spatial_tiles;
                    if (p.lil_spatial_overlap != null) payloadLIL.extra.lil_spatial_overlap = p.lil_spatial_overlap;
                    if (p.lil_temporal_tile_length != null) payloadLIL.extra.lil_temporal_tile_length = p.lil_temporal_tile_length;
                    if (p.lil_decode_working_device != null) {
                        const d = String(p.lil_decode_working_device).trim().toLowerCase();
                        payloadLIL.extra.lil_decode_working_device = (d === 'cpu' || d === 'auto') ? d : 'auto';
                    }
                    // LoRA
                    if (p.lora1) payloadLIL.extra.lil_lora1 = p.lora1;
                    if (p.lora1Strength != null) payloadLIL.extra.lil_lora1_strength = p.lora1Strength;
                    if (p.lora2) payloadLIL.extra.lil_lora2 = p.lora2;
                    if (p.lora2Strength != null) payloadLIL.extra.lil_lora2_strength = p.lora2Strength;
                    if (p.lora3) payloadLIL.extra.lil_lora3 = p.lora3;
                    if (p.lora3Strength != null) payloadLIL.extra.lil_lora3_strength = p.lora3Strength;
                    // Init image filename (uploaded to ComfyUI input/)
                    if (p.initImageFilename && typeof p.initImageFilename === 'string') {
                        payloadLIL.extra.lil_init_image_filename = p.initImageFilename;
                    }
                    // Stage 2 Upscale (mandatory, hardcoded parameters)
                    if (p.upscaleModel != null) payloadLIL.extra.lil_upscale_model = String(p.upscaleModel);
                    // Output folder
                    if (p.outputFolder != null) payloadLIL.extra.lil_output_folder = String(p.outputFolder);
                }
            } catch (_e) {}

            console.log('[DISPATCHER] executeScenarioLIL payload:', payloadLIL);

            // 1) Push /state so UI stays in sync (non-execution).
            try { await this.bridge.pushState(payloadLIL, { immediate: true }); } catch (_e) {}
            try { this.eventBus.emit("workflow:started", { payload: payloadLIL }); } catch (_e) {}

            // 2) Enqueue graph execution (execution).
            // Keep this extra minimal: do NOT include unrelated upscale extras to avoid routing confusion.
            const enqueueExtra = {};
            try {
                // Model optimizations (global extras) — include explicitly for race-proofing.
                if (payloadLIL?.extra?.accelerator_enabled != null) enqueueExtra.accelerator_enabled = !!payloadLIL.extra.accelerator_enabled;
                if (payloadLIL?.extra?.fp16_accumulation_enabled != null) enqueueExtra.fp16_accumulation_enabled = !!payloadLIL.extra.fp16_accumulation_enabled;
                if (payloadLIL?.extra?.sage_attention != null) enqueueExtra.sage_attention = String(payloadLIL.extra.sage_attention);

                if (payloadLIL?.extra?.lil_prompt != null) enqueueExtra.lil_prompt = String(payloadLIL.extra.lil_prompt);
                if (payloadLIL?.extra?.lil_negative != null) enqueueExtra.lil_negative = String(payloadLIL.extra.lil_negative);
                // The backend reference builder expects filename_prefix (SaveVideo schema)
                if (payloadLIL?.extra?.lil_filename_prefix != null) enqueueExtra.filename_prefix = String(payloadLIL.extra.lil_filename_prefix);
                if (payloadLIL?.extra?.lil_format != null) enqueueExtra.lil_format = String(payloadLIL.extra.lil_format);
                if (payloadLIL?.extra?.lil_codec != null) enqueueExtra.lil_codec = String(payloadLIL.extra.lil_codec);
                if (payloadLIL?.extra?.lil_fps != null) enqueueExtra.lil_fps = payloadLIL.extra.lil_fps;
                // Key pipeline overrides (Visual/FIELD spheres)
                if (payloadLIL?.extra?.lil_width != null) enqueueExtra.lil_width = payloadLIL.extra.lil_width;
                if (payloadLIL?.extra?.lil_height != null) enqueueExtra.lil_height = payloadLIL.extra.lil_height;
                if (payloadLIL?.extra?.lil_frames != null) enqueueExtra.lil_frames = payloadLIL.extra.lil_frames;
                if (payloadLIL?.extra?.lil_seed != null) enqueueExtra.lil_seed = payloadLIL.extra.lil_seed;
                if (payloadLIL?.extra?.lil_strength != null) enqueueExtra.lil_strength = payloadLIL.extra.lil_strength;
                if (payloadLIL?.extra?.lil_cfg != null) enqueueExtra.lil_cfg = payloadLIL.extra.lil_cfg;
                if (payloadLIL?.extra?.lil_clip_device != null) enqueueExtra.lil_clip_device = String(payloadLIL.extra.lil_clip_device);

                // Model selection overrides (important for performance parity)
                if (payloadLIL?.extra?.lil_model != null) enqueueExtra.lil_model = String(payloadLIL.extra.lil_model);
                if (payloadLIL?.extra?.lil_vae != null) enqueueExtra.lil_vae = String(payloadLIL.extra.lil_vae);
                if (payloadLIL?.extra?.lil_audio_vae != null) enqueueExtra.lil_audio_vae = String(payloadLIL.extra.lil_audio_vae);
                if (payloadLIL?.extra?.lil_upscale_model != null) enqueueExtra.lil_upscale_model = String(payloadLIL.extra.lil_upscale_model);
                if (payloadLIL?.extra?.lil_clip1 != null) enqueueExtra.lil_clip1 = String(payloadLIL.extra.lil_clip1);
                if (payloadLIL?.extra?.lil_clip2 != null) enqueueExtra.lil_clip2 = String(payloadLIL.extra.lil_clip2);
                if (payloadLIL?.extra?.lil_clip_type != null) enqueueExtra.lil_clip_type = String(payloadLIL.extra.lil_clip_type);

                if (payloadLIL?.extra?.lil_spatial_tiles != null) enqueueExtra.lil_spatial_tiles = payloadLIL.extra.lil_spatial_tiles;
                if (payloadLIL?.extra?.lil_spatial_overlap != null) enqueueExtra.lil_spatial_overlap = payloadLIL.extra.lil_spatial_overlap;
                if (payloadLIL?.extra?.lil_temporal_tile_length != null) enqueueExtra.lil_temporal_tile_length = payloadLIL.extra.lil_temporal_tile_length;
                if (payloadLIL?.extra?.lil_decode_working_device != null) enqueueExtra.lil_decode_working_device = String(payloadLIL.extra.lil_decode_working_device);
                if (payloadLIL?.extra?.lil_init_image_filename != null) enqueueExtra.lil_init_image_filename = String(payloadLIL.extra.lil_init_image_filename);

                // Output folder (saved as a subfolder under ComfyUI/output)
                if (payloadLIL?.extra?.lil_output_folder != null) enqueueExtra.lil_output_folder = String(payloadLIL.extra.lil_output_folder);
                // Explicitly opt into reference workflow (backend default is True for scenario=lil)
                enqueueExtra.lil_use_reference_workflow = true;
            } catch (_e) {}

            // Emit graph-queue event: bridge will POST /enqueue-graph.
            try { this.eventBus.emit("workflow:queued:graph", { graph: null, scenario: "lil", extra: enqueueExtra }); } catch (_e) {}

            // Watch backend /last-generation updates (enqueue-graph watcher updates these).
            this._startPythonCompletionWatch({ baselineTimestamp: baselineTs, expectedScenario: "lil" });
            return true;
        } catch (err) {
            console.error('[DISPATCHER] executeScenarioLIL error:', err);
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

    async _awaitCanvasCompositeDataUrl({ timeoutMs = 800 } = {}) {
        try {
            return await new Promise((resolve) => {
                let settled = false;
                const onReady = (result) => {
                    if (settled) return;
                    settled = true;
                    try { this.eventBus.off('canvas:export:composite:ready', handler); } catch (_e) {}
                    resolve(result?.data || null);
                };
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    try { this.eventBus.off('canvas:export:composite:ready', handler); } catch (_e) {}
                    resolve(null);
                }, Math.max(0, Number(timeoutMs) || 0));
                const handler = (res) => { clearTimeout(timer); onReady(res); };
                try { this.eventBus.on('canvas:export:composite:ready', handler); } catch (_e) {}
                try { this.eventBus.emit('canvas:export:composite'); } catch (_e) {}
            });
        } catch (_e) {
            return null;
        }
    }

    _dataUrlToBlob(dataUrl) {
        try {
            const s = String(dataUrl || '');
            const m = s.match(/^data:([^;]+);base64,(.+)$/);
            if (!m) return null;
            const mime = m[1] || 'image/png';
            const b64 = m[2] || '';
            const bin = atob(b64);
            const len = bin.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: mime });
        } catch (_e) {
            return null;
        }
    }

    async _uploadDataUrlToComfyUIImage(dataUrl, { filename = null, overwrite = true } = {}) {
        try {
            const blob = this._dataUrlToBlob(dataUrl);
            if (!blob) return null;
            const name = String(filename || `goya_upload_${Date.now()}.png`);
            const formData = new FormData();
            formData.append('image', blob, name);
            formData.append('overwrite', overwrite ? 'true' : 'false');
            const uploadResp = await fetch('/upload/image', { method: 'POST', body: formData });
            if (!uploadResp.ok) {
                console.warn('[WorkflowRunner] /upload/image failed', uploadResp.status);
                return null;
            }
            const uploadData = await uploadResp.json();
            return uploadData?.name || name;
        } catch (e) {
            console.warn('[WorkflowRunner] uploadDataUrlToComfyUIImage failed', e);
            return null;
        }
    }

    /**
     * Build a ComfyUI-API JSON prompt graph for the full LTX-2 I2V pipeline:
     *
     * CheckpointLoaderSimple ─┬─ MODEL ──▶ [IAMCCS_LTX2_LoRAStack] ──▶ IAMCCS_ModelWithLoRA_LTX2
     *                         ├─ CLIP  ──▶ CLIPTextEncode (pos / neg)
     *                         └─ VAE   ──▶ VAEDecode
     *
     * CLIPTextEncode (pos+neg) ──▶ LTXVConditioning ──▶ (conditioning)
     * source_image ──▶ LoadImage ──▶ LTXVImgToVideo ──▶ (latent)
     * model ──▶ ModelSamplingLTXV + LTXVScheduler ──▶ SamplerCustomAdvanced ──▶ VAEDecode ──▶ VHS_VideoCombine
     *
     * @param {Object} params – sphere params from i2v_lil node
     * @returns {Object} ComfyUI prompt graph
     */
    _buildScenarioLILGraph(params = {}) {
        const P = {};
        let n = 1;
        const id = () => String(n++);

        const model     = params.model || 'ltxv_2_0_0_bf16.safetensors';
        const width     = Number(params.width) || 768;
        const height    = Number(params.height) || 512;
        const frames    = Number(params.frames) || 121;
        const fps       = Number(params.fps) || 25;
        const steps     = Number(params.steps) || 20;
        const cfg       = Number(params.cfg) || 3.0;
        const strength  = Number(params.strength) || 0.6;
        const seed      = (Number.isFinite(Number(params.seed)) && Number(params.seed) >= 0)
            ? Number(params.seed) : Math.floor(Math.random() * 2**31);
        const maxShift  = Number(params.maxShift) || 2.36;
        const baseShift = Number(params.baseShift) || 0.68;
        const stretch   = !!(params.stretch);
        const terminal  = Number(params.terminal) || 0.1;
        const prompt    = String(params.prompt || params.lil_prompt || '');
        const negative  = String(params.negative || params.lil_negative || '');
        const prefix    = String(params.filenamePrefix || 'IAMCCS_ltx2_lil');
        const format    = String(params.format || 'mp4');
        const codec     = String(params.codec || 'h264');

        // Dual-CLIP (optional override)
        const clip1 = String(params.clip1 ?? params.clip ?? '');
        const clip2 = String(params.clip2 ?? '');
        const clipType = String(params.clipType || 'ltxv');
        const clipDevice = String(params.clipDevice || 'default');

        // 1. CheckpointLoaderSimple
        const idCkpt = id();
        P[idCkpt] = {
            class_type: 'CheckpointLoaderSimple',
            inputs: { ckpt_name: model }
        };
        let modelOut = idCkpt;  // output 0 = MODEL
        const clipOut = idCkpt; // output 1 = CLIP (may be missing for UNet-only models)
        const vaeOut  = idCkpt; // output 2 = VAE

        // 2. LoRA Stack (IAMCCS_LTX2_LoRAStack)
        const lora1 = params.lora1 || '';
        const lora2 = params.lora2 || '';
        const lora3 = params.lora3 || '';
        const hasAnyLora = !!(lora1 || lora2 || lora3);

        if (hasAnyLora) {
            const idLoraStack = id();
            P[idLoraStack] = {
                class_type: 'IAMCCS_LTX2_LoRAStack',
                inputs: {
                    lora_name_1: lora1 || 'None',
                    lora_strength_1: Number(params.lora1Strength) || 1.0,
                    lora_name_2: lora2 || 'None',
                    lora_strength_2: Number(params.lora2Strength) || 1.0,
                    lora_name_3: lora3 || 'None',
                    lora_strength_3: Number(params.lora3Strength) || 1.0,
                }
            };

            // Apply LoRA to model
            const idApplyLora = id();
            P[idApplyLora] = {
                class_type: 'IAMCCS_ModelWithLoRA_LTX2',
                inputs: {
                    model: [modelOut, 0],
                    clip: [clipOut, 1],
                    lora_stack: [idLoraStack, 0],
                }
            };
            modelOut = idApplyLora; // output 0 = MODEL (with LoRA)
        }

        // 3. CLIP (prefer DualCLIPLoader when both slots are provided)
        let clipNodeId = clipOut;
        let clipNodeOutIndex = 1;
        if (clip1 || clip2) {
            const hasBoth = !!(clip1 && clip2);
            if (hasBoth) {
                const idDual = id();
                P[idDual] = {
                    class_type: 'DualCLIPLoader',
                    inputs: {
                        clip_name1: clip1,
                        clip_name2: clip2,
                        type: clipType,
                        device: clipDevice,
                    }
                };
                clipNodeId = idDual;
                clipNodeOutIndex = 0;
            }
        }

        // 4. CLIPTextEncode (positive)
        const idPosEnc = id();
        P[idPosEnc] = {
            class_type: 'CLIPTextEncode',
            inputs: { text: prompt, clip: [clipNodeId, clipNodeOutIndex] }
        };

        // 5. CLIPTextEncode (negative)
        const idNegEnc = id();
        P[idNegEnc] = {
            class_type: 'CLIPTextEncode',
            inputs: { text: negative, clip: [clipNodeId, clipNodeOutIndex] }
        };

        // 6. LTXVConditioning
        const idCond = id();
        P[idCond] = {
            class_type: 'LTXVConditioning',
            inputs: {
                positive: [idPosEnc, 0],
                negative: [idNegEnc, 0],
                frame_rate: fps,
            }
        };

        // 7. LoadImage (source image from canvas)
        const idLoadImg = id();
        P[idLoadImg] = {
            class_type: 'LoadImage',
            inputs: { image: 'goya_composite.png' }
        };

        // 8. LTXVImgToVideo (creates latent from image)
        const idI2V = id();
        P[idI2V] = {
            class_type: 'LTXVImgToVideo',
            inputs: {
                positive: [idCond, 0],
                negative: [idCond, 1],
                vae: [vaeOut, 2],
                image: [idLoadImg, 0],
                width: width,
                height: height,
                length: frames,
                batch_size: 1,
            }
        };

        // 8. ModelSamplingLTXV
        const idSampling = id();
        P[idSampling] = {
            class_type: 'ModelSamplingLTXV',
            inputs: {
                model: [modelOut, 0],
                max_shift: maxShift,
                base_shift: baseShift,
            }
        };

        // 9. KSampler (simplified sampling pipeline)
        const idKSampler = id();
        P[idKSampler] = {
            class_type: 'KSampler',
            inputs: {
                model: [idSampling, 0],
                positive: [idCond, 0],
                negative: [idCond, 1],
                latent_image: [idI2V, 0],
                seed: seed,
                steps: steps,
                cfg: cfg,
                sampler_name: 'euler',
                scheduler: 'beta',
                denoise: strength,
            }
        };

        // 10. VAEDecode
        const idDecode = id();
        P[idDecode] = {
            class_type: 'VAEDecode',
            inputs: {
                samples: [idKSampler, 0],
                vae: [vaeOut, 2],
            }
        };

        // 14. CreateVideo (ComfyUI core) — audio is optional
        const idCreateVideo = id();
        P[idCreateVideo] = {
            class_type: 'CreateVideo',
            inputs: {
                images: [idDecode, 0],
                fps: fps,
            }
        };

        // 15. SaveVideo (ComfyUI core)
        const idSaveVideo = id();
        P[idSaveVideo] = {
            class_type: 'SaveVideo',
            inputs: {
                video: [idCreateVideo, 0],
                filename_prefix: prefix,
                format: format,
                codec: codec,
            }
        };

        return P;
    }

    /**
     * Build a ComfyUI-API JSON prompt graph for Motion Extend (IAMCCS_LTX2_ExtensionModule).
     *
     * Takes an existing video (as image batch) + prompt, extends using the LTX-2 extension pipeline.
     * @param {Object} params – sphere params from motion_extend node
     * @returns {Object} ComfyUI prompt graph
     */
    _buildMotionExtendGraph(params = {}) {
        const P = {};
        let n = 1;
        const id = () => String(n++);

        const model     = params.model || 'ltxv_2_0_0_bf16.safetensors';
        const frames    = Number(params.frames) || 121;
        const fps       = Number(params.fps) || 25;
        const steps     = Number(params.steps) || 20;
        const cfg       = Number(params.cfg) || 3.0;
        const strength  = Number(params.strength) || 0.8;
        const seed      = (Number.isFinite(Number(params.seed)) && Number(params.seed) >= 0)
            ? Number(params.seed) : Math.floor(Math.random() * 2**31);
        const maxShift  = Number(params.maxShift) || 2.36;
        const baseShift = Number(params.baseShift) || 0.68;
        const overlapFrames = Number(params.overlapFrames) || 9;
        const blendMode = String(params.blendMode || 'ease_in_out');
        const colorMatch = !!(params.colorMatch);
        const seamSearch = !!(params.seamSearch);
        const prompt    = String(params.prompt || '');
        const negative  = String(params.negative || '');
        const prefix    = String(params.filenamePrefix || 'IAMCCS_extend');

        // 1. CheckpointLoaderSimple
        const idCkpt = id();
        P[idCkpt] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } };
        let modelNodeId = idCkpt;

        // 2. Optional LoRA
        const lora1 = params.lora1 || '';
        const lora2 = params.lora2 || '';
        if (lora1 || lora2) {
            const idLoraStack = id();
            P[idLoraStack] = {
                class_type: 'IAMCCS_LTX2_LoRAStack',
                inputs: {
                    lora_name_1: lora1 || 'None', lora_strength_1: Number(params.lora1Strength) || 1.0,
                    lora_name_2: lora2 || 'None', lora_strength_2: Number(params.lora2Strength) || 1.0,
                    lora_name_3: 'None', lora_strength_3: 1.0,
                }
            };
            const idApply = id();
            P[idApply] = {
                class_type: 'IAMCCS_ModelWithLoRA_LTX2',
                inputs: { model: [idCkpt, 0], clip: [idCkpt, 1], lora_stack: [idLoraStack, 0] }
            };
            modelNodeId = idApply;
        }

        // 3. CLIPTextEncode (pos/neg)
        const idPos = id();
        P[idPos] = { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: [idCkpt, 1] } };
        const idNeg = id();
        P[idNeg] = { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: [idCkpt, 1] } };

        // 4. LoadVideo (input video frames from upstream)
        const idLoadVid = id();
        P[idLoadVid] = {
            class_type: 'VHS_LoadVideo',
            inputs: { video: 'goya_input_video.mp4', force_rate: fps, force_size: 'Disabled' }
        };

        // 5. IAMCCS_LTX2_ExtensionModule
        const idExtend = id();
        P[idExtend] = {
            class_type: 'IAMCCS_LTX2_ExtensionModule',
            inputs: {
                model: [modelNodeId, 0],
                positive: [idPos, 0],
                negative: [idNeg, 0],
                vae: [idCkpt, 2],
                images: [idLoadVid, 0],
                width: Number(params.width) || 768,
                height: Number(params.height) || 512,
                length: frames,
                steps: steps,
                cfg: cfg,
                seed: seed,
                denoise_strength: strength,
                overlap_frames: overlapFrames,
                overlap_side: String(params.overlapSide || 'end'),
                blend_mode: blendMode,
                color_match: colorMatch,
                seam_search: seamSearch,
            }
        };

        // 6. VHS_VideoCombine
        const idSave = id();
        P[idSave] = {
            class_type: 'VHS_VideoCombine',
            inputs: {
                images: [idExtend, 0],
                frame_rate: fps,
                loop_count: 0,
                filename_prefix: prefix,
                format: 'video/mp4',
                save_output: true,
            }
        };

        return P;
    }

    _resolveFl2PanelScenario() {
        // FL2 behaves like a panel dispatcher (exclusive selection).
        // Rules (per spec):
        // - Selecting FL2 excludes other scenarios
        // - If there are multiple layers AND a mask on loaded image → FL2-I
        // - Else if an image is loaded AND user uses global prompt → FL2-S
        // - Outpaint condition intentionally deferred
        try {
            const layers = (this.layerManager?.getLayers?.() || []).filter((l) => !!l && l.visible !== false);
            const visibleCount = layers.length;

            // IMPORTANT: for FL2 routing, treat "loaded image" as an imported image.
            // Painted layers may have a bitmap too, but should not block FL2-T (txt2img).
            const hasImportedImage = layers.some((l) => {
                const isImport = l?.metadata?.source?.type === "import";
                const bmp = l?.bitmap;
                return !!isImport && typeof bmp === "string" && bmp.length > 64; // dataURL/base64
            });

            const hasAnyLayerMask = layers.some((l) => {
                const m = l?.mask;
                return typeof m === "string" && m.length > 64;
            });
            const maskStack = this.maskManager?.exportMaskStack?.() || [];
            const hasMaskStack = Array.isArray(maskStack) && maskStack.length > 0;
            const hasMask = hasAnyLayerMask || hasMaskStack;

            const g = this.promptManager?.getGlobalPrompt?.() || {};
            const globalPositive = String(g?.positive || "").trim();
            const globalNegative = String(g?.negative || "").trim();
            const globalPromptUsed = !!(globalPositive || globalNegative);

            const hasRegionalPrompts = layers.some((l) => {
                const p = l?.prompt || {};
                const pos = String(p?.positive || "").trim();
                const neg = String(p?.negative || "").trim();
                return !!(pos || neg);
            });

            if (hasImportedImage && hasMask && visibleCount > 1) {
                return "fl2-i";
            }
            // Text2img: prompt present but no loaded image
            if (!hasImportedImage && globalPromptUsed && !hasRegionalPrompts) {
                return "fl2-t";
            }
            if (hasImportedImage && globalPromptUsed && !hasRegionalPrompts) {
                return "fl2-s";
            }
        } catch (e) {
            // fallthrough
        }
        return "fl2-i";
    }

    _syncUpscaleModeExtras() {
        if (!this.upscaleExtras) this.upscaleExtras = {};
        const mode = (this.upscaleMode || "seedvr2").toLowerCase();
        const submode = (this.upscalePanelSubmode || mode).toLowerCase();
        // Set upscale_mode based on panel submode for correct backend routing
        this.upscaleExtras.upscale_mode = submode;
        this.upscaleExtras.upscale_panel_submode = submode;
        this.upscaleExtras.seedvr2_enabled = (submode === "seedvr2") ? true : false;
        
        if (submode === "sdultimate") {
            this.upscaleExtras.scenario_override = "up";
            this.upscaleExtras.engine = "upscale"; // Set engine for model discovery
            delete this.upscaleExtras.seedvr2_enabled; // Clean conflicting flags
        } else if (submode === "seedvr2") {
            this.upscaleExtras.scenario_override = "up";
            this.upscaleExtras.engine = "upscale";
        }
        
        console.log("[WorkflowRunner] _syncUpscaleModeExtras: submode=", submode, "extras=", this.upscaleExtras);
    }

    setSeedVR2Enabled(flag, options = {}) {
        this.seedvr2Enabled = !!flag;
        this._syncUpscaleModeExtras();
        if (!options.silent) {
            this.bridge.pushState(this.buildPayload());
        }
    }

    setUpscaleMode(mode, options = {}) {
        const normalized = String(mode || "seedvr2").toLowerCase();
        const panelSubmode = options.panelSubmode !== undefined
            ? String(options.panelSubmode || normalized).toLowerCase()
            : normalized;
        this.upscaleMode = normalized;
        this.upscalePanelSubmode = panelSubmode;
        if (panelSubmode === "seedvr2" || normalized === "seedvr2") {
            this.seedvr2Enabled = true;
        } else if (panelSubmode === "unet" || normalized === "unet" || panelSubmode === "sdultimate" || normalized === "sdultimate") {
            this.seedvr2Enabled = false;
        }
        this._syncUpscaleModeExtras();
        if (!options.silent) {
            this.bridge.pushState(this.buildPayload());
        }
    }

    setUpscalePanelSubmode(mode, options = {}) {
        this.setUpscaleMode(this.upscaleMode, { panelSubmode: mode, silent: options.silent });
    }

    // Flux sigma shift parameters
    setFluxMaxShift(value) {
        const v = parseFloat(value);
        this.fluxMaxShift = Number.isFinite(v) ? v : 1.15;
    }
    setFluxBaseShift(value) {
        const v = parseFloat(value);
        this.fluxBaseShift = Number.isFinite(v) ? v : 0.5;
    }

    // Upscale controls
    setUpscaleEnabled(enabled) {
        this.upscaleEnabled = !!enabled;
        console.log("[WorkflowRunner] setUpscaleEnabled ->", this.upscaleEnabled);
        if (this.upscaleEnabled) {
            this.engine = "upscale";
            const currentMode = (this.upscalePanelSubmode || this.upscaleMode || "seedvr2").toLowerCase();
            this.seedvr2Enabled = currentMode === "seedvr2";
        } else {
            if (this.engine === "upscale") {
                this.engine = "qwen"; // default fallback
            }
        }
        // aggiorno anche lo stato backend subito
        this._syncUpscaleModeExtras();
        this.bridge.pushState(this.buildPayload());
    }
    setUpscaleModel(model) {
        this.upscaleModel = String(model || "4x-ClearRealityV1.pth");
        this.bridge.pushState(this.buildPayload());
    }
    setUpscaleFactor(factor) {
        const v = parseFloat(factor);
        this.upscaleFactor = Number.isFinite(v) ? v : 2.0;
        this.setUpscaleValue("seedvr2_factor", this.upscaleFactor);
    }
    setUpscaleDenoise(denoise) {
        const v = parseFloat(denoise);
        this.upscaleDenoise = Number.isFinite(v) ? v : 0.15;
        this.setUpscaleValue("seedvr2_denoise", this.upscaleDenoise);
    }
    setModeType(mode) {
        this.modeType = String(mode || "Chess");
        this.setUpscaleValue("seedvr2_mode", this.modeType);
    }
    setTileWidth(width) {
        const v = parseInt(width);
        this.tileWidth = Number.isFinite(v) ? v : 1024;
        this.setUpscaleValue("seedvr2_tile_width", this.tileWidth);
    }
    setTileHeight(height) {
        const v = parseInt(height);
        this.tileHeight = Number.isFinite(v) ? v : 1024;
        this.setUpscaleValue("seedvr2_tile_height", this.tileHeight);
    }
    setMaskBlur(blur) {
        const v = parseInt(blur);
        this.maskBlur = Number.isFinite(v) ? v : 8;
        this.setUpscaleValue("seedvr2_mask_blur", this.maskBlur);
    }
    setTilePadding(padding) {
        const v = parseInt(padding);
        this.tilePadding = Number.isFinite(v) ? v : 32;
        this.setUpscaleValue("seedvr2_tile_padding", this.tilePadding);
    }
    setSeedVR2DitModel(name) {
        // Normalize to basename to match SeedVR2 loader expectations
        const val = String(name || "");
        const base = val.split("/").pop().split("\\").pop();
        this.seedvr2DitModel = base || "";
        if (!this.seedvr2Params) this.seedvr2Params = {};
        this.seedvr2Params.seedvr2_dit_model = this.seedvr2DitModel;
        this.bridge.pushState(this.buildPayload());
    }
    setSeamFixMode(mode) {
        this.seamFixMode = String(mode || "None");
        this.bridge.pushState(this.buildPayload());
    }
    setSeamFixDenoise(denoise) {
        const v = parseFloat(denoise);
        this.seamFixDenoise = Number.isFinite(v) ? v : 1.0;
        this.bridge.pushState(this.buildPayload());
    }
    setSeamFixMaskBlur(blur) {
        const v = parseInt(blur);
        this.seamFixMaskBlur = Number.isFinite(v) ? v : 64;
        this.bridge.pushState(this.buildPayload());
    }
    setSeamFixWidth(width) {
        const v = parseInt(width);
        this.seamFixWidth = Number.isFinite(v) ? v : 8;
        this.bridge.pushState(this.buildPayload());
    }
    setSeamFixPadding(padding) {
        const v = parseInt(padding);
        this.seamFixPadding = Number.isFinite(v) ? v : 16;
        this.bridge.pushState(this.buildPayload());
    }
    setForceUniformTiles(force) {
        this.forceUniformTiles = !!force;
        this.bridge.pushState(this.buildPayload());
    }
    setTiledDecode(decode) {
        this.tiledDecode = !!decode;
        this.bridge.pushState(this.buildPayload());
    }

    // Generic setUpscaleValue method
    setUpscaleValue(key, value) {
        switch(key) {
            case "unetModel": this.setUnetModel(value); break;
            case "vaeModel": this.setVaeModel(value); break;
            case "clipModel": this.setClip1Model(value); break;
            case "clipType": this.setClipType(value); break;
            case "upscaleModel": this.setUpscaleModel(value); break;
            case "upscaleFactor": this.setUpscaleFactor(value); break;
            case "upscaleDenoise": this.setUpscaleDenoise(value); break;
            case "modeType": this.setModeType(value); break;
            case "tileWidth": this.setTileWidth(value); break;
            case "tileHeight": this.setTileHeight(value); break;
            case "tilePadding": this.setTilePadding(value); break;
            case "seamFixWidth": this.setSeamFixWidth(value); break;
            case "seamFixDenoise": this.setSeamFixDenoise(value); break;
            case "seamFixMaskBlur": this.setSeamFixMaskBlur(value); break;
            case "seamFixPadding": this.setSeamFixPadding(value); break;
            case "seamFixMode": this.setSeamFixMode(value); break;
            case "maskBlur": this.setMaskBlur(value); break;
            case "forceUniformTiles": this.setForceUniformTiles(value); break;
            case "tiledDecode": this.setTiledDecode(value); break;
            case "sampler": this.setSampler(value); break;
            case "scheduler": this.setScheduler(value); break;
            case "steps": this.setSteps(value); break;
            case "cfg": this.setCfg(value); break;
            case "seed": this.setSeed(value); break;
            case "upscale_mode": this.setUpscaleMode(value); break;
            case "upscale_panel_submode": this.setUpscalePanelSubmode(value); break;
            case "seedvr2_enabled": this.setSeedVR2Enabled(value); break;
            case "seedvr2_dit_model": this.setSeedVR2DitModel(value); break;
            case "upscaleUnetModel": this.upscaleUnetModel = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleVaeModel": this.upscaleVaeModel = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleClipType": this.upscaleClipType = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleClip1Model": this.upscaleClip1Model = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleClip2Enabled": this.setUpscaleClip2Enabled(value); break;
            case "upscaleClip2Model": this.setUpscaleClip2Model(value); break;
            case "upscaleLora1Model": this.upscaleLora1Model = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleLora1Strength": this.upscaleLora1Strength = parseFloat(value) || 1.0; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleLora2Model": this.upscaleLora2Model = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleLora2Strength": this.upscaleLora2Strength = parseFloat(value) || 1.0; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleLora3Model": this.upscaleLora3Model = value; this.bridge.pushState(this.buildPayload()); break;
            case "upscaleLora3Strength": this.upscaleLora3Strength = parseFloat(value) || 1.0; this.bridge.pushState(this.buildPayload()); break;
            default: {
                // Persist arbitrary upscale keys (e.g., SeedVR2 params) into payload.extra
                if (!this.upscaleExtras) this.upscaleExtras = {};
                this.upscaleExtras[key] = value;
                if (typeof key === "string" && key.startsWith("seedvr2")) {
                    if (!this.seedvr2Params) this.seedvr2Params = {};
                    this.seedvr2Params[key] = value;
                }
                console.debug("[WorkflowRunner] setUpscaleValue", key, value);
                // Push state so backend stays in sync
                this.bridge.pushState(this.buildPayload());
                break;
            }
        }
    }

    buildPayload(extra = {}) {
        // DISPATCHER: Set scenario_override from active panel (Priority 1 routing)
        const activeScenario = this.getActiveScenario();
        console.log("[DISPATCHER] buildPayload: activeScenario=", activeScenario, "will set as scenario_override");
        
        this._syncUpscaleModeExtras();
        let seedvr2Extras = this.seedvr2Params ? { ...this.seedvr2Params } : {};
        // If SDultimate subpanel is active, hard-purge SeedVR2 extras to avoid misrouting
        const submodeNow = String(this.upscalePanelSubmode || this.upscaleMode || "").toLowerCase();
        const sdultimateActive = (this.upscaleEnabled && submodeNow === "sdultimate");
        if (sdultimateActive) {
            seedvr2Extras = {};
            // Also ensure UI seedvr2 flag is off
            if (this.upscaleExtras) {
                this.upscaleExtras.seedvr2_enabled = false;
            }
        }
        // Ensure the current UI model choice wins and is normalized to basename
        if (seedvr2Extras && typeof this.seedvr2DitModel === "string" && this.seedvr2DitModel.length) {
            const base = this.seedvr2DitModel.split("/").pop().split("\\").pop();
            seedvr2Extras.seedvr2_dit_model = base;
        }
        const mergedUpscaleExtras = { ...seedvr2Extras };
        if (this.upscaleExtras) {
            Object.entries(this.upscaleExtras).forEach(([k, v]) => {
                mergedUpscaleExtras[k] = v;
            });
        }
        
        // Clean conflicting metadata (prevent router fallback/confusion)
        delete mergedUpscaleExtras.engine;
        delete mergedUpscaleExtras.upscale_method;
        // Ensure cache cannot override current routing
        delete mergedUpscaleExtras.scenario_override;
        delete mergedUpscaleExtras.upscale_mode;
        delete mergedUpscaleExtras.upscale_panel_submode;
        // Also prevent cached model value from overriding dropdown
        delete mergedUpscaleExtras.seedvr2_dit_model;
        // If SDultimate is active, remove any lingering seedvr2_* keys
        if (sdultimateActive) {
            Object.keys(mergedUpscaleExtras).forEach((k) => {
                if (k.startsWith("seedvr2")) delete mergedUpscaleExtras[k];
            });
        }
        
        console.log("[DISPATCHER] Active scenario:", activeScenario, "panel:", this.activePanel || "auto");
        console.log("[WorkflowRunner] buildPayload upscaleMode:", this.upscaleMode, "upscalePanelSubmode:", this.upscalePanelSubmode);
        console.log("[WorkflowRunner] buildPayload upscaleExtras:", this.upscaleExtras);
        console.log("[WorkflowRunner] buildPayload mergedUpscaleExtras:", mergedUpscaleExtras);
        console.log("[WorkflowRunner] buildPayload", {
            engine: this.engine,
            upscale_enabled: this.upscaleEnabled,
            sampler: this.sampler,
            scheduler: this.scheduler,
            models: { unet: this.unetModel, vae: this.vaeModel, clip1: this.clip1Model, clip2: this.clip2Model, clip2Enabled: this.clip2Enabled, clipType: this.clipType },
            upscale: {
                model: this.upscaleModel,
                factor: this.upscaleFactor,
                denoise: this.upscaleDenoise,
                mode: this.modeType,
                tileW: this.tileWidth,
                tileH: this.tileHeight,
                pad: this.tilePadding,
            },
            seedvr2Extras: mergedUpscaleExtras,
        });
        const engineLower = (this.engine || "").toLowerCase();
        // Guard: backend route depends on this flag, so keep it in sync with engine state
        if (engineLower === "upscale" && !this.upscaleEnabled) {
            console.log("[WorkflowRunner] Detected engine=upscale with flag disabled; forcing enable for routing");
            this.upscaleEnabled = true;
        }
        const computedUpscaleEnabled = engineLower === "upscale";

        // Use per-mode dimensions (easy vs advanced are independent)
        const genDims = this.getGenerationDimensions();

        const result = {
            width: genDims.width,
            height: genDims.height,
            seed: this.seed,
            steps: this.steps,
            sampler: this.sampler,
            scheduler: this.scheduler,
            cfg: this.cfg,
            global_cfg: this.cfg,
            global_guidance: this.globalGuidance,
            scenario: activeScenario, // DISPATCHER: explicit scenario from active panel
            qwen_generation_enabled: this.qwenEnabled,
            qwen_generation_mode: this.qwenEnabled ? "enabled" : "disabled",
            ...this.promptManager.buildPayload(),
            layers: this.layerManager.getLayers(),
            mask_stack: this.maskManager ? this.maskManager.exportMaskStack() : [],
            extra: {
                scenario_override: activeScenario, // DISPATCHER: Priority 1 routing
                // Debug breadcrumbs
                _dbg_engine: this.engine,
                _dbg_clip2Enabled: this.clip2Enabled,
                _dbg_clipType: this.clipType,
                // exec_mode removed: always Python-only
                sampler_name: this.sampler,
                scheduler: this.scheduler,
                lora1_enabled: !!this.lora1Enabled,
                lora_model_override: this.lora1Enabled ? this.lora1Model : "",
                lora_strength: this.lora1Enabled ? this.lora1Strength : 0,
                lora1_strength: this.lora1Enabled ? this.lora1Strength : 0,
                lora2_enabled: this.lora2Enabled,
                lora2_model: this.lora2Model,
                lora2_strength: this.lora2Strength,
                lora3_enabled: this.lora3Enabled,
                lora3_model: this.lora3Model,
                lora3_strength: this.lora3Strength,
                accelerator_enabled: this.acceleratorEnabled,
                sage_attention: this.sageAttentionMode,
                fp16_accumulation_enabled: this.fp16AccumulationEnabled,
                engine: this.engine,
                goyai_assistant: { ...this.goyaiAssistant },
                unet_model_override: this.unetModel,
                vae_model_override: this.vaeModel,
                clip1_model_override: this.clip1Model,
                clip2_enabled: this.clip2Enabled,
                clip2_model_override: this.clip2Model,
                clip_type: this.clipType,
                flux_max_shift: this.fluxMaxShift,
                flux_base_shift: this.fluxBaseShift,
                sd3_batch_size: this.txt2imgBatch,

                // FL2-O (outpaint) params (only when active)
                ...(activeScenario === "fl2-o" ? {
                    fl2o_left: this.fl2oLeft,
                    fl2o_top: this.fl2oTop,
                    fl2o_right: this.fl2oRight,
                    fl2o_bottom: this.fl2oBottom,
                    fl2o_feathering: this.fl2oFeathering,
                    fl2o_max_width: this.fl2oMaxWidth,
                    fl2o_max_height: this.fl2oMaxHeight,
                } : {}),
                upscale_enabled: computedUpscaleEnabled,
                upscale_model: this.upscaleModel,
                upscale_factor: this.upscaleFactor,
                upscale_denoise: this.upscaleDenoise,
                mode_type: this.modeType,
                tile_width: this.tileWidth,
                tile_height: this.tileHeight,
                mask_blur: this.maskBlur,
                tile_padding: this.tilePadding,
                seam_fix_mode: this.seamFixMode,
                seam_fix_denoise: this.seamFixDenoise,
                seam_fix_mask_blur: this.seamFixMaskBlur,
                seam_fix_width: this.seamFixWidth,
                seam_fix_padding: this.seamFixPadding,
                force_uniform_tiles: this.forceUniformTiles,
                tiled_decode: this.tiledDecode,
                // Scenario Z FlashVSR (debug only)
                z_upscale_enabled: this.zUpscaleEnabled,
                z_flash_model: this.zFlashModel,
                z_flash_mode: this.zFlashMode,
                z_flash_scale: this.zFlashScale,
                z_flash_seed_mode: this.zFlashSeedMode,
                z_flash_seed_locked: this.zFlashSeedLocked,
                // Scenario 1C FlashVSR (debug only)
                s1c_upscale_enabled: this.s1cUpscaleEnabled,
                s1c_flash_model: this.s1cFlashModel,
                s1c_flash_mode: this.s1cFlashMode,
                s1c_flash_scale: this.s1cFlashScale,
                s1c_flash_seed_mode: this.s1cFlashSeedMode,
                s1c_flash_seed_locked: this.s1cFlashSeedLocked,
                // SDultimate (hires) specific model overrides
                upscaleUnetModel: this.upscaleUnetModel || "",
                upscaleVaeModel: this.upscaleVaeModel || "",
                upscaleClipType: this.upscaleClipType || "qwen",
                upscaleClip1Model: this.upscaleClip1Model || "",
                upscaleClip2Enabled: this.upscaleClip2Enabled || false,
                upscaleClip2Model: this.upscaleClip2Model || "",
                upscaleLora1Model: this.upscaleLora1Model || "",
                upscaleLora1Strength: this.upscaleLora1Strength || 1.0,
                upscaleLora2Model: this.upscaleLora2Model || "",
                upscaleLora2Strength: this.upscaleLora2Strength || 1.0,
                upscaleLora3Model: this.upscaleLora3Model || "",
                upscaleLora3Strength: this.upscaleLora3Strength || 1.0,
                // Arbitrary Upscale extras (SeedVR2, etc.)
                ...mergedUpscaleExtras,
                // Safety net: ensure SeedVR2 params are always synced from UI state (only when SeedVR2 active)
                ...(submodeNow === "seedvr2" ? {
                    seedvr2_tile_width: this.tileWidth,
                    seedvr2_tile_height: this.tileHeight,
                    seedvr2_factor: this.upscaleFactor,
                    seedvr2_denoise: this.upscaleDenoise,
                    seedvr2_mode: this.modeType,
                    seedvr2_tile_padding: this.tilePadding,
                    seedvr2_mask_blur: this.maskBlur,
                    seedvr2_dit_model: this.seedvr2DitModel,
                } : {}),
                ...(extra && extra.extra ? extra.extra : {}),
                // DISPATCHER: Force scenario_override to prevent cache/extra overrides (must be last)
                scenario_override: activeScenario,
            },
            ...((extra && !extra.extra) ? extra : {}),
        };
        if (activeScenario === "z2") {
            const z2PreviewExtras = this._collectZ2Settings();
            Object.assign(result.extra, z2PreviewExtras);
            if (Number.isFinite(z2PreviewExtras.cfg_1st)) {
                result.cfg = z2PreviewExtras.cfg_1st;
                result.global_cfg = z2PreviewExtras.cfg_1st;
                result.extra.cfg = z2PreviewExtras.cfg_1st;
            }
            if (Number.isFinite(z2PreviewExtras.steps_1st)) {
                result.steps = z2PreviewExtras.steps_1st;
            }
            if (Number.isFinite(z2PreviewExtras.seed_1st_raw) && z2PreviewExtras.seed_1st_raw >= 0) {
                result.seed = z2PreviewExtras.seed_1st_raw;
            }
            if (z2PreviewExtras.sampler_name) {
                result.sampler = z2PreviewExtras.sampler_name;
            }
            if (z2PreviewExtras.scheduler) {
                result.scheduler = z2PreviewExtras.scheduler;
            }
        }
        if (activeScenario === "z") {
            // Scenario Z checkpoint mode (unified model+clip+vae)
            const checkpointName = this.zUseCheckpoint === true ? ((this.zCheckpointName || "") + "") : "";
            Object.assign(result.extra, {
                use_checkpoint: this.zUseCheckpoint === true,
                checkpoint_name: checkpointName,
            });
        }
        if (activeScenario === "z3") {
            const z3Extras = this._collectZ3Settings();
            Object.assign(result.extra, z3Extras);
            // Align primary display params if provided
            if (Number.isFinite(z3Extras.steps)) result.steps = z3Extras.steps;
            if (Number.isFinite(z3Extras.cfg)) {
                result.cfg = z3Extras.cfg;
                result.global_cfg = z3Extras.cfg;
                result.extra.cfg = z3Extras.cfg;
            }
            if (Number.isFinite(z3Extras.seed) && z3Extras.seed >= 0) {
                result.seed = z3Extras.seed;
            }
            if (z3Extras.sampler_name) result.sampler = z3Extras.sampler_name;
            if (z3Extras.scheduler) result.scheduler = z3Extras.scheduler;
        }
        // Extra guard: if legacy SDultimate panel is active, keep it on supported upscale routing.
        if (sdultimateActive) {
            result.extra.seedvr2_enabled = false;
            result.extra.upscale_mode = "sdultimate";
            result.extra.upscale_panel_submode = "sdultimate";
            result.extra.scenario_override = "up";
        }

        // 🔥 CRITICAL FIX: Force SDultimate model overrides to prevent backend from receiving empty/invalid values
        if (this.engine === "upscale" && this.upscalePanelSubmode === "sdultimate") {
            console.log("[DISPATCHER] 🔥 SDultimate mode detected - forcing model overrides");
            result.extra.clip1_model_override = this.upscaleClip1Model || "";
            result.extra.vae_model_override = this.upscaleVaeModel || "";
            result.extra.unet_model_override = this.upscaleUnetModel || "";
            console.log("[DISPATCHER] 🔥 Forced overrides:", {
                clip1: result.extra.clip1_model_override,
                vae: result.extra.vae_model_override,
                unet: result.extra.unet_model_override,
            });
        }

        // Refactor #3: allow backend to opt into stricter parsing rules.
        // Safe no-op unless backend checks dispatch_version.
        if (result && result.extra) {
            result.extra.video_workflow_settings = this.getVideoWorkflowSettings();
        }
        if (result && result.extra && result.extra.dispatch_version == null) {
            result.extra.dispatch_version = 3;
        }
        
        console.log("[DISPATCHER] Final payload.extra.scenario_override=", result.extra.scenario_override, "payload.scenario=", result.scenario);

        // Reset generation source back to default after payload is built
        this._generationSource = 'advanced';

        return result;
    }

    getGoyaiAssistantSettings() {
        return { ...this.goyaiAssistant };
    }

    getVideoWorkflowSettings() {
        return { ...this.videoWorkflowSettings };
    }

    setGoyaiAssistantSettings(patch = {}, options = {}) {
        const next = {
            ...this.goyaiAssistant,
            ...(patch && typeof patch === "object" ? patch : {}),
        };
        next.enabled = Boolean(next.enabled);
        next.open = Boolean(next.open);
        next.floating = true;
        next.transparent = Boolean(next.transparent);
        next.model = String(next.model ?? this.goyaiAssistant?.model ?? "").trim();
        next.disableThinking = Boolean(next.disableThinking ?? true);
        next.voiceInputEnabled = Boolean(next.voiceInputEnabled);
        next.voiceOutputEnabled = Boolean(next.voiceOutputEnabled ?? true);
        next.recognitionLang = String(next.recognitionLang || 'it-IT');
        next.asrProvider = ['browser', 'model', 'disabled'].includes(String(next.asrProvider || '').toLowerCase()) ? String(next.asrProvider).toLowerCase() : 'browser';
        next.voiceInputMode = ['click', 'always', 'wake_word', 'disabled'].includes(String(next.voiceInputMode || '').toLowerCase()) ? String(next.voiceInputMode).toLowerCase() : 'click';
        next.wakeWord = String(next.wakeWord || 'goya').trim() || 'goya';
        next.ttsProvider = ['browser', 'model', 'disabled'].includes(String(next.ttsProvider || '').toLowerCase()) ? String(next.ttsProvider).toLowerCase() : 'browser';
        next.ttsVoice = String(next.ttsVoice || '');
        next.ttsSpeed = Math.max(0.7, Math.min(1.4, Number(next.ttsSpeed || 1.1) || 1.1));
        next.keepAliveMinutes = Math.max(1, Number(next.keepAliveMinutes || 30) || 30);
        next.requestTimeoutSeconds = Math.max(5, Number(next.requestTimeoutSeconds || 50) || 50);
        next.promptEngineeringEnabled = Boolean(next.promptEngineeringEnabled ?? true);
        next.promptEngineeringProfile = String(next.promptEngineeringProfile || 'ltx');
        {
            const rawAuthority = String(next.authority || "watcher").toLowerCase();
            next.authority = rawAuthority === "worker" || rawAuthority === "hard" ? "worker" : "watcher";
        }
        this.goyaiAssistant = next;
        try { this.eventBus?.emit?.("goyai-assistant:settings", { settings: this.getGoyaiAssistantSettings() }); } catch (_e) {}
        if (options?.silentPush) return this.getGoyaiAssistantSettings();
        try { this.bridge?.pushState?.(this.buildPayload()); } catch (_e) {}
        return this.getGoyaiAssistantSettings();
    }

    setVideoWorkflowSettings(patch = {}, options = {}) {
        const next = {
            ...this.videoWorkflowSettings,
            ...(patch && typeof patch === "object" ? patch : {}),
        };
        next.workflowId = String(next.workflowId || 'ltx23_manual_inpaint_v1');
        next.unetMode = String(next.unetMode || 'gguf').toLowerCase() === 'standard' ? 'standard' : 'gguf';
        next.ggufModel = String(next.ggufModel || 'ltx-2.3-22b-dev-Q4_K_S.gguf');
        next.unetModel = String(next.unetModel || 'ltx-2.3-22b-distilled_transformer_only_fp8_input_scaled_v3.safetensors');
        next.videoVaeModel = String(next.videoVaeModel || '');
        next.audioVaeModel = String(next.audioVaeModel || '');
        next.textEncoderModel = String(next.textEncoderModel || 'gemma_3_12B_it_fp8_e4m3fn.safetensors');
        next.textProjectionModel = String(next.textProjectionModel || 'ltx-2.3_text_projection_bf16.safetensors');
        next.distilledLoraEnabled = Boolean(next.distilledLoraEnabled ?? next.loraModel);
        next.distilledLoraModel = String(next.distilledLoraModel || next.loraModel || 'ltx-2.3-22b-distilled-lora-384.safetensors');
        next.distilledLoraStrength = Number(next.distilledLoraStrength || next.loraStrength || 1.0) || 1.0;
        next.inpaintLoraEnabled = Boolean(next.inpaintLoraEnabled);
        next.inpaintLoraModel = String(next.inpaintLoraModel || 'ltx23_inpaint_rank128_v1.safetensors');
        next.inpaintLoraStrength = Number(next.inpaintLoraStrength || 1.0) || 1.0;
        next.sampler = String(next.sampler || 'euler_ancestral_cfg_pp');
        next.steps = Math.max(1, Number(next.steps || 8) || 8);
        next.seedMode = String(next.seedMode || 'fixed').toLowerCase() === 'randomize' ? 'randomize' : 'fixed';
        next.seedValue = Math.max(0, Number(next.seedValue || 10) || 10);
        next.scheduler = String(next.scheduler || 'bong_tangent');
        this.videoWorkflowSettings = next;
        try { this.eventBus?.emit?.('video:workflow:settings', { settings: this.getVideoWorkflowSettings() }); } catch (_e) {}
        if (options?.silentPush) return this.getVideoWorkflowSettings();
        try { this.bridge?.pushState?.(this.buildPayload()); } catch (_e) {}
        return this.getVideoWorkflowSettings();
    }

    async executeScenarioOne() {
    console.log("[RUNNER] EXECUTE fired", {
        engine: this.engine,
        activePanel: this.activePanel,
        width: this.canvasWidth,
        height: this.canvasHeight,
        seed: this.seed,
        steps: this.steps,
        cfg: this.cfg,
        sampler: this.sampler,
        scheduler: this.scheduler,
    });
		
		console.log("[RUNNER] EXECUTE fired (ScenarioOne)");
		
		
        // CRITICAL: Check activePanel FIRST for scenario overrides (priority routing)
        const panel = (this.activePanel || "").toLowerCase();
        if (panel === "lil") {
            console.log("[DISPATCHER] Routing to LIL I2V (activePanel priority) - EARLY RETURN");
            await this.executeScenarioLIL({});
            return;
        }
        if (panel === "z2") {
            console.log("[DISPATCHER] Routing to Z2 IMG2IMG (activePanel priority) - EARLY RETURN");
            await this.executeScenarioZ2({});
            return; // CRITICAL: Stop execute() to prevent payload override
        }
        if (panel === "z3") {
            console.log("[DISPATCHER] Routing to Z3 ControlNet (activePanel priority)");
            await this.executeScenarioZ3({});
            return; // CRITICAL: Stop execute() to prevent payload override
        }
        
        // Determine route; if engine=z, dispatch Scenario Z
        if ((this.engine || "").toLowerCase() === "z") {
            console.log("[DISPATCHER] Routing to Z-Image txt2img (engine=z) - EARLY RETURN");
            await this.executeScenarioZ({});
            return; // CRITICAL: Stop execute() to prevent payload override
        }

        // If engine=flux, dispatch Scenario 1C with optional FlashVSR
        if ((this.engine || "").toLowerCase() === "flux") {
            console.log("[DISPATCHER] Routing to Scenario 1C (Flux txt2img) - EARLY RETURN");
            await this.executeScenario1C({});
            return; // CRITICAL: Stop execute() to prevent payload override
        }

        // Optional: include composite as init if requested (still persisted in payload.extra)
        const composite = this.useCompositeInit ? await new Promise((resolve) => {
            let settled = false;
            const onReady = (result) => {
                if (settled) return;
                settled = true;
                this.eventBus.off("canvas:export:composite:ready", handler);
                resolve(result?.data || null);
            };
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.eventBus.off("canvas:export:composite:ready", handler);
                resolve(null);
            }, 200);
            const handler = (res) => { clearTimeout(timer); onReady(res); };
            this.eventBus.on("canvas:export:composite:ready", handler);
            this.eventBus.emit("canvas:export:composite");
        }) : null;

        const extra = composite ? { composite_image: composite } : {};
        const payload = this.buildPayload(extra);
        // Enforce current UI routing; ignore any cached scenario overrides
        const activeScenario = this.getActiveScenario();
        payload.extra.scenario_override = activeScenario;
        // Also ensure panel submode reflects UI
        payload.extra.upscale_mode = this.upscaleMode;
        payload.extra.upscale_panel_submode = this.upscalePanelSubmode;
        // Enforce current SeedVR2 DiT model selection from UI dropdown
        if (typeof this.seedvr2DitModel === "string" && this.seedvr2DitModel.length) {
            payload.extra.seedvr2_dit_model = this.seedvr2DitModel;
        }
        // Force upscale_enabled when engine is set to upscale
        if ((payload.extra.engine || this.engine) === "upscale") {
            payload.extra.upscale_enabled = true;
            const upMode = String(payload.extra.upscale_mode || payload.extra.upscale_panel_submode || this.upscaleMode || "").toLowerCase();
            // Only set SeedVR2 flags when mode is seedvr2
            if (upMode === "seedvr2") {
                if (payload.extra.seedvr2_enabled === undefined) payload.extra.seedvr2_enabled = true;
                if (!Number.isFinite(payload.extra.seedvr2_resolution)) {
                    payload.extra.seedvr2_resolution = Number.isFinite(this.seedvr2Params?.seedvr2_resolution) ? this.seedvr2Params.seedvr2_resolution : 2000;
                }
                if (!Number.isFinite(payload.extra.short_edge)) payload.extra.short_edge = payload.extra.seedvr2_resolution;
                if (!Number.isFinite(payload.extra.upscale_short_edge)) payload.extra.upscale_short_edge = payload.extra.seedvr2_resolution;
                if (!Number.isFinite(payload.extra.seedvr2_max_resolution)) payload.extra.seedvr2_max_resolution = 4000;
                if (!Number.isFinite(payload.extra.seedvr2_batch_size)) payload.extra.seedvr2_batch_size = 5;
            } else {
                payload.extra.seedvr2_enabled = false;
            }
            // Ensure all upscale params are present (shared)
            payload.extra.upscale_model = this.upscaleModel;
            payload.extra.upscale_factor = this.upscaleFactor;
            payload.extra.upscale_denoise = this.upscaleDenoise;
            payload.extra.mode_type = this.modeType;
            payload.extra.tile_width = this.tileWidth;
            payload.extra.tile_height = this.tileHeight;
            payload.extra.mask_blur = this.maskBlur;
            payload.extra.tile_padding = this.tilePadding;
            payload.extra.seam_fix_mode = this.seamFixMode;
            payload.extra.seam_fix_denoise = this.seamFixDenoise;
            payload.extra.seam_fix_mask_blur = this.seamFixMaskBlur;
            payload.extra.seam_fix_width = this.seamFixWidth;
            payload.extra.seam_fix_padding = this.seamFixPadding;
            payload.extra.force_uniform_tiles = this.forceUniformTiles;
            payload.extra.tiled_decode = this.tiledDecode;
        }

        // Push state before queueing to guarantee backend sync
        console.log("[WorkflowRunner] Pre-queue payload.extra.upscale_mode=", payload.extra.upscale_mode, "seedvr2Params=", this.seedvr2Params, "upscaleMode=", this.upscaleMode);
        console.log("[DISPATCHER] Pre-queue payload.extra.scenario_override=", payload.extra.scenario_override);
        console.log("[DISPATCHER] Pre-queue payload.extra.upscale_enabled=", payload.extra.upscale_enabled);
        console.log("[DISPATCHER] Pre-queue full payload.extra keys=", Object.keys(payload.extra));
        try {
            await this.bridge.pushState(payload, { immediate: true });
            console.log("[WorkflowRunner] ✅ State pushed before queue", payload.extra);
        } catch (e) {
            console.warn("[WorkflowRunner] pushState failed before queue", e);
        }

        // Default: persist + enqueue the ComfyUI graph
        this.eventBus.emit("workflow:started", { payload });
        this.eventBus.emit("workflow:queued", { ...payload, directRender: false });
    }

    /**
     * Global RUN dispatcher.
     * This is the single entrypoint used by FIELD RUN and VISUAL RUN.
     * It routes by getActiveScenario() (which honors activePanel priority).
     */
    async executeActiveScenario(params = {}) {
        try {
            const source = String(params?.source || "").toLowerCase();
            const requestedScenario = String(params?.scenarioKey || params?.templateKey || "").toLowerCase();
            if (source === "easy") {
                console.log("[DISPATCHER] executeActiveScenario easy route ->", requestedScenario);
                if (requestedScenario === "z" && typeof this.executeEasyZImageStandalone === "function") {
                    await this.executeEasyZImageStandalone(params);
                    return;
                }
                if (requestedScenario === "z3" && typeof this.executeScenarioZ3 === "function") {
                    await this.executeScenarioZ3(params);
                    return;
                }
                if ((requestedScenario === "up" || requestedScenario === "upscale") && typeof this.executeEasyUpscaleStandalone === "function") {
                    await this.executeEasyUpscaleStandalone(params);
                    return;
                }
                if ((requestedScenario === "draw"
                    || requestedScenario === "i2i"
                    || requestedScenario === "inpaint"
                    || requestedScenario === "outpaint"
                    || requestedScenario === "fl2-d"
                    || requestedScenario === "fl2-s"
                    || requestedScenario === "fl2-i"
                    || requestedScenario === "fl2-o") && typeof this.executeEasyStandalone === "function") {
                    await this.executeEasyStandalone(params);
                    return;
                }
            }

            const activeScenario = String(this.getActiveScenario() || "").toLowerCase();
            console.log("[DISPATCHER] executeActiveScenario →", activeScenario);

            if (activeScenario === "lil") {
                await this.executeScenarioLIL(params);
                return;
            }

            // Keep existing behavior centralized in executeScenarioOne for all other scenarios.
            await this.executeScenarioOne();
        } catch (err) {
            console.warn("[RUNNER] executeActiveScenario failed", err);
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

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
        const pctx = prepared.getContext("2d");
        if (!pctx) {
            throw new Error("Easy outpaint: unable to prepare expanded source.");
        }
        pctx.fillStyle = "#000000";
        pctx.fillRect(0, 0, width, height);
        pctx.drawImage(source, left, top, sourceWidth, sourceHeight);

        const mask = document.createElement("canvas");
        mask.width = width;
        mask.height = height;
        const mctx = mask.getContext("2d");
        if (!mctx) {
            throw new Error("Easy outpaint: unable to prepare mask.");
        }
        mctx.clearRect(0, 0, width, height);
        mctx.fillStyle = "#ff0000";
        if (top > 0) mctx.fillRect(0, 0, width, top);
        if (bottom > 0) mctx.fillRect(0, top + sourceHeight, width, bottom);
        if (left > 0) mctx.fillRect(0, top, left, sourceHeight);
        if (right > 0) mctx.fillRect(left + sourceWidth, top, right, sourceHeight);

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
                style: "invoke_unicanvas_drag_frame",
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
        if (mode === "draw" || mode === "i2i") {
            return { nodes: [], fallback: `easy_${mode}_reference_builtin` };
        }
        if (mode === "outpaint") {
            try {
                return await this._loadScenarioFile("FL9B_OUTPAIN.json");
            } catch (error) {
                console.warn("[WorkflowRunner] FL9B outpaint template unavailable; using built-in prompt builder.", error);
                return { nodes: [], fallback: "fl9b_outpaint_builtin" };
            }
        }
        return loadEasyWorkflow(mode);
    }

    _patchEasyStandaloneWorkflow(graph, params = {}, assets = {}, mode = "i2i") {
        if (mode === "draw" || mode === "i2i") {
            return this._buildEasyReferenceI2IPrompt(params, assets, mode);
        }
        if (mode === "outpaint") {
            return this._buildEasyFl9bOutpaintPrompt(params, assets);
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
                inputs.unet_name = model;
            }
            if (classType === "CheckpointLoaderSimple" && Object.prototype.hasOwnProperty.call(inputs, "ckpt_name")) {
                inputs.ckpt_name = model;
            }
            if (classType === "VAELoader" && Object.prototype.hasOwnProperty.call(inputs, "vae_name")) {
                inputs.vae_name = vae;
            }
            if (classType === "CLIPLoader") {
                if (Object.prototype.hasOwnProperty.call(inputs, "clip_name")) inputs.clip_name = clip;
                if (clipType && Object.prototype.hasOwnProperty.call(inputs, "type")) inputs.type = clipType;
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

        return { prompt: patched, meta: { seed, steps, cfg, sampler, scheduler, denoise, width, height, mode } };
    }

    _buildEasyReferenceI2IPrompt(params = {}, assets = {}, mode = "i2i") {
        const normalizedMode = "i2i";
        const modeLabel = "Image to Image";
        const subject = "source image";
        const basePrompt = String(params.prompt ?? this._getGlobalPromptText?.() ?? "").trim();
        const promptText = basePrompt
            ? `${basePrompt}. Follow the ${subject} very closely. Preserve composition, silhouette, pose, layout, crop, colors, and main shapes.`
            : `Transform the ${subject} while preserving composition, silhouette, pose, layout, crop, colors, and main shapes.`;
        const negativeText = String(params.negativePrompt ?? this._getGlobalNegativePromptText?.() ?? "");
        const model = String(params.generationModel || params.modelChoice || this.unetModel || "").trim();
        const vae = String(params.vaeModel || this.vaeModel || "").trim();
        const clip = String(params.clipModel || this.clip1Model || "").trim();
        const clipType = String(params.clipType || this.clipType || "flux2").trim();
        const sampler = String(params.sampler || this.sampler || "res_2s").trim();
        const steps = Math.max(1, Math.round(Number(params.steps ?? this.steps ?? 8) || 8));
        const cfg = Number(params.cfg ?? this.cfg ?? 1) || 1;
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
        if (!sourceImage) throw new Error(`Easy ${modeLabel}: ${subject} is missing.`);

        const prompt = {};
        let nextId = 1;
        const id = () => String(nextId++);

        const idModel = id();
        prompt[idModel] = {
            class_type: "UNETLoader",
            inputs: { unet_name: model, weight_dtype: "default" },
        };
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
        const idResize = id();
        prompt[idResize] = {
            class_type: "ImageResizeKJv2",
            inputs: {
                image: [idLoad, 0],
                width,
                height,
                upscale_method: "lanczos",
                keep_proportion: "stretch",
                pad_color: "0, 0, 0",
                crop_position: "center",
                divisible_by: 2,
                device: "cpu",
            },
        };
        const idEncode = id();
        prompt[idEncode] = {
            class_type: "VAEEncode",
            inputs: { pixels: [idResize, 0], vae: [idVae, 0] },
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
        prompt[idSigmas] = { class_type: "Flux2Scheduler", inputs: { steps, width, height } };
        const idLatent = id();
        prompt[idLatent] = {
            class_type: "EmptyFlux2LatentImage",
            inputs: { width, height, batch_size: 1 },
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
                scheduler: "flux2",
                denoise: "reference",
                width,
                height,
                mode: normalizedMode,
                workflow: `easy_${normalizedMode}_reference_builtin`,
            },
        };
    }

    _buildEasyFl9bOutpaintPrompt(params = {}, assets = {}) {
        const promptText = String(params.prompt ?? this._getGlobalPromptText?.() ?? "").trim()
            || "Fill in the black space to complete this image, maintaining the look and overall style of the image.";
        const negativeText = String(params.negativePrompt ?? this._getGlobalNegativePromptText?.() ?? "");
        const model = String(params.generationModel || params.modelChoice || this.unetModel || "").trim();
        const vae = String(params.vaeModel || this.vaeModel || "").trim();
        const clip = String(params.clipModel || this.clip1Model || "").trim();
        const clipType = String(params.clipType || this.clipType || "flux2").trim();
        const sampler = String(params.fl9bSampler || "res_2s").trim();
        const steps = Math.max(1, Math.round(Number(params.steps ?? this.steps ?? 8) || 8));
        const cfg = Number(params.cfg ?? this.cfg ?? 1) || 1;
        const rawSeed = Number(params.seed ?? this.seed);
        const seed = Number.isFinite(rawSeed) && rawSeed >= 0
            ? Math.floor(rawSeed)
            : Math.floor(Math.random() * 1125899906842624);
        const width = Math.max(64, Math.round(Number(params.width ?? this.easyCanvasWidth ?? this.canvasWidth) || 1024));
        const height = Math.max(64, Math.round(Number(params.height ?? this.easyCanvasHeight ?? this.canvasHeight) || 1024));
        const outpaint = params.outpaint || {};
        const left = Math.max(0, Math.round(Number(outpaint.left) || 0));
        const top = Math.max(0, Math.round(Number(outpaint.top) || 0));
        const right = Math.max(0, Math.round(Number(outpaint.right) || 0));
        const bottom = Math.max(0, Math.round(Number(outpaint.bottom) || 0));
        const sourceImage = this._easyAssetLoadImageValue(assets.source);

        if (!model) throw new Error("Easy FL9B outpaint: choose an installed Flux/Klein model in Settings.");
        if (!vae) throw new Error("Easy FL9B outpaint: choose an installed VAE in Settings.");
        if (!clip) throw new Error("Easy FL9B outpaint: choose an installed CLIP/text encoder in Settings.");
        if (!sourceImage) throw new Error("Easy FL9B outpaint: source image is missing.");

        const prompt = {};
        let nextId = 1;
        const id = () => String(nextId++);

        const idModel = id();
        prompt[idModel] = {
            class_type: "UNETLoader",
            inputs: { unet_name: model, weight_dtype: "default" },
        };
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
            inputs: { model: [modelOut, 0], shift: Number(params.fl9bShift ?? this.auraFlowShift ?? 7) || 7 },
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
        const idPad = id();
        prompt[idPad] = {
            class_type: "ImagePadKJ",
            inputs: {
                image: [idLoad, 0],
                left,
                right,
                top,
                bottom,
                extra_padding: 0,
                pad_mode: "color",
                color: "0, 0, 0",
            },
        };
        const idResize = id();
        prompt[idResize] = {
            class_type: "ImageResizeKJv2",
            inputs: {
                image: [idPad, 0],
                width,
                height,
                upscale_method: "nearest-exact",
                keep_proportion: "resize",
                pad_color: "0, 0, 0",
                crop_position: "center",
                divisible_by: 2,
                device: "cpu",
            },
        };
        const idEncode = id();
        prompt[idEncode] = {
            class_type: "VAEEncode",
            inputs: { pixels: [idResize, 0], vae: [idVae, 0] },
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
        prompt[idSigmas] = { class_type: "Flux2Scheduler", inputs: { steps, width, height } };
        const idLatent = id();
        prompt[idLatent] = {
            class_type: "EmptyFlux2LatentImage",
            inputs: { width, height, batch_size: 1 },
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
            inputs: { images: [idDecode, 0], filename_prefix: `${EASY_OUTPUT_PREFIX}/goyai_easy_outpaint` },
        };

        return {
            prompt,
            meta: {
                seed,
                steps,
                cfg,
                sampler,
                scheduler: "flux2",
                denoise: 1,
                width,
                height,
                mode: "outpaint",
                workflow: "FL9B_OUTPAIN.json",
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

    async _findLatestEasyGalleryResult(mode = "easy") {
        const response = await fetch(`${Constants.EASY_API_BASE || "/iamccs/goyai_easy"}/gallery/list`, { cache: "no-store" });
        if (!response?.ok) return null;
        const data = await response.json().catch(() => ({}));
        const prefix = this._easyModeOutputPrefix(mode);
        const item = (Array.isArray(data?.items) ? data.items : []).find((entry) => {
            const name = String(entry?.name || entry?.file || "").split(/[\\/]/).pop();
            return name.startsWith(prefix);
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
        this.eventBus.emit("workflow:image", { url, images, promptId, mode });
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
        const timeoutMs = Math.max(60 * 1000, Number(options.timeoutMs ?? 30 * 60 * 1000) || 30 * 60 * 1000);
        const timeoutAt = Date.now() + timeoutMs;
        let lastStatus = "";
        this.eventBus.emit("workflow:phase", { index: 3, count: 4, phase: "Waiting for result", phaseProgress: 50 });
        this._emitEasyHistoryProgress(null, 15);

        while (Date.now() < timeoutAt) {
            if (!this._easyResultPollIsCurrent(serial)) return [];
            try {
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
                        this._emitEasyHistoryProgress(entry, 35);
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
                            const galleryResult = await this._findLatestEasyGalleryResult(mode).catch(() => null);
                            if (galleryResult && this._easyResultPollIsCurrent(serial)) {
                                this._emitEasyFinalResult({ ...galleryResult, promptId: id, mode });
                                return galleryResult.images || [];
                            }
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
        const galleryResult = await this._findLatestEasyGalleryResult(mode).catch(() => null);
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
                const prepared = await this._prepareEasyOutpaintGeometry(sourceImageDataUrl, params.outpaintPadding || params.outpaint || {});
                executionParams = {
                    ...executionParams,
                    width: prepared.width,
                    height: prepared.height,
                    outpaint: prepared.outpaint,
                };
            }
            const sourceAsset = await this._saveEasyStandaloneAsset(sourceImageDataUrl, `goyai_easy_${mode}_source`, {
                gallery: true,
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
            if (mode === "inpaint") {
                maskImageDataUrl = String(params.maskImageDataUrl || "");
                if (!maskImageDataUrl.startsWith("data:image/")) {
                    throw new Error("Easy inpaint: paint a mask before generating.");
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
                this._awaitEasyPromptResult(eventPayload.prompt_id, mode, { serial: pollSerial }).catch((error) => {
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

    // Scenario Z (TXT2IMG via Z-Image) — per DOCUMENTO 6 architecture

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
        if (type === "UNETLoader") {
            return {
                unet_name: String(params.generationModel || params.modelChoice || this.unetModel || ""),
                weight_dtype: String(values[1] || "default"),
            };
        }
        if (type === "CLIPLoader") {
            return {
                clip_name: String(params.clipModel || this.clip1Model || ""),
                type: String(values[1] || params.clipType || this.clipType || "lumina2"),
                device: String(values[2] || "default"),
            };
        }
        if (type === "CLIPTextEncode") {
            return { text: String(values[0] || params.prompt || this._getGlobalPromptText?.() || "") };
        }
        if (type === "EmptySD3LatentImage" || type === "EmptyLatentImage") {
            const dims = this.getGenerationDimensions?.() || {};
            return {
                width: Math.max(64, Math.round(Number(values[0] || params.width || dims.width || this.easyCanvasWidth || 1024))),
                height: Math.max(64, Math.round(Number(values[1] || params.height || dims.height || this.easyCanvasHeight || 1024))),
                batch_size: Math.max(1, Math.round(Number(values[2] || params.batchSize || this.zBatchSize || 1))),
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
        if (type === "ModelSamplingAuraFlow") {
            return { shift: Number(values[0] ?? this.auraFlowShift ?? 3) || 3 };
        }
        return {};
    }

    _compileUiWorkflowToApiPrompt(workflow, params = {}) {
        const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
        const links = Array.isArray(workflow?.links) ? workflow.links : [];
        const linkById = new Map();
        for (const link of links) {
            if (Array.isArray(link) && link.length >= 5) {
                linkById.set(Number(link[0]), link);
            }
        }

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
                const originNodeId = String(link[1]);
                const originSlot = Number(link[2]) || 0;
                inputs[String(input.name)] = [originNodeId, originSlot];
            }
            prompt[String(node.id)] = {
                class_type: String(node.type),
                inputs,
            };
        }
        return prompt;
    }

    _isDecorativeUiWorkflowNode(node) {
        const type = String(node?.type || node?.class_type || '').trim().toLowerCase();
        if (!type) return false;
        return type === 'label (rgthree)' || type === 'note' || type === 'note (rgthree)' || type === 'getnode';
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
            const queued = await this._queueEasyPrompt(prompt, {
                intentMode: "t2i",
                scenarioKey: "easy-z",
                templateKey: "z",
                extra: {
                    scenario_override: "easy-z",
                    engine: "easy",
                    easy_standalone: true,
                    workflow: "SCENARIO_Z.json",
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
            const queued = await this._queueEasyPrompt(prompt, {
                intentMode: "upscale",
                scenarioKey: "easy-upscale",
                templateKey: "upscale",
                extra: {
                    scenario_override: "easy-upscale",
                    engine: "easy",
                    easy_standalone: true,
                    workflow: "SCENARIO_SEEDVR2.json",
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

    // Construct a minimal ComfyUI prompt (JSON) for Scenario Z
    _buildScenarioZPrompt(params = {}) {
        const _gd = this.getGenerationDimensions();
        const width = Number.isFinite(params.width) ? params.width : _gd.width;
        const height = Number.isFinite(params.height) ? params.height : _gd.height;
        const seed = Number.isFinite(params.seed) ? params.seed : this.seed;
        const steps = Number.isFinite(params.steps) ? params.steps : this.steps;
        const cfg = Number.isFinite(params.cfg) ? params.cfg : this.cfg;
        const sampler = params.sampler || this.sampler;
        const scheduler = params.scheduler || this.scheduler;
        const unet = params.unet || this.unetModel;
        const vae = params.vae || this.vaeModel;
        const clip = params.clip || this.clip1Model;
        const promptText = params.prompt ?? this._getGlobalPromptText();
        const auraShift = Number.isFinite(this.auraFlowShift) ? this.auraFlowShift : 3;

        // Node IDs as strings (ComfyUI accepts keyed dict)
        const P = {
            "1": { "class_type": "UNETLoader", "inputs": { "unet_name": unet, "weight_dtype": "default" } },
            "2": { "class_type": "ModelSamplingAuraFlow", "inputs": { "model": ["1", 0], "shift": auraShift } },
            "3": { "class_type": "CLIPLoader", "inputs": { "clip_name": clip, "type": "lumina2", "weight_dtype": "default" } },
            "4": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["3", 0], "text": promptText } },
            "5": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["4", 0] } },
            "6": { "class_type": "VAELoader", "inputs": { "vae_name": vae } },
            "7": { "class_type": "EmptySD3LatentImage", "inputs": { "width": width, "height": height, "batch_size": 1 } },
            "8": { "class_type": "KSampler", "inputs": {
                "model": ["2", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["7", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1.0
            }},
            "9": { "class_type": "VAEDecode", "inputs": { "samples": ["8", 0], "vae": ["6", 0] } },
        };

        // Optional FlashVSR upscale between VAEDecode and outputs
        let lastImageNode = "9";
        if (this.zUpscaleEnabled) {
            const flashId = "10";
            P[flashId] = {
                class_type: "FlashVSRNode",
                inputs: {
                    frames: ["9", 0],
                    model: this.zFlashModel || "FlashVSR-v1.1",
                    mode: this.zFlashMode || "tiny",
                    scale: this.zFlashScale || 2,
                    tiled_vae: !!this.zFlashTiledVae,
                    tiled_dit: !!this.zFlashTiledDit,
                    unload_dit: !!this.zFlashUnloadDit,
                    seed: Number.isFinite(this.zFlashSeed) ? this.zFlashSeed : 0,
                    seed_mode: this.zFlashSeedMode || "randomize",
                }
            };
            lastImageNode = flashId;
        }

        // Preview + Save from last image node
        const prevId = this.zUpscaleEnabled ? "11" : "10";
        const saveId = this.zUpscaleEnabled ? "12" : "11";
        P[prevId] = { class_type: "PreviewImage", inputs: { images: [lastImageNode, 0] } };
        P[saveId] = { class_type: "SaveImage", inputs: { images: [lastImageNode, 0], filename_prefix: "z-image" } };

        return P;
    }

    _startPythonCompletionWatch({ baselineTimestamp = 0, expectedScenario = "" } = {}) {
        const token = ++this._completionWatchToken;
        const startedAt = Date.now();
        const timeoutMs = 10 * 60 * 1000;
        const pollEveryMs = 900;

        const normalizeScenario = (s) => {
            try {
                const x = String(s || "").toLowerCase();
                if (!x) return "";
                if (x.startsWith("scenario_")) return x.replace("scenario_", "");
                return x;
            } catch (_e) {
                return "";
            }
        };

        const expected = normalizeScenario(expectedScenario);
        const expectedKnown = !!expected && expected !== "auto";

        const poll = async () => {
            if (token !== this._completionWatchToken) return;
                if (Date.now() - startedAt > timeoutMs) {
                    try { this.eventBus.emit("workflow:error", { error: "Timed out waiting for backend completion" }); } catch (_e) {}
                    return;
                }
            try {
                const data = await this.bridge.pullLastGeneration();
                const ts = Number(data?.ts || 0) || 0;
                const legacyTimestamp = Number(data?.timestamp || 0) || 0;
                const st = String(data?.status || "").toLowerCase();
                const scen = normalizeScenario(data?.scenario);
                const outName = String(data?.metadata?.output_file || "");

                const scenarioOk = expectedKnown ? scen === expected : true;
                const doneByFile = !!outName;
                const doneByStatus = st === "complete";
                const currentMarker = ts || legacyTimestamp;
                const tsOk = baselineTimestamp ? (currentMarker && currentMarker !== baselineTimestamp) : true;
                const completionOk = st === "error"
                    ? tsOk
                    : (doneByFile || doneByStatus ? (doneByFile ? true : tsOk) : false);

                if (scenarioOk && completionOk) {
                    if (st === "error") {
                        try { this.eventBus.emit("workflow:error", { error: "backend status=error", data }); } catch (_e) {}
                        return;
                    }
                    try { this.eventBus.emit("workflow:finished", { data }); } catch (_e) {}
                    try { this.eventBus.emit("workflow:complete", { data }); } catch (_e) {}
                    try {
                        if (outName) {
                            const url = `${Constants.API_BASE}/gallery/get?name=${encodeURIComponent(outName)}&t=${Date.now()}`;
                            this.eventBus.emit("workflow:final", { name: outName, url, data });
                        }
                    } catch (_e) {}
                    return;
                }
            } catch (_e) {}
            setTimeout(poll, pollEveryMs);
        };

        setTimeout(poll, pollEveryMs);
    }

    _isDirectExecuteRequest(params = {}) {
        return params?.directExecute === true
            || params?.isolatedExecution === true
            || params?.source === "simulacra"
            || params?.source === "easy";
    }

    _extractLastGenerationOutput(lastGeneration = {}) {
        const metadata = lastGeneration?.metadata || {};
        return String(
            metadata.output_file
            || metadata.outputFile
            || lastGeneration?.output_file
            || lastGeneration?.outputFile
            || ""
        );
    }

    async _executePayloadDirect(payload, options = {}) {
        const source = String(payload?.extra?.source || payload?.source || options?.source || "direct");
        try {
            await this.bridge.pushState(payload, { immediate: true });
        } catch (_e) {}

        this.eventBus.emit("workflow:started", { payload, source, direct: true });
        const response = await fetch(`${Constants.API_BASE}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {}),
        });
        const text = await response.text().catch(() => "");
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_e) {}

        if (!response.ok || data?.ok === false) {
            const restartHint = response.status === 404
                ? "Direct execute endpoint is unavailable. Restart ComfyUI so /iamccs/goyacanvas/execute is registered."
                : "";
            throw new Error(data?.error || text || restartHint || `Direct execute failed (${response.status})`);
        }

        const lastGeneration = data?.last_generation || await this.bridge.pullLastGeneration();
        const outName = this._extractLastGenerationOutput(lastGeneration);
        const url = outName ? `${Constants.API_BASE}/gallery/get?name=${encodeURIComponent(outName)}&t=${Date.now()}` : "";
        const finalPayload = {
            name: outName,
            url,
            data: lastGeneration,
            source,
            direct: true,
            expectedScenario: options?.expectedScenario || "",
        };
        this.eventBus.emit("workflow:finished", finalPayload);
        this.eventBus.emit("workflow:complete", finalPayload);
        if (url) {
            this.eventBus.emit("workflow:final", finalPayload);
        }
        return data || { ok: true, last_generation: lastGeneration };
    }

    async executeDirectFromCurrentState(params = {}) {
        const scenario = String(params.scenarioKey || params.scenario || this.getActiveScenario?.() || "").trim();
        const normalizedScenario = scenario || "z";
        const engine = String(
            params.engine
            || (normalizedScenario === "1c" || normalizedScenario.startsWith("fl2") ? "flux" : "")
            || (normalizedScenario.startsWith("z") ? "z" : "")
            || this.engine
            || "z"
        );
        const payload = this.buildPayload({ extra: { scenario_override: normalizedScenario, engine } });
        this._applyExplicitGenerationParams(payload, params, normalizedScenario);
        payload.extra = {
            ...(payload.extra || {}),
            scenario_override: normalizedScenario,
            engine,
            source: params.source || payload.extra?.source || "direct",
            prompt_source: params.source || payload.extra?.prompt_source || "direct",
            direct_execute: true,
            isolated_execution: true,
        };
        if (params.generationContract) {
            payload.extra.generation_contract = String(params.generationContract);
        }
        if (params.image || params.sourceImage) {
            payload.extra.source_image = String(params.image || params.sourceImage);
        }
        if (Number.isFinite(Number(params.resolution))) {
            payload.extra.resolution = Number(params.resolution);
        }
        try {
            return await this._executePayloadDirect(payload, { expectedScenario: normalizedScenario, source: payload.extra.source });
        } catch (err) {
            this.eventBus.emit("workflow:error", { error: String(err), source: params?.source || "direct" });
            throw err;
        }
    }

    async executeScenarioZ(params = {}) {
        // Python-only: push state and let backend handle generation
        try {
            let baselineTs = 0;
            try {
                const base = await this.bridge.pullLastGeneration();
                    baselineTs = Number(base?.ts || base?.timestamp || 0) || 0;
            } catch (_e) {}
            const payloadZ = this.buildPayload({ extra: { scenario_override: "z", engine: "z" } });
            this._applyExplicitGenerationParams(payloadZ, params, "z");
            payloadZ.extra.scenario_override = "z";
            payloadZ.extra.engine = "z";
            if (this._isDirectExecuteRequest(params)) {
                payloadZ.extra.direct_execute = true;
                payloadZ.extra.isolated_execution = true;
                await this._executePayloadDirect(payloadZ, { expectedScenario: "z", source: params?.source || "direct" });
                return true;
            }
            try { await this.bridge.pushState(payloadZ, { immediate: true }); } catch (_e) {}
            this.eventBus.emit("workflow:started", { payload: payloadZ, source: params?.source || "workflow" });
            this.eventBus.emit("workflow:queued", { ...payloadZ, directRender: false, source: params?.source || "workflow" });
            this._startPythonCompletionWatch({ baselineTimestamp: baselineTs, expectedScenario: "z" });
            return true;
        } catch (err) {
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

    _applyExplicitGenerationParams(payload, params = {}, scenarioKey = "") {
        if (!payload || !params || typeof params !== "object") return payload;
        const prompt = String(
            params.prompt
            || params.positive
            || params.positivePrompt
            || params.globalPositive
            || ""
        ).trim();
        const negative = String(
            params.negative
            || params.negativePrompt
            || params.negative_prompt
            || ""
        );
        if (prompt) {
            payload.positive = prompt;
            payload.prompt = prompt;
            payload.positive_prompt = prompt;
            payload.globalPositive = prompt;
            payload.global = {
                ...(payload.global || {}),
                positive: prompt,
            };
            if (this.promptManager?.globalPrompt) {
                this.promptManager.globalPrompt.positive = prompt;
            }
        }
        if (negative || Object.prototype.hasOwnProperty.call(params, "negative")) {
            payload.negative = negative;
            payload.negative_prompt = negative;
            payload.global = {
                ...(payload.global || {}),
                negative,
            };
            if (this.promptManager?.globalPrompt) {
                this.promptManager.globalPrompt.negative = negative;
            }
        }
        const width = Number(params.width || params.canvasWidth || 0);
        const height = Number(params.height || params.canvasHeight || 0);
        if (Number.isFinite(width) && width > 0) payload.width = Math.round(width);
        if (Number.isFinite(height) && height > 0) payload.height = Math.round(height);
        const seed = Number(params.seed);
        if (Number.isFinite(seed)) {
            payload.seed = Math.round(seed);
            if (payload.extra) payload.extra.seed = Math.round(seed);
        }
        payload.extra = {
            ...(payload.extra || {}),
            scenario_override: scenarioKey || payload.extra?.scenario_override || payload.scenario,
            engine: params.engine || payload.extra?.engine || "z",
            source: params.source || payload.extra?.source || "workflow",
            prompt_source: params.source || payload.extra?.prompt_source || "workflow",
            simulacra_generation_contract: params.source === "simulacra" ? "explicit_v1" : (payload.extra?.simulacra_generation_contract || ""),
        };
        if (params.templateKey) payload.extra.template_key = String(params.templateKey);
        if (params.generationContract) payload.extra.generation_contract = String(params.generationContract);
        if (params.workflowContract) payload.extra.workflow_contract = String(params.workflowContract);
        const generationModel = params.generationModel || params.modelChoice || params.unetModel || params.model || '';
        if (generationModel) payload.extra.unet_model_override = String(generationModel);
        if (params.vaeModel) payload.extra.vae_model_override = String(params.vaeModel);
        if (params.clipModel) payload.extra.clip1_model_override = String(params.clipModel);
        if (params.clipType) payload.extra.clip_type = String(params.clipType);
        if (params.sampler) {
            payload.sampler = String(params.sampler);
            payload.extra.sampler_name = String(params.sampler);
        }
        if (params.scheduler) {
            payload.scheduler = String(params.scheduler);
            payload.extra.scheduler = String(params.scheduler);
        }
        if (params.intentMode) payload.extra.intent_mode = String(params.intentMode);
        return payload;
    }

    async executeScenarioZ2(params = {}) {
        // Python-only: push state and let backend handle generation
        try {
            let baselineTs = 0;
            try {
                const base = await this.bridge.pullLastGeneration();
                    baselineTs = Number(base?.ts || base?.timestamp || 0) || 0;
            } catch (_e) {}
            console.warn("[DISPATCHER] ═══ executeScenarioZ2 CALLED ═══");
            console.log("[DISPATCHER] executeScenarioZ2: Setting activePanel=z2, engine=z");
            console.log("[DISPATCHER] executeScenarioZ2: Current state:", {
                z2QwenModel: this.z2QwenModel,
                z2SecondaryPrompt: this.z2SecondaryPrompt,
                k1: {
                    seed: this.z2K1Seed,
                    steps: this.z2K1Steps,
                    cfg: this.z2K1Cfg,
                    sampler: this.z2K1Sampler,
                    scheduler: this.z2K1Scheduler
                },
                k2: {
                    seed: this.z2K2Seed,
                    steps: this.z2K2Steps,
                    cfg: this.z2K2Cfg,
                    sampler: this.z2K2Sampler,
                    scheduler: this.z2K2Scheduler
                }
            });
            this.activePanel = "z2";
            this.engine = "z"; // Ensure engine is set for model loading
            
            const resolvedZ2 = this._collectZ2Settings({ resolveSeeds: true });
            const payloadZ2 = this.buildPayload({ extra: { scenario_override: "z2", engine: "z" } });
            Object.assign(payloadZ2.extra, resolvedZ2);
            if (Number.isFinite(resolvedZ2.seed)) {
                payloadZ2.seed = resolvedZ2.seed;
                payloadZ2.extra.seed = resolvedZ2.seed;
            }
            if (Number.isFinite(resolvedZ2.cfg_1st)) {
                payloadZ2.cfg = resolvedZ2.cfg_1st;
                payloadZ2.extra.cfg = resolvedZ2.cfg_1st;
            }
            if (Number.isFinite(resolvedZ2.steps_1st)) {
                payloadZ2.steps = resolvedZ2.steps_1st;
            }
            if (resolvedZ2.sampler_name) {
                payloadZ2.sampler = resolvedZ2.sampler_name;
            }
            if (resolvedZ2.scheduler) {
                payloadZ2.scheduler = resolvedZ2.scheduler;
            }

            // Source image and resolution master from params (optional)
            this._applyExplicitGenerationParams(payloadZ2, params, "z2");
            payloadZ2.extra.scenario_override = "z2";
            payloadZ2.extra.engine = "z";
            if (params && params.image) payloadZ2.extra.source_image = params.image;
            if (params && Number.isFinite(params.resolution)) payloadZ2.extra.resolution = params.resolution;

            console.log("[DISPATCHER] Z2 payload with Qwen-VL:", {
                scenario: payloadZ2.extra.scenario_override,
                seed: payloadZ2.seed,
                seedMode: resolvedZ2.seed_1st_mode,
                seed_2nd: resolvedZ2.seed_2nd,
                seedMode2: resolvedZ2.seed_2nd_mode,
                qwen_model: payloadZ2.extra.qwen_model,
                qwen_quant: payloadZ2.extra.qwen_quantization,
                samplers: `${payloadZ2.extra.sampler_name} → ${payloadZ2.extra.sampler_2nd}`,
                schedulers: `${payloadZ2.extra.scheduler} → ${payloadZ2.extra.scheduler_2nd}`,
                steps: `${payloadZ2.extra.steps_1st}+${payloadZ2.extra.steps_2nd}`,
                cfg: `${payloadZ2.extra.cfg_1st ?? payloadZ2.extra.cfg}/${payloadZ2.extra.cfg_2nd ?? payloadZ2.extra.cfg}`,
                denoise: `${payloadZ2.extra.denoise_1}/${payloadZ2.extra.denoise_2}`,
                aura_shift: payloadZ2.extra.aura_shift
            });

            if (this._isDirectExecuteRequest(params)) {
                payloadZ2.extra.direct_execute = true;
                payloadZ2.extra.isolated_execution = true;
                await this._executePayloadDirect(payloadZ2, { expectedScenario: "z2", source: params?.source || "direct" });
                return true;
            }
            
            try { await this.bridge.pushState(payloadZ2, { immediate: true }); } catch (_e) {}
            this.eventBus.emit("workflow:started", { payload: payloadZ2 });
            this.eventBus.emit("workflow:queued", { ...payloadZ2, directRender: false });
            this._startPythonCompletionWatch({ baselineTimestamp: baselineTs, expectedScenario: "z2" });
            // Mid-run preview polling: update Global Prompt as soon as backend writes prompt_preview
            // Poll up to ~120 seconds; stop after first success
            let _z2PreviewPolled = false;
            let _z2PreviewPollingStopped = false;
            let attempts = 0;
            const maxAttempts = 120;
            const stopPolling = () => {
                _z2PreviewPollingStopped = true;
            };
            const onFinal = () => stopPolling();
            const onError = () => stopPolling();
            try { this.eventBus.on("workflow:final", onFinal); } catch (_e) {}
            try { this.eventBus.on("workflow:error", onError); } catch (_e) {}
            const poll = async () => {
                if (_z2PreviewPollingStopped || _z2PreviewPolled || attempts >= maxAttempts) {
                    try { this.eventBus.off?.("workflow:final", onFinal); } catch (_e) {}
                    try { this.eventBus.off?.("workflow:error", onError); } catch (_e) {}
                    return;
                }
                attempts += 1;
                try {
                    const data = await this.bridge.pullLastGeneration();
                    const preview = data?.prompt_preview || data?.metadata?.prompt_preview || "";
                    if (typeof preview === "string" && preview.trim().length > 0) {
                        _z2PreviewPolled = true;
                        console.log("[Z2] Mid-run prompt_preview detected (chars)", preview.length);
                        this._emitZ2PromptPreview(preview, { force: true });
                        try { this.eventBus.off?.("workflow:final", onFinal); } catch (_e) {}
                        try { this.eventBus.off?.("workflow:error", onError); } catch (_e) {}
                        return;
                    }
                } catch (_e) {}
                setTimeout(poll, 1000);
            };
            setTimeout(poll, 1000);
            return true;
        } catch (err) {
            console.error("[DISPATCHER] executeScenarioZ2 error:", err);
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

    // Scenario 1C (Flux txt2img) prompt builder with optional FlashVSR
    _buildScenario1CPrompt(params = {}) {
        const _gd = this.getGenerationDimensions();
        const width = Number.isFinite(params.width) ? params.width : _gd.width;
        const height = Number.isFinite(params.height) ? params.height : _gd.height;
        const seed = Number.isFinite(params.seed) ? params.seed : this.seed;
        const steps = Number.isFinite(params.steps) ? params.steps : this.steps;
        const cfg = Number.isFinite(params.cfg) ? params.cfg : this.cfg;
        const sampler = params.sampler || this.sampler || "euler";
        const scheduler = params.scheduler || this.scheduler || "beta";
        const unet = params.unet || this.unetModel || "";
        const vae = params.vae || this.vaeModel || "";
        const clip1 = params.clip1 || this.clip1Model || "";
        const clip2 = params.clip2 || this.clip2Model || "";
        const useClip2 = !!this.clip2Enabled;
        const promptText = params.prompt ?? this._getGlobalPromptText();
        const negativeText = params.negative ?? this._getGlobalNegativePromptText();
        const maxShift = Number.isFinite(this.fluxMaxShift) ? this.fluxMaxShift : 1.15;
        const baseShift = Number.isFinite(this.fluxBaseShift) ? this.fluxBaseShift : 0.5;

        const P = {};
        // 1. Load UNET (GGUF)
        P["1"] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: unet } };

        // 1.a Optional LoRA chain (up to 3) -> rawModelOut preserved
        let rawModelOut = "1";
        let nextId = 2;
        const addLoRA = (name, strength) => {
            const id = String(nextId++);
            P[id] = {
                class_type: "LoraLoaderModelOnly",
                inputs: { model: [rawModelOut, 0], lora_name: String(name), strength_model: Number(strength) }
            };
            rawModelOut = id;
        };
        if (this.lora1Enabled && this.lora1Model) addLoRA(this.lora1Model, this.lora1Strength ?? 1.0);
        if (this.lora2Enabled && this.lora2Model) addLoRA(this.lora2Model, this.lora2Strength ?? 1.0);
        if (this.lora3Enabled && this.lora3Model) addLoRA(this.lora3Model, this.lora3Strength ?? 1.0);

        // 2. Optional model accelerator (Sage Attention) patch
        if (this.acceleratorEnabled) {
            const idPatch = String(nextId++);
            P[idPatch] = { class_type: "goya_sage", inputs: { model: [rawModelOut, 0], sage_attention: "auto" } };
            rawModelOut = idPatch;
        }

        // 2.b Optional FP16 accumulation patch
        if (this.fp16AccumulationEnabled) {
            const idPatchFp16 = String(nextId++);
            P[idPatchFp16] = { class_type: "fp16_goya", inputs: { model: [rawModelOut, 0], enable_fp16_accumulation: true } };
            rawModelOut = idPatchFp16;
        }

        // 3. Flux sampler model wrapper applied to raw LoRA result (sampling branch)
        const idSampling = String(nextId++); // ModelSamplingFlux
        P[idSampling] = { class_type: "ModelSamplingFlux", inputs: { model: [rawModelOut, 0], max_shift: maxShift, base_shift: baseShift, width, height } };

        // 3. BasicScheduler for Flux
        const idSched = String(nextId++);
        P[idSched] = { class_type: "BasicScheduler", inputs: { model: [idSampling, 0], scheduler, steps, denoise: 1.0 } };

        // 4. RandomNoise (seed)
        const idNoise = String(nextId++);
        const noise_seed = (Number.isFinite(seed) && seed >= 0) ? seed : Math.floor(Math.random()*2**31);
        P[idNoise] = { class_type: "RandomNoise", inputs: { noise_seed } };

        // 5. KSamplerSelect
        const idKS = String(nextId++);
        P[idKS] = { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } };

        // 6. DualCLIPLoader (Flux)
        const idCLIP = String(nextId++);
        P[idCLIP] = { class_type: "DualCLIPLoader", inputs: { clip_name1: clip2, clip_name2: clip1, type: "flux", device: "default" } };

        // 7. CLIPTextEncode (positive)
        const idTE = String(nextId++);
        P[idTE] = { class_type: "CLIPTextEncode", inputs: { clip: [idCLIP, 0], text: promptText } };

        // 8. FluxGuidance (positive)
        const idGuidancePos = String(nextId++);
        const guidance = Number.isFinite(params.global_guidance) ? params.global_guidance : this.globalGuidance;
        P[idGuidancePos] = { class_type: "FluxGuidance", inputs: { conditioning: [idTE, 0], guidance } };

        // 8.b Negative (optional) -> encode only if non-empty
        let idNegEncode = null;
        if (negativeText && negativeText.trim().length) {
            idNegEncode = String(nextId++);
            P[idNegEncode] = { class_type: "CLIPTextEncode", inputs: { clip: [idCLIP, 0], text: negativeText } };
        }

        // 9. BasicGuider
        const idGuider = String(nextId++);
        // IMPORTANT: guider usa il modello raw con LoRA, NON il sampling wrapper
        P[idGuider] = { class_type: "BasicGuider", inputs: { model: [rawModelOut, 0], conditioning: [idGuidancePos, 0] } };

        // 10. EmptySD3LatentImage
        const idLatent = String(nextId++);
        const batch_size = Number.isFinite(this.txt2imgBatch) ? this.txt2imgBatch : 1;
        P[idLatent] = { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size } };

        // 11. SamplerCustomAdvanced
        const idSCA = String(nextId++);
        P[idSCA] = { class_type: "SamplerCustomAdvanced", inputs: { noise: [idNoise, 0], guider: [idGuider, 0], sampler: [idKS, 0], sigmas: [idSched, 0], latent_image: [idLatent, 0] } };

        // 12. VAELoader
        const idVAE = String(nextId++);
        P[idVAE] = { class_type: "VAELoader", inputs: { vae_name: vae } };

        // 13. VAEDecode
        const idDecode = String(nextId++);
        P[idDecode] = { class_type: "VAEDecode", inputs: { samples: [idSCA, 0], vae: [idVAE, 0] } };

        // Optional FlashVSR between VAEDecode and outputs
        let lastImageNode = idDecode;
        if (this.s1cUpscaleEnabled) {
            const idFlash = String(nextId++);
            P[idFlash] = {
                class_type: "FlashVSRNode",
                inputs: {
                    frames: [idDecode, 0],
                    model: this.s1cFlashModel || "FlashVSR-v1.1",
                    mode: this.s1cFlashMode || "tiny",
                    scale: this.s1cFlashScale || 2,
                    tiled_vae: !!this.s1cFlashTiledVae,
                    tiled_dit: !!this.s1cFlashTiledDit,
                    unload_dit: !!this.s1cFlashUnloadDit,
                    seed: Number.isFinite(this.s1cFlashSeed) ? this.s1cFlashSeed : 0,
                    seed_mode: this.s1cFlashSeedMode || "randomize",
                }
            };
            lastImageNode = idFlash;
        }

        // Preview + Save
        const idPrev = String(nextId++);
        const idSave = String(nextId++);
        P[idPrev] = { class_type: "PreviewImage", inputs: { images: [lastImageNode, 0] } };
        P[idSave] = { class_type: "SaveImage", inputs: { images: [lastImageNode, 0], filename_prefix: "flux-1c" } };

        return P;
    }

    async executeScenario1C(params = {}) {
        // Python-only: push state and let backend handle generation
        try {
            const payload1C = this.buildPayload({ extra: { scenario_override: "1c", engine: "flux" } });
            this._applyExplicitGenerationParams(payload1C, params, "1c");
            payload1C.extra.scenario_override = "1c";
            payload1C.extra.engine = "flux";
            if (this._isDirectExecuteRequest(params)) {
                payload1C.extra.direct_execute = true;
                payload1C.extra.isolated_execution = true;
                await this._executePayloadDirect(payload1C, { expectedScenario: "1c", source: params?.source || "direct" });
                return true;
            }
            try { await this.bridge.pushState(payload1C, { immediate: true }); } catch (_e) {}
            this.eventBus.emit("workflow:started", { payload: payload1C });
            this.eventBus.emit("workflow:queued", { ...payload1C, directRender: false });
            return true;
        } catch (err) {
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

    async executeScenarioZ3(params = {}) {
        try {
            console.warn("[DISPATCHER] ═══ executeScenarioZ3 CALLED ═══");
            this.activePanel = "z3";
            this.engine = "z";
            const payloadZ3 = this.buildPayload({ extra: { scenario_override: "z3", engine: "z" } });
            this._applyExplicitGenerationParams(payloadZ3, params, "z3");
            payloadZ3.extra.scenario_override = "z3";
            payloadZ3.extra.engine = "z";
            // Gather Z3 UI params (if present), else defaults
            const extra = payloadZ3.extra;
            extra.qwen_vl_enabled = this.qwenEnabled !== false;
            extra.qwen_model = this.z2QwenModel || "Qwen3-VL-4B-Instruct";
            extra.qwen_quantization = this.z2QwenQuant || "4-bit (VRAM-friendly)";
            extra.qwen_preset_prompt = this.z2QwenPreset || "🖼️ Detailed Description";
            extra.qwen_custom_prompt = this.z2QwenCustomPrompt || "";
            extra.qwen_keep_loaded = this.z2QwenKeepLoaded !== false;
            extra.qwen_max_tokens = Math.max(128, Math.min(4096, this._toInt(this.z2QwenMaxTokens, 1024)));
            extra.secondary_prompt = this.z2SecondaryPrompt || "";
            // ControlNet
            extra.controlnet_preprocessor_type = this.z3PreprocessorType || "depth";
            extra.controlnet_preprocessor_params = this.z3PreprocessorParams || {};
            extra.depth_model_id = this.z3DepthModelId || "PozzettiAndrea/ComfyUI-DepthAnythingV3";
            extra.controlnet_patch_model = (this.z3ControlNetPatchModel || "") + "";
            // Single KSampler
            extra.seed = Number.isFinite(this.z3Seed) ? this.z3Seed : this.seed;
            extra.steps = Number.isFinite(this.z3Steps) ? this.z3Steps : this.steps;
            extra.cfg = Number.isFinite(this.z3Cfg) ? this.z3Cfg : this.cfg;
            extra.sampler_name = (this.z3Sampler || this.sampler || "res_multistep") + "";
            extra.scheduler = (this.z3Scheduler || this.scheduler || "simple") + "";
            extra.denoise = Number.isFinite(this.z3Denoise) ? this.z3Denoise : 1.0;

            console.log("[DISPATCHER] Z3 payload: ", {
                seed: extra.seed, steps: extra.steps, cfg: extra.cfg, sampler: extra.sampler_name, scheduler: extra.scheduler,
                qwen_model: extra.qwen_model, preproc: extra.controlnet_preprocessor_type
            });
            if (this._isDirectExecuteRequest(params)) {
                payloadZ3.extra.direct_execute = true;
                payloadZ3.extra.isolated_execution = true;
                await this._executePayloadDirect(payloadZ3, { expectedScenario: "z3", source: params?.source || "direct" });
                return true;
            }
            try { await this.bridge.pushState(payloadZ3, { immediate: true }); } catch (_e) {}
            this.eventBus.emit("workflow:started", { payload: payloadZ3 });
            this.eventBus.emit("workflow:queued", { ...payloadZ3, directRender: false });
            // Poll last-generation for mid-run previews (prompt + controlnet)
            let done = false;
            let attempts = 0;
            let foundPrompt = false;
            let foundControlnet = false;
            let lastPrompt = "";
            let lastControlnet = "";
            const maxAttempts = 180;
            const poll = async () => {
                if (done || attempts >= maxAttempts) return;
                attempts += 1;
                try {
                    const data = await this.bridge.pullLastGeneration();
                    const promptPreview = data?.prompt_preview || data?.metadata?.prompt_preview || "";
                    const controlnetPreview = data?.controlnet_preview_data_url || data?.metadata?.controlnet_preview_data_url || "";

                    if (typeof promptPreview === "string" && promptPreview.trim().length > 0) {
                        if (promptPreview !== lastPrompt) {
                            lastPrompt = promptPreview;
                            console.log("[Z3] Mid-run prompt_preview detected (chars)", promptPreview.length);
                            this._emitZ2PromptPreview(promptPreview, { force: true });
                        }
                        foundPrompt = true;
                    }

                    if (typeof controlnetPreview === "string" && controlnetPreview.length > 16) {
                        if (controlnetPreview !== lastControlnet) {
                            lastControlnet = controlnetPreview;
                            console.log("[Z3] Mid-run controlnet_preview detected (chars)", controlnetPreview.length);
                            this.eventBus.emit("controlnet:preview", { dataUrl: controlnetPreview });
                        }
                        foundControlnet = true;
                    }

                    // Stop polling once we have both previews, or at least ControlNet preview.
                    if (foundControlnet && foundPrompt) {
                        done = true;
                        return;
                    }
                } catch (_e) {}
                setTimeout(poll, 1000);
            };
            setTimeout(poll, 1000);
            return true;
        } catch (err) {
            console.error("[DISPATCHER] executeScenarioZ3 error:", err);
            this.eventBus.emit("workflow:error", { error: String(err) });
        }
    }

    destroy() {
        this._completionWatchToken += 1;
    }

}
