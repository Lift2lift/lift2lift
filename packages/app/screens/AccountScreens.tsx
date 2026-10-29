import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Button, Card, FormScreen, Heading, Label, Loading, Notice } from '../components/ui';
import { SCHOOL_NAME } from '../lib/config';
import { useTheme } from '../lib/theme';
import { canHost, type DriverDoc, type DriverVerification } from '../lib/types';
import { useApi, useAuth, useNav, usePhotoPicker } from '../providers';

/* ---------------- Status pill ---------------- */

function statusInfo(v: DriverVerification | null) {
  if (!v) return { label: 'Not started', tone: 'muted' as const };
  switch (v.status) {
    case 'approved':
      return { label: 'Verified', tone: 'ok' as const };
    case 'submitted':
      return { label: 'Ready to host', tone: 'ok' as const };
    case 'rejected':
      return { label: 'Needs a new photo', tone: 'danger' as const };
    default: {
      const n = Number(v.hasLicense) + Number(v.hasInsurance);
      return { label: n === 0 ? 'Not started' : '1 of 2 photos', tone: 'muted' as const };
    }
  }
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
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>License and insurance photos. Needed to host rides.</Text>
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

const DOCS: { doc: DriverDoc; title: string; help: string }[] = [
  { doc: 'license', title: "Driver's license", help: 'The front of your license, with your name and photo readable.' },
  { doc: 'insurance', title: 'Insurance card', help: 'Your card, or a screenshot from your insurance app showing your name and policy dates.' },
];

export function DriverVerificationScreen({ then }: { then?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const photos = usePhotoPicker();
  const [v, setV] = useState<DriverVerification | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<DriverDoc | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<DriverDoc, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setV(await api.getDriverVerification({ withPhotos: true }));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(doc: DriverDoc) {
    setError(null);
    try {
      const photo = await photos.pick();
      if (!photo) return; // cancelled
      setUploading(doc);
      setPreviews((p) => ({ ...p, [doc]: photo.previewUri }));
      setV(await api.uploadDriverDoc(doc, photo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  const ready = canHost(v);
  const wasRejected = v?.status === 'rejected';

  return (
    <FormScreen header={<AppHeader />}>
      <Heading
        title="Driver verification"
        subtitle="Snap a photo of your driver's license and your insurance card. You can host as soon as both are uploaded."
      />

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
          {wasRejected && v.reviewNote ? <Notice kind="error">{`${v.reviewNote} Upload a new photo to resubmit.`}</Notice> : null}

          {DOCS.map(({ doc, title, help }) => {
            const has = doc === 'license' ? v.hasLicense : v.hasInsurance;
            const uri = previews[doc] ?? (doc === 'license' ? v.licenseUrl : v.insuranceUrl);
            const busy = uploading === doc;
            return (
              <Card key={doc} style={{ padding: 14, gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                  <View
                    style={{
                      width: 96,
                      height: 64,
                      borderRadius: 10,
                      backgroundColor: t.chip,
                      borderWidth: has ? 0 : 2,
                      borderStyle: 'dashed',
                      borderColor: t.line,
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {uri ? (
                      <Image source={{ uri }} style={{ width: 96, height: 64 }} resizeMode="cover" accessibilityLabel={`${title} photo`} />
                    ) : (
                      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>{doc === 'license' ? 'LICENSE' : 'INSURANCE'}</Text>
                    )}
                    {busy ? (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                        <ActivityIndicator color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>
                      {title}
                      {has && !busy ? <Text style={{ color: t.ok }}>  ✓</Text> : null}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{busy ? 'Uploading…' : help}</Text>
                  </View>
                </View>
                <Button
                  small
                  variant={has ? 'ghost' : 'primary'}
                  title={has ? 'Replace photo' : 'Add photo'}
                  loading={busy}
                  disabled={!!uploading && !busy}
                  onPress={() => add(doc)}
                />
              </Card>
            );
          })}

          {error ? <Notice kind="error">{error}</Notice> : null}

          {ready ? (
            <View style={{ gap: 10 }}>
              <Notice kind="success">
                {v.status === 'approved'
                  ? "You're verified. Riders see “License & insurance on file” on your rides."
                  : "You're set to host. Riders see “License & insurance on file” on your rides. We may check your photos later."}
              </Notice>
              {then === 'post' ? <Button title="Post your first ride" onPress={() => nav.replace('/post')} /> : null}
            </View>
          ) : null}

          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
            Only you and the Lift2Lift team can see these photos. Riders never see them, only the badge. Lift2Lift doesn't run background checks.
          </Text>
        </>
      )}
    </FormScreen>
  );
}
