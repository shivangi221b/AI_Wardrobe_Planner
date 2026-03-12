export type GarmentCategory =
  | 'top'
  | 'bottom'
  | 'dress'
  | 'outerwear'
  | 'shoes'
  | 'accessory';

export type GarmentFormality = 'casual' | 'smart_casual' | 'business' | 'formal';

export type GarmentSeasonality = 'hot' | 'mild' | 'cold' | 'all_season';

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
  tags?: string[];
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
