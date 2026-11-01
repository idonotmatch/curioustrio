import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAdaptiveLayout } from '../../contexts/AdaptiveLayoutContext';
const { safeAreaEdgesFor } = require('../../services/adaptiveLayout');

export function AdaptiveSafeArea({
  children,
  edges = ['top', 'right', 'left'],
  reclaimTrailingSystemRail = true,
  style,
}) {
  const layout = useAdaptiveLayout();
  const resolvedEdges = safeAreaEdgesFor(layout, edges, { reclaimTrailingSystemRail });

  return (
    <SafeAreaView edges={resolvedEdges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function AdaptiveContent({ children, kind = 'feed', padded = false, style }) {
  const layout = useAdaptiveLayout();
  return (
    <View style={[
      styles.content,
      { maxWidth: Math.min(layout.maxWidths[kind] || layout.maxWidths.feed, layout.availableWidth) },
      padded && { paddingHorizontal: layout.gutter },
      style,
    ]}>
      {children}
    </View>
  );
}

export function AdaptiveSheet({ children, style, ...props }) {
  const layout = useAdaptiveLayout();
  return (
    <View
      style={[styles.content, { maxWidth: Math.min(layout.maxWidths.sheet, layout.availableWidth) }, style]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
});
