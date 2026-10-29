import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Brand, Button, Card, FormScreen, Heading, Label, Loading, Muted, Notice } from '../components/ui';
import { SCHOOL_NAME } from '../lib/config';
import { BIOMETRIC_CONSENT, identityErrorMessage } from '../lib/identity';
import { useTheme } from '../lib/theme';
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
            onPress={() => nav.push('/account/driver')}
            accessibilityRole="button"
            style={({ pressed }) => ({ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.8 : 1 })}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>Driver verification</Text>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>ID check with a selfie, plus your insurance card. Needed to host rides.</Text>
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
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
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

  async function startIdCheck() {
    setError(null);
    setStarting(true);
    try {
      if (!v?.consented) await api.giveBiometricConsent();
      const res = await api.startIdentityCheck(device.platform);
      if (res.url) {
        await device.openIdentityCheck(res.url); // web leaves the page here; iOS comes back when the browser closes
      }
      setPolling(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function addInsurance() {
    setError(null);
    try {
      const photo = await device.pickPhoto();
      if (!photo) return;
      setUploading(true);
      setPreview(photo.previewUri);
      setV(await api.uploadDriverDoc('insurance', photo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const ready = canHost(v);
  const idDone = v?.identity === 'verified';
  const idBusy = polling || v?.identity === 'processing';

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Driver verification" subtitle="Two quick steps, about a minute total. You can host as soon as both are done." />

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

          {/* Step 1: ID + selfie */}
          <Card style={{ padding: 16, gap: 12 }}>
            <StepHeader n={1} title="Verify your ID with a selfie" done={idDone} />
            {idDone ? (
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                Your license is real and your selfie matches it.{v.idName ? ` Name on license: ${v.idName}.` : ''}
              </Text>
            ) : idBusy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={t.ink} />
                <Text style={{ color: t.muted, fontSize: 14, flex: 1 }}>Checking your ID. This usually takes under a minute.</Text>
              </View>
            ) : (
              <>
                <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                  Scan the front and back of your driver's license, then take a quick selfie. Stripe checks that the license is real and that your
                  face matches its photo.
                </Text>
                {v.identity === 'requires_input' ? <Notice kind="error">{identityErrorMessage(v.identityError)}</Notice> : null}
                {!v.consented ? (
                  <View style={{ backgroundColor: t.chip, borderRadius: 12, padding: 12 }}>
                    <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{BIOMETRIC_CONSENT}</Text>
                  </View>
                ) : null}
                <Button
                  title={
                    !v.consented
                      ? 'Agree and start ID check'
                      : v.identity === 'pending'
                        ? 'Finish your ID check'
                        : v.identity === 'requires_input'
                          ? 'Try again'
                          : 'Start ID check'
                  }
                  loading={starting}
                  onPress={startIdCheck}
                />
                {v.identity === 'pending' ? (
                  <Text style={{ textAlign: 'center' }}>
                    <Text onPress={() => setPolling(true)} accessibilityRole="button" style={{ color: t.link, fontWeight: '600', fontSize: 14 }}>
                      Already finished? Check again
                    </Text>
                  </Text>
                ) : null}
              </>
            )}
          </Card>

          {/* Step 2: insurance photo */}
          <Card style={{ padding: 16, gap: 12 }}>
            <StepHeader n={2} title="Add your insurance card" done={v.hasInsurance} />
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <View
                style={{
                  width: 96,
                  height: 64,
                  borderRadius: 10,
                  backgroundColor: t.chip,
                  borderWidth: v.hasInsurance ? 0 : 2,
                  borderStyle: 'dashed',
                  borderColor: t.line,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {preview ?? v.insuranceUrl ? (
                  <Image source={{ uri: (preview ?? v.insuranceUrl)! }} style={{ width: 96, height: 64 }} resizeMode="cover" accessibilityLabel="Insurance card photo" />
                ) : (
                  <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>INSURANCE</Text>
                )}
                {uploading ? (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18, flex: 1 }}>
                {uploading ? 'Uploading…' : 'Your card, or a screenshot from your insurance app showing your name and policy dates.'}
              </Text>
            </View>
            <Button small variant={v.hasInsurance ? 'ghost' : 'primary'} title={v.hasInsurance ? 'Replace photo' : 'Add photo'} loading={uploading} onPress={addInsurance} />
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
            Riders never see your license, selfie or insurance card, only the badge. Your insurance photo is visible to you and the Lift2Lift team.
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
