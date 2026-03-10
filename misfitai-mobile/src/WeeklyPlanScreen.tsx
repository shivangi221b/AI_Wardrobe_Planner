import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { getFitSignals, getScheduleChips } from './lookUtils';
import { getImageForGarment, outerwearImage, shoesImage } from './stockImages';
import type { DayOfWeek } from './types';
import { palette, radius, type } from './theme';

export function WeeklyPlanScreen({
  onRegenerateWeek,
}: {
  onRegenerateWeek: () => Promise<void>;
}) {
  const { garments, recommendations } = useAppState();
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

  const topGarment = selectedRecommendation
    ? garments.find((item) => item.id === selectedRecommendation.outfit.topId)
    : undefined;
  const bottomGarment = selectedRecommendation
    ? garments.find((item) => item.id === selectedRecommendation.outfit.bottomId)
    : undefined;

  const topName = selectedRecommendation?.outfit.topName || topGarment?.name || 'Cream sweater';
  const bottomName =
    selectedRecommendation?.outfit.bottomName || bottomGarment?.name || 'Dark trousers';

  const collagePieces = [
    { name: topName, image: getImageForGarment(topName, 'top') },
    { name: bottomName, image: getImageForGarment(bottomName, 'bottom') },
    { name: 'Beige coat', image: outerwearImage },
    { name: 'Brown loafers', image: shoesImage },
  ];

  const scheduleChips = selectedRecommendation ? getScheduleChips(selectedRecommendation.day) : [];
  const fitSignals = selectedRecommendation ? getFitSignals(selectedRecommendation.eventType) : [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Your weekly lookbook</Text>
        <Text style={styles.screenSubtitle}>
          Recommendation engine is live in-app. Select a day to preview a complete, monochrome,
          Alta-inspired collage.
        </Text>

        {recommendations.length === 0 ? (
          <Text style={styles.helperText}>
            No recommendations yet. Go to Week Events and tap "Generate my outfits".
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
              <View style={styles.modePills}>
                <View style={styles.modePillMuted}>
                  <Text style={styles.modePillMutedText}>Styled</Text>
                </View>
                <View style={styles.modePillActive}>
                  <Text style={styles.modePillActiveText}>Collage</Text>
                </View>
              </View>

              <View style={styles.scheduleRow}>
                {scheduleChips.map((chip, index) => (
                  <View key={chip} style={[styles.scheduleChip, index === 0 && styles.scheduleChipActive]}>
                    <Text style={[styles.scheduleChipText, index === 0 && styles.scheduleChipTextActive]}>
                      {chip}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.lookHeading}>Recommended outfit</Text>
              <Text style={styles.lookReason}>{selectedRecommendation.explanation}</Text>

              <View style={styles.collageGrid}>
                {collagePieces.map((piece, index) => {
                  const pieceAnim = pieceAnimations[index];
                  return (
                    <Animated.View
                      key={piece.name}
                      style={[
                        styles.pieceCard,
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
                      <Image source={piece.image} style={styles.pieceImage} resizeMode="contain" />
                      <Text style={styles.pieceLabel}>{piece.name}</Text>
                    </Animated.View>
                  );
                })}
              </View>

              <View style={styles.signalsRow}>
                {fitSignals.map((signal) => (
                  <View key={signal.label} style={styles.signalCard}>
                    <Text style={styles.signalLabel}>{signal.label}</Text>
                    <Text style={styles.signalValue}>{signal.value}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            <View style={styles.weekList}>
              <Text style={styles.weekListTitle}>Week summary</Text>
              {recommendations.map((rec) => (
                <View key={rec.day} style={styles.weekRow}>
                  <Text style={styles.weekDay}>{dayLabels[rec.day]}</Text>
                  <Text style={styles.weekEvent}>{eventTypeLabels[rec.eventType]}</Text>
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
  modePills: {
    flexDirection: 'row',
    gap: 6,
  },
  modePillMuted: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modePillActive: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modePillMutedText: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  modePillActiveText: {
    color: palette.ink,
    fontSize: 12,
    fontFamily: type.bodyDemi,
  },
  scheduleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  scheduleChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  scheduleChipActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  scheduleChipText: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  scheduleChipTextActive: {
    color: '#f4f4f2',
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
  signalsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  signalCard: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 7,
  },
  signalLabel: {
    color: palette.ink,
    fontSize: 12,
    fontFamily: type.bodyDemi,
  },
  signalValue: {
    marginTop: 3,
    color: palette.muted,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: type.body,
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
    paddingVertical: 5,
  },
  weekDay: {
    color: palette.inkSoft,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  weekEvent: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: type.body,
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
