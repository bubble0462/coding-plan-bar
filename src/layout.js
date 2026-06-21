const POPUP_WIDTH = 420;
const POPUP_MIN_HEIGHT = 180;
const POPUP_MAX_VISIBLE_PROVIDERS = 3;

const OUTER_PADDING_Y = 24;
const FIXED_CHROME_HEIGHT = 123;
const PROVIDER_LIST_PADDING_Y = 18;
const PROVIDER_GAP = 8;
const EMPTY_PROVIDER_HEIGHT = 72;

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

  const messageHeight = provider.message ? 22 : 0;
  if (provider.balance) return 112 + messageHeight;

  const tierCount = Math.max(1, Array.isArray(provider.tiers) ? provider.tiers.length : 0);
  return 64 + tierCount * 46 + Math.max(0, tierCount - 1) * 8 + messageHeight;
}

module.exports = {
  POPUP_WIDTH,
  POPUP_MAX_VISIBLE_PROVIDERS,
  computePopupHeight,
  isProviderListScrollable,
  estimateProviderHeight,
};
