import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import {
  signInWithGoogle,
  signInWithApple,
  signInWithEmail,
  requestPasswordReset,
  signUpWithEmail,
  statusCodes,
} from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { PrimaryButton } from '../components/ui/Buttons';
import { colors, radius } from '../theme/tokens';

const {
  ANONYMOUS_AUTH_ENABLED,
  EMAIL_AUTH_MODES,
  buildEmailAuthSuccessMessage,
  buildPasswordResetRequestedMessage,
  normalizeAuthEmail,
  validateEmailAuthInput,
  validatePasswordResetRequest,
} = require('../services/emailAuth');
const { RESET_PASSWORD_ROUTE } = require('../services/passwordRecovery');

function ModeButton({ active, title, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.modeButton, active && styles.modeButtonActive]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState(EMAIL_AUTH_MODES.SIGN_IN);
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingAnon, setLoadingAnon] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAppleAvailability() {
      try {
        const available = Platform.OS === 'ios'
          ? await AppleAuthentication.isAvailableAsync()
          : false;
        if (active) setAppleAvailable(available);
      } catch {
        if (active) setAppleAvailable(false);
      }
    }
    loadAppleAvailability();
    return () => {
      active = false;
    };
  }, []);

  async function handleContinueAnonymously() {
    setLoadingAnon(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace(session.user?.is_anonymous === true ? '/onboarding' : '/(tabs)/summary');
        return;
      }
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      // _layout.js onAuthStateChange handles routing
    } catch (e) {
      Alert.alert('Sign in failed', e?.message || 'Please try again.');
    } finally {
      setLoadingAnon(false);
    }
  }

  async function handleEmailAuth() {
    const validationError = validateEmailAuthInput({
      mode: authMode,
      email,
      password,
      confirmPassword,
    });
    if (validationError) {
      Alert.alert(
        authMode === EMAIL_AUTH_MODES.SIGN_UP ? 'Could not create account' : 'Could not sign in',
        validationError
      );
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);
    setLoadingEmail(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const upgradingAnonymous = session?.user?.is_anonymous === true;
      if (upgradingAnonymous) {
        Alert.alert(
          'Finish guest upgrade another way',
          'Email sign-up for guest sessions is not ready yet. Sign out first, then create the account.'
        );
        return;
      }

      if (authMode === EMAIL_AUTH_MODES.SIGN_UP) {
        const result = await signUpWithEmail({
          email: normalizedEmail,
          password,
        });
        if (result.needsEmailConfirmation) {
          setAuthMode(EMAIL_AUTH_MODES.SIGN_IN);
          setPassword('');
          setConfirmPassword('');
          Alert.alert('Check your email', buildEmailAuthSuccessMessage(normalizedEmail));
        }
        return;
      }

      await signInWithEmail({
        email: normalizedEmail,
        password,
      });
      // _layout.js onAuthStateChange handles routing
    } catch (e) {
      Alert.alert(
        authMode === EMAIL_AUTH_MODES.SIGN_UP ? 'Could not create account' : 'Could not sign in',
        e?.message || 'Please try again.'
      );
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleForgotPassword() {
    const emailError = validatePasswordResetRequest(email);
    if (emailError) {
      Alert.alert('Could not reset password', emailError);
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);
    setLoadingReset(true);
    try {
      const redirectTo = Linking.createURL(RESET_PASSWORD_ROUTE);
      await requestPasswordReset({
        email: normalizedEmail,
        redirectTo,
      });
      Alert.alert('Check your email', buildPasswordResetRequestedMessage(normalizedEmail));
    } catch (e) {
      Alert.alert('Could not reset password', e?.message || 'Please try again.');
    } finally {
      setLoadingReset(false);
    }
  }

  function openEmailAuth(mode = EMAIL_AUTH_MODES.SIGN_IN) {
    setAuthMode(mode);
    setEmailExpanded(true);
  }

  async function handleGoogleSignIn() {
    setLoadingGoogle(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const upgradingAnonymous = session?.user?.is_anonymous === true;
      if (session && !upgradingAnonymous) {
        router.replace('/(tabs)/summary');
        return;
      }
      await signInWithGoogle();
      if (upgradingAnonymous) {
        router.replace('/onboarding');
      }
    } catch (e) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return;
      Alert.alert('Sign in failed', e?.message || 'Please try again.');
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setLoadingApple(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const upgradingAnonymous = session?.user?.is_anonymous === true;
      if (session && !upgradingAnonymous) {
        router.replace('/(tabs)/summary');
        return;
      }
      await signInWithApple();
      if (upgradingAnonymous) {
        router.replace('/onboarding');
      }
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      Alert.alert('Sign in failed', e?.message || 'Please try again.');
    } finally {
      setLoadingApple(false);
    }
  }

  const primaryButtonLabel = loadingEmail
    ? (authMode === EMAIL_AUTH_MODES.SIGN_UP ? 'Creating account...' : 'Signing in...')
    : (authMode === EMAIL_AUTH_MODES.SIGN_UP ? 'Create account' : 'Sign in');

  const heroSubtitle = emailExpanded
    ? (authMode === EMAIL_AUTH_MODES.SIGN_UP
      ? 'Create your Adlo account with email and password.'
      : 'Sign in with the email and password tied to your account.')
    : 'Track spending together.';

  const socialLabel = emailExpanded ? 'other ways to continue' : 'continue with';

  function renderSocialButtons({ subdued = false } = {}) {
    return (
      <View style={[styles.socialRow, subdued && styles.socialRowSubdued]}>
        <TouchableOpacity
          style={[
            styles.providerButton,
            !appleAvailable && styles.providerButtonFull,
            styles.providerButtonGoogle,
            loadingGoogle && styles.buttonDisabled,
          ]}
          onPress={handleGoogleSignIn}
          disabled={loadingGoogle || loadingApple}
          activeOpacity={0.88}
        >
          <View style={styles.providerButtonContent}>
            <Image
              source={require('../assets/google-g-logo.png')}
              style={styles.googleMark}
              resizeMode="contain"
            />
            <Text style={styles.providerButtonTextGoogle}>Google</Text>
          </View>
          {loadingGoogle ? (
            <View style={styles.providerLoadingOverlay} pointerEvents="none">
              <ActivityIndicator color={colors.textInverse} />
            </View>
          ) : null}
        </TouchableOpacity>

        {appleAvailable ? (
          <TouchableOpacity
            style={[
              styles.providerButton,
              styles.providerButtonApple,
              loadingApple && styles.buttonDisabled,
            ]}
            onPress={handleAppleSignIn}
            disabled={loadingApple || loadingGoogle}
            activeOpacity={0.88}
          >
            <View style={styles.providerButtonContent}>
              <Ionicons name="logo-apple" size={19} color={colors.text} />
              <Text style={styles.providerButtonTextApple}>Apple</Text>
            </View>
            {loadingApple ? (
              <View style={styles.providerLoadingOverlayDark} pointerEvents="none">
                <ActivityIndicator color={colors.text} />
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Adlo</Text>
        <Text style={styles.subtitle}>{heroSubtitle}</Text>

        {!emailExpanded ? (
          <>
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>{socialLabel}</Text>
              <View style={styles.divider} />
            </View>
            {renderSocialButtons()}

            <View style={styles.emailEntryArea}>
              <TouchableOpacity
                style={styles.expandEmailLink}
                onPress={() => openEmailAuth(EMAIL_AUTH_MODES.SIGN_IN)}
                activeOpacity={0.82}
              >
                <Text style={styles.expandEmailLinkText}>Use email and password instead</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.expandEmailSubLink}
                onPress={() => openEmailAuth(EMAIL_AUTH_MODES.SIGN_UP)}
                activeOpacity={0.82}
              >
                <Text style={styles.expandEmailSubLinkText}>Need an account? Create one with email.</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={styles.formCard}>
              <View style={styles.emailHeaderRow}>
                <View style={styles.modeRow}>
                  <ModeButton
                    title="Sign in"
                    active={authMode === EMAIL_AUTH_MODES.SIGN_IN}
                    onPress={() => setAuthMode(EMAIL_AUTH_MODES.SIGN_IN)}
                  />
                  <ModeButton
                    title="Create account"
                    active={authMode === EMAIL_AUTH_MODES.SIGN_UP}
                    onPress={() => setAuthMode(EMAIL_AUTH_MODES.SIGN_UP)}
                  />
                </View>
              </View>

              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.textDisabled}
                secureTextEntry
                textContentType={authMode === EMAIL_AUTH_MODES.SIGN_UP ? 'newPassword' : 'password'}
                value={password}
                onChangeText={setPassword}
              />
              {authMode === EMAIL_AUTH_MODES.SIGN_IN ? (
                <TouchableOpacity
                  style={styles.inlineLinkRow}
                  onPress={handleForgotPassword}
                  disabled={loadingReset}
                  activeOpacity={0.82}
                >
                  <Text style={styles.inlineLinkText}>
                    {loadingReset ? 'Sending reset link...' : 'Forgot password?'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {authMode === EMAIL_AUTH_MODES.SIGN_UP ? (
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor={colors.textDisabled}
                  secureTextEntry
                  textContentType="newPassword"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              ) : null}

              <PrimaryButton
                title={primaryButtonLabel}
                onPress={handleEmailAuth}
                disabled={loadingEmail}
                loading={loadingEmail}
                style={styles.emailButton}
              />

              <Text style={styles.helperText}>
                {authMode === EMAIL_AUTH_MODES.SIGN_UP
                  ? 'Use an email you can access. Adlo may ask you to confirm it before the first sign-in.'
                  : 'Use the email and password tied to your Adlo account.'}
              </Text>
            </View>

            <View style={styles.secondaryAuthSection}>
              <View style={styles.secondaryDividerRow}>
                <View style={styles.secondaryDivider} />
                <Text style={styles.secondaryDividerText}>{socialLabel}</Text>
                <View style={styles.secondaryDivider} />
              </View>
              {renderSocialButtons({ subdued: true })}
            </View>
          </>
        )}

        {ANONYMOUS_AUTH_ENABLED ? (
          <TouchableOpacity
            style={styles.anonBtn}
            onPress={handleContinueAnonymously}
            disabled={loadingAnon}
          >
            {loadingAnon
              ? <ActivityIndicator color={colors.textSubtle} />
              : <Text style={styles.anonBtnText}>Continue without account</Text>}
          </TouchableOpacity>
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
  title: { fontSize: 32, color: colors.text, fontWeight: '700', marginBottom: 8, letterSpacing: 0 },
  subtitle: { color: colors.textMuted, fontSize: 16, marginBottom: 32 },
  emailEntryArea: {
    marginTop: 18,
    alignItems: 'center',
  },
  expandEmailLink: {
    paddingVertical: 8,
  },
  expandEmailLinkText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  expandEmailSubLink: {
    paddingVertical: 4,
  },
  expandEmailSubLinkText: {
    color: colors.textSubtle,
    fontSize: 13,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 4,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
  },
  modeButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.textInverse,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 16,
    marginBottom: 20,
  },
  emailHeaderRow: {
    marginBottom: 14,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  emailButton: {
    marginTop: 4,
  },
  helperText: {
    color: colors.textSubtle,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  inlineLinkRow: {
    alignSelf: 'flex-end',
    marginTop: -2,
    marginBottom: 12,
    paddingVertical: 4,
  },
  inlineLinkText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderSubtle,
    minWidth: 0,
  },
  dividerText: {
    color: colors.textSubtle,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginHorizontal: 12,
  },
  secondaryAuthSection: {
    marginTop: 16,
    opacity: 0.72,
  },
  secondaryDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  secondaryDivider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.surfaceRaised,
    minWidth: 0,
  },
  secondaryDividerText: {
    color: colors.textDisabled,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginHorizontal: 12,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
  },
  socialRowSubdued: {
    opacity: 0.88,
  },
  providerButton: {
    flex: 1,
    height: 54,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  providerButtonGoogle: {
    backgroundColor: colors.text,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  providerButtonFull: {
    flex: 0,
    width: '100%',
  },
  providerButtonApple: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleMark: {
    width: 19,
    height: 19,
  },
  providerButtonTextGoogle: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  providerButtonTextApple: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  providerLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.onDarkOverlay,
    borderRadius: 8,
  },
  providerLoadingOverlayDark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlaySoft,
    borderRadius: 8,
  },
  anonBtn: { marginTop: 18, alignItems: 'center', padding: 12 },
  anonBtnText: { color: colors.textDisabled, fontSize: 14 },
  buttonDisabled: { opacity: 0.55 },
});
