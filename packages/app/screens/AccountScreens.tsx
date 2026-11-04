import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Brand, Button, Card, FormScreen, Heading, Label, Loading, Muted, Notice } from '../components/ui';
import { SCHOOL_NAME } from '../lib/config';
import { useTheme } from '../lib/theme';
import { insuranceErrorMessage } from '../lib/identity';
import { canHost, type DriverVerification } from '../lib/types';
import { useApi, useAuth, useDevice, useNav } from '../providers';

/* ---------------- Status pill ---------------- */

function stepsDone(v: DriverVerification | null) {
  return v ? Number(v.identity === 'verified') + Number(v.hasInsurance) : 0;
}

function statusInfo(v: DriverVerification | null) {
  if (!v) return { label: 'Not started', tone: 'muted' as const };
  if (v.status === 'approved') return { label: 'Verified', tone: 'ok' as const };
  if (v.status === 'submitted') return { label: 'Ready to host', tone: 'ok' as const };
  if (v.status === 'rejected') return { label: 'Needs attention', tone: 'danger' as const };
  const n = stepsDone(v);
  return { label: n === 0 ? 'Not started' : '1 of 2 steps done', tone: 'muted' as const };
}

function StatusPill({ v }: { v: DriverVerification | null }) {
  const t = useTheme();
  const { label, tone } = statusInfo(v);
  const bg = tone === 'ok' ? t.okBg : tone === 'danger' ? t.dangerBg : t.chip;
  const fg = tone === 'ok' ? t.ok : tone === 'danger' ? t.danger : t.muted;
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '800' }}>
        {tone === 'ok' ? '✓ ' : ''}
        {label}
      </Text>
    </View>
  );
}

function StepHeader({ n, title, done }: { n: number; title: string; done: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? t.ok : t.chip,
        }}
      >
        <Text style={{ color: done ? '#FFFFFF' : t.ink, fontWeight: '900', fontSize: 14 }}>{done ? '✓' : n}</Text>
      </View>
      <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800', flexShrink: 1 }}>{title}</Text>
    </View>
  );
}

/* ---------------- Account settings ---------------- */

export function AccountScreen() {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const [verification, setVerification] = useState<DriverVerification | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    api.getDriverVerification().then(setVerification).catch(() => {});
  }, [api]);

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Account" />

      <Card style={{ padding: 16, gap: 6 }}>
        <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{session?.name || 'Your account'}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>{session?.email}</Text>
        <View style={{ alignSelf: 'flex-start', backgroundColor: t.okBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 }}>
          <Text style={{ color: t.ok, fontSize: 13, fontWeight: '800' }}>✓ {SCHOOL_NAME} student · email confirmed</Text>
        </View>
      </Card>

      <View style={{ gap: 8 }}>
        <Label>Settings</Label>
        <Card>
          <Pressable
            onPress={() => nav.push('/profile')}
            accessibilityRole="button"
            style={({ pressed }) => ({ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.8 : 1 })}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>Profile</Text>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>Photo, bio, interests and Instagram. What riders and drivers see.</Text>
            </View>
            <Text style={{ color: t.muted, fontSize: 22 }}>›</Text>
          </Pressable>
        </Card>
        <Card>
          <Pressable
            onPress={() => nav.push('/account/driver')}
            accessibilityRole="button"
            style={({ pressed }) => ({ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.8 : 1 })}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>Driver verification</Text>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>Verified profile plus your insurance card. Needed to host rides.</Text>
              <StatusPill v={verification} />
            </View>
            <Text style={{ color: t.muted, fontSize: 22 }}>›</Text>
          </Pressable>
        </Card>
      </View>

      <Button
        title="Sign out"
        variant="ghost"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          await api.signOut();
        }}
      />
    </FormScreen>
  );
}

/* ---------------- Driver verification ---------------- */

const POLL_MS = 3000;
const POLL_TRIES = 20;

export function DriverVerificationScreen({ then, verifyDone }: { then?: string; verifyDone?: boolean }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const device = useDevice();
  const [v, setV] = useState<DriverVerification | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [polling, setPolling] = useState(!!verifyDone);
  const tries = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await api.getDriverVerification({ withPhotos: true });
      setV(next);
      setLoadError(null);
      return next;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // After Stripe, wait for its result to arrive (the webhook usually takes a few seconds).
  useEffect(() => {
    if (!polling) return;
    tries.current = 0;
    const id = setInterval(async () => {
      tries.current += 1;
      const next = await load();
      const settled = next && !['pending', 'processing'].includes(next.identity);
      if (settled || tries.current >= POLL_TRIES) {
        clearInterval(id);
        setPolling(false);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, load]);

  async function addInsurance() {
    setError(null);
    try {
      const photo = await device.pickPhoto();
      if (!photo) return;
      setUploading(true);
      setV(await api.checkInsurance(photo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const ready = canHost(v);
  const idDone = v?.identity === 'verified';

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Driver verification" subtitle="A verified profile plus your insurance card. You can host as soon as both are done." />

      {loadError ? (
        <View style={{ gap: 10 }}>
          <Notice kind="error">{loadError}</Notice>
          <Button variant="ghost" title="Try again" onPress={load} />
        </View>
      ) : !v ? (
        <Loading label="Loading…" />
      ) : (
        <>
          <StatusPill v={v} />
          {v.status === 'rejected' && v.reviewNote ? <Notice kind="error">{`${v.reviewNote} Fix it below to resubmit.`}</Notice> : null}

          {/* Step 1: verified profile (selfie matched to license) */}
          <Card style={{ padding: 16, gap: 12 }}>
            <StepHeader n={1} title="Verified profile" done={idDone} />
            {idDone ? (
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                Your license is current and your profile photo matches it.{v.idName ? ` Name on license: ${v.idName}.` : ''}
              </Text>
            ) : (
              <>
                <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                  Set up your profile with a selfie and your license scan. The selfie becomes your profile photo.
                </Text>
                <Button title="Set up my profile" onPress={() => nav.push('/profile/setup', { then: 'driver' })} />
              </>
            )}
          </Card>

          {/* Step 2: insurance card, read once and never stored */}
          <Card style={{ padding: 16, gap: 12 }}>
            <StepHeader n={2} title="Scan your insurance card" done={v.hasInsurance} />
            {v.hasInsurance ? (
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                {`${v.insurer ?? 'Your insurance'} is on file${v.insuranceExpires ? ` through ${v.insuranceExpires}` : ''}. Scan your new card when it renews.`}
              </Text>
            ) : v.insuranceStatus === 'review' ? (
              <Notice kind="info">{"The name on this card doesn't match your license, so our team needs to check it before you can host."}</Notice>
            ) : (
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                {uploading ? 'Reading your card…' : 'Your card, or a screenshot from your insurance app showing your name and policy dates. A card on a family policy is fine if it shows your last name.'}
              </Text>
            )}
            {v.insuranceStatus === 'requires_input' ? <Notice kind="error">{insuranceErrorMessage(v.insuranceError)}</Notice> : null}
            <Button small variant={v.hasInsurance ? 'ghost' : 'primary'} title={v.hasInsurance ? 'Scan new card' : 'Scan card'} loading={uploading} onPress={addInsurance} />
          </Card>

          {error ? <Notice kind="error">{error}</Notice> : null}

          {ready ? (
            <View style={{ gap: 10 }}>
              <Notice kind="success">
                {"You're set to host. Riders see “ID verified · insurance on file” on your rides."}
              </Notice>
              {then === 'post' ? <Button title="Post your first ride" onPress={() => nav.replace('/post')} /> : null}
            </View>
          ) : null}

          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
            Riders never see your license or insurance card, only the badge. We don't store your insurance card photo, only the insurer, expiry date and last 4 digits of the policy number.
            Lift2Lift doesn't run background checks.
          </Text>
        </>
      )}
    </FormScreen>
  );
}

/* ---------------- Stripe "done" page (opened in the iOS in-app browser) ---------------- */

export function IdCheckDoneScreen() {
  return (
    <FormScreen>
      <Brand />
      <Heading title="ID check finished" subtitle="You can close this window and head back to the Lift2Lift app. Your status updates in a few seconds." />
      <Muted center>Tap Done in the top corner to close.</Muted>
    </FormScreen>
  );
}
