import { Platform } from 'react-native';
import { dayLabels, dayOrder, eventTypeLabels } from './constants';
import type {
  CalendarEvent,
  DayOfWeek,
  DayRecommendation,
  EventType,
  Garment,
  GarmentCategory,
  GarmentFormality,
} from './types';

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const env = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env;

export const API_BASE_URL = (
  env?.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/$/, '');

export const USE_MOCK_API = env?.EXPO_PUBLIC_USE_MOCK_API !== 'false';

const validEventTypes: EventType[] = [
  'work_meeting',
  'date_night',
  'gym',
  'casual',
  'none',
];
const validCategories: GarmentCategory[] = [
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
];
const validFormalities: GarmentFormality[] = [
  'casual',
  'smart_casual',
  'business',
  'formal',
];

interface WardrobeApiItem {
  id: string;
  user_id?: string;
  name?: string;
  category?: string;
  sub_category?: string | null;
  color?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  formality?: string | null;
  primary_image_url?: string;
}

interface WeekEventApi {
  day: string;
  event_type: string;
}

interface RecommendationApi {
  day?: string;
  event_type?: string;
  top_id?: string | null;
  bottom_id?: string | null;
  top_name?: string | null;
  bottom_name?: string | null;
  explanation?: string;
  outfit?: {
    id?: string;
    topId?: string | null;
    top_id?: string | null;
    bottomId?: string | null;
    bottom_id?: string | null;
    top_name?: string | null;
    bottom_name?: string | null;
    label?: string;
  };
}

export interface AddGarmentPayload {
  name: string;
  category: 'top' | 'bottom';
  color?: string;
  formality?: GarmentFormality;
  primaryImageUrl?: string;
}

export type VisionSampleKey = 'sweater' | 'trousers' | 'coat' | 'loafers';

export interface VisionAddPayload {
  sampleKey: VisionSampleKey;
}

export interface WeekEventsRequest {
  events: {
    day: DayOfWeek;
    event_type: EventType;
  }[];
}

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function normalizeFormality(value?: string | null): GarmentFormality {
  if (value && validFormalities.includes(value as GarmentFormality)) {
    return value as GarmentFormality;
  }
  return 'casual';
}

function normalizeCategory(value?: string): GarmentCategory {
  if (value && validCategories.includes(value as GarmentCategory)) {
    return value as GarmentCategory;
  }
  return 'top';
}

function normalizeEventType(value?: string): EventType {
  if (value && validEventTypes.includes(value as EventType)) {
    return value as EventType;
  }
  return 'casual';
}

function normalizeDay(value: string, fallback: DayOfWeek): DayOfWeek {
  if (dayOrder.includes(value as DayOfWeek)) {
    return value as DayOfWeek;
  }
  return fallback;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');
}

function deriveGarmentName(item: WardrobeApiItem): string {
  if (item.name && item.name.trim()) {
    return item.name.trim();
  }
  const subject = item.sub_category || item.category || 'garment';
  const color = item.color || item.color_primary || item.color_secondary;
  if (color && color.trim()) {
    return `${titleCase(color.trim())} ${titleCase(subject)}`;
  }
  return titleCase(subject);
}

function mapGarment(item: WardrobeApiItem): Garment {
  return {
    id: item.id,
    userId: item.user_id,
    name: deriveGarmentName(item),
    category: normalizeCategory(item.category),
    color: (item.color || item.color_primary || item.color_secondary || '').trim(),
    formality: normalizeFormality(item.formality),
    primaryImageUrl: item.primary_image_url,
  };
}

function eventTypeForApi(eventType: EventType): Exclude<EventType, 'none'> {
  return eventType === 'none' ? 'casual' : eventType;
}

function mapWeekEvent(
  event: WeekEventApi,
  fallback: DayOfWeek
): {
  day: DayOfWeek;
  event_type: EventType;
} {
  return {
    day: normalizeDay(event.day, fallback),
    event_type: normalizeEventType(event.event_type),
  };
}

function mapRecommendation(rec: RecommendationApi, index: number): DayRecommendation {
  const fallbackDay = dayOrder[index] ?? 'monday';
  const day = normalizeDay(rec.day ?? fallbackDay, fallbackDay);
  const eventType = normalizeEventType(rec.event_type);
  const topId = rec.top_id ?? rec.outfit?.topId ?? rec.outfit?.top_id ?? null;
  const bottomId = rec.bottom_id ?? rec.outfit?.bottomId ?? rec.outfit?.bottom_id ?? null;
  const topName = (rec.top_name || rec.outfit?.top_name || '').trim();
  const bottomName = (rec.bottom_name || rec.outfit?.bottom_name || '').trim();

  return {
    day,
    eventType,
    outfit: {
      id: rec.outfit?.id ?? `rec-${index}`,
      topId,
      bottomId,
      topName,
      bottomName,
      label: rec.outfit?.label,
    },
    explanation:
      rec.explanation ||
      'Outfit generated based on your selected event and current wardrobe.',
  };
}

const mockWardrobes: Record<string, Garment[]> = {};
const mockWeekEvents: Record<string, WeekEventsRequest['events']> = {};
let mockGarmentCounter = 100;

const visionTemplates: Record<
  VisionSampleKey,
  {
    name: string;
    category: 'top' | 'bottom';
    color: string;
    formality: GarmentFormality;
  }
> = {
  sweater: {
    name: 'Cream sweater',
    category: 'top',
    color: 'cream',
    formality: 'smart_casual',
  },
  trousers: {
    name: 'Dark trousers',
    category: 'bottom',
    color: 'brown',
    formality: 'business',
  },
  coat: {
    name: 'Beige coat',
    category: 'top',
    color: 'beige',
    formality: 'business',
  },
  loafers: {
    name: 'Brown loafers',
    category: 'bottom',
    color: 'brown',
    formality: 'smart_casual',
  },
};

function createSeedWardrobe(userId: string): Garment[] {
  return [
    {
      id: `mock-g-${mockGarmentCounter++}`,
      userId,
      name: 'Cream sweater',
      category: 'top',
      color: 'cream',
      formality: 'smart_casual',
    },
    {
      id: `mock-g-${mockGarmentCounter++}`,
      userId,
      name: 'White oxford shirt',
      category: 'top',
      color: 'white',
      formality: 'business',
    },
    {
      id: `mock-g-${mockGarmentCounter++}`,
      userId,
      name: 'Dark trousers',
      category: 'bottom',
      color: 'brown',
      formality: 'business',
    },
    {
      id: `mock-g-${mockGarmentCounter++}`,
      userId,
      name: 'Relaxed denim',
      category: 'bottom',
      color: 'blue',
      formality: 'casual',
    },
  ];
}

function getOrCreateMockWardrobe(userId: string): Garment[] {
  if (!mockWardrobes[userId]) {
    mockWardrobes[userId] = createSeedWardrobe(userId);
  }
  return mockWardrobes[userId];
}

function getPriorityForEvent(eventType: EventType): GarmentFormality[] {
  switch (eventType) {
    case 'work_meeting':
      return ['formal', 'business', 'smart_casual', 'casual'];
    case 'date_night':
      return ['smart_casual', 'formal', 'business', 'casual'];
    case 'gym':
      return ['casual', 'smart_casual', 'business', 'formal'];
    case 'none':
    case 'casual':
    default:
      return ['casual', 'smart_casual', 'business', 'formal'];
  }
}

function pickGarment(
  wardrobe: Garment[],
  category: 'top' | 'bottom',
  priorities: GarmentFormality[],
  offset: number
): Garment | null {
  const pool = wardrobe.filter((item) => item.category === category);
  if (pool.length === 0) {
    return null;
  }

  for (const formality of priorities) {
    const matching = pool.filter((item) => item.formality === formality);
    if (matching.length > 0) {
      return matching[offset % matching.length];
    }
  }

  return pool[offset % pool.length];
}

function buildMockExplanation(
  day: DayOfWeek,
  eventType: EventType,
  topName: string,
  bottomName: string
): string {
  const dayLabel = dayLabels[day];
  const eventLabel = eventTypeLabels[eventType].toLowerCase();
  return `For your ${dayLabel} ${eventLabel}, we paired ${topName} with ${bottomName} to keep your look polished, practical, and easy to wear all day.`;
}

function getMockWeekEvents(userId: string): WeekEventsRequest['events'] {
  if (!mockWeekEvents[userId]) {
    mockWeekEvents[userId] = dayOrder.map((day) => ({
      day,
      event_type: 'none',
    }));
  }
  return mockWeekEvents[userId];
}

async function mockGetWardrobe(userId: string): Promise<Garment[]> {
  return [...getOrCreateMockWardrobe(userId)];
}

async function mockAddGarment(
  userId: string,
  payload: AddGarmentPayload
): Promise<Garment> {
  const wardrobe = getOrCreateMockWardrobe(userId);
  const item: Garment = {
    id: `mock-g-${mockGarmentCounter++}`,
    userId,
    name: payload.name,
    category: payload.category,
    color: payload.color ?? '',
    formality: payload.formality ?? 'casual',
    primaryImageUrl: payload.primaryImageUrl,
  };
  wardrobe.unshift(item);
  return item;
}

async function mockAddGarmentFromVision(
  userId: string,
  payload: VisionAddPayload
): Promise<Garment> {
  const template = visionTemplates[payload.sampleKey];
  return mockAddGarment(userId, {
    name: template.name,
    category: template.category,
    color: template.color,
    formality: template.formality,
  });
}

async function mockSaveWeekEvents(
  userId: string,
  events: CalendarEvent[]
): Promise<WeekEventsRequest> {
  const normalized = events.map((event) => ({
    day: event.day,
    event_type: event.eventType,
  }));
  mockWeekEvents[userId] = normalized;
  return { events: normalized };
}

async function mockGetWeekEvents(userId: string): Promise<WeekEventsRequest> {
  return { events: getMockWeekEvents(userId) };
}

async function mockGetWeeklyRecommendations(
  userId: string,
  events: CalendarEvent[]
): Promise<{ recommendations: DayRecommendation[] }> {
  const wardrobe = getOrCreateMockWardrobe(userId);
  const eventStream = events.length
    ? events
    : dayOrder.map((day, index) => ({
        id: `event-${index}`,
        day,
        eventType: getMockWeekEvents(userId)[index]?.event_type ?? 'none',
      }));

  const recommendations = eventStream.map((event, index) => {
    const priorities = getPriorityForEvent(event.eventType);
    const top = pickGarment(wardrobe, 'top', priorities, index);
    const bottom = pickGarment(wardrobe, 'bottom', priorities, index + 1);

    const topName = top?.name ?? 'Top from your wardrobe';
    const bottomName = bottom?.name ?? 'Bottom from your wardrobe';

    return {
      day: event.day,
      eventType: event.eventType,
      outfit: {
        id: `mock-look-${event.day}`,
        topId: top?.id ?? null,
        bottomId: bottom?.id ?? null,
        topName,
        bottomName,
        label: `${topName} + ${bottomName}`,
      },
      explanation: buildMockExplanation(event.day, event.eventType, topName, bottomName),
    } satisfies DayRecommendation;
  });

  return { recommendations };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      rawBody
    );
  }

  if (!rawBody) {
    return {} as T;
  }
  return JSON.parse(rawBody) as T;
}

export async function getWardrobe(userId: string): Promise<Garment[]> {
  if (USE_MOCK_API) {
    return mockGetWardrobe(userId);
  }

  const response = await requestJson<WardrobeApiItem[]>(
    `/wardrobe/${encodeURIComponent(userId)}`
  );
  if (!Array.isArray(response)) {
    return [];
  }
  return response.map(mapGarment);
}

export async function addGarment(
  userId: string,
  payload: AddGarmentPayload
): Promise<Garment> {
  if (USE_MOCK_API) {
    return mockAddGarment(userId, payload);
  }

  const response = await requestJson<WardrobeApiItem>(
    `/wardrobe/${encodeURIComponent(userId)}/items`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        category: payload.category,
        color: payload.color,
        formality: payload.formality ?? 'casual',
        primary_image_url:
          payload.primaryImageUrl ?? 'https://example.com/garment-placeholder.jpg',
      }),
    }
  );
  return mapGarment(response);
}

export async function addGarmentFromVision(
  userId: string,
  payload: VisionAddPayload
): Promise<Garment> {
  if (USE_MOCK_API) {
    return mockAddGarmentFromVision(userId, payload);
  }

  throw new ApiError(
    'Vision upload is not implemented yet. Per mvp_doc optional flow, backend should expose POST /upload multipart(file,user_id).',
    501,
    ''
  );
}

export async function saveWeekEvents(
  userId: string,
  events: CalendarEvent[]
): Promise<WeekEventsRequest> {
  if (USE_MOCK_API) {
    return mockSaveWeekEvents(userId, events);
  }

  const response = await requestJson<{
    events?: WeekEventApi[];
  }>(`/users/${encodeURIComponent(userId)}/week-events`, {
    method: 'PUT',
    body: JSON.stringify({
      events: events.map((event) => ({
        day: event.day,
        event_type: eventTypeForApi(event.eventType),
      })),
    }),
  });

  const responseEvents = Array.isArray(response.events) ? response.events : [];
  return {
    events: responseEvents.map((event, index) =>
      mapWeekEvent(event, dayOrder[index] ?? 'monday')
    ),
  };
}

export async function getWeekEvents(userId: string): Promise<WeekEventsRequest> {
  if (USE_MOCK_API) {
    return mockGetWeekEvents(userId);
  }

  try {
    const response = await requestJson<{
      events?: WeekEventApi[];
    }>(`/users/${encodeURIComponent(userId)}/week-events`);

    const responseEvents = Array.isArray(response.events) ? response.events : [];
    return {
      events: responseEvents.map((event, index) =>
        mapWeekEvent(event, dayOrder[index] ?? 'monday')
      ),
    };
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return { events: [] };
    }
    throw error;
  }
}

export async function getWeeklyRecommendations(
  userId: string,
  events: CalendarEvent[]
): Promise<{ recommendations: DayRecommendation[] }> {
  if (USE_MOCK_API) {
    return mockGetWeeklyRecommendations(userId, events);
  }

  const response = await requestJson<{
    recommendations?: RecommendationApi[];
  }>('/recommendations/week', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      events: events.map((event) => ({
        day: event.day,
        event_type: eventTypeForApi(event.eventType),
      })),
    }),
  });

  const recs = Array.isArray(response.recommendations)
    ? response.recommendations
    : [];
  return {
    recommendations: recs.map(mapRecommendation),
  };
}
