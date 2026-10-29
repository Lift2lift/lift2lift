import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Brand, Button, Field, FormScreen, Heading, Notice, TextLink } from '../components/ui';
import { MIN_PASSWORD_LENGTH, REQUIRE_EDU_EMAIL } from '../lib/config';
import { isValidEmail } from '../lib/errors';
import { useTheme } from '../lib/theme';
import { useApi, useNav } from '../providers';

const TAGLINE = 'Rides to the hill · Colorado';
const emailProps = {
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'email',
  keyboardType: 'email-address',
  textContentType: 'emailAddress',
  placeholder: 'you@colorado.edu',
} as const;

function Footer({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, textAlign: 'center', fontSize: 15 }}>{children}</Text>;
}

/* ---------------- Sign in ---------------- */

export function SignInScreen() {
  const api = useApi();
  const nav = useNav();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!isValidEmail(clean)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setLoading(true);
    try {
      await api.signIn(clean, password); // the app opens when the session arrives
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('Confirm your email')) {
        await api.resendSignup(clean).catch(() => {});
        nav.push('/verify', { email: clean });
      } else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScreen>
      <Brand tagline={TAGLINE} />
      <Heading title="Sign in" subtitle="Find a ride or fill your empty seats." />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Field label="Email" value={email} onChangeText={setEmail} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} {...emailProps} />
      <Field
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <View style={{ alignItems: 'flex-end', marginTop: -6 }}>
        <TextLink onPress={() => nav.push('/forgot-password', { email: email.trim() })}>Forgot password?</TextLink>
      </View>
      <Button title="Sign in" onPress={submit} loading={loading} />
      <Footer>
        New here? <TextLink onPress={() => nav.push('/sign-up')}>Create an account</TextLink>
      </Footer>
    </FormScreen>
  );
}

/* ---------------- Sign up ---------------- */

export function SignUpScreen() {
  const api = useApi();
  const nav = useNav();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    setError(null);
    const cleanName = name.trim();
    const clean = email.trim().toLowerCase();
    if (!cleanName) return setError('Add your name so drivers and riders know who you are.');
    if (!isValidEmail(clean)) return setError('Enter a valid email address.');
    if (REQUIRE_EDU_EMAIL && !clean.endsWith('.edu')) return setError('Use your college email (ending in .edu).');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
    setLoading(true);
    try {
      const { needsVerification } = await api.signUp(cleanName, clean, password);
      if (needsVerification) nav.push('/verify', { email: clean });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScreen>
      <Brand tagline={TAGLINE} />
      <Heading title="Create your account" subtitle="Takes 30 seconds. We'll email you a code to confirm it's you." />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="First and last"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <Field
        ref={emailRef}
        label={REQUIRE_EDU_EMAIL ? 'College email' : 'Email'}
        value={email}
        onChangeText={setEmail}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        {...emailProps}
      />
      <Field
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button title="Create account" onPress={submit} loading={loading} />
      <Footer>
        Already have an account? <TextLink onPress={() => nav.replace('/sign-in')}>Sign in</TextLink>
      </Footer>
    </FormScreen>
  );
}

/* ---------------- Confirm email code ---------------- */

const RESEND_WAIT = 60;

function CodeField(props: { label: string; value: string; onChange: (v: string) => void; onSubmit?: () => void }) {
  return (
    <Field
      label={props.label}
      value={props.value}
      onChangeText={(v) => props.onChange(v.replace(/\D/g, '').slice(0, 10))}
      placeholder="123456"
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={10}
      returnKeyType="go"
      onSubmitEditing={props.onSubmit}
      style={{ fontSize: 22, letterSpacing: 6, fontWeight: '700' }}
    />
  );
}

export function VerifyScreen({ email }: { email: string }) {
  const api = useApi();
  const nav = useNav();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(RESEND_WAIT);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function verify() {
    setError(null);
    setInfo(null);
    if (code.length < 6) return setError('Enter the code from the email.');
    setLoading(true);
    try {
      await api.verifySignup(email, code); // the app opens when the session arrives
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await api.resendSignup(email);
      setInfo(`New code sent to ${email}.`);
      setWait(RESEND_WAIT);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!email) {
    return (
      <FormScreen>
        <Brand />
        <Notice kind="error">This page needs an email address. Go back and sign up or sign in.</Notice>
        <Button title="Back to sign in" variant="ghost" onPress={() => nav.replace('/sign-in')} />
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <Brand tagline={TAGLINE} />
      <Heading title="Check your email" subtitle={`We sent a code to ${email}. Enter it to finish signing up.`} />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {info ? <Notice kind="success">{info}</Notice> : null}
      <CodeField label="Confirmation code" value={code} onChange={setCode} onSubmit={verify} />
      <Button title="Confirm and continue" onPress={verify} loading={loading} />
      <Footer>
        {wait > 0 ? `Didn't get it? You can resend in ${wait}s.` : "Didn't get it? "}
        {wait <= 0 ? <TextLink onPress={resend}>Send a new code</TextLink> : null}
      </Footer>
      <Footer>
        <TextLink onPress={() => nav.replace('/sign-in')}>Use a different email</TextLink>
      </Footer>
    </FormScreen>
  );
}

/* ---------------- Forgot password ---------------- */

export function ForgotPasswordScreen({ initialEmail = '' }: { initialEmail?: string }) {
  const api = useApi();
  const nav = useNav();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!isValidEmail(clean)) return setError('Enter the email you signed up with.');
    setLoading(true);
    try {
      await api.sendPasswordReset(clean);
      setEmail(clean);
      setStep('reset');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    setError(null);
    if (code.length < 6) return setError('Enter the code from the email.');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`);
    setLoading(true);
    try {
      await api.resetPassword(email, code, password); // signs in with the new password
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  if (step === 'email') {
    return (
      <FormScreen>
        <Brand tagline={TAGLINE} />
        <Heading title="Reset your password" subtitle="Enter your email and we'll send you a code." />
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Field label="Email" value={email} onChangeText={setEmail} returnKeyType="go" onSubmitEditing={sendCode} {...emailProps} />
        <Button title="Send code" onPress={sendCode} loading={loading} />
        <Footer>
          <TextLink onPress={() => nav.replace('/sign-in')}>Back to sign in</TextLink>
        </Footer>
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <Brand tagline={TAGLINE} />
      <Heading title="Pick a new password" subtitle={`If ${email} has an account, a code is on its way. Enter it with your new password.`} />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <CodeField label="Code from email" value={code} onChange={setCode} />
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        returnKeyType="go"
        onSubmitEditing={reset}
      />
      <Button title="Save password and sign in" onPress={reset} loading={loading} />
      <Footer>
        Wrong email?{' '}
        <TextLink
          onPress={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
        >
          Start over
        </TextLink>
      </Footer>
    </FormScreen>
  );
}
