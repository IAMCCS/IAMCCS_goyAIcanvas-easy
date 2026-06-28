export function normalizeModelName(value) {
    return String(value || '').trim();
}

export function dedupeModelNames(items = []) {
    const result = [];
    const seen = new Set();
    (items || []).forEach((item) => {
        const name = normalizeModelName(item);
        if (!name || seen.has(name)) return;
        seen.add(name);
        result.push(name);
    });
    return result;
}

export function isCompatibleT2IModel(name, templateKey) {
    const normalized = normalizeModelName(name).toLowerCase();
    if (!normalized) return false;
    if (templateKey === 'z') {
        return /(z[\s._-]*image|aura[\s._-]*flow|lumina)/i.test(normalized) && !/qwen.*edit/i.test(normalized);
    }
    if (templateKey === 'fl2') {
        return /(flux[\s._-]*2|fl2|klein[\s._-]*9b)/i.test(normalized);
    }
    return false;
}

export function getCompatibleSeedVR2Models(models = {}, fallbackPool = []) {
    const dedicated = dedupeModelNames([
        ...(models.seedvr2_dit || []),
        ...(models.seedvr2 || []),
    ]);
    if (dedicated.length) {
        return dedicated;
    }
    return dedupeModelNames(fallbackPool)
        .filter((name) => /seed[\s._-]*vr|seedvr|seed_vr|seed-vr/i.test(name));
}

export async function fetchModelCategory(category) {
    const response = await fetch(`/iamccs/goyacanvas/models?category=${encodeURIComponent(category)}`, { cache: 'no-store' })
        .then((result) => result.json())
        .catch(() => ({ items: [] }));
    return dedupeModelNames(response?.items || []);
}

export async function loadInstalledGenerationModelCatalog(options = {}) {
    const includeSeedVR2 = options.includeSeedVR2 === true;
    const includeLoras = options.includeLoras === true;
    const categoryRequests = [
        fetchModelCategory('diffusion_models'),
        fetchModelCategory('unet_gguf'),
    ];
    if (includeSeedVR2) categoryRequests.push(fetchModelCategory('seedvr2_dit'));
    if (includeLoras) categoryRequests.push(fetchModelCategory('loras'));

    const [diffusionModels, unetGgufModels, ...optionalLists] = await Promise.all(categoryRequests);
    const mergedGenerationModels = dedupeModelNames([...unetGgufModels, ...diffusionModels]);
    const result = {
        mergedGenerationModels,
        generationModels: {
            z: mergedGenerationModels.filter((name) => isCompatibleT2IModel(name, 'z')),
            fl2: mergedGenerationModels.filter((name) => isCompatibleT2IModel(name, 'fl2')),
        },
        seedvr2DitModels: [],
        loraModels: [],
    };
    let optionalIndex = 0;
    if (includeSeedVR2) {
        result.seedvr2DitModels = getCompatibleSeedVR2Models({ seedvr2_dit: optionalLists[optionalIndex] || [] }, mergedGenerationModels);
        optionalIndex += 1;
    }
    if (includeLoras) {
        result.loraModels = optionalLists[optionalIndex] || [];
    }
    return result;
}
