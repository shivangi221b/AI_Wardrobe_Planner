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

const TOP_CATEGORIES = ['top', 'shirt', 'blouse', 'sweater', 'jacket', 'activewear_top'];
const BOTTOM_CATEGORIES = ['bottom', 'pants', 'jeans', 'skirt', 'activewear_bottom'];

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
}: {
  onGenerate: () => Promise<void>;
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
  const canGenerate = hasTops && hasBottoms;

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
    if (isCalendarConnected) {
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      await syncCalendarEvents();
      setCalendarConnected(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect calendar. Please try again.';
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
  const weekRangeLabel = `${formatShortDate(weekStart)} \u2013 ${formatShortDate(weekEnd)}`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Shape the week</Text>
        <Text style={styles.weekRange}>{weekRangeLabel}</Text>
        <Text style={styles.screenSubtitle}>
          Set one event per day and generate seven minimalist looks from your wardrobe.
        </Text>

        {isCalendarConnected ? (
          <View style={styles.connectedChip}>
            <Text style={styles.connectedChipText}>Google Calendar synced</Text>
          </View>
        ) : (
          <View style={styles.calendarActions}>
            <Pressable
              onPress={handleConnect}
              disabled={connecting}
              style={styles.syncButton}
            >
              <Text style={styles.syncButtonText}>
                {connecting ? 'Syncing...' : '\uD83D\uDCC5  Sync Google Calendar'}
              </Text>
            </Pressable>
            <Pressable onPress={useDemoWeek}>
              <Text style={styles.demoLink}>or use a demo week</Text>
            </Pressable>
          </View>
        )}

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
              {summary ? (
                <Text style={styles.calendarSummary}>{summary}</Text>
              ) : null}
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

        {!canGenerate ? (
          <Text style={styles.helperText}>
            {!hasTops && !hasBottoms
              ? 'Add at least one top and one bottom in Wardrobe to generate outfits.'
              : !hasTops
                ? 'Add at least one top (shirt, blouse, sweater) to generate outfits.'
                : 'Add at least one bottom (pants, jeans, skirt) to generate outfits.'}
          </Text>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={handleGenerate}
          disabled={generating || !canGenerate}
          style={[styles.primaryButton, !canGenerate && styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {generating ? 'Generating your week...' : 'Generate my outfits'}
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
  calendarActions: {
    marginTop: 2,
    gap: 8,
    alignItems: 'center',
  },
  syncButton: {
    width: '100%',
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 12,
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#f4f4f2',
    fontFamily: type.bodyDemi,
    fontSize: 14,
  },
  demoLink: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
    textDecorationLine: 'underline',
  },
  connectedChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#4caf50',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 2,
  },
  connectedChipText: {
    color: '#2e7d32',
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
    color: '#f4f4f2',
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
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#f4f4f2',
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
