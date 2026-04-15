import { Platform } from 'react-native';
import { dayLabels, dayOrder, eventTypeLabels } from './constants';
import type {
  AvatarConfig,
  BodyMeasurements,
  CalendarEvent,
  DayOfWeek,
  DayRecommendation,
  EventType,
  Garment,
  GarmentCategory,
  GarmentFormality,
  GarmentGender,
  GarmentSeasonality,
  UserProfile,
  UserProfileUpdate,
} from './types';

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/$/, '');

export const USE_MOCK_API =
  process.env.EXPO_PUBLIC_USE_MOCK_API === 'true'
    ? true
    : process.env.EXPO_PUBLIC_USE_MOCK_API === 'false'
      ? false
      : __DEV__;

const VISION_REQUEST_RETRIES = 2;
const VISION_RETRY_BACKOFF_MS = 450;
const VISION_FILE_FETCH_TIMEOUT_MS = 45000;

/** After OAuth login, record user for GET /api/metrics ``signups`` (no wardrobe required). */
export function registerSignupWithBackend(userId: string): void {
  if (!userId?.trim() || USE_MOCK_API) return;
  void fetch(`${API_BASE_URL}/analytics/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId.trim() }),
  }).catch(() => {
    /* ignore network errors */
  });
}

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
const validFormalities: GarmentFormality[] = ['casual', 'smart_casual', 'business', 'formal'];

const validSeasonalities: GarmentSeasonality[] = ['hot', 'mild', 'cold', 'all_season'];

const validGarmentGenders: GarmentGender[] = ['men', 'women', 'unisex'];

function normalizeGarmentGender(value?: string | null): GarmentGender | null {
  if (value && validGarmentGenders.includes(value as GarmentGender)) {
    return value as GarmentGender;
  }
  return null;
}

interface WardrobeApiItem {
  id: string;
  user_id?: string;
  name?: string;
  category?: string;
  sub_category?: string | null;
  color?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  pattern?: string | null;
  material?: string | null;
  fit_notes?: string | null;
  formality?: string | null;
  seasonality?: string | null;
  primary_image_url?: string;
  gender?: string | null;
  times_recommended?: number | null;
  hidden_from_recommendations?: boolean | null;
  tags?: string[] | null;
}

interface WeekEventApi {
  day: string;
  event_type: string;
  original_summary?: string;
}

interface RecommendationApi {
  day?: string;
  event_type?: string;
  top_id?: string | null;
  bottom_id?: string | null;
  top_name?: string | null;
  bottom_name?: string | null;
  dress_id?: string | null;
  dress_name?: string | null;
  explanation?: string;
  outfit?: {
    id?: string;
    topId?: string | null;
    top_id?: string | null;
    bottomId?: string | null;
    bottom_id?: string | null;
    top_name?: string | null;
    bottom_name?: string | null;
    dressId?: string | null;
    dress_id?: string | null;
    dress_name?: string | null;
    label?: string;
  };
}

export interface AddGarmentPayload {
  name: string;
  category: 'top' | 'bottom' | 'shoes' | 'accessory';
  color?: string;
  formality?: GarmentFormality;
  seasonality?: GarmentSeasonality;
  primaryImageUrl?: string;
}

export interface VisionAddPayload {
  imageUri: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface VisionPreviewItem {
  image_url: string;
  category?: string;
  sub_category?: string | null;
  color_primary?: string | null;
  pattern?: string | null;
  material?: string | null;
  fit_notes?: string | null;
  formality?: string | null;
  seasonality?: string | null;
}

export interface GarmentSearchResult {
  imageUrl: string;
  title?: string | null;
  sourceUrl?: string | null;
}

export interface GarmentSearchOptions {
  color?: string;
  material?: string;
  kind?: string;
  gender?: 'men' | 'women' | 'any';
}
export interface ConfirmSearchAddPayload {
  name: string;
  category: 'top' | 'bottom' | 'shoes' | 'accessory';
  color?: string;
  formality?: GarmentFormality;
  seasonality?: GarmentSeasonality;
  imageUrl: string;
}

export interface WeekEventsRequest {
  events: {
    day: DayOfWeek;
    event_type: EventType;
    original_summary?: string;
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

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(error.body) as { detail?: string };
    if (parsed?.detail && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    // Keep original fallback if body is plain text/non-JSON.
  }
  return `${fallback} (${error.status})`;
}

function normalizeFormality(value?: string | null): GarmentFormality {
  if (value && validFormalities.includes(value as GarmentFormality)) {
    return value as GarmentFormality;
  }
  return 'casual';
}

function normalizeSeasonality(value?: string | null): GarmentSeasonality {
  if (value && validSeasonalities.includes(value as GarmentSeasonality)) {
    return value as GarmentSeasonality;
  }
  return 'all_season';
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
    seasonality: normalizeSeasonality(item.seasonality),
    primaryImageUrl: item.primary_image_url,
    pattern: item.pattern?.trim() || undefined,
    material: item.material?.trim() || undefined,
    fitNotes: item.fit_notes?.trim() || undefined,
    gender: normalizeGarmentGender(item.gender),
    timesRecommended: item.times_recommended ?? 0,
    hiddenFromRecommendations: item.hidden_from_recommendations ?? false,
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
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
  original_summary?: string;
} {
  return {
    day: normalizeDay(event.day, fallback),
    event_type: normalizeEventType(event.event_type),
    original_summary: event.original_summary,
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
  const dressId = rec.dress_id ?? rec.outfit?.dressId ?? rec.outfit?.dress_id ?? null;
  const dressName = (rec.dress_name || rec.outfit?.dress_name || '').trim() || null;

  return {
    day,
    eventType,
    outfit: {
      id: rec.outfit?.id ?? `rec-${index}`,
      topId,
      bottomId,
      topName,
      bottomName,
      dressId,
      dressName,
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
  _payload: VisionAddPayload
): Promise<Garment> {
  return mockAddGarment(userId, {
    name: 'Vision garment',
    category: 'top',
    color: 'neutral',
    formality: 'casual',
  });
}

async function mockSearchGarmentImages(_userId: string, query: string): Promise<GarmentSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  return [
    {
      imageUrl: 'https://example.com/mock-garment-1.jpg',
      title: `Mock result: ${q}`,
      sourceUrl: 'https://example.com',
    },
  ];
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
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryApiError(error: unknown): boolean {
  if (!isApiError(error)) {
    return true;
  }
  return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
}

async function requestJsonWithRetry<T>(
  path: string,
  init: RequestInit,
  retries: number
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await requestJson<T>(path, init);
    } catch (error) {
      if (attempt >= retries || !shouldRetryApiError(error)) {
        throw error;
      }
      await sleep(VISION_RETRY_BACKOFF_MS * 2 ** attempt);
      attempt += 1;
    }
  }
}

async function readImageBlobWithRetry(payload: VisionAddPayload): Promise<Blob> {
  let attempt = 0;
  while (true) {
    try {
      const controller =
        typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), VISION_FILE_FETCH_TIMEOUT_MS)
        : null;
      const response = await fetch(
        payload.imageUri,
        controller ? { signal: controller.signal } : undefined
      );
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`Failed to read selected image (${response.status}).`);
      }
      return await response.blob();
    } catch (error) {
      if (attempt >= VISION_REQUEST_RETRIES) {
        throw error;
      }
      await sleep(VISION_RETRY_BACKOFF_MS * 2 ** attempt);
      attempt += 1;
    }
  }
}

function getVisionUploadFileName(payload: VisionAddPayload): string {
  if (payload.fileName?.trim()) {
    return payload.fileName.trim();
  }
  const extension = payload.mimeType?.includes('png') ? 'png' : 'jpg';
  return `wardrobe-upload-${Date.now()}.${extension}`;
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
        seasonality: payload.seasonality ?? 'all_season',
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
): Promise<Garment[]> {
  if (USE_MOCK_API) {
    return [await mockAddGarmentFromVision(userId, payload)];
  }

  const blob = await readImageBlobWithRetry(payload);

  const formData = new FormData();
  formData.append('user_id', userId);
  formData.append('file', blob, getVisionUploadFileName(payload));

  const response = await requestJsonWithRetry<WardrobeApiItem[]>(
    '/vision/extract',
    {
      method: 'POST',
      body: formData,
    },
    VISION_REQUEST_RETRIES
  );
  if (!Array.isArray(response)) {
    return [];
  }
  return response.map(mapGarment);
}

export async function previewGarmentsFromVision(
  userId: string,
  payload: VisionAddPayload
): Promise<VisionPreviewItem[]> {
  if (USE_MOCK_API) {
    // Keep mock path simple for now.
    return [];
  }

  const blob = await readImageBlobWithRetry(payload);

  const formData = new FormData();
  formData.append('user_id', userId);
  formData.append('file', blob, getVisionUploadFileName(payload));

  const response = await requestJsonWithRetry<VisionPreviewItem[]>(
    '/vision/extract-preview',
    {
      method: 'POST',
      body: formData,
    },
    VISION_REQUEST_RETRIES
  );
  return Array.isArray(response) ? response : [];
}

export async function commitVisionItems(
  userId: string,
  items: VisionPreviewItem[]
): Promise<Garment[]> {
  if (USE_MOCK_API) {
    return [];
  }

  const response = await requestJsonWithRetry<WardrobeApiItem[]>(
    `/vision/commit?user_id=${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        items,
      }),
    },
    VISION_REQUEST_RETRIES
  );
  return Array.isArray(response) ? response.map(mapGarment) : [];
}

export async function searchGarmentImages(
  userId: string,
  query: string,
  limit = 20,
  options?: GarmentSearchOptions
): Promise<GarmentSearchResult[]> {
  if (USE_MOCK_API) {
    return mockSearchGarmentImages(userId, query);
  }

  const response = await requestJson<
    {
      image_url?: string;
      title?: string | null;
      source_url?: string | null;
    }[]
  >(`/wardrobe/${encodeURIComponent(userId)}/search-garment`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      limit,
      color: options?.color,
      material: options?.material,
      kind: options?.kind,
      gender:
        options?.gender && options.gender !== 'any' ? options.gender : undefined,
    }),
  });

  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .map((item) => ({
      imageUrl: item.image_url || '',
      title: item.title,
      sourceUrl: item.source_url,
    }))
    .filter((item) => Boolean(item.imageUrl));
}

export async function confirmSearchAdd(
  userId: string,
  payload: ConfirmSearchAddPayload
): Promise<Garment> {
  return addGarment(userId, {
    name: payload.name,
    category: payload.category,
    color: payload.color,
    formality: payload.formality,
    seasonality: payload.seasonality,
    primaryImageUrl: payload.imageUrl,
  });
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
  events: CalendarEvent[],
  userGender?: string | null,
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
      user_gender: userGender ?? undefined,
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

// ---------------------------------------------------------------------------
// Body measurements API
// ---------------------------------------------------------------------------

interface MeasurementsApiResponse {
  user_id: string;
  height_cm?: number | null;
  weight_kg?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hips_cm?: number | null;
  inseam_cm?: number | null;
  updated_at?: string;
}

function mapMeasurements(raw: MeasurementsApiResponse): BodyMeasurements {
  return {
    userId: raw.user_id,
    heightCm: raw.height_cm ?? null,
    weightKg: raw.weight_kg ?? null,
    chestCm: raw.chest_cm ?? null,
    waistCm: raw.waist_cm ?? null,
    hipsCm: raw.hips_cm ?? null,
    inseamCm: raw.inseam_cm ?? null,
    updatedAt: raw.updated_at,
  };
}

export async function getMeasurements(userId: string): Promise<BodyMeasurements | null> {
  if (USE_MOCK_API) return null;
  try {
    const response = await requestJson<MeasurementsApiResponse | null>(
      `/users/${encodeURIComponent(userId)}/measurements`
    );
    return response ? mapMeasurements(response) : null;
  } catch {
    return null;
  }
}

export async function saveMeasurements(
  userId: string,
  measurements: Omit<BodyMeasurements, 'userId' | 'updatedAt'>
): Promise<BodyMeasurements> {
  if (USE_MOCK_API) {
    return { userId, ...measurements };
  }
  const response = await requestJson<MeasurementsApiResponse>(
    `/users/${encodeURIComponent(userId)}/measurements`,
    {
      method: 'PUT',
      body: JSON.stringify({
        height_cm: measurements.heightCm ?? null,
        weight_kg: measurements.weightKg ?? null,
        chest_cm: measurements.chestCm ?? null,
        waist_cm: measurements.waistCm ?? null,
        hips_cm: measurements.hipsCm ?? null,
        inseam_cm: measurements.inseamCm ?? null,
      }),
    }
  );
  return mapMeasurements(response);
}

// ---------------------------------------------------------------------------
// User profile (style preferences, sizes, avatar)
// ---------------------------------------------------------------------------

interface ProfileApiResponse {
  user_id: string;
  gender?: string | null;
  birthday?: string | null;
  skin_tone?: string | null;
  color_tone?: string | null;
  favorite_colors?: string[];
  avoided_colors?: string[];
  shoe_size?: string | null;
  top_size?: string | null;
  bottom_size?: string | null;
  avatar_config?: {
    hair_style?: string | null;
    hair_color?: string | null;
    body_type?: string | null;
    skin_tone?: string | null;
    avatar_image_url?: string | null;
  } | null;
  updated_at?: string;
}

function mapUserProfile(r: ProfileApiResponse): UserProfile {
  return {
    userId: r.user_id,
    gender: (r.gender as UserProfile['gender']) ?? null,
    birthday: r.birthday ?? null,
    skinTone: (r.skin_tone as UserProfile['skinTone']) ?? null,
    colorTone: (r.color_tone as UserProfile['colorTone']) ?? null,
    favoriteColors: r.favorite_colors ?? [],
    avoidedColors: r.avoided_colors ?? [],
    shoeSize: r.shoe_size ?? null,
    topSize: r.top_size ?? null,
    bottomSize: r.bottom_size ?? null,
    avatarConfig: r.avatar_config
      ? {
          hairStyle: r.avatar_config.hair_style ?? null,
          hairColor: r.avatar_config.hair_color ?? null,
          bodyType: r.avatar_config.body_type ?? null,
          skinTone: r.avatar_config.skin_tone ?? null,
          avatarImageUrl: r.avatar_config.avatar_image_url ?? null,
        }
      : null,
    updatedAt: r.updated_at,
  };
}

/** Fetch extended style profile for *userId*. Returns ``null`` when not yet created. */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (USE_MOCK_API) return null;
  try {
    const response = await requestJson<ProfileApiResponse | null>(
      `/users/${encodeURIComponent(userId)}/profile`
    );
    return response ? mapUserProfile(response) : null;
  } catch {
    return null;
  }
}

export function profileUpdateToApiPayload(data: UserProfileUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (data.gender !== undefined) payload.gender = data.gender;
  if (data.birthday !== undefined) payload.birthday = data.birthday;
  if (data.skinTone !== undefined) payload.skin_tone = data.skinTone;
  if (data.colorTone !== undefined) payload.color_tone = data.colorTone;
  if (data.favoriteColors !== undefined) payload.favorite_colors = data.favoriteColors;
  if (data.avoidedColors !== undefined) payload.avoided_colors = data.avoidedColors;
  if (data.shoeSize !== undefined) payload.shoe_size = data.shoeSize;
  if (data.topSize !== undefined) payload.top_size = data.topSize;
  if (data.bottomSize !== undefined) payload.bottom_size = data.bottomSize;
  if (data.avatarConfig !== undefined) {
    if (data.avatarConfig === null) {
      // Explicit null: tell the server to clear the stored avatar config.
      payload.avatar_config = null;
    } else {
      const av: AvatarConfig = data.avatarConfig;
      const cfg: Record<string, unknown> = {};
      if (av.hairStyle !== undefined) cfg.hair_style = av.hairStyle;
      if (av.hairColor !== undefined) cfg.hair_color = av.hairColor;
      if (av.bodyType !== undefined) cfg.body_type = av.bodyType;
      if (av.skinTone !== undefined) cfg.skin_tone = av.skinTone;
      if (av.avatarImageUrl !== undefined) cfg.avatar_image_url = av.avatarImageUrl;
      if (Object.keys(cfg).length > 0) {
        payload.avatar_config = cfg;
      }
    }
  }
  return payload;
}

/** Create or partially update the style profile for *userId*. */
export async function updateUserProfile(
  userId: string,
  data: UserProfileUpdate
): Promise<UserProfile> {
  if (USE_MOCK_API) {
    return {
      userId,
      favoriteColors: data.favoriteColors ?? [],
      avoidedColors: data.avoidedColors ?? [],
      ...data,
    };
  }
  const response = await requestJson<ProfileApiResponse>(
    `/users/${encodeURIComponent(userId)}/profile`,
    {
      method: 'PUT',
      body: JSON.stringify(profileUpdateToApiPayload(data)),
    }
  );
  return mapUserProfile(response);
}

// ---------------------------------------------------------------------------
// Avatar generation
// ---------------------------------------------------------------------------

/**
 * Upload a selfie to generate a stylised 2-D portrait avatar.
 * The selfie is used only for generation and is NOT stored on the server.
 *
 * @param userId   Authenticated user id.
 * @param selfieUri  Local file:// URI returned by expo-image-picker.
 * @param pickerAsset Optional metadata from ``ImagePicker`` (native) so multipart name/type match real bytes.
 * @returns        The public URL of the generated avatar image.
 */
export async function generateAvatar(
  userId: string,
  selfieUri: string,
  pickerAsset?: { mimeType?: string | null; fileName?: string | null; type?: string | null }
): Promise<string> {
  if (USE_MOCK_API) {
    // Return a deterministic placeholder so the UI can render something.
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(userId)}&size=512&background=1b1b19&color=f4f4f2&rounded=true`;
  }

  const formData = new FormData();

  if (Platform.OS === 'web') {
    // Browser FormData requires a Blob/File, not { uri }.
    const res = await fetch(selfieUri);
    const blob = await res.blob();
    const name =
      blob.type === 'image/png'
        ? 'selfie.png'
        : blob.type === 'image/webp'
          ? 'selfie.webp'
          : 'selfie.jpg';
    formData.append('selfie', blob, name);
  } else {
    const mimeRaw =
      (pickerAsset?.mimeType || pickerAsset?.type || '').toLowerCase() || 'image/jpeg';
    let type = 'image/jpeg';
    let name = pickerAsset?.fileName?.trim() || 'selfie.jpg';
    if (mimeRaw.includes('png')) {
      type = 'image/png';
      if (!name.toLowerCase().endsWith('.png')) name = 'selfie.png';
    } else if (mimeRaw.includes('webp')) {
      type = 'image/webp';
      if (!name.toLowerCase().endsWith('.webp')) name = 'selfie.webp';
    } else if (mimeRaw.includes('heic') || mimeRaw.includes('heif')) {
      type = 'image/heic';
      if (!/\.hei[c|f]$/i.test(name)) name = 'selfie.heic';
    } else if (mimeRaw.includes('jpeg') || mimeRaw.includes('jpg')) {
      type = 'image/jpeg';
      if (!/\.jpe?g$/i.test(name)) name = 'selfie.jpg';
    }
    formData.append('selfie', {
      uri: selfieUri,
      name,
      type,
    } as unknown as Blob);
  }

  const response = await fetch(
    `${API_BASE_URL}/users/${encodeURIComponent(userId)}/avatar/generate`,
    {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type manually — fetch sets it with the boundary.
    }
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new ApiError(
      `Avatar generation failed: ${response.status} ${response.statusText}`,
      response.status,
      rawBody
    );
  }

  const data = JSON.parse(rawBody) as { avatar_image_url?: string };
  const url = (data.avatar_image_url || '').trim();
  if (!url) {
    throw new ApiError('Invalid avatar response: missing avatar_image_url', 502, rawBody);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Hide / unhide garment
// ---------------------------------------------------------------------------

export async function setGarmentHidden(
  userId: string,
  garmentId: string,
  hidden: boolean
): Promise<Garment> {
  if (USE_MOCK_API) {
    const wardrobe = getOrCreateMockWardrobe(userId);
    const item = wardrobe.find((g) => g.id === garmentId);
    if (item) {
      item.hiddenFromRecommendations = hidden;
    }
    return item ?? { id: garmentId, name: '', category: 'top', color: '', formality: 'casual' };
  }
  const response = await requestJson<WardrobeApiItem>(
    `/wardrobe/${encodeURIComponent(userId)}/${encodeURIComponent(garmentId)}/hide`,
    {
      method: 'PATCH',
      body: JSON.stringify({ hidden }),
    }
  );
  return mapGarment(response);
}

// ---------------------------------------------------------------------------
// Delete garment
// ---------------------------------------------------------------------------

export async function deleteGarment(userId: string, garmentId: string): Promise<void> {
  if (USE_MOCK_API) {
    const wardrobe = getOrCreateMockWardrobe(userId);
    const idx = wardrobe.findIndex((g) => g.id === garmentId);
    if (idx !== -1) {
      wardrobe.splice(idx, 1);
    }
    return;
  }
  await requestJson<void>(
    `/wardrobe/${encodeURIComponent(userId)}/${encodeURIComponent(garmentId)}`,
    { method: 'DELETE' }
  );
}

export async function syncCalendarEvents(
  userId: string,
  googleAccessToken: string
): Promise<WeekEventsRequest> {
  const response = await requestJson<{
    events?: WeekEventApi[];
  }>(`/users/${encodeURIComponent(userId)}/calendar/sync`, {
    method: 'POST',
    body: JSON.stringify({ google_access_token: googleAccessToken }),
  });

  const responseEvents = Array.isArray(response.events) ? response.events : [];
  return {
    events: responseEvents.map((event, index) =>
      mapWeekEvent(event, dayOrder[index] ?? 'monday')
    ),
  };
}
