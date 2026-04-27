/**
 * Google Analytics 4 for Expo Web only. Safe before launch: when
 * ``EXPO_PUBLIC_GA_MEASUREMENT_ID`` is unset, all calls are no-ops.
 */
import ReactGA from 'react-ga4';

const measurementId = process.env.EXPO_PUBLIC_GA_MEASUREMENT_ID;

let initialized = false;

export function initAnalytics(): void {
  if (initialized || !measurementId) {
    return;
  }
  initialized = true;
  ReactGA.initialize(measurementId);
}

export function trackAuthSuccess(provider: string): void {
  if (!measurementId) {
    return;
  }
  if (!initialized) {
    initAnalytics();
  }
  ReactGA.event({
    category: 'auth',
    action: 'login',
    label: provider,
  });
}

export function trackShopImpression(gapId: string): void {
  if (!measurementId) {
    return;
  }
  if (!initialized) {
    initAnalytics();
  }
  ReactGA.event({ category: 'shop', action: 'shop_impression', label: gapId });
}

export function trackShopClick(gapId: string, productId: string): void {
  if (!measurementId) {
    return;
  }
  if (!initialized) {
    initAnalytics();
  }
  ReactGA.event({
    category: 'shop',
    action: 'shop_click',
    label: `${gapId}:${productId}`,
  });
}

export function trackShopPurchase(gapId: string, productId: string): void {
  if (!measurementId) {
    return;
  }
  if (!initialized) {
    initAnalytics();
  }
  ReactGA.event({
    category: 'shop',
    action: 'shop_purchase',
    label: `${gapId}:${productId}`,
  });
}
