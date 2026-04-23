import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AtmosphereBackground } from './AtmosphereBackground';
import { palette, radius, type } from './theme';
import type { UserProfile as AuthUserProfile } from './AuthScreen';
import type {
  AvatarConfig,
  BodyMeasurements,
  ColorTone,
  SkinTone,
  UserProfileUpdate,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidBirthday(value: string): boolean {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parsePositiveFloat(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type MeasurementFields = Omit<BodyMeasurements, 'userId' | 'updatedAt'>;

// ---------------------------------------------------------------------------
// Step progress indicator
// ---------------------------------------------------------------------------

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={stepStyles.dotsRow}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[stepStyles.dot, i === current && stepStyles.dotActive]}
        />
      ))}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.lineStrong,
  },
  dotActive: {
    backgroundColor: palette.accent,
    width: 20,
  },
});

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children, style }: { children: string; style?: object }) {
  return <Text style={[shared.sectionTitle, style]}>{children}</Text>;
}

function ChipRow<T extends string>({
  options,
  value,
  onSelect,
  multiSelect = false,
  selectedValues,
  onMultiSelect,
}: {
  options: { key: T; label: string }[];
  value?: T | null;
  onSelect?: (v: T | null) => void;
  multiSelect?: boolean;
  selectedValues?: T[];
  onMultiSelect?: (v: T[]) => void;
}) {
  return (
    <View style={shared.row}>
      {options.map((opt) => {
        const active = multiSelect
          ? (selectedValues ?? []).includes(opt.key)
          : value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (multiSelect && onMultiSelect && selectedValues !== undefined) {
                if (active) {
                  onMultiSelect(selectedValues.filter((v) => v !== opt.key));
                } else {
                  onMultiSelect([...selectedValues, opt.key]);
                }
              } else if (!multiSelect && onSelect) {
                onSelect(active ? null : opt.key);
              }
            }}
            style={[shared.chip, active && shared.chipActive]}
          >
            <Text style={[shared.chipText, active && shared.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Colour swatch selector
function ColorSwatchRow({
  colors,
  selectedValues,
  onToggle,
}: {
  colors: { key: string; label: string; hex: string }[];
  selectedValues: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <View style={shared.swatchRow}>
      {colors.map((c) => {
        const active = selectedValues.includes(c.key);
        return (
          <Pressable key={c.key} onPress={() => onToggle(c.key)} style={shared.swatchItem}>
            <View
              style={[
                shared.swatch,
                { backgroundColor: c.hex },
                active && shared.swatchActive,
              ]}
            />
            <Text style={[shared.swatchLabel, active && shared.swatchLabelActive]}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Data constants
// ---------------------------------------------------------------------------

const SKIN_TONES: { key: SkinTone; label: string; hex: string }[] = [
  { key: 'very_light', label: 'Very Light', hex: '#FDDBB4' },
  { key: 'light', label: 'Light', hex: '#F5C5A3' },
  { key: 'medium_light', label: 'Medium Light', hex: '#D4956A' },
  { key: 'medium', label: 'Medium', hex: '#B46A3C' },
  { key: 'medium_dark', label: 'Medium Dark', hex: '#8D4A24' },
  { key: 'dark', label: 'Dark', hex: '#4A2515' },
];

const COLOR_TONE_OPTIONS: { key: ColorTone; label: string }[] = [
  { key: 'warm', label: 'Warm' },
  { key: 'cool', label: 'Cool' },
  { key: 'neutral', label: 'Neutral' },
];

const PALETTE_COLORS = [
  { key: 'black', label: 'Black', hex: '#111111' },
  { key: 'white', label: 'White', hex: '#F5F5F0' },
  { key: 'grey', label: 'Grey', hex: '#9E9E9E' },
  { key: 'navy', label: 'Navy', hex: '#1A2E5C' },
  { key: 'blue', label: 'Blue', hex: '#2979FF' },
  { key: 'green', label: 'Green', hex: '#2E7D32' },
  { key: 'olive', label: 'Olive', hex: '#6D6E32' },
  { key: 'brown', label: 'Brown', hex: '#795548' },
  { key: 'beige', label: 'Beige', hex: '#D4B896' },
  { key: 'red', label: 'Red', hex: '#C62828' },
  { key: 'pink', label: 'Pink', hex: '#E91E8C' },
  { key: 'yellow', label: 'Yellow', hex: '#F9A825' },
];

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const HAIR_STYLES = [
  { key: 'short_straight', label: 'Short Straight' },
  { key: 'short_wavy', label: 'Short Wavy' },
  { key: 'long_straight', label: 'Long Straight' },
  { key: 'long_wavy', label: 'Long Wavy' },
  { key: 'curly_afro', label: 'Curly / Afro' },
  { key: 'bald', label: 'Bald / Shaved' },
];

const HAIR_COLORS = [
  { key: 'black', label: 'Black' },
  { key: 'dark_brown', label: 'Dark Brown' },
  { key: 'light_brown', label: 'Light Brown' },
  { key: 'auburn', label: 'Auburn' },
  { key: 'blonde', label: 'Blonde' },
  { key: 'red', label: 'Red' },
  { key: 'grey', label: 'Grey' },
  { key: 'white', label: 'White' },
];

const BODY_TYPES = [
  { key: 'slim', label: 'Slim / Athletic' },
  { key: 'average', label: 'Average' },
  { key: 'broad', label: 'Broad / Plus' },
];

// ---------------------------------------------------------------------------
// Step 1 — Personal info + measurements (original screen content)
// ---------------------------------------------------------------------------

interface Step1State {
  gender: AuthUserProfile['gender'];
  birthday: string;
  heightCm: string;
  weightKg: string;
  chestCm: string;
  waistCm: string;
  hipsCm: string;
  inseamCm: string;
}

function Step1({
  state,
  onChange,
  forceTouched = false,
}: {
  state: Step1State;
  onChange: (patch: Partial<Step1State>) => void;
  forceTouched?: boolean;
}) {
  const [birthdayTouched, setBirthdayTouched] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);

  const birthdayError = useMemo(() => {
    const v = state.birthday.trim();
    if (!(birthdayTouched || forceTouched) || !v) return null;
    return isValidBirthday(v) ? null : 'Use YYYY-MM-DD (e.g., 2001-04-07).';
  }, [state.birthday, birthdayTouched, forceTouched]);

  return (
    <>
      <View style={styles.card}>
        <SectionLabel>Gender</SectionLabel>
        <ChipRow
          options={[
            { key: 'female', label: 'Female' },
            { key: 'male', label: 'Male' },
            { key: 'other', label: 'Other' },
          ]}
          value={state.gender}
          onSelect={(v) => onChange({ gender: v as AuthUserProfile['gender'] })}
        />

        <SectionLabel style={{ marginTop: 16 }}>Birthday</SectionLabel>
        <TextInput
          value={state.birthday}
          onChangeText={(v) => onChange({ birthday: v })}
          placeholder="YYYY-MM-DD (optional)"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
          style={[styles.input, birthdayError ? styles.inputError : undefined]}
          onBlur={() => setBirthdayTouched(true)}
        />
        {birthdayError ? <Text style={styles.errorText}>{birthdayError}</Text> : null}
      </View>

      <Pressable
        style={styles.measurementsToggle}
        onPress={() => setShowMeasurements((v) => !v)}
      >
        <Text style={styles.measurementsToggleText}>
          {showMeasurements ? '▲ Hide' : '▼ Add'} body measurements (optional)
        </Text>
      </Pressable>

      {showMeasurements ? (
        <View style={styles.card}>
          <Text style={styles.measurementsHint}>
            Used to suggest better-fitting items. All fields are optional and stored securely.
          </Text>
          {(
            [
              { label: 'Height (cm)', key: 'heightCm' },
              { label: 'Weight (kg)', key: 'weightKg' },
              { label: 'Chest / Bust (cm)', key: 'chestCm' },
              { label: 'Waist (cm)', key: 'waistCm' },
              { label: 'Hips (cm)', key: 'hipsCm' },
              { label: 'Inseam (cm)', key: 'inseamCm' },
            ] as const
          ).map(({ label, key }) => (
            <View key={label} style={styles.measurementRow}>
              <Text style={styles.measurementLabel}>{label}</Text>
              <TextInput
                value={state[key]}
                onChangeText={(v) => onChange({ [key]: v })}
                placeholder="—"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                style={styles.measurementInput}
              />
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Colour preferences
// ---------------------------------------------------------------------------

interface Step2State {
  skinTone: SkinTone | null;
  colorTone: ColorTone | null;
  favoriteColors: string[];
  avoidedColors: string[];
}

function Step2({
  state,
  onChange,
}: {
  state: Step2State;
  onChange: (patch: Partial<Step2State>) => void;
}) {
  return (
    <>
      <View style={styles.card}>
        <SectionLabel>Skin Tone</SectionLabel>
        <View style={shared.swatchRow}>
          {SKIN_TONES.map((st) => {
            const active = state.skinTone === st.key;
            return (
              <Pressable
                key={st.key}
                onPress={() => onChange({ skinTone: active ? null : st.key })}
                style={shared.swatchItem}
              >
                <View
                  style={[
                    shared.swatch,
                    { backgroundColor: st.hex },
                    active && shared.swatchActive,
                  ]}
                />
                <Text style={[shared.swatchLabel, active && shared.swatchLabelActive]}>
                  {st.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <SectionLabel>Colour Tone</SectionLabel>
        <Text style={styles.measurementsHint}>
          Warm tones (reds, oranges, yellows) or Cool tones (blues, purples, greens)?
        </Text>
        <ChipRow
          options={COLOR_TONE_OPTIONS}
          value={state.colorTone}
          onSelect={(v) => onChange({ colorTone: v as ColorTone | null })}
        />
      </View>

      <View style={styles.card}>
        <SectionLabel>Favourite Colours</SectionLabel>
        <Text style={styles.measurementsHint}>
          We'll prioritise these in outfit suggestions.
        </Text>
        <ColorSwatchRow
          colors={PALETTE_COLORS}
          selectedValues={state.favoriteColors}
          onToggle={(key) => {
            const next = state.favoriteColors.includes(key)
              ? state.favoriteColors.filter((c) => c !== key)
              : [...state.favoriteColors, key];
            onChange({ favoriteColors: next });
          }}
        />
      </View>

      <View style={styles.card}>
        <SectionLabel>Colours to Avoid</SectionLabel>
        <Text style={styles.measurementsHint}>
          We'll de-prioritise these in outfit suggestions.
        </Text>
        <ColorSwatchRow
          colors={PALETTE_COLORS}
          selectedValues={state.avoidedColors}
          onToggle={(key) => {
            const next = state.avoidedColors.includes(key)
              ? state.avoidedColors.filter((c) => c !== key)
              : [...state.avoidedColors, key];
            onChange({ avoidedColors: next });
          }}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Sizes + avatar
// ---------------------------------------------------------------------------

interface Step3State {
  topSize: string | null;
  bottomSize: string | null;
  shoeSize: string;
  hairStyle: string | null;
  hairColor: string | null;
  bodyType: string | null;
  selfieUri: string | null;
}

function Step3({
  state,
  onChange,
}: {
  state: Step3State;
  onChange: (patch: Partial<Step3State>) => void;
}) {
  async function handlePickSelfie(fromCamera: boolean) {
    if (fromCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera permission required', 'Please allow camera access in Settings.');
        return;
      }
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
    if (!result.canceled && result.assets?.[0]?.uri) {
      onChange({ selfieUri: result.assets[0].uri });
    }
  }

  function promptSource() {
    if (Platform.OS === 'web') {
      void handlePickSelfie(false);
      return;
    }
    Alert.alert(
      'Add a selfie',
      'Used to generate your personalised avatar',
      [
        { text: 'Take selfie', onPress: () => void handlePickSelfie(true) },
        { text: 'Choose from library', onPress: () => void handlePickSelfie(false) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <>
      <View style={styles.card}>
        <SectionLabel>Top Size</SectionLabel>
        <ChipRow
          options={SIZE_OPTIONS.map((s) => ({ key: s, label: s }))}
          value={state.topSize}
          onSelect={(v) => onChange({ topSize: v })}
        />

        <SectionLabel style={{ marginTop: 16 }}>Bottom Size</SectionLabel>
        <ChipRow
          options={SIZE_OPTIONS.map((s) => ({ key: s, label: s }))}
          value={state.bottomSize}
          onSelect={(v) => onChange({ bottomSize: v })}
        />

        <SectionLabel style={{ marginTop: 16 }}>Shoe Size (EU / US)</SectionLabel>
        <TextInput
          value={state.shoeSize}
          onChangeText={(v) => onChange({ shoeSize: v })}
          placeholder="e.g. 42 or 9"
          placeholderTextColor={palette.muted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
      </View>

      <View style={styles.card}>
        <SectionLabel>Avatar — Hair Style</SectionLabel>
        <ChipRow
          options={HAIR_STYLES}
          value={state.hairStyle}
          onSelect={(v) => onChange({ hairStyle: v })}
        />

        <SectionLabel style={{ marginTop: 16 }}>Hair Colour</SectionLabel>
        <ChipRow
          options={HAIR_COLORS}
          value={state.hairColor}
          onSelect={(v) => onChange({ hairColor: v })}
        />

        <SectionLabel style={{ marginTop: 16 }}>Body Type</SectionLabel>
        <ChipRow
          options={BODY_TYPES}
          value={state.bodyType}
          onSelect={(v) => onChange({ bodyType: v })}
        />
      </View>

      <View style={styles.card}>
        <SectionLabel>Selfie for Avatar Generation</SectionLabel>
        <Text style={styles.measurementsHint}>
          Optional — snap a selfie and we'll use it (plus the details above) to generate a
          personalised illustrated avatar. Your selfie is never stored.
        </Text>
        {state.selfieUri ? (
          <Image
            source={{ uri: state.selfieUri }}
            style={selfieStyles.preview}
            resizeMode="cover"
          />
        ) : null}
        <Pressable onPress={promptSource} style={selfieStyles.btn}>
          <Text style={selfieStyles.btnText}>
            {state.selfieUri ? '📷 Retake / Change selfie' : '📷 Take or choose selfie'}
          </Text>
        </Pressable>
        {state.selfieUri ? (
          <Pressable onPress={() => onChange({ selfieUri: null })} style={selfieStyles.removeBtn}>
            <Text style={selfieStyles.removeBtnText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const selfieStyles = StyleSheet.create({
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: palette.bgAlt,
    marginBottom: 10,
  },
  btn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 13,
    color: palette.accent,
    fontFamily: type.bodyDemi,
  },
  removeBtn: {
    marginTop: 8,
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: 12,
    color: palette.error,
    fontFamily: type.body,
  },
});

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 3;

const STEP_TITLES = [
  'About you',
  'Your colour style',
  'Sizes & avatar',
];

const STEP_SUBTITLES = [
  'Helps tailor fit and recommendations.',
  'We\'ll match colours that suit your palette.',
  'Used for size filtering and outfit previews.',
];

export interface ProfileSetupResult {
  profilePatch: Pick<AuthUserProfile, 'gender' | 'birthday'>;
  measurements: MeasurementFields;
  profileUpdate: UserProfileUpdate;
  /** Local file URI for optional selfie → avatar generation (not stored on server). */
  selfieUri: string | null;
}

export function ProfileSetupScreen({
  initialProfile,
  onDone,
}: {
  initialProfile?: AuthUserProfile;
  onDone: (result: ProfileSetupResult) => void;
}) {
  const [step, setStep] = useState(0);

  const [step1, setStep1] = useState<Step1State>({
    gender: initialProfile?.gender ?? null,
    birthday: initialProfile?.birthday ?? '',
    heightCm: '',
    weightKg: '',
    chestCm: '',
    waistCm: '',
    hipsCm: '',
    inseamCm: '',
  });

  const [step2, setStep2] = useState<Step2State>({
    skinTone: null,
    colorTone: null,
    favoriteColors: [],
    avoidedColors: [],
  });

  const [step3, setStep3] = useState<Step3State>({
    topSize: null,
    bottomSize: null,
    shoeSize: '',
    hairStyle: null,
    hairColor: null,
    bodyType: null,
    selfieUri: null,
  });

  // Controlled "force-show errors" flag for Step 1's birthday field.
  // Set to true when the user attempts to advance with an invalid date.
  const [forceStep1Touched, setForceStep1Touched] = useState(false);

  function buildResult(skipped = false): ProfileSetupResult {
    const measurements: MeasurementFields = skipped
      ? { heightCm: null, weightKg: null, chestCm: null, waistCm: null, hipsCm: null, inseamCm: null }
      : {
          heightCm: parsePositiveFloat(step1.heightCm),
          weightKg: parsePositiveFloat(step1.weightKg),
          chestCm: parsePositiveFloat(step1.chestCm),
          waistCm: parsePositiveFloat(step1.waistCm),
          hipsCm: parsePositiveFloat(step1.hipsCm),
          inseamCm: parsePositiveFloat(step1.inseamCm),
        };

    const avatarConfig: AvatarConfig | null =
      step3.hairStyle || step3.hairColor || step3.bodyType
        ? {
            hairStyle: step3.hairStyle,
            hairColor: step3.hairColor,
            bodyType: step3.bodyType,
            skinTone: step2.skinTone,
          }
        : null;

    const profileUpdate: UserProfileUpdate = {
      gender: skipped ? null : (step1.gender ?? null),
      birthday: skipped ? null : (step1.birthday.trim() || null),
      skinTone: step2.skinTone,
      colorTone: step2.colorTone,
      favoriteColors: step2.favoriteColors,
      avoidedColors: step2.avoidedColors,
      topSize: step3.topSize,
      bottomSize: step3.bottomSize,
      shoeSize: step3.shoeSize.trim() || null,
      avatarConfig,
    };

    return {
      profilePatch: {
        gender: skipped ? null : (step1.gender ?? null),
        birthday: skipped ? null : (step1.birthday.trim() || null),
      },
      measurements,
      profileUpdate,
      selfieUri: skipped ? null : (step3.selfieUri ?? null),
    };
  }

  function handleNext() {
    // Guard: block advancement from Step 1 if the birthday field has a value
    // but it fails validation.  Force the error UI to show.
    if (step === 0) {
      const bd = step1.birthday.trim();
      if (bd && !isValidBirthday(bd)) {
        setForceStep1Touched(true);
        return;
      }
    }
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      onDone(buildResult(false));
    }
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <AtmosphereBackground />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>misfitAI</Text>
        <StepDots total={TOTAL_STEPS} current={step} />
        <Text style={styles.title}>{STEP_TITLES[step]}</Text>
        <Text style={styles.subtitle}>{STEP_SUBTITLES[step]}</Text>

        {step === 0 && (
          <Step1
            state={step1}
            onChange={(patch) => setStep1((s) => ({ ...s, ...patch }))}
            forceTouched={forceStep1Touched}
          />
        )}
        {step === 1 && (
          <Step2
            state={step2}
            onChange={(patch) => setStep2((s) => ({ ...s, ...patch }))}
          />
        )}
        {step === 2 && (
          <Step3
            state={step3}
            onChange={(patch) => setStep3((s) => ({ ...s, ...patch }))}
          />
        )}

        <View style={styles.actions}>
          {step === 0 ? (
            <Pressable
              onPress={() => onDone(buildResult(true))}
              style={[styles.button, styles.buttonGhost]}
            >
              <Text style={[styles.buttonText, styles.buttonGhostText]}>Skip all</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleBack} style={[styles.button, styles.buttonGhost]}>
              <Text style={[styles.buttonText, styles.buttonGhostText]}>Back</Text>
            </Pressable>
          )}
          <Pressable onPress={handleNext} style={[styles.button, styles.buttonPrimary]}>
            <Text style={[styles.buttonText, styles.buttonPrimaryText]}>
              {isLastStep ? 'Finish' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const shared = StyleSheet.create({
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
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  swatchItem: {
    alignItems: 'center',
    width: 52,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: {
    borderColor: palette.accent,
  },
  swatchLabel: {
    fontSize: 10,
    color: palette.muted,
    fontFamily: type.body,
    textAlign: 'center',
    marginTop: 4,
  },
  swatchLabelActive: {
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
    marginBottom: 10,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 48,
    paddingBottom: 32,
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
    marginBottom: 12,
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
  measurementsToggle: {
    paddingVertical: 10,
    marginBottom: 4,
  },
  measurementsToggleText: {
    fontSize: 13,
    color: palette.accent,
    fontFamily: type.bodyDemi,
  },
  measurementsHint: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 18,
    marginBottom: 14,
  },
  measurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  measurementLabel: {
    fontSize: 13,
    color: palette.inkSoft,
    fontFamily: type.body,
    flex: 1,
  },
  measurementInput: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: palette.ink,
    fontFamily: type.body,
    width: 90,
    textAlign: 'right',
  },
  actions: {
    marginTop: 8,
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
