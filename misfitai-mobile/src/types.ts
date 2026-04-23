export type GarmentCategory =
  | 'top'
  | 'bottom'
  | 'dress'
  | 'outerwear'
  | 'shoes'
  | 'accessory';

export type GarmentFormality = 'casual' | 'smart_casual' | 'business' | 'formal';

export type GarmentSeasonality = 'hot' | 'mild' | 'cold' | 'all_season';

export type GarmentGender = 'men' | 'women' | 'unisex';

export type LaundryStatus = 'clean' | 'in_laundry';

export interface Garment {
  id: string;
  userId?: string;
  name: string;
  category: GarmentCategory;
  color: string;
  formality: GarmentFormality;
  seasonality?: GarmentSeasonality;
  primaryImageUrl?: string;
  pattern?: string | null;
  material?: string | null;
  fitNotes?: string | null;
  gender?: GarmentGender | null;
  timesRecommended?: number;
  hiddenFromRecommendations?: boolean;
  tags?: string[];
  laundryStatus?: LaundryStatus;
  lastWornDate?: string | null;
  timesWorn?: number;
}

export interface BodyMeasurements {
  userId: string;
  heightCm?: number | null;
  weightKg?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
  inseamCm?: number | null;
  updatedAt?: string;
}

export type EventType =
  | 'work_meeting'
  | 'date_night'
  | 'gym'
  | 'casual'
  | 'none';

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface CalendarEvent {
  id: string;
  day: DayOfWeek;
  eventType: EventType;
  originalSummary?: string;
}

export interface Outfit {
  id: string;
  topId: string | null;
  bottomId: string | null;
  topName: string;
  bottomName: string;
  dressId?: string | null;
  dressName?: string | null;
  label?: string;
}

export interface DayRecommendation {
  day: DayOfWeek;
  eventType: EventType;
  outfit: Outfit;
  explanation: string;
}

// ---------------------------------------------------------------------------
// User profile (style preferences, sizes, avatar)
// ---------------------------------------------------------------------------

export interface AvatarConfig {
  hairStyle?: string | null;
  hairColor?: string | null;
  bodyType?: string | null;
  skinTone?: string | null;
}

export type ColorTone = 'warm' | 'cool' | 'neutral';

export type SkinTone =
  | 'very_light'
  | 'light'
  | 'medium_light'
  | 'medium'
  | 'medium_dark'
  | 'dark';

export interface UserProfile {
  userId: string;
  gender?: 'male' | 'female' | 'other' | null;
  birthday?: string | null;
  skinTone?: SkinTone | null;
  colorTone?: ColorTone | null;
  favoriteColors: string[];
  avoidedColors: string[];
  shoeSize?: string | null;
  topSize?: string | null;
  bottomSize?: string | null;
  avatarConfig?: AvatarConfig | null;
  updatedAt?: string;
}

/** Partial update payload for PUT /users/{userId}/profile */
export interface UserProfileUpdate {
  gender?: 'male' | 'female' | 'other' | null;
  birthday?: string | null;
  skinTone?: SkinTone | null;
  colorTone?: ColorTone | null;
  favoriteColors?: string[];
  avoidedColors?: string[];
  shoeSize?: string | null;
  topSize?: string | null;
  bottomSize?: string | null;
  avatarConfig?: AvatarConfig | null;
}

// ---------------------------------------------------------------------------
// Wear tracking & outfit history
// ---------------------------------------------------------------------------

export interface WearLogEntry {
  id: string;
  garmentId: string;
  wornDate: string;
  createdAt?: string;
}

export interface OutfitLogEntry {
  id: string;
  wornDate: string;
  garmentIds: string[];
  eventType?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface GarmentInsights {
  mostWorn: { garmentId: string; timesWorn: number }[];
  notWornRecently: string[];
  totalItems: number;
  totalWears: number;
}
