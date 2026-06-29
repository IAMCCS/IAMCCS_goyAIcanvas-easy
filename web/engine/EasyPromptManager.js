export default class EasyPromptManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.globalPrompt = { positive: "", negative: "", strength: 1, guidance: 1, cfg: 1, applyToAll: false };
        this.eventBus?.on?.("prompt:global:update", (patch = {}) => this.updateGlobalPrompt(patch));
        this.eventBus?.on?.("project:hydrate", (payload = {}) => this.hydrate(payload?.prompts || payload));
        this.eventBus?.on?.("project:clear", () => this.clear());
    }

    updateGlobalPrompt(patch = {}) {
        const next = { ...this.globalPrompt };
        if (typeof patch.positive === "string") next.positive = patch.positive;
        if (typeof patch.prompt === "string") next.positive = patch.prompt;
        if (typeof patch.negative === "string") next.negative = patch.negative;
        if (typeof patch.negativePrompt === "string") next.negative = patch.negativePrompt;
        if (Number.isFinite(Number(patch.strength))) next.strength = Number(patch.strength);
        if (Number.isFinite(Number(patch.guidance))) next.guidance = Number(patch.guidance);
        if (Number.isFinite(Number(patch.cfg))) next.cfg = Number(patch.cfg);
        if (typeof patch.applyToAll === "boolean") next.applyToAll = patch.applyToAll;
        this.globalPrompt = next;
        this.eventBus?.emit?.("prompt:global:changed", { global: this.getGlobalPrompt(), source: patch.source || "easy" });
    }

    getGlobalPrompt() {
        return { ...this.globalPrompt };
    }

    buildPayload() {
        return { global: this.getGlobalPrompt() };
    }

    hydrate(payload = {}) {
        const global = payload?.global || payload?.prompts?.global || payload;
        if (!global || typeof global !== "object") return;
        this.updateGlobalPrompt({
            positive: global.positive || global.prompt || "",
            negative: global.negative || global.negativePrompt || "",
            strength: global.strength,
            guidance: global.guidance,
            cfg: global.cfg,
            applyToAll: global.applyToAll,
            source: "hydrate",
        });
    }

    clear() {
        this.globalPrompt = { positive: "", negative: "", strength: 1, guidance: 1, cfg: 1, applyToAll: false };
        this.eventBus?.emit?.("prompt:global:changed", { global: this.getGlobalPrompt(), source: "clear" });
    }
}
