import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { addDays, clockFromHHMM, isoDay, parseDay, toISO } from '../lib/dates';
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

  // Start fresh each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setSaving(false);
    savingRef.current = false;
    if (initial) {
      setTitle(initial.title);
      setAllDay(initial.allDay);
      setStartDay(isoDay(new Date(initial.startsAt)));
      setStartTime(hhmmOf(initial.startsAt));
      setEndDay(isoDay(new Date(initial.endsAt)));
      setEndTime(hhmmOf(initial.endsAt));
      setPlace(initial.location);
      setResortId(initial.resortId ?? '');
      setDescription(initial.description);
    } else {
      setTitle('');
      setAllDay(false);
      setStartDay(defaultDay);
      setStartTime('09:00');
      setEndDay(defaultDay);
      setEndTime('11:00');
      setPlace('');
      setResortId('');
      setDescription('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const today = isoDay(new Date());
  const initialStart = initial ? isoDay(new Date(initial.startsAt)) : null;
  const initialEnd = initial ? isoDay(new Date(initial.endsAt)) : null;
  const latest = isoDay(addDays(parseDay(today), 180));
  const minDay = initialStart && initialStart < today ? initialStart : today;
  const maxDay = initialEnd && initialEnd > latest ? initialEnd : latest;

  // Times that aren't on the half hour (e.g. imported events) stay pickable.
  const startTimes = TIMES.includes(startTime) ? TIMES : [...TIMES, startTime].sort();
  const endTimes = TIMES.includes(endTime) ? TIMES : [...TIMES, endTime].sort();

  function pickStartDay(d: string) {
    setStartDay(d);
    if (endDay < d) setEndDay(d);
  }

  async function save() {
    if (savingRef.current) return;
    if (title.trim().length < 2) return setError('Give the event a name.');
    const startsAt = toISO(startDay, allDay ? '00:00' : startTime);
    const endsAt = toISO(endDay, allDay ? '00:00' : endTime);
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
          <Chip label="All day" selected={allDay} onPress={() => setAllDay(true)} />
        </ChipRow>

        <View style={{ gap: 8 }}>
          <Label>{allDay ? 'First day' : 'Starts'}</Label>
          <View style={{ flexDirection: 'row' }}>
            <DayPicker value={startDay} onChange={pickStartDay} minDay={minDay} maxDay={maxDay} label="Starts" />
          </View>
          {allDay ? null : (
            <ChipRow>
              {startTimes.map((tm) => (
                <Chip key={tm} label={clockFromHHMM(tm)} selected={startTime === tm} onPress={() => setStartTime(tm)} />
              ))}
            </ChipRow>
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Label>{allDay ? 'Last day' : 'Ends'}</Label>
          <View style={{ flexDirection: 'row' }}>
            <DayPicker value={endDay} onChange={setEndDay} minDay={startDay} maxDay={maxDay} label="Ends" />
          </View>
          {allDay ? null : (
            <ChipRow>
              {endTimes.map((tm) => (
                <Chip key={tm} label={clockFromHHMM(tm)} selected={endTime === tm} onPress={() => setEndTime(tm)} />
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
