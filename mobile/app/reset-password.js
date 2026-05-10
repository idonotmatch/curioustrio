import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { signOut, updatePassword } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/tokens';

const {
  endPasswordRecovery,
} = require('../services/passwordRecovery');
const {
  validatePasswordUpdateInput,
} = require('../services/emailAuth');

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active) return;
        setHasRecoverySession(!!session);
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setHasRecoverySession(false);
        setCheckingSession(false);
        return;
      }
      if (session) {
        setHasRecoverySession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleBackToLogin() {
    endPasswordRecovery();
    try {
      await signOut();
    } catch {
      // Non-fatal; the important part is getting the user back to sign-in.
    }
    router.replace('/login');
  }

  async function handleUpdatePassword() {
    const validationError = validatePasswordUpdateInput({
      password,
      confirmPassword,
    });
    if (validationError) {
      Alert.alert('Could not update password', validationError);
      return;
    }

    setLoading(true);
    try {
      await updatePassword({ password });
      endPasswordRecovery();
      Alert.alert('Password updated', 'You can keep going in Adlo now.');
      router.replace('/(tabs)/summary');
    } catch (e) {
      Alert.alert('Could not update password', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          Keep it simple and memorable. We'll use it the next time you sign in.
        </Text>

        {checkingSession ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.centerStateText}>Checking your reset link...</Text>
          </View>
        ) : null}

        {!checkingSession && !hasRecoverySession ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>This reset link is no longer active.</Text>
            <Text style={styles.panelBody}>
              Ask for a fresh password reset email, then open it on this device.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleBackToLogin}
              activeOpacity={0.88}
            >
              <Text style={styles.secondaryButtonText}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!checkingSession && hasRecoverySession ? (
          <View style={styles.panel}>
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry
              textContentType="newPassword"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleUpdatePassword}
              disabled={loading}
              activeOpacity={0.88}
            >
              {loading
                ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={styles.primaryButtonText}>Update password</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={handleBackToLogin}
              activeOpacity={0.82}
            >
              <Text style={styles.linkButtonText}>Use a different reset email</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSubtle,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 24,
  },
  centerState: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 28,
  },
  centerStateText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.surface,
    padding: 16,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  panelBody: {
    color: colors.textSubtle,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.text,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 4,
  },
  linkButtonText: {
    color: colors.textSubtle,
    fontSize: 13,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
