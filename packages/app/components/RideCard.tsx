import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { clock, driveText, DOW, isoDay, MON } from '../lib/dates';
import { forecastFor } from '../lib/forecast';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { BoardRide, Forecast } from '../lib/types';
import { useApi, useAuth } from '../providers';
import { Button, Card, TextLink } from './ui';

export function RideCard({
  ride,
  forecast,
  onChanged,
  onMessage,
}: {
  ride: BoardRide;
  forecast: Forecast | null;
  onChanged: () => void;
  onMessage: (text: string, kind?: 'error' | 'success') => void;
}) {
  const t = useTheme();
  const api = useApi();
  const { session } = useAuth();
  const me = session?.userId;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [contact, setContact] = useState<string | null>(null);

  const d = new Date(ride.departAt);
  const day = isoDay(d);
  const resort = RESORT_BY_ID[ride.resortId];
  const mine = ride.driverId === me;
  const riding = !!me && ride.riderIds.includes(me);
  const left = Math.max(0, ride.seatsTotal - ride.seatsTaken);
  const wx = forecastFor(forecast, ride.resortId, day);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      onMessage(success, 'success');
      onChanged();
    } catch (e) {
      onMessage((e as Error).message, 'error');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function showContact() {
    try {
      const c = await api.rideContact(ride.id);
      setContact(c ?? 'Hidden until you have a seat.');
    } catch (e) {
      onMessage((e as Error).message, 'error');
    }
  }

  let action = null;
  if (mine) {
    action = confirmCancel ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small variant="ghost" title="Keep it" onPress={() => setConfirmCancel(false)} />
        <Button
          small
          variant="danger"
          title="Yes, cancel"
          loading={busy}
          onPress={() => run(() => api.cancelRide(ride.id), 'Ride cancelled. Let your riders know.')}
        />
      </View>
    ) : (
      <Button small variant="danger" title="Cancel ride" onPress={() => setConfirmCancel(true)} />
    );
  } else if (riding) {
    action = (
      <Button
        small
        variant="ghost"
        title="Bail on seat"
        loading={busy}
        onPress={() => run(() => api.leaveSeat(ride.id), 'Seat released. Give the driver a heads-up.')}
      />
    );
  } else {
    action = (
      <Button
        small
        title={left === 0 ? 'Full' : 'Call shotgun'}
        disabled={left === 0}
        loading={busy}
        onPress={() => run(() => api.claimSeat(ride.id), `Seat saved. Text ${ride.driverName.split(' ')[0] || 'the driver'} to confirm pickup.`)}
      />
    );
  }

  return (
    <Card highlight={mine} style={{ flexDirection: 'row', overflow: 'hidden' }}>
      {/* Ticket stub */}
      <View
        style={{
          width: 72,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 14,
          borderRightWidth: 2,
          borderRightColor: t.line,
          borderStyle: 'dashed',
        }}
        accessibilityLabel={`${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`}
      >
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>{DOW[d.getDay()].toUpperCase()}</Text>
        <Text style={{ color: t.ink, fontSize: 36, fontWeight: '900', lineHeight: 40 }}>{d.getDate()}</Text>
        <Text style={{ color: t.ink, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>{MON[d.getMonth()].toUpperCase()}</Text>
      </View>

      <View style={{ flex: 1, padding: 14, gap: 8, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase', flexShrink: 1 }}>
            {resort?.name ?? ride.resortId}
          </Text>
          <View style={{ backgroundColor: t.chip, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '800' }}>
              {ride.gasPerRider > 0 ? `$${ride.gasPerRider} gas` : 'Free ride'}
            </Text>
          </View>
        </View>

        <Text style={{ color: t.muted, fontSize: 14 }}>
          Leaves <Text style={{ color: t.ink, fontWeight: '700' }}>{clock(ride.departAt)}</Text> from{' '}
          <Text style={{ color: t.ink, fontWeight: '700' }}>{ride.leaveFrom}</Text>
          {resort ? ` · ${driveText(resort.driveMinutes)} drive` : ''}
        </Text>

        <WeatherChip wx={wx} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: ride.seatsTotal }, (_, i) => {
              const rid = ride.riderIds[i];
              const fill = rid ? (rid === me ? t.accent : t.ink) : 'transparent';
              return (
                <View
                  key={i}
                  style={{
                    width: 15,
                    height: 17,
                    borderRadius: 4,
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                    borderWidth: 2,
                    borderColor: rid === me ? t.accent : t.ink,
                    backgroundColor: fill,
                  }}
                />
              );
            })}
          </View>
          <Text style={{ color: left === 0 ? t.danger : t.ink, fontSize: 13, fontWeight: '700' }}>
            {left === 0 ? 'Full' : `${left} of ${ride.seatsTotal} seat${ride.seatsTotal > 1 ? 's' : ''} open`}
          </Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>· {ride.gear}</Text>
        </View>

        {ride.notes ? <Text style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>{ride.notes}</Text> : null}

        {mine && ride.riderNames.length ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>Riding with you:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ride.riderNames.map((name, i) => (
                <View key={ride.riderIds[i]} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 3 }}>
                  <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>{name || 'Rider'}</Text>
                  <Text
                    onPress={() => run(() => api.removeRider(ride.id, ride.riderIds[i]), `${name || 'Rider'} removed from your ride.`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name}`}
                    style={{ color: t.muted, fontSize: 13, paddingHorizontal: 4 }}
                  >
                    ✕
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            borderTopWidth: 1,
            borderTopColor: t.line,
            paddingTop: 10,
            marginTop: 2,
          }}
        >
          <View style={{ gap: 4, flexShrink: 1 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {mine ? "You're driving" : `Driver: ${ride.driverName || 'A student'}`}
            </Text>
            {(mine || riding) &&
              (contact ? (
                <Text selectable style={{ color: t.ink, fontSize: 14, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>
                  {contact}
                </Text>
              ) : (
                <TextLink onPress={showContact}>{mine ? 'Show my contact' : "Show driver's contact"}</TextLink>
              ))}
          </View>
          {action}
        </View>
      </View>
    </Card>
  );
}

function WeatherChip({ wx }: { wx: ReturnType<typeof forecastFor> }) {
  const t = useTheme();
  if (!wx) {
    return (
      <View style={{ alignSelf: 'flex-start', backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>Forecast not out yet</Text>
      </View>
    );
  }
  const snowy = wx.snowIn >= 0.5;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: snowy ? t.snow + '22' : t.chip,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: snowy ? t.snow : t.muted, fontSize: 13, fontWeight: '700' }}>
        {snowy ? `❄ ${wx.snowIn}" new snow` : wx.precipPct >= 30 ? `${wx.precipPct}% chance of precip` : 'Dry'} · {wx.hi}° / {wx.lo}°
      </Text>
    </View>
  );
}
