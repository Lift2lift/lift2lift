import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { ClubCalendarCard } from '../components/ClubCalendarCard';
import { CommunityMembers } from '../components/CommunityMembers';
import { EventCalendar } from '../components/EventCalendar';
import { EventForm } from '../components/EventForm';
import { EventHero } from '../components/EventHero';
import { MountainRides } from '../components/MountainRides';
import { RideCard } from '../components/RideCard';
import { SetupModal } from '../components/SetupModal';
import { Button, Card, FormScreen, Label, Loading, Notice } from '../components/ui';
import { addDays, isoDay, longDay, MON, parseDay, timeAgo } from '../lib/dates';
import { dayMarks, eventDays, eventOn, initialDay, isMultiDay, kicker, memberRidesByMountain, nextEvent, ridesForEvent } from '../lib/events';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { busyLegsByDay } from '../lib/trips';
import type { BoardRide, CommunityEvent, CommunityPage, NewCommunityEvent } from '../lib/types';
import { useForecast } from '../lib/useForecast';
import { useApi, useAuth, useNav } from '../providers';
import { CommunityBadge } from './CommunitiesScreen';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** How far ahead the calendar goes. */
const HORIZON_DAYS = 180;

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** "Saturday, Nov 21" */
function weekdayLong(day: string) {
  const d = parseDay(day);
  return `${WEEKDAYS[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** "Nov 21" */
function monthDay(day: string) {
  const d = parseDay(day);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

/**
 * One community. The events view is a calendar of club events with a day panel: the selected day's event
 * (with the rides to it) and the other members-only rides that day, by mountain. Admins add, edit and cancel
 * events and handle requests to join. `view === 'members'` shows the members list, invite code and admin tools.
 */
export function CommunityScreen({ communityId, welcome, view }: { communityId?: string; welcome?: string; view?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const compact = useCompact();
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

  // Events: loaded once for this month through the horizon. The page still works when they fail to load.
  const range = useMemo(() => {
    const now = new Date();
    const last = addDays(now, HORIZON_DAYS);
    const minMonth = firstOfMonth(now);
    return { today: isoDay(now), fromDay: isoDay(minMonth), toDay: isoDay(last), minMonth, maxMonth: firstOfMonth(last) };
  }, []);
  const { today } = range;
  const [events, setEvents] = useState<CommunityEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState<Date>(range.minMonth);
  const [formFor, setFormFor] = useState<null | 'new' | CommunityEvent>(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const opened = useRef(false);

  /** Never throws: a failure shows as `eventsError`. */
  const loadEvents = useCallback(async () => {
    if (!communityId) return;
    try {
      const list = await api.communityEvents(communityId, range.fromDay, range.toDay);
      setEvents(list);
      setEventsError(null);
      // The first load picks the day the page opens on.
      if (!opened.current) {
        opened.current = true;
        const first = initialDay(list, new Date());
        setDay(first);
        setMonth(firstOfMonth(parseDay(first)));
      }
    } catch (e) {
      setEventsError((e as Error).message);
      if (!opened.current) {
        opened.current = true;
        setDay(range.today);
      }
    }
  }, [api, communityId, range]);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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

  const eventList = useMemo(() => events ?? [], [events]);
  const selectedDay = day ?? today;
  const event = useMemo(() => eventOn(eventList, selectedDay), [eventList, selectedDay]);
  const upNext = useMemo(() => nextEvent(eventList, new Date()), [eventList]);
  const marks = useMemo(() => dayMarks(month, eventList, communityRides), [month, eventList, communityRides]);
  const selectedDays = useMemo(() => new Set(event ? eventDays(event) : [selectedDay]), [event, selectedDay]);
  const groups = useMemo(() => memberRidesByMountain(communityRides, selectedDay), [communityRides, selectedDay]);
  const eventRides = useMemo(() => (event ? ridesForEvent(communityRides, event.id) : []), [communityRides, event]);

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

  /** Select a day; a day inside an event selects the event (from its first day, or today if under way). */
  function pick(next: string) {
    const e = eventOn(eventList, next);
    let target = next;
    if (e && isMultiDay(e)) {
      const first = eventDays(e)[0];
      target = first > today ? first : today;
    }
    setDay(target);
    setMonth(firstOfMonth(parseDay(target)));
  }

  async function toggleIn(e: CommunityEvent) {
    const going = !e.iAmIn;
    setRsvpBusy(true);
    setEvents((list) => list && list.map((x) => (x.id === e.id ? { ...x, iAmIn: going, going: x.going + (going ? 1 : -1) } : x)));
    try {
      await api.setEventRsvp(e.id, going);
      await loadEvents();
    } catch (err) {
      await loadEvents();
      setMessage({ text: (err as Error).message, kind: 'error' });
    } finally {
      setRsvpBusy(false);
    }
  }

  /** Rejects with the API's message so the form stays open and shows it; the form closes itself on success. */
  async function saveEvent(input: NewCommunityEvent) {
    if (!communityId) return;
    const editing = formFor && formFor !== 'new' ? formFor : null;
    if (editing) await api.updateCommunityEvent(editing.id, input);
    else await api.createCommunityEvent(communityId, input);
    await loadEvents();
    const first = isoDay(new Date(input.startsAt));
    const target = first > today ? first : today;
    setDay(target);
    setMonth(firstOfMonth(parseDay(target)));
    setMessage({ text: editing ? 'Saved.' : 'Event added.', kind: 'success' });
  }

  function postRide(forEvent: CommunityEvent | null) {
    if (!page) return;
    const params: Record<string, string> = { community: page.id, day: selectedDay };
    if (forEvent) params.event = forEvent.id;
    if (forEvent?.resortId) params.resort = forEvent.resortId;
    nav.push('/post', params);
  }

  const renderRide = (r: BoardRide) => (
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
  );

  if (error) {
    return (
      <FormScreen header={<AppHeader />} wide>
        <BackLink />
        <Notice kind="error">{error}</Notice>
      </FormScreen>
    );
  }
  if (!page || !rides || (view !== 'members' && day === null)) {
    return (
      <FormScreen header={<AppHeader />} wide>
        <BackLink />
        <Loading label="Loading community…" />
      </FormScreen>
    );
  }

  const notice = message ? <Notice kind={message.kind}>{message.text}</Notice> : null;

  if (view === 'members') {
    return (
      <FormScreen header={<AppHeader />} wide>
        <BackLink label={`‹ ${page.name}`} onPress={() => nav.replace('/community', { id: page.id })} />
        {notice}
        <CommunityMembers page={page} me={me} onChanged={load} onMessage={(text, kind) => setMessage(text === null ? null : { text, kind: kind ?? 'success' })}>
          {page.myRole === 'admin' ? <ClubCalendarCard communityId={page.id} onSynced={() => void loadEvents()} /> : null}
        </CommunityMembers>
      </FormScreen>
    );
  }

  return (
    <FormScreen header={<AppHeader />} wide>
      <SetupModal visible={setupOpen} role="rider" profileReady={profileReady} onClose={() => setSetupOpen(false)} />
      {admin ? (
        <EventForm visible={formFor !== null} initial={formFor && formFor !== 'new' ? formFor : undefined} defaultDay={selectedDay} onClose={() => setFormFor(null)} onSave={saveEvent} />
      ) : null}
      <BackLink />

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <CommunityBadge name={page.name} size={56} />
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: 2 }}>
          <Text style={{ color: t.ink, fontSize: 28, fontWeight: '900', textTransform: 'uppercase' }} accessibilityRole="header">
            {page.name}
          </Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            {page.memberCount} {page.memberCount === 1 ? 'member' : 'members'} · {admin ? "You're an admin" : 'Member'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button small variant="ghost" title="Members" onPress={() => nav.push('/community', { id: page.id, view: 'members' })} />
          {admin ? <Button small variant="ghost" title="+ Add event" onPress={() => setFormFor('new')} /> : null}
        </View>
      </View>
      {page.description ? <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{page.description}</Text> : null}

      {notice}
      {eventsError ? <Notice kind="error">{eventsError}</Notice> : null}

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
                    <Text style={{ color: t.muted, fontSize: 12 }}>Asked {timeAgo(q.requestedAt)} · tap to see their profile</Text>
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

      {/* Day panel, then the calendar: side by side when wide, stacked on phones. */}
      <View style={compact ? { gap: 20 } : { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
        <View style={[{ gap: 14, minWidth: 0 }, !compact && { flexGrow: 1, flexShrink: 1, flexBasis: 420 }]}>
          {event ? (
            <EventHero
              event={event}
              kicker={kicker(event, upNext, today)}
              rides={eventRides}
              busy={rsvpBusy}
              canEdit={admin && event.source === 'manual'}
              onToggleIn={() => toggleIn(event)}
              onOfferRide={() => postRide(event)}
              onEdit={() => setFormFor(event)}
              onCancel={() =>
                run(async () => {
                  await api.cancelCommunityEvent(event.id);
                  await Promise.all([loadEvents(), load()]);
                }, 'Event cancelled. Rides to it stay up as member rides.')
              }
              renderRide={renderRide}
            />
          ) : (
            <Label>{weekdayLong(selectedDay)}</Label>
          )}

          <MountainRides title={event ? 'Other member rides' : 'Member rides'} note={`by mountain · ${longDay(selectedDay)}`} groups={groups} renderRide={renderRide} />

          {!event && !groups.length ? (
            <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', gap: 8 }}>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>Nothing on yet</Text>
              <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>
                Driving up? Post a ride and only {page.name} members will see it.
              </Text>
              <View style={{ marginTop: 6 }}>
                <Button small title={`+ Post a ride for ${monthDay(selectedDay)}`} onPress={() => postRide(null)} />
              </View>
            </View>
          ) : null}
        </View>

        <View style={compact ? undefined : { flexGrow: 1, flexShrink: 1, flexBasis: 340, maxWidth: 380 }}>
          <EventCalendar
            month={month}
            onMonth={setMonth}
            minMonth={range.minMonth}
            maxMonth={range.maxMonth}
            marks={marks}
            selectedDays={selectedDays}
            today={today}
            onPick={pick}
          />
        </View>
      </View>
    </FormScreen>
  );
}

function BackLink({ label = '‹ Communities', onPress }: { label?: string; onPress?: () => void }) {
  const t = useTheme();
  const nav = useNav();
  return (
    <Pressable onPress={onPress ?? (() => nav.replace('/communities'))} accessibilityRole="link" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
      <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
