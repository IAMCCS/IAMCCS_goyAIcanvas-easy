export default class EasyLayerBox {
    constructor(container, eventBus, modules = {}) {
        this.container = container;
        this.eventBus = eventBus;
        this.modules = modules;
        this.layerManager = modules.layerManager;
        this._unsubs = [];
        this._pendingBackgroundColor = null;
        this._backgroundPickerActive = false;
        this._dragLayerId = null;
        this._bindBus();
        this.render();
    }

    _bindBus() {
        this._unsubs.push(this.eventBus.on("layers:changed", () => {
            if (!this._backgroundPickerActive) this.render();
        }));
        this._unsubs.push(this.eventBus.on("layer:selected", () => {
            if (!this._backgroundPickerActive) this.render();
        }));
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
            <div class="easy-layer-box__layer${active ? " is-active" : ""}${locked ? " is-locked" : ""}" data-layer-id="${this._escapeAttr(layer.id)}" ${locked ? "" : 'draggable="true"'}>
                <button type="button" class="easy-layer-box__drag" data-action="drag-layer" ${locked ? "disabled" : ""} title="Drag layer">::</button>
                <button type="button" class="easy-layer-box__eye" data-action="toggle-visible" title="${visible ? "Hide" : "Show"}">${visible ? "On" : "Off"}</button>
                ${thumb}
                <button type="button" class="easy-layer-box__name" data-action="select-layer">${safeName}</button>
                <button type="button" class="easy-layer-box__delete" data-action="delete-layer" ${locked ? "disabled" : ""} title="Delete">x</button>
            </div>
        `;
    }

    _bindDom() {
        this.container.querySelector("[data-action='add-layer']")?.addEventListener("click", () => {
            const layer = this.layerManager?.addLayer?.("Easy Paint Layer");
            if (layer?.id) {
                this.layerManager?.updateLayer?.({
                    id: layer.id,
                    announce: false,
                    patch: {
                        name: "Easy Paint Layer",
                        visible: true,
                        locked: false,
                        metadata: {
                            ...(layer.metadata || {}),
                            easyManaged: true,
                            easyRole: "easy_draw_surface",
                            easyDrawSurface: "white",
                        },
                    },
                });
                this.layerManager?.selectLayer?.(layer.id);
            }
            this.eventBus.emit("canvas:mode", { drawOnly: true });
            this.eventBus.emit("brush:update", { brush: "pencil", color: "#000000", size: 32, source: "easy-draw" });
            this.eventBus.emit("tool:change", "pencil");
            this.eventBus.emit("status:message", "Easy paint layer ready");
        });
        this.container.querySelectorAll(".easy-layer-box__layer").forEach((row) => {
            const id = row.dataset.layerId;
            row.addEventListener("dragstart", (event) => {
                if (row.classList.contains("is-locked")) {
                    event.preventDefault();
                    return;
                }
                this._dragLayerId = id;
                row.classList.add("is-dragging");
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
            });
            row.addEventListener("dragover", (event) => {
                if (!this._dragLayerId || this._dragLayerId === id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const before = this._dropBeforeRow(event, row);
                row.classList.toggle("is-drop-before", before);
                row.classList.toggle("is-drop-after", !before);
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("is-drop-before", "is-drop-after");
            });
            row.addEventListener("drop", (event) => {
                if (!this._dragLayerId || this._dragLayerId === id) return;
                event.preventDefault();
                const before = this._dropBeforeRow(event, row);
                this._reorderByVisualDrop(this._dragLayerId, id, before);
                this._clearDragState();
            });
            row.addEventListener("dragend", () => this._clearDragState());
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
                event.preventDefault();
                event.stopPropagation();
                const ok = this.layerManager?.removeLayer?.(id);
                if (ok) {
                    this.eventBus.emit("status:message", "Layer deleted");
                    this.eventBus.emit("canvas:render:request", { source: "easy-layer-delete" });
                    this.eventBus.emit("canvas:export:composite", { reason: "easy-layer-delete" });
                    this.eventBus.emit("workflow:params:changed", { immediate: true });
                } else {
                    this.eventBus.emit("status:message", "Layer delete unavailable for this layer");
                }
            });
            const backgroundInput = row.querySelector("[data-action='background-color']");
            backgroundInput?.addEventListener("pointerdown", (event) => {
                event.stopPropagation();
                this._backgroundPickerActive = true;
            });
            backgroundInput?.addEventListener("click", (event) => {
                event.stopPropagation();
                this._backgroundPickerActive = true;
            });
            backgroundInput?.addEventListener("input", (event) => {
                event.stopPropagation();
                this._stageBackgroundColor(event.target.value, row);
            });
            backgroundInput?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._setBackgroundColor(this._pendingBackgroundColor || event.target.value);
                this._pendingBackgroundColor = null;
                this._backgroundPickerActive = false;
                this.render();
            });
            backgroundInput?.addEventListener("keydown", (event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    this._setBackgroundColor(this._pendingBackgroundColor || event.target.value);
                    this._pendingBackgroundColor = null;
                    this._backgroundPickerActive = false;
                    this.render();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    this._pendingBackgroundColor = null;
                    this._backgroundPickerActive = false;
                    const layer = this.layerManager?.getLayerById?.("layer_background");
                    const color = this._backgroundColorValue(layer);
                    event.target.value = color;
                    const thumb = row.querySelector(".easy-layer-box__thumb--background");
                    if (thumb) thumb.style.background = color;
                }
            });
        });
    }

    _dropBeforeRow(event, row) {
        const rect = row.getBoundingClientRect();
        return (event.clientY - rect.top) < rect.height / 2;
    }

    _reorderByVisualDrop(dragId, targetId, beforeTarget) {
        const rows = Array.from(this.container.querySelectorAll(".easy-layer-box__layer"));
        const visualIds = rows.map((row) => row.dataset.layerId).filter((id) => id && id !== "layer_background");
        const withoutDrag = visualIds.filter((id) => id !== dragId);
        const targetIndex = withoutDrag.indexOf(targetId);
        if (targetIndex < 0) return;
        withoutDrag.splice(beforeTarget ? targetIndex : targetIndex + 1, 0, dragId);
        const stackOrder = withoutDrag.slice().reverse();
        const changed = this.layerManager?.reorderLayers?.(stackOrder);
        if (changed) {
            this.layerManager?.selectLayer?.(dragId);
            this.eventBus.emit("status:message", "Layer order updated");
            this.eventBus.emit("canvas:export:composite", { reason: "layer-reorder" });
            this.eventBus.emit("workflow:params:changed", { immediate: true });
        }
    }

    _clearDragState() {
        this._dragLayerId = null;
        this.container.querySelectorAll(".easy-layer-box__layer").forEach((row) => {
            row.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
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
        layer.locked = true;
        layer.visible = true;
        layer.metadata = {
            ...(layer.metadata || {}),
            backgroundColor: value,
            easyAutoDrawBackground: false,
            easyRole: "background",
        };
        this.eventBus.emit("background:color:update", { color: value, source: "easy-background-preview" });
        this.eventBus.emit("canvas:render:request", { reason: "background-color-preview" });
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
                    easyAutoDrawBackground: false,
                },
            },
        });
        this.eventBus.emit("background:color:update", { color: value, source: "easy-background" });
        this.eventBus.emit("canvas:render:request", { reason: "background-color" });
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

