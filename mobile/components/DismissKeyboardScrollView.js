import { Keyboard, Platform, ScrollView } from 'react-native';
import { useAdaptiveLayout } from '../contexts/AdaptiveLayoutContext';

export function DismissKeyboardScrollView({
  children,
  contentContainerStyle,
  contentLayout,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  onScrollBeginDrag,
  ...props
}) {
  const layout = useAdaptiveLayout();
  const adaptiveContentStyle = contentLayout ? {
    width: '100%',
    maxWidth: Math.min(
      layout.maxWidths[contentLayout] || layout.maxWidths.form,
      layout.availableWidth,
    ),
    alignSelf: 'center',
  } : null;

  return (
    <ScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps || 'handled'}
      keyboardDismissMode={keyboardDismissMode || (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      onScrollBeginDrag={(event) => {
        Keyboard.dismiss();
        onScrollBeginDrag?.(event);
      }}
      contentContainerStyle={[adaptiveContentStyle, contentContainerStyle]}
      {...props}
    >
      {children}
    </ScrollView>
  );
}
