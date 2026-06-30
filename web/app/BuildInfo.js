export const GOYA_BUILD_INFO = Object.freeze({
    id: 'GOYA-EASY-OUTPAINT-CONDITIONING-20260630-01',
    label: 'Easy outpaint conditioning 01',
    date: '2026-06-30',
    entrypoint: 'web/index.js -> web/IAMCCS_EasyFullNodeUI.js',
});

export function getGoyaBuildLabel() {
    return `${GOYA_BUILD_INFO.id} / ${GOYA_BUILD_INFO.label}`;
}

