import React, { useMemo, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AtmosphereBackground } from './AtmosphereBackground';
import { palette, radius, type } from './theme';
import type { UserProfile } from './AuthScreen';

function isValidBirthday(value: string): boolean {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // Basic calendar sanity (avoid timezone quirks by using UTC)
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function ProfileSetupScreen({
  initialProfile,
  onDone,
}: {
  initialProfile?: UserProfile;
  onDone: (profilePatch: Pick<UserProfile, 'gender' | 'birthday'>) => void;
}) {
  const [gender, setGender] = useState<UserProfile['gender']>(initialProfile?.gender ?? null);
  const [birthday, setBirthday] = useState<string>(initialProfile?.birthday ?? '');
  const [birthdayTouched, setBirthdayTouched] = useState(false);

  const birthdayError = useMemo(() => {
    const value = birthday.trim();
    if (!birthdayTouched) return null;
    if (!value) return null; // optional
    return isValidBirthday(value) ? null : 'Use YYYY-MM-DD (e.g., 2001-04-07).';
  }, [birthday, birthdayTouched]);

  return (
    <SafeAreaView style={styles.safe}>
      <AtmosphereBackground />
      <View style={styles.container}>
        <Text style={styles.brand}>misfitAI</Text>
        <Text style={styles.title}>A quick question</Text>
        <Text style={styles.subtitle}>
          We no longer pull birthday or gender from Google. Add them here (optional) so we can personalize your
          experience.
        </Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Gender</Text>
          <View style={styles.row}>
            {([
              { key: 'female', label: 'Female' },
              { key: 'male', label: 'Male' },
              { key: 'other', label: 'Other' },
            ] as const).map((g) => {
              const active = gender === g.key;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGender(active ? null : g.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Birthday</Text>
          <TextInput
            value={birthday}
            onChangeText={setBirthday}
            placeholder="YYYY-MM-DD (optional)"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
            style={[styles.input, birthdayError && styles.inputError]}
            onBlur={() => setBirthdayTouched(true)}
          />
          {birthdayError ? <Text style={styles.errorText}>{birthdayError}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={() => onDone({ gender: null, birthday: null })}
              style={[styles.button, styles.buttonGhost]}
            >
              <Text style={[styles.buttonText, styles.buttonGhostText]}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                onDone({
                  gender: gender ?? null,
                  birthday: birthday.trim() ? birthday.trim() : null,
                })
              }
              style={[styles.button, styles.buttonPrimary]}
              disabled={Boolean(birthdayError)}
            >
              <Text style={[styles.buttonText, styles.buttonPrimaryText]}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
    paddingHorizontal: 18,
    paddingTop: 48,
  },
  brand: {
    fontSize: 18,
    color: palette.ink,
    fontFamily: type.display,
    marginBottom: 10,
  },
  title: {
    fontSize: 26,
    color: palette.ink,
    fontFamily: type.title,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 20,
    marginBottom: 18,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  chipText: {
    fontSize: 13,
    color: palette.inkSoft,
    fontFamily: type.bodyMedium,
  },
  chipTextActive: {
    color: palette.panelStrong,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: palette.ink,
    fontFamily: type.body,
  },
  inputError: {
    borderColor: palette.error,
  },
  errorText: {
    marginTop: 8,
    color: palette.error,
    fontSize: 12,
    fontFamily: type.body,
  },
  actions: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  button: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: palette.lineStrong,
  },
  buttonPrimary: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  buttonText: {
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  buttonGhostText: {
    color: palette.inkSoft,
  },
  buttonPrimaryText: {
    color: palette.panelStrong,
  },
});

