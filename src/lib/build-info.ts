export const BUILD_ID = process.env.NEXT_PUBLIC_COMMIT_HASH ?? process.env.VITE_COMMIT_HASH ?? 'dev-' + Math.random().toString(36).substring(2, 8);
export const BUILD_TIME = new Date().toISOString();
export const EOD_RULE_REV = 'closeFinite-v6';
