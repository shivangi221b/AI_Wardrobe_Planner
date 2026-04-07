import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppStateProvider, useAppState } from './src/AppStateContext';
import { WardrobeScreen } from './src/WardrobeScreen';
import { EventsScreen } from './src/EventsScreen';
import { WeeklyPlanScreen } from './src/WeeklyPlanScreen';
import { registerSignupWithBackend, USE_MOCK_API } from './src/api';
import { AtmosphereBackground } from './src/AtmosphereBackground';
import { AuthScreen, type AuthMode, type AuthProvider, type UserProfile } from './src/AuthScreen';
import { palette, radius, type } from './src/theme';
import { initAnalytics, trackAuthSuccess } from './src/analytics';

const SESSION_STORAGE_KEY = '@misfitai/session';

type Tab = 'wardrobe' | 'events' | 'plan';

type Session = {
  provider: AuthProvider;
  mode: AuthMode;
  profile?: UserProfile;
  /** Stable user id derived at auth-time, used for all API calls. */
  userId: string;
};

/** Stable user id for API/Supabase: provider id, or normalized email, or fallback. */
function deriveUserIdFromProfile(profile?: UserProfile): string {
  if (profile?.id) return profile.id;
  if (profile?.email) {
    const normalizedEmail = profile.email.trim().toLowerCase();
    return `email-${normalizedEmail.replace(/@/g, '-at-').replace(/\./g, '-dot-')}`;
  }
  return `demo-${Math.random().toString(36).slice(2, 10)}`;
}

function AppContent({
  session,
  onSignOut,
}: {
  session: Session;
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
          <Text style={styles.metaChipText}>
            {session.provider.toUpperCase()} · {session.mode}
            {session.profile?.displayName ? ` · ${session.profile.displayName}` : ''}
            {session.profile?.gender ? ` · ${session.profile.gender}` : ''}
          </Text>
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
            onNavigateToWardrobe={() => setTab('wardrobe')}
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
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (!session?.userId) return;
    registerSignupWithBackend(session.userId);
  }, [session?.userId]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SESSION_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = raw ? (JSON.parse(raw) as Session) : null;
          if (parsed?.provider && parsed?.mode && parsed?.userId) {
            setSession(parsed);
          }
        } catch {
          // ignore invalid stored session
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticated = useCallback(
    (provider: AuthProvider, mode: AuthMode, profile?: UserProfile, accessToken?: string) => {
      const userId = deriveUserIdFromProfile(profile);
      const next: Session = { provider, mode, profile, userId };
      setSession(next);
      trackAuthSuccess(provider);
      AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      if (provider === 'google' && accessToken) {
        setGoogleAccessToken(accessToken);
      } else {
        setGoogleAccessToken(null);
      }
    },
    []
  );

  const handleSignOut = useCallback(() => {
    setSession(null);
    setGoogleAccessToken(null);
    AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  if (restoring) {
    return null; // or a minimal loading splash
  }

  if (!session) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AppStateProvider userId={session.userId} googleAccessToken={googleAccessToken}>
      <AppContent session={session} onSignOut={handleSignOut} />
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
