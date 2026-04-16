import React, { useCallback, useEffect, useState, Component, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppStateProvider, useAppState } from './src/AppStateContext';
import { WardrobeScreen } from './src/WardrobeScreen';
import { EventsScreen } from './src/EventsScreen';
import { WeeklyPlanScreen } from './src/WeeklyPlanScreen';
import { ProfileScreen } from './src/ProfileScreen';
import { generateAvatar, registerSignupWithBackend, updateUserProfile, USE_MOCK_API } from './src/api';
import { AtmosphereBackground } from './src/AtmosphereBackground';
import { AuthScreen, type AuthMode, type AuthProvider, type UserProfile } from './src/AuthScreen';
import { ProfileSetupScreen, type ProfileSetupResult } from './src/ProfileSetupScreen';
import { palette, radius, type } from './src/theme';
import { initAnalytics, trackAuthSuccess } from './src/analytics';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <ScrollView style={{ flex: 1, padding: 40, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'red', marginBottom: 10 }}>
            App Error
          </Text>
          <Text style={{ fontSize: 14, color: '#333', fontFamily: 'monospace' }}>
            {this.state.error.message}
          </Text>
          <Text style={{ fontSize: 12, color: '#666', marginTop: 10, fontFamily: 'monospace' }}>
            {this.state.error.stack}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const SESSION_STORAGE_KEY = '@misfitai/session';

type Tab = 'wardrobe' | 'events' | 'plan' | 'profile';

type Session = {
  provider: AuthProvider;
  mode: AuthMode;
  profile?: UserProfile;
  /** Stable user id derived at auth-time, used for all API calls. */
  userId: string;
  /** If true, optional profile questions were completed (or intentionally skipped). */
  profileCompleted?: boolean;
};

const DEMO_WEEK_EVENTS = {
  monday: 'work_meeting',
  tuesday: 'work_meeting',
  wednesday: 'gym',
  thursday: 'work_meeting',
  friday: 'date_night',
  saturday: 'casual',
  sunday: 'none',
} as const;

/** Stable user id for API/Supabase: provider id, or normalized email, or fallback. */
function deriveUserIdFromProfile(profile?: UserProfile): string {
  if (profile?.id) return profile.id;
  if (profile?.email) {
    const normalizedEmail = profile.email.trim().toLowerCase();
    return `email-${normalizedEmail.replace(/@/g, '-at-').replace(/\./g, '-dot-')}`;
  }
  return `demo-${Math.random().toString(36).slice(2, 10)}`;
}

function ProfileSetupScreenWithMeasurements({
  session,
  setSession,
}: {
  session: Session;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
}) {
  const { updateMeasurements } = useAppState();
  return (
    <ProfileSetupScreen
      initialProfile={session.profile}
      onDone={(result: ProfileSetupResult) => {
        const { profilePatch, measurements, profileUpdate, selfieUri } = result;
        const next: Session = {
          ...session,
          profile: { ...(session.profile ?? {}), ...profilePatch },
          profileCompleted: true,
        };
        setSession(next);
        AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
        const hasMeasurements = Object.values(measurements).some((v) => v != null);
        if (hasMeasurements) {
          updateMeasurements(measurements).catch(() => {
            /* non-blocking */
          });
        }
        // Save extended profile data (color preferences, sizes, avatar) non-blocking.
        // If a selfie was provided, chain avatar generation after the profile is saved.
        updateUserProfile(next.userId, profileUpdate)
          .then(() => {
            if (selfieUri) {
              return generateAvatar(next.userId, selfieUri);
            }
          })
          .catch(() => {
            /* non-blocking — avatar generation failure should not block onboarding */
          });
      }}
    />
  );
}

function AppContent({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('wardrobe');
  const [tabHint, setTabHint] = useState<string | null>(null);
  const { generateRecommendations, garments, isCalendarConnected, eventsByDay, recommendations } =
    useAppState();

  const wardrobeStepComplete =
    garments.some((item) => item.category === 'top') &&
    garments.some((item) => item.category === 'bottom');
  const demoWeekSelected = (
    Object.keys(DEMO_WEEK_EVENTS) as Array<keyof typeof DEMO_WEEK_EVENTS>
  ).every((day) => eventsByDay[day] === DEMO_WEEK_EVENTS[day]);
  const calendarStepComplete = isCalendarConnected || demoWeekSelected;
  const outfitsStepComplete = recommendations.length > 0;

  const flowSteps: Array<{
    key: Tab;
    label: string;
    complete: boolean;
  }> = [
    { key: 'wardrobe', label: 'Wardrobe', complete: wardrobeStepComplete },
    { key: 'events', label: 'Calendar', complete: calendarStepComplete },
    { key: 'plan', label: 'Outfits', complete: outfitsStepComplete },
  ];

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab === 'events' && !wardrobeStepComplete) {
      setTabHint('Wardrobe is complete after at least one top and one bottom.');
      return;
    }
    if (nextTab === 'plan' && !calendarStepComplete) {
      setTabHint('Connect your calendar or use demo week before generating outfits.');
      return;
    }
    if (nextTab === 'plan' && !outfitsStepComplete) {
      setTabHint('Generate outfits in Calendar to populate this step.');
      return;
    }
    setTabHint(null);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <AtmosphereBackground />

      <View style={styles.topChrome}>
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

        <View style={styles.stepperCard}>
          {flowSteps.map((item, index) => {
            const active = tab === item.key;
            return (
              <React.Fragment key={item.key}>
                <Pressable style={styles.stepperPressable} onPress={() => handleTabChange(item.key)}>
                  <View
                    style={[
                      styles.stepBadge,
                      item.complete && styles.stepBadgeComplete,
                      active && styles.stepBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepBadgeText,
                        item.complete && !active && styles.stepBadgeTextComplete,
                        active && styles.stepBadgeTextActive,
                      ]}
                    >
                      {item.complete ? '✓' : index + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{item.label}</Text>
                </Pressable>
                {index < flowSteps.length - 1 ? <View style={styles.stepConnector} /> : null}
              </React.Fragment>
            );
          })}
        </View>

        <View style={styles.breadcrumbRow}>
          {flowSteps.map((item, index) => {
            const active = tab === item.key;
            return (
              <React.Fragment key={item.key}>
                <Pressable
                  onPress={() => handleTabChange(item.key)}
                  style={[styles.breadcrumbChip, active && styles.breadcrumbChipActive]}
                >
                  <Text style={[styles.breadcrumbChipText, active && styles.breadcrumbChipTextActive]}>
                    {item.label}
                  </Text>
                  {item.complete ? <Text style={styles.breadcrumbDone}>Done</Text> : null}
                </Pressable>
                {index < flowSteps.length - 1 ? (
                  <Text style={styles.breadcrumbSeparator}>›</Text>
                ) : null}
              </React.Fragment>
            );
          })}
        </View>

        {tabHint ? <Text style={styles.stepHint}>{tabHint}</Text> : null}
      </View>

      <View style={styles.content}>
        {tab === 'wardrobe' ? (
          <WardrobeScreen
            isStepComplete={wardrobeStepComplete}
            onNext={() => {
              handleTabChange('events');
            }}
          />
        ) : null}

        {tab === 'events' ? (
          <EventsScreen
            wardrobeStepComplete={wardrobeStepComplete}
            calendarStepComplete={calendarStepComplete}
            onBackToWardrobe={() => handleTabChange('wardrobe')}
            onGenerate={async () => {
              await generateRecommendations();
              handleTabChange('plan');
            }}
          />
        ) : null}

        {tab === 'plan' ? (
          <WeeklyPlanScreen
            onRegenerateWeek={async () => {
              await generateRecommendations();
            }}
            onBackToCalendar={() => handleTabChange('events')}
            onNavigateToWardrobe={() => handleTabChange('wardrobe')}
          />
        ) : null}
      </View>

      <View style={styles.navBar}>
        {([
          { key: 'wardrobe', label: 'Wardrobe' },
          { key: 'events', label: 'Calendar' },
          { key: 'plan', label: 'Outfits' },
        ] as const).map((item) => {
          const active = tab === item.key;
          return (
            <Pressable key={item.key} style={styles.navItem} onPress={() => handleTabChange(item.key)}>
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

function AppInner() {
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
      const next: Session = {
        provider,
        mode,
        profile,
        userId,
        profileCompleted: mode === 'signup' ? false : true,
      };
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

  if (session.mode === 'signup' && session.profileCompleted !== true) {
    return (
      <AppStateProvider
        userId={session.userId}
        userGender={session.profile?.gender ?? null}
        googleAccessToken={null}
      >
        <ProfileSetupScreenWithMeasurements
          session={session}
          setSession={setSession}
        />
      </AppStateProvider>
    );
  }

  return (
    <AppStateProvider
      userId={session.userId}
      userGender={session.profile?.gender ?? null}
      googleAccessToken={googleAccessToken}
    >
      <AppContent session={session} onSignOut={handleSignOut} />
    </AppStateProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  topChrome: {
    paddingTop: 50,
    paddingHorizontal: 14,
    gap: 8,
  },
  content: {
    flex: 1,
  },
  metaBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
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
  stepperCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepperPressable: {
    flex: 0,
    alignItems: 'center',
    gap: 4,
    minWidth: 56,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeComplete: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  stepBadgeActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  stepBadgeText: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyDemi,
    lineHeight: 14,
  },
  stepBadgeTextComplete: {
    color: palette.ink,
  },
  stepBadgeTextActive: {
    color: palette.textOnAccent,
  },
  stepLabel: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyMedium,
  },
  stepLabelActive: {
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  stepConnector: {
    flex: 1,
    height: 1,
    backgroundColor: palette.line,
    marginTop: 12,
    marginHorizontal: 8,
  },
  stepHint: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.body,
    paddingHorizontal: 4,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  breadcrumbChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  breadcrumbChipActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  breadcrumbChipText: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyMedium,
  },
  breadcrumbChipTextActive: {
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  breadcrumbDone: {
    color: palette.inkSoft,
    fontSize: 10,
    fontFamily: type.bodyDemi,
  },
  breadcrumbSeparator: {
    color: palette.muted,
    fontSize: 12,
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
