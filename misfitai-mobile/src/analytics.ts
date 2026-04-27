/**
 * Analytics no-ops on native; implementations live in ``analytics.web.ts``.
 */
export function initAnalytics(): void {}

export function trackAuthSuccess(provider: string): void {
  void provider;
}

export function trackOutfitAvatarPreviewOpen(day: string, eventType: string): void {
  void day;
  void eventType;
}

export function trackOutfitAccepted(day: string, eventType: string): void {
  void day;
  void eventType;
}
