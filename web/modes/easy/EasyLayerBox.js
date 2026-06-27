export default class EasyLayerBox {
    constructor(container, eventBus, modules = {}) {
        this.container = container;
        this.eventBus = eventBus;
        this.modules = modules;
        this.layerManager = modules.layerManager;
        this._unsubs = [];
        this._pendingBackgroundColor = null;
        this._bindBus();
        this.render();
    }

    _bindBus() {
        this._unsubs.push(this.eventBus.on("layers:changed", () => this.render()));
        this._unsubs.push(this.eventBus.on("layer:selected", () => this.render()));
    }

    render() {
        const layers = this.layerManager?.getLayers?.() || [];
        const activeLayerId = this.layerManager?.getActiveLayerId?.() || null;
        const layerRows = layers.slice().reverse().map((layer) => this._layerRow(layer, activeLayerId)).join("");

        this.container.innerHTML = `
            <section class="easy-layer-box">
                <div class="easy-layer-box__header">
                    <div>
                        <div class="easy-layer-box__eyebrow">Layers</div>
                        <h3>Layer Stack</h3>
                    </div>
                    <button type="button" class="easy-layer-box__add" data-action="add-layer">+ Layer</button>
                </div>

                <div class="easy-layer-box__list" aria-label="Layers">
                    ${layerRows || '<div class="easy-layer-box__empty">No layers</div>'}
                </div>
            </section>
        `;

        this._bindDom();
    }

    _layerRow(layer, activeLayerId) {
        const locked = !!layer.locked || layer.id === "layer_background";
        const active = layer.id === activeLayerId;
        const visible = layer.visible !== false;
        const safeName = this._escape(layer.id === "layer_background" ? "Background" : (layer.name || "Layer"));
        const isBackground = layer.id === "layer_background";
        const backgroundColor = this._backgroundColorValue(layer);
        const thumbStyle = layer.bitmap
            ? `background-image:url('${String(layer.bitmap).replace(/'/g, "%27")}')`
            : `background:${this._escapeAttr(layer.metadata?.backgroundColor || (locked ? backgroundColor : "#101318"))}`;
        const thumb = isBackground
            ? `<label class="easy-layer-box__thumb easy-layer-box__thumb--background" style="${thumbStyle}" title="Choose background color">
                    <input type="color" class="easy-layer-box__bg-color-input" data-action="background-color" value="${this._escapeAttr(backgroundColor)}" aria-label="Background color" />
               </label>`
            : `<div class="easy-layer-box__thumb" style="${thumbStyle}"></div>`;
        return `
            <div class="easy-layer-box__layer${active ? " is-active" : ""}${locked ? " is-locked" : ""}" data-layer-id="${this._escapeAttr(layer.id)}">
                <button type="button" class="easy-layer-box__eye" data-action="toggle-visible" title="${visible ? "Hide" : "Show"}">${visible ? "On" : "Off"}</button>
                ${thumb}
                <button type="button" class="easy-layer-box__name" data-action="select-layer">${safeName}</button>
                <button type="button" class="easy-layer-box__delete" data-action="delete-layer" ${locked ? "disabled" : ""} title="Delete">x</button>
            </div>
        `;
    }

    _bindDom() {
        this.container.querySelector("[data-action='add-layer']")?.addEventListener("click", () => {
            const layer = this.layerManager?.addLayer?.("Paint Layer");
            if (layer?.id) this.layerManager?.selectLayer?.(layer.id);
            this.eventBus.emit("canvas:mode", { drawOnly: true });
            this.eventBus.emit("brush:update", { brush: "brush" });
            this.eventBus.emit("tool:change", "brush");
        });
        this.container.querySelectorAll(".easy-layer-box__layer").forEach((row) => {
            const id = row.dataset.layerId;
            row.addEventListener("click", (event) => {
                if (event.target.closest("button, input, select, textarea")) return;
                this.layerManager?.selectLayer?.(id);
            });
            row.querySelector("[data-action='select-layer']")?.addEventListener("click", () => {
                this.layerManager?.selectLayer?.(id);
            });
            row.querySelector("[data-action='toggle-visible']")?.addEventListener("click", (event) => {
                event.stopPropagation();
                const layer = this.layerManager?.getLayerById?.(id);
                if (layer) this.layerManager?.updateLayer?.({ id, patch: { visible: layer.visible === false } });
            });
            row.querySelector("[data-action='delete-layer']")?.addEventListener("click", (event) => {
                event.stopPropagation();
                this.layerManager?.removeLayer?.(id);
            });
            const backgroundInput = row.querySelector("[data-action='background-color']");
            backgroundInput?.addEventListener("pointerdown", (event) => event.stopPropagation());
            backgroundInput?.addEventListener("click", (event) => event.stopPropagation());
            backgroundInput?.addEventListener("input", (event) => {
                event.stopPropagation();
                this._stageBackgroundColor(event.target.value, row);
            });
            backgroundInput?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._setBackgroundColor(this._pendingBackgroundColor || event.target.value);
                this._pendingBackgroundColor = null;
            });
            backgroundInput?.addEventListener("keydown", (event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    this._setBackgroundColor(this._pendingBackgroundColor || event.target.value);
                    this._pendingBackgroundColor = null;
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    this._pendingBackgroundColor = null;
                    const layer = this.layerManager?.getLayerById?.("layer_background");
                    const color = this._backgroundColorValue(layer);
                    event.target.value = color;
                    const thumb = row.querySelector(".easy-layer-box__thumb--background");
                    if (thumb) thumb.style.background = color;
                }
            });
        });
    }

    _backgroundColorValue(layer) {
        const value = String(layer?.metadata?.backgroundColor || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) return value;
        if (/^#[0-9a-f]{3}$/i.test(value)) {
            return `#${value.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
        }
        return "#101318";
    }

    _stageBackgroundColor(color, row) {
        const value = this._backgroundColorValue({ metadata: { backgroundColor: color } });
        this._pendingBackgroundColor = value;
        const thumb = row?.querySelector?.(".easy-layer-box__thumb--background");
        if (thumb) thumb.style.background = value;
        const layer = this.layerManager?.getLayerById?.("layer_background");
        if (!layer) return;
        this.layerManager?.updateLayer?.({
            id: "layer_background",
            announce: false,
            patch: {
                locked: true,
                visible: true,
                metadata: {
                    ...(layer.metadata || {}),
                    backgroundColor: value,
                },
            },
        });
        this.eventBus.emit("background:color:update", { color: value, source: "easy-background-preview" });
        this.eventBus.emit("canvas:refresh", { reason: "background-color-preview" });
    }

    _setBackgroundColor(color) {
        const value = this._backgroundColorValue({ metadata: { backgroundColor: color } });
        const layer = this.layerManager?.getLayerById?.("layer_background");
        if (!layer) return;
        this.layerManager?.updateLayer?.({
            id: "layer_background",
            patch: {
                locked: true,
                visible: true,
                metadata: {
                    ...(layer.metadata || {}),
                    backgroundColor: value,
                },
            },
        });
        this.eventBus.emit("background:color:update", { color: value, source: "easy-background" });
        this.eventBus.emit("canvas:refresh", { reason: "background-color" });
        this.eventBus.emit("canvas:export:composite", { reason: "background-color" });
    }

    _escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[char]));
    }

    _escapeAttr(value) {
        return this._escape(value).replace(/`/g, "&#96;");
    }

    cleanup() {
        this._unsubs.forEach((unsubscribe) => {
            try { unsubscribe?.(); } catch (_e) {}
        });
        this._unsubs = [];
    }
}
