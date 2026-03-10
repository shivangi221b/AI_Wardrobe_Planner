import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AtmosphereBackground } from './AtmosphereBackground';
import { palette, radius, type } from './theme';

export type AuthMode = 'login' | 'signup';
export type AuthProvider = 'apple' | 'google';

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (provider: AuthProvider, mode: AuthMode) => void;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loadingProvider, setLoadingProvider] = useState<AuthProvider | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const handleAuth = (provider: AuthProvider) => {
    setLoadingProvider(provider);
    setTimeout(() => {
      setLoadingProvider(null);
      onAuthenticated(provider, mode);
    }, 700);
  };

  const animatedStyle = {
    opacity: entrance,
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AtmosphereBackground />
      <Animated.View style={[styles.container, animatedStyle]}>
        <View style={styles.header}>
          <Text style={styles.brand}>misfitAI</Text>
          <Text style={styles.title}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'login'
              ? 'Sign in to continue planning your weekly looks.'
              : 'Sign up to start building your digital wardrobe.'}
          </Text>
        </View>

        <View style={styles.modeSwitch}>
          <Pressable
            onPress={() => setMode('login')}
            style={[styles.modeButton, mode === 'login' && styles.modeButtonActive]}
          >
            <Text style={[styles.modeButtonText, mode === 'login' && styles.modeButtonTextActive]}>
              Log in
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('signup')}
            style={[styles.modeButton, mode === 'signup' && styles.modeButtonActive]}
          >
            <Text style={[styles.modeButtonText, mode === 'signup' && styles.modeButtonTextActive]}>
              Sign up
            </Text>
          </Pressable>
        </View>

        <View style={styles.authCard}>
          <Pressable
            onPress={() => handleAuth('apple')}
            disabled={loadingProvider !== null}
            style={[styles.providerButton, styles.providerButtonPrimary]}
          >
            <Text style={styles.providerButtonPrimaryText}>
              {loadingProvider === 'apple' ? 'Connecting Apple...' : 'Continue with Apple'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleAuth('google')}
            disabled={loadingProvider !== null}
            style={styles.providerButton}
          >
            <Text style={styles.providerButtonText}>
              {loadingProvider === 'google' ? 'Connecting Google...' : 'Continue with Google'}
            </Text>
          </Pressable>

          <Text style={styles.helperCopy}>
            Mock auth for MVP demo. Real OAuth can replace this screen later.
          </Text>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 42,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 22,
  },
  brand: {
    fontSize: 17,
    color: palette.inkSoft,
    fontFamily: type.bodyDemi,
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  title: {
    fontSize: 38,
    lineHeight: 40,
    color: palette.ink,
    fontFamily: type.display,
  },
  subtitle: {
    marginTop: 10,
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: type.body,
    maxWidth: 300,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 4,
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingVertical: 8,
  },
  modeButtonActive: {
    backgroundColor: palette.accent,
  },
  modeButtonText: {
    color: palette.muted,
    fontFamily: type.bodyDemi,
    fontSize: 13,
  },
  modeButtonTextActive: {
    color: '#f4f4f2',
  },
  authCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 8,
  },
  providerButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingVertical: 12,
    alignItems: 'center',
  },
  providerButtonPrimary: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  providerButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  providerButtonPrimaryText: {
    color: '#f4f4f2',
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  helperCopy: {
    marginTop: 8,
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: type.body,
  },
});
