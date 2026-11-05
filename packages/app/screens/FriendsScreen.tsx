import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Button, Card, FormScreen, Heading, Label, Loading, Muted, Notice } from '../components/ui';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { FriendPerson, FriendState, MyFriends } from '../lib/types';
import { useApi, useNav } from '../providers';

/**
 * Add friend / Requested / Accept / Friends, for one person. Used on profiles
 * and in search results. `onChange` gets the new state after each tap.
 */
export function FriendButton({ userId, state, onChange, small }: { userId: string; state: FriendState; onChange: (s: FriendState) => void; small?: boolean }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state === 'self') return null;

  async function run(fn: () => Promise<FriendState>) {
    setError(null);
    setBusy(true);
    try {
      onChange(await fn());
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (state === 'received') {
    body = (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small={small} title="Accept" loading={busy} onPress={() => run(async () => { await api.respondFriend(userId, true); return 'friends'; })} />
        <Button small={small} variant="ghost" title="Decline" onPress={() => run(async () => { await api.respondFriend(userId, false); return 'none'; })} />
      </View>
    );
  } else if (state === 'none') {
    body = <Button small={small} title="Add friend" loading={busy} onPress={() => run(() => api.friendRequest(userId))} />;
  } else if (confirm) {
    body = (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small={small} variant="ghost" title="Keep" onPress={() => setConfirm(false)} />
        <Button
          small={small}
          variant="danger"
          title={state === 'friends' ? 'Remove friend' : 'Cancel request'}
          loading={busy}
          onPress={() => run(async () => { await api.removeFriend(userId); return 'none'; })}
        />
      </View>
    );
  } else {
    body = <Button small={small} variant="ghost" title={state === 'friends' ? '✓ Friends' : 'Requested'} onPress={() => setConfirm(true)} />;
  }
  return (
    <View style={{ gap: 6 }}>
      {body}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </View>
  );
}

function PersonRow({ p, sub, right, first }: { p: FriendPerson; sub?: string; right?: ReactNode; first?: boolean }) {
  const t = useTheme();
  const nav = useNav();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, flexWrap: 'wrap' }}>
      <Pressable
        onPress={() => nav.push('/u', { id: p.id })}
        accessibilityRole="link"
        accessibilityLabel={`${p.name}'s profile`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 160 }}
      >
        <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>{p.name || 'Lift2Lift member'}</Text>
          {sub ? <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>{sub}</Text> : null}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

const subFor = (p: FriendPerson) =>
  [p.homeResortId ? RESORT_BY_ID[p.homeResortId]?.name : null, p.schoolYear].filter(Boolean).join(' · ') || undefined;

/** Find friends, answer requests, and see everyone you're friends with. */
export function FriendsScreen() {
  const t = useTheme();
  const api = useApi();
  const [data, setData] = useState<MyFriends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Search results track their own state as you tap.
  const [states, setStates] = useState<Record<string, FriendState>>({});
  const seq = useRef(0);

  const load = useCallback(() => {
    api
      .myFriends()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [api]);
  useEffect(load, [load]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    setSearching(true);
    const id = setTimeout(() => {
      api
        .searchPeople(q)
        .then((r) => n === seq.current && setResults(r))
        .catch(() => n === seq.current && setResults([]))
        .finally(() => n === seq.current && setSearching(false));
    }, 250);
    return () => clearTimeout(id);
  }, [api, query]);

  const stateOf = (id: string): FriendState => {
    if (states[id]) return states[id];
    if (!data) return 'none';
    if (data.friends.some((p) => p.id === id)) return 'friends';
    if (data.incoming.some((p) => p.id === id)) return 'received';
    if (data.outgoing.some((p) => p.id === id)) return 'sent';
    return 'none';
  };
  const changed = (id: string) => (s: FriendState) => {
    setStates((x) => ({ ...x, [id]: s }));
    load();
  };

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Friends" subtitle="Friends show up on your profile, and their rides get a tag on the board so you can ride together." />

      <View style={{ gap: 8 }}>
        <Label>Find people</Label>
        <View style={{ borderWidth: 1.5, borderColor: t.line, borderRadius: 12, paddingHorizontal: 14, backgroundColor: t.surface }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or Instagram"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxLength={60}
            accessibilityLabel="Search by name or Instagram"
            style={{ color: t.ink, fontSize: 16, paddingVertical: 12 }}
          />
        </View>
        {results ? (
          results.length ? (
            <Card>
              {results.map((p, i) => (
                <PersonRow key={p.id} p={p} sub={subFor(p)} first={i === 0} right={<FriendButton small userId={p.id} state={stateOf(p.id)} onChange={changed(p.id)} />} />
              ))}
            </Card>
          ) : searching ? (
            <Loading label="Searching…" />
          ) : (
            <Muted>Nobody by that name yet. Friends need a Lift2Lift account before you can add them.</Muted>
          )
        ) : null}
      </View>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {!data && !error ? <Loading label="Loading friends…" /> : null}

      {data?.incoming.length ? (
        <View style={{ gap: 8 }}>
          <Label>{`Friend requests · ${data.incoming.length}`}</Label>
          <Card>
            {data.incoming.map((p, i) => (
              <PersonRow key={p.id} p={p} sub={subFor(p)} first={i === 0} right={<FriendButton small userId={p.id} state="received" onChange={changed(p.id)} />} />
            ))}
          </Card>
        </View>
      ) : null}

      {data ? (
        <View style={{ gap: 8 }}>
          <Label>{`Your friends · ${data.friends.length}`}</Label>
          {data.friends.length ? (
            <Card>
              {data.friends.map((p, i) => (
                <PersonRow key={p.id} p={p} sub={subFor(p)} first={i === 0} />
              ))}
            </Card>
          ) : (
            <Muted>No friends yet. Search above, or tap someone's photo on a ride and add them from their profile.</Muted>
          )}
        </View>
      ) : null}

      {data?.outgoing.length ? (
        <View style={{ gap: 8 }}>
          <Label>{`Requests you sent · ${data.outgoing.length}`}</Label>
          <Card>
            {data.outgoing.map((p, i) => (
              <PersonRow key={p.id} p={p} sub="Waiting for them to accept" first={i === 0} right={<FriendButton small userId={p.id} state={stateOf(p.id)} onChange={changed(p.id)} />} />
            ))}
          </Card>
        </View>
      ) : null}
    </FormScreen>
  );
}

/** The friends strip on a profile: a row of photos, with a link to everyone. */
export function FriendsStrip({ friends, count, mutual, mine, first }: { friends: FriendPerson[]; count: number; mutual: number; mine: boolean; first: string }) {
  const t = useTheme();
  const nav = useNav();
  if (!count) {
    return mine ? (
      <View style={{ gap: 8 }}>
        <Label>Friends</Label>
        <Muted>Add the people you ski with. They'll show up here, and their rides get tagged on the board.</Muted>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button small title="Find friends" onPress={() => nav.push('/friends')} />
        </View>
      </View>
    ) : null;
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Label>{`Friends · ${count}`}</Label>
        {mine ? (
          <Text onPress={() => nav.push('/friends')} accessibilityRole="link" style={{ color: t.link, fontSize: 14, fontWeight: '700' }}>
            See all and add
          </Text>
        ) : mutual ? (
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>
            {mutual} mutual friend{mutual === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {friends.slice(0, 12).map((p) => (
          <Pressable key={p.id} onPress={() => nav.push('/u', { id: p.id })} accessibilityRole="link" accessibilityLabel={`${p.name}'s profile${p.mutual && !mine ? ', mutual friend' : ''}`} style={{ width: 64, alignItems: 'center', gap: 4 }}>
            <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={52} />
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 12, fontWeight: '600', maxWidth: 64 }}>{p.name.split(' ')[0]}</Text>
          </Pressable>
        ))}
      </View>
      {count > 12 ? <Muted>{`and ${count - 12} more of ${first}'s friends`}</Muted> : null}
    </View>
  );
}
