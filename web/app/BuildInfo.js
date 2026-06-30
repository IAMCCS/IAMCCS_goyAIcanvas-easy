export const GOYA_BUILD_INFO = Object.freeze({
    id: 'GOYA-EASY-IMMEDIATE-EDIT-RESULT-20260630-02',
    label: 'Easy immediate edit result 02',
    date: '2026-06-30',
    entrypoint: 'web/index.js -> web/IAMCCS_EasyFullNodeUI.js',
});

export function getGoyaBuildLabel() {
    return `${GOYA_BUILD_INFO.id} / ${GOYA_BUILD_INFO.label}`;
}

