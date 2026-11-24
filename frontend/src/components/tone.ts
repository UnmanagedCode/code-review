// Text colours for small (12px) text on a tint of the same hue: the token mixed toward the foreground, so it keeps its hue
// and reaches AA contrast in both themes (the bare token is about 3:1 on its own tint in the light theme).
export const PRIMARY_TEXT = 'text-[color-mix(in_oklab,var(--primary)_45%,var(--foreground))]';
export const SUCCESS_TEXT = 'text-[color-mix(in_oklab,var(--success)_45%,var(--foreground))]';
export const INFO_TEXT = 'text-[color-mix(in_oklab,var(--info)_45%,var(--foreground))]';
