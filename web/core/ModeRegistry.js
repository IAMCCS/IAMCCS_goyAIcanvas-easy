export const MODE_DEFINITIONS = Object.freeze([
    {
        id: 'easy',
        label: 'EASY',
        tier: 'public',
        status: 'active',
        loader: () => import('../modes/easy/EasyMode.js?v=20260627_EASY_GENERATE_RESET02'),
    },
    {
        id: 'advanced',
        label: 'ADVANCED',
        tier: 'core',
        status: 'active',
        loader: null,
    },
    {
        id: 'video',
        label: 'VIDEO',
        tier: 'core',
        status: 'active',
        loader: () => import('../modes/video/VideoMode.js?v=20260609_STRUCT_MODE_REGISTRY01'),
    },
    {
        id: 'simulacra',
        label: 'SIMULACRA',
        tier: 'creator',
        status: 'active',
        loader: () => import('../modes/simulacra/SimulacraMode.js?v=20260609_STRUCT_MODE_REGISTRY01'),
    },
    {
        id: 'orchestrator',
        label: 'ORCHESTRATOR',
        tier: 'core',
        status: 'active',
        loader: () => import('../modes/orchestrator/OrchestratorMode.js?v=20260609_STRUCT_MODE_REGISTRY01'),
    },
    {
        id: 'visual',
        label: 'FIELD',
        tier: 'core',
        status: 'active',
        loader: () => import('../modes/visual/VisualMode.js?v=20260609_STRUCT_MODE_REGISTRY01'),
    },
]);

export const ACTIVE_MODE_DEFINITIONS = Object.freeze(MODE_DEFINITIONS.filter((mode) => mode.status === 'active'));
export const VALID_MODES = new Set(ACTIVE_MODE_DEFINITIONS.map((mode) => mode.id));
export const NON_PERSISTENT_MODES = new Set([]);

export const MODE_LOADERS = Object.freeze(
    ACTIVE_MODE_DEFINITIONS.reduce((loaders, mode) => {
        if (typeof mode.loader === 'function') loaders[mode.id] = mode.loader;
        return loaders;
    }, {})
);

const MODE_MODULE_CACHE = new Map();

export function getModeDefinitions() {
    return ACTIVE_MODE_DEFINITIONS.slice();
}

export function getModeDefinition(mode) {
    const normalized = normalizeMode(mode, '');
    return ACTIVE_MODE_DEFINITIONS.find((item) => item.id === normalized) || null;
}

export async function loadModeModule(mode) {
    const normalized = normalizeMode(mode, '');
    if (!normalized || typeof MODE_LOADERS[normalized] !== 'function') {
        throw new Error(`[ModeRegistry] No loader registered for mode: ${mode}`);
    }
    if (!MODE_MODULE_CACHE.has(normalized)) {
        MODE_MODULE_CACHE.set(normalized, MODE_LOADERS[normalized]());
    }
    return MODE_MODULE_CACHE.get(normalized);
}

export function preloadModes(modes = []) {
    const uniqueModes = Array.from(new Set((modes || []).map((mode) => normalizeMode(mode, '')).filter(Boolean)));
    uniqueModes.forEach((mode) => {
        try {
            void loadModeModule(mode).catch((error) => {
                console.warn(`[ModeRegistry] Preload failed for ${mode}`, error);
                MODE_MODULE_CACHE.delete(mode);
            });
        } catch (error) {
            console.warn(`[ModeRegistry] Preload skipped for ${mode}`, error);
        }
    });
}

export function normalizeMode(mode, fallback = 'advanced') {
    const normalized = String(mode || '').trim();
    return VALID_MODES.has(normalized) ? normalized : fallback;
}

export function shouldReuseMode(mode) {
    return !NON_PERSISTENT_MODES.has(mode);
}
