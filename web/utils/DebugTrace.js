function isOverlayEnabled() {
    try {
        if (typeof window === 'undefined') return false;
        if (window.__IAMCCS_ENABLE_DEBUG_TRACE_OVERLAY__ === true) return true;
        return localStorage.getItem('iamccs_debug_trace_overlay') === '1';
    } catch (_e) {
        return false;
    }
}

function ensureOverlay() {
    if (typeof document === 'undefined') return null;
    if (!isOverlayEnabled()) return null;
    let overlay = document.getElementById('iamccs-debug-trace-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'iamccs-debug-trace-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        width: 'min(420px, 42vw)',
        maxHeight: '38vh',
        overflow: 'auto',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'rgba(10, 12, 18, 0.92)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 18px 42px rgba(0,0,0,0.35)',
        color: '#dfeaff',
        fontFamily: 'Consolas, monospace',
        fontSize: '11px',
        lineHeight: '1.45',
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(overlay);
    return overlay;
}

export function debugTrace(label, payload = null) {
    try {
        const enabled = isOverlayEnabled();
        const entry = {
            at: new Date().toISOString(),
            label: String(label || ''),
            payload,
        };
        const trace = Array.isArray(window.__IAMCCS_DEBUG_TRACE__) ? window.__IAMCCS_DEBUG_TRACE__ : [];
        trace.push(entry);
        window.__IAMCCS_DEBUG_TRACE__ = trace.slice(-120);
        window.__IAMCCS_LAST_DEBUG__ = entry;
        if (enabled) {
            console.warn(label, payload);
        }
        try {
            window.dispatchEvent(new CustomEvent('iamccs:debug-trace', { detail: entry }));
        } catch (_e) {}

        const overlay = enabled ? ensureOverlay() : null;
        if (overlay) {
            const lines = window.__IAMCCS_DEBUG_TRACE__.slice(-8).map((item) => {
                const shortTime = String(item.at || '').split('T')[1]?.replace('Z', '') || item.at;
                let details = '';
                try {
                    details = item.payload == null ? '' : ` ${JSON.stringify(item.payload)}`;
                } catch (_e) {
                    details = ' [unserializable payload]';
                }
                return `${shortTime} ${item.label}${details}`;
            });
            overlay.textContent = lines.join('\n');
        }
    } catch (_e) {
        try { console.warn(label, payload); } catch (_err) {}
    }
}
