import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { createAdaptiveLayout } = require('../services/adaptiveLayout');

const AdaptiveLayoutContext = createContext(null);

export function AdaptiveLayoutProvider({ children }) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const value = useMemo(() => createAdaptiveLayout({
    width,
    height,
    fontScale,
    insets,
  }), [fontScale, height, insets.bottom, insets.left, insets.right, insets.top, width]);

  return (
    <AdaptiveLayoutContext.Provider value={value}>
      {children}
    </AdaptiveLayoutContext.Provider>
  );
}

export function useAdaptiveLayout() {
  const value = useContext(AdaptiveLayoutContext);
  if (!value) {
    throw new Error('useAdaptiveLayout must be used within AdaptiveLayoutProvider');
  }
  return value;
}
