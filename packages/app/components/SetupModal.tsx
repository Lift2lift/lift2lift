import { Modal, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { useNav } from '../providers';
import { Button } from './ui';

/**
 * Pop-up the first time someone posts a ride or calls shotgun.
 * Riders set up their profile; drivers set up their profile and add insurance.
 */
export function SetupModal({
  visible,
  role,
  profileReady,
  onClose,
}: {
  visible: boolean;
  role: 'rider' | 'driver';
  profileReady: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const nav = useNav();
  const then = role === 'driver' ? 'post' : 'board';
  const steps = [
    ...(profileReady
      ? []
      : ['Take a selfie with your ID scan. It becomes your profile photo.', 'Add a few details about you', 'Pick your interests']),
    ...(role === 'driver' ? ['Snap your insurance card'] : []),
    role === 'driver' ? 'Post your ride' : 'Call shotgun',
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(7,13,24,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, backgroundColor: t.surface, borderRadius: 18, padding: 22, gap: 14 }}>
          <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900' }}>{role === 'driver' ? 'Before your first ride' : 'Before you call shotgun'}</Text>
          <Text style={{ color: t.muted, fontSize: 15, lineHeight: 22 }}>
            {profileReady
              ? 'Drivers add their insurance card. It takes about a minute, and you only do it once.'
              : 'Everyone on Lift2Lift has a verified profile, so you know who you’re sharing a car with. About two minutes, one time.'}
          </Text>
          <View style={{ gap: 6 }}>
            {steps.map((s, i) => (
              <Text key={s} style={{ color: t.ink, fontSize: 15, lineHeight: 21 }}>
                {i + 1}. {s}
              </Text>
            ))}
          </View>
          <Button
            title={profileReady ? 'Add insurance card' : 'Set up my profile'}
            onPress={() => {
              onClose();
              if (profileReady) nav.replace('/account/driver', { then: 'post' });
              else nav.push('/profile/setup', { then });
            }}
          />
          <Button title="Not now" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
