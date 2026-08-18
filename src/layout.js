const POPUP_WIDTH = 420;
const POPUP_MIN_HEIGHT = 180;
// Compact overview rows are ~48px tall, so more of them fit before the list
// switches to a scrollable viewport.
const POPUP_MAX_VISIBLE_PROVIDERS = 6;

const OUTER_PADDING_Y = 24;
// Header + provider selector row + footer + paddings estimate. The measured
// height from the renderer takes over after the first layout pass.
const FIXED_CHROME_HEIGHT = 161;
const PROVIDER_LIST_PADDING_Y = 18;
const PROVIDER_GAP = 8;
const EMPTY_PROVIDER_HEIGHT = 72;
const OVERVIEW_ROW_HEIGHT = 48;

function computePopupHeight(providers = []) {
  const visibleProviders = providers.slice(0, POPUP_MAX_VISIBLE_PROVIDERS);
  const rowCount = Math.max(1, visibleProviders.length);
  const rowHeights = visibleProviders.length
    ? visibleProviders.reduce((total, provider) => total + estimateProviderHeight(provider), 0)
    : EMPTY_PROVIDER_HEIGHT;

  const listHeight = PROVIDER_LIST_PADDING_Y + rowHeights + Math.max(0, rowCount - 1) * PROVIDER_GAP;
  return Math.max(POPUP_MIN_HEIGHT, Math.round(OUTER_PADDING_Y + FIXED_CHROME_HEIGHT + listHeight));
}

function isProviderListScrollable(providers = []) {
  return providers.length > POPUP_MAX_VISIBLE_PROVIDERS;
}

function estimateProviderHeight(provider) {
  if (!provider) return EMPTY_PROVIDER_HEIGHT;
  // The all view renders compact overview rows; detail views are measured.
  return OVERVIEW_ROW_HEIGHT;
}

module.exports = {
  POPUP_WIDTH,
  POPUP_MAX_VISIBLE_PROVIDERS,
  computePopupHeight,
  isProviderListScrollable,
  estimateProviderHeight,
};
