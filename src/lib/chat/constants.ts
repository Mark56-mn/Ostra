/**
 * Client-side chat limits.
 *
 * The server is the authority (it reads OSTRA_MAX_MESSAGE_LENGTH and rejects
 * anything longer); these values only drive the UI counter and early warning,
 * so nothing secret or server-only is imported here.
 */
export const CLIENT_MAX_MESSAGE_LENGTH = 8_000;
export const WARN_MESSAGE_LENGTH = 6_000;
export const CLIENT_HISTORY_LIMIT = 24;
