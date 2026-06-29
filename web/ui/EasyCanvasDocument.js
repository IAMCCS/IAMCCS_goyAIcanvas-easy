export default class EasyCanvasDocument {
    constructor({ canvas, layerManager }) {
        this.canvas = canvas;
        this.layerManager = layerManager;
    }

    async render() {
        const out = document.createElement("canvas");
        out.width = Math.max(1, Number(this.canvas?.width) || 1);
        out.height = Math.max(1, Number(this.canvas?.height) || 1);
        const ctx = out.getContext("2d", { willReadFrequently: true });
        if (!ctx) return out;

        ctx.fillStyle = this.backgroundColor();
        ctx.fillRect(0, 0, out.width, out.height);

        const layers = this.layerManager?.getLayers?.() || [];
        for (const layer of layers) {
            if (!layer || layer.id === "layer_background" || layer.visible === false || !layer.bitmap) continue;
            const image = await this._loadImage(layer.bitmap);
            if (!image) continue;
            ctx.save();
            ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1;
            ctx.globalCompositeOperation = this._blendMode(layer.blendMode || layer.blend_mode);
            this._drawLayer(ctx, image, layer, out.width, out.height);
            ctx.restore();
        }

        return out;
    }

    async crop(rect) {
        const normalized = this.normalizeRect(rect);
        const source = await this.render();
        const out = document.createElement("canvas");
        out.width = normalized.w;
        out.height = normalized.h;
        const ctx = out.getContext("2d", { willReadFrequently: true });
        if (!ctx) return "";
        ctx.drawImage(source, normalized.x, normalized.y, normalized.w, normalized.h, 0, 0, normalized.w, normalized.h);
        return out.toDataURL("image/png");
    }

    normalizeRect(rect) {
        const canvasWidth = Math.max(1, Number(this.canvas?.width) || 1);
        const canvasHeight = Math.max(1, Number(this.canvas?.height) || 1);
        const x = Math.max(0, Math.min(canvasWidth, Math.floor(Number(rect?.x) || 0)));
        const y = Math.max(0, Math.min(canvasHeight, Math.floor(Number(rect?.y) || 0)));
        const right = Math.max(0, Math.min(canvasWidth, Math.floor(x + (Number(rect?.w) || 0))));
        const bottom = Math.max(0, Math.min(canvasHeight, Math.floor(y + (Number(rect?.h) || 0))));
        return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
    }

    backgroundColor() {
        const layer = this.layerManager?.getLayerById?.("layer_background");
        const value = String(layer?.metadata?.backgroundColor || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) return value;
        if (/^#[0-9a-f]{3}$/i.test(value)) {
            return `#${value.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
        }
        return "#101318";
    }

    _drawLayer(ctx, image, layer, canvasWidth, canvasHeight) {
        const width = image.naturalWidth || image.width || canvasWidth;
        const height = image.naturalHeight || image.height || canvasHeight;
        const transform = this._transform(layer?.metadata?.transform);
        if (!transform) {
            ctx.drawImage(image, 0, 0, width, height);
            return;
        }
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.translate(transform.dx, transform.dy);
        if (transform.angle) ctx.rotate(transform.angle);
        if (transform.sx !== 1 || transform.sy !== 1) ctx.scale(transform.sx, transform.sy);
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }

    _transform(input) {
        if (!input) return null;
        const transform = {
            dx: Number(input.dx) || 0,
            dy: Number(input.dy) || 0,
            sx: Number(input.sx ?? input.scaleX ?? 1) || 1,
            sy: Number(input.sy ?? input.scaleY ?? 1) || 1,
            angle: Number(input.angle ?? input.rotation ?? 0) || 0,
        };
        const identity = Math.abs(transform.dx) < 0.001
            && Math.abs(transform.dy) < 0.001
            && Math.abs(transform.sx - 1) < 0.001
            && Math.abs(transform.sy - 1) < 0.001
            && Math.abs(transform.angle) < 0.001;
        return identity ? null : transform;
    }

    _blendMode(mode) {
        const normalized = String(mode || "normal").replace(/_/g, "-");
        if (normalized === "normal") return "source-over";
        const allowed = new Set(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
        return allowed.has(normalized) ? normalized : "source-over";
    }

    _loadImage(src) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            try {
                const image = new Image();
                image.onload = () => done(image);
                image.onerror = () => done(null);
                image.src = src;
                if (image.complete && (image.naturalWidth || image.width)) done(image);
            } catch (_e) {
                done(null);
            }
        });
    }
}
