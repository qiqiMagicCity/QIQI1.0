
// DEBUG:EOD-TIMELINE-AUDIT
export const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let seq = 0;

export function audit(tag: string, payload: any) {
    if (typeof window !== 'undefined') {
        console.log("[EOD-TIMELINE-AUDIT]", {
            runId,
            seq: ++seq,
            ts: performance.now().toFixed(1),
            tag,
            ...payload
        });
    } else {
        // Node environment fallback
        console.log("[EOD-TIMELINE-AUDIT]", {
            runId,
            seq: ++seq,
            ts: Date.now(),
            tag,
            ...payload
        });
    }
}
