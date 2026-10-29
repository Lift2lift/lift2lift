import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Button, Chip, ChipRow, Field, FormScreen, Heading, Label, Notice } from '../components/ui';
import { GEAR_OPTIONS, PICKUP_SPOTS } from '../lib/config';
import { clockFromHHMM, dayLabel, driveText, nextDays, nextSaturday, toISO } from '../lib/dates';
import { forecastFor } from '../lib/forecast';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import { useForecast } from '../lib/useForecast';
import { useApi, useNav } from '../providers';

const TIMES = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '15:00', '16:00'];
const GAS = [0, 5, 10, 15, 20, 25, 30, 40];
const NEARBY = 12; // closest mountains shown before "All mountains"

export function PostRideScreen({ initialResort }: { initialResort?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { forecast } = useForecast();
  const days = useMemo(() => nextDays(14), []);

  const [resortId, setResortId] = useState(initialResort && RESORT_BY_ID[initialResort] ? initialResort : '');
  const [day, setDay] = useState(days.includes(nextSaturday()) ? nextSaturday() : days[1]);
  const [time, setTime] = useState('06:30');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [seats, setSeats] = useState(3);
  const [gas, setGas] = useState(15);
  const [gear, setGear] = useState(GEAR_OPTIONS[0]);
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [allMountains, setAllMountains] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const wx = resortId ? forecastFor(forecast, resortId, day) : null;

  async function submit() {
    setError(null);
    if (!resortId) return setError('Pick a mountain.');
    const departAt = toISO(day, time);
    if (new Date(departAt).getTime() < Date.now()) return setError('That time already passed. Pick a later one.');
    if (!leaveFrom.trim()) return setError("Add where you're leaving from so riders know where to meet.");
    if (!contact.trim()) return setError('Add a phone number or handle so riders can reach you.');
    setSaving(true);
    try {
      await api.postRide({
        resortId,
        departAt,
        leaveFrom: leaveFrom.trim().slice(0, 80),
        seatsTotal: seats,
        gasPerRider: gas,
        gear,
        notes: notes.trim().slice(0, 280),
        contact: contact.trim().slice(0, 60),
      });
      nav.replace('/', { day });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <FormScreen header={<AppHeader />}>
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
            <Chip key={d} label={dayLabel(d)} selected={day === d} onPress={() => setDay(d)} />
          ))}
        </ChipRow>
        {wx ? (
          <Text style={{ color: wx.snowIn >= 0.5 ? t.snow : t.muted, fontSize: 13, fontWeight: '600' }}>
            {RESORT_BY_ID[resortId].name}, {dayLabel(day)}: {wx.snowIn >= 0.5 ? `❄ ${wx.snowIn}" new snow` : 'no new snow'} · {wx.hi}°/{wx.lo}°
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Label>Leaving at</Label>
        <ChipRow>
          {TIMES.map((tm) => (
            <Chip key={tm} label={clockFromHHMM(tm)} selected={time === tm} onPress={() => setTime(tm)} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <Field label="Leaving from" value={leaveFrom} onChangeText={setLeaveFrom} placeholder="e.g. Kittredge parking lot" maxLength={80} />
        <ChipRow>
          {PICKUP_SPOTS.map((p) => (
            <Chip key={p} label={p} selected={leaveFrom === p} onPress={() => setLeaveFrom(p)} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Open seats</Label>
        <ChipRow wrap>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <Chip key={n} label={String(n)} selected={seats === n} onPress={() => setSeats(n)} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Gas money per rider</Label>
        <ChipRow wrap>
          {GAS.map((g) => (
            <Chip key={g} label={g === 0 ? 'Free' : `$${g}`} selected={gas === g} onPress={() => setGas(g)} />
          ))}
        </ChipRow>
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

      {error ? <Notice kind="error">{error}</Notice> : null}

      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button variant="ghost" title="Cancel" onPress={() => nav.back()} />
        <Button title="Post ride" onPress={submit} loading={saving} />
      </View>
    </FormScreen>
  );
}
