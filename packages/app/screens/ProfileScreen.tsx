import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Button, Card, FormScreen, Label, Loading, Notice } from '../components/ui';
import { SCHOOL_NAME } from '../lib/config';
import { clock, DOW, MON } from '../lib/dates';
import { DISCIPLINE_LABEL, INTEREST_LABEL, PROFILE_PROMPTS } from '../lib/interests';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { ProfilePage } from '../lib/types';
import { useApi, useAuth, useNav } from '../providers';

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

  useEffect(() => {
    if (!id) return;
    api
      .getProfile(id)
      .then((x) => (x ? setP(x) : setError("That profile doesn't exist.")))
      .catch((e: Error) => setError(e.message));
  }, [api, id]);

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
          <View style={{ alignSelf: 'stretch' }}>
            <Button variant="ghost" title="Edit profile" onPress={() => nav.push('/profile/setup')} />
          </View>
        ) : null}
      </View>

      {/* Stats */}
      <Card style={{ flexDirection: 'row', paddingVertical: 14 }}>
        <Stat value={String(p.ridesDriven)} label="Rides driven" />
        <Stat value={String(p.ridesTaken)} label="Rides taken" />
        <Stat value={`${MON[since.getMonth()]} ’${String(since.getFullYear()).slice(2)}`} label="Member since" />
      </Card>

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
