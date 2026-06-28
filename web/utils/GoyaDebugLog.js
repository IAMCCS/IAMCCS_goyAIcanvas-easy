const GOYA_DEBUG_KEY = 'goya:debug:logs';
const GOYA_DEBUG_LIMIT = 600;

function readLogs() {
    try {
        const raw = localStorage.getItem(GOYA_DEBUG_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

function writeLogs(items) {
    try {
        localStorage.setItem(GOYA_DEBUG_KEY, JSON.stringify(Array.isArray(items) ? items.slice(-GOYA_DEBUG_LIMIT) : []));
    } catch (_error) {}
}

function append(level, scope, message, payload) {
    const entry = {
        ts: new Date().toISOString(),
        level: String(level || 'info'),
        scope: String(scope || 'goya'),
        message: String(message || ''),
        payload: payload && typeof payload === 'object' ? payload : payload ?? null,
    };
    const next = readLogs().concat([entry]).slice(-GOYA_DEBUG_LIMIT);
    writeLogs(next);
    try { globalThis.__GOYA_DEBUG_LOGS__ = next; } catch (_error) {}
    return entry;
}

export function goyaDebug(scope, message, payload) {
    const entry = append('info', scope, message, payload);
    try { console.log(`[GoyaDebug][${entry.scope}] ${entry.message}`, entry.payload ?? ''); } catch (_error) {}
    return entry;
}

export function goyaDebugError(scope, message, error, payload) {
    const entry = append('error', scope, message, {
        error: String(error?.message || error || ''),
        ...(payload || {}),
    });
    try { console.error(`[GoyaDebug][${entry.scope}] ${entry.message}`, entry.payload ?? ''); } catch (_error) {}
    return entry;
}

export function clearGoyaDebugLogs() {
    writeLogs([]);
    try { globalThis.__GOYA_DEBUG_LOGS__ = []; } catch (_error) {}
}

export function getGoyaDebugLogs() {
    return readLogs();
}