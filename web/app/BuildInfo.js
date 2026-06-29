export const GOYA_BUILD_INFO = Object.freeze({
    id: 'GOYA-EASY-CLEAN-CORE-20260630-26',
    label: 'Easy clean core refactor 26',
    date: '2026-06-29',
    entrypoint: 'web/index.js -> web/IAMCCS_EasyFullNodeUI.js',
});

export function getGoyaBuildLabel() {
    return `${GOYA_BUILD_INFO.id} / ${GOYA_BUILD_INFO.label}`;
}

