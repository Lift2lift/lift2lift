import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { timeAgo } from '../lib/dates';
import { useTheme } from '../lib/theme';
import type { CommunityCalendar, GoogleCalendarChoice } from '../lib/types';
import { useApi, useDevice } from '../providers';
import { Button, Card, Field, Label, Loading, Notice, TextLink } from './ui';

/** Only the host of a saved link is shown: a calendar's secret address is a credential. */
function hostOf(icsUrl: string | null) {
  try {
    return (icsUrl && new URL(icsUrl).host) || 'Calendar connected';
  } catch {
    return 'Calendar connected';
  }
}

const SIGN_IN_RESULT: Record<string, { text: string; kind: 'success' | 'error' }> = {
  connected: { text: 'Signed in with Google. Pick the club calendar.', kind: 'success' },
  denied: { text: 'Google sign-in was cancelled. Allow Lift2Lift to see your calendars to connect one.', kind: 'error' },
  error: { text: "Couldn't connect Google Calendar. Try again.", kind: 'error' },
};

/**
 * Admins connect the club's calendar: Google sign-in (then pick one of their calendars), or a pasted ICS link
 * for Outlook and iCloud. A server function imports the events.
 */
export function ClubCalendarCard({ communityId, onSynced }: { communityId: string; onSynced: () => void }) {
  const t = useTheme();
  const api = useApi();
  const device = useDevice();

  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [calendar, setCalendar] = useState<CommunityCalendar | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [choices, setChoices] = useState<GoogleCalendarChoice[] | null>(null);
  const [choicesError, setChoicesError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'google' | 'choose' | 'sync' | 'remove'>(null);
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
    setConfirmRemove(false);
    // Back from Google on the web: the result is in this page's address.
    const result = device.takeGoogleResult();
    setMessage(result ? SIGN_IN_RESULT[result] ?? SIGN_IN_RESULT.error : null);
    load();
  }, [load, device]);

  // Signed in, no calendar picked yet: fetch the account's calendars.
  const pending = calendar?.googlePending === true;
  useEffect(() => {
    if (!pending) {
      setChoices(null);
      setChoicesError(null);
      setPicked(null);
      return;
    }
    let live = true;
    setChoices(null);
    setChoicesError(null);
    api
      .googleCalendars(communityId)
      .then((list) => {
        if (!live) return;
        setChoices(list);
        setPicked(list[0]?.id ?? null);
      })
      .catch((e) => live && setChoicesError((e as Error).message));
    return () => {
      live = false;
    };
  }, [api, communityId, pending]);

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

  async function connectGoogle() {
    setBusy('google');
    setMessage(null);
    try {
      const returnTo = device.googleReturnTo();
      const url = await api.startGoogleCalendar(communityId, returnTo);
      const result = await device.openGoogleSignIn(url, returnTo); // the web page leaves here
      if (!alive.current) return;
      if (result) setMessage(SIGN_IN_RESULT[result] ?? SIGN_IN_RESULT.error);
      await load();
    } catch (e) {
      if (alive.current) setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function choose() {
    if (!picked) return;
    setBusy('choose');
    setMessage(null);
    try {
      await api.chooseGoogleCalendar(communityId, picked);
      if (!alive.current) return;
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

  async function connectLink() {
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

  /** Removes the link, or disconnects Google (which also cancels a sign-in that has no calendar yet). */
  async function remove() {
    setBusy('remove');
    setMessage(null);
    try {
      if (calendar?.googleEmail) await api.disconnectGoogleCalendar(communityId);
      else await api.setCommunityCalendar(communityId, null);
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
  const readOnly = <Text style={muted}>Events from the calendar can't be edited here. Change them in the calendar.</Text>;
  const isGoogle = calendar?.source === 'google';

  let body;
  if (state === 'loading') body = <Loading label="Loading club calendar…" />;
  else if (state === 'failed') body = <Notice kind="error">{loadError ?? "Couldn't load the club calendar."}</Notice>;
  else if (calendar && pending) {
    body = (
      <>
        <Text style={muted}>{calendar.googleEmail ? `Signed in with Google as ${calendar.googleEmail}.` : 'Signed in with Google.'}</Text>
        {notice}
        {choicesError ? (
          <Notice kind="error">{choicesError}</Notice>
        ) : !choices ? (
          <Loading label="Loading your calendars…" />
        ) : choices.length === 0 ? (
          <Notice kind="info">This Google account has no calendars to share.</Notice>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
            {choices.map((c) => {
              const on = c.id === picked;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setPicked(c.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: on ? t.ink : t.line,
                    backgroundColor: t.surface,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? t.ink : t.line, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.ink }} /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, color: t.ink, fontSize: 15, fontWeight: on ? '700' : '500' }}>
                    {c.name}
                  </Text>
                  {c.primary ? <Text style={muted}>Main</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button small title="Use this calendar" loading={busy === 'choose'} disabled={busy !== null || !picked} onPress={choose} />
          <Button small variant="ghost" title="Cancel" loading={busy === 'remove'} disabled={busy !== null} onPress={remove} />
        </View>
        {readOnly}
      </>
    );
  } else if (calendar) {
    body = (
      <>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>
            {isGoogle ? calendar.googleCalendarName || 'Google Calendar' : hostOf(calendar.icsUrl)}
          </Text>
          {isGoogle && calendar.googleEmail ? <Text numberOfLines={1} style={muted}>{`Google · ${calendar.googleEmail}`}</Text> : null}
          <Text style={muted}>{calendar.lastSyncedAt ? `Last synced ${timeAgo(calendar.lastSyncedAt)}` : 'Not synced yet'}</Text>
        </View>
        {calendar.lastError ? <Notice kind="error">{calendar.lastError}</Notice> : null}
        {notice}
        {confirmRemove ? (
          <View style={{ gap: 8 }}>
            <Notice kind="error">
              {`${isGoogle ? 'Disconnect Google Calendar?' : 'Remove the club calendar?'} Imported events that haven't started are removed. Events you added here stay.`}
            </Notice>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button small variant="ghost" title="Keep" disabled={busy !== null} onPress={() => setConfirmRemove(false)} />
              <Button small variant="danger" title={isGoogle ? 'Disconnect' : 'Remove'} loading={busy === 'remove'} disabled={busy !== null} onPress={remove} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button small title="Sync now" loading={busy === 'sync'} disabled={busy !== null} onPress={syncNow} />
            {isGoogle && calendar.lastError ? (
              <Button small variant="ghost" title="Sign in again" loading={busy === 'google'} disabled={busy !== null} onPress={connectGoogle} />
            ) : null}
            <Button
              small
              variant="ghost"
              title={isGoogle ? 'Disconnect' : 'Remove'}
              disabled={busy !== null}
              onPress={() => {
                setMessage(null);
                setConfirmRemove(true);
              }}
            />
          </View>
        )}
        {readOnly}
      </>
    );
  } else {
    body = (
      <>
        {notice}
        <View style={{ flexDirection: 'row' }}>
          <Button small title="Connect Google Calendar" loading={busy === 'google'} disabled={busy !== null} onPress={connectGoogle} />
        </View>
        <Text style={muted}>Sign in with the Google account that has the club calendar, then pick it. Lift2Lift only reads it.</Text>
        {showLink ? (
          <>
            <Field
              label="Calendar link"
              value={link}
              onChangeText={setLink}
              placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={{ flexDirection: 'row' }}>
              <Button small variant="ghost" title="Connect link" loading={busy === 'connect'} disabled={busy !== null} onPress={connectLink} />
            </View>
            <Text style={muted}>Outlook: Settings, Calendar, Shared calendars, Publish a calendar, ICS link.</Text>
            <Text style={muted}>iCloud: Calendar, share the calendar, Public Calendar, copy the link.</Text>
            <Text style={muted}>Google also works: Settings, your calendar, Integrate calendar, Secret address in iCal format.</Text>
          </>
        ) : (
          <TextLink onPress={() => setShowLink(true)}>Use an Outlook or iCloud link instead</TextLink>
        )}
        {readOnly}
      </>
    );
  }

  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <Label>Club calendar</Label>
      {body}
    </Card>
  );
}
