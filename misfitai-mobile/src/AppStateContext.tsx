import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  CalendarEvent,
  DayOfWeek,
  DayRecommendation,
  EventType,
  Garment,
  GarmentSeasonality,
  GarmentFormality,
} from './types';
import { dayOrder } from './constants';
import {
  addGarment,
  addGarmentFromVision,
  commitVisionItems as apiCommitVisionItems,
  confirmSearchAdd,
  getApiErrorMessage,
  getWardrobe,
  getWeekEvents,
  getWeeklyRecommendations,
  previewGarmentsFromVision as apiPreviewGarmentsFromVision,
  searchGarmentImages,
  syncCalendarEvents as apiSyncCalendarEvents,
  type ConfirmSearchAddPayload,
  type GarmentSearchResult,
  type GarmentSearchOptions,
  type VisionAddPayload,
  type VisionPreviewItem,
  saveWeekEvents,
} from './api';

interface AppState {
  userId: string;
  garments: Garment[];
  eventsByDay: Record<DayOfWeek, EventType>;
  recommendations: DayRecommendation[];
  isCalendarConnected: boolean;
  isLoadingWardrobe: boolean;
  wardrobeError: string | null;
  searchGarmentCandidates: (
    query: string,
    limit?: number,
    options?: GarmentSearchOptions
  ) => Promise<GarmentSearchResult[]>;
  setCalendarConnected: (connected: boolean) => void;
  setEventForDay: (day: DayOfWeek, eventType: EventType) => void;
  useDemoWeek: () => void;
  syncCalendarEvents: () => Promise<void>;
  generateRecommendations: () => Promise<void>;
  addGarmentToWardrobe: (
    payload: {
      name: string;
      category: 'top' | 'bottom' | 'shoes' | 'accessory';
      color?: string;
      formality?: GarmentFormality;
      seasonality?: GarmentSeasonality;
    }
  ) => Promise<void>;
  addGarmentViaVision: (payload: VisionAddPayload) => Promise<void>;
  previewVisionItems: (payload: VisionAddPayload) => Promise<VisionPreviewItem[]>;
  commitVisionItems: (items: VisionPreviewItem[]) => Promise<void>;
  addGarmentViaSearch: (payload: ConfirmSearchAddPayload) => Promise<void>;
}

const AppStateContext = createContext<AppState | undefined>(undefined);

const validEventTypes: EventType[] = [
  'work_meeting',
  'date_night',
  'gym',
  'casual',
  'none',
];

function createInitialEvents(): Record<DayOfWeek, EventType> {
  return {
    monday: 'none',
    tuesday: 'none',
    wednesday: 'none',
    thursday: 'none',
    friday: 'none',
    saturday: 'none',
    sunday: 'none',
  };
}

export function AppStateProvider({
  children,
  userId: userIdProp,
  googleAccessToken,
}: {
  children: React.ReactNode;
  /** Stable user id from auth (e.g. Google/Apple id or email). Used for wardrobe API and Supabase. */
  userId?: string;
  /** Google OAuth access token from sign-in (in-memory only, not persisted). Used for calendar sync. */
  googleAccessToken?: string | null;
}) {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [eventsByDay, setEventsByDay] =
    useState<Record<DayOfWeek, EventType>>(createInitialEvents);
  const [recommendations, setRecommendations] = useState<
    DayRecommendation[]
  >([]);
  const [isLoadingWardrobe, setIsLoadingWardrobe] = useState(false);
  const [wardrobeError, setWardrobeError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>(
    () => userIdProp ?? `demo-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    if (userIdProp && userIdProp !== userId) {
      setUserId(userIdProp);
    }
  }, [userIdProp, userId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoadingWardrobe(true);
      setWardrobeError(null);

      try {
        const wardrobe = await getWardrobe(userId);
        if (!cancelled) {
          setGarments(wardrobe);
        }
      } catch (error) {
        if (!cancelled) {
          setWardrobeError(getApiErrorMessage(error, 'Failed to load wardrobe.'));
        }
      }

      try {
        const week = await getWeekEvents(userId);
        if (!cancelled && week.events.length > 0) {
          const updated = createInitialEvents();
          week.events.forEach((event) => {
            if (
              dayOrder.includes(event.day) &&
              validEventTypes.includes(event.event_type)
            ) {
              updated[event.day] = event.event_type;
            }
          });
          setEventsByDay(updated);
        }
      } catch {
        // Week events are non-blocking for first render.
      } finally {
        if (!cancelled) {
          setIsLoadingWardrobe(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setCalendarConnected = useCallback((connected: boolean) => {
    setIsCalendarConnected(connected);
  }, []);

  const setEventForDay = useCallback((day: DayOfWeek, eventType: EventType) => {
    setEventsByDay((current) => ({
      ...current,
      [day]: eventType,
    }));
  }, []);

  const useDemoWeek = useCallback(() => {
    setEventsByDay({
      monday: 'work_meeting',
      tuesday: 'work_meeting',
      wednesday: 'gym',
      thursday: 'work_meeting',
      friday: 'date_night',
      saturday: 'casual',
      sunday: 'none',
    });
  }, []);

  const syncCalendarEvents = useCallback(async () => {
    if (!googleAccessToken) {
      throw new Error('No Google access token available. Please sign in with Google again.');
    }
    let result;
    try {
      result = await apiSyncCalendarEvents(userId, googleAccessToken);
    } catch (error) {
      throw new Error(getApiErrorMessage(error, 'Failed to sync calendar events.'));
    }
    if (result.events.length > 0) {
      const updated = createInitialEvents();
      result.events.forEach((event) => {
        if (
          dayOrder.includes(event.day) &&
          validEventTypes.includes(event.event_type)
        ) {
          updated[event.day] = event.event_type;
        }
      });
      setEventsByDay(updated);
    }
  }, [userId, googleAccessToken]);

  const generateRecommendations = useCallback(async () => {
    const events: CalendarEvent[] = dayOrder.map((day, index) => ({
      id: 'event-' + index,
      day,
      eventType: eventsByDay[day],
    }));
    await saveWeekEvents(userId, events);
    const response = await getWeeklyRecommendations(userId, events);
    setRecommendations(
      response.recommendations.sort(
        (a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)
      )
    );
  }, [userId, eventsByDay]);

  const addGarmentToWardrobe = useCallback(async (payload: {
    name: string;
    category: 'top' | 'bottom' | 'shoes' | 'accessory';
    color?: string;
    formality?: GarmentFormality;
    seasonality?: GarmentSeasonality;
  }): Promise<void> => {
    const created = await addGarment(userId, payload);
    setGarments((current) => {
      const existingIndex = current.findIndex((item) => item.id === created.id);
      if (existingIndex === -1) {
        return current.concat(created);
      }
      return current.map((item) => (item.id === created.id ? created : item));
    });
  }, [userId]);

  const addGarmentViaVision = useCallback(async (payload: VisionAddPayload): Promise<void> => {
    const createdItems = await addGarmentFromVision(userId, payload);
    setGarments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      createdItems.forEach((item) => {
        byId.set(item.id, item);
      });
      return Array.from(byId.values());
    });
  }, [userId]);

  const previewVisionItems = useCallback(async (payload: VisionAddPayload): Promise<VisionPreviewItem[]> => {
    return apiPreviewGarmentsFromVision(userId, payload);
  }, [userId]);

  const commitVisionItems = useCallback(async (items: VisionPreviewItem[]): Promise<void> => {
    const createdItems = await apiCommitVisionItems(userId, items);
    setGarments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      createdItems.forEach((item) => {
        byId.set(item.id, item);
      });
      return Array.from(byId.values());
    });
  }, [userId]);

  const searchGarmentCandidates = useCallback(
    async (
      query: string,
      limit = 20,
      options?: GarmentSearchOptions
    ): Promise<GarmentSearchResult[]> => {
      return searchGarmentImages(userId, query, limit, options);
    },
    [userId]
  );

  const addGarmentViaSearch = useCallback(
    async (payload: ConfirmSearchAddPayload): Promise<void> => {
      const created = await confirmSearchAdd(userId, payload);
      setGarments((current) => {
        const existingIndex = current.findIndex((item) => item.id === created.id);
        if (existingIndex === -1) {
          return current.concat(created);
        }
        return current.map((item) => (item.id === created.id ? created : item));
      });
    },
    [userId]
  );

  const value: AppState = useMemo(
    () => ({
      userId,
      garments,
      eventsByDay,
      recommendations,
      isCalendarConnected,
      isLoadingWardrobe,
      wardrobeError,
      searchGarmentCandidates,
      setCalendarConnected,
      setEventForDay,
      useDemoWeek,
      syncCalendarEvents,
      generateRecommendations,
      addGarmentToWardrobe,
      addGarmentViaVision,
      previewVisionItems,
      commitVisionItems,
      addGarmentViaSearch,
    }),
    [
      userId,
      garments,
      eventsByDay,
      recommendations,
      isCalendarConnected,
      isLoadingWardrobe,
      wardrobeError,
      searchGarmentCandidates,
      setCalendarConnected,
      setEventForDay,
      useDemoWeek,
      syncCalendarEvents,
      generateRecommendations,
      addGarmentToWardrobe,
      addGarmentViaVision,
      previewVisionItems,
      commitVisionItems,
      addGarmentViaSearch,
    ]
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
