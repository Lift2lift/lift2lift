import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Button, Card, Field, FormScreen, Label, Loading, Muted, Notice } from '../components/ui';
import { cleanCode, COMMUNITY_CODE_LENGTH, formatCode } from '../lib/communities';
import { dayLabel, denverDay, isoDay } from '../lib/dates';
import { useTheme } from '../lib/theme';
import type { Community, PopularCommunity } from '../lib/types';
import { useApi, useNav } from '../providers';

/**
 * The Communities tab: enter the code from a club's invite to join it (or, for
 * a brand-new code, name the community and become its admin), the
 * communities you're in, and Popular communities you can ask to join.
 */
/** "on now" once the event has started; else its day ("Tomorrow", "Sat Dec 5"). All-day events use their Denver date. */
function nextWhen(e: { startsAt: string; allDay: boolean }) {
  if (+new Date(e.startsAt) <= Date.now()) return 'on now';
  return dayLabel(e.allDay ? denverDay(e.startsAt) : isoDay(new Date(e.startsAt)));
}

export function CommunitiesScreen() {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A code nobody has used yet: name the community first.
  const [setupCode, setSetupCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [mine, setMine] = useState<Community[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .myCommunities()
      .then((c) => {
        setMine(c);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [api]);
  useEffect(load, [load]);

  // Popular communities, with Request / Requested / Joined.
  const [popular, setPopular] = useState<PopularCommunity[] | null>(null);
  const loadPopular = useCallback(() => {
    api.popularCommunities().then(setPopular).catch(() => setPopular([]));
  }, [api]);
  useEffect(loadPopular, [loadPopular]);
  const [asking, setAsking] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; kind: 'success' | 'error' } | null>(null);
  async function request(c: PopularCommunity) {
    setAsking(c.id);
    setNote(null);
    try {
      const r = await api.requestToJoin(c.id);
      setPopular((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, myStatus: r } : x)));
      setNote({ id: c.id, text: r === 'member' ? "You're already in." : `Request sent. An admin of ${c.name} will review it.`, kind: 'success' });
      if (r === 'member') load();
    } catch (e) {
      setNote({ id: c.id, text: (e as Error).message, kind: 'error' });
    } finally {
      setAsking(null);
    }
  }
  async function cancelRequest(c: PopularCommunity) {
    setAsking(c.id);
    setNote(null);
    try {
      await api.cancelJoinRequest(c.id);
      setPopular((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, myStatus: 'none' } : x)));
      setCancelFor(null);
    } catch (e) {
      setNote({ id: c.id, text: (e as Error).message, kind: 'error' });
    } finally {
      setAsking(null);
    }
  }

  const clean = cleanCode(code);
  const complete = clean.length === COMMUNITY_CODE_LENGTH;

  async function join() {
    if (!complete || busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.joinCommunity(clean);
      if (r.status === 'not_found') {
        setError("That code doesn't match a community. Check it with your club and try again.");
      } else if (r.status === 'needs_setup') {
        setSetupCode(clean);
      } else {
        setCode('');
        nav.push('/community', { id: r.id, ...(r.status === 'joined' ? { welcome: r.role === 'admin' ? 'admin' : '1' } : {}) });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!setupCode || busy) return;
    setError(null);
    if (name.trim().length < 2) return setError('Give your community a name.');
    setBusy(true);
    try {
      const r = await api.setupCommunity(setupCode, name.trim(), description.trim());
      if (r.status === 'joined' || r.status === 'already') {
        setCode('');
        setSetupCode(null);
        setName('');
        setDescription('');
        nav.push('/community', { id: r.id, welcome: 'admin' });
      } else {
        setError("That code doesn't match a community. Check it with your club and try again.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen header={<AppHeader />}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900', textTransform: 'uppercase' }}>Communities</Text>
        <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21 }}>
          Your club's own rides, just for members. Got an invite? Enter its code. Or ask to join a popular community below.
        </Text>
      </View>

      {setupCode ? (
        /* ---------------- Set up a brand-new community ---------------- */
        <Card highlight style={{ padding: 16, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>NEW COMMUNITY · {formatCode(setupCode)}</Text>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>Set up your community</Text>
            <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
              Nobody has used this code yet. Name your community and you'll be its admin. Then send the code to your members as an invite so they can join.
            </Text>
          </View>
          <Field label="Name" value={name} onChangeText={setName} placeholder="CU Freeride" maxLength={40} autoFocus />
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Weekend trips to Summit County. Dawn patrol Saturdays."
            maxLength={280}
            multiline
          />
          {error ? <Notice kind="error">{error}</Notice> : null}
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button
              variant="ghost"
              title="Cancel"
              onPress={() => {
                setSetupCode(null);
                setError(null);
              }}
            />
            <Button title="Create community" loading={busy} onPress={create} />
          </View>
        </Card>
      ) : (
        /* ---------------- Enter a code ---------------- */
        <Card highlight style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '900' }} accessibilityRole="header">
            Enter community code
          </Text>
          <TextInput
            value={formatCode(code)}
            onChangeText={(v) => {
              setCode(cleanCode(v));
              setError(null);
            }}
            onSubmitEditing={join}
            placeholder="ABC-DEF-GHJ"
            placeholderTextColor={t.line}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={COMMUNITY_CODE_LENGTH + 2}
            returnKeyType="go"
            accessibilityLabel="Enter community code"
            style={[
              {
                backgroundColor: t.bg,
                borderWidth: 2,
                borderColor: error ? t.danger : complete ? t.ink : t.line,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 14,
                color: t.ink,
                fontSize: 28,
                fontWeight: '800',
                letterSpacing: 4,
                textAlign: 'center',
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              },
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
            ]}
          />
          <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center' }}>
            {clean.length}/{COMMUNITY_CODE_LENGTH} characters · letters and numbers
          </Text>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button title="Join community" loading={busy} disabled={!complete} onPress={join} />
        </Card>
      )}

      {loadError ? (
        <Notice kind="error">{loadError}</Notice>
      ) : !mine ? (
        <Loading label="Loading your communities…" />
      ) : mine.length === 0 ? null : (
      <View style={{ gap: 8 }}>
        <Label>Your communities</Label>
        {(
          mine.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => nav.push('/community', { id: c.id })}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}, ${c.upcomingRides} upcoming ${c.upcomingRides === 1 ? 'ride' : 'rides'}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <CommunityBadge name={c.name} photoUrl={c.photoUrl} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
                    {c.name}
                    {c.role === 'admin' ? <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>{'  · Admin'}</Text> : null}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>
                    {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.upcomingRides} upcoming {c.upcomingRides === 1 ? 'ride' : 'rides'}
                  </Text>
                  {c.nextEvent ? (
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>
                      Next: {c.nextEvent.title} · {nextWhen(c.nextEvent)}
                    </Text>
                  ) : null}
                </View>
                {c.pendingRequests > 0 ? (
                  <View style={{ backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                    <Text style={{ color: t.accentInk, fontSize: 12, fontWeight: '800' }}>
                      {c.pendingRequests} {c.pendingRequests === 1 ? 'request' : 'requests'}
                    </Text>
                  </View>
                ) : null}
                <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
              </Card>
            </Pressable>
          ))
        )}
      </View>
      )}

      {/* Popular communities: ask to join, like a group request. */}
      <View style={{ gap: 8 }}>
        <Label>Popular communities</Label>
        {!popular ? (
          <Loading label="Loading popular communities…" />
        ) : popular.length === 0 ? (
          <Muted>No communities to show yet. Clubs appear here once they're set up.</Muted>
        ) : (
          popular.map((c) => (
            <Card key={c.id} style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable
                  disabled={c.myStatus !== 'member'}
                  onPress={() => nav.push('/community', { id: c.id })}
                  accessibilityRole={c.myStatus === 'member' ? 'button' : undefined}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}
                >
                  <CommunityBadge name={c.name} photoUrl={c.photoUrl} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
                      {c.name}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 13 }}>
                      {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.upcomingRides} upcoming {c.upcomingRides === 1 ? 'ride' : 'rides'}
                    </Text>
                  </View>
                </Pressable>
                {c.myStatus === 'member' ? (
                  <Button small variant="ghost" title="Joined ✓" onPress={() => nav.push('/community', { id: c.id })} />
                ) : c.myStatus === 'requested' ? (
                  <Button small variant="ghost" title="Requested" onPress={() => setCancelFor(cancelFor === c.id ? null : c.id)} />
                ) : (
                  <Button small title="Request" loading={asking === c.id} onPress={() => request(c)} />
                )}
              </View>
              {c.description ? (
                <Text numberOfLines={2} style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>
                  {c.description}
                </Text>
              ) : null}
              {cancelFor === c.id && c.myStatus === 'requested' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: t.muted, fontSize: 13, flex: 1, minWidth: 140 }}>Waiting for an admin to approve.</Text>
                  <Button small variant="ghost" title="Keep" onPress={() => setCancelFor(null)} />
                  <Button small variant="danger" title="Cancel request" loading={asking === c.id} onPress={() => cancelRequest(c)} />
                </View>
              ) : null}
              {note?.id === c.id ? <Notice kind={note.kind}>{note.text}</Notice> : null}
            </Card>
          ))
        )}
      </View>
    </FormScreen>
  );
}

// Badge colors, picked by name so each community keeps its own (white text reads on all of them).
const BADGE_COLORS = ['#13213A', '#2C5BB8', '#0F7A6C', '#6B3FA0', '#B23A48', '#9A5B00'];

/** Initials in a rounded square, the community's avatar. */
/** The community's profile picture, or colored initials when it has none. */
export function CommunityBadge({ name, photoUrl, size = 44 }: { name: string; photoUrl?: string | null; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = BADGE_COLORS[h % BADGE_COLORS.length];
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?';
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.38, fontWeight: '900' }}>{initials}</Text>
    </View>
  );
}
