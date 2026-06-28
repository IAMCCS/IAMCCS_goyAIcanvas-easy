const UIHelpers = {
    createElement(tag, className, options = {}) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (options.text) {
            element.textContent = options.text;
        }
        if (options.html) {
            element.innerHTML = options.html;
        }
        if (options.style && typeof options.style === "object") {
            Object.entries(options.style).forEach(([k, v]) => {
                try {
                    element.style[k] = v;
                } catch (_) {}
            });
        }
        if (options.attrs) {
            Object.entries(options.attrs).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    element.setAttribute(key, value);
                }
            });
        }
        return element;
    },

    createField(label, input) {
        const wrapper = this.createElement("div", "goya-field");
        const labelEl = this.createElement("label", "goya-label", { text: label });
        wrapper.append(labelEl, input);
        return wrapper;
    },

    createSelect(options, selected) {
        const select = this.createElement("select", "goya-select");
        options.forEach((item) => {
            const option = document.createElement("option");
            if (typeof item === "string") {
                option.value = item;
                option.textContent = item;
            } else {
                option.value = item.value;
                option.textContent = item.label;
            }
            if (item === selected || item.value === selected) {
                option.selected = true;
            }
            select.append(option);
        });
        return select;
    },

    createSlider(config) {
        const input = this.createElement("input", "goya-input");
        input.type = "range";
        input.min = config.min ?? 0;
        input.max = config.max ?? 1;
        input.step = config.step ?? 0.01;
        input.value = config.value ?? config.min ?? 0;
        // apply visual style from global toggle
        try {
            const style = (window.goyaSliderStyle || (localStorage.getItem("iamccs_slider_style") || "default")).toLowerCase();
            if (style === 'analogic') {
                input.classList.add('goya-slider--analogic');
            }
        } catch (_e) {}
        return input;
    },

    createButton(label, onClick, extraClass = "") {
        const button = this.createElement("button", `goya-button ${extraClass}`.trim(), {
            text: label,
        });
        if (onClick) {
            button.addEventListener("click", onClick);
        }
        return button;
    },
};

export default UIHelpers;
