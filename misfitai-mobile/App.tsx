import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppStateProvider, useAppState } from './src/AppStateContext';
import { WardrobeScreen } from './src/WardrobeScreen';
import { EventsScreen } from './src/EventsScreen';
import { WeeklyPlanScreen } from './src/WeeklyPlanScreen';
import { USE_MOCK_API } from './src/api';
import { AtmosphereBackground } from './src/AtmosphereBackground';
import { AuthScreen, type AuthMode, type AuthProvider } from './src/AuthScreen';
import { palette, radius, type } from './src/theme';

type Tab = 'wardrobe' | 'events' | 'plan';

type MockSession = {
  provider: AuthProvider;
  mode: AuthMode;
};

function AppContent({
  session,
  onSignOut,
}: {
  session: MockSession;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('wardrobe');
  const { generateRecommendations } = useAppState();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <AtmosphereBackground />

      <View style={styles.metaBar}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{session.provider.toUpperCase()} · {session.mode}</Text>
        </View>
        <Pressable onPress={onSignOut} style={styles.metaChip}>
          <Text style={styles.metaChipText}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {tab === 'wardrobe' ? (
          <WardrobeScreen
            onNext={() => {
              setTab('events');
            }}
          />
        ) : null}

        {tab === 'events' ? (
          <EventsScreen
            onGenerate={async () => {
              await generateRecommendations();
              setTab('plan');
            }}
          />
        ) : null}

        {tab === 'plan' ? (
          <WeeklyPlanScreen
            onRegenerateWeek={async () => {
              await generateRecommendations();
            }}
          />
        ) : null}
      </View>

      <View style={styles.navBar}>
        {([
          { key: 'wardrobe', label: 'Wardrobe' },
          { key: 'events', label: 'Week' },
          { key: 'plan', label: 'Looks' },
        ] as const).map((item) => {
          const active = tab === item.key;
          return (
            <Pressable key={item.key} style={styles.navItem} onPress={() => setTab(item.key)}>
              <View style={[styles.navDot, active && styles.navDotActive]} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {USE_MOCK_API ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Mock API</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<MockSession | null>(null);

  if (!session) {
    return (
      <AuthScreen
        onAuthenticated={(provider, mode) => {
          setSession({ provider, mode });
        }}
      />
    );
  }

  return (
    <AppStateProvider>
      <AppContent
        session={session}
        onSignOut={() => {
          setSession(null);
        }}
      />
    </AppStateProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  content: {
    flex: 1,
  },
  metaBar: {
    position: 'absolute',
    top: 52,
    left: 14,
    right: 14,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  metaChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaChipText: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyDemi,
  },
  navBar: {
    height: 76,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.panel,
    paddingHorizontal: 18,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  navDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.lineStrong,
  },
  navDotActive: {
    width: 18,
    backgroundColor: palette.accent,
  },
  navLabel: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyMedium,
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  badge: {
    position: 'absolute',
    top: 84,
    right: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyDemi,
  },
});
