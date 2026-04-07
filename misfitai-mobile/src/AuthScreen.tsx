import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { AtmosphereBackground } from './AtmosphereBackground';
import { palette, radius, type } from './theme';

// Native Apple Sign In on iOS; on web/Android the button is shown but sign-in runs only on iOS
const AppleAuthentication =
  Platform.OS === 'ios' ? require('expo-apple-authentication') : null;

WebBrowser.maybeCompleteAuthSession();

export type AuthMode = 'login' | 'signup';
export type AuthProvider = 'apple' | 'google';

/** Profile we collect from Google (People API) or Apple. Used for styling and DB user identity. */
export type UserProfile = {
  /** Stable provider user id (e.g. Google people/xxx or Apple credential.user). Used as user_id in API. */
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  /** Google/Apple may not provide; user can set in app later. */
  gender?: 'male' | 'female' | 'other' | null;
  /** Birthday captured in-app (YYYY-MM-DD) if provided. */
  birthday?: string | null;
};

/** Scopes we request from Google: OpenID identity + calendar read-only. */
const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

// When set, all web OAuth flows use this stable URL as the redirect URI instead
// of window.location.origin. This lets Firebase Hosting preview channels (whose
// dynamic *.web.app subdomains cannot be pre-registered) share a single
// registered redirect URI with production. The production page already calls
// WebBrowser.maybeCompleteAuthSession() at module level, which posts the token
// back to the opener window via postMessage('*') before closing the popup.
const webRedirectUri =
  Platform.OS === 'web' ? (process.env.EXPO_PUBLIC_OAUTH_REDIRECT_URI ?? undefined) : undefined;

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (provider: AuthProvider, mode: AuthMode, profile?: UserProfile, googleAccessToken?: string) => void;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loadingProvider, setLoadingProvider] = useState<AuthProvider | null>(null);

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    ...(googleWebClientId && { webClientId: googleWebClientId }),
    ...(googleIosClientId && { iosClientId: googleIosClientId }),
    ...(googleAndroidClientId && { androidClientId: googleAndroidClientId }),
    scopes: GOOGLE_SCOPES,
    // Force the consent screen so Google always issues a token that covers all
    // requested scopes, including calendar.readonly which was added after the
    // initial sign-in. Without this, returning users keep their old token which
    // lacks the calendar scope and receives a 403 from the Calendar API.
    prompt: 'consent',
    // Override the redirect URI on web so all deployments (production and
    // preview channels) funnel through the single registered production URL.
    ...(webRedirectUri && { redirectUri: webRedirectUri }),
  });

  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const fetchGoogleProfile = useCallback(async (accessToken: string): Promise<UserProfile> => {
    // Use the standard userinfo endpoint (non-sensitive). Avoid Google People API
    // so we don't request sensitive scopes (birthday/gender).
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    return {
      id: data.sub ? `google-${data.sub}` : null,
      email: data.email ?? null,
      displayName: data.name ?? null,
      photoUrl: data.picture ?? null,
      gender: null,
      birthday: null,
    };
  }, []);

  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      if (googleResponse?.type === 'error' || googleResponse?.type === 'dismiss') {
        setLoadingProvider(null);
      }
      return;
    }
    const accessToken =
      googleResponse.authentication?.accessToken ?? googleResponse.params?.access_token;
    if (!accessToken) {
      setLoadingProvider(null);
      onAuthenticated('google', mode);
      return;
    }
    let cancelled = false;
    fetchGoogleProfile(accessToken).then(
      (profile) => {
        if (!cancelled) {
          setLoadingProvider(null);
          onAuthenticated('google', mode, profile, accessToken);
        }
      },
      () => {
        if (!cancelled) {
          setLoadingProvider(null);
          onAuthenticated('google', mode, undefined, accessToken);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [googleResponse, mode, onAuthenticated, fetchGoogleProfile]);

  const handleAppleAuth = useCallback(async () => {
    if (!AppleAuthentication) return;
    try {
      setLoadingProvider('apple');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential) {
        const profile: UserProfile = {
          id: credential.user ? `apple-${credential.user}` : null,
          email: credential.email ?? null,
          displayName:
            credential.fullName?.givenName || credential.fullName?.familyName
              ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ')
              : null,
          photoUrl: null,
          gender: null,
          birthday: null,
        };
        onAuthenticated('apple', mode, profile);
      }
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      if (err?.code !== 'ERR_CANCELED') {
        console.warn('Apple sign-in failed', err);
      }
    } finally {
      setLoadingProvider(null);
    }
  }, [mode, onAuthenticated]);

  const handleGoogleAuth = useCallback(async () => {
    try {
      setLoadingProvider('google');
      await googlePromptAsync();
    } catch (error) {
      console.warn('Google sign-in failed', error);
      setLoadingProvider(null);
    }
  }, [googlePromptAsync]);

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
            onPress={handleAppleAuth}
            disabled={loadingProvider !== null}
            style={[styles.providerButton, styles.providerButtonPrimary]}
          >
            <Text style={styles.providerButtonPrimaryText}>
              {loadingProvider === 'apple' ? 'Connecting Apple...' : 'Continue with Apple'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleGoogleAuth}
            disabled={loadingProvider !== null || !googleRequest}
            style={styles.providerButton}
          >
            <Text style={styles.providerButtonText}>
              {loadingProvider === 'google'
                ? 'Connecting Google...'
                : 'Continue with Google'}
            </Text>
          </Pressable>
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
});
