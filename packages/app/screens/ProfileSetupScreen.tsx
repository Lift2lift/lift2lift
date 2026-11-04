import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Button, Chip, ChipRow, Field, FormScreen, Heading, Label, Loading, Notice } from '../components/ui';
import { driveText } from '../lib/dates';
import { BIOMETRIC_CONSENT, identityErrorMessage } from '../lib/identity';
import { DISCIPLINE_LABEL, GENDER_OPTIONS, INTEREST_GROUPS, MAX_INTERESTS, MIN_INTERESTS, PROFILE_PROMPTS } from '../lib/interests';
import { RESORTS } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { DriverVerification, PickedPhoto, ProfileFields, ProfilePage } from '../lib/types';
import { useApi, useAuth, useDevice, useNav } from '../providers';

const STEPS = ['Photo', 'About you', 'Interests'] as const;
const POLL_MS = 3000;
const POLL_TRIES = 20;
const NEARBY = 12;

const EMPTY: ProfileFields = {
  fullName: '',
  gender: null,
  discipline: null,
  homeResortId: null,
  schoolYear: '',
  hometown: '',
  bio: '',
  instagram: '',
  interests: [],
  prompts: {},
};

/** Already answered by "On the snow", so the picker doesn't ask again. */
const ASKED_ABOVE = ['skiing', 'snowboarding'];

/**
 * First-time setup, shown the first time someone posts a ride or calls shotgun.
 * 1. Profile photo: the live selfie from the ID check (matched to the license).
 * 2. About you. 3. Interests.
 */
export function ProfileSetupScreen({ then, verifyDone }: { then?: string; verifyDone?: boolean }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const device = useDevice();
  const { session } = useAuth();
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [v, setV] = useState<DriverVerification | null>(null);
  const [fields, setFields] = useState<ProfileFields>(EMPTY);
  const [step, setStep] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(!!verifyDone);
  const [allMountains, setAllMountains] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const tries = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    if (!session) return null;
    try {
      const [p, ver] = await Promise.all([api.getProfile(session.userId), api.getDriverVerification()]);
      setPage(p);
      setV(ver);
      if (p && !loaded.current) {
        loaded.current = true;
        setFields({
          fullName: p.fullName || session.name,
          gender: p.gender,
          discipline: p.discipline,
          homeResortId: p.homeResortId,
          schoolYear: p.schoolYear,
          hometown: p.hometown,
          bio: p.bio,
          instagram: p.instagram,
          interests: p.interests,
          prompts: p.prompts,
        });
        // Start on the first unfinished step.
        const photoDone = !!p.avatarUrl && ver.identity === 'verified';
        setStep(!photoDone ? 0 : !p.gender || !p.fullName ? 1 : p.interests.length < MIN_INTERESTS ? 2 : 1);
      }
      setLoadError(null);
      return { p, ver };
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, [api, session]);

  useEffect(() => {
    load();
  }, [load]);

  // After Stripe, wait for the result (and the saved selfie) to arrive.
  useEffect(() => {
    if (!polling) return;
    tries.current = 0;
    const id = setInterval(async () => {
      tries.current += 1;
      const next = await load();
      const settled = next && (!['pending', 'processing'].includes(next.ver.identity) && (next.ver.identity !== 'verified' || !!next.p?.avatarUrl));
      if (settled || tries.current >= POLL_TRIES) {
        clearInterval(id);
        setPolling(false);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, load]);

  const [licensePhoto, setLicensePhoto] = useState<PickedPhoto | null>(null);
  const [selfiePhoto, setSelfiePhoto] = useState<PickedPhoto | null>(null);

  const set = <K extends keyof ProfileFields>(k: K, value: ProfileFields[K]) => setFields((f) => ({ ...f, [k]: value }));

  async function pick(which: 'license' | 'selfie') {
    setError(null);
    try {
      const photo = await device.pickPhoto();
      if (!photo) return;
      if (which === 'license') setLicensePhoto(photo);
      else setSelfiePhoto(photo);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function startIdCheck() {
    if (!licensePhoto || !selfiePhoto) return;
    setError(null);
    setStarting(true);
    try {
      if (!v?.consented) await api.giveBiometricConsent();
      await api.checkLicense(licensePhoto, selfiePhoto);
      setLicensePhoto(null);
      setSelfiePhoto(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function saveAndGo(next: number) {
    setError(null);
    if (step === 1) {
      if (!fields.fullName.trim()) return setError('Add your name.');
      if (!fields.gender) return setError('Pick how you identify. "Prefer not to say" is fine.');
      if (fields.instagram && !/^@?[A-Za-z0-9._]{1,30}$/.test(fields.instagram.trim()))
        return setError('Instagram handles use letters, numbers, dots and underscores.');
    }
    setSaving(true);
    try {
      await api.updateProfile(fields);
      setStep(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setError(null);
    if (fields.interests.length < MIN_INTERESTS) return setError(`Pick at least ${MIN_INTERESTS} interests.`);
    setSaving(true);
    try {
      await api.updateProfile(fields);
      const missing = await api.completeProfile();
      if (missing.length) {
        setSaving(false);
        if (missing.includes('photo')) setStep(0);
        else if (missing.includes('name') || missing.includes('gender')) setStep(1);
        return setError('A step still needs finishing.');
      }
      if (then === 'post') nav.replace('/post');
      else if (then === 'board') nav.replace('/', { ready: '1' });
      else if (then === 'driver') nav.replace('/account/driver');
      else nav.replace('/profile');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const photoDone = !!page?.avatarUrl && v?.identity === 'verified';
  const idBusy = polling || v?.identity === 'processing' || (v?.identity === 'verified' && !page?.avatarUrl);

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Set up your profile" subtitle="Riders and drivers see this before they share a car with you. About two minutes, one time." />

      {/* Progress */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {STEPS.map((label, i) => (
          <View key={label} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? t.accent : t.line }} />
            <Text style={{ color: i === step ? t.ink : t.muted, fontSize: 12, fontWeight: '700' }}>
              {i + 1}. {label}
            </Text>
          </View>
        ))}
      </View>

      {loadError ? (
        <View style={{ gap: 10 }}>
          <Notice kind="error">{loadError}</Notice>
          <Button variant="ghost" title="Try again" onPress={load} />
        </View>
      ) : !page || !v ? (
        <Loading label="Loading…" />
      ) : step === 0 ? (
        /* ---------- 1. Photo = verified selfie ---------- */
        <View style={{ gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Avatar uri={page.avatarUrl} name={fields.fullName || session?.name || ''} gender={fields.gender} size={132} />
            {photoDone ? <Text style={{ color: t.ok, fontWeight: '800' }}>✓ Photo matched to your license</Text> : null}
          </View>

          {photoDone ? (
            <>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
                This is your profile photo. It's the selfie from your ID check, so everyone knows it's really you.
              </Text>
              <Button title="Next" onPress={() => setStep(1)} />
            </>
          ) : idBusy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <ActivityIndicator color={t.ink} />
              <Text style={{ color: t.muted, fontSize: 14 }}>Checking your ID and saving your photo…</Text>
            </View>
          ) : (
            <>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>Take your profile photo</Text>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                Add a photo of the front of your driver's license, then a selfie. We check the license isn't expired and the selfie matches it. The selfie becomes
                your profile photo. Face the camera in good light, no hat or sunglasses.
              </Text>
              {v.identity === 'requires_input' ? <Notice kind="error">{identityErrorMessage(v.identityError)}</Notice> : null}
              {!v.consented ? (
                <View style={{ backgroundColor: t.chip, borderRadius: 12, padding: 12 }}>
                  <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{BIOMETRIC_CONSENT}</Text>
                </View>
              ) : null}
              <Button small variant={licensePhoto ? 'ghost' : 'primary'} title={licensePhoto ? 'License added ✓' : 'Add license photo'} onPress={() => pick('license')} />
              <Button small variant={selfiePhoto ? 'ghost' : 'primary'} title={selfiePhoto ? 'Selfie added ✓' : 'Add selfie'} onPress={() => pick('selfie')} />
              <Button
                title={!v.consented ? 'Agree and check my license' : 'Check my license'}
                loading={starting}
                disabled={!licensePhoto || !selfiePhoto}
                onPress={startIdCheck}
              />
            </>
          )}
        </View>
      ) : step === 1 ? (
        /* ---------- 2. About you ---------- */
        <View style={{ gap: 18 }}>
          <Field label="Name" value={fields.fullName} onChangeText={(x) => set('fullName', x)} placeholder="First and last" autoComplete="name" maxLength={80} />

          <View style={{ gap: 8 }}>
            <Label>Gender</Label>
            <ChipRow wrap>
              {GENDER_OPTIONS.map((g) => (
                <Chip key={g.id} label={g.label} selected={fields.gender === g.id} onPress={() => set('gender', g.id)} />
              ))}
            </ChipRow>
            <Text style={{ color: t.muted, fontSize: 13 }}>Shown as the ring around your photo: blue for men, pink for women.</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Label>On the snow</Label>
            <ChipRow wrap>
              {(['ski', 'snowboard', 'both'] as const).map((d) => (
                <Chip key={d} label={DISCIPLINE_LABEL[d]} selected={fields.discipline === d} onPress={() => set('discipline', d)} />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: 8 }}>
            <Label>Home mountain</Label>
            <ChipRow wrap>
              {(allMountains ? RESORTS : RESORTS.filter((r, i) => i < NEARBY || r.id === fields.homeResortId)).map((r) => (
                <Chip
                  key={r.id}
                  label={`${r.name} · ${driveText(r.driveMinutes)}`}
                  selected={fields.homeResortId === r.id}
                  onPress={() => set('homeResortId', fields.homeResortId === r.id ? null : r.id)}
                />
              ))}
              {!allMountains ? <Chip label={`All ${RESORTS.length} mountains…`} onPress={() => setAllMountains(true)} /> : null}
            </ChipRow>
          </View>

          <Field label="Year and major" value={fields.schoolYear} onChangeText={(x) => set('schoolYear', x)} placeholder="Junior · Journalism" maxLength={40} />
          <Field label="Hometown" value={fields.hometown} onChangeText={(x) => set('hometown', x)} placeholder="Anchorage, AK" maxLength={60} />
          <Field
            label="Bio"
            value={fields.bio}
            onChangeText={(x) => set('bio', x)}
            placeholder="What should people know before a 2-hour drive with you?"
            maxLength={300}
            multiline
            hint={`${fields.bio.length}/300`}
          />
          <Field
            label="Instagram (optional)"
            value={fields.instagram}
            onChangeText={(x) => set('instagram', x)}
            placeholder="@yourhandle"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={31}
            hint="Shown as a link on your profile."
          />

          {showPrompts ? (
            <View style={{ gap: 12 }}>
            {PROFILE_PROMPTS.map((p) => (
              <Field
                key={p.key}
                label={p.question}
                value={fields.prompts[p.key] ?? ''}
                onChangeText={(x) => set('prompts', { ...fields.prompts, [p.key]: x })}
                placeholder={p.placeholder}
                maxLength={140}
              />
            ))}
            </View>
          ) : (
            <Text onPress={() => setShowPrompts(true)} accessibilityRole="button" style={{ color: t.link, fontWeight: '600', fontSize: 14 }}>
              Add fun profile answers (optional)
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
            <Button variant="ghost" title="Back" onPress={() => setStep(0)} />
            <Button title="Next" loading={saving} onPress={() => saveAndGo(2)} />
          </View>
        </View>
      ) : (
        /* ---------- 3. Interests (Instagram-style picker) ---------- */
        <View style={{ gap: 18 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>What are you into?</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>
              Pick at least {MIN_INTERESTS}. They show on your profile so you can find people you'll get along with on the drive.
            </Text>
          </View>
          {INTEREST_GROUPS.map((g) => (
            <View key={g.title} style={{ gap: 8 }}>
              <Label>{g.title}</Label>
              <ChipRow wrap>
                {g.items.filter((it) => !ASKED_ABOVE.includes(it.id)).map((it) => {
                  const on = fields.interests.includes(it.id);
                  return (
                    <Chip
                      key={it.id}
                      label={on ? `✓ ${it.label}` : it.label}
                      selected={on}
                      onPress={() => {
                        if (on) set('interests', fields.interests.filter((x) => x !== it.id));
                        else if (fields.interests.length < MAX_INTERESTS) set('interests', [...fields.interests, it.id]);
                        else setError(`You can pick up to ${MAX_INTERESTS}.`);
                      }}
                    />
                  );
                })}
              </ChipRow>
            </View>
          ))}
          <Text style={{ color: fields.interests.length >= MIN_INTERESTS ? t.ok : t.muted, fontWeight: '700' }}>
            {fields.interests.length} selected{fields.interests.length < MIN_INTERESTS ? ` · ${MIN_INTERESTS - fields.interests.length} more to go` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
            <Button variant="ghost" title="Back" onPress={() => setStep(1)} />
            <Button title="Finish profile" loading={saving} disabled={fields.interests.length < MIN_INTERESTS} onPress={finish} />
          </View>
        </View>
      )}

      {error ? <Notice kind="error">{error}</Notice> : null}
    </FormScreen>
  );
}
