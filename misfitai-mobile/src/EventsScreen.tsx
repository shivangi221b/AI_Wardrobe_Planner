import React, { useEffect, useRef, useState } from 'react';
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
import { dayLabels, dayOrder, eventTypeLabels, eventTypeOptions } from './constants';
import type { DayOfWeek, EventType } from './types';
import { palette, radius, type } from './theme';

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
    setEventForDay,
    useDemoWeek,
    garments,
  } = useAppState();

  const [connecting, setConnecting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardAnimations = useRef(dayOrder.map(() => new Animated.Value(0))).current;

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

  const handleSelectEvent = (day: DayOfWeek, type: EventType) => {
    setEventForDay(day, type);
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.screenTitle}>Shape the week</Text>
        <Text style={styles.screenSubtitle}>
          Set one event per day and generate seven minimalist looks from your wardrobe.
        </Text>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={handleConnect}
            disabled={connecting}
            style={[styles.connectButton, isCalendarConnected && styles.connectButtonActive]}
          >
            <Text style={[styles.connectButtonText, isCalendarConnected && styles.connectButtonTextActive]}>
              {connecting
                ? 'Connecting...'
                : isCalendarConnected
                ? 'Calendar connected'
                : 'Connect calendar'}
            </Text>
          </Pressable>
          <Pressable style={styles.demoWeekButton} onPress={useDemoWeek}>
            <Text style={styles.demoWeekText}>Use demo week</Text>
          </Pressable>
        </View>

        {dayOrder.map((day, index) => {
          const anim = cardAnimations[index];
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
              <Text style={styles.dayLabel}>{dayLabels[day]}</Text>
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

        {garments.length < 2 ? (
          <Text style={styles.helperText}>Add at least one top and one bottom in Wardrobe first.</Text>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={handleGenerate}
          disabled={generating || garments.length < 2}
          style={styles.primaryButton}
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
  screenSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: palette.muted,
    fontFamily: type.body,
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
    color: '#f4f4f2',
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
  primaryButtonText: {
    color: '#f4f4f2',
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
