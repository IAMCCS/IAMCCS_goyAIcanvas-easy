export default class CanvasToolbar {
    constructor(hostElement, eventBus) {
        this.hostElement = hostElement;
        this.eventBus = eventBus;
        this.root = document.createElement("div");
        this.root.className = "goya-toolbar-top goya-toolbar-top--easy";
        this.compareEnabled = false;
        this._fileMenuOpen = false;
        this._outsideHandler = (event) => this._handleOutsidePointer(event);
        this.hostElement?.append?.(this.root);
        this.fileInput = document.createElement("input");
        this.fileInput.type = "file";
        this.fileInput.accept = "image/*";
        this.fileInput.hidden = true;
        this.fileInput.addEventListener("change", () => {
            const files = Array.from(this.fileInput.files || []);
            if (files.length) {
                this.eventBus.emit("canvas:import:files", {
                    files,
                    replace: true,
                    source: "easy-file-menu",
                    __easyImportHandled: false,
                });
            }
            this.fileInput.value = "";
        });
        this.hostElement?.append?.(this.fileInput);
        this.render();
        document.addEventListener("pointerdown", this._outsideHandler);
    }

    render() {
        if (!this.root) return;
        this.root.innerHTML = "";
        const fileWrap = document.createElement("div");
        fileWrap.className = "goya-easy-file-menu";

        const fileButton = this._button("File", "Open file actions");
        fileButton.classList.add("goya-easy-file-menu__trigger");
        fileButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._setFileMenuOpen(!this._fileMenuOpen);
        });

        const menu = document.createElement("div");
        menu.className = "goya-easy-file-menu__menu";
        menu.hidden = true;
        this.fileMenu = menu;

        const actions = [
            ["Import Image", () => this.fileInput?.click?.()],
            ["Save Image", () => this.eventBus.emit("canvas:export:save", { format: "png", source: "easy-file-menu" })],
            ["Export PNG", () => this.eventBus.emit("canvas:export:png", { source: "easy-file-menu" })],
            ["Export JPG", () => this.eventBus.emit("canvas:export:jpg", { source: "easy-file-menu" })],
        ];
        for (const [label, handler] of actions) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "goya-easy-file-menu__item";
            item.textContent = label;
            item.addEventListener("click", (event) => {
                event.preventDefault();
                this._setFileMenuOpen(false);
                handler();
            });
            menu.append(item);
        }

        fileWrap.append(fileButton, menu);
        this.root.append(fileWrap);
    }

    cleanup() {
        document.removeEventListener("pointerdown", this._outsideHandler);
        this.fileInput?.remove?.();
        this.root?.remove?.();
        this.fileInput = null;
        this.root = null;
    }

    _button(label, title = label) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "goya-easy-topbar-btn";
        button.title = title;
        button.textContent = label;
        return button;
    }

    _setFileMenuOpen(open) {
        this._fileMenuOpen = !!open;
        if (this.fileMenu) this.fileMenu.hidden = !this._fileMenuOpen;
        this.root?.classList?.toggle("is-file-open", this._fileMenuOpen);
    }

    _handleOutsidePointer(event) {
        if (!this._fileMenuOpen) return;
        if (this.root?.contains?.(event.target)) return;
        this._setFileMenuOpen(false);
    }
}
