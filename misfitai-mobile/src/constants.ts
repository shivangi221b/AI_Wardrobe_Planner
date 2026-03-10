import type { DayOfWeek, EventType } from './types';

export const dayOrder: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const dayLabels: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export const eventTypeLabels: Record<EventType, string> = {
  work_meeting: 'Work meeting',
  date_night: 'Date night',
  gym: 'Gym',
  casual: 'Casual',
  none: 'No major event',
};

export const eventTypeOptions: EventType[] = [
  'work_meeting',
  'date_night',
  'gym',
  'casual',
  'none',
];
