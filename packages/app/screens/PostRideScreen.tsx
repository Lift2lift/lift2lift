import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { SetupModal } from '../components/SetupModal';
import { DayPicker } from '../components/Pickers';
import { Button, Chip, ChipRow, Field, FormScreen, Heading, Label, Loading, Notice } from '../components/ui';
import { GEAR_OPTIONS, PICKUP_SPOTS } from '../lib/config';
import { addDays, clockFromHHMM, dayLabel, driveText, isoDay, longDay, nextSaturday, toISO } from '../lib/dates';
import { forecastFor } from '../lib/forecast';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { CARPOOL_DISCLAIMER, earliestDeparture, MAX_PASSENGERS, maxGasPerRider, mileageCents, tripGasCap } from '../lib/rules';
import { oneWayShare, TRIP_LABEL } from '../lib/trips';
import type { EditableRide, TripType } from '../lib/types';
import { useTheme } from '../lib/theme';
import { useForecast } from '../lib/useForecast';
import { canHost, type DriverVerification } from '../lib/types';
import { useApi, useAuth, useMyRides, useNav } from '../providers';

const RETURN_TIMES = ['12:00', '13:00', '14:00', '15:00', '15:30', '16:00', '16:30', '17:00', '18:00', '20:00'];
const TIMES = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '15:00', '16:00'];
const GAS_STEP = 5;
const SEAT_OPTIONS = Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1);
const NEARBY = 12; // closest mountains shown before "All mountains"
const DAYS_AHEAD = 60; // how far out a ride can be posted
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Post a ride, or edit one you posted (`editRideId`). */
export function PostRideScreen({ initialResort, editRideId }: { initialResort?: string; editRideId?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const { forecast } = useForecast();
  const { refresh: refreshMyRides } = useMyRides();
  const today = isoDay(new Date());
  const lastDay = isoDay(addDays(new Date(), DAYS_AHEAD));

  const [resortId, setResortId] = useState(initialResort && RESORT_BY_ID[initialResort] ? initialResort : '');
  const [day, setDay] = useState(nextSaturday());
  const [tripType, setTripType] = useState<TripType>('round_trip');
  const [time, setTime] = useState('06:30');
  const [returnTime, setReturnTime] = useState('16:00');
  const [returnMeet, setReturnMeet] = useState('');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [seats, setSeats] = useState(3);
  const [gas, setGas] = useState(15);
  const [gear, setGear] = useState(GEAR_OPTIONS[0]);
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [allMountains, setAllMountains] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editing: load the ride, then lock what booked riders signed up for.
  const [original, setOriginal] = useState<EditableRide | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!editRideId) return;
    api
      .rideForEdit(editRideId)
      .then((r) => {
        if (!r) return setEditError("This ride can't be edited. It may have been cancelled, or it isn't yours.");
        setOriginal(r);
        setResortId(r.resortId);
        setDay(isoDay(new Date(r.departAt)));
        setTripType(r.tripType);
        setTime(hhmm(r.departAt));
        if (r.returnAt) setReturnTime(hhmm(r.returnAt));
        setReturnMeet(r.returnMeet);
        setLeaveFrom(r.leaveFrom);
        setSeats(r.seatsTotal);
        setGas(r.gasPerRider);
        setGear(r.gear || GEAR_OPTIONS[0]);
        setContact(r.contact);
        setNotes(r.notes);
      })
      .catch((e: Error) => setEditError(e.message));
  }, [api, editRideId]);
  const editing = !!editRideId;
  const booked = !!original && original.riders > 0;
  const minSeats = original ? Math.max(1, original.seatsTakenTo, original.seatsTakenFrom) : 1;

  // First time hosting? Drivers need a finished profile and insurance on file.
  const [verification, setVerification] = useState<DriverVerification | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [verificationChecked, setVerificationChecked] = useState(false);
  useEffect(() => {
    if (!session) return;
    Promise.all([api.getDriverVerification(), api.getProfile(session.userId)])
      .then(([ver, prof]) => {
        setVerification(ver);
        setProfileReady(!!prof?.profileComplete);
      })
      .catch(() => {})
      .finally(() => setVerificationChecked(true));
  }, [api, session]);
  const needsVerification = !editing && verificationChecked && (!profileReady || !canHost(verification));

  // Days this person already drives or rides (one ride per person per day).
  const [busyDays, setBusyDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    const me = session?.userId;
    if (!me) return;
    api
      .listRides()
      .then((rides) => setBusyDays(new Set(rides.filter((r) => r.id !== editRideId && (r.driverId === me || r.riderIds.includes(me))).map((r) => r.rideDate))))
      .catch(() => {});
  }, [api, session?.userId, editRideId]);

  const wx = resortId ? forecastFor(forecast, resortId, day) : null;

  // Departures have to be at least 2 hours out so riders can book ahead.
  const earliest = earliestDeparture();
  // When editing, the current time stays available even inside the 2-hour window (it isn't changing).
  const keepTime = original && day === isoDay(new Date(original.departAt)) ? hhmm(original.departAt) : null;
  const validTimes = [...new Set([...TIMES, ...(keepTime ? [keepTime] : [])])]
    .sort()
    .filter((tm) => tm === keepTime || new Date(toISO(day, tm)) >= earliest);
  const timeValue = validTimes.includes(time) ? time : validTimes[0];

  // Colorado gas cap for this trip, and the most each rider can be asked for.
  const sampleDepart = toISO(day, timeValue ?? '06:30');
  const cap = resortId ? tripGasCap(resortId, sampleDepart, tripType) : 0;
  const maxPer = resortId ? maxGasPerRider(resortId, sampleDepart, seats, tripType) : 0;
  const keepReturn = original?.returnAt ? hhmm(original.returnAt) : null;
  const validReturns = [...new Set([...RETURN_TIMES, ...(keepReturn ? [keepReturn] : [])])].sort().filter((tm) => tm > (timeValue ?? '00:00'));
  const returnValue = validReturns.includes(returnTime) ? returnTime : validReturns[validReturns.length - 1];
  const gasValue = resortId ? Math.min(gas, maxPer) : gas;
  const gasOptions = useMemo(() => {
    if (!resortId) return [0, 5, 10, 15, 20];
    const opts: number[] = [];
    // Once riders are booked, gas money can only go down.
    const top = booked && original ? Math.min(maxPer, original.gasPerRider) : maxPer;
    for (let g = 0; g <= top; g += GAS_STEP) opts.push(g);
    if (top % GAS_STEP !== 0) opts.push(top);
    return opts;
  }, [resortId, maxPer, booked, original]);
  const busy = busyDays.has(day);

  async function submit() {
    setError(null);
    if (!resortId) return setError('Pick a mountain.');
    if (busy) return setError('You already have a ride that day. It\'s one ride per person per day, so pick another day.');
    if (!timeValue) return setError('Rides have to leave at least 2 hours from now. Pick a later day.');
    const departAt = toISO(day, timeValue);
    if (timeValue !== keepTime && new Date(departAt) < earliestDeparture()) return setError('Rides have to leave at least 2 hours from now so riders can book ahead.');
    if (!leaveFrom.trim()) return setError("Add where you're leaving from so riders know where to meet.");
    if (!contact.trim()) return setError('Add a phone number or handle so riders can reach you.');
    if (tripType === 'round_trip' && !returnValue) return setError('Pick a time for the ride back.');
    setSaving(true);
    try {
      const ride = {
        resortId,
        tripType,
        departAt,
        returnAt: tripType === 'round_trip' && returnValue ? toISO(day, returnValue) : null,
        returnMeet: tripType === 'round_trip' ? (returnMeet.trim() || `${RESORT_BY_ID[resortId].name} base area`).slice(0, 80) : '',
        leaveFrom: leaveFrom.trim().slice(0, 80),
        seatsTotal: seats,
        gasPerRider: gasValue,
        gear,
        notes: notes.trim().slice(0, 280),
        contact: contact.trim().slice(0, 60),
      };
      if (editRideId) {
        // Keep the exact original times when the picker didn't change them.
        if (original && timeValue === keepTime) ride.departAt = original.departAt;
        if (original?.returnAt && returnValue === keepReturn && ride.returnAt) ride.returnAt = original.returnAt;
        await api.updateRide(editRideId, ride);
        await refreshMyRides();
        nav.replace('/rides', { saved: editRideId });
        return;
      }
      await api.postRide(ride);
      refreshMyRides();
      nav.replace('/', { resort: resortId, day });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <FormScreen header={<AppHeader />}>
      <SetupModal visible={needsVerification} role="driver" profileReady={profileReady} onClose={() => nav.back()} />

      {editing ? (
        <Heading
          title="Edit ride"
          subtitle={booked ? `${original!.riders} ${original!.riders === 1 ? 'rider is' : 'riders are'} booked. They'll see your changes in the ride chat and get a notification.` : 'Nobody has booked yet, so you can change anything.'}
        />
      ) : (
        <Heading title="Post a ride" subtitle="Riders see this on the board. Only people who claim a seat see how to reach you." />
      )}
      {editError ? (
        <>
          <Notice kind="error">{editError}</Notice>
          <Button variant="ghost" title="Back to Your Rides" onPress={() => nav.replace('/rides')} />
        </>
      ) : editing && !original ? (
        <Loading label="Loading your ride…" />
      ) : (
      <>

      <View style={{ gap: 8 }}>
        <Label>Mountain</Label>
        {booked ? (
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>
            {RESORT_BY_ID[resortId]?.name}
            <Text style={{ color: t.muted, fontSize: 13, fontWeight: '500' }}>{'  Riders booked this mountain. To go somewhere else, cancel and post a new ride.'}</Text>
          </Text>
        ) : (
        <ChipRow wrap>
          {(allMountains ? RESORTS : RESORTS.filter((r, i) => i < NEARBY || r.id === resortId)).map((r) => (
            <Chip key={r.id} label={`${r.name} · ${driveText(r.driveMinutes)}`} selected={resortId === r.id} onPress={() => setResortId(r.id)} />
          ))}
          {!allMountains ? <Chip label={`All ${RESORTS.length} mountains…`} onPress={() => setAllMountains(true)} /> : null}
        </ChipRow>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Label>Day</Label>
        {booked ? (
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>
            {longDay(day)}
            <Text style={{ color: t.muted, fontSize: 13, fontWeight: '500' }}>{'  Riders are booked for this day. You can still change the time.'}</Text>
          </Text>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <DayPicker
              value={day}
              onChange={setDay}
              minDay={today}
              maxDay={lastDay}
              disabled={busyDays}
              disabledNote="Faded days are ones you already have a ride. It's one ride per person per day."
            />
          </View>
        )}
        {busy ? (
          <Text style={{ color: t.danger, fontSize: 13, fontWeight: '600' }}>
            You already have a ride {dayLabel(day).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(day)}`}. It's one ride per person per day.
          </Text>
        ) : null}
        {wx ? (
          <Text style={{ color: wx.snowIn >= 0.5 ? t.snow : t.muted, fontSize: 13, fontWeight: '600' }}>
            {RESORT_BY_ID[resortId].name}, {dayLabel(day)}: {wx.snowIn >= 0.5 ? `❄ ${wx.snowIn}" new snow` : 'no new snow'} · {wx.hi}°/{wx.lo}°
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Label>Trip</Label>
        <ChipRow wrap>
          {(['round_trip', 'to_mountain', 'from_mountain'] as TripType[]).filter((tt) => !booked || tt === tripType).map((tt) => (
            <Chip key={tt} label={TRIP_LABEL[tt]} selected={tripType === tt} onPress={() => setTripType(tt)} />
          ))}
        </ChipRow>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {tripType === 'round_trip'
            ? 'Up and back. Riders can book both ways or just one, and a one-way seat pays half.'
            : tripType === 'to_mountain'
              ? 'Just the drive up. Riders find their own way back.'
              : 'Just the drive back down from the mountain.'}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Label>{tripType === 'from_mountain' ? 'Leaving the mountain at' : 'Leaving at'}</Label>
        {validTimes.length ? (
          <ChipRow>
            {validTimes.map((tm) => (
              <Chip key={tm} label={clockFromHHMM(tm)} selected={timeValue === tm} onPress={() => setTime(tm)} />
            ))}
          </ChipRow>
        ) : (
          <Text style={{ color: t.muted, fontSize: 13 }}>Rides have to leave at least 2 hours out. Pick a later day.</Text>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Field
          label={tripType === 'from_mountain' ? 'Meet at the mountain' : 'Leaving from'}
          value={leaveFrom}
          onChangeText={setLeaveFrom}
          placeholder={tripType === 'from_mountain' ? 'e.g. Peak 8 base, by the ticket office' : 'e.g. Kittredge parking lot'}
          maxLength={80}
        />
        {tripType !== 'from_mountain' ? (
          <ChipRow>
            {PICKUP_SPOTS.map((p) => (
              <Chip key={p} label={p} selected={leaveFrom === p} onPress={() => setLeaveFrom(p)} />
            ))}
          </ChipRow>
        ) : null}
      </View>

      {tripType === 'round_trip' ? (
        <View style={{ gap: 8 }}>
          <Label>Heading back at</Label>
          <ChipRow>
            {validReturns.map((tm) => (
              <Chip key={tm} label={clockFromHHMM(tm)} selected={returnValue === tm} onPress={() => setReturnTime(tm)} />
            ))}
          </ChipRow>
          <Field
            label="Meet for the ride back"
            value={returnMeet}
            onChangeText={setReturnMeet}
            placeholder={resortId ? `${RESORT_BY_ID[resortId].name} base area` : 'Base area parking lot'}
            maxLength={80}
          />
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Label>Open seats</Label>
        <ChipRow wrap>
          {SEAT_OPTIONS.filter((n) => n >= minSeats).map((n) => (
            <Chip key={n} label={String(n)} selected={seats === n} onPress={() => setSeats(n)} />
          ))}
        </ChipRow>
        {booked && minSeats > 1 ? <Text style={{ color: t.muted, fontSize: 13 }}>{minSeats} seats are booked, so you can't go lower than that.</Text> : null}
      </View>

      <View style={{ gap: 8 }}>
        <Label>Gas money per rider</Label>
        {booked ? <Text style={{ color: t.muted, fontSize: 13 }}>Riders agreed to ${original!.gasPerRider}, so you can lower it but not raise it.</Text> : null}
        <ChipRow wrap>
          {gasOptions.map((g) => (
            <Chip key={g} label={g === 0 ? 'Free' : `$${g}`} selected={gasValue === g} onPress={() => setGas(g)} />
          ))}
        </ChipRow>
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
          {resortId
            ? `Colorado caps gas money at your real driving cost: ${tripType === 'round_trip' ? RESORT_BY_ID[resortId].roundTripMiles : Math.round(RESORT_BY_ID[resortId].roundTripMiles / 2)} mi ${tripType === 'round_trip' ? 'round trip' : 'one way'} × ${mileageCents(new Date(sampleDepart).getFullYear())}¢ = $${cap} for this trip. With ${seats} seat${seats > 1 ? 's' : ''}, that's up to $${maxPer} per rider.${tripType === 'round_trip' && gasValue > 0 ? ` One-way riders pay $${oneWayShare(gasValue)}.` : ''}`
            : 'Pick a mountain to see the most you can ask. Colorado caps gas money at your real driving cost.'}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Gear space</Label>
        <ChipRow wrap>
          {GEAR_OPTIONS.map((g) => (
            <Chip key={g} label={g} selected={gear === g} onPress={() => setGear(g)} />
          ))}
        </ChipRow>
      </View>

      <Field
        label="How riders reach you"
        value={contact}
        onChangeText={setContact}
        placeholder="Phone number or Instagram handle"
        maxLength={60}
        hint="Only shown to you and people who claim a seat."
      />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="AWD with snow tires. Back by 5. Aux is open." maxLength={280} multiline />

      <Notice kind="info">{CARPOOL_DISCLAIMER}</Notice>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button variant="ghost" title={editing ? 'Discard changes' : 'Cancel'} onPress={() => nav.back()} />
        <Button title={editing ? 'Save changes' : 'Post ride'} onPress={submit} loading={saving} disabled={busy || needsVerification} />
      </View>

      {editing ? (
        confirmCancel ? (
          <View style={{ gap: 8 }}>
            <Notice kind="error">{booked ? 'Cancel this ride for everyone? Your riders get a notification and will need another way up.' : 'Cancel this ride? It comes off the board.'}</Notice>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button small variant="ghost" title="Keep it" onPress={() => setConfirmCancel(false)} />
              <Button
                small
                variant="danger"
                title="Cancel ride"
                loading={saving}
                onPress={async () => {
                  setSaving(true);
                  try {
                    await api.cancelRide(editRideId!);
                    await refreshMyRides();
                    nav.replace('/rides');
                  } catch (e) {
                    setError((e as Error).message);
                    setSaving(false);
                  }
                }}
              />
            </View>
          </View>
        ) : (
          <Text style={{ textAlign: 'center' }}>
            <Text onPress={() => setConfirmCancel(true)} accessibilityRole="button" style={{ color: t.danger, fontSize: 14, fontWeight: '700' }}>
              Cancel this ride
            </Text>
          </Text>
        )
      ) : null}
      </>
      )}
    </FormScreen>
  );
}
