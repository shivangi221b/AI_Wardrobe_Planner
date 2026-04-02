/**
 * Analytics no-ops on native; implementations live in ``analytics.web.ts``.
 */
export function initAnalytics(): void {}

export function trackAuthSuccess(provider: string): void {
  void provider;
}
