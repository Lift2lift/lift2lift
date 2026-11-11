import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { REPORT_REASONS, type ReportKind, type ReportReason } from '../lib/types';
import { useApi } from '../providers';
import { PickerSheet } from './Pickers';
import { Button, Field, Notice } from './ui';

const WHAT: Record<ReportKind, string> = { profile: 'profile', message: 'message', review: 'review', ride: 'ride' };

/** A yes/no pop-up that works the same on iPhone and the web. */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <PickerSheet visible={visible} title={title} onClose={onClose}>
      <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{message}</Text>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button
        title={confirmLabel}
        variant={danger ? 'danger' : 'primary'}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onConfirm();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button title="Cancel" variant="ghost" onPress={onClose} />
    </PickerSheet>
  );
}

/**
 * Report a person or something they wrote. After sending, offers to block them too.
 * Required by App Review guideline 1.2 for apps with user content.
 */
export function ReportSheet({
  visible,
  onClose,
  userId,
  name,
  kind,
  targetId,
  onBlocked,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  kind: ReportKind;
  targetId?: string | null;
  /** Called after blocking from this sheet, so the screen can hide them right away. */
  onBlocked?: () => void;
}) {
  const t = useTheme();
  const api = useApi();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const first = name.split(' ')[0] || 'them';

  const close = () => {
    onClose();
    setReason(null);
    setDetails('');
    setError(null);
    setSent(false);
    setBlocked(false);
  };

  return (
    <PickerSheet visible={visible} title={sent ? 'Thanks for telling us' : `Report this ${WHAT[kind]}`} onClose={close}>
      {sent ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>
            We review every report within 24 hours and remove content or accounts that break the Community Guidelines. {name || 'They'} won't know you reported them.
          </Text>
          {blocked ? (
            <Notice kind="success">You blocked {first}. You won't see each other on Lift2Lift.</Notice>
          ) : (
            <Button
              title={`Also block ${first}`}
              variant="danger"
              loading={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.blockUser(userId);
                  setBlocked(true);
                  onBlocked?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button title="Done" variant="ghost" onPress={close} />
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.muted, fontSize: 14 }}>What's wrong with it?</Text>
          {REPORT_REASONS.filter((r) => r.id !== 'unsafe_driving' || kind !== 'message').map((r) => {
            const on = reason === r.id;
            return (
              <Pressable
                key={r.id}
                onPress={() => setReason(r.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={{ borderWidth: on ? 2 : 1, borderColor: on ? t.accent : t.line, borderRadius: 12, padding: 12, backgroundColor: t.surface }}
              >
                <Text style={{ color: t.ink, fontSize: 15, fontWeight: on ? '800' : '600' }}>{r.label}</Text>
              </Pressable>
            );
          })}
          <Field label="Anything else? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button
            title="Send report"
            disabled={!reason}
            loading={busy}
            onPress={async () => {
              if (!reason) return;
              setBusy(true);
              setError(null);
              try {
                await api.report({ userId, kind, targetId, reason, details });
                setSent(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>
            In danger right now? Call 911 first.
          </Text>
        </ScrollView>
      )}
    </PickerSheet>
  );
}

/** "Report" and "Block" for someone else's profile. */
export function ProfileSafetyActions({ userId, name, onBlocked }: { userId: string; name: string; onBlocked: () => void }) {
  const api = useApi();
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const first = name.split(' ')[0] || 'them';
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
      <View style={{ flex: 1 }}>
        <Button small variant="ghost" title="Report" onPress={() => setReporting(true)} />
      </View>
      <View style={{ flex: 1 }}>
        <Button small variant="danger" title={`Block ${first}`} onPress={() => setBlocking(true)} />
      </View>
      <ReportSheet visible={reporting} onClose={() => setReporting(false)} userId={userId} name={name} kind="profile" onBlocked={onBlocked} />
      <ConfirmSheet
        visible={blocking}
        title={`Block ${first}?`}
        message={`You won't see each other's rides, profiles, messages or reviews, and you can't book a ride together. Any friendship ends. ${first} isn't told. You can unblock in Account → Blocked people.`}
        confirmLabel={`Block ${first}`}
        danger
        onConfirm={async () => {
          await api.blockUser(userId);
          onBlocked();
        }}
        onClose={() => setBlocking(false)}
      />
    </View>
  );
}
