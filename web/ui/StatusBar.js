export default class StatusBar {
    constructor(hostElement, eventBus, canvasView, layerManager, promptManager) {
        this.hostElement = hostElement;
        this.eventBus = eventBus;
        this.canvasView = canvasView;
        this.layerManager = layerManager;
        this.promptManager = promptManager;
        this.text = "";
        this.tickerMessages = [];
        this._lastTickerText = "";
        this._lastTickerAt = 0;
        this.infoEl = document.createElement("div");
        this.infoEl.className = "goya-statusbar__info";
        this.tickerEl = document.createElement("div");
        this.tickerEl.className = "goya-statusbar__ticker";
        this.tickerInner = document.createElement("div");
        this.tickerInner.className = "goya-ticker__inner";
        this.tickerEl.appendChild(this.tickerInner);
        this.hostElement.innerHTML = "";
        this.hostElement.append(this.infoEl, this.tickerEl);
        this._bind();
        this._w = 1024;
        this._h = 1024;
        this._update();
        this._renderTicker();
    }

    _bind() {
        this.eventBus.on("layers:changed", () => {
            this._update();
            const count = this.layerManager?.getLayers?.()?.length || 0;
            const layer = this.layerManager?.getActiveLayer?.();
            this._pushTick(`Layers changed: ${count} layer${count === 1 ? "" : "s"}${layer?.name ? `, active "${layer.name}"` : ""}`);
        });

        this.eventBus.on("prompt:global:changed", () => {
            this._update();
            const globalPrompt = this.promptManager?.getGlobalPrompt?.() || {};
            const positiveLength = String(globalPrompt.positive || "").trim().length;
            const negativeLength = String(globalPrompt.negative || "").trim().length;
            this._pushTick(`Prompt updated: ${positiveLength} positive chars, ${negativeLength} negative chars`);
        });

        this.eventBus.on("canvas:stroke:finished", () => this._pushTick("Canvas stroke finished"));

        this.eventBus.on("workflow:queued", (payload = {}) => {
            const mode = payload.intentMode || payload.scenarioKey || payload.extra?.scenario_override || "generation";
            const promptId = payload.prompt_id ? ` (${payload.prompt_id})` : "";
            this._pushTick(`Workflow queued: ${mode}${promptId}`);
        });

        this.eventBus.on("workflow:started", (payload = {}) => {
            const mode = payload?.payload?.intentMode || payload?.payload?.scenarioKey || payload?.intentMode || "generation";
            this._pushTick(`Workflow started: ${mode}`);
        });

        this.eventBus.on("workflow:finished", () => this._pushTick("Workflow finished"));
        this.eventBus.on("workflow:complete", () => this._pushTick("Workflow complete"));

        this.eventBus.on("easy:seed:used", ({ seed } = {}) => {
            const value = Math.max(0, Math.floor(Number(seed) || 0));
            this._pushTick(`Seed used: ${value}`);
        });

        this.eventBus.on("workflow:error", (payload = {}) => {
            const message = payload?.message || payload?.error || "unknown error";
            this._pushTick(`Workflow error: ${message}`);
        });

        this.eventBus.on("status:message", (text) => {
            if (!text) return;
            const message = typeof text === "string" ? text : (text.text || text.message || "");
            if (message && !/^(Waiting for ComfyUI history:|ComfyUI still processing\b)/i.test(String(message))) this._pushTick(String(message));
        });

        this.eventBus.on("image:histogram:ready", () => this._pushTick("Histogram updated"));

        this.eventBus.on("tool:change", (payload = {}) => {
            const tool = typeof payload === "string" ? payload : (payload.tool || payload.id || "unknown");
            this._pushTick(`Tool changed: ${tool}`);
        });

        this.eventBus.on("mask:overlay:changed", ({ enabled } = {}) => {
            this._pushTick(`Mask overlay ${enabled ? "enabled" : "disabled"}`);
        });

        this.eventBus.on("canvas:size", ({ width, height } = {}) => {
            if (width && height) {
                this._w = width;
                this._h = height;
                this._update();
                this._pushTick(`Canvas size set: ${width}x${height}px`);
            }
        });

        this.eventBus.on("canvas:resize", ({ width, height } = {}) => {
            if (width && height) {
                this._w = width;
                this._h = height;
                this._update();
                this._pushTick(`Canvas resized: ${width}x${height}px`);
            }
        });
    }

    _update() {
        const layer = this.layerManager.getActiveLayer();
        const globalPrompt = this.promptManager.getGlobalPrompt();
        const parts = [
            `Canvas ${this._w}x${this._h}`,
            layer ? `Layer: ${layer.name}` : "Layer: none",
            globalPrompt.positive ? `Global prompt: ${globalPrompt.positive.slice(0, 48)}...` : "Global prompt: empty",
        ];
        this.infoEl.textContent = parts.join(" | ");
    }

    _pushTick(message) {
        try {
            const text = String(message || "").trim();
            if (!text) return;
            const now = Date.now();
            if (text === this._lastTickerText && now - this._lastTickerAt < 8000) return;
            this._lastTickerText = text;
            this._lastTickerAt = now;
            this.tickerMessages.push(text);
            if (this.tickerMessages.length > 10) this.tickerMessages.shift();
            this._renderTicker();
        } catch (_e) {}
    }

    _renderTicker() {
        if (!this.tickerInner) return;
        const messages = this.tickerMessages.length
            ? this.tickerMessages
            : ["Ready"];
        this.tickerInner.innerHTML = "";
        for (let pass = 0; pass < 2; pass += 1) {
            messages.forEach((message) => {
                const el = document.createElement("span");
                el.className = "goya-ticker__msg";
                el.textContent = message;
                this.tickerInner.appendChild(el);
            });
        }
    }
}
