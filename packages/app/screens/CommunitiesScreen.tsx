import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Button, Card, Field, FormScreen, Label, Loading, Muted, Notice } from '../components/ui';
import { cleanCode, COMMUNITY_CODE_LENGTH, formatCode } from '../lib/communities';
import { useTheme } from '../lib/theme';
import type { Community } from '../lib/types';
import { useApi, useNav } from '../providers';

/**
 * The Communities tab: enter a club's 9-character code to join it, or, for a
 * brand-new code, name the community and become its admin. Below, the
 * communities you're in.
 */
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
          Your club's own rides, just for members. Get the code from your club.
        </Text>
      </View>

      {setupCode ? (
        /* ---------------- Set up a brand-new community ---------------- */
        <Card highlight style={{ padding: 16, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>NEW COMMUNITY · {formatCode(setupCode)}</Text>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>Set up your community</Text>
            <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
              Nobody has used this code yet. Name your community and you'll be its admin. Share the same code with your members so they can join.
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

      <View style={{ gap: 8 }}>
        <Label>Your communities</Label>
        {loadError ? (
          <Notice kind="error">{loadError}</Notice>
        ) : !mine ? (
          <Loading label="Loading your communities…" />
        ) : mine.length === 0 ? (
          <Muted>You're not in any communities yet. When your club gives you a code, enter it above.</Muted>
        ) : (
          mine.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => nav.push('/community', { id: c.id })}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}, ${c.upcomingRides} upcoming ${c.upcomingRides === 1 ? 'ride' : 'rides'}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <CommunityBadge name={c.name} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
                    {c.name}
                    {c.role === 'admin' ? <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>{'  · Admin'}</Text> : null}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>
                    {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.upcomingRides} upcoming {c.upcomingRides === 1 ? 'ride' : 'rides'}
                  </Text>
                </View>
                <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </FormScreen>
  );
}

// Badge colors, picked by name so each community keeps its own (white text reads on all of them).
const BADGE_COLORS = ['#13213A', '#2C5BB8', '#0F7A6C', '#6B3FA0', '#B23A48', '#9A5B00'];

/** Initials in a rounded square, the community's avatar. */
export function CommunityBadge({ name, size = 44 }: { name: string; size?: number }) {
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
