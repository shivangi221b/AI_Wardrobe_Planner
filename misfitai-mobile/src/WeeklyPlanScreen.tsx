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
import { useAppState } from './AppStateContext';
import { dayLabels, dayOrder, eventTypeLabels } from './constants';
import { getImageForGarment } from './stockImages';
import type { DayOfWeek } from './types';
import { palette, radius, type } from './theme';

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

export function WeeklyPlanScreen({
  onRegenerateWeek,
  onNavigateToWardrobe,
}: {
  onRegenerateWeek: () => Promise<void>;
  onNavigateToWardrobe?: () => void;
}) {
  const { garments, recommendations, toggleGarmentHidden } = useAppState();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('monday');

  const cardFade = useRef(new Animated.Value(0)).current;
  const pieceAnimations = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (recommendations.length === 0) {
      return;
    }

    const selectedExists = recommendations.some((item) => item.day === selectedDay);
    if (!selectedExists) {
      setSelectedDay(recommendations[0].day);
    }
  }, [recommendations, selectedDay]);

  const selectedRecommendation = useMemo(() => {
    if (recommendations.length === 0) {
      return null;
    }

    return recommendations.find((item) => item.day === selectedDay) || recommendations[0];
  }, [recommendations, selectedDay]);

  useEffect(() => {
    if (!selectedRecommendation) {
      return;
    }

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
          Animated.timing(value, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          })
        )
      ),
    ]).start();
  }, [selectedRecommendation, cardFade, pieceAnimations]);

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

  const dressId = selectedRecommendation?.outfit.dressId;
  const dressGarment = dressId
    ? garments.find((item) => item.id === dressId)
    : undefined;
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

  type CollagePiece = {
    name: string;
    image: { uri: string } | ReturnType<typeof getImageForGarment>;
    garmentId?: string;
    hidden?: boolean;
  };
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
    });
  }

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


  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Your weekly lookbook</Text>
        <Text style={styles.screenSubtitle}>
          Select a day to preview your recommended outfit.
        </Text>

        {recommendations.length === 0 ? (
          <Text style={styles.helperText}>
            No recommendations yet. Go to Week and tap "Generate my outfits".
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
                    onPress={() => setSelectedDay(day)}
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

        {recommendations.length > 0 ? (
          <Pressable onPress={handleRegenerate} style={styles.primaryButton} disabled={regenerating}>
            <Text style={styles.primaryButtonText}>
              {regenerating ? 'Regenerating week...' : 'Regenerate week'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
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
    color: '#f4f4f2',
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
    color: '#f4f4f2',
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
