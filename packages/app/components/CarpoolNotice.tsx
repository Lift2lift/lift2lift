import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { CARPOOL_DISCLAIMER } from '../lib/rules';
import { useTheme } from '../lib/theme';
import { useDevice } from '../providers';
import { useIntroDone } from './IntroSplash';
import { Brand, Button } from './ui';

/**
 * Bump the version when CARPOOL_DISCLAIMER's wording changes, so everyone is
 * asked to acknowledge the new text.
 */
const ACK_KEY = 'lift2lift.carpoolNoticeAck.v1';

/**
 * Colorado carpool notice (C.R.S. 43-1-127), shown the first time the app is
 * opened on a device, right after the opening screen. (Riders also acknowledge
 * it again before each booking, in RideCard.) It can't be dismissed: the person has to tick the box
 * and tap "I acknowledge" before using Lift2Lift. The acknowledgement is saved
 * on the device, so it doesn't come back on later launches.
 */
export function CarpoolNoticeGate() {
  const t = useTheme();
  const device = useDevice();
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    device
      .getPref(ACK_KEY)
      .then((v) => alive && setNeeded(!v))
      .catch(() => alive && setNeeded(true));
    return () => {
      alive = false;
    };
  }, [device]);

  // Wait for the opening screen to finish, plus a beat so iOS has dismissed it
  // before this one is presented (two modals at once don't show reliably).
  const introDone = useIntroDone();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!introDone) return;
    const id = setTimeout(() => setReady(true), 350);
    return () => clearTimeout(id);
  }, [introDone]);

  const acknowledge = () => {
    setNeeded(false);
    device.setPref(ACK_KEY, new Date().toISOString()).catch(() => {});
  };

  return (
    <Modal visible={needed && ready} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(7,13,24,0.88)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View
          accessibilityViewIsModal
          style={{ width: '100%', maxWidth: 440, maxHeight: '100%', backgroundColor: t.surface, borderRadius: 18, overflow: 'hidden' }}
        >
          <ScrollView contentContainerStyle={{ padding: 22, gap: 16 }}>
            <Brand size={28} />
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>
                Colorado carpool notice
              </Text>
              <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                Please read this before you use Lift2Lift.
              </Text>
            </View>

            <View style={{ backgroundColor: t.chip, borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: t.accent }}>
              <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{CARPOOL_DISCLAIMER}</Text>
            </View>

            <Pressable
              onPress={() => setChecked((c) => !c)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              hitSlop={6}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, opacity: pressed ? 0.8 : 1 })}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  marginTop: 1,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: checked ? t.ink : t.muted,
                  backgroundColor: checked ? t.ink : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {checked ? <Text style={{ color: t.surface, fontSize: 15, fontWeight: '900', lineHeight: 18 }}>✓</Text> : null}
              </View>
              <Text style={{ flex: 1, color: t.ink, fontSize: 15, lineHeight: 22 }}>
                I have read and understand this notice.
              </Text>
            </Pressable>

            <Button title="I acknowledge" onPress={acknowledge} disabled={!checked} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
