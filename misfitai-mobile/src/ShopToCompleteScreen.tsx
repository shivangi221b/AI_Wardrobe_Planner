import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  API_BASE_URL,
  getApiErrorMessage,
  getShopSuggestions,
  markShopPurchased,
  postShopEvent,
} from './api';
import { trackShopClick, trackShopImpression, trackShopPurchase } from './analytics';
import { palette, radius, type } from './theme';
import type { ShopProductOption, WardrobeGapSuggestion } from './types';

function ProductThumbnail({
  uri,
  title,
  productId,
}: {
  uri: string;
  title: string;
  productId: string;
}) {
  const fallback = React.useMemo(
    () =>
      `https://placehold.co/320x320/eaeaea/1a1a1a/png?text=${encodeURIComponent((title || 'Product').slice(0, 28))}`,
    [title]
  );
  const [src, setSrc] = React.useState(uri);
  React.useEffect(() => {
    setSrc(uri);
  }, [uri, productId]);

  return (
    <Image
      source={{ uri: src }}
      style={styles.productImg}
      onError={() => setSrc((current) => (current === fallback ? current : fallback))}
    />
  );
}

export function ShopToCompleteScreen({
  userId,
  onWardrobeUpdated,
}: {
  userId: string;
  onWardrobeUpdated: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<WardrobeGapSuggestion[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getShopSuggestions(userId);
      setGaps(res.gaps);
    } catch (err) {
      const hint = __DEV__
        ? `${getApiErrorMessage(err, '')}\nAPI: ${API_BASE_URL}`
        : getApiErrorMessage(err, 'Could not load shop suggestions.');
      setError(
        hint.trim() ||
          'Could not load shop suggestions. Check EXPO_PUBLIC_API_BASE_URL (use your computer IP on a physical phone) and that the backend is running.'
      );
      setGaps([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!gaps.length) return;
    gaps.forEach((g) => {
      postShopEvent(userId, { gapId: g.gapId, eventType: 'impression' }).catch(() => {});
      trackShopImpression(g.gapId);
    });
  }, [gaps, userId]);

  const openProduct = useCallback(
    (gapId: string, p: ShopProductOption) => {
      const url = (p.affiliateUrl || p.merchantUrl || '').trim();
      if (!url) return;
      postShopEvent(userId, { gapId, eventType: 'click', productId: p.id }).catch(() => {});
      trackShopClick(gapId, p.id);
      Linking.openURL(url).catch(() => {
        Alert.alert('Could not open link');
      });
    },
    [userId]
  );

  const onMarkPurchased = useCallback(
    (gap: WardrobeGapSuggestion, p: ShopProductOption) => {
      Alert.alert(
        'Add to wardrobe?',
        `Add “${p.title}” as ${gap.suggestedName}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: () => {
              (async () => {
                try {
                  await markShopPurchased(userId, {
                    gapId: gap.gapId,
                    suggestedName: gap.suggestedName,
                    title: p.title,
                    primaryImageUrl: p.imageUrl,
                    category: gap.targetCategory,
                    formality: gap.targetFormality ?? undefined,
                    color: null,
                    brand: p.brand ?? null,
                    productId: p.id,
                    merchantUrl: p.merchantUrl,
                  });
                  trackShopPurchase(gap.gapId, p.id);
                  await onWardrobeUpdated();
                  await load();
                  Alert.alert('Added', 'Item saved to your wardrobe.');
                } catch {
                  Alert.alert('Save failed', 'Could not add this item. Try again.');
                }
              })();
            },
          },
        ]
      );
    },
    [userId, load, onWardrobeUpdated]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={styles.muted}>Finding gaps in your wardrobe…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.retry} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!gaps.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Your wardrobe looks complete</Text>
        <Text style={styles.muted}>Check back after you add more clothes or change your week plan.</Text>
        <Pressable style={styles.retry} onPress={load}>
          <Text style={styles.retryText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.headline}>Shop to complete your wardrobe</Text>
      <Text style={styles.disclosure}>
        Purchase links go to retailers. We may earn a commission on qualifying purchases.
      </Text>

      {gaps.map((gap) => (
        <View key={gap.gapId} style={styles.card}>
          <Text style={styles.gapTitle}>{gap.title}</Text>
          <Text style={styles.gapReason}>{gap.reason}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
            {gap.products.map((p) => (
              <View key={p.id} style={styles.product}>
                <ProductThumbnail uri={p.imageUrl} title={p.title} productId={p.id} />
                <Text style={styles.productTitle} numberOfLines={2}>
                  {p.title}
                </Text>
                {p.brand ? <Text style={styles.brand}>{p.brand}</Text> : null}
                {p.priceDisplay ? <Text style={styles.price}>{p.priceDisplay}</Text> : null}
                <Pressable
                  style={styles.btnSecondary}
                  onPress={() => openProduct(gap.gapId, p)}
                >
                  <Text style={styles.btnSecondaryText}>View</Text>
                </Pressable>
                <Pressable
                  style={styles.btnPrimary}
                  onPress={() => onMarkPurchased(gap, p)}
                >
                  <Text style={styles.btnPrimaryText}>Mark purchased</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headline: {
    fontFamily: type.title,
    fontSize: 22,
    marginBottom: 8,
    color: palette.ink,
  },
  disclosure: {
    fontFamily: type.body,
    fontSize: 13,
    color: palette.muted,
    marginBottom: 20,
    lineHeight: 18,
  },
  title: {
    fontFamily: type.bodyDemi,
    fontSize: 18,
    color: palette.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  muted: {
    fontFamily: type.body,
    fontSize: 15,
    color: palette.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  error: {
    fontFamily: type.body,
    fontSize: 15,
    color: palette.error,
    textAlign: 'center',
  },
  retry: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: palette.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  retryText: { fontFamily: type.bodyMedium, fontSize: 14, color: palette.ink },
  card: {
    backgroundColor: palette.panel,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: palette.line,
  },
  gapTitle: {
    fontFamily: type.bodyDemi,
    fontSize: 17,
    color: palette.ink,
    marginBottom: 6,
  },
  gapReason: {
    fontFamily: type.body,
    fontSize: 14,
    color: palette.muted,
    marginBottom: 12,
    lineHeight: 20,
  },
  carousel: { flexGrow: 0 },
  product: {
    width: 160,
    marginRight: 12,
    padding: 10,
    backgroundColor: palette.bgAlt,
    borderRadius: radius.md,
  },
  productImg: {
    width: '100%',
    height: 120,
    borderRadius: radius.sm,
    backgroundColor: palette.line,
  },
  productTitle: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    marginTop: 8,
    minHeight: 36,
    color: palette.ink,
  },
  brand: { fontFamily: type.body, fontSize: 12, color: palette.muted },
  price: {
    fontFamily: type.bodyDemi,
    fontSize: 13,
    marginTop: 4,
    color: palette.ink,
  },
  btnSecondary: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
  },
  btnSecondaryText: { fontFamily: type.body, fontSize: 13, color: palette.ink },
  btnPrimary: {
    marginTop: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: palette.ink,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    color: palette.textOnAccent,
    fontWeight: '600',
  },
});
