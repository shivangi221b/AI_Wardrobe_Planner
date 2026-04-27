import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import { useAppState } from './AppStateContext';
import {
  API_BASE_URL,
  generateAvatar,
  getUserProfile,
  updateUserProfile,
} from './api';
import type {
  AvatarConfig,
  BodyMeasurements,
  ColorTone,
  SkinTone,
  UserProfile,
  UserProfileUpdate,
} from './types';

// ---------------------------------------------------------------------------
// Constants (shared with wizard — colour data, sizes, avatar options)
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
// Small shared UI helpers
// ---------------------------------------------------------------------------

function SectionHeader({ title, onEdit }: { title: string; onEdit?: () => void }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={8}>
          <Text style={s.editLink}>Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value || '—'}</Text>
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { key: T; label: string }[];
  value: T | null | undefined;
  onSelect: (v: T | null) => void;
}) {
  return (
    <View style={s.chipRow}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onSelect(active ? null : opt.key)}
            style={[s.chip, active && s.chipActive]}
          >
            <Text style={[s.chipText, active && s.chipTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ColorSwatchGrid({
  colors,
  selected,
  onToggle,
}: {
  colors: { key: string; label: string; hex: string }[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <View style={s.swatchGrid}>
      {colors.map((c) => {
        const active = selected.includes(c.key);
        return (
          <Pressable key={c.key} onPress={() => onToggle(c.key)} style={s.swatchItem}>
            <View
              style={[
                s.swatch,
                { backgroundColor: c.hex },
                active && s.swatchActive,
              ]}
            />
            <Text style={[s.swatchLabel, active && s.swatchLabelActive]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty && !saving) return null;
  return (
    <View style={s.saveBar}>
      <Pressable onPress={onDiscard} style={[s.btn, s.btnGhost]}>
        <Text style={[s.btnText, s.btnGhostText]}>Discard</Text>
      </Pressable>
      <Pressable onPress={onSave} style={[s.btn, s.btnPrimary]} disabled={saving}>
        {saving ? (
          <ActivityIndicator color={palette.panelStrong} size="small" />
        ) : (
          <Text style={[s.btnText, s.btnPrimaryText]}>Save</Text>
        )}
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar preview + edit modal
// ---------------------------------------------------------------------------

/** Backend may return a path like ``/assets/local-avatars/…`` — resolve against the API host (needed for Expo web). Preserves ``?cb=`` cache-busters. */
function resolveAvatarImageUri(url: string): string {
  const q = url.indexOf('?');
  const pathPart = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : '';
  if (/^https?:\/\//i.test(pathPart)) return `${pathPart}${query}`;
  if (pathPart.startsWith('/')) return `${API_BASE_URL}${pathPart}${query}`;
  return url;
}

function AvatarPreview({
  avatar,
  skinTone,
  imageUri,
}: {
  avatar: AvatarConfig | null | undefined;
  skinTone: SkinTone | null | undefined;
  /** When set, shows the generated portrait at compact thumbnail size (placeholder circle otherwise). */
  imageUri?: string | null;
}) {
  const hex =
    SKIN_TONES.find((t) => t.key === (avatar?.skinTone ?? skinTone))?.hex ?? '#D4956A';

  return (
    <View style={s.avatarPreview}>
      {imageUri ? (
        <Image
          source={{ uri: resolveAvatarImageUri(imageUri) }}
          style={s.avatarImageThumb}
          resizeMode="cover"
        />
      ) : (
        <View style={[s.avatarCircle, { backgroundColor: hex }]}>
          <Text style={s.avatarInitial}>👤</Text>
        </View>
      )}
      <View style={s.avatarDetails}>
        <Text style={s.avatarLine}>
          {imageUri ? 'Illustrated portrait' : 'Preview'}
        </Text>
        <Text style={s.avatarLine}>
          {avatar?.bodyType ? avatar.bodyType.replace('_', ' ') : 'Body type: —'}
        </Text>
        <Text style={s.avatarLine}>
          {avatar?.hairStyle ? avatar.hairStyle.replace(/_/g, ' ') : 'Hair: —'}
        </Text>
        <Text style={s.avatarLine}>
          {avatar?.hairColor ? avatar.hairColor.replace(/_/g, ' ') : 'Hair colour: —'}
        </Text>
      </View>
    </View>
  );
}

interface AvatarEditState {
  hairStyle: string | null;
  hairColor: string | null;
  bodyType: string | null;
  skinTone: SkinTone | null;
}

function AvatarEditModal({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: AvatarEditState;
  onClose: () => void;
  onSave: (v: AvatarEditState) => void;
}) {
  const [draft, setDraft] = useState<AvatarEditState>(initial);
  useEffect(() => { setDraft(initial); }, [visible, initial]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSafe}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Edit Avatar</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.modalClose}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Skin Tone</Text>
          <View style={s.swatchGrid}>
            {SKIN_TONES.map((st) => {
              const active = draft.skinTone === st.key;
              return (
                <Pressable
                  key={st.key}
                  onPress={() => setDraft((d) => ({ ...d, skinTone: active ? null : st.key }))}
                  style={s.swatchItem}
                >
                  <View style={[s.swatch, { backgroundColor: st.hex }, active && s.swatchActive]} />
                  <Text style={[s.swatchLabel, active && s.swatchLabelActive]}>{st.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.label, { marginTop: 16 }]}>Hair Style</Text>
          <ChipRow
            options={HAIR_STYLES}
            value={draft.hairStyle as string | null}
            onSelect={(v) => setDraft((d) => ({ ...d, hairStyle: v }))}
          />

          <Text style={[s.label, { marginTop: 16 }]}>Hair Colour</Text>
          <ChipRow
            options={HAIR_COLORS}
            value={draft.hairColor as string | null}
            onSelect={(v) => setDraft((d) => ({ ...d, hairColor: v }))}
          />

          <Text style={[s.label, { marginTop: 16 }]}>Body Type</Text>
          <ChipRow
            options={BODY_TYPES}
            value={draft.bodyType as string | null}
            onSelect={(v) => setDraft((d) => ({ ...d, bodyType: v }))}
          />
        </ScrollView>
        <View style={s.modalFooter}>
          <Pressable onPress={onClose} style={[s.btn, s.btnGhost]}>
            <Text style={[s.btnText, s.btnGhostText]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => { onSave(draft); onClose(); }} style={[s.btn, s.btnPrimary]}>
            <Text style={[s.btnText, s.btnPrimaryText]}>Apply</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main ProfileScreen
// ---------------------------------------------------------------------------

function parsePositiveFloat(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function ProfileScreen({ userId, displayName }: { userId: string; displayName?: string | null }) {
  const { measurements, updateMeasurements } = useAppState();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // --- Personal section ---
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);
  const [birthday, setBirthday] = useState('');
  const [personalDirty, setPersonalDirty] = useState(false);
  const [personalSaving, setPersonalSaving] = useState(false);

  // --- Body measurements ---
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [chestCm, setChestCm] = useState('');
  const [waistCm, setWaistCm] = useState('');
  const [hipsCm, setHipsCm] = useState('');
  const [inseamCm, setInseamCm] = useState('');
  const [bodyDirty, setBodyDirty] = useState(false);
  const [bodySaving, setBodySaving] = useState(false);

  // --- Style preferences ---
  const [skinTone, setSkinTone] = useState<SkinTone | null>(null);
  const [colorTone, setColorTone] = useState<ColorTone | null>(null);
  const [favoriteColors, setFavoriteColors] = useState<string[]>([]);
  const [avoidedColors, setAvoidedColors] = useState<string[]>([]);
  const [styleDirty, setStyleDirty] = useState(false);
  const [styleSaving, setStyleSaving] = useState(false);

  // --- Sizes ---
  const [topSize, setTopSize] = useState<string | null>(null);
  const [bottomSize, setBottomSize] = useState<string | null>(null);
  const [shoeSize, setShoeSize] = useState('');
  const [sizesDirty, setSizesDirty] = useState(false);
  const [sizesSaving, setSizesSaving] = useState(false);

  // --- Avatar ---
  const [avatar, setAvatar] = useState<AvatarConfig | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarImageUrl, setAvatarImageUrl] = useState<string | null>(null);
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // --- Load ---
  useEffect(() => {
    setLoading(true);
    getUserProfile(userId)
      .then((p) => {
        if (p) {
          setProfile(p);
          setGender(p.gender ?? null);
          setBirthday(p.birthday ?? '');
          setSkinTone(p.skinTone ?? null);
          setColorTone(p.colorTone ?? null);
          setFavoriteColors(p.favoriteColors ?? []);
          setAvoidedColors(p.avoidedColors ?? []);
          setTopSize(p.topSize ?? null);
          setBottomSize(p.bottomSize ?? null);
          setShoeSize(p.shoeSize ?? '');
          setAvatar(p.avatarConfig ?? null);
          {
            const raw = p.avatarConfig?.avatarImageUrl ?? null;
            const base = raw ? raw.split('?')[0] : null;
            setAvatarImageUrl(
              base ? `${base}?cb=${encodeURIComponent(p.updatedAt ?? String(Date.now()))}` : null
            );
          }
        }
      })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (measurements) {
      setHeightCm(measurements.heightCm != null ? String(measurements.heightCm) : '');
      setWeightKg(measurements.weightKg != null ? String(measurements.weightKg) : '');
      setChestCm(measurements.chestCm != null ? String(measurements.chestCm) : '');
      setWaistCm(measurements.waistCm != null ? String(measurements.waistCm) : '');
      setHipsCm(measurements.hipsCm != null ? String(measurements.hipsCm) : '');
      setInseamCm(measurements.inseamCm != null ? String(measurements.inseamCm) : '');
    }
  }, [measurements]);

  // --- Save helpers ---

  const savePersonal = useCallback(async () => {
    setPersonalSaving(true);
    try {
      const updated = await updateUserProfile(userId, {
        gender: gender ?? null,
        birthday: birthday.trim() || null,
      });
      setProfile(updated);
      setPersonalDirty(false);
    } catch {
      Alert.alert('Save failed', 'Could not save personal info. Please try again.');
      // Keep dirty=true so the save bar remains visible.
    } finally {
      setPersonalSaving(false);
    }
  }, [userId, gender, birthday]);

  const saveBody = useCallback(async () => {
    setBodySaving(true);
    try {
      const data: Omit<BodyMeasurements, 'userId' | 'updatedAt'> = {
        heightCm: parsePositiveFloat(heightCm),
        weightKg: parsePositiveFloat(weightKg),
        chestCm: parsePositiveFloat(chestCm),
        waistCm: parsePositiveFloat(waistCm),
        hipsCm: parsePositiveFloat(hipsCm),
        inseamCm: parsePositiveFloat(inseamCm),
      };
      await updateMeasurements(data);
      setBodyDirty(false);
    } catch {
      Alert.alert('Save failed', 'Could not save measurements. Please try again.');
    } finally {
      setBodySaving(false);
    }
  }, [userId, heightCm, weightKg, chestCm, waistCm, hipsCm, inseamCm, updateMeasurements]);

  const saveStyle = useCallback(async () => {
    setStyleSaving(true);
    try {
      const updated = await updateUserProfile(userId, {
        skinTone,
        colorTone,
        favoriteColors,
        avoidedColors,
      });
      setProfile(updated);
      setStyleDirty(false);
    } catch {
      Alert.alert('Save failed', 'Could not save style preferences. Please try again.');
    } finally {
      setStyleSaving(false);
    }
  }, [userId, skinTone, colorTone, favoriteColors, avoidedColors]);

  const saveSizes = useCallback(async () => {
    setSizesSaving(true);
    try {
      const updated = await updateUserProfile(userId, {
        topSize: topSize ?? null,
        bottomSize: bottomSize ?? null,
        shoeSize: shoeSize.trim() || null,
      });
      setProfile(updated);
      setSizesDirty(false);
    } catch {
      Alert.alert('Save failed', 'Could not save sizes. Please try again.');
    } finally {
      setSizesSaving(false);
    }
  }, [userId, topSize, bottomSize, shoeSize]);

  const saveAvatar = useCallback(async (newAvatar: AvatarConfig) => {
    setAvatar(newAvatar);
    try {
      const updated = await updateUserProfile(userId, { avatarConfig: newAvatar });
      setProfile(updated);
    } catch {
      /* non-blocking */
    }
  }, [userId]);

  // --- Selfie capture + avatar generation ---

  const pickSelfie = useCallback(
    async (fromCamera: boolean) => {
      // Request permission for camera if needed.
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

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const selfieUri = result.assets[0].uri;
      setAvatarGenerating(true);
      setAvatarError(null);

      try {
        const asset = result.assets[0];
        const url = await generateAvatar(userId, selfieUri, {
          mimeType: asset.mimeType,
          fileName: asset.fileName ?? undefined,
          type: asset.type,
        });
        const canonical = url.split('?')[0];
        // Same storage path is overwritten on regenerate — bust HTTP cache for the Image view.
        setAvatarImageUrl(`${canonical}?cb=${Date.now()}`);
        const newAvatar: AvatarConfig = {
          ...(avatar ?? {}),
          avatarImageUrl: canonical,
        };
        setAvatar(newAvatar);
        await updateUserProfile(userId, { avatarConfig: newAvatar });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Avatar generation failed.';
        setAvatarError(msg);
      } finally {
        setAvatarGenerating(false);
      }
    },
    [userId, avatar]
  );

  const promptSelfieSource = useCallback(() => {
    // react-native-web: Alert with action buttons is unreliable (often no UI).
    // Open the file picker immediately; native keeps the camera vs library sheet.
    if (Platform.OS === 'web') {
      void pickSelfie(false);
      return;
    }
    Alert.alert(
      'Generate your avatar',
      'Choose a photo source',
      [
        { text: 'Take selfie', onPress: () => void pickSelfie(true) },
        { text: 'Choose from library', onPress: () => void pickSelfie(false) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [pickSelfie]);

  // --- Discard helpers ---
  const discardPersonal = () => {
    setGender(profile?.gender ?? null);
    setBirthday(profile?.birthday ?? '');
    setPersonalDirty(false);
  };
  const discardBody = () => {
    if (measurements) {
      setHeightCm(measurements.heightCm != null ? String(measurements.heightCm) : '');
      setWeightKg(measurements.weightKg != null ? String(measurements.weightKg) : '');
      setChestCm(measurements.chestCm != null ? String(measurements.chestCm) : '');
      setWaistCm(measurements.waistCm != null ? String(measurements.waistCm) : '');
      setHipsCm(measurements.hipsCm != null ? String(measurements.hipsCm) : '');
      setInseamCm(measurements.inseamCm != null ? String(measurements.inseamCm) : '');
    }
    setBodyDirty(false);
  };
  const discardStyle = () => {
    setSkinTone(profile?.skinTone ?? null);
    setColorTone(profile?.colorTone ?? null);
    setFavoriteColors(profile?.favoriteColors ?? []);
    setAvoidedColors(profile?.avoidedColors ?? []);
    setStyleDirty(false);
  };
  const discardSizes = () => {
    setTopSize(profile?.topSize ?? null);
    setBottomSize(profile?.bottomSize ?? null);
    setShoeSize(profile?.shoeSize ?? '');
    setSizesDirty(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <AtmosphereBackground />
        <View style={s.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <AtmosphereBackground />
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <Text style={s.screenTitle}>My Profile</Text>

        {/* ---- Personal ---- */}
        <SectionHeader title="Personal" />
        <View style={s.card}>
          {displayName ? <FieldRow label="Name" value={displayName} /> : null}

          <Text style={s.label}>Gender</Text>
          <ChipRow
            options={[
              { key: 'female', label: 'Female' },
              { key: 'male', label: 'Male' },
              { key: 'other', label: 'Other' },
            ]}
            value={gender}
            onSelect={(v) => { setGender(v as typeof gender); setPersonalDirty(true); }}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Birthday</Text>
          <TextInput
            value={birthday}
            onChangeText={(v) => { setBirthday(v); setPersonalDirty(true); }}
            placeholder="YYYY-MM-DD (optional)"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
            style={s.input}
          />
        </View>
        <SaveBar dirty={personalDirty} saving={personalSaving} onSave={savePersonal} onDiscard={discardPersonal} />

        {/* ---- Body measurements ---- */}
        <SectionHeader title="Body Measurements" />
        <View style={s.card}>
          <Text style={s.hint}>All in centimetres / kilograms. Used to suggest better-fitting items.</Text>
          {(
            [
              { label: 'Height (cm)', value: heightCm, setter: setHeightCm },
              { label: 'Weight (kg)', value: weightKg, setter: setWeightKg },
              { label: 'Chest / Bust (cm)', value: chestCm, setter: setChestCm },
              { label: 'Waist (cm)', value: waistCm, setter: setWaistCm },
              { label: 'Hips (cm)', value: hipsCm, setter: setHipsCm },
              { label: 'Inseam (cm)', value: inseamCm, setter: setInseamCm },
            ] as const
          ).map(({ label, value, setter }) => (
            <View key={label} style={s.measureRow}>
              <Text style={s.measureLabel}>{label}</Text>
              <TextInput
                value={value}
                onChangeText={(v) => { setter(v); setBodyDirty(true); }}
                placeholder="—"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                style={s.measureInput}
              />
            </View>
          ))}
        </View>
        <SaveBar dirty={bodyDirty} saving={bodySaving} onSave={saveBody} onDiscard={discardBody} />

        {/* ---- Style preferences ---- */}
        <SectionHeader title="Style Preferences" />
        <View style={s.card}>
          <Text style={s.label}>Skin Tone</Text>
          <View style={s.swatchGrid}>
            {SKIN_TONES.map((st) => {
              const active = skinTone === st.key;
              return (
                <Pressable
                  key={st.key}
                  onPress={() => { setSkinTone(active ? null : st.key); setStyleDirty(true); }}
                  style={s.swatchItem}
                >
                  <View style={[s.swatch, { backgroundColor: st.hex }, active && s.swatchActive]} />
                  <Text style={[s.swatchLabel, active && s.swatchLabelActive]}>{st.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.label, { marginTop: 16 }]}>Colour Tone</Text>
          <ChipRow
            options={COLOR_TONE_OPTIONS}
            value={colorTone}
            onSelect={(v) => { setColorTone(v as ColorTone | null); setStyleDirty(true); }}
          />

          <Text style={[s.label, { marginTop: 16 }]}>Favourite Colours</Text>
          <ColorSwatchGrid
            colors={PALETTE_COLORS}
            selected={favoriteColors}
            onToggle={(key) => {
              const next = favoriteColors.includes(key)
                ? favoriteColors.filter((c) => c !== key)
                : [...favoriteColors, key];
              setFavoriteColors(next);
              setStyleDirty(true);
            }}
          />

          <Text style={[s.label, { marginTop: 16 }]}>Colours to Avoid</Text>
          <ColorSwatchGrid
            colors={PALETTE_COLORS}
            selected={avoidedColors}
            onToggle={(key) => {
              const next = avoidedColors.includes(key)
                ? avoidedColors.filter((c) => c !== key)
                : [...avoidedColors, key];
              setAvoidedColors(next);
              setStyleDirty(true);
            }}
          />
        </View>
        <SaveBar dirty={styleDirty} saving={styleSaving} onSave={saveStyle} onDiscard={discardStyle} />

        {/* ---- Sizes ---- */}
        <SectionHeader title="Sizes" />
        <View style={s.card}>
          <Text style={s.label}>Top Size</Text>
          <ChipRow
            options={SIZE_OPTIONS.map((sz) => ({ key: sz, label: sz }))}
            value={topSize}
            onSelect={(v) => { setTopSize(v); setSizesDirty(true); }}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Bottom Size</Text>
          <ChipRow
            options={SIZE_OPTIONS.map((sz) => ({ key: sz, label: sz }))}
            value={bottomSize}
            onSelect={(v) => { setBottomSize(v); setSizesDirty(true); }}
          />

          <Text style={[s.label, { marginTop: 14 }]}>Shoe Size (EU / US)</Text>
          <TextInput
            value={shoeSize}
            onChangeText={(v) => { setShoeSize(v); setSizesDirty(true); }}
            placeholder="e.g. 42 or 9"
            placeholderTextColor={palette.muted}
            keyboardType="decimal-pad"
            style={s.input}
          />
        </View>
        <SaveBar dirty={sizesDirty} saving={sizesSaving} onSave={saveSizes} onDiscard={discardSizes} />

        {/* ---- Avatar ---- */}
        <SectionHeader title="Avatar" />
        <View style={s.card}>
          <AvatarPreview
            avatar={avatar}
            skinTone={skinTone}
            imageUri={avatarImageUrl}
          />
          {!gender ? (
            <Text style={s.avatarHint}>
              Set your gender under Personal info so generated portraits match you more reliably.
            </Text>
          ) : null}

          {/* Generation status / error */}
          {avatarGenerating ? (
            <View style={s.avatarGeneratingRow}>
              <ActivityIndicator color={palette.accent} size="small" />
              <Text style={s.avatarGeneratingText}>Generating your avatar…</Text>
            </View>
          ) : null}
          {avatarError ? (
            <Text style={s.avatarErrorText}>{avatarError}</Text>
          ) : null}

          {/* Action buttons */}
          <View style={[s.saveBar, { marginTop: 14 }]}>
            <Pressable
              onPress={promptSelfieSource}
              style={[s.btn, s.btnPrimary]}
              disabled={avatarGenerating}
            >
              <Text style={[s.btnText, s.btnPrimaryText]}>
                {avatarImageUrl ? 'Regenerate from selfie' : 'Generate from selfie'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAvatarModalOpen(true)}
              style={[s.btn, s.btnGhost]}
              disabled={avatarGenerating}
            >
              <Text style={[s.btnText, s.btnGhostText]}>Edit details</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <AvatarEditModal
        visible={avatarModalOpen}
        initial={{
          hairStyle: avatar?.hairStyle ?? null,
          hairColor: avatar?.hairColor ?? null,
          bodyType: avatar?.bodyType ?? null,
          skinTone: (avatar?.skinTone ?? skinTone) as SkinTone | null,
        }}
        onClose={() => setAvatarModalOpen(false)}
        onSave={(draft) => {
          const newAvatar: AvatarConfig = {
            hairStyle: draft.hairStyle,
            hairColor: draft.hairColor,
            bodyType: draft.bodyType,
            skinTone: draft.skinTone,
          };
          void saveAvatar(newAvatar);
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 26,
    color: palette.ink,
    fontFamily: type.title,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
  },
  editLink: {
    fontSize: 13,
    color: palette.accent,
    fontFamily: type.bodyDemi,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    padding: 16,
    marginBottom: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  fieldLabel: {
    fontSize: 13,
    color: palette.muted,
    fontFamily: type.body,
  },
  fieldValue: {
    fontSize: 13,
    color: palette.ink,
    fontFamily: type.bodyMedium,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 18,
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
  measureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  measureLabel: {
    fontSize: 13,
    color: palette.inkSoft,
    fontFamily: type.body,
    flex: 1,
  },
  measureInput: {
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
  swatchGrid: {
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
  saveBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    marginTop: 2,
  },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: palette.lineStrong,
  },
  btnPrimary: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderColor: palette.accent,
    flex: 0,
    paddingHorizontal: 20,
  },
  btnText: {
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  btnGhostText: {
    color: palette.inkSoft,
  },
  btnPrimaryText: {
    color: palette.panelStrong,
  },
  btnOutlineText: {
    color: palette.accent,
  },
  avatarPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 32,
  },
  avatarDetails: {
    flex: 1,
    gap: 4,
  },
  avatarLine: {
    fontSize: 13,
    color: palette.inkSoft,
    fontFamily: type.body,
    textTransform: 'capitalize',
  },
  // Modal
  modalSafe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: type.title,
    color: palette.ink,
  },
  modalClose: {
    fontSize: 18,
    color: palette.muted,
    fontFamily: type.body,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  avatarImageThumb: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: palette.bgAlt,
  },
  avatarGeneratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  avatarGeneratingText: {
    fontSize: 13,
    color: palette.muted,
    fontFamily: type.body,
  },
  avatarErrorText: {
    marginTop: 10,
    fontSize: 12,
    color: palette.error,
    fontFamily: type.body,
  },
  avatarHint: {
    marginTop: 10,
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 17,
  },
});
