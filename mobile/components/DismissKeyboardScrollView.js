import { Keyboard, Platform, ScrollView } from 'react-native';

export function DismissKeyboardScrollView({ children, keyboardDismissMode, keyboardShouldPersistTaps, onScrollBeginDrag, ...props }) {
  return (
    <ScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps || 'handled'}
      keyboardDismissMode={keyboardDismissMode || (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      onScrollBeginDrag={(event) => {
        Keyboard.dismiss();
        onScrollBeginDrag?.(event);
      }}
      {...props}
    >
      {children}
    </ScrollView>
  );
}
