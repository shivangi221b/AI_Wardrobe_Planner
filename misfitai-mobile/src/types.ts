export type GarmentCategory =
  | 'top'
  | 'bottom'
  | 'dress'
  | 'outerwear'
  | 'shoes'
  | 'accessory';

export type GarmentFormality = 'casual' | 'smart_casual' | 'business' | 'formal';

export interface Garment {
  id: string;
  userId?: string;
  // Display name from API field when present, otherwise derived from category/subcategory.
  name: string;
  category: GarmentCategory;
  color: string;
  formality: GarmentFormality;
  primaryImageUrl?: string;
  // Optional richer metadata when available (e.g. from vision onboarding).
  pattern?: string;
  material?: string;
  fitNotes?: string;
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
}

export interface Outfit {
  id: string;
  topId: string | null;
  bottomId: string | null;
  topName: string;
  bottomName: string;
  label?: string;
}

export interface DayRecommendation {
  day: DayOfWeek;
  eventType: EventType;
  outfit: Outfit;
  explanation: string;
}
