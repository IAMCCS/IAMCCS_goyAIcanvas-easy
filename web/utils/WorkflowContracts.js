import Constants from './Constants.js';

const CACHE = new Map();

export async function loadWorkflowContract(contractId) {
    const id = String(contractId || '').trim();
    if (!id) throw new Error('Missing workflow contract id');
    if (CACHE.has(id)) return CACHE.get(id);
    const response = await fetch(`${Constants.API_BASE}/contracts/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false || !data?.contract) {
        throw new Error(data?.error || `Workflow contract '${id}' is not available`);
    }
    CACHE.set(id, data.contract);
    return data.contract;
}

export async function checkWorkflowContract(contractId, payload) {
    const id = String(contractId || '').trim();
    if (!id) throw new Error('Missing workflow contract id');
    const body = {
        ...(payload || {}),
        extra: {
            ...((payload && payload.extra) || {}),
            generation_contract: id,
        },
    };
    const response = await fetch(`${Constants.API_BASE}/contracts/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
        const message = data?.message || data?.error || `Workflow '${id}' is not available`;
        const error = new Error(message);
        error.validation = data;
        throw error;
    }
    return data;
}
