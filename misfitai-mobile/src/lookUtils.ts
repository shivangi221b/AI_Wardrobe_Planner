import type { EventType } from './types';

export function getScheduleChips(eventType: EventType): string[] {
  switch (eventType) {
    case 'work_meeting':
      return ['Work meeting', 'Business casual', 'Professional setting'];
    case 'date_night':
      return ['Date night', 'Evening out', 'Smart elevated'];
    case 'gym':
      return ['Gym session', 'Active wear', 'Move-all-day'];
    case 'casual':
      return ['Casual day', 'Relaxed fit', 'Easy going'];
    case 'none':
    default:
      return ['No major event', 'Flexible style', 'Everyday wear'];
  }
}

export function getFitSignals(eventType: EventType): Array<{ label: string; value: string }> {
  switch (eventType) {
    case 'work_meeting':
      return [
        { label: 'Style match', value: 'Polished casual' },
        { label: 'Weather fit', value: 'Layered + rain-ready' },
        { label: 'Flexibility', value: 'Desk to dinner' },
      ];
    case 'date_night':
      return [
        { label: 'Style match', value: 'Smart + elevated' },
        { label: 'Weather fit', value: 'Warm evening layer' },
        { label: 'Flexibility', value: 'Campus to date' },
      ];
    case 'gym':
      return [
        { label: 'Style match', value: 'Athleisure friendly' },
        { label: 'Weather fit', value: 'Breathable layers' },
        { label: 'Flexibility', value: 'Move-all-day' },
      ];
    case 'none':
    case 'casual':
    default:
      return [
        { label: 'Style match', value: 'Easy polished' },
        { label: 'Weather fit', value: 'Comfort-first' },
        { label: 'Flexibility', value: 'All-day repeatable' },
      ];
  }
}
