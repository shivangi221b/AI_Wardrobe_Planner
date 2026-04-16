// Mock AsyncStorage for all tests
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// Mock expo modules that require native bindings
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'http://localhost'),
  useAuthRequest: jest.fn(() => [null, null, jest.fn()]),
  useAutoDiscovery: jest.fn(() => null),
  ResponseType: { Token: 'token' },
}));

jest.mock('expo-auth-session/providers/google', () => ({
  useAuthRequest: jest.fn(() => [null, null, jest.fn()]),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openBrowserAsync: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('react-ga4', () => ({
  initialize: jest.fn(),
  send: jest.fn(),
  event: jest.fn(),
}));

// Suppress console noise during tests
global.console.warn = jest.fn();
