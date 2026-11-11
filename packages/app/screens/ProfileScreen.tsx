import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Stars } from '../components/Stars';
import { ProfileSafetyActions, ReportSheet } from '../components/Safety';
import { Button, Card, FormScreen, Label, Loading, Notice } from '../components/ui';
import { SCHOOL_NAME } from '../lib/config';
import { clock, DOW, MON } from '../lib/dates';
import { DISCIPLINE_LABEL, INTEREST_LABEL, PROFILE_PROMPTS } from '../lib/interests';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { FriendState, ProfileFriends, ProfilePage, RatingSummary, Review } from '../lib/types';
import { useApi, useAuth, useNav } from '../providers';
import { FriendButton, FriendsStrip } from './FriendsScreen';

/** A link to another website: a real link on the web, the system browser on iOS. */
function ExternalLink({ href, children }: { href: string; children: string }) {
  const t = useTheme();
  const style = { color: t.link, fontSize: 15, fontWeight: '700' as const };
  if (Platform.OS === 'web') {
    const webProps = { href, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as object;
    return (
      <Text accessibilityRole="link" style={style} {...webProps}>
        {children}
      </Text>
    );
  }
  return (
    <Text accessibilityRole="link" style={style} onPress={() => Linking.openURL(href)}>
      {children}
    </Text>
  );
}

function Badge({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.okBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: t.ok, fontSize: 13, fontWeight: '800' }}>✓ {label}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function ScoreRow({ label, value, count }: { label: string; value: number | null; count: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 6 }}>
      <Text style={{ color: t.ink, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{label}</Text>
      {count && value != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Stars value={value} size={18} />
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800', minWidth: 30, textAlign: 'right' }}>{value.toFixed(1)}</Text>
        </View>
      ) : (
        <Text style={{ color: t.muted, fontSize: 14 }}>No ratings yet</Text>
      )}
    </View>
  );
}

function RatingsSection({
  data,
  first,
  tab,
  setTab,
}: {
  data: { summary: RatingSummary; reviews: Review[] };
  first: string;
  tab: 'all' | 'driver' | 'passenger';
  setTab: (t: 'all' | 'driver' | 'passenger') => void;
}) {
  const t = useTheme();
  const nav = useNav();
  const { session } = useAuth();
  const [reporting, setReporting] = useState<Review | null>(null);
  const s = data.summary;
  const shown = data.reviews.filter((r) => tab === 'all' || r.role === tab);
  const tabs: { id: typeof tab; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: data.reviews.length },
    { id: 'driver', label: 'As driver', n: s.driverCount },
    { id: 'passenger', label: 'As passenger', n: s.passengerCount },
  ];
  return (
    <View style={{ gap: 10 }}>
      <Label>Ratings</Label>
      <Card style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: 4 }}>
          AS A DRIVER · {s.driverCount} REVIEW{s.driverCount === 1 ? '' : 'S'}
        </Text>
        <ScoreRow label="Driving" value={s.drivingAvg} count={s.driverCount} />
        <ScoreRow label="Experience" value={s.driverExperienceAvg} count={s.driverCount} />
        <View style={{ height: 1, backgroundColor: t.line, marginVertical: 6 }} />
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }}>
          AS A PASSENGER · {s.passengerCount} REVIEW{s.passengerCount === 1 ? '' : 'S'}
        </Text>
        <ScoreRow label="Experience" value={s.passengerAvg} count={s.passengerCount} />
      </Card>

      {data.reviews.length ? (
        <>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {tabs.map((x) => (
              <Pressable
                key={x.id}
                onPress={() => setTab(x.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === x.id }}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: tab === x.id ? t.ink : t.line, backgroundColor: tab === x.id ? t.ink : t.surface, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: tab === x.id ? t.bg : t.ink, fontSize: 13, fontWeight: '700' }}>
                  {x.label} <Text style={{ opacity: 0.65 }}>{x.n}</Text>
                </Text>
              </Pressable>
            ))}
          </View>
          {shown.length === 0 ? <Text style={{ color: t.muted, fontSize: 14 }}>No reviews here yet.</Text> : null}
          {shown.map((r) => {
            const d = new Date(r.createdAt);
            return (
              <Card key={r.id} style={{ padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pressable onPress={() => nav.push('/u', { id: r.reviewerId })} accessibilityRole="link" accessibilityLabel={`${r.reviewerName}'s profile`}>
                    <Avatar uri={r.reviewerAvatarUrl} name={r.reviewerName} gender={r.reviewerGender} size={38} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>{r.reviewerName || 'Lift2Lift member'}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {MON[d.getMonth()]} {d.getFullYear()} · {RESORT_BY_ID[r.resortId]?.name ?? r.resortId} · {first} was the {r.role}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                  {r.driving != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700' }}>DRIVING</Text>
                      <Stars value={r.driving} size={14} />
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700' }}>EXPERIENCE</Text>
                    <Stars value={r.experience} size={14} />
                  </View>
                </View>
                {r.body ? <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{r.body}</Text> : null}
                {r.reviewerId !== session?.userId ? (
                  <Pressable onPress={() => setReporting(r)} accessibilityRole="button" accessibilityLabel={`Report ${r.reviewerName}'s review`} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
                    <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>Report review</Text>
                  </Pressable>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}
      {reporting ? (
        <ReportSheet
          visible
          onClose={() => setReporting(null)}
          userId={reporting.reviewerId}
          name={reporting.reviewerName}
          kind="review"
          targetId={reporting.id}
        />
      ) : null}
    </View>
  );
}

/**
 * Profile page, laid out like a CorePower teacher page: big photo, name and
 * home mountain, the person's rides, a short bio, quick Q&A, and badges.
 * No userId = your own profile.
 */
export function ProfileScreen({ userId }: { userId?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const id = userId || session?.userId;
  const mine = !!session && id === session.userId;
  const [p, setP] = useState<ProfilePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<{ summary: RatingSummary; reviews: Review[] } | null>(null);
  const [tab, setTab] = useState<'all' | 'driver' | 'passenger'>('all');
  const [friends, setFriends] = useState<ProfileFriends | null>(null);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    if (!id) return;
    api.profileFriends(id).then(setFriends).catch(() => {});
  }, [api, id]);
  useEffect(() => {
    if (!mine) return;
    api.myFriends().then((f) => setRequests(f.incoming.length)).catch(() => {});
  }, [api, mine]);
  const setFriendState = (state: FriendState) => {
    setFriends((f) => (f ? { ...f, state } : f));
    if (id) api.profileFriends(id).then(setFriends).catch(() => {});
  };

  useEffect(() => {
    if (!id) return;
    api.getReviews(id).then(setRatings).catch(() => {});
  }, [api, id]);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!id) return;
    api
      .getProfile(id)
      .then((x) => (x ? setP(x) : setError("That profile doesn't exist.")))
      .catch((e: Error) => setError(e.message));
  }, [api, id, reload]);
  const [unblocking, setUnblocking] = useState(false);

  if (error) {
    return (
      <FormScreen header={<AppHeader />}>
        <Notice kind="error">{error}</Notice>
        <Button variant="ghost" title="Back to rides" onPress={() => nav.replace('/')} />
      </FormScreen>
    );
  }
  if (!p) {
    return (
      <FormScreen header={<AppHeader />}>
        <Loading label="Loading profile…" />
      </FormScreen>
    );
  }

  const home = p.homeResortId ? RESORT_BY_ID[p.homeResortId]?.name : null;
  const since = new Date(p.memberSince);
  const prompts = PROFILE_PROMPTS.filter((q) => p.prompts[q.key]);
  const first = p.fullName.split(' ')[0] || 'They';

  if (p.blockedByMe) {
    return (
      <FormScreen header={<AppHeader />}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900', textAlign: 'center' }}>{p.fullName || 'Lift2Lift member'}</Text>
          <Text style={{ color: t.muted, fontSize: 15, textAlign: 'center' }}>
            You blocked {first}. You don't see each other's rides, messages or reviews.
          </Text>
        </View>
        <Button
          variant="ghost"
          title={`Unblock ${first}`}
          loading={unblocking}
          onPress={async () => {
            setUnblocking(true);
            try {
              await api.unblockUser(p.id);
              setReload((n) => n + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setUnblocking(false);
            }
          }}
        />
        <Button variant="ghost" title="Back to rides" onPress={() => nav.replace('/')} />
      </FormScreen>
    );
  }

  return (
    <FormScreen header={<AppHeader />}>
      {mine && !p.profileComplete ? (
        <Notice kind="info">Your profile isn't finished yet. Finish it to post rides and call shotgun.</Notice>
      ) : null}

      {/* Header: photo, name, home mountain */}
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Avatar uri={p.avatarUrl} name={p.fullName} gender={p.gender} size={148} />
        <Text style={{ color: t.ink, fontSize: 30, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }}>{p.fullName || 'Lift2Lift member'}</Text>
        <Text style={{ color: t.muted, fontSize: 15, textAlign: 'center' }}>
          {[home ? `Home mountain: ${home}` : null, p.discipline ? DISCIPLINE_LABEL[p.discipline] : null].filter(Boolean).join(' · ')}
        </Text>
        {p.schoolYear || p.hometown ? (
          <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center' }}>{[p.schoolYear, p.hometown ? `From ${p.hometown}` : null].filter(Boolean).join(' · ')}</Text>
        ) : null}
        {p.instagram ? <ExternalLink href={`https://www.instagram.com/${encodeURIComponent(p.instagram)}/`}>{`@${p.instagram} on Instagram`}</ExternalLink> : null}
        {mine ? (
          <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" title="Edit profile" onPress={() => nav.push('/profile/setup')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" title="Account settings" onPress={() => nav.push('/account')} />
            </View>
          </View>
        ) : friends ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <FriendButton userId={p.id} state={friends.state} onChange={setFriendState} />
            {friends.state === 'received' ? <Text style={{ color: t.muted, fontSize: 13 }}>{first} sent you a friend request.</Text> : null}
          </View>
        ) : null}
        {!mine ? <ProfileSafetyActions userId={p.id} name={p.fullName} onBlocked={() => setReload((n) => n + 1)} /> : null}
      </View>

      {mine && requests ? (
        <Pressable
          onPress={() => nav.push('/friends')}
          accessibilityRole="button"
          style={({ pressed }) => ({ backgroundColor: t.surface, borderColor: t.accent, borderWidth: 2, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 })}
        >
          <View style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 6, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.accentInk, fontWeight: '900' }}>{requests}</Text>
          </View>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800', flex: 1 }}>
            {requests === 1 ? 'Friend request waiting' : 'Friend requests waiting'}
          </Text>
          <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
        </Pressable>
      ) : null}

      {/* Only until you're verified to drive */}
      {mine && p.profileComplete && !p.driverVerified ? (
        <Pressable
          onPress={() => nav.push('/account/driver')}
          accessibilityRole="button"
          style={({ pressed }) => ({ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>Get verified to drive</Text>
            <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>Scan your insurance card to post rides. Takes about a minute.</Text>
          </View>
          <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
        </Pressable>
      ) : null}

      {/* Stats */}
      <Card style={{ flexDirection: 'row', paddingVertical: 14 }}>
        <Stat value={String(p.ridesDriven)} label="Rides driven" />
        <Stat value={String(p.ridesTaken)} label="Rides taken" />
        <Stat value={`${MON[since.getMonth()]} ’${String(since.getFullYear()).slice(2)}`} label="Member since" />
      </Card>

      {friends ? <FriendsStrip friends={friends.friends} count={friends.count} mutual={friends.mutual} mine={mine} first={first} /> : null}

      {/* Ratings */}
      {ratings ? <RatingsSection data={ratings} first={first} tab={tab} setTab={setTab} /> : null}

      {/* Upcoming rides (CorePower's "See my classes") */}
      <View style={{ gap: 8 }}>
        <Label>{mine ? 'Your upcoming rides' : `${first}'s upcoming rides`}</Label>
        {p.upcoming.length === 0 ? (
          <Text style={{ color: t.muted, fontSize: 14 }}>{mine ? "You haven't posted any upcoming rides." : 'No upcoming rides posted.'}</Text>
        ) : (
          <Card>
            {p.upcoming.map((r, i) => {
              const d = new Date(r.departAt);
              const left = Math.max(0, r.seatsTotal - r.seatsTaken);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => nav.replace('/', { resort: r.resortId })}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 14,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: t.line,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ width: 46, alignItems: 'center' }}>
                    <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800' }}>{DOW[d.getDay()].toUpperCase()}</Text>
                    <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>{d.getDate()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{RESORT_BY_ID[r.resortId]?.name ?? r.resortId}</Text>
                    <Text style={{ color: t.muted, fontSize: 13 }}>
                      {MON[d.getMonth()]} {d.getDate()} · leaves {clock(r.departAt)} · {left === 0 ? 'full' : `${left} seat${left > 1 ? 's' : ''} open`}
                    </Text>
                  </View>
                  <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>

      {/* About */}
      {p.bio ? (
        <View style={{ gap: 8 }}>
          <Label>About</Label>
          <Text style={{ color: t.ink, fontSize: 16, lineHeight: 24 }}>{p.bio}</Text>
        </View>
      ) : null}

      {/* Quick Q&A */}
      {prompts.length ? (
        <View style={{ gap: 12 }}>
          <Label>The quick ones</Label>
          {prompts.map((q) => (
            <View key={q.key} style={{ gap: 2 }}>
              <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>{q.question}</Text>
              <Text style={{ color: t.ink, fontSize: 16 }}>{p.prompts[q.key]}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Interests */}
      {p.interests.length ? (
        <View style={{ gap: 8 }}>
          <Label>Interests</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {p.interests.map((i) => (
              <View key={i} style={{ backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>{INTEREST_LABEL[i] ?? i}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Verified (CorePower's "Certifications") */}
      <View style={{ gap: 8 }}>
        <Label>Verified</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Badge label={`${SCHOOL_NAME} student`} />
          {p.idVerified ? <Badge label="ID verified · photo matches license" /> : null}
          {p.driverVerified ? <Badge label="Insurance on file" /> : null}
        </View>
        {!p.idVerified ? <Text style={{ color: t.muted, fontSize: 13 }}>ID not verified yet.</Text> : null}
      </View>
    </FormScreen>
  );
}
