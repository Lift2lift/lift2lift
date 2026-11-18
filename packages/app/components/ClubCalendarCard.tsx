import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { timeAgo } from '../lib/dates';
import { useTheme } from '../lib/theme';
import type { CommunityCalendar } from '../lib/types';
import { useApi } from '../providers';
import { Button, Card, Field, Label, Loading, Notice } from './ui';

/** Only the host of a saved link is shown: a calendar's secret address is a credential. */
function hostOf(icsUrl: string) {
  try {
    return new URL(icsUrl).host || 'Calendar connected';
  } catch {
    return 'Calendar connected';
  }
}

/** Admins connect the club's calendar by its ICS link; a server function imports the events. */
export function ClubCalendarCard({ communityId, onSynced }: { communityId: string; onSynced: () => void }) {
  const t = useTheme();
  const api = useApi();

  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [calendar, setCalendar] = useState<CommunityCalendar | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'remove'>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  const alive = useRef(true);
  const loadId = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Never throws: a failure shows as `loadError`. Only the latest load applies. */
  const load = useCallback(async () => {
    const id = ++loadId.current;
    try {
      const c = await api.communityCalendar(communityId);
      if (!alive.current || id !== loadId.current) return;
      setCalendar(c);
      setLoadError(null);
      setState('ready');
    } catch (e) {
      if (!alive.current || id !== loadId.current) return;
      setLoadError((e as Error).message);
      setState('failed');
    }
  }, [api, communityId]);

  useEffect(() => {
    setState('loading');
    setCalendar(null);
    setMessage(null);
    setConfirmRemove(false);
    load();
  }, [load]);

  /** Runs the import, then refreshes the card whether it worked or not. Returns the error text, if any. */
  async function sync(): Promise<string | null> {
    let error: string | null = null;
    try {
      await api.syncCommunityCalendar(communityId);
    } catch (e) {
      error = (e as Error).message;
    }
    await load();
    return error;
  }

  async function connect() {
    const url = link.trim();
    if (!url) {
      setMessage({ text: "Paste your club calendar's link.", kind: 'error' });
      return;
    }
    setBusy('connect');
    setMessage(null);
    try {
      await api.setCommunityCalendar(communityId, url);
      if (!alive.current) return;
      setLink('');
      const error = await sync();
      if (!alive.current) return;
      if (error) setMessage({ text: error, kind: 'error' });
      else {
        setMessage({ text: 'Calendar connected. Events are on the calendar.', kind: 'success' });
        onSynced();
      }
    } catch (e) {
      if (alive.current) setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function syncNow() {
    setBusy('sync');
    setMessage(null);
    try {
      const error = await sync();
      if (!alive.current) return;
      if (error) setMessage({ text: error, kind: 'error' });
      else onSynced();
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    setMessage(null);
    try {
      await api.setCommunityCalendar(communityId, null);
      if (!alive.current) return;
      setConfirmRemove(false);
      await load();
      if (alive.current) onSynced();
    } catch (e) {
      if (alive.current) setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const muted = { color: t.muted, fontSize: 13, lineHeight: 19 } as const;
  const notice = message ? <Notice kind={message.kind}>{message.text}</Notice> : null;

  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <Label>Club calendar</Label>
      {state === 'loading' ? (
        <Loading label="Loading club calendar…" />
      ) : state === 'failed' ? (
        <Notice kind="error">{loadError ?? "Couldn't load the club calendar."}</Notice>
      ) : calendar ? (
        <>
          <View style={{ gap: 2 }}>
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>
              {hostOf(calendar.icsUrl)}
            </Text>
            <Text style={muted}>{calendar.lastSyncedAt ? `Last synced ${timeAgo(calendar.lastSyncedAt)}` : 'Not synced yet'}</Text>
          </View>
          {calendar.lastError ? <Notice kind="error">{calendar.lastError}</Notice> : null}
          {notice}
          {confirmRemove ? (
            <View style={{ gap: 8 }}>
              <Notice kind="error">Remove the club calendar? Imported events that haven't started are removed. Events you added here stay.</Notice>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small variant="ghost" title="Keep" disabled={busy !== null} onPress={() => setConfirmRemove(false)} />
                <Button small variant="danger" title="Remove" loading={busy === 'remove'} disabled={busy !== null} onPress={remove} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button small title="Sync now" loading={busy === 'sync'} disabled={busy !== null} onPress={syncNow} />
              <Button
                small
                variant="ghost"
                title="Remove"
                disabled={busy !== null}
                onPress={() => {
                  setMessage(null);
                  setConfirmRemove(true);
                }}
              />
            </View>
          )}
          <Text style={muted}>Events from the calendar can't be edited here. Change them in the calendar.</Text>
        </>
      ) : (
        <>
          {notice}
          <Field
            label="Calendar link"
            value={link}
            onChangeText={setLink}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={{ flexDirection: 'row' }}>
            <Button small title="Connect calendar" loading={busy === 'connect'} disabled={busy !== null} onPress={connect} />
          </View>
          <Text style={muted}>Google Calendar: Settings, your calendar, Integrate calendar, Secret address in iCal format.</Text>
          <Text style={muted}>Outlook: Settings, Calendar, Shared calendars, Publish a calendar, ICS link.</Text>
          <Text style={muted}>Events from the calendar can't be edited here. Change them in the calendar.</Text>
        </>
      )}
    </Card>
  );
}
