import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AtmosphereBackground } from './AtmosphereBackground';
import { palette, radius, type } from './theme';
import { useAppState } from './AppStateContext';
import {
  addGarmentsBulk,
  commitVisionItems,
  getApiErrorMessage,
  previewStarterGarment,
  saveStylePreferences,
  USE_MOCK_API,
} from './api';
import type { AddGarmentPayload, VisionPreviewItem } from './api';
import { SEARCH_BRANDS } from './searchOptions';
import type {
  GarmentCategory,
  GarmentFormality,
  GarmentSeasonality,
  DayRecommendation,
} from './types';
import type { AuthMode, AuthProvider, UserProfile } from './AuthScreen';

// ---- Session type (mirrors App.tsx — keep in sync) -------------------------
type Session = {
  provider: AuthProvider;
  mode: AuthMode;
  profile?: UserProfile;
  userId: string;
  profileCompleted?: boolean;
  onboardingCompleted?: boolean;
};

const SESSION_STORAGE_KEY = '@misfitai/session';

// ---- Starter catalog -------------------------------------------------------

type CatalogItem = {
  id: string;
  name: string;
  category: GarmentCategory;
  color: string;
  formality: GarmentFormality;
};

const STARTER_CATALOG: CatalogItem[] = [
  // Tops
  { id: 'cat-white-tee', name: 'White T-shirt', category: 'top', color: 'white', formality: 'casual' },
  { id: 'cat-black-tee', name: 'Black T-shirt', category: 'top', color: 'black', formality: 'casual' },
  { id: 'cat-gray-hoodie', name: 'Gray Hoodie', category: 'top', color: 'gray', formality: 'casual' },
  { id: 'cat-white-oxford', name: 'White Oxford Shirt', category: 'top', color: 'white', formality: 'business' },
  { id: 'cat-stripe-shirt', name: 'Striped Button-down', category: 'top', color: 'blue', formality: 'smart_casual' },
  { id: 'cat-knit-sweater', name: 'Knit Sweater', category: 'top', color: 'cream', formality: 'smart_casual' },
  { id: 'cat-black-blazer', name: 'Black Blazer', category: 'top', color: 'black', formality: 'business' },
  // Bottoms
  { id: 'cat-blue-jeans', name: 'Blue Jeans', category: 'bottom', color: 'blue', formality: 'casual' },
  { id: 'cat-black-jeans', name: 'Black Jeans', category: 'bottom', color: 'black', formality: 'smart_casual' },
  { id: 'cat-khaki-chinos', name: 'Khaki Chinos', category: 'bottom', color: 'khaki', formality: 'smart_casual' },
  { id: 'cat-navy-shorts', name: 'Navy Shorts', category: 'bottom', color: 'navy', formality: 'casual' },
  { id: 'cat-black-trousers', name: 'Black Dress Pants', category: 'bottom', color: 'black', formality: 'business' },
  { id: 'cat-gray-sweats', name: 'Gray Sweatpants', category: 'bottom', color: 'gray', formality: 'casual' },
  // Shoes
  { id: 'cat-white-sneakers', name: 'White Sneakers', category: 'shoes', color: 'white', formality: 'casual' },
  { id: 'cat-black-sneakers', name: 'Black Sneakers', category: 'shoes', color: 'black', formality: 'casual' },
  { id: 'cat-chelsea-boots', name: 'Black Chelsea Boots', category: 'shoes', color: 'black', formality: 'smart_casual' },
  { id: 'cat-brown-loafers', name: 'Brown Loafers', category: 'shoes', color: 'brown', formality: 'smart_casual' },
  { id: 'cat-running-shoes', name: 'Running Shoes', category: 'shoes', color: 'white', formality: 'casual' },
  // Outerwear
  { id: 'cat-denim-jacket', name: 'Denim Jacket', category: 'outerwear', color: 'blue', formality: 'casual' },
  { id: 'cat-black-puffer', name: 'Black Puffer Jacket', category: 'outerwear', color: 'black', formality: 'casual' },
  { id: 'cat-trench-coat', name: 'Beige Trench Coat', category: 'outerwear', color: 'beige', formality: 'smart_casual' },
];

const CATALOG_SECTIONS: { category: GarmentCategory; label: string }[] = [
  { category: 'top', label: 'Tops' },
  { category: 'bottom', label: 'Bottoms' },
  { category: 'shoes', label: 'Shoes' },
  { category: 'outerwear', label: 'Outerwear' },
];

const FORMALITY_OPTIONS: GarmentFormality[] = ['casual', 'smart_casual', 'business', 'formal'];

const SEASONALITY_OPTIONS: GarmentSeasonality[] = ['all_season', 'hot', 'mild', 'cold'];

type CatalogItemConfig = {
  name: string;
  color: string;
  size: string;
  formality: GarmentFormality;
  seasonality: GarmentSeasonality;
};

type CustomWardrobeItem = {
  id: string;
  name: string;
  category: GarmentCategory;
  color: string;
  size: string;
  formality: GarmentFormality;
  seasonality: GarmentSeasonality;
};

function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function defaultCatalogConfig(item: CatalogItem): CatalogItemConfig {
  return {
    name: item.name,
    color: item.color,
    size: '',
    formality: item.formality,
    seasonality: 'all_season',
  };
}

// ---- Style options ---------------------------------------------------------

const AESTHETICS = [
  { key: 'casual', label: 'Casual', desc: 'Relaxed everyday looks' },
  { key: 'streetwear', label: 'Streetwear', desc: 'Bold and urban' },
  { key: 'business_casual', label: 'Business Casual', desc: 'Sharp but approachable' },
  { key: 'maximalist', label: 'Maximalist', desc: 'More is more' },
  { key: 'minimalist', label: 'Minimalist', desc: 'Clean and refined' },
  { key: 'sporty', label: 'Sporty', desc: 'Active and athletic' },
];

const COLOR_TONES = [
  { key: 'neutrals', label: 'Neutrals', desc: 'Black, white, gray, beige' },
  { key: 'warm', label: 'Warm Tones', desc: 'Brown, camel, red, orange' },
  { key: 'cool', label: 'Cool Tones', desc: 'Blue, green, teal, purple' },
  { key: 'bold', label: 'Bold Colors', desc: 'Saturated, vivid hues' },
  { key: 'all', label: 'All Colors', desc: 'A bit of everything' },
];

const FEATURED_BRANDS = [
  'Nike', 'Adidas', 'Zara', 'H&M', 'Gap', "Levi's", 'Ralph Lauren', 'Calvin Klein',
  'Tommy Hilfiger', 'Lululemon', 'Uniqlo', 'J.Crew', 'Madewell', 'Free People',
  'Urban Outfitters', 'Everlane', 'Patagonia', 'The North Face', 'New Balance', 'Vans',
];

const CUSTOM_CATEGORIES: { key: GarmentCategory; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'outerwear', label: 'Outerwear' },
  { key: 'accessory', label: 'Accessory' },
];

const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  dress: 'Dresses',
  outerwear: 'Outerwear',
  shoes: 'Shoes',
  accessory: 'Accessories',
};

// ---- Helpers ---------------------------------------------------------------

function isValidBirthday(value: string): boolean {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parsePositiveFloat(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function titleCaseDay(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- Shared sub-components -------------------------------------------------

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <View style={progressSt.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            progressSt.dot,
            i < current && progressSt.dotDone,
            i === current && progressSt.dotActive,
          ]}
        />
      ))}
      <Text style={progressSt.label}>{current + 1} of {total}</Text>
    </View>
  );
}

const progressSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.line },
  dotDone: { backgroundColor: palette.lineStrong },
  dotActive: { width: 20, backgroundColor: palette.accent },
  label: { fontSize: 11, color: palette.muted, fontFamily: type.bodyMedium, marginLeft: 4 },
});

function Chip({
  label,
  active,
  onPress,
  subtitle,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  subtitle?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[chipSt.chip, active && chipSt.chipActive]}>
      <Text style={[chipSt.text, active && chipSt.textActive]}>{label}</Text>
      {subtitle ? (
        <Text style={[chipSt.sub, active && chipSt.subActive]}>{subtitle}</Text>
      ) : null}
    </Pressable>
  );
}

const chipSt = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  text: { fontSize: 13, color: palette.inkSoft, fontFamily: type.bodyMedium },
  textActive: { color: palette.textOnAccent },
  sub: { fontSize: 11, color: palette.muted, fontFamily: type.body, marginTop: 2 },
  subActive: { color: palette.accentSoft },
});

// ---- Main component --------------------------------------------------------

export function OnboardingFlow({
  session,
  setSession,
}: {
  session: Session;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
}) {
  const { userId, updateMeasurements, useDemoWeek, generateRecommendations, recommendations } =
    useAppState();

  // Step index: 0=profile, 1=style, 2=catalog, 3=review, 4=outfits
  const [step, setStep] = useState(0);

  // Step 0 — profile
  const [gender, setGender] = useState<UserProfile['gender']>(session.profile?.gender ?? null);
  const [birthday, setBirthday] = useState(session.profile?.birthday ?? '');
  const [birthdayTouched, setBirthdayTouched] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [chestCm, setChestCm] = useState('');
  const [waistCm, setWaistCm] = useState('');
  const [hipsCm, setHipsCm] = useState('');
  const [inseamCm, setInseamCm] = useState('');

  // Step 1 — style
  const [aesthetics, setAesthetics] = useState<Set<string>>(new Set());
  const [colorTones, setColorTones] = useState<Set<string>>(new Set());
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');

  // Step 2 — catalog
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());

  // Step 3 — review & custom items
  const [catalogConfigs, setCatalogConfigs] = useState<Record<string, CatalogItemConfig>>({});
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<GarmentCategory>('top');
  const [customColor, setCustomColor] = useState('');
  const [customSize, setCustomSize] = useState('');
  const [customFormality, setCustomFormality] = useState<GarmentFormality>('casual');
  const [customSeasonality, setCustomSeasonality] = useState<GarmentSeasonality>('all_season');
  const [customItems, setCustomItems] = useState<CustomWardrobeItem[]>([]);
  const [imageGenProgress, setImageGenProgress] = useState<{ current: number; total: number } | null>(
    null
  );

  // Build / save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Derived
  const birthdayError = useMemo(() => {
    if (!birthdayTouched) return null;
    const v = birthday.trim();
    if (!v) return null;
    return isValidBirthday(v) ? null : 'Use YYYY-MM-DD format (e.g. 2001-04-07).';
  }, [birthday, birthdayTouched]);

  const selectedCatalogItems = STARTER_CATALOG.filter((i) => ownedIds.has(i.id));
  const totalItemCount = selectedCatalogItems.length + customItems.length;

  useEffect(() => {
    if (step !== 3) return;
    setCatalogConfigs((prev) => {
      const next: Record<string, CatalogItemConfig> = {};
      for (const id of ownedIds) {
        const catalog = STARTER_CATALOG.find((i) => i.id === id);
        if (!catalog) continue;
        const existing = prev[id];
        next[id] = existing ?? defaultCatalogConfig(catalog);
      }
      return next;
    });
  }, [step, ownedIds]);

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    const pool = showAllBrands ? SEARCH_BRANDS : FEATURED_BRANDS;
    if (!q) return pool;
    return pool.filter((b) => b.toLowerCase().includes(q));
  }, [brandSearch, showAllBrands]);

  // ---- Action handlers -----------------------------------------------------

  function addCustomItem() {
    const name = customName.trim();
    if (!name) return;
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCustomItems((prev) => [
      ...prev,
      {
        id,
        name,
        category: customCategory,
        color: customColor.trim(),
        size: customSize.trim(),
        formality: customFormality,
        seasonality: customSeasonality,
      },
    ]);
    setCustomName('');
    setCustomColor('');
    setCustomSize('');
  }

  function getCatalogConfig(item: CatalogItem): CatalogItemConfig {
    return catalogConfigs[item.id] ?? defaultCatalogConfig(item);
  }

  function patchCatalogConfig(itemId: string, patch: Partial<CatalogItemConfig>) {
    setCatalogConfigs((prev) => {
      const catalog = STARTER_CATALOG.find((i) => i.id === itemId);
      if (!catalog) return prev;
      const base = prev[itemId] ?? defaultCatalogConfig(catalog);
      return { ...prev, [itemId]: { ...base, ...patch } };
    });
  }

  function patchCustomItem(itemId: string, patch: Partial<CustomWardrobeItem>) {
    setCustomItems((prev) => prev.map((row) => (row.id === itemId ? { ...row, ...patch } : row)));
  }

  async function handleBuildWardrobe() {
    setIsSaving(true);
    setSaveError(null);
    setImageGenProgress(null);

    const placeholderImage = 'https://example.com/garment-placeholder.jpg';

    const mockBulkPayloads = [
      ...selectedCatalogItems.map((item) => {
        const c = getCatalogConfig(item);
        return {
          name: c.name.trim() || item.name,
          category: item.category,
          color: c.color,
          formality: c.formality,
          seasonality: c.seasonality,
          size: c.size.trim() || undefined,
        };
      }),
      ...customItems.map((item) => ({
        name: item.name.trim(),
        category: item.category,
        color: item.color,
        formality: item.formality,
        seasonality: item.seasonality,
        size: item.size.trim() || undefined,
      })),
    ];

    const orderedForVision = [
      ...selectedCatalogItems.map((item) => {
        const c = getCatalogConfig(item);
        return {
          name: (c.name.trim() || item.name).trim(),
          category: item.category,
          color: c.color,
          formality: c.formality,
          seasonality: c.seasonality,
          size: c.size.trim() || undefined,
        };
      }),
      ...customItems.map((item) => ({
        name: item.name.trim(),
        category: item.category,
        color: item.color,
        formality: item.formality,
        seasonality: item.seasonality,
        size: item.size.trim() || undefined,
      })),
    ];

    try {
      if (USE_MOCK_API) {
        if (mockBulkPayloads.length > 0) {
          await addGarmentsBulk(userId, mockBulkPayloads);
        }
      } else if (orderedForVision.length > 0) {
        const previews: VisionPreviewItem[] = [];
        const fallbacks: AddGarmentPayload[] = [];
        const total = orderedForVision.length;
        for (let i = 0; i < orderedForVision.length; i += 1) {
          const row = orderedForVision[i];
          setImageGenProgress({ current: i + 1, total });
          try {
            previews.push(
              await previewStarterGarment(userId, {
                name: row.name,
                category: row.category,
                color: row.color,
                formality: row.formality,
                seasonality: row.seasonality,
                size: row.size,
              })
            );
          } catch {
            fallbacks.push({
              name: row.name,
              category: row.category,
              color: row.color ?? '',
              formality: row.formality,
              seasonality: row.seasonality,
              size: row.size,
              primaryImageUrl: placeholderImage,
            });
          }
        }
        setImageGenProgress(null);
        if (previews.length > 0) {
          await commitVisionItems(userId, previews);
        }
        if (fallbacks.length > 0) {
          await addGarmentsBulk(userId, fallbacks);
        }
      }
    } catch (error) {
      setSaveError(
        getApiErrorMessage(
          error,
          'Could not save your starter wardrobe. Try again or skip to your wardrobe.'
        )
      );
      setIsSaving(false);
      setImageGenProgress(null);
      return;
    }

    // Save style preferences (non-blocking)
    saveStylePreferences(userId, {
      aesthetics: Array.from(aesthetics),
      brands: Array.from(selectedBrands),
      colorTones: Array.from(colorTones),
    }).catch(() => {});

    // Save body measurements if any were entered (non-blocking)
    const measurements = {
      heightCm: parsePositiveFloat(heightCm),
      weightKg: parsePositiveFloat(weightKg),
      chestCm: parsePositiveFloat(chestCm),
      waistCm: parsePositiveFloat(waistCm),
      hipsCm: parsePositiveFloat(hipsCm),
      inseamCm: parsePositiveFloat(inseamCm),
    };
    if (Object.values(measurements).some((v) => v != null)) {
      try {
        await updateMeasurements(measurements);
      } catch {
        // Measurement capture should not block onboarding completion.
      }
    }

    // Set a demo week and try to generate first outfit recommendations.
    useDemoWeek();
    try {
      await generateRecommendations();
    } catch {
      // Recommendation generation can be retried later from Calendar.
    }

    setStep(4);
    setIsSaving(false);
    setImageGenProgress(null);
  }

  function handleComplete() {
    const updatedSession: Session = {
      ...session,
      profile: {
        ...(session.profile ?? {}),
        gender: gender ?? null,
        birthday: birthday.trim() || null,
      },
      profileCompleted: true,
      onboardingCompleted: true,
    };
    setSession(updatedSession as Parameters<typeof setSession>[0]);
    AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedSession));
  }

  // ---- Shared render helpers -----------------------------------------------

  function renderHeader(title: string, subtitle?: string) {
    return (
      <>
        <Text style={st.brand}>misfitAI</Text>
        <StepProgress current={Math.min(step, 3)} total={4} />
        <Text style={st.title}>{title}</Text>
        {subtitle ? <Text style={st.subtitle}>{subtitle}</Text> : null}
      </>
    );
  }

  // ---- Step 0: Profile -------------------------------------------------------

  if (step === 0) {
    return (
      <SafeAreaView style={st.safe}>
        <AtmosphereBackground />
        <ScrollView
          contentContainerStyle={st.container}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader(
            "Let's get started",
            'Tell us a bit about yourself so we can personalize your experience.',
          )}

          <View style={st.card}>
            <Text style={st.sectionTitle}>Gender</Text>
            <View style={st.chipRow}>
              {(['female', 'male', 'other'] as const).map((g) => (
                <Chip
                  key={g}
                  label={g.charAt(0).toUpperCase() + g.slice(1)}
                  active={gender === g}
                  onPress={() => setGender(gender === g ? null : g)}
                />
              ))}
            </View>

            <Text style={[st.sectionTitle, { marginTop: 16 }]}>Birthday</Text>
            <TextInput
              value={birthday}
              onChangeText={setBirthday}
              onBlur={() => setBirthdayTouched(true)}
              placeholder="YYYY-MM-DD (optional)"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
              style={[st.input, birthdayError ? st.inputError : null]}
            />
            {birthdayError ? <Text style={st.errorText}>{birthdayError}</Text> : null}
          </View>

          <Pressable style={st.toggleRow} onPress={() => setShowMeasurements((v) => !v)}>
            <Text style={st.toggleText}>
              {showMeasurements ? 'Hide' : 'Add'} body measurements (optional)
            </Text>
          </Pressable>

          {showMeasurements ? (
            <View style={st.card}>
              {(
                [
                  { label: 'Height (cm)', value: heightCm, onChange: setHeightCm },
                  { label: 'Weight (kg)', value: weightKg, onChange: setWeightKg },
                  { label: 'Chest / Bust (cm)', value: chestCm, onChange: setChestCm },
                  { label: 'Waist (cm)', value: waistCm, onChange: setWaistCm },
                  { label: 'Hips (cm)', value: hipsCm, onChange: setHipsCm },
                  { label: 'Inseam (cm)', value: inseamCm, onChange: setInseamCm },
                ] as const
              ).map(({ label, value, onChange }) => (
                <View key={label} style={st.measureRow}>
                  <Text style={st.measureLabel}>{label}</Text>
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="—"
                    placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad"
                    style={st.measureInput}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={st.actions}>
            <Pressable
              onPress={() => setStep(1)}
              style={[st.btn, st.btnGhost]}
            >
              <Text style={[st.btnText, st.btnGhostText]}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={() => setStep(1)}
              style={[st.btn, st.btnPrimary, birthdayError ? st.btnDisabled : null]}
              disabled={Boolean(birthdayError)}
            >
              <Text style={[st.btnText, st.btnPrimaryText]}>Continue</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Step 1: Style --------------------------------------------------------

  if (step === 1) {
    return (
      <SafeAreaView style={st.safe}>
        <AtmosphereBackground />
        <ScrollView
          contentContainerStyle={st.container}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader(
            'Your style',
            'Help us understand your aesthetic so we can build the right wardrobe for you.',
          )}

          <View style={st.card}>
            <Text style={st.sectionTitle}>How would you describe your aesthetic?</Text>
            <Text style={st.hint}>Select all that apply</Text>
            <View style={st.chipRow}>
              {AESTHETICS.map(({ key, label, desc }) => (
                <Chip
                  key={key}
                  label={label}
                  subtitle={desc}
                  active={aesthetics.has(key)}
                  onPress={() => setAesthetics((prev) => toggleSet(prev, key))}
                />
              ))}
            </View>
          </View>

          <View style={st.card}>
            <Text style={st.sectionTitle}>Preferred colors</Text>
            <View style={st.chipRow}>
              {COLOR_TONES.map(({ key, label, desc }) => (
                <Chip
                  key={key}
                  label={label}
                  subtitle={desc}
                  active={colorTones.has(key)}
                  onPress={() => setColorTones((prev) => toggleSet(prev, key))}
                />
              ))}
            </View>
          </View>

          <View style={st.card}>
            <Text style={st.sectionTitle}>Favorite brands (optional)</Text>
            <TextInput
              value={brandSearch}
              onChangeText={setBrandSearch}
              placeholder="Search brands..."
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[st.input, { marginBottom: 10 }]}
            />
            <View style={st.chipRow}>
              {filteredBrands.map((brand) => (
                <Chip
                  key={brand}
                  label={brand}
                  active={selectedBrands.has(brand)}
                  onPress={() => setSelectedBrands((prev) => toggleSet(prev, brand))}
                />
              ))}
            </View>
            {!showAllBrands ? (
              <Pressable style={st.toggleRow} onPress={() => setShowAllBrands(true)}>
                <Text style={st.toggleText}>Show all brands</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={st.actions}>
            <Pressable onPress={() => setStep(0)} style={[st.btn, st.btnGhost]}>
              <Text style={[st.btnText, st.btnGhostText]}>Back</Text>
            </Pressable>
            <Pressable onPress={() => setStep(2)} style={[st.btn, st.btnPrimary]}>
              <Text style={[st.btnText, st.btnPrimaryText]}>Continue</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Step 2: Starter catalog ----------------------------------------------

  if (step === 2) {
    return (
      <SafeAreaView style={st.safe}>
        <AtmosphereBackground />
        <ScrollView contentContainerStyle={st.container}>
          {renderHeader(
            'What do you already own?',
            'Select the basics in your wardrobe. You can always add more later.',
          )}

          {CATALOG_SECTIONS.map(({ category, label }) => {
            const items = STARTER_CATALOG.filter((i) => i.category === category);
            return (
              <View key={category} style={{ marginBottom: 10 }}>
                <Text style={st.sectionTitle}>{label}</Text>
                <View style={st.catalogGrid}>
                  {items.map((item) => {
                    const owned = ownedIds.has(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setOwnedIds((prev) => toggleSet(prev, item.id))}
                        style={[st.catalogCard, owned && st.catalogCardOwned]}
                      >
                        <Text style={[st.catalogName, owned && st.catalogNameOwned]}>
                          {item.name}
                        </Text>
                        <Text style={[st.catalogMeta, owned && st.catalogMetaOwned]}>
                          {item.color}
                        </Text>
                        {owned ? <Text style={st.checkMark}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <Text style={st.selectionCount}>
            {ownedIds.size} item{ownedIds.size !== 1 ? 's' : ''} selected
          </Text>

          <View style={st.actions}>
            <Pressable onPress={() => setStep(1)} style={[st.btn, st.btnGhost]}>
              <Text style={[st.btnText, st.btnGhostText]}>Back</Text>
            </Pressable>
            <Pressable onPress={() => setStep(3)} style={[st.btn, st.btnPrimary]}>
              <Text style={[st.btnText, st.btnPrimaryText]}>
                {ownedIds.size > 0 ? `Continue (${ownedIds.size})` : 'Continue'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Step 3: Review & confirm ---------------------------------------------

  if (step === 3) {
    return (
      <SafeAreaView style={st.safe}>
        <AtmosphereBackground />
        <ScrollView
          contentContainerStyle={st.container}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader(
            'Review & confirm',
            "Adjust details for each piece, then we'll generate images and save your wardrobe.",
          )}

          {totalItemCount > 0 ? (
            <View style={st.card}>
              <Text style={st.sectionTitle}>
                Your starter wardrobe ({totalItemCount})
              </Text>
              <Text style={st.hint}>
                Edit name, color, size, formality, or season. Each item gets an AI product photo before it is saved.
              </Text>
              {selectedCatalogItems.map((item) => {
                const cfg = getCatalogConfig(item);
                return (
                  <View key={item.id} style={st.reviewBlock}>
                    <View style={st.reviewBlockHeader}>
                      <Text style={st.reviewBlockLabel}>{CATEGORY_LABELS[item.category]}</Text>
                      <Pressable
                        onPress={() =>
                          setOwnedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(item.id);
                            return next;
                          })
                        }
                        style={st.removeBtn}
                      >
                        <Text style={st.removeBtnText}>Remove</Text>
                      </Pressable>
                    </View>
                    <Text style={st.reviewFieldLabel}>Name</Text>
                    <TextInput
                      value={cfg.name}
                      onChangeText={(text) => patchCatalogConfig(item.id, { name: text })}
                      placeholder="Item name"
                      placeholderTextColor={palette.muted}
                      style={st.input}
                    />
                    <View style={st.reviewFieldRow}>
                      <View style={st.reviewFieldCol}>
                        <Text style={st.reviewFieldLabel}>Color</Text>
                        <TextInput
                          value={cfg.color}
                          onChangeText={(text) => patchCatalogConfig(item.id, { color: text })}
                          placeholder="e.g. navy"
                          placeholderTextColor={palette.muted}
                          style={st.input}
                        />
                      </View>
                      <View style={st.reviewFieldCol}>
                        <Text style={st.reviewFieldLabel}>Size</Text>
                        <TextInput
                          value={cfg.size}
                          onChangeText={(text) => patchCatalogConfig(item.id, { size: text })}
                          placeholder="e.g. M"
                          placeholderTextColor={palette.muted}
                          style={st.input}
                        />
                      </View>
                    </View>
                    <Text style={[st.reviewFieldLabel, { marginTop: 8 }]}>Formality</Text>
                    <View style={st.chipRow}>
                      {FORMALITY_OPTIONS.map((f) => (
                        <Chip
                          key={f}
                          label={humanizeEnum(f)}
                          active={cfg.formality === f}
                          onPress={() => patchCatalogConfig(item.id, { formality: f })}
                        />
                      ))}
                    </View>
                    <Text style={[st.reviewFieldLabel, { marginTop: 8 }]}>Season</Text>
                    <View style={st.chipRow}>
                      {SEASONALITY_OPTIONS.map((s) => (
                        <Chip
                          key={s}
                          label={humanizeEnum(s)}
                          active={cfg.seasonality === s}
                          onPress={() => patchCatalogConfig(item.id, { seasonality: s })}
                        />
                      ))}
                    </View>
                  </View>
                );
              })}
              {customItems.map((item) => (
                <View key={item.id} style={st.reviewBlock}>
                  <View style={st.reviewBlockHeader}>
                    <Text style={st.reviewBlockLabel}>Custom item</Text>
                    <Pressable
                      onPress={() => setCustomItems((prev) => prev.filter((r) => r.id !== item.id))}
                      style={st.removeBtn}
                    >
                      <Text style={st.removeBtnText}>Remove</Text>
                    </Pressable>
                  </View>
                  <Text style={st.reviewFieldLabel}>Name</Text>
                  <TextInput
                    value={item.name}
                    onChangeText={(text) => patchCustomItem(item.id, { name: text })}
                    placeholder="Item name"
                    placeholderTextColor={palette.muted}
                    style={st.input}
                  />
                  <View style={st.reviewFieldRow}>
                    <View style={st.reviewFieldCol}>
                      <Text style={st.reviewFieldLabel}>Color</Text>
                      <TextInput
                        value={item.color}
                        onChangeText={(text) => patchCustomItem(item.id, { color: text })}
                        placeholder="Color"
                        placeholderTextColor={palette.muted}
                        style={st.input}
                      />
                    </View>
                    <View style={st.reviewFieldCol}>
                      <Text style={st.reviewFieldLabel}>Size</Text>
                      <TextInput
                        value={item.size}
                        onChangeText={(text) => patchCustomItem(item.id, { size: text })}
                        placeholder="Size"
                        placeholderTextColor={palette.muted}
                        style={st.input}
                      />
                    </View>
                  </View>
                  <Text style={[st.reviewFieldLabel, { marginTop: 8 }]}>Category</Text>
                  <View style={st.chipRow}>
                    {CUSTOM_CATEGORIES.map(({ key, label }) => (
                      <Chip
                        key={key}
                        label={label}
                        active={item.category === key}
                        onPress={() => patchCustomItem(item.id, { category: key })}
                      />
                    ))}
                  </View>
                  <Text style={[st.reviewFieldLabel, { marginTop: 8 }]}>Formality</Text>
                  <View style={st.chipRow}>
                    {FORMALITY_OPTIONS.map((f) => (
                      <Chip
                        key={`${item.id}-${f}`}
                        label={humanizeEnum(f)}
                        active={item.formality === f}
                        onPress={() => patchCustomItem(item.id, { formality: f })}
                      />
                    ))}
                  </View>
                  <Text style={[st.reviewFieldLabel, { marginTop: 8 }]}>Season</Text>
                  <View style={st.chipRow}>
                    {SEASONALITY_OPTIONS.map((s) => (
                      <Chip
                        key={`${item.id}-${s}`}
                        label={humanizeEnum(s)}
                        active={item.seasonality === s}
                        onPress={() => patchCustomItem(item.id, { seasonality: s })}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={st.card}>
              <Text style={st.emptyText}>
                No items selected. Add some below or go back to pick from the catalog.
              </Text>
            </View>
          )}

          <View style={st.card}>
            <Text style={st.sectionTitle}>Add more items</Text>
            <TextInput
              value={customName}
              onChangeText={setCustomName}
              placeholder="Item name (e.g. Red blazer)"
              placeholderTextColor={palette.muted}
              style={st.input}
              returnKeyType="done"
              onSubmitEditing={addCustomItem}
            />
            <View style={st.reviewFieldRow}>
              <View style={st.reviewFieldCol}>
                <Text style={[st.reviewFieldLabel, { marginTop: 10 }]}>Color</Text>
                <TextInput
                  value={customColor}
                  onChangeText={setCustomColor}
                  placeholder="Optional"
                  placeholderTextColor={palette.muted}
                  style={st.input}
                />
              </View>
              <View style={st.reviewFieldCol}>
                <Text style={[st.reviewFieldLabel, { marginTop: 10 }]}>Size</Text>
                <TextInput
                  value={customSize}
                  onChangeText={setCustomSize}
                  placeholder="Optional"
                  placeholderTextColor={palette.muted}
                  style={st.input}
                />
              </View>
            </View>
            <Text style={[st.reviewFieldLabel, { marginTop: 10 }]}>Category</Text>
            <View style={[st.chipRow, { marginTop: 6 }]}>
              {CUSTOM_CATEGORIES.map(({ key, label }) => (
                <Chip
                  key={key}
                  label={label}
                  active={customCategory === key}
                  onPress={() => setCustomCategory(key)}
                />
              ))}
            </View>
            <Text style={[st.reviewFieldLabel, { marginTop: 10 }]}>Formality</Text>
            <View style={st.chipRow}>
              {FORMALITY_OPTIONS.map((f) => (
                <Chip
                  key={f}
                  label={humanizeEnum(f)}
                  active={customFormality === f}
                  onPress={() => setCustomFormality(f)}
                />
              ))}
            </View>
            <Text style={[st.reviewFieldLabel, { marginTop: 10 }]}>Season</Text>
            <View style={st.chipRow}>
              {SEASONALITY_OPTIONS.map((s) => (
                <Chip
                  key={s}
                  label={humanizeEnum(s)}
                  active={customSeasonality === s}
                  onPress={() => setCustomSeasonality(s)}
                />
              ))}
            </View>
            <Pressable
              onPress={addCustomItem}
              style={[st.btn, st.btnGhost, { marginTop: 10 }]}
            >
              <Text style={[st.btnText, st.btnGhostText]}>+ Add to list</Text>
            </Pressable>
          </View>

          {saveError ? <Text style={st.errorText}>{saveError}</Text> : null}
          {imageGenProgress ? (
            <Text style={st.savingHint}>
              Generating images {imageGenProgress.current} of {imageGenProgress.total}…
            </Text>
          ) : null}
          {isSaving && !imageGenProgress ? (
            <Text style={st.savingHint}>
              Adding items and generating your first outfits...
            </Text>
          ) : null}

          <View style={st.actions}>
            <Pressable
              onPress={() => setStep(2)}
              style={[st.btn, st.btnGhost]}
              disabled={isSaving}
            >
              <Text style={[st.btnText, st.btnGhostText]}>Back</Text>
            </Pressable>
            <Pressable
              onPress={handleBuildWardrobe}
              style={[st.btn, st.btnPrimary, isSaving && st.btnDisabled]}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color={palette.textOnAccent} size="small" />
              ) : (
                <Text style={[st.btnText, st.btnPrimaryText]}>Build My Wardrobe</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Step 4: First outfits ------------------------------------------------

  return (
    <SafeAreaView style={st.safe}>
      <AtmosphereBackground />
      <ScrollView contentContainerStyle={st.container}>
        {renderHeader(
          'Your first outfits',
          'Based on your starter wardrobe. Sync your calendar in the app for even better recommendations.',
        )}

        {recommendations.length > 0 ? (
          <>
            {recommendations.map((rec: DayRecommendation) => (
              <View key={rec.day} style={st.outfitCard}>
                <View style={st.outfitCardHeader}>
                  <Text style={st.outfitDay}>{titleCaseDay(rec.day)}</Text>
                  <Text style={st.outfitEvent}>{formatEventType(rec.eventType)}</Text>
                </View>
                <Text style={st.outfitItems}>
                  {rec.outfit.dressName
                    ? rec.outfit.dressName
                    : [rec.outfit.topName, rec.outfit.bottomName]
                        .filter(Boolean)
                        .join(' + ')}
                </Text>
                <Text style={st.outfitExplanation} numberOfLines={2}>
                  {rec.explanation}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <View style={st.card}>
            <Text style={st.emptyText}>
              No outfits generated. You can generate them anytime from the Calendar tab.
            </Text>
          </View>
        )}

        <Pressable
          onPress={handleComplete}
          style={[st.btn, st.btnPrimary, { marginTop: 16 }]}
        >
          <Text style={[st.btnText, st.btnPrimaryText]}>Enter My Wardrobe</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- StyleSheet ------------------------------------------------------------

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  container: { paddingHorizontal: 18, paddingTop: 44, paddingBottom: 40 },
  brand: {
    fontSize: 18,
    color: palette.ink,
    fontFamily: type.display,
    marginBottom: 8,
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
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    marginBottom: 10,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  inputError: { borderColor: palette.error },
  errorText: {
    marginTop: 8,
    color: palette.error,
    fontSize: 12,
    fontFamily: type.body,
  },
  toggleRow: { paddingVertical: 10, marginBottom: 4 },
  toggleText: {
    fontSize: 13,
    color: palette.accent,
    fontFamily: type.bodyDemi,
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
  actions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnGhost: { backgroundColor: 'transparent', borderColor: palette.lineStrong },
  btnPrimary: { backgroundColor: palette.accent, borderColor: palette.accent },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 14, fontFamily: type.bodyDemi },
  btnGhostText: { color: palette.inkSoft },
  btnPrimaryText: { color: palette.panelStrong },
  catalogGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catalogCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '48%',
    position: 'relative',
  },
  catalogCardOwned: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  catalogName: {
    fontSize: 13,
    color: palette.ink,
    fontFamily: type.bodyMedium,
  },
  catalogNameOwned: { color: palette.accent },
  catalogMeta: {
    fontSize: 11,
    color: palette.muted,
    fontFamily: type.body,
    marginTop: 2,
  },
  catalogMetaOwned: { color: palette.inkSoft },
  checkMark: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 12,
    color: palette.accent,
    fontFamily: type.bodyDemi,
  },
  selectionCount: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    textAlign: 'center',
    marginBottom: 8,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  reviewBlock: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
    gap: 4,
  },
  reviewBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  reviewBlockLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
  },
  reviewFieldLabel: {
    fontSize: 11,
    color: palette.muted,
    fontFamily: type.bodyMedium,
    marginBottom: 4,
  },
  reviewFieldRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  reviewFieldCol: {
    flex: 1,
  },
  reviewName: {
    fontSize: 14,
    color: palette.ink,
    fontFamily: type.bodyMedium,
  },
  reviewMeta: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    marginTop: 2,
  },
  removeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  removeBtnText: { fontSize: 12, color: palette.error, fontFamily: type.bodyDemi },
  emptyText: {
    fontSize: 14,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 20,
  },
  savingHint: {
    textAlign: 'center',
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    marginTop: 8,
    marginBottom: 4,
  },
  outfitCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    padding: 14,
    marginBottom: 8,
  },
  outfitCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  outfitDay: {
    fontSize: 14,
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  outfitEvent: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
  },
  outfitItems: {
    fontSize: 13,
    color: palette.inkSoft,
    fontFamily: type.bodyMedium,
    marginBottom: 4,
  },
  outfitExplanation: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 17,
  },
});
