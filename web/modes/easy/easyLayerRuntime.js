export const EASY_LAYER_ROLES = {
    DRAW_SURFACE: 'easy_draw_surface',
    I2I_HELPER: 'easy_i2i_helper',
    INPAINT_MASK: 'easy_inpaint_mask',
};

export function getEasyRoleForMode(mode) {
    if (mode === 'draw') return EASY_LAYER_ROLES.DRAW_SURFACE;
    if (mode === 'i2i') return EASY_LAYER_ROLES.I2I_HELPER;
    if (mode === 'inpaint') return EASY_LAYER_ROLES.INPAINT_MASK;
    return '';
}

export function findEasyLayer(layerManager, role) {
    if (!layerManager || !role) return null;
    return (layerManager.getLayers?.() || []).find((layer) => layer?.metadata?.easyRole === role) || null;
}

export function ensureEasyLayer(layerManager, role, name) {
    if (!layerManager || !role) return null;

    const existing = findEasyLayer(layerManager, role);
    if (existing) {
        return existing;
    }

    const created = layerManager.addLayer?.(name);
    if (!created) {
        return null;
    }

    layerManager.updateLayer?.({
        id: created.id,
        patch: {
            name,
            metadata: {
                ...(created.metadata || {}),
                easyManaged: true,
                easyRole: role,
            },
        },
    });
    layerManager.moveToTop?.(created.id);

    return findEasyLayer(layerManager, role) || created;
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load layer bitmap'));
        image.src = dataUrl;
    });
}

export async function bakeLayerBitmapOnWhite(layerManager, layerId, size = {}) {
    if (!layerManager || !layerId) return false;

    const layer = (layerManager.getLayers?.() || []).find((entry) => entry?.id === layerId) || null;
    const bitmap = String(layer?.bitmap || '');
    if (!layer || !bitmap) return false;

    const width = Math.max(1, Math.round(Number(size.width) || Number(layerManager.canvasWidth) || 1024));
    const height = Math.max(1, Math.round(Number(size.height) || Number(layerManager.canvasHeight) || 1024));
    const image = await loadImageFromDataUrl(bitmap);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    layerManager.updateLayer?.({
        id: layerId,
        patch: {
            bitmap: canvas.toDataURL('image/png'),
            metadata: {
                ...(layer.metadata || {}),
                easyManaged: true,
                easyWhiteBase: true,
                easyDrawSurface: 'baked-white',
            },
        },
    });

    return true;
}

export function layerHasMeaningfulPixels(layer, mode) {
    if (!layer) return false;
    if (mode === 'inpaint') return !!layer.mask;
    return !!layer.bitmap;
}