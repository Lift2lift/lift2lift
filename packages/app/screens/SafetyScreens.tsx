import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { ConfirmSheet } from '../components/Safety';
import { Button, Card, Field, FormScreen, Heading, Loading, Muted, Notice, TextLink } from '../components/ui';
import { SUPPORT_EMAIL } from '../lib/config';
import { PRIVACY_POLICY, TERMS } from '../lib/legal';
import { useTheme } from '../lib/theme';
import type { BlockedPerson } from '../lib/types';
import { useApi, useAuth, useNav } from '../providers';

/** Privacy policy or terms. Open to everyone, signed in or not. */
export function LegalScreen({ doc }: { doc: 'privacy' | 'terms' }) {
  const t = useTheme();
  const nav = useNav();
  const { session } = useAuth();
  const d = doc === 'privacy' ? PRIVACY_POLICY : TERMS;
  return (
    <FormScreen header={session ? <AppHeader /> : undefined}>
      {!session ? <TextLink onPress={() => nav.back()}>‹ Back</TextLink> : null}
      <Heading title={d.title} />
      <Text style={{ color: t.ink, fontSize: 15, lineHeight: 23 }}>{d.intro}</Text>
      {d.sections.map((s) => (
        <View key={s.heading} style={{ gap: 6 }}>
          <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{s.heading}</Text>
          {s.body.map((p, i) => (
            <Text key={i} style={{ color: t.ink, fontSize: 15, lineHeight: 23 }}>
              {p}
            </Text>
          ))}
        </View>
      ))}
    </FormScreen>
  );
}

/** Account → Blocked people. */
export function BlockedPeopleScreen() {
  const t = useTheme();
  const api = useApi();
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.myBlocks().then(setPeople).catch((e: Error) => setError(e.message));
  }, [api]);

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Blocked people" subtitle="You don't see each other's rides, profiles, messages or reviews. They aren't told." />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {people === null ? (
        <Loading label="Loading…" />
      ) : people.length === 0 ? (
        <Muted>You haven't blocked anyone.</Muted>
      ) : (
        <Card>
          {people.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
              <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={40} />
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>{p.name || 'Lift2Lift member'}</Text>
              <Button
                small
                variant="ghost"
                title="Unblock"
                loading={busy === p.id}
                onPress={async () => {
                  setBusy(p.id);
                  try {
                    await api.unblockUser(p.id);
                    setPeople((list) => (list ?? []).filter((x) => x.id !== p.id));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </View>
          ))}
        </Card>
      )}
    </FormScreen>
  );
}

/** Account → Delete account. Type DELETE, then confirm. */
export function DeleteAccountSection() {
  const t = useTheme();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>Delete account</Text>
      <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
        Permanently deletes your account, profile photo, rides you're driving, seats you've booked, messages, reviews, friends and verification. This can't be undone.
      </Text>
      <Field label='Type DELETE to confirm' value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
      <Button title="Delete my account" variant="danger" disabled={typed.trim() !== 'DELETE'} onPress={() => setOpen(true)} />
      <ConfirmSheet
        visible={open}
        title="Delete your account?"
        message="Everything goes, right now, and riders on rides you're driving lose their seats. You can sign up again later with your school email."
        confirmLabel="Delete forever"
        danger
        onConfirm={() => api.deleteAccount()}
        onClose={() => setOpen(false)}
      />
    </Card>
  );
}

/** Account → Help and legal links. */
export function HelpLinks() {
  const nav = useNav();
  return (
    <View style={{ gap: 10 }}>
      <TextLink onPress={() => nav.push('/account/blocked')}>Blocked people</TextLink>
      <TextLink onPress={() => nav.push('/terms')}>Terms and community guidelines</TextLink>
      <TextLink onPress={() => nav.push('/privacy')}>Privacy policy</TextLink>
      <TextLink onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Lift2Lift%20help`).catch(() => {})}>{`Contact support (${SUPPORT_EMAIL})`}</TextLink>
    </View>
  );
}
