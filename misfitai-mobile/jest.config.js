module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-web|@react-native-async-storage/async-storage|react-ga4)',
  ],
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
};
