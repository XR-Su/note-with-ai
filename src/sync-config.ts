// Public API address only. Cloud provider keys never belong in the front-end.
// Sync is paused by default. Set VITE_SYNC_URL explicitly after reopening the cloud route.
export const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_URL || '';
