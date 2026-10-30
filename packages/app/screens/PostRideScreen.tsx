import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { SetupModal } from '../components/SetupModal';
import { Button, Chip, ChipRow, Field, FormScreen, Heading, Label, Notice } from '../components/ui';
import { GEAR_OPTIONS, PICKUP_SPOTS } from '../lib/config';
import { clockFromHHMM, dayLabel, driveText, nextDays, nextSaturday, toISO } from '../lib/dates';
import { forecastFor } from '../lib/forecast';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { CARPOOL_DISCLAIMER, earliestDeparture, MAX_PASSENGERS, maxGasPerRider, mileageCents, tripGasCap } from '../lib/rules';
import { oneWayShare, TRIP_LABEL } from '../lib/trips';
import type { TripType } from '../lib/types';
import { useTheme } from '../lib/theme';
import { useForecast } from '../lib/useForecast';
import { canHost, type DriverVerification } from '../lib/types';
import { useApi, useAuth, useNav } from '../providers';

const RETURN_TIMES = ['12:00', '13:00', '14:00', '15:00', '15:30', '16:00', '16:30', '17:00', '18:00', '20:00'];
const TIMES = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '15:00', '16:00'];
const GAS_STEP = 5;
const SEAT_OPTIONS = Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1);
const NEARBY = 12; // closest mountains shown before "All mountains"

export function PostRideScreen({ initialResort }: { initialResort?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const { forecast } = useForecast();
  const days = useMemo(() => nextDays(14), []);

  const [resortId, setResortId] = useState(initialResort && RESORT_BY_ID[initialResort] ? initialResort : '');
  const [day, setDay] = useState(days.includes(nextSaturday()) ? nextSaturday() : days[1]);
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
  const needsVerification = verificationChecked && (!profileReady || !canHost(verification));

  // Days this person already drives or rides (one ride per person per day).
  const [busyDays, setBusyDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    const me = session?.userId;
    if (!me) return;
    api
      .listRides()
      .then((rides) => setBusyDays(new Set(rides.filter((r) => r.driverId === me || r.riderIds.includes(me)).map((r) => r.rideDate))))
      .catch(() => {});
  }, [api, session?.userId]);

  const wx = resortId ? forecastFor(forecast, resortId, day) : null;

  // Departures have to be at least 2 hours out so riders can book ahead.
  const earliest = earliestDeparture();
  const validTimes = TIMES.filter((tm) => new Date(toISO(day, tm)) >= earliest);
  const timeValue = validTimes.includes(time) ? time : validTimes[0];

  // Colorado gas cap for this trip, and the most each rider can be asked for.
  const sampleDepart = toISO(day, timeValue ?? '06:30');
  const cap = resortId ? tripGasCap(resortId, sampleDepart, tripType) : 0;
  const maxPer = resortId ? maxGasPerRider(resortId, sampleDepart, seats, tripType) : 0;
  const validReturns = RETURN_TIMES.filter((tm) => tm > (timeValue ?? '00:00'));
  const returnValue = validReturns.includes(returnTime) ? returnTime : validReturns[validReturns.length - 1];
  const gasValue = resortId ? Math.min(gas, maxPer) : gas;
  const gasOptions = useMemo(() => {
    if (!resortId) return [0, 5, 10, 15, 20];
    const opts: number[] = [];
    for (let g = 0; g <= maxPer; g += GAS_STEP) opts.push(g);
    if (maxPer % GAS_STEP !== 0) opts.push(maxPer);
    return opts;
  }, [resortId, maxPer]);
  const busy = busyDays.has(day);

  async function submit() {
    setError(null);
    if (!resortId) return setError('Pick a mountain.');
    if (busy) return setError('You already have a ride that day. It\'s one ride per person per day, so pick another day.');
    if (!timeValue) return setError('Rides have to leave at least 2 hours from now. Pick a later day.');
    const departAt = toISO(day, timeValue);
    if (new Date(departAt) < earliestDeparture()) return setError('Rides have to leave at least 2 hours from now so riders can book ahead.');
    if (!leaveFrom.trim()) return setError("Add where you're leaving from so riders know where to meet.");
    if (!contact.trim()) return setError('Add a phone number or handle so riders can reach you.');
    if (tripType === 'round_trip' && !returnValue) return setError('Pick a time for the ride back.');
    setSaving(true);
    try {
      await api.postRide({
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
      });
      nav.replace('/', { resort: resortId, day });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <FormScreen header={<AppHeader />}>
      <SetupModal visible={needsVerification} role="driver" profileReady={profileReady} onClose={() => nav.back()} />

      <Heading title="Post a ride" subtitle="Riders see this on the board. Only people who claim a seat see how to reach you." />

      <View style={{ gap: 8 }}>
        <Label>Mountain</Label>
        <ChipRow wrap>
          {(allMountains ? RESORTS : RESORTS.filter((r, i) => i < NEARBY || r.id === resortId)).map((r) => (
            <Chip key={r.id} label={`${r.name} · ${driveText(r.driveMinutes)}`} selected={resortId === r.id} onPress={() => setResortId(r.id)} />
          ))}
          {!allMountains ? <Chip label={`All ${RESORTS.length} mountains…`} onPress={() => setAllMountains(true)} /> : null}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Day</Label>
        <ChipRow>
          {days.map((d) => (
            <Chip key={d} label={busyDays.has(d) ? `${dayLabel(d)} · booked` : dayLabel(d)} selected={day === d} onPress={() => setDay(d)} />
          ))}
        </ChipRow>
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
          {(['round_trip', 'to_mountain', 'from_mountain'] as TripType[]).map((tt) => (
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
          {SEAT_OPTIONS.map((n) => (
            <Chip key={n} label={String(n)} selected={seats === n} onPress={() => setSeats(n)} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Gas money per rider</Label>
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
        <Button variant="ghost" title="Cancel" onPress={() => nav.back()} />
        <Button title="Post ride" onPress={submit} loading={saving} disabled={busy || needsVerification} />
      </View>
    </FormScreen>
  );
}
