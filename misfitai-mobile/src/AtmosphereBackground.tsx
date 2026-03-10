import React from 'react';
import { StyleSheet, View } from 'react-native';
import { palette } from './theme';

export function AtmosphereBackground() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.orb, styles.orbOne]} />
      <View style={[styles.orb, styles.orbTwo]} />
      <View style={[styles.orb, styles.orbThree]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: palette.bgAlt,
  },
  orbOne: {
    width: 220,
    height: 220,
    top: -70,
    right: -40,
    opacity: 0.75,
  },
  orbTwo: {
    width: 180,
    height: 180,
    bottom: 160,
    left: -70,
    opacity: 0.7,
  },
  orbThree: {
    width: 120,
    height: 120,
    top: 220,
    right: 30,
    opacity: 0.55,
  },
});
