export const MODE_DEFINITIONS = Object.freeze([
    {
        id: "easy",
        label: "EASY",
        tier: "public",
        status: "active",
        loader: () => import("../modes/easy/EasyMode.js?v=20260629_EASY_CLEAN_BOOT01"),
    },
]);

export const ACTIVE_MODE_DEFINITIONS = Object.freeze(MODE_DEFINITIONS.filter((mode) => mode.status === "active"));
export const VALID_MODES = new Set(ACTIVE_MODE_DEFINITIONS.map((mode) => mode.id));
export const NON_PERSISTENT_MODES = new Set([]);
export const MODE_LOADERS = Object.freeze({ easy: MODE_DEFINITIONS[0].loader });

const MODE_MODULE_CACHE = new Map();

export function getModeDefinitions() {
    return ACTIVE_MODE_DEFINITIONS.slice();
}

export function getModeDefinition(mode) {
    const normalized = normalizeMode(mode, "");
    return ACTIVE_MODE_DEFINITIONS.find((item) => item.id === normalized) || null;
}

export async function loadModeModule(mode) {
    const normalized = normalizeMode(mode, "easy");
    if (!MODE_MODULE_CACHE.has(normalized)) MODE_MODULE_CACHE.set(normalized, MODE_LOADERS[normalized]());
    return MODE_MODULE_CACHE.get(normalized);
}

export function preloadModes() {}

export function normalizeMode(mode, fallback = "easy") {
    const normalized = String(mode || "").trim();
    return VALID_MODES.has(normalized) ? normalized : fallback;
}

export function shouldReuseMode(mode) {
    return !NON_PERSISTENT_MODES.has(mode);
}
