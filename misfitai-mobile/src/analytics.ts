/**
 * Analytics no-ops on native; implementations live in ``analytics.web.ts``.
 */
export function initAnalytics(): void {}

export function trackAuthSuccess(provider: string): void {
  void provider;
}

export function trackShopImpression(_gapId: string): void {}

export function trackShopClick(_gapId: string, _productId: string): void {}

export function trackShopPurchase(_gapId: string, _productId: string): void {}
