import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { CommunityMembers } from '../components/CommunityMembers';
import { RideCard } from '../components/RideCard';
import { SetupModal } from '../components/SetupModal';
import { Button, Card, FormScreen, Label, Loading, Muted, Notice } from '../components/ui';
import { useTheme } from '../lib/theme';
import { busyLegsByDay } from '../lib/trips';
import type { BoardRide, CommunityPage } from '../lib/types';
import { useForecast } from '../lib/useForecast';
import { useApi, useAuth, useNav } from '../providers';
import { CommunityBadge } from './CommunitiesScreen';

/**
 * One community: its upcoming rides (members only), a button to post a ride
 * to it, and its members. Admins also see the invite code, requests to join,
 * and tools to rename it, make a new code, list or hide it in Popular, make
 * other admins and remove people.
 */
export function CommunityScreen({ communityId, welcome }: { communityId?: string; welcome?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const me = session?.userId;
  const { forecast } = useForecast();

  const [page, setPage] = useState<CommunityPage | null>(null);
  const [rides, setRides] = useState<BoardRide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(
    welcome === 'admin' ? { text: "You're the admin. Send the invite below to your members so they can join.", kind: 'success' } : welcome ? { text: "You're in! Rides posted here show up below and on the mountain boards.", kind: 'success' } : null,
  );

  const load = useCallback(async () => {
    if (!communityId) return setError('No community picked.');
    try {
      const [p, r] = await Promise.all([api.communityPage(communityId), api.listRides()]);
      setPage(p);
      setRides(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, communityId]);
  useEffect(() => {
    load();
  }, [load]);

  const [profileReady, setProfileReady] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    if (!me) return;
    api.getProfile(me).then((p) => setProfileReady(!!p?.profileComplete)).catch(() => {});
  }, [api, me]);

  const now = Date.now();
  const communityRides = useMemo(
    () =>
      (rides ?? [])
        .filter((r) => r.communityId === communityId && new Date(r.returnAt ?? r.departAt).getTime() > now)
        .sort((a, b) => a.departAt.localeCompare(b.departAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rides, communityId],
  );
  const busyDays = useMemo(() => busyLegsByDay(rides ?? [], me), [rides, me]);

  // Requests to join
  const admin = page?.myRole === 'admin';
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage({ text: done, kind: 'success' });
    } catch (e) {
      setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <FormScreen header={<AppHeader />}>
        <BackLink />
        <Notice kind="error">{error}</Notice>
      </FormScreen>
    );
  }
  if (!page || !rides) {
    return (
      <FormScreen header={<AppHeader />}>
        <BackLink />
        <Loading label="Loading community…" />
      </FormScreen>
    );
  }

  return (
    <FormScreen header={<AppHeader />}>
      <SetupModal visible={setupOpen} role="rider" profileReady={profileReady} onClose={() => setSetupOpen(false)} />
      <BackLink />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <CommunityBadge name={page.name} size={56} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: t.ink, fontSize: 28, fontWeight: '900', textTransform: 'uppercase' }} accessibilityRole="header">
            {page.name}
          </Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            {page.memberCount} {page.memberCount === 1 ? 'member' : 'members'} · {admin ? "You're an admin" : 'Member'}
          </Text>
        </View>
      </View>
      {page.description ? <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{page.description}</Text> : null}

      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

      {/* Requests to join: admins approve or decline. */}
      {admin && page.requests.length ? (
        <View style={{ gap: 8 }}>
          <Label>{`Requests to join · ${page.requests.length}`}</Label>
          <Card highlight style={{ padding: 0 }}>
            {page.requests.map((q, i) => (
              <View
                key={q.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}
              >
                <Pressable
                  onPress={() => nav.push('/u', { id: q.id })}
                  accessibilityRole="link"
                  accessibilityLabel={`${q.name || 'Someone'} asked to join. Open profile`}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 150, opacity: pressed ? 0.7 : 1 })}
                >
                  <Avatar uri={q.avatarUrl} name={q.name} gender={q.gender} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>
                      {q.name || 'Lift2Lift member'}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>Asked {askedAgo(q.requestedAt)} · tap to see their profile</Text>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Button
                    small
                    variant="ghost"
                    title="Decline"
                    onPress={() =>
                      run(async () => {
                        await api.respondJoinRequest(page.id, q.id, false);
                        await load();
                      }, `Declined ${q.name.split(' ')[0]}'s request.`)
                    }
                  />
                  <Button
                    small
                    title="Approve"
                    loading={busy}
                    onPress={() =>
                      run(async () => {
                        await api.respondJoinRequest(page.id, q.id, true);
                        await load();
                      }, `${q.name.split(' ')[0]} is in.`)
                    }
                  />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <Button title={`+ Post a ride to ${page.name}`} onPress={() => nav.push('/post', { community: page.id })} />


      {/* Rides */}
      <View style={{ gap: 10 }}>
        <Label>{`Upcoming rides · ${communityRides.length}`}</Label>
        {communityRides.length === 0 ? (
          <Muted>No rides yet. Driving up? Post one and only {page.name} members will see it.</Muted>
        ) : (
          communityRides.map((r) => (
            <RideCard
              key={r.id}
              ride={r}
              forecast={forecast}
              busyDays={busyDays}
              profileReady={profileReady}
              onNeedsSetup={() => setSetupOpen(true)}
              onChanged={load}
              onMessage={(text, kind = 'success') => setMessage({ text, kind })}
            />
          ))
        )}
      </View>

      <CommunityMembers page={page} me={me} onChanged={load} onMessage={(text, kind) => setMessage(text === null ? null : { text, kind: kind ?? 'success' })} />
    </FormScreen>
  );
}

/** "just now", "3 hours ago", "2 days ago". */
function askedAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function BackLink() {
  const t = useTheme();
  const nav = useNav();
  return (
    <Pressable onPress={() => nav.replace('/communities')} accessibilityRole="link" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
      <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>‹ Communities</Text>
    </Pressable>
  );
}
