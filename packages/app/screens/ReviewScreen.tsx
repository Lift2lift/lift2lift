import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { StarInput } from '../components/Stars';
import { Button, Card, Field, FormScreen, Heading, Loading, Muted, Notice } from '../components/ui';
import { longDay } from '../lib/dates';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { PendingReview } from '../lib/types';
import { useApi, useNav } from '../providers';

type Draft = { driving: number; experience: number; body: string };
const EMPTY: Draft = { driving: 0, experience: 0, body: '' };

/**
 * Review a finished ride: the driver (driving + experience) and each other
 * passenger (experience). Text is optional. People left unrated can be
 * reviewed later, until reviews close 14 days after the ride.
 */
export function ReviewScreen({ rideId }: { rideId?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const [pending, setPending] = useState<PendingReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    api
      .reviewsToWrite()
      .then(setPending)
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const ride = pending ? (rideId ? pending.find((p) => p.rideId === rideId) : pending[0]) : null;
  const draft = (id: string) => drafts[id] ?? EMPTY;
  const update = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));

  async function submit() {
    if (!ride) return;
    setError(null);
    const ready = ride.people.filter((p) => {
      const d = draft(p.id);
      return d.experience > 0 && (p.role !== 'driver' || d.driving > 0);
    });
    const half = ride.people.find((p) => p.role === 'driver' && (draft(p.id).experience > 0) !== (draft(p.id).driving > 0));
    if (half) return setError(`Give ${half.name.split(' ')[0] || 'the driver'} both ratings, driving and experience.`);
    if (!ready.length) return setError('Rate at least one person.');
    setSaving(true);
    try {
      for (const p of ready) {
        const d = draft(p.id);
        await api.submitReview({ rideId: ride.rideId, revieweeId: p.id, experience: d.experience, driving: p.role === 'driver' ? d.driving : null, body: d.body });
        setDone((x) => [...x, p.id]);
      }
      nav.replace('/', { reviewed: '1' });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  if (error && !pending) {
    return (
      <FormScreen header={<AppHeader />}>
        <Notice kind="error">{error}</Notice>
      </FormScreen>
    );
  }
  if (!pending) {
    return (
      <FormScreen header={<AppHeader />}>
        <Loading label="Loading…" />
      </FormScreen>
    );
  }
  if (!ride) {
    return (
      <FormScreen header={<AppHeader />}>
        <Heading title="All caught up" subtitle="You've reviewed everyone from your recent rides." />
        <Button title="Back to rides" onPress={() => nav.replace('/')} />
      </FormScreen>
    );
  }

  const resort = RESORT_BY_ID[ride.resortId]?.name ?? ride.resortId;
  const people = ride.people.filter((p) => !done.includes(p.id));

  return (
    <FormScreen header={<AppHeader />}>
      <Heading title={`How was ${resort}?`} subtitle={`${longDay(ride.departAt.slice(0, 10))}. Tap or slide across the stars; half stars work. Reviews close ${longDay(ride.closesAt.slice(0, 10))}.`} />

      {people.map((p) => {
        const d = draft(p.id);
        const first = p.name.split(' ')[0] || (p.role === 'driver' ? 'your driver' : 'them');
        return (
          <Card key={p.id} style={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{p.name || 'Lift2Lift member'}</Text>
                <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700' }}>{p.role === 'driver' ? 'DRIVER' : 'FELLOW PASSENGER'}</Text>
              </View>
            </View>

            {p.role === 'driver' ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>Driving</Text>
                <Muted>Safe and confident on the road, ready for the conditions, on time.</Muted>
                <StarInput label={`Rate ${first}'s driving`} value={d.driving} onChange={(v) => update(p.id, { driving: v })} />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>{p.role === 'driver' ? 'Experience' : 'Experience with ' + first}</Text>
              <Muted>{p.role === 'driver' ? 'Friendly, easy to coordinate with, good company for the drive.' : 'On time, respectful, good company in the car.'}</Muted>
              <StarInput label={`Rate your experience with ${first}`} value={d.experience} onChange={(v) => update(p.id, { experience: v })} />
            </View>

            <Field
              label="Review (optional)"
              value={d.body}
              onChangeText={(x) => update(p.id, { body: x })}
              placeholder={p.role === 'driver' ? 'How was the drive?' : `What was ${first} like to ride with?`}
              multiline
              maxLength={1000}
              hint="Shown on their profile with your name and photo."
            />
          </Card>
        );
      })}

      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button title="Post reviews" loading={saving} onPress={submit} />
      <Muted center>Reviews can't be edited after you post them. Anyone you skip, you can still review until reviews close.</Muted>
    </FormScreen>
  );
}
