import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../services/api';
import { supabase } from '../lib/supabase';
import { invalidateCache } from '../services/cache';
import { saveCurrentUserCache } from '../services/currentUserCache';

function QuestionShell({ step, totalSteps, eyebrow, title, body, children, onBack }) {
  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{step} of {totalSteps}</Text>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.8}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          ) : <View style={styles.backSpacer} />}
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <View style={styles.cardContent}>{children}</View>
        </View>
      </View>
    </View>
  );
}

function ChoiceButton({ title, body, onPress, tone = 'default', disabled = false }) {
  return (
    <TouchableOpacity
      style={[
        styles.choiceButton,
        tone === 'primary' && styles.choiceButtonPrimary,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.86}
    >
      <Text style={[styles.choiceTitle, tone === 'primary' && styles.choiceTitlePrimary]}>{title}</Text>
      {body ? <Text style={[styles.choiceBody, tone === 'primary' && styles.choiceBodyPrimary]}>{body}</Text> : null}
    </TouchableOpacity>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState('path');
  const [setupMode, setSetupMode] = useState(null);
  const [householdName, setHouseholdName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setIsAnonymous(session?.user?.is_anonymous === true);
      setCheckingSession(false);
    }).catch(() => {
      if (!active) return;
      setIsAnonymous(false);
      setCheckingSession(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const firstActionChoices = useMemo(() => {
    const base = [
      {
        key: 'add_expense',
        title: 'Add my first expense',
        body: 'Start with one thing you spent recently.',
      },
      {
        key: 'set_budget',
        title: 'Set a monthly budget',
        body: 'Give Adlo a pace to measure against.',
      },
    ];
    if (!isAnonymous) {
      base.push({
        key: 'connect_gmail',
        title: 'Bring in emailed receipts',
        body: 'Let Adlo pull in receipts and confirmations for you.',
      });
    }
    return base;
  }, [isAnonymous]);

  function routeAfterOnboarding(primaryChoice) {
    if (primaryChoice === 'set_budget') {
      router.replace({ pathname: '/(tabs)/settings', params: { welcome: 'budget' } });
      return;
    }
    if (primaryChoice === 'connect_gmail') {
      router.replace({ pathname: '/gmail-import', params: { welcome: 'connect' } });
      return;
    }
    router.replace({ pathname: '/(tabs)/summary', params: { welcome: 'add_expense' } });
  }

  function handlePathChoice(nextMode) {
    setSetupMode(nextMode);
    if (isAnonymous && nextMode !== 'solo') {
      setStep('account');
      return;
    }
    if (nextMode === 'create_household') {
      setStep('name');
      return;
    }
    if (nextMode === 'join_household') {
      setStep('join');
      return;
    }
    setStep('firstAction');
  }

  function handleBack() {
    if (step === 'account' || step === 'name' || step === 'join') {
      setStep('path');
      return;
    }
    if (step === 'firstAction' && setupMode === 'solo') {
      setStep('path');
    }
  }

  async function handleCreateHousehold() {
    if (!householdName.trim()) return;
    setLoading(true);
    try {
      await api.post('/households', { name: householdName.trim() });
      await invalidateCache('cache:household');
      setStep('firstAction');
    } catch (e) {
      Alert.alert('Could not create shared setup', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinHousehold() {
    if (!inviteToken.trim()) return;
    setLoading(true);
    try {
      await api.post(`/households/invites/${inviteToken.trim()}/accept`, {});
      await invalidateCache('cache:household');
      setStep('firstAction');
    } catch (e) {
      Alert.alert('Could not join shared setup', e?.message || 'Check the invite code and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function finishOnboarding(primaryChoice) {
    setLoading(true);
    try {
      const updatedUser = await api.patch('/users/settings', {
        setup_mode: setupMode,
        onboarding_complete: true,
        first_run_primary_choice: primaryChoice,
      });
      await saveCurrentUserCache(updatedUser);
      await invalidateCache('cache:household');
      routeAfterOnboarding(primaryChoice);
    } catch (e) {
      Alert.alert('Could not finish setup', e?.message || 'Please try again.');
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#f5f5f5" />
      </View>
    );
  }

  if (step === 'account') {
    return (
      <QuestionShell
        step={1}
        totalSteps={3}
        eyebrow="Shared setup"
        title="You'll need an account for this part."
        body="Keep tracking on this device if you want, then upgrade when you're ready to share expenses with someone else."
        onBack={handleBack}
      >
        <ChoiceButton
          title="Create an account"
          body="Use Google or Apple, then come right back here."
          tone="primary"
          disabled={loading}
          onPress={() => router.push('/login')}
        />
        <ChoiceButton
          title="Keep tracking solo"
          body="You can always turn sharing on later."
          disabled={loading}
          onPress={() => {
            setSetupMode('solo');
            setStep('firstAction');
          }}
        />
      </QuestionShell>
    );
  }

  if (step === 'name') {
    return (
      <QuestionShell
        step={2}
        totalSteps={3}
        eyebrow="Shared setup"
        title="What should we call it?"
        body="This can be your household, partner setup, or any shared spending space."
        onBack={handleBack}
      >
        <TextInput
          style={styles.input}
          placeholder="Weekend apartment, Home, Smith family..."
          placeholderTextColor="#5a5a5a"
          value={householdName}
          onChangeText={setHouseholdName}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleCreateHousehold}
        />
        <TouchableOpacity
          style={[styles.primaryButton, (!householdName.trim() || loading) && styles.buttonDisabled]}
          onPress={handleCreateHousehold}
          disabled={!householdName.trim() || loading}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryButtonText}>{loading ? 'Creating...' : 'Continue'}</Text>
        </TouchableOpacity>
      </QuestionShell>
    );
  }

  if (step === 'join') {
    return (
      <QuestionShell
        step={2}
        totalSteps={3}
        eyebrow="Shared setup"
        title="Enter the invite code"
        body="Paste the code you were sent. If the invite was tied to an email, accept it with that same address."
        onBack={handleBack}
      >
        <TextInput
          style={styles.input}
          placeholder="Paste invite code"
          placeholderTextColor="#5a5a5a"
          value={inviteToken}
          onChangeText={setInviteToken}
          autoCapitalize="none"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleJoinHousehold}
        />
        <TouchableOpacity
          style={[styles.primaryButton, (!inviteToken.trim() || loading) && styles.buttonDisabled]}
          onPress={handleJoinHousehold}
          disabled={!inviteToken.trim() || loading}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryButtonText}>{loading ? 'Joining...' : 'Continue'}</Text>
        </TouchableOpacity>
      </QuestionShell>
    );
  }

  if (step === 'firstAction') {
    return (
      <QuestionShell
        step={3}
        totalSteps={3}
        eyebrow="First useful thing"
        title="What would help first?"
        body="Pick the easiest way to get Adlo something real to work with."
        onBack={setupMode === 'solo' ? handleBack : null}
      >
        {firstActionChoices.map((choice) => (
          <ChoiceButton
            key={choice.key}
            title={choice.title}
            body={choice.body}
            disabled={loading}
            onPress={() => finishOnboarding(choice.key)}
            tone={choice.key === 'add_expense' ? 'primary' : 'default'}
          />
        ))}
      </QuestionShell>
    );
  }

  return (
    <QuestionShell
      step={1}
      totalSteps={3}
      eyebrow="Welcome"
      title="How are you starting?"
      body="We’ll keep this quick."
    >
      <ChoiceButton
        title="Just me"
        body="Track your own spending right away."
        tone="primary"
        onPress={() => handlePathChoice('solo')}
      />
      <ChoiceButton
        title="Start a shared setup"
        body="Create one place for shared expenses."
        onPress={() => handlePathChoice('create_household')}
      />
      <ChoiceButton
        title="Join someone"
        body="Use an invite code to join an existing setup."
        onPress={() => handlePathChoice('join_household')}
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 20,
    paddingVertical: 28,
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  progressText: {
    color: '#5f5f5f',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backSpacer: {
    height: 20,
  },
  backText: {
    color: '#8d8d8d',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  eyebrow: {
    color: '#767676',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: '#f5f5f5',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  body: {
    color: '#9a9a9a',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  cardContent: {
    gap: 10,
    marginTop: 22,
  },
  choiceButton: {
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  choiceButtonPrimary: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  choiceTitle: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '600',
  },
  choiceTitlePrimary: {
    color: '#0a0a0a',
  },
  choiceBody: {
    color: '#9a9a9a',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  choiceBodyPrimary: {
    color: '#434343',
  },
  input: {
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    color: '#f5f5f5',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  primaryButtonText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
