// Public API address only. Cloud provider keys never belong in the front-end.
// Tencent Cloud default gateway: test environment only; production needs a custom domain.
export const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_URL || 'https://feminist-newt-d4gev6coze447032d-1300255149.ap-shanghai.app.tcloudbase.com/diary-sync';
