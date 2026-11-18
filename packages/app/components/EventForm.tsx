import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { addDays, clockFromHHMM, denverDay, denverMidnight, isoDay, parseDay, toISO } from '../lib/dates';
import { RESORTS } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { CommunityEvent, NewCommunityEvent } from '../lib/types';
import { DayPicker, OptionPicker, PickerSheet } from './Pickers';
import { Button, Chip, ChipRow, Field, Label, Notice } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

/** HH:MM in the device's time zone. */
const hhmmOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Two hours after a start: the end day and HH:MM, rolling into the next day past midnight. */
function twoHoursAfter(day: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = h * 60 + m + 120;
  const next = mins >= 24 * 60 ? isoDay(addDays(parseDay(day), 1)) : day;
  const rest = mins % (24 * 60);
  return { day: next, time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

/** The form's day for a stored time: all-day events are Denver calendar dates, timed ones device-local. */
const dayOf = (iso: string, allDay: boolean) => (allDay ? denverDay(iso) : isoDay(new Date(iso)));

/** Every half hour of the day. */
const TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

const MOUNTAIN_OPTIONS = [{ id: '', label: 'No mountain' }, ...RESORTS.map((r) => ({ id: r.id, label: r.name }))];

/** Add or edit a club event. Edits when `initial` is set. */
export function EventForm({
  visible,
  initial,
  defaultDay,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial?: CommunityEvent; // edit when set
  defaultDay: string; // YYYY-MM-DD for a new event
  onClose: () => void;
  onSave: (event: NewCommunityEvent) => Promise<void>; // rejects with a user-facing message
}) {
  const t = useTheme();
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startDay, setStartDay] = useState(defaultDay);
  const [startTime, setStartTime] = useState('09:00');
  const [endDay, setEndDay] = useState(defaultDay);
  const [endTime, setEndTime] = useState('11:00');
  const [place, setPlace] = useState('');
  const [resortId, setResortId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Until the end is touched (or when editing), it follows the start + 2 hours.
  const [endTouched, setEndTouched] = useState(false);

  // Start fresh each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setSaving(false);
    savingRef.current = false;
    setEndTouched(!!initial);
    if (initial) {
      setTitle(initial.title);
      setAllDay(initial.allDay);
      setStartDay(dayOf(initial.startsAt, initial.allDay));
      setStartTime(hhmmOf(initial.startsAt));
      setEndDay(dayOf(initial.endsAt, initial.allDay));
      setEndTime(hhmmOf(initial.endsAt));
      setPlace(initial.location);
      setResortId(initial.resortId ?? '');
      setDescription(initial.description);
    } else {
      setTitle('');
      setAllDay(false);
      const end = twoHoursAfter(defaultDay, '09:00');
      setStartDay(defaultDay);
      setStartTime('09:00');
      setEndDay(end.day);
      setEndTime(end.time);
      setPlace('');
      setResortId('');
      setDescription('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const today = isoDay(new Date());
  const initialStart = initial ? dayOf(initial.startsAt, initial.allDay) : null;
  const initialEnd = initial ? dayOf(initial.endsAt, initial.allDay) : null;
  const latest = isoDay(addDays(parseDay(today), 180));
  const minDay = initialStart && initialStart < today ? initialStart : today;
  const maxDay = initialEnd && initialEnd > latest ? initialEnd : latest;

  // Times that aren't on the half hour (e.g. imported events) stay pickable.
  const startTimes = TIMES.includes(startTime) ? TIMES : [...TIMES, startTime].sort();
  const endTimes = TIMES.includes(endTime) ? TIMES : [...TIMES, endTime].sort();

  function changeStart(day: string, time: string) {
    setStartDay(day);
    setStartTime(time);
    if (!endTouched) {
      const end = twoHoursAfter(day, time);
      setEndDay(allDay ? day : end.day);
      setEndTime(end.time);
    } else if (endDay < day) setEndDay(day);
  }

  async function save() {
    if (savingRef.current) return;
    if (title.trim().length < 2) return setError('Give the event a name.');
    // All-day events are stored at Denver midnight of the first and last day, whatever the device's zone.
    const startsAt = allDay ? denverMidnight(startDay) : toISO(startDay, startTime);
    const endsAt = allDay ? denverMidnight(endDay) : toISO(endDay, endTime);
    if (new Date(endsAt) < new Date(startsAt)) return setError('The end has to be after the start.');
    setError(null);
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        location: place.trim(),
        resortId: resortId || null,
        startsAt,
        endsAt,
        allDay,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <PickerSheet visible={visible} title={initial ? 'Edit event' : 'Add event'} onClose={onClose}>
      <ScrollView style={{ flexGrow: 0, maxHeight: 520 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
        <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} />

        <ChipRow wrap>
          <Chip label="Set times" selected={!allDay} onPress={() => setAllDay(false)} />
          <Chip
            label="All day"
            selected={allDay}
            onPress={() => {
              setAllDay(true);
              // An untouched end may have rolled past midnight; an all-day event then ends on its first day.
              if (!endTouched) setEndDay(startDay);
            }}
          />
        </ChipRow>

        <View style={{ gap: 8 }}>
          <Label>{allDay ? 'First day' : 'Starts'}</Label>
          <View style={{ flexDirection: 'row' }}>
            <DayPicker value={startDay} onChange={(d) => changeStart(d, startTime)} minDay={minDay} maxDay={maxDay} label="Starts" />
          </View>
          {allDay ? null : (
            <ChipRow>
              {startTimes.map((tm) => (
                <Chip key={tm} label={clockFromHHMM(tm)} selected={startTime === tm} onPress={() => changeStart(startDay, tm)} />
              ))}
            </ChipRow>
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Label>{allDay ? 'Last day' : 'Ends'}</Label>
          <View style={{ flexDirection: 'row' }}>
            <DayPicker value={endDay} onChange={(d) => { setEndTouched(true); setEndDay(d); }} minDay={startDay} maxDay={maxDay} label="Ends" />
          </View>
          {allDay ? null : (
            <ChipRow>
              {endTimes.map((tm) => (
                <Chip key={tm} label={clockFromHHMM(tm)} selected={endTime === tm} onPress={() => { setEndTouched(true); setEndTime(tm); }} />
              ))}
            </ChipRow>
          )}
        </View>

        <Field label="Place" value={place} onChangeText={setPlace} maxLength={120} />

        <View style={{ gap: 6 }}>
          <Label>Mountain</Label>
          <View style={{ flexDirection: 'row' }}>
            <OptionPicker label="Mountain" title="Mountain" value={resortId} options={MOUNTAIN_OPTIONS} onChange={setResortId} />
          </View>
        </View>

        <Field label="Description" value={description} onChangeText={setDescription} maxLength={1000} multiline />
      </ScrollView>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" title="Cancel" onPress={onClose} />
        <Button title={initial ? 'Save' : 'Add event'} loading={saving} onPress={save} />
      </View>
    </PickerSheet>
  );
}
