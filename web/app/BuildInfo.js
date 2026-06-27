export const GOYA_BUILD_INFO = Object.freeze({
    id: 'GOYA-EASY-HIDDEN-OUTPUT-20260627-01',
    label: 'Easy backend output hidden from UI',
    date: '2026-06-27',
    entrypoint: 'web/index.js -> web/IAMCCS_EasyFullNodeUI.js',
});

export function getGoyaBuildLabel() {
    return `${GOYA_BUILD_INFO.id} / ${GOYA_BUILD_INFO.label}`;
}
