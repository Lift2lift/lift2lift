import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { Card, Label } from './ui';
import { mix, useTheme } from '../lib/theme';
import { DOW, clock, longDay } from '../lib/dates';
import { eventDays, isMultiDay } from '../lib/events';
import { RESORT_BY_ID } from '../lib/resorts';
import type { BoardRide, CommunityEvent } from '../lib/types';

function dateLine(e: CommunityEvent): string {
  const days = eventDays(e);
  return days.length > 1 ? `${longDay(days[0])} to ${longDay(days[days.length - 1])}` : longDay(days[0]);
}

function detailLine(e: CommunityEvent): string {
  const lead = e.allDay
    ? ''
    : isMultiDay(e)
      ? `${DOW[new Date(e.startsAt).getDay()]} ${clock(e.startsAt)} to ${DOW[new Date(e.endsAt).getDay()]} ${clock(e.endsAt)}`
      : e.location
        ? `Meet ${clock(e.startsAt)}`
        : clock(e.startsAt);
  const resort = e.resortId ? RESORT_BY_ID[e.resortId]?.name : undefined;
  const showResort = resort && !e.location.toLowerCase().includes(resort.toLowerCase());
  return [lead, e.location, showResort ? resort : ''].filter(Boolean).join(' · ');
}

/** The selected club event: title, when and where, who is going, and the buttons to join or find a ride. */
export function EventHero({
  event,
  kicker,
  rides,
  busy,
  canEdit,
  onToggleIn,
  onOfferRide,
  onEdit,
  onCancel,
  renderRide,
}: {
  event: CommunityEvent;
  kicker: string;
  rides: BoardRide[]; // rides to this event
  busy: boolean;
  canEdit: boolean; // admin and source === 'manual'
  onToggleIn: () => void;
  onOfferRide: () => void;
  onEdit: () => void;
  onCancel: () => void;
  renderRide: (ride: BoardRide) => ReactNode; // the screen supplies a RideCard
}) {
  const t = useTheme();
  const [showRides, setShowRides] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const soft = mix(t.header, t.headerInk, 0.65);
  const edge = mix(t.header, t.headerInk, 0.25);
  const detail = detailLine(event);
  const open = showRides && rides.length > 0;
  const going = `${event.going} going`;
  const goingText = event.iAmIn ? `${going}, including you` : going;

  const btn = {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const small = { minHeight: 44, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: t.header, borderRadius: 16, padding: 22, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Text style={{ color: t.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' }}>{kicker}</Text>
          <Text style={{ color: soft, fontSize: 13, fontWeight: '700' }}>{dateLine(event)}</Text>
        </View>
        <Text accessibilityRole="header" style={{ color: t.headerInk, fontSize: 30, lineHeight: 33, fontWeight: '900', textTransform: 'uppercase' }}>
          {event.title}
        </Text>
        {detail ? <Text style={{ color: soft, fontSize: 15, lineHeight: 21 }}>{detail}</Text> : null}
        {event.source === 'ics' ? <Text style={{ color: soft, fontSize: 13 }}>From club calendar</Text> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, marginTop: 2 }}>
          {event.goingPeople.length ? (
            <View style={{ flexDirection: 'row' }}>
              {event.goingPeople.slice(0, 4).map((p, i) => (
                <View key={p.id} style={{ marginLeft: -8, zIndex: 4 - i }}>
                  <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={26} />
                </View>
              ))}
            </View>
          ) : null}
          <Text style={{ color: t.headerInk, fontSize: 14, fontWeight: '700' }}>{goingText}</Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          <Pressable
            onPress={onToggleIn}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: event.iAmIn, disabled: busy, busy }}
            style={({ pressed }) => ({
              ...btn,
              borderColor: t.accent,
              backgroundColor: event.iAmIn ? 'transparent' : t.accent,
              opacity: busy ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color={event.iAmIn ? t.accent : t.accentInk} />
            ) : (
              <Text style={{ color: event.iAmIn ? t.accent : t.accentInk, fontSize: 15, fontWeight: '800' }}>{event.iAmIn ? 'You are in ✓' : 'I am in'}</Text>
            )}
          </Pressable>
          {rides.length > 0 ? (
            <Pressable
              onPress={() => setShowRides(!showRides)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => ({ ...btn, borderColor: edge, opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ color: t.headerInk, fontSize: 15, fontWeight: '800' }}>{`${open ? 'Hide rides' : 'Find a ride'} · ${rides.length}`}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onOfferRide} accessibilityRole="button" style={({ pressed }) => ({ ...btn, borderColor: edge, opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ color: t.headerInk, fontSize: 15, fontWeight: '800' }}>Offer a ride</Text>
          </Pressable>
        </View>

        {canEdit ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {confirmCancel ? (
              <>
                <Pressable onPress={() => setConfirmCancel(false)} accessibilityRole="button" style={({ pressed }) => ({ ...small, borderColor: edge, opacity: pressed ? 0.85 : 1 })}>
                  <Text style={{ color: t.headerInk, fontSize: 14, fontWeight: '800' }}>Keep it</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setConfirmCancel(false);
                    onCancel();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ ...small, borderColor: t.danger, opacity: pressed ? 0.85 : 1 })}
                >
                  <Text style={{ color: t.danger, fontSize: 14, fontWeight: '800' }}>Yes, cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable onPress={onEdit} accessibilityRole="button" style={({ pressed }) => ({ ...small, borderColor: edge, opacity: pressed ? 0.85 : 1 })}>
                  <Text style={{ color: t.headerInk, fontSize: 14, fontWeight: '800' }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => setConfirmCancel(true)} accessibilityRole="button" style={({ pressed }) => ({ ...small, borderColor: t.danger, opacity: pressed ? 0.85 : 1 })}>
                  <Text style={{ color: t.danger, fontSize: 14, fontWeight: '800' }}>Cancel event</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      {open ? (
        <Card style={{ padding: 16, gap: 10 }}>
          <Label>{`${rides.length} ride${rides.length === 1 ? '' : 's'} to this event`}</Label>
          {rides.map((r) => (
            <View key={r.id}>{renderRide(r)}</View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
