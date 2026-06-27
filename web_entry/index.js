function sanitizeCorruptIamccsWorkflowDrafts() {
    try {
        const storage = window.localStorage;
        if (!storage) return;
        const keys = [];
        for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key) keys.push(key);
        }
        keys.forEach((key) => {
            const keyLower = String(key || "").toLowerCase();
            if (!/(workflow|draft|tab)/.test(keyLower)) return;
            const value = String(storage.getItem(key) || "");
            if (!value.trim().startsWith("[IAMCCS")) return;
            try {
                JSON.parse(value);
            } catch (_error) {
                try {
                    storage.setItem(`iamccs:corrupt-draft-backup:${Date.now()}:${key}`, value.slice(0, 2000));
                } catch (_backupError) {}
                storage.removeItem(key);
                console.warn("[IAMCCS Easy] Removed corrupt ComfyUI workflow draft from localStorage", { key });
            }
        });
    } catch (error) {
        console.warn("[IAMCCS Easy] Workflow draft sanitizer skipped", error);
    }
}

sanitizeCorruptIamccsWorkflowDrafts();
await import("/iamccs/goyai_easy_static/index.js?v=20260627_EASY_HIDDEN_OUTPUT01");

try {
    window.__IAMCCS_RUNTIME_DIAGNOSTICS__ = {
        ...(window.__IAMCCS_RUNTIME_DIAGNOSTICS__ || {}),
        easyStandaloneEntrypoint: true,
        entrypoint: "web_entry/index.js",
    };
} catch (_e) {}
