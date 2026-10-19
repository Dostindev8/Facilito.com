/**
 * Feature flags for ERP+ modules. Ready routes stay on; previews show "Próximamente".
 * Plan-gated flags can be wired later without renaming routes.
 */
export const FEATURES = {
  /** Show upcoming modules in the sidebar (honest "Próximamente" pages). */
  navPreview: true,
  /** Command palette (⌘/Ctrl+K). */
  commandPalette: true,
  /** Rich profile menu (activity, version, last access). */
  richProfileMenu: true,
  /** Live clock in app header. */
  headerClock: true,
  /** Dashboard NCF sequences + health strip. */
  dashboardFiscalHealth: true,
} as const;

export type FeatureFlag = keyof typeof FEATURES;

export function featureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] === true;
}
