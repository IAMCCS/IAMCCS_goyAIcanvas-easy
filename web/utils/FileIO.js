const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
};

const FileIO = {
    saveJson(data, filename = "goya_canvas.json") {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        downloadBlob(blob, filename);
    },

    savePng(canvas, filename = "goya_canvas.png") {
        canvas.toBlob((blob) => {
            if (!blob) {
                return;
            }
            downloadBlob(blob, filename);
        }, "image/png");
    },

    saveJpeg(canvas, filename = "goya_canvas.jpg", quality = 0.92) {
        const q = Math.max(0.0, Math.min(1.0, Number(quality) || 0.92));
        canvas.toBlob((blob) => {
            if (!blob) {
                return;
            }
            downloadBlob(blob, filename);
        }, "image/jpeg", q);
    },

    async openJson() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.addEventListener("change", () => {
                const file = input.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    try {
                        const result = JSON.parse(reader.result);
                        resolve(result);
                    } catch (error) {
                        console.error("Failed to parse JSON", error);
                        resolve(null);
                    }
                });
                reader.readAsText(file);
            });
            input.click();
        });
    },
};

export default FileIO;
