import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { GlobalAddLauncher } from '../components/GlobalAddLauncher';
import { colors } from '../theme/tokens';

export default function QuickAddScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <GlobalAddLauncher
        router={router}
        openSignal={1}
        navigationAction="replace"
        onDismiss={() => router.replace('/(tabs)/summary')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
