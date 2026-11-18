import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatCode, shareOrCopy } from '../lib/communities';
import { useTheme } from '../lib/theme';
import type { CommunityMember, CommunityPage } from '../lib/types';
import { useApi, useDevice, useNav } from '../providers';
import { CommunityBadge } from '../screens/CommunitiesScreen';
import { Avatar } from './Avatar';
import { Button, Card, Field, Label, Notice } from './ui';

/**
 * A community's invite code (admins), its members, the admin tools and
 * "Leave community". The screen shows messages and reloads the page.
 */
export function CommunityMembers({
  page,
  me,
  onChanged,
  onMessage,
  children,
}: {
  page: CommunityPage;
  me: string | undefined;
  /** Reload the page. */
  onChanged: () => Promise<void>;
  /** `null` clears the banner. */
  onMessage: (text: string | null, kind?: 'success' | 'error') => void;
  /** Extra admin cards, shown in the Admin section above the buttons. */
  children?: ReactNode;
}) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const device = useDevice();

  const admin = page.myRole === 'admin';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirm, setConfirm] = useState<null | 'code' | 'leave' | { remove: CommunityMember }>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    onMessage(null);
    try {
      await fn();
      if (done) onMessage(done, 'success');
      setConfirm(null);
    } catch (e) {
      onMessage((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changePhoto() {
    onMessage(null);
    let photo;
    try {
      photo = await device.pickPhoto();
    } catch (e) {
      return onMessage((e as Error).message, 'error');
    }
    if (!photo) return;
    await run(async () => {
      await api.setCommunityPhoto(page.id, photo);
      await onChanged();
    }, 'Photo updated.');
  }

  const otherAdmins = page.members.filter((m) => m.role === 'admin' && m.id !== me).length;

  return (
    <>
      {/* The invite code: admins only. */}
      {admin && page.code ? (
        <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>INVITE CODE · ONLY ADMINS SEE THIS</Text>
            <Text selectable style={{ color: t.ink, fontSize: 24, fontWeight: '900', letterSpacing: 3 }}>
              {formatCode(page.code)}
            </Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>Send it to people you want in. Anyone with the code can join.</Text>
          </View>
          <Button
            small
            variant="ghost"
            title="Send invite"
            onPress={async () => {
              const r = await shareOrCopy(`Join ${page.name} on Lift2Lift: open the Communities tab and enter ${formatCode(page.code!)}`);
              if (r === 'copied') onMessage('Copied the invite. Paste it into your club chat or a text.', 'success');
              else if (r === 'failed') onMessage(`Couldn't share. The code is ${formatCode(page.code!)}.`, 'error');
            }}
          />
        </Card>
      ) : null}

      {/* Members */}
      <View style={{ gap: 8 }}>
        <Label>{`Members · ${page.memberCount}`}</Label>
        <Card style={{ padding: 0 }}>
          {page.members.map((m, i) => (
            <View key={m.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => nav.push('/u', { id: m.id })}
                  accessibilityRole="link"
                  accessibilityLabel={`${m.name || 'Member'}${m.role === 'admin' ? ', admin' : ''}. Open profile`}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 150, opacity: pressed ? 0.7 : 1 })}
                >
                  <Avatar uri={m.avatarUrl} name={m.name} gender={m.gender} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>
                      {m.name || 'Lift2Lift member'}
                      {m.id === me ? <Text style={{ color: t.muted, fontWeight: '500' }}> (you)</Text> : null}
                    </Text>
                    <Text style={{ color: m.role === 'admin' ? t.ink : t.muted, fontSize: 12, fontWeight: m.role === 'admin' ? '800' : '500' }}>
                      {m.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </Pressable>
                {admin && m.id !== me ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button
                      small
                      variant="ghost"
                      title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                      onPress={() =>
                        run(async () => {
                          await api.setCommunityRole(page.id, m.id, m.role === 'admin' ? 'member' : 'admin');
                          await onChanged();
                        }, m.role === 'admin' ? `${m.name.split(' ')[0]} is a member now.` : `${m.name.split(' ')[0]} is now an admin.`)
                      }
                    />
                    {m.role === 'member' ? <Button small variant="ghost" title="Remove" onPress={() => setConfirm({ remove: m })} /> : null}
                  </View>
                ) : null}
              </View>
              {confirm && typeof confirm === 'object' && confirm.remove.id === m.id ? (
                <View style={{ gap: 8 }}>
                  <Notice kind="error">Remove {m.name.split(' ')[0]} from {page.name}? They stop seeing its rides, and they'd need the code to come back.</Notice>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button small variant="ghost" title="Keep" onPress={() => setConfirm(null)} />
                    <Button
                      small
                      variant="danger"
                      title="Remove"
                      loading={busy}
                      onPress={() =>
                        run(async () => {
                          await api.removeCommunityMember(page.id, m.id);
                          await onChanged();
                        }, `Removed ${m.name.split(' ')[0]}.`)
                      }
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      </View>

      {/* Admin tools */}
      {admin ? (
        <View style={{ gap: 8 }}>
          <Label>Admin</Label>
          <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <CommunityBadge name={page.name} photoUrl={page.photoUrl} size={64} />
            <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
              <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800' }}>Community photo</Text>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
                Shows on the community page and in Popular communities. A square logo works best.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {page.photoUrl ? (
                <Button
                  small
                  variant="ghost"
                  title="Remove"
                  onPress={() =>
                    run(async () => {
                      await api.setCommunityPhoto(page.id, null);
                      await onChanged();
                    }, 'Photo removed.')
                  }
                />
              ) : null}
              <Button small variant="ghost" title={page.photoUrl ? 'Change photo' : 'Add photo'} loading={busy} onPress={changePhoto} />
            </View>
          </Card>
          {children}
          {editing ? (
            <Card style={{ padding: 14, gap: 12 }}>
              <Field label="Name" value={name} onChangeText={setName} maxLength={40} />
              <Field label="Description" value={description} onChangeText={setDescription} maxLength={280} multiline />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Button small variant="ghost" title="Cancel" onPress={() => setEditing(false)} />
                <Button
                  small
                  title="Save"
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      await api.updateCommunity(page.id, name.trim(), description.trim());
                      setEditing(false);
                      await onChanged();
                    }, 'Saved.')
                  }
                />
              </View>
            </Card>
          ) : confirm === 'code' ? (
            <View style={{ gap: 8 }}>
              <Notice kind="error">Make a new code? The current code stops working right away. Everyone already in stays in.</Notice>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small variant="ghost" title="Keep this code" onPress={() => setConfirm(null)} />
                <Button
                  small
                  variant="danger"
                  title="Make a new code"
                  loading={busy}
                  onPress={() =>
                    run(async () => {
                      const c = await api.resetCommunityCode(page.id);
                      await onChanged();
                      onMessage(`New code: ${formatCode(c)}. Send it to anyone who still needs to join.`, 'success');
                    })
                  }
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
              {page.listed
                ? 'Listed in Popular communities: anyone on Lift2Lift can see its name and ask to join. You approve each request.'
                : 'Hidden from Popular communities: people can only join with your invite code.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button
                small
                variant="ghost"
                title={page.listed ? 'Hide from Popular' : 'Show in Popular'}
                loading={busy}
                onPress={() =>
                  run(async () => {
                    await api.setCommunityListed(page.id, !page.listed);
                    await onChanged();
                  }, page.listed ? 'Hidden from Popular communities.' : 'Listed in Popular communities.')
                }
              />
              <Button
                small
                variant="ghost"
                title="Edit name and description"
                onPress={() => {
                  setName(page.name);
                  setDescription(page.description);
                  setEditing(true);
                }}
              />
              <Button small variant="ghost" title="Make a new code" onPress={() => setConfirm('code')} />
            </View>
            </View>
          )}
        </View>
      ) : null}

      {/* Leave */}
      {confirm === 'leave' ? (
        <View style={{ gap: 8 }}>
          <Notice kind="error">
            {`Leave ${page.name}? You'll stop seeing its rides (except ones you're booked on).`}
            {admin && !otherAdmins && page.memberCount > 1 ? ' The longest-standing member becomes admin.' : ''}
          </Notice>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small variant="ghost" title="Stay" onPress={() => setConfirm(null)} />
            <Button
              small
              variant="danger"
              title="Leave community"
              loading={busy}
              onPress={() =>
                run(async () => {
                  await api.leaveCommunity(page.id);
                  nav.replace('/communities');
                })
              }
            />
          </View>
        </View>
      ) : (
        <Text style={{ textAlign: 'center' }}>
          <Text onPress={() => setConfirm('leave')} accessibilityRole="button" style={{ color: t.danger, fontSize: 14, fontWeight: '700' }}>
            Leave community
          </Text>
        </Text>
      )}
    </>
  );
}
