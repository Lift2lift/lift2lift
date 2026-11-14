import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Modal, Platform, Pressable, StatusBar, Text, useWindowDimensions, View } from 'react-native';
import type { DeviceServices } from '../lib/types';

/** How long the intro stays up before it swipes away. */
export const INTRO_HOLD_MS = 2000;
const IN_MS = 280;
const OUT_MS = 420;

// Same navy as the app icon, so the icon's square edges disappear into the background.
const NAVY = '#15213A';
const YELLOW = '#F5B800';

// Once per launch on iPhone; once per browser tab on the web (so moving between
// pages or following an email link doesn't replay it).
let shownThisLaunch = false;
function alreadyShown() {
  if (shownThisLaunch) return true;
  if (Platform.OS === 'web') {
    try {
      return window.sessionStorage.getItem('l2l-intro') === '1';
    } catch {
      return false;
    }
  }
  return false;
}
function markShown() {
  shownThisLaunch = true;
  if (Platform.OS === 'web') {
    try {
      window.sessionStorage.setItem('l2l-intro', '1');
    } catch {
      // storage blocked: it just shows again next load
    }
  }
}

// Lets other launch pop-ups (the carpool notice) wait until the intro is gone.
let introDone = false;
const doneListeners = new Set<() => void>();
function finishIntro() {
  if (introDone) return;
  introDone = true;
  doneListeners.forEach((l) => l());
}

/** True once the opening screen has finished (or was skipped because it already showed). */
export function useIntroDone() {
  const [done, setDone] = useState(introDone);
  useEffect(() => {
    if (introDone) return setDone(true);
    const l = () => setDone(true);
    doneListeners.add(l);
    return () => {
      doneListeners.delete(l);
    };
  }, []);
  return done;
}

/**
 * The opening screen: logo, LIFT2LIFT and "carpool to ski". Holds for
 * 2 seconds, then swipes off to the left. Tap to skip. With Reduce Motion on,
 * it fades instead of sliding.
 */
export function IntroSplash({ logo }: { logo?: DeviceServices['logo'] }) {
  const [visible, setVisible] = useState(() => !alreadyShown());
  const { width } = useWindowDimensions();
  const slide = useRef(new Animated.Value(0)).current; // 0 = on screen, 1 = gone
  const appear = useRef(new Animated.Value(0)).current; // logo and words fade and rise in
  const reduceMotion = useRef(false);
  const leaving = useRef(false);
  const native = Platform.OS !== 'web';

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    Animated.timing(slide, {
      toValue: 1,
      duration: reduceMotion.current ? 250 : OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: native,
    }).start(() => {
      setVisible(false);
      finishIntro();
    });
  };

  useEffect(() => {
    if (!visible) return finishIntro();
    markShown();
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        reduceMotion.current = !!on;
      })
      .catch(() => {});
    Animated.timing(appear, { toValue: 1, duration: IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
    const id = setTimeout(leave, INTRO_HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  const sheet = reduceMotion.current
    ? { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
    : { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -Math.max(width, 400) * 1.1] }) }] };
  const rise = {
    opacity: appear,
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={leave}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[{ flex: 1, backgroundColor: NAVY }, sheet]}>
        <Pressable
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel="Lift2Lift. Carpool to ski. Tap to continue"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <Animated.View style={[{ alignItems: 'center', gap: 18 }, rise]}>
            {logo ? (
              <Image source={logo as never} style={{ width: 132, height: 132, borderRadius: 30 }} resizeMode="cover" accessibilityIgnoresInvertColors />
            ) : null}
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 46, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5 }}>
                LIFT<Text style={{ color: YELLOW }}>2</Text>LIFT
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 18, fontWeight: '600', letterSpacing: 2.5 }}>carpool to ski</Text>
            </View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
