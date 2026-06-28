import promptEnhancersModule from "../assets/presets/prompt_enhancers.js";

function getPresetGroupsObject() {
    return promptEnhancersModule?.presets && typeof promptEnhancersModule.presets === "object"
        ? promptEnhancersModule.presets
        : {};
}

export function getPromptEnhancerEntries() {
    const entries = [];
    Object.entries(getPresetGroupsObject()).forEach(([group, items]) => {
        entries.push({ group, prompt: "" });
        (Array.isArray(items) ? items : []).forEach((item) => {
            if (!item || typeof item.label !== "string") return;
            entries.push({
                group,
                label: String(item.label || ""),
                prompt: String(item.prompt || ""),
            });
        });
    });
    return entries;
}

export function getPromptEnhancerPrompt(label) {
    const match = getPromptEnhancerEntries().find((entry) => entry.label === label && entry.prompt);
    return String(match?.prompt || "");
}

export function buildPromptEnhancerOptionsHtml(selectedLabel = "") {
    let html = "";
    let openGroup = false;
    getPromptEnhancerEntries().forEach((entry) => {
        if (!entry.prompt) {
            if (openGroup) html += "</optgroup>";
            html += `<optgroup label="${String(entry.group || "Prompt Enhancers")}">`;
            openGroup = true;
            return;
        }
        const label = String(entry.label || "");
        html += `<option value="${label}" ${selectedLabel === label ? "selected" : ""}>${label}</option>`;
    });
    if (openGroup) html += "</optgroup>";
    return html;
}
