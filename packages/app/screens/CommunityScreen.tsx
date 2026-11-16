import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { RideCard } from '../components/RideCard';
import { SetupModal } from '../components/SetupModal';
import { Button, Card, Field, FormScreen, Label, Loading, Muted, Notice } from '../components/ui';
import { formatCode, shareOrCopy } from '../lib/communities';
import { useTheme } from '../lib/theme';
import { busyLegsByDay } from '../lib/trips';
import type { BoardRide, CommunityMember, CommunityPage } from '../lib/types';
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

  // Admin tools
  const admin = page?.myRole === 'admin';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirm, setConfirm] = useState<null | 'code' | 'leave' | { remove: CommunityMember }>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage({ text: done, kind: 'success' });
      setConfirm(null);
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

  const otherAdmins = page.members.filter((m) => m.role === 'admin' && m.id !== me).length;

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

      {/* The invite code: admins only. */}
      {admin && page.code ? (
        <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>INVITE CODE · ONLY ADMINS SEE THIS</Text>
            <Text selectable style={{ color: t.ink, fontSize: 24, fontWeight: '900', letterSpacing: 3 }}>
              {formatCode(page.code)}
            </Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>Send it to people you want in. Anyone with the code can join.</Text>
          </View>
          <Button
            small
            variant="ghost"
            title="Send invite"
            onPress={async () => {
              const r = await shareOrCopy(`Join ${page.name} on Lift2Lift: open the Communities tab and enter ${formatCode(page.code!)}`);
              if (r === 'copied') setMessage({ text: 'Copied the invite. Paste it into your club chat or a text.', kind: 'success' });
              else if (r === 'failed') setMessage({ text: `Couldn't share. The code is ${formatCode(page.code!)}.`, kind: 'error' });
            }}
          />
        </Card>
      ) : null}

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

      {/* Members */}
      <View style={{ gap: 8 }}>
        <Label>{`Members · ${page.memberCount}`}</Label>
        <Card style={{ padding: 0 }}>
          {page.members.map((m, i) => (
            <View key={m.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => nav.push('/u', { id: m.id })}
                  accessibilityRole="link"
                  accessibilityLabel={`${m.name || 'Member'}${m.role === 'admin' ? ', admin' : ''}. Open profile`}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 150, opacity: pressed ? 0.7 : 1 })}
                >
                  <Avatar uri={m.avatarUrl} name={m.name} gender={m.gender} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>
                      {m.name || 'Lift2Lift member'}
                      {m.id === me ? <Text style={{ color: t.muted, fontWeight: '500' }}> (you)</Text> : null}
                    </Text>
                    <Text style={{ color: m.role === 'admin' ? t.ink : t.muted, fontSize: 12, fontWeight: m.role === 'admin' ? '800' : '500' }}>
                      {m.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </Pressable>
                {admin && m.id !== me ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button
                      small
                      variant="ghost"
                      title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                      onPress={() =>
                        run(async () => {
                          await api.setCommunityRole(page.id, m.id, m.role === 'admin' ? 'member' : 'admin');
                          await load();
                        }, m.role === 'admin' ? `${m.name.split(' ')[0]} is a member now.` : `${m.name.split(' ')[0]} is now an admin.`)
                      }
                    />
                    {m.role === 'member' ? <Button small variant="ghost" title="Remove" onPress={() => setConfirm({ remove: m })} /> : null}
                  </View>
                ) : null}
              </View>
              {confirm && typeof confirm === 'object' && confirm.remove.id === m.id ? (
                <View style={{ gap: 8 }}>
                  <Notice kind="error">Remove {m.name.split(' ')[0]} from {page.name}? They stop seeing its rides, and they'd need the code to come back.</Notice>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button small variant="ghost" title="Keep" onPress={() => setConfirm(null)} />
                    <Button
                      small
                      variant="danger"
                      title="Remove"
                      loading={busy}
                      onPress={() =>
                        run(async () => {
                          await api.removeCommunityMember(page.id, m.id);
                          await load();
                        }, `Removed ${m.name.split(' ')[0]}.`)
                      }
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      </View>

      {/* Admin tools */}
      {admin ? (
        <View style={{ gap: 8 }}>
          <Label>Admin</Label>
          {editing ? (
            <Card style={{ padding: 14, gap: 12 }}>
              <Field label="Name" value={name} onChangeText={setName} maxLength={40} />
              <Field label="Description" value={description} onChangeText={setDescription} maxLength={280} multiline />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Button small variant="ghost" title="Cancel" onPress={() => setEditing(false)} />
                <Button
                  small
                  title="Save"
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      await api.updateCommunity(page.id, name.trim(), description.trim());
                      setEditing(false);
                      await load();
                    }, 'Saved.')
                  }
                />
              </View>
            </Card>
          ) : confirm === 'code' ? (
            <View style={{ gap: 8 }}>
              <Notice kind="error">Make a new code? The current code stops working right away. Everyone already in stays in.</Notice>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small variant="ghost" title="Keep this code" onPress={() => setConfirm(null)} />
                <Button
                  small
                  variant="danger"
                  title="Make a new code"
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      const c = await api.resetCommunityCode(page.id);
                      await load();
                      setMessage({ text: `New code: ${formatCode(c)}. Send it to anyone who still needs to join.`, kind: 'success' });
                    })
                  }
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
              {page.listed
                ? 'Listed in Popular communities: anyone on Lift2Lift can see its name and ask to join. You approve each request.'
                : 'Hidden from Popular communities: people can only join with your invite code.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button
                small
                variant="ghost"
                title={page.listed ? 'Hide from Popular' : 'Show in Popular'}
                loading={busy}
                onPress={() =>
                  run(async () => {
                    await api.setCommunityListed(page.id, !page.listed);
                    await load();
                  }, page.listed ? 'Hidden from Popular communities.' : 'Listed in Popular communities.')
                }
              />
              <Button
                small
                variant="ghost"
                title="Edit name and description"
                onPress={() => {
                  setName(page.name);
                  setDescription(page.description);
                  setEditing(true);
                }}
              />
              <Button small variant="ghost" title="Make a new code" onPress={() => setConfirm('code')} />
            </View>
            </View>
          )}
        </View>
      ) : null}

      {/* Leave */}
      {confirm === 'leave' ? (
        <View style={{ gap: 8 }}>
          <Notice kind="error">
            {`Leave ${page.name}? You'll stop seeing its rides (except ones you're booked on).`}
            {admin && !otherAdmins && page.memberCount > 1 ? ' The longest-standing member becomes admin.' : ''}
          </Notice>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small variant="ghost" title="Stay" onPress={() => setConfirm(null)} />
            <Button
              small
              variant="danger"
              title="Leave community"
              loading={busy}
              onPress={() =>
                run(async () => {
                  await api.leaveCommunity(page.id);
                  nav.replace('/communities');
                })
              }
            />
          </View>
        </View>
      ) : (
        <Text style={{ textAlign: 'center' }}>
          <Text onPress={() => setConfirm('leave')} accessibilityRole="button" style={{ color: t.danger, fontSize: 14, fontWeight: '700' }}>
            Leave community
          </Text>
        </Text>
      )}
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
