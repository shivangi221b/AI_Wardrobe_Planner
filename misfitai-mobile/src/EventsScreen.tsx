import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppState } from './AppStateContext';
import { dayOrder, eventTypeLabels, eventTypeOptions } from './constants';
import type { DayOfWeek, EventType } from './types';
import { palette, radius, type } from './theme';

const TOP_CATEGORIES = ['top', 'shirt', 'blouse', 'sweater', 'jacket', 'activewear_top', 'outerwear'];
const BOTTOM_CATEGORIES = ['bottom', 'pants', 'jeans', 'skirt', 'activewear_bottom'];
const FULL_OUTFIT_CATEGORIES = ['dress'];

function getWeekDates(): Record<DayOfWeek, Date> {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const result = {} as Record<DayOfWeek, Date>;
  dayOrder.forEach((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    result[day] = d;
  });
  return result;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDayHeader(d: Date): string {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
}

export function EventsScreen({
  onGenerate,
  onBackToWardrobe,
  wardrobeStepComplete,
  calendarStepComplete,
}: {
  onGenerate: () => Promise<void>;
  onBackToWardrobe: () => void;
  wardrobeStepComplete: boolean;
  calendarStepComplete: boolean;
}) {
  const {
    isCalendarConnected,
    setCalendarConnected,
    syncCalendarEvents,
    eventsByDay,
    summariesByDay,
    setEventForDay,
    useDemoWeek,
    garments,
  } = useAppState();

  const [connecting, setConnecting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardAnimations = useRef(dayOrder.map(() => new Animated.Value(0))).current;

  const weekDates = useMemo(() => getWeekDates(), []);

  const hasTops = useMemo(
    () => garments.some((g) => TOP_CATEGORIES.includes(g.category)),
    [garments]
  );
  const hasBottoms = useMemo(
    () => garments.some((g) => BOTTOM_CATEGORIES.includes(g.category)),
    [garments]
  );
  const hasDresses = useMemo(
    () => garments.some((g) => FULL_OUTFIT_CATEGORIES.includes(g.category)),
    [garments]
  );

  const canGenerateFromWardrobe = wardrobeStepComplete || (hasTops && hasBottoms) || hasDresses;
  const canGenerate = canGenerateFromWardrobe && calendarStepComplete && !generating;

  const blockerText = !canGenerateFromWardrobe
    ? 'Back to Wardrobe and add at least one top and one bottom, or a dress.'
    : !calendarStepComplete
      ? 'Connect your calendar or tap Use demo week to continue.'
      : null;

  useEffect(() => {
    Animated.stagger(
      55,
      cardAnimations.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 340,
          useNativeDriver: true,
        })
      )
    ).start();
  }, [cardAnimations]);

  const handleConnect = async () => {
    const wasConnected = isCalendarConnected;
    setConnecting(true);
    setError(null);
    try {
      await syncCalendarEvents();
      setCalendarConnected(true);
    } catch (err) {
      const fallback = wasConnected
        ? 'Could not update calendar. Please try again.'
        : 'Could not connect calendar. Please try again.';
      const message = err instanceof Error ? err.message : fallback;
      setError(message);
    } finally {
      setConnecting(false);
    }
  };

  const handleSelectEvent = (day: DayOfWeek, eventType: EventType) => {
    setEventForDay(day, eventType);
  };

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError(null);
      await onGenerate();
    } catch {
      setError('Could not generate looks. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const weekStart = weekDates.monday;
  const weekEnd = weekDates.sunday;
  const weekRangeLabel = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Shape the week</Text>
        <Text style={styles.weekRange}>{weekRangeLabel}</Text>
        <Text style={styles.screenSubtitle}>
          Set one event per day and generate seven minimalist looks from your wardrobe.
        </Text>
        <Text style={styles.calendarExplainer}>
          Live calendar import uses Google Calendar and only works when you signed in with Google (with
          calendar access). Otherwise use{' '}
          <Text style={styles.calendarExplainerEm}>Use demo week</Text> or tap an event type for each
          day — no Google required.
        </Text>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={handleConnect}
            disabled={connecting}
            style={[styles.connectButton, isCalendarConnected && styles.connectButtonActive]}
          >
            <Text style={[styles.connectButtonText, isCalendarConnected && styles.connectButtonTextActive]}>
              {connecting
                ? isCalendarConnected
                  ? 'Updating...'
                  : 'Connecting...'
                : isCalendarConnected
                ? 'Update calendar'
                : 'Connect calendar'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.demoWeekButton}
            onPress={() => {
              setError(null);
              useDemoWeek();
            }}
          >
            <Text style={styles.demoWeekText}>Use demo week</Text>
          </Pressable>
        </View>

        {isCalendarConnected ? (
          <Text style={styles.helperText}>Calendar connected. Tap Update calendar anytime to refresh events.</Text>
        ) : null}

        {dayOrder.map((day, index) => {
          const anim = cardAnimations[index];
          const summary = summariesByDay[day];
          return (
            <Animated.View
              key={day}
              style={[
                styles.dayCard,
                {
                  opacity: anim,
                  transform: [
                    {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.dayLabel}>{formatDayHeader(weekDates[day])}</Text>
              {summary ? <Text style={styles.calendarSummary}>{summary}</Text> : null}
              <View style={styles.pillRow}>
                {eventTypeOptions.map((typeOption) => {
                  const selected = eventsByDay[day] === typeOption;
                  return (
                    <Pressable
                      key={typeOption}
                      onPress={() => handleSelectEvent(day, typeOption)}
                      style={[styles.pill, selected && styles.pillSelected]}
                    >
                      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                        {eventTypeLabels[typeOption]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          );
        })}

        {blockerText ? <Text style={styles.helperText}>{blockerText}</Text> : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable onPress={onBackToWardrobe} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to wardrobe</Text>
        </Pressable>

        <Pressable
          onPress={handleGenerate}
          disabled={!canGenerate}
          style={[styles.primaryButton, !canGenerate && styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {generating ? 'Generating your week...' : 'Next: Generate outfits'}
          </Text>
        </Pressable>
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
  weekRange: {
    fontSize: 15,
    color: palette.inkSoft,
    fontFamily: type.bodyDemi,
    marginTop: 2,
  },
  screenSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.muted,
    fontFamily: type.body,
  },
  calendarExplainer: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.muted,
    fontFamily: type.body,
    marginTop: 6,
  },
  calendarExplainerEm: {
    fontFamily: type.bodyDemi,
    color: palette.inkSoft,
  },
  actionsRow: {
    marginTop: 2,
    flexDirection: 'row',
    gap: 8,
  },
  connectButton: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingVertical: 10,
    alignItems: 'center',
  },
  connectButtonActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  connectButtonText: {
    color: palette.ink,
    fontFamily: type.bodyDemi,
    fontSize: 13,
  },
  connectButtonTextActive: {
    color: palette.textOnAccent,
  },
  demoWeekButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  demoWeekText: {
    color: palette.inkSoft,
    fontSize: 12,
    fontFamily: type.bodyDemi,
  },
  dayCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 8,
  },
  dayLabel: {
    color: palette.ink,
    fontSize: 15,
    fontFamily: type.bodyDemi,
  },
  calendarSummary: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.body,
    fontStyle: 'italic',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  pillSelected: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  pillText: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  pillTextSelected: {
    color: palette.textOnAccent,
  },
  helperText: {
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
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: palette.textOnAccent,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  secondaryButton: {
    marginTop: 6,
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
