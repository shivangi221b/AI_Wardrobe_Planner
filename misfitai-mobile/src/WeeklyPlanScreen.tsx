import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useAppState } from './AppStateContext';
import { dayLabels, dayOrder, eventTypeLabels } from './constants';
import { getImageForGarment } from './stockImages';
import type { DayOfWeek, GarmentCategory } from './types';
import { palette, radius, type } from './theme';
import { OutfitAvatarPreview, type CollagePiece } from './OutfitAvatarPreview';
import { OutfitDetailModal } from './OutfitDetailModal';
import { generateOutfitPreview, API_BASE_URL, type OutfitPreviewGarment } from './api';
import {
  trackOutfitAvatarPreviewOpen,
  trackOutfitAccepted,
} from './analytics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlaceholderName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return (
    !lower ||
    lower.includes('no item') ||
    lower.includes('not found') ||
    lower === 'n/a' ||
    lower === 'none' ||
    lower === 'null'
  );
}

function outfitSummaryLabel(rec: { outfit: { topName: string; bottomName: string; dressName?: string | null } }): string {
  if (rec.outfit.dressName && !isPlaceholderName(rec.outfit.dressName)) {
    return rec.outfit.dressName;
  }
  const parts: string[] = [];
  if (rec.outfit.topName && !isPlaceholderName(rec.outfit.topName)) {
    parts.push(rec.outfit.topName);
  }
  if (rec.outfit.bottomName && !isPlaceholderName(rec.outfit.bottomName)) {
    parts.push(rec.outfit.bottomName);
  }
  return parts.length > 0 ? parts.join(' + ') : '\u2014';
}

/** Convert a relative `/assets/…` avatar URL to a fully-qualified one for the Image component. */
function resolveAvatarUri(url: string): string {
  const q = url.indexOf('?');
  const pathPart = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : '';
  if (/^https?:\/\//i.test(pathPart)) return `${pathPart}${query}`;
  if (pathPart.startsWith('/')) return `${API_BASE_URL}${pathPart}${query}`;
  return url;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeeklyPlanScreen({
  onRegenerateWeek,
  onNavigateToWardrobe,
  onBackToCalendar,
}: {
  onRegenerateWeek: () => Promise<void>;
  onNavigateToWardrobe?: () => void;
  onBackToCalendar?: () => void;
}) {
  const { garments, recommendations, toggleGarmentHidden, userProfile, userId } = useAppState();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('monday');

  // "Items" (collage) vs "On Me" (avatar) toggle
  const [viewMode, setViewMode] = useState<'items' | 'on-me'>('items');

  // Avatar detail modal
  const [detailVisible, setDetailVisible] = useState(false);

  // Per-day composite image cache: outfitId → URL
  const [compositeCache, setCompositeCache] = useState<Record<string, string>>({});
  const [generatingComposite, setGeneratingComposite] = useState(false);

  // Track how long the user has been on a day in "on-me" mode for implicit acceptance
  const onMeEntryTime = useRef<number | null>(null);

  const cardFade = useRef(new Animated.Value(0)).current;
  const pieceAnimations = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;

  const avatarImageUrl = useMemo(() => {
    const raw = userProfile?.avatarConfig?.avatarImageUrl;
    return raw ? resolveAvatarUri(raw) : null;
  }, [userProfile]);

  // Prefetch avatar portrait as soon as it is available
  useEffect(() => {
    if (avatarImageUrl) {
      ExpoImage.prefetch(avatarImageUrl).catch(() => {});
    }
  }, [avatarImageUrl]);

  useEffect(() => {
    if (recommendations.length === 0) return;
    const selectedExists = recommendations.some((item) => item.day === selectedDay);
    if (!selectedExists) {
      setSelectedDay(recommendations[0].day);
    }
  }, [recommendations, selectedDay]);

  const selectedRecommendation = useMemo(() => {
    if (recommendations.length === 0) return null;
    return recommendations.find((item) => item.day === selectedDay) || recommendations[0];
  }, [recommendations, selectedDay]);

  // Animate card whenever the day changes
  useEffect(() => {
    if (!selectedRecommendation) return;
    cardFade.setValue(0);
    pieceAnimations.forEach((value) => value.setValue(0));
    Animated.parallel([
      Animated.timing(cardFade, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.stagger(
        80,
        pieceAnimations.map((value) =>
          Animated.timing(value, { toValue: 1, duration: 320, useNativeDriver: true })
        )
      ),
    ]).start();
  }, [selectedRecommendation, cardFade, pieceAnimations]);

  // Track implicit acceptance when leaving a day after viewing it in "on-me" mode for >2 s
  const handleDayChange = (day: DayOfWeek) => {
    if (viewMode === 'on-me' && onMeEntryTime.current !== null) {
      const elapsed = Date.now() - onMeEntryTime.current;
      if (elapsed >= 2000 && selectedRecommendation) {
        trackOutfitAccepted(selectedRecommendation.day, selectedRecommendation.eventType);
      }
    }
    // Reset entry time; immediately restart it if still in "on-me" mode so
    // acceptance tracking fires correctly for the newly selected day too.
    onMeEntryTime.current = viewMode === 'on-me' ? Date.now() : null;
    setSelectedDay(day);
  };

  // Record when user enters "on-me" mode
  const handleViewModeChange = (mode: 'items' | 'on-me') => {
    if (mode === 'on-me' && selectedRecommendation) {
      trackOutfitAvatarPreviewOpen(selectedRecommendation.day, selectedRecommendation.eventType);
      onMeEntryTime.current = Date.now();
    } else {
      onMeEntryTime.current = null;
    }
    setViewMode(mode);
  };

  const handleRegenerate = async () => {
    try {
      setRegenerating(true);
      setError(null);
      await onRegenerateWeek();
    } catch {
      setError('Failed to regenerate week.');
    } finally {
      setRegenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Build collage pieces
  // ---------------------------------------------------------------------------

  const dressId = selectedRecommendation?.outfit.dressId;
  const dressGarment = dressId ? garments.find((item) => item.id === dressId) : undefined;
  const isDressOutfit = Boolean(dressId);

  const topGarment = selectedRecommendation
    ? garments.find((item) => item.id === selectedRecommendation.outfit.topId)
    : undefined;
  const bottomGarment = selectedRecommendation
    ? garments.find((item) => item.id === selectedRecommendation.outfit.bottomId)
    : undefined;
  const outerwearGarment = garments.find((item) => item.category === 'outerwear');
  const shoesGarment = garments.find((item) => item.category === 'shoes');

  const dressName = selectedRecommendation?.outfit.dressName || dressGarment?.name || '';
  const topName = selectedRecommendation?.outfit.topName || topGarment?.name || '';
  const bottomName = selectedRecommendation?.outfit.bottomName || bottomGarment?.name || '';

  const collagePieces: CollagePiece[] = [];

  const missingTop = !isDressOutfit && (!topName || isPlaceholderName(topName));
  const missingBottom = !isDressOutfit && (!bottomName || isPlaceholderName(bottomName));
  const hasMissingItems = missingTop || missingBottom;

  if (isDressOutfit && dressName && !isPlaceholderName(dressName)) {
    collagePieces.push({
      name: dressName,
      image: dressGarment?.primaryImageUrl
        ? { uri: dressGarment.primaryImageUrl }
        : getImageForGarment(dressName, 'dress'),
      garmentId: dressGarment?.id,
      hidden: dressGarment?.hiddenFromRecommendations,
      category: 'dress' as GarmentCategory,
    });
  } else {
    if (!missingTop) {
      collagePieces.push({
        name: topName,
        image: topGarment?.primaryImageUrl
          ? { uri: topGarment.primaryImageUrl }
          : getImageForGarment(topName, 'top'),
        garmentId: topGarment?.id,
        hidden: topGarment?.hiddenFromRecommendations,
        category: 'top' as GarmentCategory,
      });
    }
    if (!missingBottom) {
      collagePieces.push({
        name: bottomName,
        image: bottomGarment?.primaryImageUrl
          ? { uri: bottomGarment.primaryImageUrl }
          : getImageForGarment(bottomName, 'bottom'),
        garmentId: bottomGarment?.id,
        hidden: bottomGarment?.hiddenFromRecommendations,
        category: 'bottom' as GarmentCategory,
      });
    }
  }
  if (outerwearGarment) {
    collagePieces.push({
      name: outerwearGarment.name,
      image: outerwearGarment.primaryImageUrl
        ? { uri: outerwearGarment.primaryImageUrl }
        : getImageForGarment(outerwearGarment.name, 'outerwear'),
      garmentId: outerwearGarment.id,
      hidden: outerwearGarment.hiddenFromRecommendations,
      category: 'outerwear' as GarmentCategory,
    });
  }
  if (shoesGarment) {
    collagePieces.push({
      name: shoesGarment.name,
      image: shoesGarment.primaryImageUrl
        ? { uri: shoesGarment.primaryImageUrl }
        : getImageForGarment(shoesGarment.name, 'shoes'),
      garmentId: shoesGarment.id,
      hidden: shoesGarment.hiddenFromRecommendations,
      category: 'shoes' as GarmentCategory,
    });
  }

  // ---------------------------------------------------------------------------
  // Composite generation
  // ---------------------------------------------------------------------------

  const currentOutfitId = selectedRecommendation?.outfit.id ?? null;
  const currentCompositeUrl = currentOutfitId ? (compositeCache[currentOutfitId] ?? null) : null;

  const handleGenerateComposite = async () => {
    if (!currentOutfitId || generatingComposite || !avatarImageUrl) return;

    // Build the list of garment images with real URLs only
    const garmentImages: OutfitPreviewGarment[] = collagePieces
      .filter((p) => !p.hidden)
      .map((p) => {
        const src = p.image;
        const url =
          typeof src === 'object' && src !== null && !Array.isArray(src) && 'uri' in src
            ? (src as { uri: string }).uri
            : '';
        return { url, name: p.name, category: p.category ?? 'top' };
      })
      .filter((g) => g.url.startsWith('http'));

    if (garmentImages.length === 0) {
      Alert.alert('No garment images', 'Add photos to your wardrobe items to enable outfit preview.');
      return;
    }

    setGeneratingComposite(true);
    try {
      const url = await generateOutfitPreview(userId, currentOutfitId, avatarImageUrl, garmentImages);
      setCompositeCache((prev) => ({ ...prev, [currentOutfitId]: url }));
    } catch {
      Alert.alert('Preview unavailable', 'Could not build the outfit preview. Please try again later.');
    } finally {
      setGeneratingComposite(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Piece long-press (hide/unhide) — shared between collage & detail modal
  // ---------------------------------------------------------------------------

  const handlePieceLongPress = (piece: CollagePiece) => {
    if (!piece.garmentId) return;
    const action = piece.hidden ? 'Unhide' : 'Hide';
    Alert.alert(
      `${action} from recommendations?`,
      piece.hidden
        ? `"${piece.name}" will appear in future recommendations again.`
        : `"${piece.name}" will no longer be suggested in outfit recommendations.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: piece.hidden ? 'default' : 'destructive',
          onPress: () => {
            toggleGarmentHidden(piece.garmentId!, !piece.hidden).catch(() => {
              Alert.alert('Error', 'Could not update garment visibility. Please try again.');
            });
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasAvatar = Boolean(avatarImageUrl);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Your weekly lookbook</Text>
        <Text style={styles.screenSubtitle}>
          Select a day to preview your recommended outfit.
        </Text>

        {recommendations.length === 0 ? (
          <Text style={styles.helperText}>
            No recommendations yet. Go to Calendar and tap "Next: Generate outfits".
          </Text>
        ) : null}

        {selectedRecommendation ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayTabs}>
              {dayOrder.map((day) => {
                const active = selectedDay === day;
                const hasRecommendation = recommendations.some((item) => item.day === day);
                return (
                  <Pressable
                    key={day}
                    onPress={() => handleDayChange(day)}
                    style={[styles.dayTab, active && styles.dayTabActive, !hasRecommendation && styles.dayTabMuted]}
                  >
                    <Text style={[styles.dayTabText, active && styles.dayTabTextActive]}>
                      {dayLabels[day].slice(0, 3)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Animated.View
              style={[
                styles.lookCard,
                {
                  opacity: cardFade,
                  transform: [
                    {
                      translateY: cardFade.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.lookHeading}>Recommended outfit</Text>
              <Text style={styles.lookReason}>{selectedRecommendation.explanation}</Text>

              {/* View mode toggle — only show "On Me" when avatar exists */}
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleBtn, viewMode === 'items' && styles.toggleBtnActive]}
                  onPress={() => handleViewModeChange('items')}
                >
                  <Text style={[styles.toggleBtnText, viewMode === 'items' && styles.toggleBtnTextActive]}>
                    Items
                  </Text>
                </Pressable>
                {hasAvatar ? (
                  <Pressable
                    style={[styles.toggleBtn, viewMode === 'on-me' && styles.toggleBtnActive]}
                    onPress={() => handleViewModeChange('on-me')}
                  >
                    <Text style={[styles.toggleBtnText, viewMode === 'on-me' && styles.toggleBtnTextActive]}>
                      On Me
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {viewMode === 'items' ? (
                <>
                  <View style={styles.collageGrid}>
                    {collagePieces.map((piece, index) => {
                      const pieceAnim = pieceAnimations[index];
                      return (
                        <Animated.View
                          key={`${piece.name}-${index}`}
                          style={[
                            styles.pieceCard,
                            piece.hidden && styles.pieceCardHidden,
                            {
                              opacity: pieceAnim,
                              transform: [
                                {
                                  scale: pieceAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.96, 1],
                                  }),
                                },
                              ],
                            },
                          ]}
                        >
                          <Pressable
                            onLongPress={() => handlePieceLongPress(piece)}
                            delayLongPress={400}
                            style={styles.piecePressable}
                          >
                            <Image source={piece.image} style={styles.pieceImage} resizeMode="contain" />
                            <Text style={styles.pieceLabel}>{piece.name}</Text>
                            {piece.hidden ? (
                              <Text style={styles.pieceHiddenBadge}>Hidden</Text>
                            ) : null}
                          </Pressable>
                        </Animated.View>
                      );
                    })}
                  </View>

                  {hasMissingItems ? (
                    <View style={styles.missingItemsBanner}>
                      <Text style={styles.missingItemsTitle}>
                        {missingTop && missingBottom
                          ? 'Your wardrobe needs a top and a bottom'
                          : missingTop
                            ? 'We need a top to complete this outfit'
                            : 'We need a bottom to complete this outfit'}
                      </Text>
                      <Text style={styles.missingItemsBody}>
                        {missingTop && missingBottom
                          ? 'Add at least one top (shirt, blouse, sweater) and one bottom (pants, jeans, skirt) to see complete outfits.'
                          : missingTop
                            ? 'Add a shirt, blouse, or sweater to your wardrobe so we can build a full outfit.'
                            : 'Add pants, jeans, or a skirt to your wardrobe so we can build a full outfit.'}
                      </Text>
                      {onNavigateToWardrobe ? (
                        <Pressable onPress={onNavigateToWardrobe} style={styles.missingItemsButton}>
                          <Text style={styles.missingItemsButtonText}>
                            {missingTop && missingBottom
                              ? 'Add garments \u2192'
                              : missingTop
                                ? 'Add a top \u2192'
                                : 'Add a bottom \u2192'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : (
                <OutfitAvatarPreview
                  avatarImageUrl={avatarImageUrl}
                  collagePieces={collagePieces}
                  compositeImageUrl={currentCompositeUrl}
                  generating={generatingComposite}
                  onGenerateComposite={handleGenerateComposite}
                  onTap={() => setDetailVisible(true)}
                />
              )}
            </Animated.View>

            <View style={styles.weekList}>
              <Text style={styles.weekListTitle}>Week summary</Text>
              {recommendations.map((rec) => (
                <View key={rec.day} style={styles.weekRow}>
                  <View style={styles.weekRowLeft}>
                    <Text style={styles.weekDay}>{dayLabels[rec.day]}</Text>
                    <Text style={styles.weekEvent}>{eventTypeLabels[rec.eventType]}</Text>
                  </View>
                  <Text style={styles.weekOutfit} numberOfLines={1}>
                    {outfitSummaryLabel(rec)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {onBackToCalendar ? (
          <Pressable onPress={onBackToCalendar} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back to calendar</Text>
          </Pressable>
        ) : null}

        {recommendations.length > 0 ? (
          <Pressable onPress={handleRegenerate} style={styles.primaryButton} disabled={regenerating}>
            <Text style={styles.primaryButtonText}>
              {regenerating ? 'Regenerating week...' : 'Regenerate week'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Full-screen detail modal */}
      {selectedRecommendation ? (
        <OutfitDetailModal
          visible={detailVisible}
          onClose={() => setDetailVisible(false)}
          avatarImageUrl={avatarImageUrl}
          compositeImageUrl={currentCompositeUrl}
          collagePieces={collagePieces}
          explanation={selectedRecommendation.explanation}
          dayLabel={dayLabels[selectedRecommendation.day]}
          eventLabel={eventTypeLabels[selectedRecommendation.eventType]}
          onLongPressPiece={handlePieceLongPress}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 10,
  },
  screenTitle: {
    fontSize: 33,
    lineHeight: 36,
    color: palette.ink,
    fontFamily: type.display,
  },
  screenSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: palette.muted,
    fontFamily: type.body,
  },
  helperText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: type.body,
  },
  dayTabs: {
    gap: 8,
    paddingRight: 8,
  },
  dayTab: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dayTabActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  dayTabMuted: {
    opacity: 0.56,
  },
  dayTabText: {
    color: palette.inkSoft,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  dayTabTextActive: {
    color: palette.textOnAccent,
  },
  lookCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 12,
  },
  lookHeading: {
    fontSize: 28,
    lineHeight: 31,
    color: palette.ink,
    fontFamily: type.display,
  },
  lookReason: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: type.body,
  },
  toggleRow: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  toggleBtn: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    backgroundColor: palette.panel,
  },
  toggleBtnActive: {
    backgroundColor: palette.accent,
  },
  toggleBtnText: {
    color: palette.inkSoft,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  toggleBtnTextActive: {
    color: palette.textOnAccent,
  },
  collageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  pieceCard: {
    width: '48%',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    overflow: 'hidden',
  },
  pieceCardHidden: {
    opacity: 0.45,
    borderStyle: 'dashed',
    borderColor: palette.lineStrong,
  },
  piecePressable: {
    padding: 10,
    alignItems: 'center',
  },
  pieceImage: {
    width: '100%',
    height: 122,
  },
  pieceLabel: {
    marginTop: 6,
    color: palette.ink,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: type.bodyDemi,
  },
  pieceHiddenBadge: {
    marginTop: 4,
    color: palette.muted,
    fontSize: 10,
    fontFamily: type.bodyDemi,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  missingItemsBanner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderStyle: 'dashed',
    backgroundColor: palette.accentSoft,
    padding: 14,
    gap: 6,
    alignItems: 'flex-start',
  },
  missingItemsTitle: {
    color: palette.ink,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  missingItemsBody: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: type.body,
  },
  missingItemsButton: {
    marginTop: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  missingItemsButtonText: {
    color: palette.accent,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  weekList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
  },
  weekListTitle: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
    marginBottom: 8,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 8,
  },
  weekRowLeft: {
    flexShrink: 0,
  },
  weekDay: {
    color: palette.inkSoft,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  weekEvent: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.body,
  },
  weekOutfit: {
    flex: 1,
    color: palette.ink,
    fontSize: 12,
    fontFamily: type.bodyMedium,
    textAlign: 'right',
  },
  errorText: {
    color: palette.error,
    fontSize: 13,
    fontFamily: type.body,
  },
  primaryButton: {
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: palette.textOnAccent,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  secondaryButton: {
    marginTop: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    backgroundColor: palette.accentSoft,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
